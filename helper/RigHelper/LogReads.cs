// The chat's log reads (read_pc kind log): any event log channel, the events
// about one kind of change, crash dumps and live kernel reports, Windows Error
// Reporting, Reliability Monitor, the log files Rig knows by name, the logs
// graphics and PC makers' tools keep, and firmware update status. Nothing here
// writes. The app and the server check each read first (logReads.ts); this
// checks it again against the same table (rules/logs.json, embedded), and
// keeps every answer small: a time window, a count, a cut on each message, a
// cap on the whole answer and on how much of a file is read.

using System.Diagnostics.Eventing.Reader;
using System.Globalization;
using System.Management;
using EnumerationOptions = System.IO.EnumerationOptions;
using System.Reflection;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

public static class LogReads
{
    public sealed record Query(string Channel, string[] Providers, int[] Ids, int[] Levels);
    public sealed record Topic(string Says, Query[] Queries, string[] Also);
    public sealed record FileRule(string? Path, string? Folder, string? Match, string? Format);
    public sealed record Vendor(string Name, string[] Folders);
    public sealed record Limits(int DefaultHours, int DefaultLongHours, int MaxHours, int DefaultMax, int MaxEvents, int MaxFiles, int DefaultLines, int MaxLines,
        int MessageChars, int LineChars, int TextChars, long ScanBytes, int Examine, int Providers, int Ids, int ContainsChars);
    public sealed record FactField(string Key, string[] From, string Type);
    public sealed record FactRule(string Provider, int[] Ids, string Says, FactField[] Fields);
    public sealed record Table(Limits Limits, Dictionary<string, bool> Sources, Dictionary<string, Topic> Topics, Dictionary<string, FileRule> Files,
        Dictionary<string, Vendor> Vendors, string[] VendorExtensions, int VendorDepth, Dictionary<string, string> Bugchecks, Dictionary<string, string> EsrtStatus, Dictionary<string, string> EsrtType,
        FactRule[] FactRules, Dictionary<string, FactRule> Facts);

    static readonly Lazy<Table> table = new(Load);
    public static Table Rules => table.Value;
    static readonly string[] LevelNames = ["critical", "error", "warning", "info", "verbose"];
    static readonly Regex Sid = new(@"^S-1-[0-9]+(-[0-9]+){1,14}$");
    static readonly Regex Plain = new(@"^[^\u0000-\u001f\u007f<>""]+$");
    static readonly Regex FileName = new(@"^[A-Za-z0-9 _.()-]{1,120}$");

    static Table Load()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Rig.Rules.logs.json") ?? throw new RigException("Rig's log rules are missing from the helper.");
        var o = JsonNode.Parse(s) as JsonObject ?? throw new RigException("Rig's log rules can't be read.");
        static string[] List(JsonNode? n) => n is JsonArray a ? a.Select(x => x!.GetValue<string>()).ToArray() : [];
        static int[] Ints(JsonNode? n) => n is JsonArray a ? a.Select(x => (int)Json.Num(x, 0)).ToArray() : [];
        static Dictionary<string, string> Map(JsonNode? n) => n is JsonObject m ? m.ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<string>()) : [];
        var l = o["limits"]!;
        int I(string k) => (int)Json.Num(l[k], 0);
        var limits = new Limits(I("defaultHours"), I("defaultLongHours"), I("maxHours"), I("defaultMax"), I("maxEvents"), I("maxFiles"), I("defaultLines"), I("maxLines"),
            I("messageChars"), I("lineChars"), I("textChars"), (long)Json.Num(l["scanBytes"], 0), I("examine"), I("providers"), I("ids"), I("containsChars"));
        var sources = o["sources"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!["clean"]?.GetValue<bool>() == true);
        var topics = o["topics"]!.AsObject().ToDictionary(kv => kv.Key, kv => new Topic(kv.Value!["says"]!.GetValue<string>(),
            kv.Value["queries"]!.AsArray().Select(q => new Query(q!["channel"]!.GetValue<string>(), List(q["providers"]), Ints(q["ids"]), Ints(q["levels"]))).ToArray(), List(kv.Value["also"])));
        var files = o["files"]!.AsObject().ToDictionary(kv => kv.Key, kv => new FileRule(kv.Value!["path"]?.GetValue<string>(), kv.Value["folder"]?.GetValue<string>(), kv.Value["match"]?.GetValue<string>(), kv.Value["format"]?.GetValue<string>()));
        var vendors = o["vendors"]!.AsObject().ToDictionary(kv => kv.Key, kv => new Vendor(kv.Value!["name"]!.GetValue<string>(), List(kv.Value["folders"])));
        var factRules = (o["facts"] as JsonArray ?? []).Select(f => new FactRule(f!["provider"]!.GetValue<string>(), Ints(f["ids"]), f["says"]!.GetValue<string>(),
            (f["fields"] as JsonObject ?? []).Select(kv => new FactField(kv.Key, List(kv.Value!["from"]), kv.Value["type"]!.GetValue<string>())).ToArray())).ToArray();
        var facts = new Dictionary<string, FactRule>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in factRules) foreach (int id in r.Ids) facts.TryAdd($"{r.Provider}|{id}", r);
        return new Table(limits, sources, topics, files, vendors, List(o["vendorExtensions"]), (int)Json.Num(o["vendorDepth"], 4),
            new Dictionary<string, string>(Map(o["bugchecks"]), StringComparer.OrdinalIgnoreCase), Map(o["esrtStatus"]), Map(o["esrtType"]), factRules, facts);
    }

    static string? Text(JsonObject o, string key) => o[key] is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    /// The read's window in UTC: from and to as given, or `hours` (or the source's default) back from now, never more than maxHours.
    /// `none` is true when the read gave no window and the source lists without one (a maker's log files).
    static (DateTime From, DateTime To, bool None) Window(JsonObject req, int defaultHours, bool noneByDefault = false)
    {
        var L = Rules.Limits;
        DateTime now = DateTime.UtcNow, floor = now.AddHours(-L.MaxHours);
        static DateTime? At(string? s) => s != null && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t) ? t : null;
        string? f = Text(req, "from"), t = Text(req, "to");
        DateTime? from = At(f), to = At(t);
        if (f != null && from == null || t != null && to == null) throw new RigException("from and to must be times like 2026-11-25T18:00:00Z.");
        double hours = req["hours"] is JsonNode h ? Json.Num(h, -1) : -1;
        if (req["hours"] != null && !(hours > 0 && hours <= L.MaxHours)) throw new RigException($"hours must be more than 0 and at most {L.MaxHours}.");
        bool none = noneByDefault && from == null && hours < 0;
        DateTime end = to ?? now;
        DateTime start = from ?? end.AddHours(-(hours > 0 ? hours : defaultHours));
        if (start < floor) start = floor;
        if (start >= end) throw new RigException("from must be before to.");
        return (start, end, none);
    }

    static int Max(JsonObject req, int cap, int fallback)
    {
        if (req["max"] == null) return Math.Min(fallback, cap);
        double m = Json.Num(req["max"], 0);
        if (m < 1 || m > cap || m != Math.Floor(m)) throw new RigException($"max must be a whole number from 1 to {cap}.");
        return (int)m;
    }

    static string? Contains(JsonObject req)
    {
        string? c = Text(req, "contains");
        if (string.IsNullOrEmpty(c)) return null;
        if (c.Length > Rules.Limits.ContainsChars || !Plain.IsMatch(c)) throw new RigException("contains must be plain text.");
        return c;
    }

    static bool Holds(string? text, string? contains) => contains == null || text != null && text.Contains(contains, StringComparison.OrdinalIgnoreCase);

    /// `owner` is the SID of the Windows account the Rig app runs as; %LocalAppData% means that account's, never this helper's.
    public static string Read(JsonObject req, string? owner)
    {
        string source = Text(req, "source") ?? "";
        if (!Rules.Sources.ContainsKey(source)) throw new RigException($"A log read needs a source: {string.Join(", ", Rules.Sources.Keys)}.");
        var vars = Vars(owner);
        JsonObject answer = source switch
        {
            "events" => EventsRead(req),
            "topic" => TopicRead(req),
            "channels" => ChannelsRead(req),
            "crashes" => CrashesRead(req),
            "wer" => WerRead(req, vars),
            "reliability" => ReliabilityRead(req),
            "file" => FileRead(req, vars),
            "vendor" => VendorRead(req, vars),
            "esrt" => EsrtRead(),
            _ => throw new RigException("Rig's helper doesn't know that log."),
        };
        return answer.ToJsonString();
    }

    /// What %name% means on this PC. LocalAppData is the person's, from their profile folder, and missing when it isn't known.
    static Func<string, string?> Vars(string? owner)
    {
        string? local = null;
        bool looked = false;
        return name => name.ToLowerInvariant() switch
        {
            "windir" => Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            "programdata" => Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "programfiles" => Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "systemdrive" => Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows)),
            "localappdata" => looked ? local : (looked = true) && (local = PersonLocalAppData(owner)) != null ? local : null,
            _ => null,
        };
    }

    static string? PersonLocalAppData(string? owner)
    {
        if (owner == null || !Sid.IsMatch(owner)) return null;
        using var k = Registry.LocalMachine.OpenSubKey($@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\{owner}", writable: false);
        if (k?.GetValue("ProfileImagePath") is not string profile || profile.Length == 0) return null;
        string full = Environment.ExpandEnvironmentVariables(profile);
        return Path.IsPathFullyQualified(full) ? Path.Combine(full, "AppData", "Local") : null;
    }

    // ----- Event logs -----

    record Found(DateTime T, string Channel, string Source, int Id, string Level, string? What, JsonObject? Facts, string? Message);

    /// Whether a read asked for each event's message, which counts as outside text. Without it, an event is its facts only.
    static bool WantsText(JsonObject req) => req["text"] is JsonValue v && v.TryGetValue(out bool b) && b;

    /// An event's facts from the table: only values that fit their type, so none can carry an app's own sentence.
    static (string? What, JsonObject? Facts) FactsOf(EventRecord rec, string provider)
    {
        if (!Rules.Facts.TryGetValue($"{provider}|{rec.Id}", out var rule)) return (null, null);
        if (rule.Fields.Length == 0) return (rule.Says, null);
        string xml;
        try { xml = rec.ToXml(); } catch (EventLogException) { return (rule.Says, null); }
        var values = LogParse.EventValues(xml);
        var facts = new JsonObject();
        foreach (var f in rule.Fields)
        {
            string? raw = f.From.Select(n => values.GetValueOrDefault(n)).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
            if (LogParse.FactValue(f.Type, raw) is not string fact) continue;
            // A stop code of 0 means there was no blue screen.
            if (f.Type == "stop" && fact == "0x00000000") continue;
            facts[f.Key] = fact;
            if (f.Type == "stop" && Rules.Bugchecks.TryGetValue(fact, out var name)) facts[f.Key + "Name"] = name;
        }
        return (rule.Says, facts.Count > 0 ? facts : null);
    }

    static int[] LevelsOf(JsonObject req)
    {
        if (req["levels"] is not JsonArray a) return [];
        return a.Select(x => x is JsonValue v && v.TryGetValue(out string? s) && Array.IndexOf(LevelNames, s) is int i and >= 0 ? i + 1 : throw new RigException($"levels must be some of {string.Join(", ", LevelNames)}.")).Distinct().ToArray();
    }

    /// Up to `max` events newest first, looking through at most `examine` of them. Notes why a channel couldn't be read.
    static List<Found> Events(Query q, DateTime from, DateTime to, int max, string? contains, bool text, List<string> notes)
    {
        var L = Rules.Limits;
        if (!LogParse.Channel.IsMatch(q.Channel)) throw new RigException("That isn't an event log's name.");
        string xpath = LogParse.XPath(q.Providers, q.Ids, q.Levels, from, to);
        var list = new List<Found>();
        try { Collect(reverse: true); }
        catch (EventLogNotFoundException) { notes.Add($"{q.Channel}: this PC has no such event log"); }
        catch (UnauthorizedAccessException) { notes.Add($"{q.Channel}: Windows didn't let Rig read it"); }
        catch (EventLogException)
        {
            // Debug and analytic channels can only be read oldest first: read forward and keep the newest.
            try { list.Clear(); Collect(reverse: false); list.Reverse(); if (list.Count > max) list.RemoveRange(max, list.Count - max); }
            catch (Exception e) when (e is EventLogException or UnauthorizedAccessException) { notes.Add($"{q.Channel}: {LogParse.Cut(e.Message.Trim(), 120)}"); }
        }
        return list;

        void Collect(bool reverse)
        {
            using var reader = new EventLogReader(new EventLogQuery(q.Channel, PathType.LogName, xpath) { ReverseDirection = reverse });
            for (int seen = 0; seen < L.Examine; seen++)
            {
                using var rec = reader.ReadEvent();
                if (rec == null) break;
                if (rec.TimeCreated is not DateTime at) continue;
                string provider = rec.ProviderName ?? "Unknown";
                // The message is only formatted when it's asked for or searched in; contains looks in it either way.
                string? message = text || contains != null ? Message(rec) : null;
                if (!Holds($"{provider} {message}", contains)) continue;
                var (what, facts) = FactsOf(rec, provider);
                list.Add(new Found(at.ToUniversalTime(), q.Channel, text || LogParse.Provider.IsMatch(provider) ? provider : "(left out)", rec.Id, Level(rec.Level),
                    what, facts, text && message != null ? LogParse.Cut(message, L.MessageChars) : null));
                // Forward reads keep going to reach the newest; the list keeps only the last `max` of them.
                if (reverse && list.Count >= max) break;
                if (!reverse && list.Count > max) list.RemoveAt(0);
            }
        }
    }

    static string Level(byte? level) => level switch { 1 => "critical", 2 => "error", 3 => "warning", 5 => "verbose", _ => "info" };

    static string Message(EventRecord rec)
    {
        string? text = null;
        try { text = rec.FormatDescription(); } catch (EventLogException) { }
        if (string.IsNullOrWhiteSpace(text))
        {
            try { text = string.Join(", ", rec.Properties.Select(p => p.Value?.ToString()).Where(v => !string.IsNullOrWhiteSpace(v)).Take(8)); }
            catch (EventLogException) { text = ""; }
        }
        return Regex.Replace(text ?? "", @"\s+", " ").Trim();
    }

    static JsonObject EventList(IEnumerable<Found> found, bool withChannel, JsonObject answer, List<string> notes)
    {
        var events = new JsonArray();
        int used = answer.ToJsonString().Length + 200;
        int left = LogParse.Fit(events, found.Select(f =>
        {
            var o = new JsonObject { ["t"] = LogParse.Iso(f.T) };
            if (withChannel) o["log"] = f.Channel;
            o["source"] = f.Source; o["id"] = f.Id; o["level"] = f.Level;
            if (f.What != null) o["what"] = f.What;
            if (f.Facts != null) o["facts"] = f.Facts.DeepClone();
            if (f.Message != null) o["message"] = f.Message;
            return (JsonNode)o;
        }), Rules.Limits.TextChars, used);
        answer["events"] = events;
        if (left > 0) answer["more"] = $"{left} more left out to keep this short; narrow the time, ids or contains to see them";
        if (notes.Count > 0) answer["couldNotRead"] = new JsonArray(notes.Select(n => (JsonNode)n).ToArray());
        return answer;
    }

    static JsonObject EventsRead(JsonObject req)
    {
        var L = Rules.Limits;
        string channel = (Text(req, "channel") ?? "").Trim();
        if (!LogParse.Channel.IsMatch(channel)) throw new RigException("An events read needs the event log's name, like System.");
        var providers = req["providers"] is JsonArray pa ? pa.Select(p => p is JsonValue v && v.TryGetValue(out string? s) && LogParse.Provider.IsMatch(s) ? s : throw new RigException("That isn't an event source's name.")).Take(L.Providers).ToArray() : [];
        var ids = req["ids"] is JsonArray ia ? ia.Select(i => Json.Num(i, -1) is double d and >= 0 and <= 65535 && d == Math.Floor(d) ? (int)d : throw new RigException("Each id is an event id.")).Take(L.Ids).ToArray() : [];
        var (from, to, _) = Window(req, L.DefaultHours);
        int max = Max(req, L.MaxEvents, L.DefaultMax);
        var notes = new List<string>();
        var found = Events(new Query(channel, providers, ids, LevelsOf(req)), from, to, max, Contains(req), WantsText(req), notes);
        var answer = new JsonObject { ["log"] = channel, ["from"] = LogParse.Iso(from), ["to"] = LogParse.Iso(to) };
        if (found.Count == 0 && notes.Count == 0) answer["found"] = "no events in this window";
        return EventList(found, false, answer, notes);
    }

    static JsonObject TopicRead(JsonObject req)
    {
        var L = Rules.Limits;
        string key = Text(req, "topic") ?? "";
        if (!Rules.Topics.TryGetValue(key, out var topic)) throw new RigException($"A topic read needs one of {string.Join(", ", Rules.Topics.Keys)}.");
        var (from, to, _) = Window(req, L.DefaultHours);
        int max = Max(req, L.MaxEvents, L.DefaultMax);
        string? contains = Contains(req);
        var notes = new List<string>();
        bool text = WantsText(req);
        var found = topic.Queries.SelectMany(q => Events(q, from, to, max, contains, text, notes)).OrderByDescending(f => f.T).Take(max).ToList();
        var answer = new JsonObject { ["topic"] = key, ["shows"] = topic.Says, ["from"] = LogParse.Iso(from), ["to"] = LogParse.Iso(to) };
        if (topic.Also.Length > 0) answer["alsoRead"] = new JsonArray(topic.Also.Select(a => (JsonNode)a).ToArray());
        if (found.Count == 0) answer["found"] = "no events in this window";
        return EventList(found, true, answer, notes);
    }

    static JsonObject ChannelsRead(JsonObject req)
    {
        string? find = Text(req, "find");
        if (find != null && (find.Length > 60 || !Plain.IsMatch(find))) throw new RigException("find must be a word of a channel's name.");
        using var session = new EventLogSession();
        var names = session.GetLogNames().Where(n => find == null || n.Contains(find, StringComparison.OrdinalIgnoreCase)).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
        var rows = new JsonArray();
        int left = LogParse.Fit(rows, names.Take(60).Select(n =>
        {
            var o = new JsonObject { ["log"] = n };
            try { var info = session.GetLogInformation(n, PathType.LogName); o["events"] = info.RecordCount; if (info.LastWriteTime is DateTime w) o["lastWrite"] = LogParse.Iso(w); } catch (Exception e) when (e is EventLogException or UnauthorizedAccessException) { }
            try { using var c = new EventLogConfiguration(n, session); o["on"] = c.IsEnabled; if (c.LogType is EventLogType.Analytical or EventLogType.Debug) o["kind"] = "debug"; } catch (Exception e) when (e is EventLogException or UnauthorizedAccessException) { }
            return (JsonNode)o;
        }), Rules.Limits.TextChars);
        var answer = new JsonObject { ["channels"] = rows, ["matching"] = names.Count };
        if (left > 0 || names.Count > 60) answer["more"] = $"{names.Count - rows.Count} more; use find to narrow it";
        return answer;
    }

    // ----- Crashes -----

    static JsonObject CrashesRead(JsonObject req)
    {
        var L = Rules.Limits;
        var (from, to, _) = Window(req, L.DefaultLongHours);
        int max = Max(req, L.MaxEvents, L.DefaultMax);
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var files = new List<(FileInfo File, string Kind, string? Folder)>();
        var notes = new List<string>();
        void Add(string dir, string pattern, string kind, bool sub)
        {
            try
            {
                var d = new DirectoryInfo(dir);
                if (!d.Exists) return;
                foreach (var f in d.EnumerateFiles(pattern, new EnumerationOptions { RecurseSubdirectories = sub, MaxRecursionDepth = 2, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint }).Take(2000))
                    files.Add((f, kind, sub && f.Directory != null && !LogParse.Under(d.FullName, f.Directory.FullName) && FileName.IsMatch(f.Directory.Name) ? f.Directory.Name : null));
            }
            catch (Exception e) when (e is UnauthorizedAccessException or IOException) { notes.Add($"{dir}: Windows didn't let Rig look"); }
        }
        Add(Path.Combine(windows, "Minidump"), "*.dmp", "blue screen", false);
        Add(windows, "MEMORY.DMP", "blue screen (full memory dump)", false);
        Add(Path.Combine(windows, "LiveKernelReports"), "*.dmp", "live kernel report (Windows recovered)", true);

        var inWindow = files.Where(f => f.File.LastWriteTimeUtc >= from && f.File.LastWriteTimeUtc <= to).OrderByDescending(f => f.File.LastWriteTimeUtc).ToList();
        var rows = new JsonArray();
        int left = LogParse.Fit(rows, inWindow.Take(max).Select(f =>
        {
            var o = new JsonObject { ["t"] = LogParse.Iso(f.File.LastWriteTimeUtc), ["kind"] = f.Kind };
            if (f.Folder != null) o["report"] = f.Folder;
            if (FileName.IsMatch(f.File.Name)) o["file"] = f.File.Name;
            o["sizeKb"] = f.File.Length / 1024;
            try
            {
                var head = new byte[0x60];
                using (var s = new FileStream(f.File.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) s.ReadExactly(head);
                if (LogParse.Dump(head) is LogParse.DumpHeader h)
                {
                    string code = LogParse.Hex(h.Code);
                    o["stopCode"] = code;
                    if (Rules.Bugchecks.TryGetValue(code, out var name)) o["name"] = name;
                    o["params"] = new JsonArray(h.Params.Select(p => (JsonNode)LogParse.Hex(p)).ToArray());
                }
                else o["note"] = "Rig couldn't read this dump's header";
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { o["note"] = "Windows didn't let Rig open it"; }
            return (JsonNode)o;
        }), L.TextChars, 300);
        var answer = new JsonObject { ["from"] = LogParse.Iso(from), ["to"] = LogParse.Iso(to), ["dumps"] = rows, ["onDisk"] = files.Count };
        if (inWindow.Count > rows.Count) answer["more"] = $"{inWindow.Count - rows.Count} more in this window";
        // Whether Windows keeps a dump at a blue screen at all.
        using (var k = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\CrashControl", writable: false))
            if (k?.GetValue("CrashDumpEnabled") is int dump)
                answer["dumpSetting"] = dump switch { 0 => "none: Windows keeps no dump at a blue screen", 1 => "complete memory dump", 2 => "kernel memory dump", 3 => "small memory dump (minidump)", 7 => "automatic memory dump", _ => $"setting {dump}" };
        if (inWindow.Count == 0) answer["found"] = "no dumps in this window";
        if (notes.Count > 0) answer["couldNotRead"] = new JsonArray(notes.Select(n => (JsonNode)n).ToArray());
        return answer;
    }

    // ----- Windows Error Reporting -----

    static JsonObject WerRead(JsonObject req, Func<string, string?> vars)
    {
        var L = Rules.Limits;
        var (from, to, _) = Window(req, L.DefaultLongHours);
        int max = Max(req, L.MaxEvents, L.DefaultMax);
        string? contains = Contains(req);
        var roots = new List<string>();
        foreach (var t in new[] { @"%ProgramData%\Microsoft\Windows\WER", @"%LocalAppData%\Microsoft\Windows\WER" })
            if (LogParse.Expand(t, vars) is string r) { roots.Add(Path.Combine(r, "ReportArchive")); roots.Add(Path.Combine(r, "ReportQueue")); }
        var dirs = new List<DirectoryInfo>();
        foreach (var r in roots)
        {
            try { var d = new DirectoryInfo(r); if (d.Exists) dirs.AddRange(d.EnumerateDirectories("*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint }).Take(3000)); }
            catch (Exception e) when (e is UnauthorizedAccessException or IOException) { }
        }
        var reports = new List<(DateTime T, JsonObject Row)>();
        int examined = 0;
        foreach (var d in dirs.Where(d => d.LastWriteTimeUtc >= from.AddDays(-1) && d.LastWriteTimeUtc <= to.AddDays(1)).OrderByDescending(d => d.LastWriteTimeUtc))
        {
            if (reports.Count >= max || examined++ >= L.Examine) break;
            var f = new FileInfo(Path.Combine(d.FullName, "Report.wer"));
            if (!f.Exists || f.Length > 1 << 20 || f.Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
            Dictionary<string, string> wer;
            try { wer = LogParse.Wer(ReadAll(f.FullName, 256 * 1024)); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            DateTime t = LogParse.WerTime(wer) ?? f.LastWriteTimeUtc;
            if (t < from || t > to) continue;
            var sig = LogParse.WerSignature(wer, 12);
            string all = string.Join(" ", new[] { wer.GetValueOrDefault("EventType"), wer.GetValueOrDefault("AppName"), wer.GetValueOrDefault("AppPath"), wer.GetValueOrDefault("FriendlyEventName") }.Concat(sig.Select(s => s.Value)));
            if (!Holds(all, contains)) continue;
            var row = new JsonObject { ["t"] = LogParse.Iso(t) };
            // Only values that fit a fact's type: an app's file name, never its folder, and short names and codes.
            foreach (var (key, name, type) in new[] { ("EventType", "type", "id"), ("AppName", "app", "file"), ("AppPath", "app", "file") })
                if (!row.ContainsKey(name) && LogParse.FactValue(type, wer.GetValueOrDefault(key)) is string v) row[name] = v;
            if (sig.Count > 0)
            {
                var s = new JsonObject();
                foreach (var (n, v) in sig)
                    if (LogParse.FactValue("name", n) is string k && !s.ContainsKey(k))
                        s[k] = LogParse.FactValue("version", v) is string ver && ver == v.Trim() ? ver : LogParse.FactValue("name", v) ?? LogParse.FactValue("id", v) ?? "(left out)";
                row["signature"] = s;
            }
            reports.Add((t, row));
        }
        var rows = new JsonArray();
        int left = LogParse.Fit(rows, reports.OrderByDescending(r => r.T).Select(r => (JsonNode)r.Row), L.TextChars, 200);
        var answer = new JsonObject { ["from"] = LogParse.Iso(from), ["to"] = LogParse.Iso(to), ["reports"] = rows };
        if (left > 0) answer["more"] = $"{left} more left out to keep this short";
        if (rows.Count == 0) answer["found"] = "no crash reports in this window";
        if (vars("LocalAppData") == null) answer["note"] = "Rig couldn't tell which Windows account the app runs as, so only reports kept for the whole PC were read";
        return answer;
    }

    // ----- Reliability Monitor -----

    static JsonObject ReliabilityRead(JsonObject req)
    {
        var L = Rules.Limits;
        var (from, to, _) = Window(req, L.DefaultLongHours);
        int max = Max(req, L.MaxEvents, L.DefaultMax);
        string? contains = Contains(req);
        bool text = WantsText(req);
        string f = ManagementDateTimeConverter.ToDmtfDateTime(from.ToLocalTime()), t = ManagementDateTimeConverter.ToDmtfDateTime(to.ToLocalTime());
        var opts = new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(20), ReturnImmediately = true, Rewindable = false };
        var found = new List<(DateTime T, JsonObject Row)>();
        using (var s = new ManagementObjectSearcher(new ManagementScope(@"root\cimv2"),
            new ObjectQuery($"SELECT TimeGenerated, SourceName, EventIdentifier, ProductName, Message FROM Win32_ReliabilityRecords WHERE TimeGenerated >= '{f}' AND TimeGenerated <= '{t}'"), opts))
        using (var all = s.Get())
        {
            int seen = 0;
            foreach (ManagementBaseObject mo in all)
                using (mo)
                {
                    if (seen++ >= L.Examine) break;
                    if (mo["TimeGenerated"] is not string tg) continue;
                    DateTime at = ManagementDateTimeConverter.ToDateTime(tg).ToUniversalTime();
                    string message = Regex.Replace(mo["Message"]?.ToString() ?? "", @"\s+", " ").Trim();
                    string product = mo["ProductName"]?.ToString() ?? "", src = mo["SourceName"]?.ToString() ?? "";
                    if (!Holds($"{src} {product} {message}", contains)) continue;
                    var row = new JsonObject { ["t"] = LogParse.Iso(at), ["source"] = text || LogParse.Provider.IsMatch(src) ? LogParse.Cut(src, 100) : "(left out)", ["id"] = long.TryParse(mo["EventIdentifier"]?.ToString(), out long n) ? n : 0 };
                    if (LogParse.FactValue("name", product) is string p) row["product"] = p;
                    else if (text && product.Length > 0) row["product"] = LogParse.Cut(product, 120);
                    if (text) row["message"] = LogParse.Cut(message, L.MessageChars);
                    found.Add((at, row));
                }
        }
        var rows = new JsonArray();
        int left = LogParse.Fit(rows, found.OrderByDescending(r => r.T).Take(max).Select(r => (JsonNode)r.Row), L.TextChars, 300);
        var answer = new JsonObject { ["from"] = LogParse.Iso(from), ["to"] = LogParse.Iso(to), ["records"] = rows };
        if (found.Count > rows.Count) answer["more"] = $"{found.Count - rows.Count} more in this window";
        // The stability index (1 to 10) Reliability Monitor draws: the latest, and the lowest in the window.
        try
        {
            using var s = new ManagementObjectSearcher(new ManagementScope(@"root\cimv2"), new ObjectQuery($"SELECT SystemStabilityIndex, TimeGenerated FROM Win32_ReliabilityStabilityMetrics WHERE TimeGenerated >= '{f}' AND TimeGenerated <= '{t}'"), opts);
            using var all = s.Get();
            var points = new List<(DateTime T, double V)>();
            foreach (ManagementBaseObject mo in all)
                using (mo)
                    if (mo["TimeGenerated"] is string tg && mo["SystemStabilityIndex"] is double v) points.Add((ManagementDateTimeConverter.ToDateTime(tg).ToUniversalTime(), v));
            if (points.Count > 0)
            {
                var last = points.MaxBy(p => p.T);
                var low = points.MinBy(p => p.V);
                answer["stability"] = new JsonObject { ["now"] = Math.Round(last.V, 1), ["lowest"] = Math.Round(low.V, 1), ["lowestAt"] = LogParse.Iso(low.T) };
            }
        }
        catch (ManagementException) { }
        if (found.Count == 0) answer["found"] = "no records in this window";
        return answer;
    }

    // ----- Files -----

    /// The start of a file, up to `max` bytes, in the encoding its first bytes say.
    static string ReadAll(string path, int max)
    {
        using var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var buf = new byte[(int)Math.Min(max, s.Length)];
        s.ReadExactly(buf);
        var (enc, mark, _) = LogParse.Bom(buf);
        return enc.GetString(buf, mark, buf.Length - mark);
    }

    /// The last `scan` bytes of a file as lines, and whether the read started mid-file.
    static (List<string> Lines, bool Cut) Tail(FileInfo f, long scan)
    {
        using var s = new FileStream(f.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var head = new byte[Math.Min(8, (int)s.Length)];
        s.ReadExactly(head);
        var (enc, mark, unit) = LogParse.Bom(head);
        long start = Math.Max(mark, s.Length - scan);
        if (unit == 2 && (start - mark) % 2 != 0) start++;
        s.Position = start;
        var buf = new byte[s.Length - start];
        s.ReadExactly(buf);
        return (LogParse.Lines(enc.GetString(buf), start > mark), start > mark);
    }

    static JsonObject FileRead(JsonObject req, Func<string, string?> vars)
    {
        var L = Rules.Limits;
        string key = Text(req, "file") ?? "";
        if (!Rules.Files.TryGetValue(key, out var rule)) throw new RigException($"A file read needs one of {string.Join(", ", Rules.Files.Keys)}.");
        FileInfo? f = null;
        if (rule.Path != null)
        {
            string path = LogParse.Expand(rule.Path, vars) ?? throw new RigException("Rig couldn't tell which Windows account the app runs as, so it can't find this log.");
            f = new FileInfo(path);
        }
        else if (rule.Folder != null)
        {
            string folder = LogParse.Expand(rule.Folder, vars) ?? throw new RigException("Rig couldn't tell which Windows account the app runs as, so it can't find this log.");
            var d = new DirectoryInfo(folder);
            f = d.Exists ? d.EnumerateFiles("*" + (rule.Match ?? ".log"), new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint }).MaxBy(x => x.LastWriteTimeUtc) : null;
        }
        if (f == null || !f.Exists) return new JsonObject { ["file"] = key, ["found"] = "this PC doesn't have this log" };
        return TailRead(req, f, rule.Format, new JsonObject { ["file"] = key });
    }

    static JsonObject TailRead(JsonObject req, FileInfo f, string? format, JsonObject answer)
    {
        var L = Rules.Limits;
        if (f.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new RigException("This log is a link to somewhere else, so Rig doesn't follow it.");
        double ln = req["lines"] is JsonNode n ? Json.Num(n, 0) : 0;
        if (req["lines"] != null && (ln < 1 || ln > L.MaxLines || ln != Math.Floor(ln))) throw new RigException($"lines must be a whole number from 1 to {L.MaxLines}.");
        string? contains = Contains(req);
        bool windowAsked = req["hours"] != null || req["from"] != null || req["to"] != null;
        var (from, to, _) = Window(req, L.MaxHours);
        answer["path"] = f.FullName;
        answer["modified"] = LogParse.Iso(f.LastWriteTimeUtc);
        answer["sizeKb"] = f.Length / 1024;
        List<string> lines;
        bool cut;
        try { (lines, cut) = Tail(f, L.ScanBytes); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { throw new RigException("Windows didn't let Rig open this log."); }
        if (cut) answer["readLastKb"] = L.ScanBytes / 1024;
        bool In(DateTime? local) => !windowAsked || local is DateTime t && t.ToUniversalTime() >= from && t.ToUniversalTime() <= to;

        if (format == "setupapi")
        {
            int want = ln > 0 ? (int)ln : 10;
            var sections = LogParse.SetupApi(lines, 8, L.LineChars).Where(s => In(s.Start) && Holds(s.Title + "\n" + s.Text, contains)).Reverse().Take(Math.Min(want, 40)).ToList();
            var rows = new JsonArray();
            int left = LogParse.Fit(rows, sections.Select(s =>
            {
                var o = new JsonObject { ["install"] = s.Title };
                if (s.Start is DateTime st) o["t"] = LogParse.Iso(st);
                o["result"] = s.Status ?? "still running, or cut off";
                if (s.Notes.Count > 0) o["notes"] = new JsonArray(s.Notes.Select(x => (JsonNode)x).ToArray());
                return (JsonNode)o;
            }), L.TextChars, answer.ToJsonString().Length + 100);
            answer["installs"] = rows;
            if (left > 0) answer["more"] = $"{left} more left out to keep this short";
            if (rows.Count == 0) answer["found"] = "no installs matching this";
            return answer;
        }

        // Plain lines: a line with no time of its own (a continuation) goes with the last one that had one.
        int take = ln > 0 ? (int)ln : L.DefaultLines;
        var keep = new List<string>();
        DateTime? last = null;
        foreach (var line in lines)
        {
            last = LogParse.LineTime(line) ?? last;
            if (line.Length == 0 || !In(last) || !Holds(line, contains)) continue;
            keep.Add(LogParse.Cut(line, L.LineChars));
        }
        var picked = keep.Skip(Math.Max(0, keep.Count - take)).ToList();
        // Oldest lines go first when the answer would be too long.
        int budget = L.TextChars - answer.ToJsonString().Length - 100, size = 0, from0 = picked.Count;
        while (from0 > 0 && size + picked[from0 - 1].Length + 4 <= budget) { from0--; size += picked[from0].Length + 4; }
        answer["lines"] = new JsonArray(picked.Skip(from0).Select(x => (JsonNode)x).ToArray());
        int dropped = keep.Count - (picked.Count - from0);
        if (dropped > 0) answer["more"] = $"{dropped} earlier matching lines left out; use contains or a time window to narrow it";
        if (keep.Count == 0) answer["found"] = "no lines matching this";
        return answer;
    }

    static JsonObject VendorRead(JsonObject req, Func<string, string?> vars)
    {
        var L = Rules.Limits;
        string key = Text(req, "vendor") ?? "";
        if (!Rules.Vendors.TryGetValue(key, out var vendor)) throw new RigException($"A vendor read needs one of {string.Join(", ", Rules.Vendors.Keys)}.");
        var roots = vendor.Folders.Select(t => LogParse.Expand(t, vars)).OfType<string>().Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        bool LogExt(string p) => Rules.VendorExtensions.Any(e => p.EndsWith(e, StringComparison.OrdinalIgnoreCase));

        if (Text(req, "file") is string asked && asked.Length > 0)
        {
            if (asked.Length > 400 || !Path.IsPathFullyQualified(asked) || asked.StartsWith(@"\\", StringComparison.Ordinal) || asked.Split('\\').Any(p => p is "." or "..")) throw new RigException("file must be a full path from this vendor's listing.");
            string full = Path.GetFullPath(asked);
            string? root = roots.FirstOrDefault(r => LogParse.Under(full, r) && !full.Equals(r, StringComparison.OrdinalIgnoreCase));
            if (root == null || !LogExt(full)) throw new RigException($"Rig reads only {string.Join(" and ", Rules.VendorExtensions)} files in {vendor.Name}'s log folders: {string.Join(", ", roots)}.");
            if (CommandCheck.OnNeverList(full, "read") is string never) throw new RigException($"{never}.");
            // No folder on the way may be a link to somewhere else.
            for (var d = new FileInfo(full).Directory; d != null && LogParse.Under(d.FullName, root); d = d.Parent)
                if (d.Exists && d.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new RigException("This log's folder is a link to somewhere else, so Rig doesn't follow it.");
            var f = new FileInfo(full);
            if (!f.Exists) throw new RigException("That file isn't there.");
            return TailRead(req, f, null, new JsonObject { ["vendor"] = vendor.Name });
        }

        var (from, to, none) = Window(req, L.MaxHours, noneByDefault: true);
        int max = Max(req, L.MaxFiles, 20);
        var found = new List<FileInfo>();
        foreach (var r in roots)
        {
            try
            {
                var d = new DirectoryInfo(r);
                if (!d.Exists || d.Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
                found.AddRange(d.EnumerateFiles("*", new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = Rules.VendorDepth, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint }).Take(5000).Where(f => LogExt(f.Name)));
            }
            catch (Exception e) when (e is UnauthorizedAccessException or IOException) { }
        }
        var list = found.Where(f => none || f.LastWriteTimeUtc >= from && f.LastWriteTimeUtc <= to).Where(f => CommandCheck.OnNeverList(f.FullName, "read") == null).OrderByDescending(f => f.LastWriteTimeUtc).ToList();
        var rows = new JsonArray();
        int left = LogParse.Fit(rows, list.Take(max).Select(f => (JsonNode)new JsonObject { ["file"] = f.FullName, ["modified"] = LogParse.Iso(f.LastWriteTimeUtc), ["sizeKb"] = f.Length / 1024 }), L.TextChars, 300);
        var answer = new JsonObject { ["vendor"] = vendor.Name, ["folders"] = new JsonArray(roots.Where(Directory.Exists).Select(r => (JsonNode)r).ToArray()), ["files"] = rows };
        if (list.Count > rows.Count) answer["more"] = $"{list.Count - rows.Count} more; read one with file, or narrow with hours";
        if (list.Count == 0) answer["found"] = $"no {vendor.Name} log files on this PC";
        return answer;
    }

    // ----- Firmware updates -----

    static JsonObject EsrtRead()
    {
        var rows = new JsonArray();
        using var esrt = Registry.LocalMachine.OpenSubKey(@"HARDWARE\UEFI\ESRT", writable: false);
        void Entry(RegistryKey k, string id)
        {
            if (rows.Count >= 20 || k.GetValue("Version") is not int version) return;
            string Num(object? v) => v is int i ? unchecked((uint)i).ToString(CultureInfo.InvariantCulture) : "";
            string type = Num(k.GetValue("Type")), status = Num(k.GetValue("LastAttemptStatus"));
            var o = new JsonObject { ["id"] = Guid.TryParse(id, out var g) ? g.ToString() : "unknown", ["type"] = Rules.EsrtType.GetValueOrDefault(type, $"type {type}") };
            o["version"] = Num(version); o["versionHex"] = LogParse.Hex(unchecked((uint)version));
            if (k.GetValue("LowestSupportedVersion") is int low) o["lowestAllowed"] = Num(low);
            if (k.GetValue("LastAttemptVersion") is int tried) o["lastTried"] = Num(tried);
            if (status.Length > 0) { o["lastStatus"] = long.Parse(status, CultureInfo.InvariantCulture); o["lastResult"] = Rules.EsrtStatus.GetValueOrDefault(status, $"status {status}"); }
            rows.Add(o);
        }
        if (esrt != null)
            foreach (var name in esrt.GetSubKeyNames().Take(40))
            {
                using var k = esrt.OpenSubKey(name, writable: false);
                if (k == null) continue;
                if (k.GetValue("Version") != null) Entry(k, name);
                else foreach (var inner in k.GetSubKeyNames().Take(40)) { using var ik = k.OpenSubKey(inner, writable: false); if (ik != null) Entry(ik, inner); }
            }
        var answer = new JsonObject { ["firmware"] = rows };
        if (rows.Count == 0) answer["found"] = "this PC's firmware doesn't list any firmware Windows can update";
        return answer;
    }

    /// For the self-test: the table loads, the parsers work, and each source answers or says plainly why it can't.
    public static IEnumerable<string> SelfChecks(string? owner)
    {
        foreach (var p in LogParse.SelfChecks()) yield return p;
        if (Rules.Topics.Count < 10 || !Rules.Files.ContainsKey("setupapi") || !Rules.Bugchecks.ContainsKey("0x00000124")) yield return "the log table is wrong";
        foreach (var (topic, t) in Rules.Topics)
            foreach (var q in t.Queries)
                if (!LogParse.Channel.IsMatch(q.Channel) || q.Providers.Any(p => !LogParse.Provider.IsMatch(p))) yield return $"topic {topic} has a channel or source name the checks refuse";
        foreach (var f in Rules.FactRules)
        {
            if (!LogParse.Provider.IsMatch(f.Provider) || f.Ids.Length == 0) yield return $"the facts for {f.Provider} name a source or ids the checks refuse";
            foreach (var field in f.Fields) if (!LogParse.IsFactType(field.Type) || field.From.Length == 0) yield return $"the {field.Key} fact of {f.Provider} has no type or place to read";
        }
        static string? Fails(Func<string> f, out string text) { text = ""; try { text = f(); return null; } catch (Exception e) { return e.Message; } }
        var reads = new (string Name, JsonObject Req)[]
        {
            ("System events", new JsonObject { ["source"] = "events", ["channel"] = "System", ["hours"] = 168, ["max"] = 5 }),
            ("System events with their messages", new JsonObject { ["source"] = "events", ["channel"] = "System", ["hours"] = 168, ["max"] = 5, ["text"] = true }),
            ("a crashes topic", new JsonObject { ["source"] = "topic", ["topic"] = "crashes", ["hours"] = 720 }),
            ("Reliability Monitor", new JsonObject { ["source"] = "reliability", ["max"] = 5 }),
            ("a Defender topic", new JsonObject { ["source"] = "topic", ["topic"] = "protection", ["hours"] = 168 }),
            ("every topic", new JsonObject { ["source"] = "topic", ["topic"] = "power", ["max"] = 3 }),
            ("channels", new JsonObject { ["source"] = "channels", ["find"] = "Kernel" }),
            ("crashes", new JsonObject { ["source"] = "crashes" }),
            ("crash reports", new JsonObject { ["source"] = "wer", ["max"] = 3 }),
            ("setupapi", new JsonObject { ["source"] = "file", ["file"] = "setupapi", ["lines"] = 3 }),
            ("CBS", new JsonObject { ["source"] = "file", ["file"] = "cbs", ["lines"] = 5 }),
            ("a vendor listing", new JsonObject { ["source"] = "vendor", ["vendor"] = "nvidia" }),
            ("firmware updates", new JsonObject { ["source"] = "esrt" }),
        };
        foreach (var (name, req) in reads)
        {
            if (Fails(() => Read(req, owner), out var text) is string why) { yield return $"the {name} log read failed: {why}"; continue; }
            if (text.Length > Rules.Limits.TextChars + 1000) yield return $"the {name} log read came back with {text.Length} characters";
            // Without text, no event, record or report carries a message.
            if (req["text"] == null && text.Contains("\"message\":", StringComparison.Ordinal)) yield return $"the {name} log read gave a message without text";
        }
        // A missing channel says so instead of failing.
        if (Fails(() => Read(new JsonObject { ["source"] = "events", ["channel"] = "Rig-No-Such-Log/Operational" }, owner), out var missing) != null || !missing.Contains("no such event log", StringComparison.Ordinal))
            yield return "a channel that isn't there wasn't said plainly";
        // Outside a vendor's folders, or not a log, is refused.
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        foreach (var path in new[] { Path.Combine(windows, "System32", "drivers", "etc", "hosts"), Path.Combine(windows, "win.ini"), @"C:\ProgramData\NVIDIA Corporation\..\Microsoft\x.log" })
            if (Fails(() => Read(new JsonObject { ["source"] = "vendor", ["vendor"] = "nvidia", ["file"] = path }, owner), out _) == null) yield return $"a vendor read of {path} wasn't refused";
        if (Fails(() => Read(new JsonObject { ["source"] = "events", ["channel"] = "System'] or 1=1" }, owner), out _) == null) yield return "a channel name with a quote wasn't refused";
    }
}
