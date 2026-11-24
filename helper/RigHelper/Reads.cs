using System.Globalization;
using System.Management;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

/// The chat's live reads: one registry key or value, or a CIM class's instances with a query built from fixed parts.
/// Nothing here writes. The app and the server check each read first (packages/core/src/reads.ts); this checks the shape again.
/// PowerShell reads wait for the command checker, which runs them as the person, not elevated.
public static class Reads
{
    static readonly Regex Name = new(@"^[A-Za-z_][A-Za-z0-9_]{0,63}$");
    static readonly Regex Namespace = new(@"^root(\\[A-Za-z0-9_]{1,64}){0,4}$", RegexOptions.IgnoreCase);
    const int MaxRows = 50, MaxValues = 50;

    public static JsonNode Read(JsonObject? req)
    {
        string kind = Text(req, "kind") ?? "";
        string text = kind switch
        {
            "registry" => RegistryRead(req!),
            "cim" => CimRead(req!),
            "cmdlet" or "script" => throw new RigException("This Rig helper can't run PowerShell reads yet. Update Rig."),
            _ => throw new RigException("Rig's helper doesn't know that kind of read."),
        };
        return new JsonObject { ["text"] = text };
    }

    static string? Text(JsonObject? o, string key) => o?[key] is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    static string RegistryRead(JsonObject req)
    {
        string key = (Text(req, "key") ?? "").Trim();
        int i = key.IndexOf('\\');
        string hive = (i < 0 ? key : key[..i]).TrimEnd(':').ToUpperInvariant(), sub = i < 0 ? "" : key[(i + 1)..].TrimEnd('\\');
        RegistryKey root = hive switch
        {
            "HKLM" or "HKEY_LOCAL_MACHINE" => Registry.LocalMachine,
            "HKCU" or "HKEY_CURRENT_USER" => Registry.CurrentUser,
            _ => throw new RigException("A registry read starts with HKLM\\ or HKCU\\."),
        };
        if (sub.Length == 0 || sub.Contains(@"\\") || key.Length > 300) throw new RigException("That isn't a full registry key.");
        // The account database and the security hive hold secrets. The rules refuse them too; this is the last word.
        if (root == Registry.LocalMachine && (sub.Equals("SAM", StringComparison.OrdinalIgnoreCase) || sub.StartsWith(@"SAM\", StringComparison.OrdinalIgnoreCase)
            || sub.Equals("SECURITY", StringComparison.OrdinalIgnoreCase) || sub.StartsWith(@"SECURITY\", StringComparison.OrdinalIgnoreCase)))
            throw new RigException("Rig never reads the Windows account database.");

        using var k = root.OpenSubKey(sub, writable: false) ?? throw new RigException("That registry key isn't there.");
        var o = new JsonObject { ["key"] = $@"{(root == Registry.LocalMachine ? "HKLM" : "HKCU")}\{sub}" };
        string? one = Text(req, "value");
        if (one != null)
        {
            object? v = k.GetValue(one, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
            o["value"] = one.Length == 0 ? "(default)" : one;
            o["data"] = v == null ? null : ProbeReader.Scalar(v);
            o["type"] = v == null ? "absent" : k.GetValueKind(one).ToString();
        }
        else
        {
            var values = new JsonObject();
            foreach (var n in k.GetValueNames().Take(MaxValues))
                values[n.Length == 0 ? "(default)" : n] = ProbeReader.Scalar(k.GetValue(n, null, RegistryValueOptions.DoNotExpandEnvironmentNames));
            o["values"] = values;
            o["subkeys"] = new JsonArray(k.GetSubKeyNames().Take(MaxValues).Select(n => (JsonNode?)JsonValue.Create(n)).ToArray());
        }
        return o.ToJsonString();
    }

    static string CimRead(JsonObject req)
    {
        string cls = Text(req, "class") ?? "";
        if (!Name.IsMatch(cls)) throw new RigException("That isn't a CIM class name.");
        string ns = Text(req, "namespace") ?? @"root\cimv2";
        if (!Namespace.IsMatch(ns)) throw new RigException("That isn't a CIM namespace.");
        var props = new List<string>();
        if (req["properties"] is JsonArray pa)
            foreach (var p in pa.Take(16))
                props.Add(p is JsonValue pv && pv.TryGetValue(out string? s) && Name.IsMatch(s) ? s : throw new RigException("That isn't a property name."));
        var where = new List<string>();
        if (req["filter"] is JsonArray fa)
            foreach (var f in fa.Take(4))
            {
                string prop = Text(f as JsonObject, "property") ?? "";
                if (!Name.IsMatch(prop) || f?["value"] is not JsonValue fv) throw new RigException("Each filter is a property and a plain value.");
                where.Add($"{prop} = {Literal(fv)}");
            }
        string wql = $"SELECT {(props.Count > 0 ? string.Join(", ", props) : "*")} FROM {cls}{(where.Count > 0 ? " WHERE " + string.Join(" AND ", where) : "")}";

        var opts = new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(15), ReturnImmediately = true, Rewindable = false };
        using var searcher = new ManagementObjectSearcher(new ManagementScope(ns), new ObjectQuery(wql), opts);
        using var found = searcher.Get();
        var rows = new JsonArray();
        foreach (ManagementBaseObject mo in found)
        {
            using (mo)
            {
                if (rows.Count >= MaxRows) break;
                var row = new JsonObject();
                foreach (var prop in mo.Properties)
                {
                    if (row.Count >= 32) break;
                    row[prop.Name] = ProbeReader.Scalar(prop.Value);
                }
                rows.Add(row);
            }
        }
        return rows.ToJsonString();
    }

    /// A WQL literal: text in quotes with backslashes and quotes escaped, so a value can't add to the query.
    static string Literal(JsonValue v)
    {
        if (v.GetValueKind() == JsonValueKind.True) return "TRUE";
        if (v.GetValueKind() == JsonValueKind.False) return "FALSE";
        if (v.GetValueKind() == JsonValueKind.Number) return Json.Num(v, 0).ToString("R", CultureInfo.InvariantCulture);
        if (v.TryGetValue(out string? s) && s.Length <= 200 && !s.Any(char.IsControl)) return $"'{s.Replace(@"\", @"\\").Replace("'", @"\'")}'";
        throw new RigException("Each filter is a property and a plain value.");
    }
}
