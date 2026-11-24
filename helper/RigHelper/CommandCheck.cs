// The helper's side of packages/core/src/check.ts: the same rules file, applied
// to the commands PowerShell's own parser finds (CommandParse.ps1) instead of
// the app's tokenizer. Anything the parser can't classify is refused. The
// verdicts have the shapes in packages/core/src/change.ts, and the helper's
// answer is the one the card shows.

using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public static class CommandCheck
{
    sealed class Form { public string[]? Starts { get; set; } public string[]? Has { get; set; } public string[]? Params { get; set; } public string[]? Prefix { get; set; } public bool Free { get; set; } }
    class Outcome { public string? Says { get; set; } public int? Tier { get; set; } public bool? Admin { get; set; } public string? Never { get; set; } public string? Refused { get; set; } }
    sealed class Rule : Outcome { public string[]? Starts { get; set; } public string[]? Has { get; set; } public string[]? Prefix { get; set; } public string[]? Contains { get; set; } public bool Piped { get; set; } }
    sealed class Entry : Outcome { public string Name { get; set; } = ""; public bool Exe { get; set; } public bool Literal { get; set; } public bool Blocks { get; set; } public Form[]? Read { get; set; } public Rule[]? When { get; set; } }
    sealed class TextRule { public string Says { get; set; } = ""; public string Applies { get; set; } = "any"; public string[] Contains { get; set; } = []; }
    sealed class Roots { public string[] Known { get; set; } = []; public string[] Unknown { get; set; } = []; }
    sealed class Rules
    {
        public int Version { get; set; }
        public string[] ReadParams { get; set; } = [];
        public Roots Roots { get; set; } = new();
        public string[] AdminText { get; set; } = [];
        public string[] SafeTypes { get; set; } = [];
        public string[] SafeMethods { get; set; } = [];
        public string[] Pinned { get; set; } = [];
        public Dictionary<string, string> Constructs { get; set; } = [];
        public Dictionary<string, int> Verbs { get; set; } = [];
        public string[] VerbSays { get; set; } = [];
        public Dictionary<string, string> Aliases { get; set; } = [];
        public TextRule[] NeverText { get; set; } = [];
        public TextRule[] ProtectText { get; set; } = [];
        public Entry[] Commands { get; set; } = [];
    }

    record Arg(string Kind, string Text);
    record Call(string Name, bool Piped, List<Arg> Args);
    record Find(string What, string Detail);
    record Found(string Name, string Says, int Tier);
    record Judged(Found Found, bool Admin, string? Stop = null, string Why = "refused");

    public const int MaxScript = 20_000;
    static readonly Rules R = JsonSerializer.Deserialize<Rules>(Resource("Rig.Rules.commands.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    public static int RulesVersion => R.Version;
    public static string Words(string construct) => R.Constructs[construct];

    public static string Resource(string name)
    {
        using var s = typeof(CommandCheck).Assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException($"{name} isn't built in.");
        using var r = new StreamReader(s, Encoding.UTF8);
        return r.ReadToEnd();
    }

    // Characters PowerShell reads as quotes, dashes or spaces but that don't look like them, and control characters.
    static readonly Regex Disguised = new(@"[\u2018-\u201f\u2013-\u2015\u00a0\u0085\u1680\u2000-\u200f\u2028-\u202f\u205f\u2060\u3000\ufeff]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]");
    // `using module` and `using assembly` load code while PowerShell parses, so a script with one never reaches the parser.
    static readonly Regex Loads = new(@"(^|[\n;])\s*using\s+(module|assembly)\b", RegexOptions.IgnoreCase);
    static readonly string[] Always = ["dynamic", "dot-source", "obfuscated", "splat", "keyword", "provider-variable", "dynamic-member", "stray", "unc"];

    /// The form text rules are matched against; see `about` in the rules.
    static string Squash(string text)
    {
        string low = text.ToLowerInvariant().Replace("hkey_local_machine", "hklm").Replace("hkey_current_user", "hkcu").Replace('/', '\\');
        var sb = new StringBuilder(low.Length);
        foreach (char c in low)
        {
            if (c is '`' or '\'' or '"' or '+' or ':' or '\ufeff' || char.IsWhiteSpace(c)) continue;
            if (c == '\\' && sb.Length > 0 && sb[^1] == '\\') continue;
            sb.Append(c);
        }
        return sb.ToString();
    }
    static bool Fits(TextRule rule, string flat) => rule.Contains.Any(c => flat.Contains(Squash(c), StringComparison.Ordinal));

    /// The never-list words that fit this text, or null. Reads are only held to the entries about secrets.
    public static string? OnNeverList(string text, string use)
    {
        string flat = Squash(text);
        return R.NeverText.FirstOrDefault(e => (e.Applies == "any" || use != "read") && Fits(e, flat))?.Says;
    }
    public static string? LowersProtection(string text) { string flat = Squash(text); return R.ProtectText.FirstOrDefault(e => Fits(e, flat))?.Says; }
    public static bool NeedsAdmin(string text) { string flat = Squash(text); return R.AdminText.Any(a => flat.Contains(Squash(a), StringComparison.Ordinal)); }

    static bool IsPinned(string name)
    {
        string low = name.ToLowerInvariant();
        if (low.StartsWith('$')) low = low[1..];
        low = Regex.Replace(low, "^(global|script|local|private):", "");
        low = Regex.Replace(low, @"^variable:\\?", "");
        low = Regex.Replace(low, @"^env:\\?", "env:");
        return R.Pinned.Contains(low);
    }

    static string[] Lower(string[]? xs) => xs == null ? [] : Array.ConvertAll(xs, x => x.ToLowerInvariant());
    static List<Arg> Shown(List<Arg> args) => args.Where(a => a.Kind != "block").ToList();

    static bool Matches(Rule m, Call call, bool strict)
    {
        var shown = Shown(call.Args);
        var t = shown.Select(a => a.Text.ToLowerInvariant()).ToList();
        bool unseen = strict && shown.Any(a => a.Kind == "hidden");
        if (m.Piped && !call.Piped) return false;
        if (m.Starts != null)
        {
            var want = Lower(m.Starts);
            for (int k = 0; k < want.Length; k++)
                if (!((k < t.Count && t[k] == want[k]) || (strict && k < shown.Count && shown[k].Kind == "hidden"))) return false;
        }
        if (m.Has != null && !unseen && !t.Any(x => Lower(m.Has).Contains(x))) return false;
        if (m.Prefix != null && !t.Any(x => Lower(m.Prefix).Any(p => x.StartsWith(p, StringComparison.Ordinal)))) return false;
        if (m.Contains != null && !unseen && !t.Any(x => Lower(m.Contains).Any(p => x.Contains(p, StringComparison.Ordinal)))) return false;
        return true;
    }

    /// Null when the arguments fit the read form, else the argument that doesn't.
    static string? OffForm(Form f, List<Arg> args)
    {
        var shown = Shown(args);
        var t = shown.Select(a => a.Text.ToLowerInvariant()).ToList();
        var starts = Lower(f.Starts);
        for (int k = 0; k < starts.Length; k++)
            if (k >= shown.Count || shown[k].Kind == "hidden" || t[k] != starts[k]) return k < shown.Count && shown[k].Text.Length > 0 ? shown[k].Text : "its arguments";
        if (f.Has != null && !Lower(f.Has).Any(t.Contains)) return $"no {f.Has[0]}";
        if (f.Free) return null;
        string[] pars = Lower(f.Params), prefix = Lower(f.Prefix);
        foreach (string x in t.Skip(starts.Length))
        {
            if (!((x.StartsWith('-') || x.StartsWith('/')) && x.Length > 1)) continue;
            string head = x.Split(':')[0];
            if (!pars.Contains(head) && !R.ReadParams.Contains(head) && !prefix.Any(p => x.StartsWith(p, StringComparison.Ordinal))) return x;
        }
        return null;
    }

    static Judged Judge(Call call, string use)
    {
        string raw = call.Name.ToLowerInvariant();
        bool pathed = raw.Contains('\\') || raw.Contains('/');
        string b = raw[(Math.Max(raw.LastIndexOf('\\'), raw.LastIndexOf('/')) + 1)..];
        string typed = call.Name[(call.Name.Length - b.Length)..];
        bool exe = b.EndsWith(".exe", StringComparison.Ordinal) || b.EndsWith(".com", StringComparison.Ordinal);
        if (exe) b = b[..^4];
        if (!pathed && !exe && R.Aliases.TryGetValue(b, out string? full)) b = full;
        var entry = R.Commands.FirstOrDefault(e => e.Name.ToLowerInvariant() == b && (e.Exe || !(pathed || exe)));
        string name = entry?.Name ?? (b == typed.ToLowerInvariant() ? typed : b);
        Judged Stop(string words, string why = "refused") => new(new Found(name, words, 3), false, words, why);
        Judged Construct(string key, string? detail = null, string why = "refused") => Stop($"{R.Constructs[key]} ({detail ?? call.Name}).", why);
        Judged Pass(Outcome o, int tier) => new(new Found(name, $"{name}: {o.Says ?? entry?.Says ?? ""}", tier), use != "read" && (o.Admin ?? entry?.Admin ?? false));
        Judged? Block(Outcome o) => o.Never != null ? Stop($"Rig won't run {name}: it {o.Never}.", "never") : o.Refused != null ? Stop($"Rig won't run {name}: it {o.Refused}.") : null;

        if (b.Contains('.')) return Construct("script-file");
        if (pathed && (raw.Contains("..") || !R.Roots.Known.Any(r => raw.StartsWith(r, StringComparison.Ordinal)))) return Construct("path");
        if (entry == null)
        {
            if (use == "read") return Construct("not-read", name, "notRead");
            if (pathed)
                return R.Roots.Unknown.Any(r => raw.StartsWith(r, StringComparison.Ordinal))
                    ? new Judged(new Found(name, $"{name}: {R.Constructs["unknown-program"]}", 2), true) : Construct("unknown", name);
            int dash = b.IndexOf('-');
            if (dash <= 0 || exe || !R.Verbs.TryGetValue(b[..dash], out int verb)) return Construct("unknown", name);
            return new Judged(new Found(name, $"{name}: {R.VerbSays[verb]}", verb), verb >= 2);
        }
        if (entry.Blocks && call.Args.Any(a => a.Kind is "word" or "hidden")) return Construct("member-by-name", name);
        var rule = entry.When?.FirstOrDefault(w => Matches(w, call, w.Never != null || w.Refused != null || w.Tier == 3));
        if (rule != null && (rule.Never != null || rule.Refused != null)) return Block(rule)!;
        var off = entry.Read != null ? entry.Read.Select(f => OffForm(f, call.Args)).ToList() : ["anything"];
        bool reads = off.Contains(null);
        if (use == "read")
        {
            if (!reads) return Block(entry) ?? Construct("not-read", entry.Read != null ? $"{name} with {off[^1]}" : name, "notRead");
            if (entry.Literal && call.Args.Any(a => a.Kind == "hidden")) return Construct("not-literal", name, "notRead");
            return Pass(new Outcome { Says = entry.Says }, 0);
        }
        if (rule != null) return Pass(rule, rule.Tier ?? 2);
        if (reads) return Pass(new Outcome { Says = entry.Says }, 0);
        return Block(entry) ?? Pass(entry, entry.Tier ?? 2);
    }

    static JsonArray CommandsJson(IEnumerable<Found> found)
    {
        var a = new JsonArray();
        foreach (var f in found) a.Add(new JsonObject { ["name"] = f.Name, ["says"] = f.Says, ["tier"] = f.Tier });
        return a;
    }

    public static JsonObject Refuse(string refused, string why = "refused", JsonArray? commands = null) =>
        new() { ["status"] = "refused", ["why"] = why, ["refused"] = refused, ["commands"] = commands ?? [], ["rulesVersion"] = R.Version };

    public static bool Allowed(JsonObject v) => v["status"]?.GetValue<string>() == "allowed";
    public static int Tier(JsonObject v) => v["tier"]!.GetValue<int>();
    public static bool Admin(JsonObject v) => v["admin"]!.GetValue<bool>();

    /// The verdict on each script, in order. A read is tier 0 or refused; a change is tier 2 or 3 or refused.
    /// `use` is "read", "run" or "undo". The scripts PowerShell has to parse go to it in one run.
    public static JsonObject[] Scripts(IReadOnlyList<(string Script, string Use)> items)
    {
        var verdicts = new JsonObject?[items.Count];
        var toParse = new List<int>();
        for (int i = 0; i < items.Count; i++)
        {
            string s = items[i].Script;
            if (string.IsNullOrWhiteSpace(s)) verdicts[i] = Refuse($"{R.Constructs["empty"]}.");
            else if (s.Length > MaxScript) verdicts[i] = Refuse($"{R.Constructs["too-long"]}.");
            else if (Disguised.IsMatch(s)) verdicts[i] = Refuse($"{R.Constructs["characters"]}.");
            else if (Loads.IsMatch(s)) verdicts[i] = Refuse($"{R.Constructs["keyword"]} (using).");
            else toParse.Add(i);
        }
        if (toParse.Count > 0)
        {
            var parsed = PinnedShell.Parse(toParse.Select(i => items[i].Script).ToList());
            for (int k = 0; k < toParse.Count; k++) verdicts[toParse[k]] = Judge(items[toParse[k]].Script, items[toParse[k]].Use, parsed[k]);
        }
        return verdicts!;
    }

    public static JsonObject Script(string script, string use) => Scripts([(script, use)])[0];

    static JsonObject Judge(string script, string use, JsonObject? parsed)
    {
        if (parsed == null) return Refuse($"{R.Constructs["unreadable"]}: PowerShell's parser didn't answer.");
        if (parsed["error"] is JsonValue err) return Refuse($"{R.Constructs["unreadable"]}: PowerShell says \"{err.GetValue<string>().TrimEnd('.')}\".");
        var calls = (parsed["calls"] as JsonArray ?? []).Select(c => new Call(
            c!["name"]!.GetValue<string>(), c["piped"]!.GetValue<bool>(),
            (c["args"] as JsonArray ?? []).Select(a => new Arg(a!["kind"]!.GetValue<string>(), a["text"]!.GetValue<string>())).ToList())).ToList();
        var finds = (parsed["finds"] as JsonArray ?? []).Select(f => new Find(f!["what"]!.GetValue<string>(), f["detail"]!.GetValue<string>())).ToList();

        var judged = calls.Select(c => Judge(c, use)).ToList();
        var found = judged.Select(j => j.Found).ToList();
        JsonArray Commands() => CommandsJson(found);
        string? never = OnNeverList(script, use) ?? judged.FirstOrDefault(j => j.Stop != null && j.Why == "never")?.Stop;
        if (never != null) return Refuse(never.EndsWith('.') ? never : $"{never}.", "never", Commands());

        var assigned = finds.Where(f => f.What == "assigns").Select(f => f.Detail);
        var named = calls.SelectMany(c => c.Args.Where(a => a.Kind == "word").Select(a => a.Text));
        string? reset = assigned.Concat(named).FirstOrDefault(IsPinned);
        if (reset != null) return Refuse($"{R.Constructs["pinned"]} ({reset}).", "refused", Commands());

        var reasons = new List<string>();
        foreach (var f in finds)
        {
            if (f.What == "assigns") continue;
            string detail = f.Detail.Length > 0 ? $" ({f.Detail})" : "";
            bool fine = use != "read" && ((f.What == "type" && R.SafeTypes.Contains(Regex.Replace(f.Detail, @"^system\.", ""))) || (f.What == "method" && R.SafeMethods.Contains(f.Detail)));
            if (fine) continue;
            if (f.What == "redirect" && use != "read") { reasons.Add($"{R.Constructs["redirect"]}{detail}."); continue; }
            bool looking = use == "read" && !Always.Contains(f.What);
            string words = R.Constructs.TryGetValue(f.What, out string? w) ? w : R.Constructs["stray"];
            return Refuse($"{(looking ? "Rig only looks with plain commands. " : "")}{words}{detail}.", looking ? "notRead" : "refused", Commands());
        }
        var stopped = judged.FirstOrDefault(j => j.Stop != null);
        if (stopped != null) return Refuse(stopped.Stop!, stopped.Why, Commands());

        int top = found.Count == 0 ? 0 : found.Max(c => c.Tier);
        string? lowers = use == "read" ? null : LowersProtection(script);
        int tier = use == "read" ? 0 : lowers != null ? 3 : Math.Max(2, top);
        foreach (var c in found) if (c.Tier == 3) reasons.Add($"{c.Says}. Rig can't promise to put this back.");
        if (lowers != null) reasons.Add($"{lowers}.");
        if (use != "read" && reasons.Count == 0) reasons.Add("A general command, so it needs a second look before it runs.");
        return new JsonObject
        {
            ["status"] = "allowed", ["tier"] = tier, ["admin"] = use != "read" && (judged.Any(j => j.Admin) || NeedsAdmin(script)),
            ["commands"] = Commands(), ["reasons"] = new JsonArray(reasons.Select(r => (JsonNode)r).ToArray()), ["rulesVersion"] = R.Version,
        };
    }

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    /// One touch in the only form Rig keeps, with the text the never list is tested against, or null when it can't be used.
    static (JsonObject Touch, string Text)? Touch(JsonNode? t)
    {
        if (t is not JsonObject x || Str(x["kind"]) is not string kind) return null;
        string? text = kind switch { "registry" => Str(x["key"]), "file" => Str(x["path"]), _ => Str(x["name"]) };
        if (string.IsNullOrWhiteSpace(text) || text.Contains(@"\\")) return null;
        string low = text.ToLowerInvariant();
        switch (kind)
        {
            case "registry":
                if (!low.StartsWith(@"hklm\", StringComparison.Ordinal) && !low.StartsWith(@"hkcu\", StringComparison.Ordinal)) return null;
                string? value = Str(x["value"]);
                var reg = new JsonObject { ["kind"] = kind, ["key"] = text };
                if (value != null) reg["value"] = value;
                return (reg, $@"{text}\{value ?? ""}");
            case "file":
                return Regex.IsMatch(low, @"^[a-z]:\\") ? (new JsonObject { ["kind"] = kind, ["path"] = text }, text) : null;
            case "service" or "task" or "firewall" or "other":
                return (new JsonObject { ["kind"] = kind, ["name"] = text }, text);
            default: return null;
        }
    }

    /// The command in the only form Rig stores, hashes and runs, with the text of each touch, or null when a part is missing or a touch can't be used.
    public static (JsonObject Command, List<string> Touches)? Canonical(JsonNode? node, out bool badTouch)
    {
        badTouch = false;
        var cmd = node as JsonObject;
        string? does = Str(cmd?["does"]), read = Str(cmd?["read"]), run = Str(cmd?["run"]), undo = Str(cmd?["undo"]);
        if (cmd == null || string.IsNullOrWhiteSpace(does) || read == null || run == null || cmd["touches"] is not JsonArray list || (cmd["undo"] != null && undo == null)) return null;
        var touches = list.Select(Touch).ToList();
        if (touches.Any(t => t == null)) { badTouch = true; return null; }
        var canonical = new JsonObject { ["does"] = does, ["read"] = read, ["run"] = run };
        if (undo != null) canonical["undo"] = undo;
        canonical["touches"] = new JsonArray(touches.Select(t => (JsonNode)t!.Value.Touch).ToArray());
        return (canonical, touches.Select(t => t!.Value.Text).ToList());
    }

    /// The verdict on one command, as checkStep gives it, and the command in the form Rig keeps.
    public static (JsonObject Verdict, JsonObject? Command) Command(JsonNode? node, bool tainted)
    {
        var canonical = Canonical(node, out bool badTouch);
        if (canonical == null && !badTouch)
            return (Refuse("This change request is missing a part: it needs a sentence, a read script, a change script and a list of what it changes."), null);
        var given = (JsonObject)node!;
        string? undo = Str(given["undo"]);
        var parts = new List<(string Label, string Script, string Use)> { ("The read script", Str(given["read"])!, "read"), ("The change script", Str(given["run"])!, "run") };
        if (undo != null) parts.Add(("The undo script", undo, "undo"));
        var verdicts = Scripts(parts.Select(p => (p.Script, p.Use)).ToList());
        var commands = new JsonArray();
        foreach (var v in verdicts) foreach (var c in v["commands"]!.AsArray()) commands.Add(c!.DeepClone());
        int stopped = Array.FindIndex(verdicts, v => !Allowed(v) && v["why"]!.GetValue<string>() == "never");
        if (stopped < 0) stopped = Array.FindIndex(verdicts, v => !Allowed(v));
        if (stopped >= 0) return (Refuse($"{parts[stopped].Label} was refused. {verdicts[stopped]["refused"]!.GetValue<string>()}", verdicts[stopped]["why"]!.GetValue<string>(), commands), null);

        if (canonical == null) return (Refuse($"{R.Constructs["touch"]}.", "refused", commands), null);
        var (cmd, touches) = canonical.Value;
        foreach (string t in touches)
            if (OnNeverList(t, "run") is string never) return (Refuse($"{never}.", "never", commands), null);

        int tier = verdicts.Max(Tier);
        var reasons = verdicts.SelectMany(v => v["reasons"]!.AsArray().Select(r => r!.GetValue<string>())).ToList();
        if (touches.Select(LowersProtection).FirstOrDefault(x => x != null) is string lowers) { tier = 3; reasons.Add($"{lowers}."); }
        var kinds = cmd["touches"]!.AsArray().Select(t => t!["kind"]!.GetValue<string>()).ToList();
        if (undo == null && (kinds.Count == 0 || !kinds.All(k => k is "registry" or "file" or "service"))) { tier = 3; reasons.Add($"{R.Constructs["no-undo"]}."); }
        if (tier == 3 && tainted) return (Refuse($"{R.Constructs["tainted"]}.", "tainted", commands), null);
        bool admin = verdicts.Any(Admin) || kinds.Contains("service") || touches.Any(NeedsAdmin);
        var verdict = new JsonObject
        {
            ["status"] = "allowed", ["tier"] = tier, ["admin"] = admin, ["commands"] = commands,
            ["reasons"] = new JsonArray(reasons.Select(r => (JsonNode)r).ToArray()), ["rulesVersion"] = R.Version,
        };
        return (verdict, cmd);
    }

    /// A command's fingerprint, the same as commandHash in packages/core/src/change.ts: SHA-256 over every part, each with its length in front.
    public static string Fingerprint(JsonObject cmd)
    {
        var parts = new List<string> { Str(cmd["does"])!, Str(cmd["read"])!, Str(cmd["run"])!, cmd["undo"] == null ? "-" : "+", Str(cmd["undo"]) ?? "" };
        foreach (var t in cmd["touches"]!.AsArray())
        {
            string kind = Str(t!["kind"])!;
            parts.Add(kind);
            parts.Add(Str(t[kind == "registry" ? "key" : kind == "file" ? "path" : "name"])!);
            parts.Add(Str(t["value"]) is string v ? $"={v}" : "");
        }
        string text = string.Join("\n", parts.Select(p => $"{p.Length}:{p}"));
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    }
}
