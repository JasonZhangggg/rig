// The helper's side of the command check: the same rules file as
// packages/core/src/check.ts, applied to what PowerShell's own parser found
// (CommandAst.ps1) instead of to the TypeScript tokenizer's reading. The
// verdicts have the same shape, and this one is the one the card shows.
// Nothing here runs anything: Check takes the parser's answer as JSON.

using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public sealed record Touch(string Kind, string Text, string? Value)
{
    public bool Snapshotted => Kind is "registry" or "file" or "service";

    public JsonObject ToJson()
    {
        var o = new JsonObject { ["kind"] = Kind, [Kind == "registry" ? "key" : Kind == "file" ? "path" : "name"] = Text };
        if (Kind == "registry" && Value != null) o["value"] = Value;
        return o;
    }
}

/// A change request as the helper keeps it: only the fields it understood.
public sealed record Command(string Does, string Read, string Run, string? Undo, IReadOnlyList<Touch?> Touches)
{
    public static Command? From(JsonNode? n)
    {
        if (n is not JsonObject o || Str(o["does"]) is not string does || Str(o["read"]) is not string read || Str(o["run"]) is not string run) return null;
        if (does.Trim().Length == 0 || o["touches"] is not JsonArray list) return null;
        if (o.ContainsKey("undo") && Str(o["undo"]) == null) return null;
        return new Command(does, read, run, Str(o["undo"]), list.Select(TouchFrom).ToList());
    }

    static Touch? TouchFrom(JsonNode? n)
    {
        if (n is not JsonObject o || Str(o["kind"]) is not string kind) return null;
        string? text = Str(o[kind == "registry" ? "key" : kind == "file" ? "path" : "name"]);
        if (text == null || kind is not ("registry" or "file" or "service" or "task" or "firewall" or "other")) return null;
        return new Touch(kind, text, kind == "registry" ? Str(o["value"]) : null);
    }

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    public JsonObject ToJson()
    {
        var o = new JsonObject { ["does"] = Does, ["read"] = Read, ["run"] = Run };
        if (Undo != null) o["undo"] = Undo;
        o["touches"] = new JsonArray(Touches.Select(t => (JsonNode?)t?.ToJson()).ToArray());
        return o;
    }

    /// What an approval is of: every part of the command, each with its length in front so no two commands share one.
    /// packages/core/src/change.ts commandHash gives the same answer.
    public string Hash()
    {
        var parts = new List<string> { "rig-command-1", Does, Read, Run, Undo == null ? "-" : "+" + Undo };
        foreach (var t in Touches) parts.AddRange([t?.Kind ?? "", t?.Text ?? "", t?.Value == null ? "-" : "+" + t.Value]);
        string text = string.Join("\n", parts.Select(p => $"{p.Length}:{p}"));
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    }
}

public sealed record FoundCommand(string Name, string Says, int Tier);

public sealed record Verdict(bool Allowed, int Tier, bool Admin, string Why, string Refused, IReadOnlyList<FoundCommand> Commands, IReadOnlyList<string> Reasons)
{
    public static Verdict Refuse(string words, string why = "refused", IReadOnlyList<FoundCommand>? commands = null) => new(false, 0, false, why, words, commands ?? [], []);

    public JsonObject ToJson()
    {
        var commands = new JsonArray(Commands.Select(c => (JsonNode)new JsonObject { ["name"] = c.Name, ["says"] = c.Says, ["tier"] = c.Tier }).ToArray());
        return Allowed
            ? new JsonObject { ["status"] = "allowed", ["tier"] = Tier, ["admin"] = Admin, ["commands"] = commands, ["reasons"] = new JsonArray(Reasons.Select(r => (JsonNode)r).ToArray()), ["rulesVersion"] = CommandCheck.RulesVersion }
            : new JsonObject { ["status"] = "refused", ["why"] = Why, ["refused"] = Refused, ["commands"] = commands, ["rulesVersion"] = CommandCheck.RulesVersion };
    }

    public static Verdict? From(JsonNode? n)
    {
        if (n is not JsonObject o) return null;
        var commands = (o["commands"] as JsonArray ?? []).Select(c => new FoundCommand(c?["name"]?.ToString() ?? "", c?["says"]?.ToString() ?? "", (int)Json.Num(c?["tier"], 3))).ToList();
        return o["status"]?.ToString() == "allowed"
            ? new Verdict(true, (int)Json.Num(o["tier"], 3), o["admin"]?.GetValueKind() == JsonValueKind.True, "", "", commands, (o["reasons"] as JsonArray ?? []).Select(r => r?.ToString() ?? "").ToList())
            : Refuse(o["refused"]?.ToString() ?? "", o["why"]?.ToString() ?? "refused", commands);
    }
}

public static class CommandCheck
{
    sealed class Outcome { public string? Says { get; set; } public int? Tier { get; set; } public bool? Admin { get; set; } public string? Never { get; set; } public string? Refused { get; set; } }
    sealed class Match { public string[]? Starts { get; set; } public string[]? Has { get; set; } public string[]? Prefix { get; set; } public string[]? Contains { get; set; } public bool Piped { get; set; }
        public string? Says { get; set; } public int? Tier { get; set; } public bool? Admin { get; set; } public string? Never { get; set; } public string? Refused { get; set; }
        public Outcome Outcome => new() { Says = Says, Tier = Tier, Admin = Admin, Never = Never, Refused = Refused }; }
    sealed class Form { public string[]? Starts { get; set; } public string[]? Has { get; set; } public string[]? Params { get; set; } public string[]? Prefix { get; set; } public bool Free { get; set; } }
    sealed class Entry { public string Name { get; set; } = ""; public bool Exe { get; set; } public bool Literal { get; set; } public bool Blocks { get; set; } public Form[]? Read { get; set; } public Match[]? When { get; set; }
        public string? Says { get; set; } public int? Tier { get; set; } public bool? Admin { get; set; } public string? Never { get; set; } public string? Refused { get; set; }
        public Outcome Outcome => new() { Says = Says, Tier = Tier, Admin = Admin, Never = Never, Refused = Refused }; }
    sealed class TextRule { public string Says { get; set; } = ""; public string[] Contains { get; set; } = []; public string Applies { get; set; } = "change"; }
    sealed class RootList { public string[] Known { get; set; } = []; public string[] Unknown { get; set; } = []; }
    sealed class RuleSet
    {
        public int Version { get; set; }
        public string[] ReadParams { get; set; } = [];
        public RootList Roots { get; set; } = new();
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

    sealed record Arg(string Kind, string Text);
    sealed record Call(string Name, List<Arg> Args, bool Piped);
    sealed record Judged(FoundCommand Found, bool Admin, string? Stop = null, string StopWhy = "refused");

    public const int MaxScriptChars = 20_000;
    static readonly RuleSet R = JsonSerializer.Deserialize<RuleSet>(Resource("Rig.Rules.commands.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    public static int RulesVersion => R.Version;
    public static string Words(string construct) => R.Constructs[construct];

    public static string Resource(string name)
    {
        using var s = typeof(CommandCheck).Assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException($"{name} isn't built into RigHelper.");
        return new StreamReader(s, Encoding.UTF8).ReadToEnd();
    }

    static readonly Regex Disguised = new(@"[\u2018-\u201f\u2013-\u2015\u00a0\u0085\u1680\u2000-\u200f\u2028-\u202f\u205f\u2060\u3000\ufeff]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]");
    // PowerShell's parser loads modules and assemblies for these while it parses, so they never reach it.
    static readonly Regex LoadsWhileParsing = new(@"\busing[\s`]+(module|assembly|namespace)\b|(^|[;{}(|&>])\s*configuration\s|\bImport-DscResource\b", RegexOptions.IgnoreCase | RegexOptions.Multiline);
    static readonly Regex SwitchLike = new(@"^(-[a-z]|--[a-z]|/[a-z?])");
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
    public static string? OnNeverList(string text, string use)
    {
        string flat = Squash(text);
        return R.NeverText.FirstOrDefault(e => (e.Applies == "any" || use != "read") && Fits(e, flat))?.Says;
    }
    public static string? LowersProtection(string text) { string flat = Squash(text); return R.ProtectText.FirstOrDefault(e => Fits(e, flat))?.Says; }
    public static bool NeedsAdmin(string text) { string flat = Squash(text); return R.AdminText.Any(a => flat.Contains(Squash(a), StringComparison.Ordinal)); }

    static bool Pinned(string name)
    {
        string low = name.ToLowerInvariant();
        if (low.StartsWith('$')) low = low[1..];
        low = Regex.Replace(low, "^(global|script|local|private):", "");
        low = Regex.Replace(low, @"^variable:\\?", "");
        low = Regex.Replace(low, @"^env:\\?", "env:");
        return R.Pinned.Contains(low);
    }

    static List<Arg> Shown(Call c) => c.Args.Where(a => a.Kind != "block").ToList();
    static bool In(string[] list, string x) => list.Any(l => l.Equals(x, StringComparison.OrdinalIgnoreCase));

    static bool Matches(Match m, Call call, bool strict)
    {
        var shown = Shown(call);
        var t = shown.Select(a => a.Text.ToLowerInvariant()).ToList();
        bool unseen = strict && shown.Any(a => a.Kind == "hidden");
        if (m.Piped && !call.Piped) return false;
        if (m.Starts != null)
            for (int k = 0; k < m.Starts.Length; k++)
                if (!((k < t.Count && t[k] == m.Starts[k].ToLowerInvariant()) || (strict && k < shown.Count && shown[k].Kind == "hidden"))) return false;
        if (m.Has != null && !unseen && !t.Any(x => In(m.Has, x))) return false;
        if (m.Prefix != null && !t.Any(x => m.Prefix.Any(p => x.StartsWith(p.ToLowerInvariant(), StringComparison.Ordinal)))) return false;
        if (m.Contains != null && !unseen && !t.Any(x => m.Contains.Any(p => x.Contains(p.ToLowerInvariant(), StringComparison.Ordinal)))) return false;
        return true;
    }

    /// Null when the arguments fit the read form, else the argument that doesn't.
    static string? OffForm(Form f, Call call)
    {
        var shown = Shown(call);
        var t = shown.Select(a => a.Text.ToLowerInvariant()).ToList();
        string[] starts = f.Starts ?? [];
        for (int k = 0; k < starts.Length; k++)
            if (k >= shown.Count || shown[k].Kind == "hidden" || t[k] != starts[k].ToLowerInvariant()) return k < shown.Count && shown[k].Text.Length > 0 ? shown[k].Text : "its arguments";
        if (f.Has != null && !f.Has.Any(h => t.Contains(h.ToLowerInvariant()))) return $"no {f.Has[0]}";
        if (f.Free) return null;
        foreach (string x in t.Skip(starts.Length))
        {
            if (!((x.StartsWith('-') || x.StartsWith('/')) && x.Length > 1)) continue;
            string head = x.Split(':')[0];
            if (!In(f.Params ?? [], head) && !In(R.ReadParams, head) && !(f.Prefix ?? []).Any(p => x.StartsWith(p.ToLowerInvariant(), StringComparison.Ordinal))) return x;
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

        Judged Stop(string words, string why = "refused") => new(new FoundCommand(name, words, 3), false, words, why);
        Judged Construct(string key, string? detail = null, string why = "refused") => Stop($"{R.Constructs[key]} ({detail ?? call.Name}).", why);
        Judged Pass(Outcome o, int tier) => new(new FoundCommand(name, $"{name}: {o.Says ?? entry?.Says ?? ""}", tier), use != "read" && (o.Admin ?? entry?.Admin ?? false));
        Judged? Block(Outcome o) => o.Never != null ? Stop($"Rig won't run {name}: it {o.Never}.", "never") : o.Refused != null ? Stop($"Rig won't run {name}: it {o.Refused}.") : null;

        if (b.Contains('.')) return Construct("script-file");
        if (pathed && (raw.Contains("..") || !R.Roots.Known.Any(r => raw.StartsWith(r, StringComparison.Ordinal)))) return Construct("path");
        if (entry == null)
        {
            if (use == "read") return Construct("not-read", name, "notRead");
            if (pathed)
                return R.Roots.Unknown.Any(r => raw.StartsWith(r, StringComparison.Ordinal))
                    ? new Judged(new FoundCommand(name, $"{name}: {R.Constructs["unknown-program"]}", 2), true)
                    : Construct("unknown", name);
            int dash = b.IndexOf('-');
            if (dash <= 0 || exe || !R.Verbs.TryGetValue(b[..dash], out int verbTier)) return Construct("unknown", name);
            return new Judged(new FoundCommand(name, $"{name}: {R.VerbSays[verbTier]}", verbTier), verbTier >= 2);
        }
        if (entry.Blocks && call.Args.Any(a => a.Kind is "word" or "hidden")) return Construct("member-by-name", name);
        var rule = entry.When?.FirstOrDefault(w => Matches(w, call, w.Never != null || w.Refused != null || w.Tier == 3));
        if (rule != null && (rule.Never != null || rule.Refused != null)) return Block(rule.Outcome)!;
        var off = entry.Read != null ? entry.Read.Select(f => OffForm(f, call)).ToList() : ["anything"];
        bool reads = off.Contains(null);
        var looks = new Outcome { Says = entry.Says };
        if (use == "read")
        {
            if (!reads) return Block(entry.Outcome) ?? Construct("not-read", entry.Read != null ? $"{name} with {off[^1]}" : name, "notRead");
            if (entry.Literal && call.Args.Any(a => a.Kind == "hidden")) return Construct("not-literal", name, "notRead");
            return Pass(looks, 0);
        }
        if (rule != null) return Pass(rule.Outcome, rule.Tier ?? 2);
        if (reads) return Pass(looks, 0);
        return Block(entry.Outcome) ?? Pass(entry.Outcome, entry.Tier ?? 2);
    }

    /// What stops a script before the parser sees it, or null.
    public static string? Precheck(string script)
    {
        if (string.IsNullOrWhiteSpace(script)) return $"{R.Constructs["empty"]}.";
        if (script.Length > MaxScriptChars) return $"{R.Constructs["too-long"]}.";
        if (Disguised.IsMatch(script)) return $"{R.Constructs["characters"]}.";
        if (LoadsWhileParsing.IsMatch(script)) return $"{R.Constructs["keyword"]} (using).";
        return null;
    }

    /// The verdict on one script, given what CommandAst.ps1 printed for it. A read is tier 0 or refused; a change is tier 2 or 3 or refused.
    public static Verdict CheckScript(string script, string use, JsonNode? parsed)
    {
        if (Precheck(script) is string early) return Verdict.Refuse(early);
        if (parsed?["errors"] is not JsonArray errors || parsed["calls"] is not JsonArray callNodes || parsed["finds"] is not JsonArray findNodes)
            return Verdict.Refuse($"{R.Constructs["unreadable"]}: PowerShell's parser gave no answer.");
        if (errors.Count > 0) return Verdict.Refuse($"{R.Constructs["unreadable"]}: {errors[0]?.ToString().TrimEnd('.')}.");

        var calls = callNodes.Select(c => new Call(c?["name"]?.ToString() ?? "", (c?["args"] as JsonArray ?? []).Select(ArgFrom).ToList(), c?["piped"]?.GetValueKind() == JsonValueKind.True)).ToList();
        var finds = findNodes.Select(f => (What: f?["what"]?.ToString() ?? "", Detail: f?["detail"]?.ToString() ?? "")).ToList();
        var judged = calls.Select(c => Judge(c, use)).ToList();
        var commands = judged.Select(j => j.Found).ToList();
        string? never = OnNeverList(script, use) ?? judged.FirstOrDefault(j => j.StopWhy == "never")?.Stop;
        if (never != null) return Verdict.Refuse(never.EndsWith('.') ? never : $"{never}.", "never", commands);

        var assigned = finds.Where(f => f.What == "assigns").Select(f => f.Detail);
        var named = calls.SelectMany(c => c.Args.Where(a => a.Kind == "word").Select(a => a.Text));
        if (assigned.Concat(named).FirstOrDefault(Pinned) is string reset) return Verdict.Refuse($"{R.Constructs["pinned"]} ({reset}).", "refused", commands);

        var reasons = new List<string>();
        foreach (var f in finds)
        {
            if (f.What == "assigns") continue;
            string detail = f.Detail.Length > 0 ? $" ({f.Detail})" : "";
            bool fine = use != "read" && ((f.What == "type" && R.SafeTypes.Contains(Regex.Replace(f.Detail, @"^system\.", ""))) || (f.What == "method" && R.SafeMethods.Contains(f.Detail)));
            if (fine) continue;
            if (f.What == "redirect" && use != "read") { reasons.Add($"{R.Constructs["redirect"]}{detail}."); continue; }
            bool looking = use == "read" && !Always.Contains(f.What);
            string words = R.Constructs.TryGetValue(f.What, out string? w) ? w : R.Constructs["keyword"];
            return Verdict.Refuse($"{(looking ? "Rig only looks with plain commands. " : "")}{words}{detail}.", looking ? "notRead" : "refused", commands);
        }
        if (judged.FirstOrDefault(j => j.Stop != null) is Judged stopped) return Verdict.Refuse(stopped.Stop!, stopped.StopWhy, commands);

        int top = commands.Select(c => c.Tier).DefaultIfEmpty(0).Max();
        string? lowers = use == "read" ? null : LowersProtection(script);
        int tier = use == "read" ? 0 : lowers != null ? 3 : Math.Max(2, top);
        foreach (var c in commands.Where(c => c.Tier == 3)) reasons.Add($"{c.Says}. Rig can't promise to put this back.");
        if (lowers != null) reasons.Add($"{lowers}.");
        if (use != "read" && reasons.Count == 0) reasons.Add("A general command, so it needs a second look before it runs.");
        return new Verdict(true, tier, use != "read" && (judged.Any(j => j.Admin) || NeedsAdmin(script)), "", "", commands, reasons);
    }

    static Arg ArgFrom(JsonNode? a)
    {
        string kind = a?["k"]?.ToString() ?? "hidden", text = a?["t"]?.ToString() ?? "";
        if (kind == "word" && a?["b"]?.GetValueKind() == JsonValueKind.True) return new Arg(SwitchLike.IsMatch(text.ToLowerInvariant()) ? "switch" : "word", text);
        return new Arg(kind is "switch" or "word" or "block" ? kind : "hidden", text);
    }

    /// The text of a touch that the rules are tested against, or null when it isn't one Rig can use.
    public static string? TouchText(Touch? t)
    {
        if (t == null || t.Text.Trim().Length == 0 || t.Text.Contains(@"\\")) return null;
        string low = t.Text.ToLowerInvariant();
        return t.Kind switch
        {
            "registry" => low.StartsWith(@"hklm\") || low.StartsWith(@"hkcu\") ? $@"{t.Text}\{t.Value ?? ""}" : null,
            "file" => low.Length > 2 && low[0] is >= 'a' and <= 'z' && low[1] == ':' && low[2] == '\\' ? t.Text : null,
            _ => t.Text,
        };
    }

    /// The verdict on a whole change request. `parse` gives the parser's answer for each script handed to it, in order.
    public static Verdict CheckStep(Command? cmd, bool tainted, Func<IReadOnlyList<string>, IReadOnlyList<JsonNode?>> parse)
    {
        if (cmd == null) return Verdict.Refuse("This change request is missing a part: it needs a sentence, a read script, a change script and a list of what it changes.");
        var scripts = new List<(string Label, string Use, string Text)> { ("The read script", "read", cmd.Read), ("The change script", "run", cmd.Run) };
        if (cmd.Undo != null) scripts.Add(("The undo script", "undo", cmd.Undo));
        var toParse = scripts.Where(s => Precheck(s.Text) == null).Select(s => s.Text).ToList();
        var answers = toParse.Count > 0 ? parse(toParse) : [];
        var parts = scripts.Select(s => (s.Label, Verdict: CheckScript(s.Text, s.Use, toParse.IndexOf(s.Text) is int i and >= 0 && i < answers.Count ? answers[i] : null))).ToList();

        var commands = parts.SelectMany(p => p.Verdict.Commands).ToList();
        var refused = parts.Where(p => !p.Verdict.Allowed).ToList();
        if (refused.Count > 0)
        {
            var stopped = refused.FirstOrDefault(p => p.Verdict.Why == "never", refused[0]);
            return Verdict.Refuse($"{stopped.Label} was refused. {stopped.Verdict.Refused}", stopped.Verdict.Why, commands);
        }

        var touches = cmd.Touches.Select(TouchText).ToList();
        if (touches.Contains(null)) return Verdict.Refuse($"{R.Constructs["touch"]}.", "refused", commands);
        foreach (string? t in touches)
            if (OnNeverList(t!, "run") is string never) return Verdict.Refuse($"{never}.", "never", commands);

        int tier = parts.Max(p => p.Verdict.Tier);
        var reasons = parts.SelectMany(p => p.Verdict.Reasons).ToList();
        if (touches.Select(t => LowersProtection(t!)).FirstOrDefault(x => x != null) is string lowers) { tier = 3; reasons.Add($"{lowers}."); }
        if (cmd.Undo == null && (cmd.Touches.Count == 0 || !cmd.Touches.All(t => t!.Snapshotted))) { tier = 3; reasons.Add($"{R.Constructs["no-undo"]}."); }
        if (tier == 3 && tainted) return Verdict.Refuse($"{R.Constructs["tainted"]}.", "tainted", commands);
        bool admin = parts.Any(p => p.Verdict.Admin) || cmd.Touches.Any(t => t!.Kind == "service") || touches.Any(t => NeedsAdmin(t!));
        return new Verdict(true, tier, admin, "", "", commands, reasons);
    }
}
