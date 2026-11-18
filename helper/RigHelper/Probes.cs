// Custom logs ("probes"): extra things the background recorder writes down,
// set up by the person or proposed by Rig's chat. Each is a declared reading
// of one kind, never free-form code, except a script, which runs only once
// the person has approved its exact text in Rig (and, for one that runs as
// admin, said yes to Windows' own prompt too).
//
//   sensor    any sensor LibreHardwareMonitor sees, matched by id or by words in its name
//   counter   any Windows performance counter, like \Processor(_Total)\% Processor Time
//   events    any event log channel, with any XPath query; each match is written as it happens
//   wmi       any read-only WMI query (SELECT, ASSOCIATORS OF, REFERENCES OF) in any namespace
//   process   a named process: running or not, how many, processor share and memory
//   file      a file's size and time, or the end of it when it's a text log
//   folder    a folder's total size and file count
//   registry  one registry value, or all values of a key
//   script    a PowerShell or cmd script the person approved; its output, exit code and time
//
// Any of them can log only while a condition holds, or faster while it does:
// "every second while the graphics card is above 85°C". The condition reads
// one of the recorder's own readings or another custom log's latest number.
//
// The list lives in %ProgramData%\Rig\Recorder\probes.json, which only admins
// and the system can change. What each writes goes to custom\<owner SID>\, a
// folder only that Windows account (and admins) can read, because the
// recorder reads with the system's rights.

using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public sealed record ProbeCondition(string? Metric, string? Probe, string Op, double Value, int ForSec)
{
    public bool Holds(double v) => Op switch { ">" => v > Value, ">=" => v >= Value, "<" => v < Value, "<=" => v <= Value, _ => false };

    public JsonObject ToJson()
    {
        var o = new JsonObject();
        if (Metric != null) o["metric"] = Metric;
        if (Probe != null) o["probe"] = Probe;
        o["op"] = Op;
        o["value"] = Value;
        if (ForSec > 0) o["forSec"] = ForSec;
        return o;
    }
}

/// One custom log, checked. Source holds only the fields its kind uses.
public sealed record ProbeSpec(
    string Id, string Label, string By, string Owner, long CreatedAt, long ExpiresAt,
    int Every, int Fast, string Kind, JsonObject Source, ProbeCondition? When, bool Paused, string? Hash, long ApprovedAt)
{
    public bool IsScript => Kind == "script";
    public bool Admin => IsScript && Source["admin"]?.GetValue<bool>() == true;

    public JsonObject ToJson(bool withOwner = true)
    {
        var o = new JsonObject
        {
            ["id"] = Id, ["label"] = Label, ["by"] = By, ["createdAt"] = CreatedAt, ["expiresAt"] = ExpiresAt,
            ["every"] = Every, ["source"] = Source.DeepClone(),
        };
        if (Fast > 0) o["fast"] = Fast;
        if (When != null) o["when"] = When.ToJson();
        if (Paused) o["paused"] = true;
        if (Hash != null) { o["hash"] = Hash; o["approvedAt"] = ApprovedAt; }
        if (withOwner) o["owner"] = Owner;
        return o;
    }
}

public static class ProbeRules
{
    public const int MaxProbes = 24;
    public const int MaxScripts = 8;
    public const long Day = 86_400_000;
    public const long MaxLifeMs = 30 * Day, FastLifeMs = Day, DefaultLifeMs = 7 * Day;
    /// What one custom log may write in a day; past it, it waits for the next day.
    public const long ProbeDayCap = 5L << 20;
    public const int MaxScriptChars = 8000, MaxScriptTimeout = 120, DefaultScriptTimeout = 30, MinScriptEvery = 30;
    /// What a script run keeps of its output.
    public const int MaxOutputChars = 4000;

    public static readonly string[] Kinds = ["sensor", "counter", "events", "wmi", "process", "file", "folder", "registry", "script"];
    public static readonly string[] Metrics = ["cpuTemp", "gpuTemp", "cpuLoad", "memLoad"];

    static readonly Regex IdRe = new(@"^[a-z0-9][a-z0-9-]{0,39}$");
    static readonly Regex SidRe = new(@"^S-1-[0-9]+(-[0-9]+){1,14}$");
    static readonly Regex CounterRe = new(@"^\\[^\\()]{1,200}(\([^()\\]{0,200}\))?\\[^\\]{1,200}$");
    static readonly Regex ChannelRe = new(@"^[\w\-. /%]{1,200}$");
    static readonly Regex NamespaceRe = new(@"^root(\\\w{1,64}){0,6}$", RegexOptions.IgnoreCase);
    static readonly Regex WqlRe = new(@"^\s*(select|associators\s+of|references\s+of)\s", RegexOptions.IgnoreCase);
    static readonly Regex ProcessRe = new(@"^[\w .\-()+]{1,100}$");
    static readonly Regex KeyRe = new(@"^(HKLM|HKCU|HKU|HKCR|HKCC|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_USERS|HKEY_CLASSES_ROOT|HKEY_CURRENT_CONFIG)(\\[^\\]{1,255}){0,30}$", RegexOptions.IgnoreCase);

    /// A trimmed string with no control characters, or null when it's missing, empty or too long.
    static string? Str(JsonNode? n, int max, bool multiline = false)
    {
        if (n is not JsonValue v || !v.TryGetValue(out string? s)) return null;
        if (!multiline) s = s.Trim();
        if (s.Length == 0 || s.Length > max) return null;
        return s.Any(c => char.IsControl(c) && !(multiline && c is '\n' or '\r' or '\t')) ? null : s;
    }

    static bool LocalPath(string p) =>
        Path.IsPathFullyQualified(p) && !p.StartsWith(@"\\", StringComparison.Ordinal) && p.IndexOfAny(['*', '?', '"', '<', '>', '|']) < 0;

    /// The fingerprint of a script's approval: its shell, whether it runs as admin, and its exact text.
    public static string ScriptHash(string shell, bool admin, string text) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{shell}\n{(admin ? "admin" : "user")}\n{text}"))).ToLowerInvariant();

    /// Checks a custom log. Scripts must carry the hash of an approval, which must match their text.
    public static (ProbeSpec? Probe, string? Error) Parse(JsonNode? node, long now, string owner)
    {
        if (node is not JsonObject o) return Bad("a custom log must be an object");
        string? id = Str(o["id"], 40);
        if (id == null || !IdRe.IsMatch(id)) return Bad("id must be 1 to 40 lowercase letters, digits and dashes");
        string? label = Str(o["label"], 160);
        if (label == null) return Bad("label must be a short sentence");
        string by = Str(o["by"], 10) == "you" ? "you" : "chat";
        if (!SidRe.IsMatch(owner)) return Bad("the owner isn't a Windows account");
        long created = (long)Json.Num(o["createdAt"], now);
        if (created > now + 60_000) created = now;
        long expires = (long)Json.Num(o["expiresAt"], created + DefaultLifeMs);
        if (expires <= now) return Bad("it has already ended");
        if (expires - created > MaxLifeMs) return Bad("a custom log can last at most 30 days");
        if (o["source"] is not JsonObject src) return Bad("source is missing");
        string kind = Str(src["kind"], 20) ?? "";
        if (!Kinds.Contains(kind)) return Bad($"kind must be one of {string.Join(", ", Kinds)}");
        var (clean, err) = Source(kind, src);
        if (clean == null) return Bad(err!);

        int def = kind switch { "events" => 0, "folder" => 600, "script" => 300, "wmi" or "file" or "registry" => 60, _ => 10 };
        int min = kind switch { "folder" => 60, "script" => MinScriptEvery, _ => 1 };
        int every = (int)Json.Num(o["every"], def), fast = (int)Json.Num(o["fast"], 0);
        if (kind == "events") { every = 0; fast = 0; }
        else
        {
            if (every != 0 && (every < min || every > 86_400)) return Bad($"every must be 0 or {min} to 86400 seconds");
            if (fast != 0 && (fast < min || fast > 3600)) return Bad($"fast must be {min} to 3600 seconds");
        }

        ProbeCondition? when = null;
        if (o["when"] is JsonObject w)
        {
            if (kind == "events") return Bad("an event log query logs each matching event, so it takes no condition");
            string? metric = Str(w["metric"], 20), other = Str(w["probe"], 40), op = Str(w["op"], 2);
            if ((metric == null) == (other == null)) return Bad("a condition needs either metric or probe");
            if (metric != null && !Metrics.Contains(metric)) return Bad($"metric must be one of {string.Join(", ", Metrics)}");
            if (other != null && (!IdRe.IsMatch(other) || other == id)) return Bad("a condition's probe must be another custom log's id");
            if (op is not (">" or ">=" or "<" or "<=")) return Bad("op must be >, >=, < or <=");
            double value = Json.Num(w["value"], double.NaN);
            if (!double.IsFinite(value)) return Bad("a condition needs a number to compare with");
            int forSec = (int)Json.Num(w["forSec"], 0);
            if (forSec is < 0 or > 3600) return Bad("forSec must be 0 to 3600");
            when = new ProbeCondition(metric, other, op, value, forSec);
            if (every == 0 && fast == 0) return Bad("give fast, how often to log while the condition holds");
        }
        else
        {
            fast = 0;
            if (every == 0 && kind != "events") return Bad("every can be 0 only with a condition");
        }

        int quickest = new[] { every, fast }.Where(x => x > 0).DefaultIfEmpty(int.MaxValue).Min();
        if (quickest < 5 && expires - created > FastLifeMs) return Bad("a log taken more often than every 5 seconds can last at most 24 hours");

        string? hash = null;
        long approvedAt = 0;
        if (kind == "script")
        {
            hash = Str(o["hash"], 64);
            string want = ScriptHash(clean["shell"]!.GetValue<string>(), clean["admin"]!.GetValue<bool>(), clean["text"]!.GetValue<string>());
            if (hash != want) return Bad("this script hasn't been approved as it is now");
            approvedAt = (long)Json.Num(o["approvedAt"], 0);
        }
        bool paused = o["paused"]?.GetValueKind() == System.Text.Json.JsonValueKind.True;
        return (new ProbeSpec(id, label, by, owner, created, expires, every, fast, kind, clean, when, paused, hash, approvedAt), null);

        static (ProbeSpec?, string?) Bad(string e) => (null, e);
    }

    /// The fields a kind uses, checked; anything else is dropped.
    static (JsonObject? Source, string? Error) Source(string kind, JsonObject s)
    {
        var o = new JsonObject { ["kind"] = kind };
        switch (kind)
        {
            case "sensor":
                if (Str(s["match"], 120) is not string m) return (null, "match must name a sensor, like \"GPU Hot Spot\" or a sensor id");
                o["match"] = m;
                break;
            case "counter":
                if (Str(s["path"], 600) is not string p || !CounterRe.IsMatch(p)) return (null, @"path must be a counter path like \Processor(_Total)\% Processor Time");
                o["path"] = p;
                break;
            case "events":
                if (Str(s["channel"], 200) is not string ch || !ChannelRe.IsMatch(ch)) return (null, "channel must be an event log name, like System or Microsoft-Windows-Kernel-Power/Thermal-Operational");
                o["channel"] = ch;
                o["query"] = Str(s["query"], 4000) ?? "*";
                break;
            case "wmi":
                string ns = Str(s["namespace"], 200) ?? @"root\cimv2";
                if (!NamespaceRe.IsMatch(ns)) return (null, @"namespace must be like root\cimv2 or root\wmi");
                if (Str(s["query"], 2000) is not string q || !WqlRe.IsMatch(q)) return (null, "query must be a WQL SELECT, ASSOCIATORS OF or REFERENCES OF query");
                o["namespace"] = ns;
                o["query"] = q;
                break;
            case "process":
                if (Str(s["name"], 100) is not string name || !ProcessRe.IsMatch(name)) return (null, "name must be a program's name, like game.exe");
                o["name"] = name;
                break;
            case "file":
                if (Str(s["path"], 260) is not string fp || !LocalPath(fp)) return (null, "path must be a full path to a file on this PC");
                o["path"] = fp;
                o["read"] = Str(s["read"], 10) == "tail" ? "tail" : "info";
                break;
            case "folder":
                if (Str(s["path"], 260) is not string dp || !LocalPath(dp)) return (null, "path must be a full path to a folder on this PC");
                o["path"] = dp;
                break;
            case "registry":
                if (Str(s["key"], 1000) is not string k || !KeyRe.IsMatch(k)) return (null, @"key must be a full registry key, like HKLM\SYSTEM\CurrentControlSet\Control\Power");
                o["key"] = k;
                if (s["value"] is JsonValue jv)
                {
                    if (!jv.TryGetValue(out string? v) || v.Length > 255 || v.Any(char.IsControl)) return (null, "value must be a value's name, or empty for the default value");
                    o["value"] = v;
                }
                break;
            case "script":
                string shell = Str(s["shell"], 20) ?? "powershell";
                if (shell is not ("powershell" or "cmd")) return (null, "shell must be powershell or cmd");
                if (Str(s["text"], MaxScriptChars, multiline: true) is not string text || string.IsNullOrWhiteSpace(text)) return (null, $"text must be the script, at most {MaxScriptChars} characters");
                int timeout = (int)Json.Num(s["timeout"], DefaultScriptTimeout);
                if (timeout is < 1 or > MaxScriptTimeout) return (null, $"timeout must be 1 to {MaxScriptTimeout} seconds");
                o["shell"] = shell;
                o["admin"] = s["admin"]?.GetValueKind() == System.Text.Json.JsonValueKind.True;
                o["timeout"] = timeout;
                o["text"] = text;
                break;
        }
        return (o, null);
    }
}

/// probes.json, and the edits the Rig app makes to it through the helper.
public static class ProbeStore
{
    public static string PathIn(string data) => Path.Combine(data, "probes.json");
    static readonly object gate = new();

    /// The custom logs on file that are still valid. Ones past their end, or that no longer check out, are left out.
    public static List<ProbeSpec> Load(string data, long now, List<string>? problems = null)
    {
        JsonArray? arr;
        try { arr = JsonNode.Parse(File.ReadAllText(PathIn(data)))?["probes"] as JsonArray; }
        catch (FileNotFoundException) { return []; }
        catch (DirectoryNotFoundException) { return []; }
        catch (Exception e) { problems?.Add($"probes.json can't be read: {e.Message}"); return []; }
        var list = new List<ProbeSpec>();
        foreach (var n in arr ?? [])
        {
            string owner = n?["owner"] is JsonValue ov && ov.TryGetValue(out string? s) ? s : "";
            var (p, e) = ProbeRules.Parse(n, now, owner);
            if (p == null) { if (e != "it has already ended") problems?.Add($"{n?["id"]}: {e}"); continue; }
            if (list.Any(x => x.Id == p.Id) || list.Count >= ProbeRules.MaxProbes) continue;
            list.Add(p);
        }
        return list;
    }

    public static void Save(string data, IEnumerable<ProbeSpec> list)
    {
        var arr = new JsonArray();
        foreach (var p in list) arr.Add(p.ToJson());
        string path = PathIn(data), tmp = path + ".tmp";
        lock (gate)
        {
            File.WriteAllText(tmp, new JsonObject { ["probes"] = arr }.ToJsonString());
            File.Move(tmp, path, overwrite: true);
        }
    }

    /// The helper's "recorder.probes" call, made by the Rig app for the Windows account it runs as:
    /// {op: "list"}, {op: "add", probe}, {op: "remove", id}, {op: "pause" | "resume", id}.
    /// Scripts can't be added this way: the app approves a user script with {op: "approve", probe}, and an admin script
    /// only through ApproveFromFile, which runs behind Windows' own permission prompt.
    public static JsonNode Edit(JsonNode? p, Sensors? hw)
    {
        if (!Native.IsAdmin()) throw new RigException("Rig needs Windows permission to set up custom logs.");
        if (!RecorderSetup.IsInstalled()) throw new RigException("Custom logs are kept by the background recorder. Turn on \"Keep a log while Rig is closed\" in Settings first.");
        string owner = WindowsIdentity.GetCurrent().User?.Value ?? throw new RigException("Rig couldn't tell which Windows account this is.");
        string op = p?["op"] is JsonValue v && v.TryGetValue(out string? s) ? s : "list";
        var probe = p?["probe"] as JsonObject;
        if (op == "approve" && probe?["source"]?["admin"]?.GetValueKind() == System.Text.Json.JsonValueKind.True)
            throw new RigException("A script that runs as admin needs Windows' own permission prompt to approve it.");
        return Change(RecorderPaths.Data, owner, op, probe, (p?["id"] as JsonValue)?.ToString(), hw);
    }

    /// RigHelper.exe --approve-script <file>: run behind Windows' permission prompt to approve one script, admin or not,
    /// for the account that asked. The file holds {probe, owner}; the result is written next to it. --hash is the
    /// script's hash as the app showed it: if the file no longer matches (something changed it after Rig wrote it),
    /// nothing is approved.
    public static int ApproveFromFile(string file, string? hash)
    {
        string result = file + ".result";
        try
        {
            if (!Native.IsAdmin()) return RecorderSetup.NotAdmin;
            var req = JsonNode.Parse(File.ReadAllText(file)) as JsonObject ?? throw new RigException("Rig couldn't read the script to approve.");
            string owner = (req["owner"] as JsonValue)?.ToString() ?? "";
            // The person approving is signed in to Windows as the account the script is for, or is approving for it as admin.
            if (!Regex.IsMatch(owner, @"^S-1-[0-9-]+$")) throw new RigException("Rig couldn't tell which Windows account the script is for.");
            if (!RecorderSetup.IsInstalled()) throw new RigException("Turn on \"Keep a log while Rig is closed\" in Settings first.");
            var so = req["probe"]?["source"] as JsonObject;
            string got = ProbeRules.ScriptHash(so?["shell"]?.ToString() ?? "powershell", so?["admin"]?.GetValueKind() == System.Text.Json.JsonValueKind.True, so?["text"]?.ToString() ?? "");
            if (string.IsNullOrEmpty(hash) || !string.Equals(got, hash, StringComparison.OrdinalIgnoreCase))
                throw new RigException("The script changed after you chose Approve, so Rig didn't approve it.");
            var list = Change(RecorderPaths.Data, owner, "approve", req["probe"] as JsonObject, null, null);
            File.WriteAllText(result, new JsonObject { ["ok"] = true, ["probes"] = list }.ToJsonString());
            return RecorderSetup.Ok;
        }
        catch (Exception e)
        {
            try { File.WriteAllText(result, new JsonObject { ["ok"] = false, ["error"] = e is RigException ? e.Message : $"Rig couldn't approve the script: {e.Message}" }.ToJsonString()); } catch { }
            return RecorderSetup.Failed;
        }
    }

    static JsonNode Change(string data, string owner, string op, JsonObject? probe, string? id, Sensors? hw)
    {
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        lock (gate)
        {
            var list = Load(data, now);
            ProbeSpec? Mine(string? x) => list.FirstOrDefault(q => q.Id == x && q.Owner == owner);
            switch (op)
            {
                case "list": break;
                case "add" or "approve":
                {
                    var input = probe?.DeepClone() as JsonObject ?? throw new RigException("No custom log was given.");
                    bool script = input["source"]?["kind"]?.ToString() == "script";
                    if (script != (op == "approve")) throw new RigException(script ? "A script runs only once you approve it in Rig." : "Only scripts are approved.");
                    if (script && input["source"] is JsonObject so)
                    {
                        // The approval is of this exact text: pin it.
                        input["hash"] = ProbeRules.ScriptHash(so["shell"]?.ToString() ?? "powershell", so["admin"]?.GetValueKind() == System.Text.Json.JsonValueKind.True, so["text"]?.ToString() ?? "");
                        input["approvedAt"] = now;
                    }
                    input.Remove("paused");
                    var (spec, err) = ProbeRules.Parse(input, now, owner);
                    if (spec == null) throw new RigException($"That custom log isn't one Rig can keep: {err}.");
                    if (spec.When?.Probe is string other && Mine(other) == null) throw new RigException($"The condition reads a custom log ({other}) that isn't on.");
                    if (list.Any(q => q.Id == spec.Id && q.Owner != owner)) throw new RigException("Another Windows account already has a custom log with that id.");
                    list.RemoveAll(q => q.Id == spec.Id);
                    if (list.Count >= ProbeRules.MaxProbes) throw new RigException($"Rig keeps at most {ProbeRules.MaxProbes} custom logs. Turn one off in Settings first.");
                    if (spec.IsScript && list.Count(q => q.IsScript && q.Owner == owner) >= ProbeRules.MaxScripts) throw new RigException($"Rig keeps at most {ProbeRules.MaxScripts} scripts. Turn one off in Settings first.");
                    // Catch a reading that can't work now, so the person hears it at once instead of in Logs later.
                    if (!spec.IsScript && ProbeReader.Try(spec, hw) is string problem) throw new RigException(problem);
                    list.Add(spec);
                    break;
                }
                case "remove":
                    if (list.RemoveAll(q => q.Id == id && q.Owner == owner) == 0) throw new RigException("There's no custom log with that id.");
                    break;
                case "pause" or "resume":
                {
                    var q = Mine(id) ?? throw new RigException("There's no custom log with that id.");
                    list[list.IndexOf(q)] = q with { Paused = op == "pause" };
                    break;
                }
                default: throw new RigException($"Rig doesn't know how to \"{op}\" a custom log.");
            }
            if (op != "list") Save(data, list);
            var mine = new JsonArray();
            foreach (var q in list.Where(q => q.Owner == owner)) mine.Add(q.ToJson(withOwner: false));
            return mine;
        }
    }

    /// The folder a Windows account's custom logs go to: the system and admins have full control, that account may read.
    public static string OwnerFolder(string data, string owner)
    {
        string dir = Path.Combine(data, "custom", owner);
        var info = Directory.CreateDirectory(dir);
        try
        {
            var sec = new DirectorySecurity();
            sec.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
            const InheritanceFlags all = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
            sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
            sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(owner), FileSystemRights.ReadAndExecute, all, PropagationFlags.None, AccessControlType.Allow));
            info.SetAccessControl(sec);
        }
        catch { /* a test folder outside ProgramData, or an account that's gone: leave it as it is */ }
        return dir;
    }
}
