using System.Globalization;
using System.Management;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

/// The chat's live reads: one registry key or value, or a CIM class's instances with a query built from fixed parts.
/// Nothing here writes. The app and the server check each read first (packages/core/src/reads.ts); this checks it again
/// against the same table (rules/reads.json, embedded) and has the last word. HKCU is the hive of the Windows account the
/// Rig app runs as, never this helper's own, which is another account's when someone else typed the admin password.
public static class Reads
{
    static readonly Regex Name = new(@"^[A-Za-z_][A-Za-z0-9_]{0,63}$");
    static readonly Regex Namespace = new(@"^root(\\[A-Za-z0-9_]{1,64}){0,4}$", RegexOptions.IgnoreCase);
    static readonly Regex Sid = new(@"^S-1-[0-9]+(-[0-9]+){1,14}$");
    static readonly Regex Encoded = new(@"^[A-Za-z0-9+/=_-]+$");
    const int MaxRows = 50, MaxValues = 50;

    sealed record CimClass(bool Clean, string[] Text, string[] Deny);
    sealed record Never(string Says, string[] Keys);
    sealed record Rules(Dictionary<string, Dictionary<string, CimClass>> Cim, string[] SecretProperty, Never[] RegistryNever,
        string[] SecretValue, string[] KeyValue, int KeyMinBytes, int KeyMinChars);

    static readonly Lazy<Rules> rules = new(Load);

    static Rules Load()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Rig.Rules.reads.json") ?? throw new RigException("Rig's read rules are missing from the helper.");
        var o = JsonNode.Parse(s) as JsonObject ?? throw new RigException("Rig's read rules can't be read.");
        static string[] List(JsonNode? n) => n is JsonArray a ? a.Select(x => x?.GetValue<string>() ?? "").ToArray() : [];
        var cim = new Dictionary<string, Dictionary<string, CimClass>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (ns, classes) in o["cim"]!.AsObject())
        {
            var map = new Dictionary<string, CimClass>(StringComparer.OrdinalIgnoreCase);
            foreach (var (cls, e) in classes!.AsObject())
                map[cls] = new CimClass(e?["clean"]?.GetValueKind() == JsonValueKind.True, List(e?["text"]), List(e?["deny"]));
            cim[ns] = map;
        }
        var never = (o["registryNever"] as JsonArray ?? []).Select(n => new Never(n!["says"]!.GetValue<string>(), List(n["keys"]))).ToArray();
        return new Rules(cim, List(o["secretProperty"]), never, List(o["secretValue"]), List(o["keyValue"]),
            (int)Json.Num(o["keyMinBytes"], 16), (int)Json.Num(o["keyMinChars"], 24));
    }

    /// `owner` is the SID of the Windows account the Rig app that started this helper runs as. `worker` makes a read that loads a
    /// driver's own code, which never runs in the helper: the native worker, as the person.
    public static JsonNode Read(JsonObject? req, string? owner, Func<JsonObject, string>? worker = null)
    {
        string kind = Text(req, "kind") ?? "";
        string text = kind switch
        {
            "registry" => RegistryRead(req!, owner),
            "gpu" => worker != null ? worker(Gpu.Request(req!)) : throw new RigException("Rig can't read graphics settings here."),
            "cim" => CimRead(req!),
            "firmware" => Firmware.Read(),
            "log" => LogReads.Read(req!, owner),
            "cmdlet" or "script" => throw new RigException("Rig can't run PowerShell reads on this PC yet. Look with a registry or CIM read instead, or answer from what Rig already knows."),
            _ => throw new RigException("Rig's helper doesn't know that kind of read."),
        };
        return new JsonObject { ["text"] = text };
    }

    static string? Text(JsonObject? o, string key) => o?[key] is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    static bool Contains(string[] list, string name) => list.Any(x => name.Contains(x, StringComparison.OrdinalIgnoreCase));
    static string[] Parts(string key) => key.Split('\\', StringSplitOptions.RemoveEmptyEntries);

    /// The words of the never-list entry a key falls under, or null. Same matching as registryNever in reads.ts.
    public static string? RegistryNever(string key)
    {
        var k = Parts(key);
        foreach (var rule in rules.Value.RegistryNever)
            foreach (var entry in rule.Keys)
            {
                var p = Parts(entry);
                bool rooted = p.Length > 0 && (p[0].Equals("HKLM", StringComparison.OrdinalIgnoreCase) || p[0].Equals("HKCU", StringComparison.OrdinalIgnoreCase));
                bool At(int i) => i + p.Length <= k.Length && p.Select((x, j) => x.Equals(k[i + j], StringComparison.OrdinalIgnoreCase)).All(b => b);
                if (rooted ? At(0) : Enumerable.Range(0, k.Length).Any(At)) return rule.Says;
            }
        return null;
    }

    /// A value whose name says it's a secret, or whose name says key and whose data looks like one.
    public static bool SecretValue(string name, object? data)
    {
        var r = rules.Value;
        if (Contains(r.SecretValue, name)) return true;
        if (!Contains(r.KeyValue, name)) return false;
        return data switch
        {
            byte[] b => b.Length >= r.KeyMinBytes,
            string s => s.Length >= r.KeyMinChars && Encoded.IsMatch(s),
            string[] a => a.Any(s => s.Length >= r.KeyMinChars && Encoded.IsMatch(s)),
            _ => false,
        };
    }

    static string RegistryRead(JsonObject req, string? owner)
    {
        string key = (Text(req, "key") ?? "").Trim();
        int i = key.IndexOf('\\');
        string hive = (i < 0 ? key : key[..i]).TrimEnd(':').ToUpperInvariant(), sub = i < 0 ? "" : key[(i + 1)..].TrimEnd('\\');
        bool machine = hive switch
        {
            "HKLM" or "HKEY_LOCAL_MACHINE" => true,
            "HKCU" or "HKEY_CURRENT_USER" => false,
            _ => throw new RigException("A registry read starts with HKLM\\ or HKCU\\."),
        };
        if (sub.Length == 0 || sub.Contains(@"\\") || key.Length > 300 || sub.Any(char.IsControl)) throw new RigException("That isn't a full registry key.");
        string shown = $@"{(machine ? "HKLM" : "HKCU")}\{sub}";
        if (RegistryNever(shown) is string never) throw new RigException($"{never}.");

        RegistryKey? k;
        if (machine) k = Registry.LocalMachine.OpenSubKey(sub, writable: false);
        else
        {
            // The person's own hive, by the SID of the account the app runs as.
            if (owner == null || !Sid.IsMatch(owner)) throw new RigException("Rig couldn't tell which Windows account the app runs as, so it didn't read HKCU.");
            k = Registry.Users.OpenSubKey($@"{owner}\{sub}", writable: false);
        }
        using var _ = k;
        if (k == null) throw new RigException("That registry key isn't there.");
        var o = new JsonObject { ["key"] = shown };
        string? one = Text(req, "value");
        if (one != null)
        {
            object? v = k.GetValue(one, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
            if (SecretValue(one, v)) throw new RigException("Rig never reads a value that looks like a password, key or token.");
            o["value"] = one.Length == 0 ? "(default)" : one;
            o["data"] = v == null ? null : ProbeReader.Scalar(v);
            o["type"] = v == null ? "absent" : k.GetValueKind(one).ToString();
        }
        else
        {
            var values = new JsonObject();
            int hidden = 0;
            foreach (var n in k.GetValueNames().Take(MaxValues))
            {
                object? v = k.GetValue(n, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                if (SecretValue(n, v)) { hidden++; continue; }
                values[n.Length == 0 ? "(default)" : n] = ProbeReader.Scalar(v);
            }
            o["values"] = values;
            if (hidden > 0) o["hidden"] = $"{hidden} value{(hidden == 1 ? "" : "s")} that look like secrets left out";
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
        if (!rules.Value.Cim.TryGetValue(ns, out var classes) || !classes.TryGetValue(cls, out var entry))
            throw new RigException($"Rig doesn't read {cls} in {ns}.");
        bool Off(string p) => entry.Deny.Contains(p, StringComparer.OrdinalIgnoreCase) || Contains(rules.Value.SecretProperty, p);

        var props = new List<string>();
        if (req["properties"] is JsonArray pa)
            foreach (var p in pa.Take(16))
                props.Add(p is JsonValue pv && pv.TryGetValue(out string? s) && Name.IsMatch(s) ? s : throw new RigException("That isn't a property name."));
        if (props.FirstOrDefault(Off) is string bad) throw new RigException($"Rig never reads {cls}.{bad}.");
        var where = new List<string>();
        if (req["filter"] is JsonArray fa)
            foreach (var f in fa.Take(4))
            {
                string prop = Text(f as JsonObject, "property") ?? "";
                if (!Name.IsMatch(prop) || f?["value"] is not JsonValue fv) throw new RigException("Each filter is a property and a plain value.");
                if (Off(prop)) throw new RigException($"Rig never reads {cls}.{prop}.");
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
                    // A read of the whole class leaves out what Rig never reads.
                    if (Off(prop.Name)) continue;
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

    /// For the self-test: the embedded table loads, and a few reads are judged the way reads.ts judges them.
    public static IEnumerable<string> SelfChecks()
    {
        if (RegistryNever(@"HKCU\Software\SimonTatham\PuTTY\Sessions\x") == null) yield return "a PuTTY session key wasn't refused";
        if (RegistryNever(@"HKLM\SAM\SAM") == null) yield return "the account database wasn't refused";
        if (RegistryNever(@"HKCU\Control Panel\Desktop") != null) yield return "Control Panel\\Desktop was refused";
        if (!SecretValue("DefaultPassword", "x") || !SecretValue("ApiKey", new byte[32]) || SecretValue("KeyboardDelay", "1")) yield return "secret value names weren't judged right";
        if (!rules.Value.Cim.TryGetValue(@"root\cimv2", out var c) || !c.ContainsKey("Win32_VideoController") || c.ContainsKey("Win32_Product")) yield return "the CIM class list is wrong";
        // HKCU is read from the hive of the account it's given, and not at all without one.
        string? me = System.Security.Principal.WindowsIdentity.GetCurrent().User?.Value;
        static string? Fails(Func<JsonNode> f) { try { f(); return null; } catch (Exception e) { return e.Message; } }
        var desktop = new JsonObject { ["kind"] = "registry", ["key"] = @"HKCU\Control Panel\Desktop" };
        if (Fails(() => Read(desktop, me)) is string why) yield return $"HKCU\\Control Panel\\Desktop couldn't be read from the account's own hive: {why}";
        if (Fails(() => Read((JsonObject)desktop.DeepClone(), null)) == null) yield return "HKCU was read without knowing whose it is";
        if (Fails(() => Read(new JsonObject { ["kind"] = "cim", ["class"] = "Win32_Process", ["properties"] = new JsonArray("CommandLine") }, me)) == null) yield return "a process's command line was read";
        if (Fails(() => Read(new JsonObject { ["kind"] = "cim", ["class"] = "Win32_Product" }, me)) == null) yield return "Win32_Product was read";
    }
}
