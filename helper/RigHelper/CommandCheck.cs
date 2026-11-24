// The helper's side of the command check: the same rules file as
// packages/core/src/check.ts and checkStep in change.ts, applied to what
// PowerShell's own parser found (CommandAst.ps1) instead of to the TypeScript
// reader's tokens. Each function here is the one of the same name there; the
// rules file's `about` says what each test means. The verdicts have the same
// shape, and this one is the one the card shows. Nothing here runs anything:
// the parser's answer comes in as JSON.

using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public sealed record Touch(string Kind, string Text, string? Value)
{
    public bool Snapshotted => Kind is "registry" or "file" or "service";

    /// What the rules test: the key and value, the path or the name.
    public string RuleText => Kind == "registry" ? $@"{Text}\{Value ?? ""}" : Text;

    public JsonObject ToJson()
    {
        var o = new JsonObject { ["kind"] = Kind, [Kind == "registry" ? "key" : Kind == "file" ? "path" : "name"] = Text };
        if (Kind == "registry" && Value != null) o["value"] = Value;
        return o;
    }
}

/// A change request as the helper keeps it: canonicalCommand in change.ts.
public sealed record Command(string Does, string Read, string Run, string? Undo, IReadOnlyList<Touch> Touches)
{
    const string Missing = "This change request is missing a part: it needs a sentence, a read script, a change script and a list of what it changes.";
    static readonly Regex Hive = new(@"^(?:registry::)?(hkey_current_user|hkcu|hkey_local_machine|hklm)(?::\\|:\z|\\|\z)(.*)\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static Command? From(JsonNode? n, out string? problem)
    {
        problem = Missing;
        if (n is not JsonObject o || Str(o["does"]) is not string does || does.Trim().Length == 0 || Str(o["read"]) is not string read || Str(o["run"]) is not string run || o["touches"] is not JsonArray list) return null;
        string? undo = Str(o["undo"]);
        if (o["undo"] != null && undo == null) return null;
        var touches = list.Select(TouchOf).ToList();
        if (touches.Contains(null))
        {
            problem = $"{CommandCheck.Words("touch")}.";
            return null;
        }
        problem = null;
        return new Command(does, read, run, undo, touches!);
    }

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;
    static bool Wild(string text) => text.IndexOfAny(['*', '?', '[']) >= 0;

    /// A touch as Rig stores it, or null when Rig can't use it.
    public static Touch? TouchOf(JsonNode? n)
    {
        if (n is not JsonObject o || Str(o["kind"]) is not string kind) return null;
        string? text = Str(o[kind == "registry" ? "key" : kind == "file" ? "path" : "name"]);
        if (text == null || text.Trim().Length == 0 || text.Contains(@"\\") || text.StartsWith("//") || Wild(text)) return null;
        switch (kind)
        {
            case "registry":
                string? value = Str(o["value"]);
                if (o["value"] != null && (value == null || Wild(value))) return null;
                var m = Hive.Match(text);
                string rest = m.Success ? m.Groups[2].Value.TrimEnd('\\') : "";
                if (rest.Length == 0) return null;
                return new Touch("registry", $@"{(m.Groups[1].Value.ToLowerInvariant() is "hkey_current_user" or "hkcu" ? "HKCU" : "HKLM")}\{rest}", value);
            case "file":
                return Regex.IsMatch(text, @"^[a-zA-Z]:\\") && !Regex.IsMatch(text, @"(^|\\)\.\.(\\|\z)") && !Regex.IsMatch(text, @"[a-zA-Z0-9]~[0-9]") ? new Touch("file", text, null) : null;
            case "service" or "task" or "firewall" or "other":
                return new Touch(kind, text, null);
            default:
                return null;
        }
    }

    public JsonObject ToJson()
    {
        var o = new JsonObject { ["does"] = Does, ["read"] = Read, ["run"] = Run };
        if (Undo != null) o["undo"] = Undo;
        o["touches"] = new JsonArray(Touches.Select(t => (JsonNode)t.ToJson()).ToArray());
        return o;
    }

    /// What an approval is of: every part of the command, each with its length in front so no two commands share one.
    /// packages/core/src/change.ts commandHash gives the same answer.
    public string Hash()
    {
        var parts = new List<string> { "rig-command-1", Does, Read, Run, Undo == null ? "-" : "+" + Undo };
        foreach (var t in Touches) parts.AddRange([t.Kind, t.Text, t.Value == null ? "-" : "+" + t.Value]);
        string text = string.Join("\n", parts.Select(p => $"{p.Length}:{p}"));
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    }
}

/// One command found in a script, and which of the step's scripts it is in.
public sealed record FoundCommand(string Name, string Says, int Tier, string Script);

public sealed record Verdict(bool Allowed, int Tier, bool Admin, string Why, string Refused, IReadOnlyList<FoundCommand> Commands, IReadOnlyList<string> Reasons)
{
    public static Verdict Refuse(string words, string why = "refused", IReadOnlyList<FoundCommand>? commands = null) => new(false, 0, false, why, words, commands ?? [], []);

    public JsonObject ToJson()
    {
        var commands = new JsonArray(Commands.Select(c => (JsonNode)new JsonObject { ["name"] = c.Name, ["says"] = c.Says, ["tier"] = c.Tier, ["script"] = c.Script }).ToArray());
        return Allowed
            ? new JsonObject { ["status"] = "allowed", ["tier"] = Tier, ["admin"] = Admin, ["commands"] = commands, ["reasons"] = new JsonArray(Reasons.Select(r => (JsonNode)r).ToArray()), ["rulesVersion"] = CommandCheck.RulesVersion }
            : new JsonObject { ["status"] = "refused", ["why"] = Why, ["refused"] = Refused, ["commands"] = commands, ["rulesVersion"] = CommandCheck.RulesVersion };
    }

    public static Verdict? From(JsonNode? n)
    {
        if (n is not JsonObject o) return null;
        var commands = (o["commands"] as JsonArray ?? []).Select(c => new FoundCommand(c?["name"]?.ToString() ?? "", c?["says"]?.ToString() ?? "", (int)Json.Num(c?["tier"], 3), c?["script"]?.ToString() ?? "")).ToList();
        return o["status"]?.ToString() == "allowed"
            ? new Verdict(true, (int)Json.Num(o["tier"], 3), o["admin"]?.GetValueKind() == JsonValueKind.True, "", "", commands, (o["reasons"] as JsonArray ?? []).Select(r => r?.ToString() ?? "").ToList())
            : Refuse(o["refused"]?.ToString() ?? "", o["why"]?.ToString() ?? "refused", commands);
    }
}

/// What one change in a script acts on. `none`: something Rig can't name, so no touch can cover it.
public sealed record Write(string Kind, IReadOnlyList<string> Places)
{
    public static readonly Write None = new("none", []);
}

public static class CommandCheck
{
    class Outcome { public string? Says { get; set; } public int? Tier { get; set; } public bool? Admin { get; set; } public string? Never { get; set; } public string? Refused { get; set; } }
    sealed class When : Outcome { public string[]? Starts { get; set; } public string[]? Has { get; set; } public string[]? Prefix { get; set; } public string[]? Contains { get; set; } public bool Piped { get; set; } public string[]? After { get; set; } public string[]? Params { get; set; } }
    sealed class Form { public string[]? Starts { get; set; } public string[]? Has { get; set; } public string[]? Params { get; set; } public string[]? Prefix { get; set; } public bool Free { get; set; } }
    sealed class Targets { public string Kind { get; set; } = "path"; public string[]? Values { get; set; } public string[]? Names { get; set; } public string[]? Renames { get; set; } public bool Leaves { get; set; } public int[]? At { get; set; } public bool Write { get; set; } public bool Places { get; set; } public bool Content { get; set; } }
    sealed class Entry : Outcome { public string Name { get; set; } = ""; public bool Exe { get; set; } public bool Literal { get; set; } public bool Blocks { get; set; } public Form[]? Read { get; set; } public When[]? When { get; set; } public Targets? Targets { get; set; } }
    sealed class TextRule { public string Says { get; set; } = ""; public string[] Contains { get; set; } = []; public string Applies { get; set; } = "change"; }
    sealed class ReadRoot { public string Root { get; set; } = ""; public string[]? Ends { get; set; } }
    sealed class RemoteRule { public string[] Params { get; set; } = []; public string Refused { get; set; } = ""; }
    sealed class RootList { public string[] Known { get; set; } = []; public string[] Unknown { get; set; } = []; }
    sealed class PathRules
    {
        public string[] Literal { get; set; } = [];
        public string LiteralPrefix { get; set; } = "";
        public string[] Values { get; set; } = [];
        public string[] Constants { get; set; } = [];
        public string[] Wildcards { get; set; } = [];
        public string[] Programs { get; set; } = [];
        public string[] ReadKinds { get; set; } = [];
        public ReadRoot[] ReadRoots { get; set; } = [];
        public string System { get; set; } = "";
    }
    sealed class RuleSet
    {
        public int Version { get; set; }
        public int MaxLength { get; set; }
        public string[] Disguised { get; set; } = [];
        public string[] ExeSuffixes { get; set; } = [];
        public string[] Always { get; set; } = [];
        public string[] ReadParams { get; set; } = [];
        public RootList Roots { get; set; } = new();
        public PathRules Paths { get; set; } = new();
        public RemoteRule Remote { get; set; } = new();
        public string[] WriterVerbs { get; set; } = [];
        public string[] AdminText { get; set; } = [];
        public string[] SafeTypes { get; set; } = [];
        public string[] SafeMethods { get; set; } = [];
        public string[] SafeStatics { get; set; } = [];
        public string[] Engine { get; set; } = [];
        public string[] Pinned { get; set; } = [];
        public Dictionary<string, string> Constructs { get; set; } = [];
        public Dictionary<string, int> Verbs { get; set; } = [];
        public string[] VerbSays { get; set; } = [];
        public Dictionary<string, string> Aliases { get; set; } = [];
        public TextRule[] NeverText { get; set; } = [];
        public TextRule[] ProtectText { get; set; } = [];
        public Entry[] Commands { get; set; } = [];
    }

    /// `param`: the parameter's name, folded, when the argument is one (`-Name`, or `-Name:` with its value joined on).
    sealed record Arg(string Kind, string Text, string? Param = null);
    sealed record Call(string Name, List<Arg> Args, bool Piped);
    sealed record Find(string What, string Detail, bool Hidden = false);
    sealed record Target(string Text, string Place, string Kind, bool Hidden, bool Literal);
    /// `Joined`: the places a command's plain names make, held to the text rules like the script itself.
    sealed record Judged(FoundCommand Found, bool Admin, Write? Write = null, string? Stop = null, string StopWhy = "refused", IReadOnlyList<string>? Joined = null);
    /// A plain name a command gives what it makes or renames, which Rig joins to the place it is in.
    sealed record Named(string Text, bool Rename);

    static readonly RuleSet R = JsonSerializer.Deserialize<RuleSet>(Resource("Rig.Rules.commands.json"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    public static int RulesVersion => R.Version;
    public static string Words(string construct) => R.Constructs[construct];

    public static string Resource(string name)
    {
        using var s = typeof(CommandCheck).Assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException($"{name} isn't built into RigHelper.");
        return new StreamReader(s, Encoding.UTF8).ReadToEnd();
    }

    static readonly Regex Disguised = new("[" + string.Concat(R.Disguised.Select(r => string.Join("-", r.Split('-').Select(h => $@"\u{h.PadLeft(4, '0')}")))) + "]");
    // PowerShell's parser loads modules, assemblies and DSC resources for these while it parses, so they never reach it.
    static readonly Regex LoadsWhileParsing = new(@"\busing[\s`]+(module|assembly|namespace)\b|(^|[;{}(|&>])[\s`]*configuration[\s`]|\bImport-DscResource\b", RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.CultureInvariant);
    static readonly Regex SwitchLike = new(@"^(-[a-z]|--[a-z]|/[a-z?])");
    static readonly HashSet<string> Scopes = ["env", "global", "script", "local", "private", "using"];

    /// ASCII-only lower case, as packages/core/src/powershell.ts folds.
    public static string Fold(string text) => string.Create(text.Length, text, (span, t) => { for (int i = 0; i < t.Length; i++) span[i] = t[i] is >= 'A' and <= 'Z' ? (char)(t[i] + 32) : t[i]; });

    /// The form text rules are matched against; see `about` in the rules.
    static string Squash(string text)
    {
        string low = Fold(text).Replace("hkey_local_machine", "hklm").Replace("hkey_current_user", "hkcu").Replace('/', '\\');
        var sb = new StringBuilder(low.Length);
        foreach (char c in low)
        {
            if (c is '`' or '\'' or '"' or '+' or ':' or ' ' or '\t' or '\r' or '\n') continue;
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
    /// A program, script or shortcut by its name's ending, which Rig never writes: programFile in check.ts.
    public static bool ProgramFile(string text) => R.Paths.Programs.Any(p => PlaceOf(text).EndsWith(p, StringComparison.Ordinal));
    /// Whether the text names the current user's part of the registry, however it is written.
    public static bool NamesCurrentUser(string text) => Squash(text).Contains("hkcu", StringComparison.Ordinal);

    /// A path as Rig compares it: placeOf in check.ts.
    public static string PlaceOf(string text)
    {
        string p = Regex.Replace(Fold(text).Replace('/', '\\'), @"\\+", @"\");
        p = Regex.Replace(p, @"^(microsoft\.powershell\.core\\)?(registry|filesystem)::", "");
        p = Regex.Replace(p, @"^hkey_current_user(?=\\|\z)", "hkcu");
        p = Regex.Replace(p, @"^hkey_local_machine(?=\\|\z)", "hklm");
        p = Regex.Replace(p, @"^hkey_classes_root(?=\\|\z)", "hkcr");
        p = Regex.Replace(p, @"^hkey_users(?=\\|\z)", "hku");
        p = Regex.Replace(p, @"^hkey_current_config(?=\\|\z)", "hkcc");
        p = Regex.Replace(p, @"^(hkcu|hklm|hkcr|hku|hkcc):\\?", @"$1\");
        return Regex.Replace(p, @"^(?![a-z]:\\\z)(.+)\\\z", "$1", RegexOptions.Singleline);
    }

    static string KindOf(string place)
    {
        if (Regex.IsMatch(place, @"^(hkcu|hklm|hkcr|hku|hkcc)(\\|\z)")) return "registry";
        if (Regex.IsMatch(place, @"^[a-z]:\\")) return "file";
        if (Regex.IsMatch(place, @"^[a-z][A-Za-z0-9_.-]+:")) return "drive";
        return place.IndexOfAny(['\\', ':']) >= 0 ? "relative" : "name";
    }

    /// The touch covers the place when they are the same or the place is inside it.
    public static bool Covers(string touch, string place) => place == touch || place.StartsWith(touch + @"\", StringComparison.Ordinal);
    static bool Dots(string place) => Regex.IsMatch(place, @"(^|\\)\.\.(\\|\z)");

    static bool Pinned(string name)
    {
        string low = Fold(name);
        if (low.StartsWith('$')) low = low[1..];
        low = Regex.Replace(low, "^(global|script|local|private):", "");
        low = Regex.Replace(low, @"^variable:\\?", "");
        low = Regex.Replace(low, @"^env:\\?", "env:");
        return R.Pinned.Contains(low);
    }

    static List<Arg> Shown(IEnumerable<Arg> args) => args.Where(a => a.Kind != "block").ToList();
    static bool IsParam(Arg a) => a.Kind == "switch" || a.Param != null;
    static string HeadOf(Arg a) => a.Param ?? Fold(a.Text).Split(':')[0];
    static string? InlineOf(Arg a) { string head = HeadOf(a); return a.Text.Length > head.Length ? a.Text[(head.Length + 1)..] : null; }
    static bool Abbreviates(string head, string listed) => head.Length > 1 && (listed.StartsWith(head, StringComparison.Ordinal) || head.StartsWith(listed, StringComparison.Ordinal));
    static string[]? Folded(string[]? xs) => xs?.Select(Fold).ToArray();

    static List<Arg> ValuesAfter(List<Arg> shown, string[] names)
    {
        var o = new List<Arg>();
        for (int k = 0; k < shown.Count; k++)
        {
            var a = shown[k];
            if (!IsParam(a) || !names.Any(p => Abbreviates(HeadOf(a), p))) continue;
            string? inline = InlineOf(a);
            if (!string.IsNullOrEmpty(inline)) o.Add(new Arg("word", inline));
            else if (k + 1 < shown.Count) o.Add(shown[k + 1]);
        }
        return o;
    }

    static bool Matches(When m, Call call, bool strict, bool exe)
    {
        var shown = m.After != null ? ValuesAfter(Shown(call.Args), m.After) : Shown(call.Args);
        var t = shown.Select(a => Fold(a.Text)).ToList();
        bool unseen = strict && shown.Any(a => a.Kind == "hidden");
        string[]? starts = Folded(m.Starts), has = Folded(m.Has), prefix = Folded(m.Prefix), contains = Folded(m.Contains);
        if (m.Piped && !call.Piped) return false;
        if (m.After != null && shown.Count == 0) return false;
        if (starts != null)
            for (int k = 0; k < starts.Length; k++)
                if (!((k < t.Count && t[k] == starts[k]) || (strict && k < shown.Count && shown[k].Kind == "hidden"))) return false;
        if (has != null && !unseen && !t.Any(has.Contains)) return false;
        bool prefixUnseen = unseen && (exe || m.After != null);
        bool FitsPrefix(string x, Arg a) => prefix!.Any(p => x.StartsWith(p, StringComparison.Ordinal) || ((x.StartsWith('-') || x.StartsWith('/')) && Abbreviates(HeadOf(a), p)));
        if (prefix != null && !prefixUnseen && !shown.Where((a, k) => FitsPrefix(t[k], a)).Any()) return false;
        if (contains != null && !unseen && !t.Any(x => contains.Any(p => x.Contains(p, StringComparison.Ordinal)))) return false;
        if (m.Params != null && !FitsParams(m.Params, call.Args, starts?.Length ?? 0)) return false;
        return true;
    }

    /// A positive grammar for a rule that allows: nothing hidden, and every switch after `starts` is listed, written in full.
    static bool FitsParams(string[] ps, List<Arg> args, int skip)
    {
        var shown = Shown(args);
        var listed = Folded(ps)!;
        if (shown.Any(a => a.Kind == "hidden")) return false;
        return shown.Skip(skip).Select(a => Fold(a.Text)).All(x => !((x.StartsWith('-') || x.StartsWith('/')) && x.Length > 1) || listed.Contains(x.Split(':')[0]));
    }

    /// Null when the arguments fit the read form, else the argument that doesn't.
    static string? OffForm(Form f, List<Arg> args)
    {
        var shown = Shown(args);
        var t = shown.Select(a => Fold(a.Text)).ToList();
        string[] starts = Folded(f.Starts) ?? [];
        for (int k = 0; k < starts.Length; k++)
            if (k >= shown.Count || shown[k].Kind == "hidden" || t[k] != starts[k]) return k < shown.Count && shown[k].Text.Length > 0 ? shown[k].Text : "its arguments";
        if (f.Has != null && !f.Has.Any(t.Contains)) return $"no {f.Has[0]}";
        if (f.Free) return shown.Any(a => a.Kind == "hidden") ? "an argument it can't see" : null;
        string[] ps = f.Params ?? [], prefix = f.Prefix ?? [];
        foreach (string x in t.Skip(starts.Length))
        {
            if (!((x.StartsWith('-') || x.StartsWith('/')) && x.Length > 1)) continue;
            string head = x.Split(':')[0];
            if (!ps.Contains(head) && !R.ReadParams.Contains(head) && !prefix.Any(p => x.StartsWith(p, StringComparison.Ordinal))) return x;
        }
        return null;
    }

    static bool LiteralParam(string head) => R.Paths.Literal.Contains(head) || (head.Length > 1 && R.Paths.LiteralPrefix.StartsWith(head, StringComparison.Ordinal));

    static List<Target> TargetsOf(Call call, Targets t, List<Named> named)
    {
        var shown = Shown(call.Args).Where(a => a.Kind == "hidden" || !R.Paths.Constants.Contains(Fold(a.Text))).ToList();
        Target Make(Arg a, bool literal)
        {
            bool hidden = a.Kind == "hidden";
            string place = hidden ? "" : PlaceOf(a.Text);
            return new Target(a.Text, place, hidden ? "name" : KindOf(place), hidden, literal);
        }
        if (t.At != null) return t.At.Where(k => k < shown.Count).Select(k => Make(shown[k], false)).ToList();
        string[] values = t.Values ?? [], names = t.Names ?? [], renames = t.Renames ?? [];
        bool PlainName(Target x) => !x.Hidden && x.Kind == "name" && !R.Paths.Wildcards.Any(w => x.Text.Contains(w, StringComparison.Ordinal))
            && !(t.Places && R.Paths.Programs.Any(p => x.Place.EndsWith(p, StringComparison.Ordinal)));
        var o = new List<Target>();
        for (int k = 0; k < shown.Count; k++)
        {
            var a = shown[k];
            if (!IsParam(a)) { o.Add(Make(a, false)); continue; }
            string head = HeadOf(a);
            string role = LiteralParam(head) ? "literal" : values.Contains(head) || R.Paths.Values.Contains(head) ? "value" : names.Contains(head) || renames.Contains(head) ? "name" : "path";
            void Add(Target x)
            {
                if (role == "literal" || (role == "name" && !PlainName(x))) o.Add(x);
                else if (role == "name") named.Add(new Named(x.Place, renames.Contains(head)));
            }
            string? inline = InlineOf(a);
            if (!string.IsNullOrEmpty(inline))
            {
                if (role == "path") o.Add(Make(new Arg("word", inline), false));
                else Add(Make(new Arg("word", inline), role == "literal"));
                continue;
            }
            if (role == "path" || k + 1 >= shown.Count || IsParam(shown[k + 1])) continue;
            k++;
            Add(Make(shown[k], role == "literal"));
        }
        return o;
    }

    static bool UnderRoot(string place, ReadRoot r)
    {
        var parts = r.Root.Split('\\').Where(p => p.Length > 0).ToArray();
        var have = place.Split('\\');
        if (have.Length <= parts.Length || !parts.Select((p, k) => p == "*" || p == have[k]).All(x => x)) return false;
        return r.Ends == null || r.Ends.Any(e => place.EndsWith(e, StringComparison.Ordinal));
    }

    /// Refuses what the targets of a file, registry or service command can't be, and says what it writes to.
    static (string Key, string Detail, string Why)? CheckTargets(Targets t, Entry entry, Call call, string use, string name, out Write write, out List<string> joined)
    {
        write = Write.None;
        joined = [];
        var named = new List<Named>();
        var targets = TargetsOf(call, t, named);
        var shown = targets.Where(x => !x.Hidden).ToList();
        string At(Target x) => $"{name} {x.Text}";
        if (t.Kind == "service")
        {
            write = targets.Any(x => x.Hidden) ? Write.None : new Write("service", shown.Select(x => x.Place).ToList());
            return null;
        }
        if (shown.FirstOrDefault(x => !x.Literal && R.Paths.Wildcards.Any(w => x.Text.Contains(w, StringComparison.Ordinal))) is Target wild) return ("wildcard", At(wild), "refused");
        if (shown.FirstOrDefault(x => Dots(x.Place)) is Target up) return ("dots", At(up), "refused");
        if (use == "read")
        {
            if (entry.Literal && call.Piped) return ("piped-read", name, "notRead");
            if (shown.FirstOrDefault(x => !R.Paths.ReadKinds.Contains(x.Kind)) is Target odd) return ("read-kind", At(odd), "notRead");
        }
        else if (t.Write)
        {
            if (targets.Any(x => x.Hidden)) return ("not-literal-change", name, "refused");
            if (shown.FirstOrDefault(x => x.Kind is "relative" or "name") is Target loose) return ("relative", At(loose), "refused");
            if (!shown.Any(x => x.Kind is "registry" or "file" or "drive")) return ("full-path", name, "refused");
        }
        if (t.Content)
        {
            var outside = shown.FirstOrDefault(x => x.Kind != "file" || !R.Paths.ReadRoots.Any(r => UnderRoot(x.Place, r)));
            if (outside != null || shown.Count == 0) return ("read-place", outside != null ? At(outside) : name, use == "read" ? "notRead" : "refused");
        }
        if (t.Places && use != "read" && shown.FirstOrDefault(x => R.Paths.Programs.Any(p => x.Place.EndsWith(p, StringComparison.Ordinal))) is Target prog) return ("program-file", At(prog), "refused");
        var places = shown.Where(x => x.Kind is "registry" or "file").Select(x => x.Place).ToList();
        // A plain name is made inside each place, or, for a rename, beside it; a copy or move can land inside the other place under its own last name.
        static string Leaf(string p) => p[(p.LastIndexOf('\\') + 1)..];
        joined = named.SelectMany(n => places.Select(p => $@"{(n.Rename && p.Contains('\\') ? p[..p.LastIndexOf('\\')] : p)}\{n.Text}")).ToList();
        if (t.Leaves) joined.AddRange(places.SelectMany(p => places.Where(q => q != p).Select(q => $@"{p}\{Leaf(q)}")));
        if (!shown.Any(x => x.Kind == "drive")) write = new Write("path", places.Concat(joined).ToList());
        return null;
    }

    /// Refuses what a cmdlet Rig doesn't know by name can't be given in a change: anything hidden, a place with `..`, a wildcard in a full path, and for a writer a program file.
    static (string Key, string Detail)? CheckUnlisted(Call call, string verb, string name)
    {
        var shown = Shown(call.Args);
        if (shown.Any(a => a.Kind == "hidden")) return ("not-literal-change", name);
        var values = shown.SelectMany(a => !IsParam(a) ? [a.Text] : InlineOf(a) is string inline && inline.Length > 0 ? new[] { inline } : []).ToList();
        string At(string v) => $"{name} {v}";
        if (values.FirstOrDefault(v => Dots(PlaceOf(v))) is string up) return ("dots", At(up));
        bool Full(string v) => KindOf(PlaceOf(v)) is "file" or "registry";
        if (values.FirstOrDefault(v => Full(v) && R.Paths.Wildcards.Any(w => v.Contains(w, StringComparison.Ordinal))) is string wild) return ("wildcard", At(wild));
        if (R.WriterVerbs.Contains(verb) && values.FirstOrDefault(v => Full(v) && R.Paths.Programs.Any(p => PlaceOf(v).EndsWith(p, StringComparison.Ordinal))) is string prog) return ("program-file", At(prog));
        return null;
    }

    static Judged Judge(Call call, string use)
    {
        string raw = Fold(call.Name);
        bool pathed = raw.Contains('\\') || raw.Contains('/');
        string b = raw[(Math.Max(raw.LastIndexOf('\\'), raw.LastIndexOf('/')) + 1)..];
        string typed = call.Name[(call.Name.Length - b.Length)..];
        bool exe = R.ExeSuffixes.Any(x => b.EndsWith(x, StringComparison.Ordinal));
        if (exe) b = b[..^4];
        if (!pathed && !exe && R.Aliases.TryGetValue(b, out string? full)) b = full;
        var entry = R.Commands.FirstOrDefault(e => Fold(e.Name) == b && (e.Exe || !(pathed || exe)));
        string name = entry?.Name ?? (b == Fold(typed) ? typed : b);

        FoundCommand Found(string says, int tier) => new(name, says, tier, use);
        Judged Stop(string words, string why = "refused") => new(Found(words, 3), false, null, words, why);
        Judged Construct(string key, string? detail = null, string why = "refused") => Stop($"{R.Constructs[key]} ({detail ?? call.Name}).", why);
        Judged Pass(Outcome o, int tier, Write? write = null) =>
            new(Found($"{name}: {o.Says ?? entry?.Says ?? ""}", tier), use != "read" && (o.Admin ?? entry?.Admin ?? false), tier > 0 ? write ?? Write.None : null);
        Judged? Block(Outcome o) => o.Never != null ? Stop($"Rig won't run {name}: it {o.Never}.", "never") : o.Refused != null ? Stop($"Rig won't run {name}: it {o.Refused}.") : null;

        Judged? remote = !pathed && !exe && entry?.Exe != true && Shown(call.Args).Any(a => IsParam(a) && R.Remote.Params.Any(p => Abbreviates(HeadOf(a), p)))
            ? Stop($"Rig won't run {name}: it {R.Remote.Refused}.") : null;

        if (b.Contains('.')) return Construct("script-file");
        if (pathed && (raw.Contains("..") || !R.Roots.Known.Any(r => raw.StartsWith(r, StringComparison.Ordinal)))) return Construct("path");
        if (entry == null)
        {
            if (remote != null) return remote;
            if (use == "read") return Construct("not-read", name, "notRead");
            if (pathed) return R.Roots.Unknown.Any(r => raw.StartsWith(r, StringComparison.Ordinal)) ? Pass(new Outcome { Says = R.Constructs["unknown-program"], Admin = true }, 2) : Construct("unknown", name);
            int dash = b.IndexOf('-');
            if (dash <= 0 || exe || !R.Verbs.TryGetValue(b[..dash], out int verbTier)) return Construct("unknown", name);
            if (CheckUnlisted(call, b[..dash], name) is var (oddKey, oddDetail)) return Construct(oddKey, oddDetail);
            return new Judged(Found($"{name}: {R.VerbSays[verbTier]}", verbTier), verbTier >= 2, verbTier > 0 ? Write.None : null);
        }
        if (entry.Blocks && call.Args.Any(a => a.Kind is "word" or "hidden")) return Construct("member-by-name", name);
        var rule = entry.When?.FirstOrDefault(w => Matches(w, call, w.Never != null || w.Refused != null || w.Tier == 3, entry.Exe));
        if (rule != null && (rule.Never != null || rule.Refused != null)) return Block(rule)!;
        if (remote != null) return remote;

        var write = Write.None;
        List<string> joined = [];
        if (entry.Targets != null)
        {
            if (CheckTargets(entry.Targets, entry, call, use, name, out write, out joined) is var (key, detail, why)) return Construct(key, detail, why);
        }
        Judged Done(Judged j) => joined.Count > 0 ? j with { Joined = joined } : j;

        var off = entry.Read != null ? entry.Read.Select(f => OffForm(f, call.Args)).ToList() : ["anything"];
        bool reads = off.Contains(null);
        if (use == "read")
        {
            if (!reads) return Block(entry) ?? Construct("not-read", entry.Read != null ? $"{name} with {off[^1]}" : name, "notRead");
            if (entry.Literal && call.Args.Any(a => a.Kind == "hidden")) return Construct("not-literal", name, "notRead");
            return Pass(new Outcome { Says = entry.Says }, 0);
        }
        if (rule != null) return Done(Pass(rule, rule.Tier ?? 2, write));
        if (reads) return Done(Pass(new Outcome { Says = entry.Says }, 0));
        return Block(entry) ?? Done(Pass(entry, entry.Tier ?? 2, write));
    }

    /// Why a script with this find is refused, or null when it may stay. `Reason` is what a change may do but must say.
    static (string? Refuse, string Why, string? Reason)? JudgeFind(Find f, string use)
    {
        string Words(string? key = null, string? detail = null)
        {
            key ??= f.What;
            detail ??= f.Detail;
            return $"{(R.Constructs.TryGetValue(key, out string? w) ? w : R.Constructs["unreadable"])}{(detail.Length > 0 ? $" ({detail})" : "")}.";
        }
        if (f.What == "assigns") return null;
        if (f.What == "variable") return R.Engine.Contains(Regex.Replace(f.Detail, "^(global|script|local|private):", "")) ? (Words("engine", $"${f.Detail}"), "refused", null) : null;
        if (f.What == "static") return R.SafeStatics.Contains(f.Detail) ? null : (Words(), "refused", null);
        if (R.Always.Contains(f.What)) return (Words(), "refused", null);
        if (use != "read")
        {
            if (f.What == "type" && R.SafeTypes.Contains(f.Detail)) return null;
            if (f.What == "method" && R.SafeMethods.Contains(f.Detail)) return null;
            if (f.What == "member-assign") return (null, "", Words());
            if (f.What == "redirect")
            {
                string place = PlaceOf(f.Detail), at = $"> {f.Detail}";
                if (f.Hidden) return (Words("not-literal-change", ">"), "refused", null);
                if (R.Paths.Wildcards.Any(w => f.Detail.Contains(w, StringComparison.Ordinal))) return (Words("wildcard", at), "refused", null);
                if (Dots(place)) return (Words("dots", at), "refused", null);
                if (R.Paths.Programs.Any(p => place.EndsWith(p, StringComparison.Ordinal))) return (Words("program-file", at), "refused", null);
                if (KindOf(place) != "file") return (Words("relative", at), "refused", null);
                return (null, "", Words());
            }
        }
        return ($"Rig only looks with plain commands. {Words()}", "notRead", null);
    }

    /// The reason a general command gets when nothing about it is riskier than that.
    public const string SecondLook = "A general command, so it needs a second look before it runs.";

    /// A program the script itself may have put in place, so not the program Rig looked up.
    static string? WroteProgram(List<Call> calls, List<Judged> judged, List<Find> finds)
    {
        var redirected = finds.Where(f => f.What == "redirect").Select(f => PlaceOf(f.Hidden ? "" : f.Detail)).ToList();
        var changers = calls.Select((c, k) => (Call: c, J: judged[k])).Where(x => x.J.Found.Tier > 0).ToList();
        foreach (var call in calls)
        {
            var others = changers.Where(x => !ReferenceEquals(x.Call, call)).ToList();
            var written = redirected.Concat(others.SelectMany(x => Shown(x.Call.Args).Where(a => a.Kind != "hidden" && a.Text.IndexOfAny(['\\', '/']) >= 0).Select(a => PlaceOf(a.Text)))).ToList();
            string raw = Fold(call.Name);
            string b = Regex.Replace(raw[(Math.Max(raw.LastIndexOf('\\'), raw.LastIndexOf('/')) + 1)..], @"\.(exe|com)\z", "");
            if (raw.IndexOfAny(['\\', '/']) >= 0)
            {
                string prog = PlaceOf(raw), folder = prog[..Math.Max(0, prog.LastIndexOf('\\'))];
                bool blind = others.Any(x => x.J.Write?.Kind == "none" && x.Call.Args.Any(a => a.Kind == "hidden"));
                if (blind || written.Any(w => w == prog || Covers(w, folder) || Covers(folder, w))) return call.Name;
            }
            else if (R.Commands.Any(e => e.Exe && Fold(e.Name) == b))
            {
                if (written.Contains(R.Paths.System) || R.ExeSuffixes.Any(x => written.Any(w => w.EndsWith($@"\{b}{x}", StringComparison.Ordinal)))) return call.Name;
            }
        }
        return null;
    }

    /// What stops a script before the parser sees it, or null.
    public static string? Precheck(string script)
    {
        if (string.IsNullOrWhiteSpace(script)) return $"{R.Constructs["empty"]}.";
        if (script.Length > R.MaxLength) return $"{R.Constructs["too-long"]}.";
        if (Disguised.IsMatch(script)) return $"{R.Constructs["characters"]}.";
        if (LoadsWhileParsing.IsMatch(script)) return $"{R.Constructs["keyword"]} (using, configuration or Import-DscResource).";
        return null;
    }

    static Arg ArgOf(JsonNode? a)
    {
        string kind = a?["k"]?.ToString() ?? "hidden", text = a?["t"]?.ToString() ?? "";
        string? param = a?["p"]?.ToString() is string p && p.Length > 0 ? Fold(p) : null;
        if (param != null) return new Arg(kind == "switch" ? "switch" : "word", Fold(text[..param.Length]) + text[param.Length..], param);
        return kind switch
        {
            "bare" => SwitchLike.IsMatch(Fold(text)) ? new Arg("switch", Fold(text)) : new Arg("word", text),
            "word" or "block" => new Arg(kind, text),
            _ => new Arg("hidden", ""),
        };
    }

    /// The finds packages/core/src/powershell.ts makes for a piece of text: another computer, a provider drive, a short name.
    static IEnumerable<Find> Seen(string text)
    {
        string low = Fold(text), slashed = low.Replace('/', '\\');
        if (Regex.Replace(slashed, @"[a-z][a-z0-9+.-]+:\\\\", m => m.Value.StartsWith("file:", StringComparison.Ordinal) ? m.Value : "").Contains(@"\\", StringComparison.Ordinal)) yield return new Find("unc", text);
        if (Regex.IsMatch(low, @"(^|\\)(alias|function|variable):")) yield return new Find("provider", text);
        if (Regex.IsMatch(low, "[a-z0-9]~[0-9]")) yield return new Find("short-name", text);
    }

    /// The verdict on one script and what each change in it writes to, given what CommandAst.ps1 printed for it.
    public static (Verdict Verdict, List<Write> Writes) InspectScript(string script, string use, JsonNode? parsed)
    {
        (Verdict, List<Write>) Refuse(string words, string why = "refused", IReadOnlyList<FoundCommand>? commands = null) => (Verdict.Refuse(words, why, commands), []);
        if (Precheck(script) is string early) return Refuse(early);
        if (parsed?["errors"] is not JsonArray errors || parsed["calls"] is not JsonArray callNodes || parsed["finds"] is not JsonArray findNodes)
            return Refuse($"{R.Constructs["unreadable"]}: PowerShell's parser gave no answer.");
        if (errors.Count > 0) return Refuse($"{R.Constructs["unreadable"]}: {errors[0]?.ToString().Trim().TrimEnd('.')}.");

        var calls = callNodes.Select(c => new Call(c?["name"]?.ToString() ?? "", (c?["args"] as JsonArray ?? []).Select(ArgOf).ToList(), c?["piped"]?.GetValueKind() == JsonValueKind.True)).ToList();
        var finds = new List<Find>();
        foreach (var f in findNodes)
        {
            string what = f?["what"]?.ToString() ?? "", detail = f?["detail"]?.ToString() ?? "";
            if (what == "variable")
            {
                detail = Fold(detail);
                int colon = detail.IndexOf(':');
                if (colon > 0 && !Scopes.Contains(detail[..colon])) finds.Add(new Find("provider-variable", detail));
            }
            if (what == "assigns") detail = Fold(detail);
            finds.Add(new Find(what, detail, f?["hidden"]?.GetValueKind() == JsonValueKind.True));
        }
        foreach (var s in parsed["strings"] as JsonArray ?? []) finds.AddRange(Seen(s?.ToString() ?? ""));

        var judged = calls.Select(c => Judge(c, use)).ToList();
        var commands = judged.Select(j => j.Found).ToList();
        var texts = judged.SelectMany(j => j.Joined ?? []).Prepend(script).ToList();
        string? never = texts.Select(x => OnNeverList(x, use)).FirstOrDefault(x => x != null) ?? judged.FirstOrDefault(j => j.StopWhy == "never")?.Stop;
        if (never != null) return Refuse(never.EndsWith('.') ? never : $"{never}.", "never", commands);

        var assigned = finds.Where(f => f.What == "assigns").Select(f => f.Detail);
        var named = calls.SelectMany(c => c.Args.Where(a => a.Kind == "word").Select(a => a.Text));
        if (assigned.Concat(named).FirstOrDefault(Pinned) is string reset) return Refuse($"{R.Constructs["pinned"]} ({reset}).", "refused", commands);

        var reasons = new List<string>();
        foreach (var f in finds)
        {
            if (JudgeFind(f, use) is not var (refuse, why, reason)) continue;
            if (refuse != null) return Refuse(refuse, why, commands);
            if (reason != null && !reasons.Contains(reason)) reasons.Add(reason);
        }
        if (judged.FirstOrDefault(j => j.Stop != null) is Judged stopped) return Refuse(stopped.Stop!, stopped.StopWhy, commands);
        if (use != "read" && WroteProgram(calls, judged, finds) is string wrote) return Refuse($"{R.Constructs["wrote-program"]} ({wrote}).", "refused", commands);

        int top = commands.Select(c => c.Tier).DefaultIfEmpty(0).Max();
        string? lowers = use == "read" ? null : texts.Select(LowersProtection).FirstOrDefault(x => x != null);
        int tier = use == "read" ? 0 : lowers != null ? 3 : Math.Max(2, top);
        foreach (var c in commands.Where(c => c.Tier == 3)) reasons.Add($"{c.Says}. Rig can't promise to put this back.");
        if (lowers != null) reasons.Add($"{lowers}.");
        if (use != "read" && reasons.Count == 0) reasons.Add(SecondLook);
        var writes = use == "read" ? [] : judged.Where(j => j.Write != null).Select(j => j.Write!)
            .Concat(finds.Where(f => f.What == "redirect").Select(f => new Write("path", [PlaceOf(f.Detail)]))).ToList();
        return (new Verdict(true, tier, use != "read" && (judged.Any(j => j.Admin) || texts.Any(NeedsAdmin)), "", "", commands, reasons), writes);
    }

    public static Verdict CheckScript(string script, string use, JsonNode? parsed) => InspectScript(script, use, parsed).Verdict;

    static string TouchPlace(Touch t) => t.Kind is "registry" or "file" or "service" ? PlaceOf(t.Text) : "";
    static string TouchKind(Touch t) => t.Kind == "service" ? "service" : "path";

    /// The verdict on a whole change request (checkStep in change.ts) and what its change script writes to.
    /// `parse` gives the parser's answer for each script handed to it, in order. Taint is the server's to judge, not the helper's.
    public static (Verdict Verdict, List<Write> Writes) CheckStep(Command? cmd, string? problem, Func<IReadOnlyList<string>, IReadOnlyList<JsonNode?>> parse)
    {
        if (cmd == null) return (Verdict.Refuse(problem ?? "This change request is missing a part."), []);
        foreach (var t in cmd.Touches)
            if (OnNeverList(t.RuleText, "run") is string never) return (Verdict.Refuse($"{never}.", "never"), []);

        var scripts = new List<(string Label, string Use, string Text)> { ("The read script", "read", cmd.Read), ("The change script", "run", cmd.Run) };
        if (cmd.Undo != null) scripts.Add(("The undo script", "undo", cmd.Undo));
        var toParse = scripts.Where(s => Precheck(s.Text) == null).Select(s => s.Text).Distinct().ToList();
        var answers = toParse.Count > 0 ? parse(toParse) : [];
        JsonNode? AnswerFor(string text) => toParse.IndexOf(text) is int i and >= 0 && i < answers.Count ? answers[i] : null;
        var parts = scripts.Select(s => (s.Label, s.Use, Got: InspectScript(s.Text, s.Use, AnswerFor(s.Text)))).ToList();
        var run = parts[1].Got;

        var commands = parts.SelectMany(p => p.Got.Verdict.Commands).ToList();
        var refused = parts.Where(p => !p.Got.Verdict.Allowed).ToList();
        if (refused.Count > 0)
        {
            var stopped = refused.FirstOrDefault(p => p.Got.Verdict.Why == "never", refused[0]);
            return (Verdict.Refuse($"{stopped.Label} was refused. {stopped.Got.Verdict.Refused}", stopped.Got.Verdict.Why, commands), []);
        }

        int tier = parts.Max(p => p.Got.Verdict.Tier);
        var reasons = parts.SelectMany(p => p.Got.Verdict.Reasons).ToList();
        if (cmd.Touches.Select(t => LowersProtection(t.RuleText)).FirstOrDefault(x => x != null) is string lowers)
        {
            tier = 3;
            reasons.Add($"{lowers}.");
        }
        var held = cmd.Touches.Where(t => t.Snapshotted).ToList();
        bool Covered(Write w) => w.Kind != "none" && w.Places.Count > 0 && w.Places.All(p => held.Any(t => TouchKind(t) == w.Kind && Covers(TouchPlace(t), p)));
        // The touch's own text is Claude's, so the reason counts the unused ones instead of naming them.
        int unused = held.Count(t => !run.Writes.Any(w => w.Kind == TouchKind(t) && w.Places.Any(p => Covers(TouchPlace(t), p) || Covers(p, TouchPlace(t)))));
        if (unused > 0) reasons.Add($"{R.Constructs["unused-touch"]} {(unused == 1 ? "one of them" : $"{unused} of them")}.");
        if (cmd.Undo == null && (cmd.Touches.Count == 0 || held.Count < cmd.Touches.Count || !run.Writes.All(Covered)))
        {
            tier = 3;
            reasons.Add($"{R.Constructs["no-undo"]}.");
        }
        bool admin = parts.Any(p => p.Got.Verdict.Admin) || cmd.Touches.Any(t => t.Kind == "service") || cmd.Touches.Any(t => NeedsAdmin(t.RuleText));
        return (new Verdict(true, tier, admin, "", "", commands, reasons), run.Writes);
    }
}
