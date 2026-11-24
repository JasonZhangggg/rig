// The fileEdit native op: changes values in a program's or game's own
// settings file, JSON or INI, and nothing else in it. fileEditRule in
// packages/core/src/fileEdit.ts makes the same check.
//
// The worker reads the file as the person, finds each value's text with a
// small reader of its own (JSON with // and /* */ comments and trailing
// commas; INI key=value lines under [sections] with ; and # comments), and
// replaces only that text, so every other byte stays as it was: the same
// encoding, quoting and line endings. It writes a new copy beside the file
// and swaps it in. The file is the op's touch, so the helper snapshots it
// first and undo puts the copy back; the op's own undo only puts back its own
// edits when the file is exactly as the op left it.

using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

sealed class FileEditOp : INativeStep
{
    public const int MaxBytes = 1 << 20, MaxEdits = 20, MaxDepth = 16, MaxSegment = 200, MaxValue = 1000, MaxDoes = 300;
    const int ShownChars = 120, DiffLineChars = 160, DiffLines = 60;
    const string Hidden = "A key or value can't hold hidden characters that change how its text reads on the card.";
    static readonly Regex JsonNumber = new(@"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?\z");
    static readonly Regex OwnFile = new(@"^[a-z]:\\users\\(?!(public|default|default user|all users)\\)[^\\]+\\.");

    public string Name => "fileEdit";

    // ----- The check: canonicalFileEdit in fileEdit.ts -----

    static string Fold(string s) => string.Concat(s.Select(c => c is >= 'A' and <= 'Z' ? (char)(c + 32) : c));
    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    static JsonNode? Value(JsonObject e, bool ini)
    {
        var v = e["value"];
        if (v is JsonObject o)
        {
            if (o.Count == 1 && Str(o["number"]) is string n && n.Length <= 40 && JsonNumber.IsMatch(n)) return new JsonObject { ["number"] = n };
            throw new RigException("{ number } must hold a number written as JSON writes it, such as 0.85.");
        }
        switch (v?.GetValueKind())
        {
            case JsonValueKind.String:
                string s = v.GetValue<string>();
                if (s.Length > MaxValue) throw new RigException($"A value can be at most {MaxValue} characters.");
                if (CommandCheck.FileEditRefuses(s, "hidden")) throw new RigException(Hidden);
                if (ini && CommandCheck.FileEditRefuses(s, "iniValue")) throw new RigException("A value in an INI file is one line of plain text, with no line breaks or control characters.");
                return s;
            case JsonValueKind.Number:
                string text = v.ToJsonString();
                if (Regex.IsMatch(text, @"^-?[0-9]{1,16}\z") && long.TryParse(text, CultureInfo.InvariantCulture, out long whole) && Math.Abs(whole) <= 9007199254740991) return whole;
                throw new RigException("A number with a fraction goes in as { number: \"0.85\" }.");
            case null or JsonValueKind.Null or JsonValueKind.True or JsonValueKind.False:
                if (ini) throw new RigException("A value in an INI file is text or a number: write it the way the file does, such as 1 or True.");
                return v?.DeepClone();
            default:
                throw new RigException("A value is text, a number, true, false or null.");
        }
    }

    static JsonObject Edit(JsonNode? raw, bool ini)
    {
        var e = raw as JsonObject ?? [];
        if (e["at"] is not JsonArray list || list.Count == 0 || list.Count > MaxDepth || list.Any(s => Str(s) is not string t || t.Length > MaxSegment || CommandCheck.FileEditRefuses(t, "at")))
            throw new RigException($"Each edit's at is a list of 1 to {MaxDepth} keys, each one line of text.");
        var at = list.Select(s => Str(s)!).ToList();
        if (at.Any(s => CommandCheck.FileEditRefuses(s, "hidden"))) throw new RigException(Hidden);
        if (ini)
        {
            if (at.Count != 2 || at[0].Contains(']')) throw new RigException("In an INI file, at is [section, key], with \"\" for keys above the first section.");
            string key = at[1];
            if (key.Length == 0 || key.StartsWith(' ') || key.EndsWith(' ') || key.Contains('=') || key[0] is ';' or '#' or '[')
                throw new RigException("An INI key is its name as written before =, with no spaces around it.");
        }
        else if (at.Any(s => s.Length == 0)) throw new RigException("A JSON key in at can't be empty.");
        if (!e.ContainsKey("value")) throw new RigException("Each edit needs the value to set.");
        var kept = new JsonObject { ["at"] = new JsonArray(at.Select(s => (JsonNode)s).ToArray()), ["value"] = Value(e, ini) };
        if (e["add"]?.GetValueKind() == JsonValueKind.True) kept["add"] = true;
        return kept;
    }

    public NativeCheck Check(JsonObject op)
    {
        if (Str(op["does"]) is not string does || does.Trim().Length == 0 || does.Length > MaxDoes) throw new RigException("A file edit needs one plain sentence on what it does.");
        if (Str(op["path"]) is not string path || Command.TouchOf(new JsonObject { ["kind"] = "file", ["path"] = path }) == null || path.IndexOf(':', 2) >= 0)
            throw new RigException(@"A file edit needs the file's full path, such as C:\Users\you\AppData\Roaming\Game\settings.json.");
        if (CommandCheck.ProgramFile(path)) throw new RigException("Rig doesn't edit programs, scripts or shortcuts, only settings files.");
        if (Str(op["format"]) is not ("json" or "ini")) throw new RigException("A file edit's format is \"json\" or \"ini\" (use \"ini\" for .cfg files written as key=value lines).");
        bool ini = Str(op["format"]) == "ini";
        var (formats, ends) = CommandCheck.FileEditFormats(path);
        if (formats.Count == 0) throw new RigException($"Rig only edits settings files whose names end in {string.Join(", ", ends)}.");
        if (!formats.Contains(ini ? "ini" : "json")) throw new RigException($"A file with this name's ending is edited with format \"{string.Join("\" or \"", formats)}\".");
        if (op["edits"] is not JsonArray edits || edits.Count == 0 || edits.Count > MaxEdits) throw new RigException($"A file edit changes 1 to {MaxEdits} values.");
        var kept = new JsonArray();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var raw in edits)
        {
            var e = Edit(raw, ini);
            if (!seen.Add(string.Join('\0', At(e).Select(s => ini ? Fold(s) : s)))) throw new RigException("A file edit names the same value twice.");
            kept.Add(e);
        }
        bool adds = kept.Any(e => e?["add"] != null), own = OwnFile.IsMatch(CommandCheck.PlaceOf(path));
        string? tool = CommandCheck.FileEditPathRule(path, "tier3");
        var reasons = new List<string>();
        if (tool != null) reasons.Add($"{tool}.");
        reasons.Add("Rig changes only the text of the values listed and saves a copy of the file first, so undo puts it back.");
        if (adds) reasons.Add("It adds a key the file may not have yet, which the program may not expect.");
        if (!own) reasons.Add("The file isn't in your own folders, so the change may reach everyone on this PC. Rig makes it with your own rights.");
        var op2 = new JsonObject { ["name"] = Name, ["does"] = does, ["path"] = path, ["format"] = ini ? "ini" : "json", ["edits"] = kept };
        return new NativeCheck(op2, tool != null ? 3 : own && !adds ? 1 : 2, reasons, [new Touch("file", path, null)], Never: CommandCheck.FileEditPathRule(path, "never"));
    }

    static List<string> At(JsonNode? e) => e!["at"]!.AsArray().Select(s => s!.GetValue<string>()).ToList();
    /// How a value's place is named on the card: atLabel in fileEdit.ts.
    static string Label(List<string> at) => string.Join(" › ", at.Select(s => s.Length == 0 ? "(top)" : s));

    // ----- The file -----

    /// The file's text, and how to write it back the same way.
    sealed record Loaded(byte[] Bytes, string Text, Encoding Encoding, int Preamble, string Eol)
    {
        public byte[] Encode(string text)
        {
            byte[] body;
            try { body = Encoding.GetBytes(text); }
            catch (EncoderFallbackException) { throw new RigException("The new value has characters this file's encoding can't hold."); }
            return [.. Bytes.AsSpan(0, Preamble), .. body];
        }
    }

    static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    static Loaded Load(string path)
    {
        string name = Path.GetFileName(path);
        if (Directory.Exists(path)) throw new RigException($"{path} is a folder, not a settings file.");
        var info = new FileInfo(path);
        if (!info.Exists) throw new RigException($"Rig didn't find {path}. It only changes a settings file that is already there.");
        if (info.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new RigException($"{name} is a link to another file, so Rig left it as it is.");
        if (info.Length > MaxBytes) throw new RigException($"{name} is over 1 MB, which is more than Rig edits.");
        byte[] bytes;
        try { bytes = File.ReadAllBytes(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { throw new RigException($"Windows wouldn't let Rig read {name} as you."); }
        if (bytes.Length > MaxBytes) throw new RigException($"{name} is over 1 MB, which is more than Rig edits.");
        (Encoding enc, int pre) = bytes switch
        {
            [0xEF, 0xBB, 0xBF, ..] => ((Encoding)new UTF8Encoding(false, true), 3),
            [0xFF, 0xFE, 0, 0, ..] => throw new RigException($"{name} isn't written as UTF-8 or UTF-16, so Rig can't edit it safely."),
            [0xFF, 0xFE, ..] => (new UnicodeEncoding(false, false, true), 2),
            [0xFE, 0xFF, ..] => (new UnicodeEncoding(true, false, true), 2),
            _ => (new UTF8Encoding(false, true), 0),
        };
        string text;
        try { text = enc.GetString(bytes, pre, bytes.Length - pre); }
        catch (DecoderFallbackException) { throw new RigException($"{name} isn't written as UTF-8 or UTF-16, so Rig can't edit it safely."); }
        // A zero character means a file in another encoding, or not text at all. Text that wouldn't write back to the same bytes can't be edited in place.
        if (text.Contains('\0') || !enc.GetBytes(text).AsSpan().SequenceEqual(bytes.AsSpan(pre))) throw new RigException($"{name} isn't plain text Rig can edit safely.");
        int nl = text.IndexOf('\n');
        return new Loaded(bytes, text, enc, pre, nl > 0 && text[nl - 1] == '\r' ? "\r\n" : "\n");
    }

    /// One change to the text: replace [Start, End) with Text.
    sealed record Splice(int Start, int End, string Text);

    /// Where one edit's value is now, shown as written (null when it isn't there), and the splice that sets it.
    sealed record Planned(string? Now, Splice Splice);

    static Planned Plan(string text, string eol, bool ini, JsonObject edit, string name) =>
        ini ? IniFile.Plan(text, eol, At(edit), edit["value"], edit["add"] != null, name) : JsonFile.Plan(text, eol, At(edit), edit["value"], edit["add"] != null, name);

    /// Each edit planned on the text the edits before it left, and the text after all of them.
    static (List<Planned> Plans, string After) PlanAll(JsonObject op, Loaded file)
    {
        bool ini = op["format"]?.ToString() == "ini";
        string name = Path.GetFileName(op["path"]!.GetValue<string>()), text = file.Text;
        var plans = new List<Planned>();
        foreach (var e in op["edits"]!.AsArray())
        {
            var p = Plan(text, file.Eol, ini, e!.AsObject(), name);
            plans.Add(p);
            text = string.Concat(text.AsSpan(0, p.Splice.Start), p.Splice.Text, text.AsSpan(p.Splice.End));
        }
        return (plans, text);
    }

    static string Clip(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";

    /// The values now, one line per edit, the file's fingerprint, and the lines the edits would change.
    public string Preview(JsonObject op)
    {
        var file = Load(op["path"]!.GetValue<string>());
        var (plans, after) = PlanAll(op, file);
        var lines = op["edits"]!.AsArray().Select((e, i) => $"{Label(At(e))}: {(plans[i].Now is string now ? Clip(now, ShownChars) : "Not there")}").ToList();
        lines.Add($"File fingerprint {Hash(file.Bytes)[..12]}, {file.Bytes.Length:N0} bytes");
        var diff = Diff(file.Text, after);
        if (diff.Count > 0) lines.AddRange(["", .. diff]);
        return string.Join("\n", lines);
    }

    public JsonObject Apply(JsonObject op)
    {
        string path = op["path"]!.GetValue<string>();
        var file = Load(path);
        var (_, after) = PlanAll(op, file);
        byte[] bytes = file.Encode(after);
        if (after != file.Text) Replace(path, bytes, file.Bytes);
        // What puts the edits back on the file exactly as this left it: the old text of each changed region, last first.
        var back = new JsonArray();
        foreach (var (start, end, old, _) in Regions(file.Text, after)) back.Add(new JsonObject { ["start"] = start, ["end"] = end, ["text"] = old });
        return new JsonObject { ["before"] = Hash(file.Bytes), ["after"] = Hash(bytes), ["regions"] = back };
    }

    public string? Verify(JsonObject op)
    {
        var file = Load(op["path"]!.GetValue<string>());
        var (plans, after) = PlanAll(op, file);
        if (after == file.Text) return null;
        var off = op["edits"]!.AsArray().Select((e, i) => (e, p: plans[i])).Where(x => x.p.Splice.Text != file.Text[x.p.Splice.Start..x.p.Splice.End]).ToList();
        return off.Count == 0 ? null : string.Join("; ", off.Select(x => $"{Label(At(x.e))} reads {(x.p.Now is string now ? Clip(now, ShownChars) : "nothing")}")) + ".";
    }

    public void Undo(JsonObject op, JsonObject back)
    {
        string path = op["path"]!.GetValue<string>();
        var file = Load(path);
        string now = Hash(file.Bytes);
        // The helper puts its own copy back first, so the file is usually already as it was.
        if (now == back["before"]?.ToString()) return;
        if (now != back["after"]?.ToString()) throw new RigException($"{Path.GetFileName(path)} has changed since Rig edited it, so Rig left it as it is.");
        string text = file.Text;
        foreach (var r in (back["regions"] as JsonArray ?? []).Reverse())
        {
            int start = (int)Json.Num(r?["start"], -1), end = (int)Json.Num(r?["end"], -1);
            if (start < 0 || end < start || end > text.Length || r?["text"]?.ToString() is not string old) throw new RigException("Rig's note of how to put this file back is damaged.");
            text = string.Concat(text.AsSpan(0, start), old, text.AsSpan(end));
        }
        byte[] bytes = file.Encode(text);
        if (Hash(bytes) != back["before"]?.ToString()) throw new RigException("Rig's note of how to put this file back doesn't give the file as it was.");
        Replace(path, bytes, file.Bytes);
    }

    /// Writes the new copy beside the file and swaps it in, so a program never reads half a file. The file keeps its own
    /// permissions and attributes. Runs in the worker, so only where the person may write. `was` is the file as Rig read it:
    /// a program that saved it since keeps its own write.
    static void Replace(string path, byte[] bytes, byte[] was)
    {
        string name = Path.GetFileName(path), dir = Path.GetDirectoryName(path)!;
        var attrs = File.GetAttributes(path);
        if (attrs.HasFlag(FileAttributes.ReadOnly)) throw new RigException($"{name} is marked read-only, so Rig left it as it is. Some programs do that on purpose.");
        if (attrs.HasFlag(FileAttributes.ReparsePoint)) throw new RigException($"{name} is a link to another file, so Rig left it as it is.");
        string temp = Path.Combine(dir, $".{name}.rig-{CommandStore.NewId()[..8]}.tmp");
        try
        {
            if (!File.ReadAllBytes(path).AsSpan().SequenceEqual(was)) throw new RigException($"{name} changed while Rig was editing it, so Rig left it as it is. Ask again.");
            using (var f = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                f.Write(bytes);
                f.Flush(flushToDisk: true);
            }
            File.Replace(temp, path, null, ignoreMetadataErrors: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new RigException($"Windows wouldn't let Rig replace {name} ({e.Message.TrimEnd('.')}). If the program that uses it is open, close it and try again.");
        }
        finally { try { if (File.Exists(temp)) File.Delete(temp); } catch { } }
    }

    // ----- Line diff -----

    static List<(int Start, int End)> LineSpans(string text)
    {
        var spans = new List<(int, int)>();
        int at = 0;
        while (true)
        {
            int nl = text.IndexOf('\n', at);
            if (nl < 0) { spans.Add((at, text.Length)); return spans; }
            spans.Add((at, nl + 1));
            at = nl + 1;
        }
    }

    /// The changed regions of `after`, as [Start, End) in `after`, with the text `before` had there and the old line they
    /// start on (from 0). Edits only replace and insert lines, so old and new lines are matched in order, and a new line
    /// counts as inserted only while the new text still has lines to spare.
    static List<(int Start, int End, string Old, int Line)> Regions(string before, string after)
    {
        var a = LineSpans(before);
        var b = LineSpans(after);
        string A(int i) => before[a[i].Start..a[i].End];
        string B(int j) => after[b[j].Start..b[j].End];
        int OldAt(int i) => i < a.Count ? a[i].Start : before.Length;
        int NewAt(int j) => j < b.Count ? b[j].Start : after.Length;
        var regions = new List<(int, int, string, int)>();
        int i = 0, j = 0;
        while (i < a.Count || j < b.Count)
        {
            if (i < a.Count && j < b.Count && A(i) == B(j)) { i++; j++; continue; }
            int i0 = i, j0 = j;
            while (i < a.Count || j < b.Count)
            {
                if (i < a.Count && j < b.Count && A(i) == B(j)) break;
                int spare = (b.Count - j) - (a.Count - i);
                int ahead = i < a.Count ? Enumerable.Range(j + 1, Math.Max(0, Math.Min(spare, b.Count - j - 1))).FirstOrDefault(k => B(k) == A(i), -1) : -1;
                if (ahead > j) { j = ahead; continue; }
                if (i < a.Count) i++;
                if (j < b.Count) j++;
            }
            regions.Add((NewAt(j0), NewAt(j), before[OldAt(i0)..OldAt(i)], i0));
        }
        return regions;
    }

    static List<string> Diff(string before, string after)
    {
        var lines = new List<string>();
        if (before == after) return lines;
        static List<string> Split(string text) => text.Length == 0 ? [] : text.TrimEnd('\n').Split('\n').Select(l => Clip(l.TrimEnd('\r'), DiffLineChars)).ToList();
        foreach (var (start, end, old, line) in Regions(before, after))
        {
            var gone = Split(old);
            lines.Add(gone.Count > 0 ? $"Line {line + 1}:" : line == 0 ? "At the top:" : $"After line {line}:");
            lines.AddRange(gone.Select(l => "- " + l));
            lines.AddRange(Split(after[start..end]).Select(l => "+ " + l));
        }
        return lines.Count <= DiffLines ? lines : [.. lines.Take(DiffLines), $"…and {lines.Count - DiffLines} more lines"];
    }

    // ----- JSON -----

    static class JsonFile
    {
        sealed class Node
        {
            /// '{' an object, '[' a list, 'v' one value.
            public char Kind;
            public int Start, End;
            public readonly List<(string Key, int KeyStart, int KeyEnd, Node Value)> Members = [];
            public readonly List<Node> Items = [];
        }

        static readonly Regex Number = new(@"\G-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?");

        /// Reads the whole file, or says where it couldn't. Comments and trailing commas are taken as many games write them.
        sealed class Reader(string text, string name)
        {
            int at;

            RigException Bad(string what) => new($"Rig couldn't read {name} as JSON ({what} on line {text.AsSpan(0, Math.Min(at, text.Length)).Count('\n') + 1}), so it changed nothing.");

            public Node Document()
            {
                Skip();
                var n = Value(0);
                Skip();
                if (at < text.Length) throw Bad("more after the end");
                return n;
            }

            void Skip()
            {
                while (at < text.Length)
                {
                    char c = text[at];
                    if (c is ' ' or '\t' or '\r' or '\n') at++;
                    else if (c == '/' && at + 1 < text.Length && text[at + 1] == '/') { int nl = text.IndexOf('\n', at); at = nl < 0 ? text.Length : nl + 1; }
                    else if (c == '/' && at + 1 < text.Length && text[at + 1] == '*')
                    {
                        int close = text.IndexOf("*/", at + 2, StringComparison.Ordinal);
                        if (close < 0) throw Bad("a comment that never ends");
                        at = close + 2;
                    }
                    else return;
                }
            }

            bool At(char c) => at < text.Length && text[at] == c;

            Node Value(int depth)
            {
                if (depth > 256) throw Bad("too many levels inside each other");
                if (at >= text.Length) throw Bad("the file ending too soon");
                var node = new Node { Kind = text[at] is '{' or '[' ? text[at] : 'v', Start = at };
                if (node.Kind == '{')
                {
                    var keys = new HashSet<string>(StringComparer.Ordinal);
                    at++;
                    Skip();
                    while (!At('}'))
                    {
                        if (!At('"')) throw Bad("a key that isn't in quotes");
                        int keyStart = at;
                        string key = Text();
                        if (!keys.Add(key)) throw new RigException($"{name} has the key \"{Clip(key, 40)}\" twice in one place, so Rig can't tell which one the program reads. It changed nothing.");
                        int keyEnd = at;
                        Skip();
                        if (!At(':')) throw Bad("a missing :");
                        at++;
                        Skip();
                        node.Members.Add((key, keyStart, keyEnd, Value(depth + 1)));
                        Skip();
                        if (At(',')) { at++; Skip(); }
                        else if (!At('}')) throw Bad("a missing , or }");
                    }
                    at++;
                }
                else if (node.Kind == '[')
                {
                    at++;
                    Skip();
                    while (!At(']'))
                    {
                        node.Items.Add(Value(depth + 1));
                        Skip();
                        if (At(',')) { at++; Skip(); }
                        else if (!At(']')) throw Bad("a missing , or ]");
                    }
                    at++;
                }
                else if (At('"')) Text();
                else if (Number.Match(text, at) is { Success: true } m) at += m.Length;
                else if (new[] { "true", "false", "null" }.FirstOrDefault(w => text.AsSpan(at).StartsWith(w, StringComparison.Ordinal)) is string word) at += word.Length;
                else throw Bad("something that isn't a value");
                node.End = at;
                return node;
            }

            /// A quoted text, read past its closing quote.
            string Text()
            {
                var sb = new StringBuilder();
                at++;
                while (true)
                {
                    if (at >= text.Length) throw Bad("text that never ends");
                    char c = text[at++];
                    if (c == '"') return sb.ToString();
                    if (c < ' ') throw Bad("a line break inside quotes");
                    if (c != '\\') { sb.Append(c); continue; }
                    if (at >= text.Length) throw Bad("text that never ends");
                    char e = text[at++];
                    switch (e)
                    {
                        case '"' or '\\' or '/': sb.Append(e); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u' when at + 4 <= text.Length && ushort.TryParse(text.AsSpan(at, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out ushort u):
                            sb.Append((char)u);
                            at += 4;
                            break;
                        default: throw Bad("an escape JSON doesn't have");
                    }
                }
            }
        }

        public static string Quote(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case < ' ': sb.Append($"\\u{(int)c:x4}"); break;
                    default: sb.Append(c); break;
                }
            }
            return sb.Append('"').ToString();
        }

        static string ValueText(JsonNode? v) => v switch
        {
            null => "null",
            JsonObject o => o["number"]!.GetValue<string>(),
            _ => v.GetValueKind() switch
            {
                JsonValueKind.String => Quote(v.GetValue<string>()),
                JsonValueKind.Number => v.GetValue<long>().ToString(CultureInfo.InvariantCulture),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => "null",
            },
        };

        public static Planned Plan(string text, string eol, List<string> at, JsonNode? value, bool add, string name)
        {
            var node = new Reader(text, name).Document();
            for (int k = 0; k < at.Count; k++)
            {
                string seg = at[k];
                Node? next = node.Kind switch
                {
                    '{' => node.Members.Where(m => m.Key == seg).Select(m => m.Value).FirstOrDefault(),
                    '[' => int.TryParse(seg, NumberStyles.None, CultureInfo.InvariantCulture, out int i) && i < node.Items.Count && seg == i.ToString(CultureInfo.InvariantCulture) ? node.Items[i] : null,
                    _ => throw new RigException($"In {name}, {Label(at[..k])} is a single value, so it has no {seg} inside. Rig changed nothing."),
                };
                if (next == null)
                {
                    if (k == at.Count - 1 && add && node.Kind == '{') return new Planned(null, Insert(text, eol, node, seg, ValueText(value)));
                    throw new RigException($"Rig didn't find {Label(at[..(k + 1)])} in {name}, so it changed nothing.");
                }
                node = next;
            }
            if (node.Kind != 'v') throw new RigException($"In {name}, {Label(at)} holds a group of values, and Rig changes single values only.");
            return new Planned(text[node.Start..node.End], new Splice(node.Start, node.End, ValueText(value)));
        }

        /// A new last member, written the way the one before it is: on its own line with the same indent, or on the same line.
        static Splice Insert(string text, string eol, Node obj, string key, string value)
        {
            if (obj.Members.Count == 0) return new Splice(obj.Start + 1, obj.Start + 1, $"{Quote(key)}: {value}");
            var last = obj.Members[^1];
            string colon = text[last.KeyEnd..last.Value.Start];
            if (colon.Any(c => c is not (' ' or '\t' or ':'))) colon = ": ";
            string indent = text[(text.LastIndexOf('\n', last.KeyStart - 1) + 1)..last.KeyStart];
            string sep = indent.All(c => c is ' ' or '\t') ? eol + indent : " ";
            return new Splice(last.Value.End, last.Value.End, $",{sep}{Quote(key)}{colon}{value}");
        }
    }

    // ----- INI -----

    static class IniFile
    {
        sealed record Entry(string Section, string Key, int ValueStart, int ValueEnd, bool Quoted, int LineEnd, bool Spaced);
        sealed record Header(string Name, int LineEnd);

        static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

        static string ValueText(JsonNode? v) => v switch
        {
            JsonObject o => o["number"]!.GetValue<string>(),
            JsonValue n when n.GetValueKind() == JsonValueKind.Number => n.GetValue<long>().ToString(CultureInfo.InvariantCulture),
            _ => v!.GetValue<string>(),
        };

        /// Every [section] header and key=value line. Comment lines start with ; or #; a line that is neither is left alone.
        static (List<Header>, List<Entry>) Read(string text)
        {
            var headers = new List<Header>();
            var entries = new List<Entry>();
            string section = "";
            for (int pos = 0; pos <= text.Length;)
            {
                int nl = text.IndexOf('\n', pos), le = nl < 0 ? text.Length : nl, ce = le > pos && text[le - 1] == '\r' ? le - 1 : le, ts = pos;
                while (ts < ce && text[ts] is ' ' or '\t') ts++;
                if (ts < ce && text[ts] == '[')
                {
                    int close = text.IndexOf(']', ts, ce - ts);
                    if (close > ts)
                    {
                        section = text[(ts + 1)..close].Trim(' ', '\t');
                        headers.Add(new Header(section, ce));
                    }
                }
                else if (ts < ce && text[ts] is not (';' or '#') && text.IndexOf('=', ts, ce - ts) is int eq && eq > ts)
                {
                    int vs = eq + 1, ve = ce;
                    while (vs < ce && text[vs] is ' ' or '\t') vs++;
                    while (ve > vs && text[ve - 1] is ' ' or '\t') ve--;
                    entries.Add(new Entry(section, text[ts..eq].TrimEnd(' ', '\t'), vs, ve, ve - vs >= 2 && text[vs] == '"' && text[ve - 1] == '"', ce, text[eq - 1] is ' ' or '\t'));
                }
                if (nl < 0) break;
                pos = nl + 1;
            }
            return (headers, entries);
        }

        public static Planned Plan(string text, string eol, List<string> at, JsonNode? value, bool add, string name)
        {
            string section = at[0], key = at[1], place = $"{(section.Length == 0 ? "" : $"[{section}] ")}{key}";
            var (headers, entries) = Read(text);
            var mine = headers.Where(h => Same(h.Name, section)).ToList();
            if (mine.Count + (section.Length == 0 ? 1 : 0) > 1) throw new RigException($"{name} has the section [{section}] more than once, so Rig can't tell which one the program reads. It changed nothing.");
            var inSection = entries.Where(e => Same(e.Section, section)).ToList();
            var found = inSection.Where(e => Same(e.Key, key)).ToList();
            if (found.Count > 1) throw new RigException($"{name} has {place} more than once, so Rig can't tell which one the program reads. It changed nothing.");
            string text2 = ValueText(value);
            if (found.Count == 1)
            {
                var e = found[0];
                if (e.Quoted && text2.Contains('"')) throw new RigException($"In {name}, {place} is in quotes, so its new value can't hold a \" itself.");
                return e.Quoted
                    ? new Planned(text[e.ValueStart..e.ValueEnd], new Splice(e.ValueStart + 1, e.ValueEnd - 1, text2))
                    : new Planned(text[e.ValueStart..e.ValueEnd], new Splice(e.ValueStart, e.ValueEnd, text2));
            }
            if (!add) throw new RigException($"Rig didn't find {place} in {name}, so it changed nothing.");
            string line = key + (entries.Count > 0 && entries[0].Spaced ? " = " : "=") + text2;
            if (inSection.Count > 0) return new Planned(null, new Splice(inSection[^1].LineEnd, inSection[^1].LineEnd, eol + line));
            if (mine.Count == 1) return new Planned(null, new Splice(mine[0].LineEnd, mine[0].LineEnd, eol + line));
            if (section.Length == 0) return new Planned(null, new Splice(0, 0, line + eol));
            string lead = text.Length == 0 || text.EndsWith('\n') ? "" : eol;
            return new Planned(null, new Splice(text.Length, text.Length, $"{lead}[{section}]{eol}{line}{eol}"));
        }
    }
}
