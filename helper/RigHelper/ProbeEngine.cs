// Runs the custom logs in probes.json (see Probes.cs) inside the background
// recorder: one thread checks the list each second (every 15 seconds while
// there are none, woken early when probes.json changes), decides which are
// due, and reads each on the thread pool so a slow one (a big folder, a script)
// never holds up the rest. Each Windows account's custom logs go to its own
// folder of daily files, in the same line format as the main log.
//
// Lines it writes:
//   probe  a custom log started or stopped: {id, what: "on" | "off", why?, spec?}
//   p      one reading: {id, v} | an event: {id, e} | the condition changed: {id, when, cv?} | a problem: {id, err}

using System.Diagnostics;
using System.Diagnostics.Eventing.Reader;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

public sealed class ProbeEngine(string data, Action<string> note, Action changed) : IDisposable
{
    /// The latest sensor reading from the recorder's main loop.
    public sealed record Snap(long T, IReadOnlyList<SensorDto> Sensors, Reading Reading);

    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    const int PruneEveryMs = 6 * 3600_000;
    /// How long the loop sleeps while there are no custom logs. A change to probes.json wakes it sooner.
    public const int IdleMs = 15_000;
    const long CustomMaxBytes = 100L << 20;

    readonly Dictionary<string, Runner> runners = [];
    readonly Dictionary<string, LogWriter> writers = [];
    readonly object gate = new();
    readonly CancellationTokenSource cts = new();
    Thread? thread;
    volatile Snap? latest;
    DateTime stamp = DateTime.MinValue;
    long lastPrune;
    List<string> problems = [];
    int loopFailures;
    readonly AutoResetEvent wake = new(false);
    FileSystemWatcher? watcher;
    int rounds;

    /// How many times the loop has run, for the self-test.
    public int Rounds => Volatile.Read(ref rounds);

    /// True while a custom log reads the sensors more often than the main loop's five seconds.
    public bool WantsFastSensors { get; private set; }

    public void Publish(Snap s) => latest = s;

    public void Start()
    {
        // The Rig app adds, approves and removes custom logs from other processes by rewriting probes.json.
        try
        {
            watcher = new FileSystemWatcher(data, Path.GetFileName(ProbeStore.PathIn(data)))
            {
                IncludeSubdirectories = false,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            };
            watcher.Created += (_, _) => Wake();
            watcher.Changed += (_, _) => Wake();
            watcher.Deleted += (_, _) => Wake();
            watcher.Renamed += (_, _) => Wake();
            watcher.Error += (_, _) => Wake();
            watcher.EnableRaisingEvents = true;
        }
        catch { watcher?.Dispose(); watcher = null; }
        thread = new Thread(Loop) { IsBackground = true, Name = "Rig custom logs", Priority = ThreadPriority.BelowNormal };
        thread.Start();
    }

    void Wake()
    {
        try { wake.Set(); } catch (ObjectDisposedException) { }
    }

    void Loop()
    {
        var stop = cts.Token;
        var waits = new[] { stop.WaitHandle, wake };
        while (!stop.IsCancellationRequested)
        {
            long now = Now;
            Interlocked.Increment(ref rounds);
            try
            {
                Reload(now);
                Tick(now);
                if (now - lastPrune >= PruneEveryMs) { lastPrune = now; Prune(now); }
                loopFailures = 0;
            }
            catch (Exception e) { if (++loopFailures <= 3) note($"Custom logs: {e.Message}"); }
            bool idle;
            lock (gate) idle = runners.Count == 0;
            // Without a watcher on probes.json, keep looking every second so a new custom log isn't missed for long.
            WaitHandle.WaitAny(waits, idle && watcher != null ? IdleMs : 1000);
        }
    }

    /// Picks up changes to probes.json, and stops custom logs that have reached their end.
    void Reload(long now)
    {
        string path = ProbeStore.PathIn(data);
        DateTime t = File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.MinValue;
        bool ended;
        lock (gate) ended = runners.Values.Any(r => now >= r.Spec.ExpiresAt);
        if (t == stamp && !ended) return;
        stamp = t;
        var errs = new List<string>();
        var list = ProbeStore.Load(data, now, errs);
        lock (gate)
        {
            foreach (var id in runners.Keys.ToList())
            {
                var r = runners[id];
                var next = list.FirstOrDefault(p => p.Id == id);
                if (next != null && next.ToJson().ToJsonString() == r.Spec.ToJson().ToJsonString()) continue;
                r.Stop(now, next != null ? "changed" : now >= r.Spec.ExpiresAt ? "ended" : "removed");
                r.Dispose();
                runners.Remove(id);
            }
            foreach (var p in list)
            {
                if (runners.ContainsKey(p.Id)) continue;
                var r = new Runner(p, Writer(p.Owner), data);
                runners[p.Id] = r;
                r.Start(now);
            }
            problems = errs;
            WantsFastSensors = runners.Values.Any(r => !r.Spec.Paused && (r.Spec.Kind == "sensor" || r.Spec.When?.Metric != null) && r.Quickest < 5);
        }
        // Tidy the file of ones that ended; the system may write it.
        if (ended) try { ProbeStore.Save(data, list); stamp = File.GetLastWriteTimeUtc(path); } catch { }
        changed();
    }

    LogWriter Writer(string owner)
    {
        if (!writers.TryGetValue(owner, out var w)) writers[owner] = w = new LogWriter(ProbeStore.OwnerFolder(data, owner));
        return w;
    }

    void Tick(long now)
    {
        var snap = latest;
        // A reading more than 15 seconds old means the main loop isn't reading the sensors; don't pass it off as current.
        if (snap != null && now - snap.T > 15_000) snap = null;
        List<Runner> list;
        lock (gate) list = [.. runners.Values];
        double? Other(string id) { lock (gate) return runners.TryGetValue(id, out var r) ? r.Primary : null; }
        foreach (var r in list) r.Tick(now, snap, Other);
    }

    void Prune(long now)
    {
        try
        {
            var root = new DirectoryInfo(Path.Combine(data, "custom"));
            if (!root.Exists) return;
            foreach (var dir in root.GetDirectories())
            {
                var files = dir.GetFiles().Select(f => (f.Name, f.Length)).ToList();
                foreach (var name in LogFiles.Prune(files, now, LogFiles.KeepDays, CustomMaxBytes))
                    try { File.Delete(Path.Combine(dir.FullName, name)); } catch { }
            }
        }
        catch { }
    }

    /// For status.json: each custom log, whether it's working, and when it last wrote.
    public JsonObject Status()
    {
        var arr = new JsonArray();
        List<string> errs;
        lock (gate)
        {
            foreach (var r in runners.Values) arr.Add(r.Status());
            errs = problems;
        }
        var o = new JsonObject { ["list"] = arr };
        if (errs.Count > 0)
        {
            var p = new JsonArray();
            foreach (var e in errs.Take(10)) p.Add(EventLogs.Clean(e, 200));
            o["problems"] = p;
        }
        return o;
    }

    public void Dispose()
    {
        cts.Cancel();
        if (thread != null && thread != Thread.CurrentThread) thread.Join(TimeSpan.FromSeconds(10));
        watcher?.Dispose();
        watcher = null;
        long now = Now;
        lock (gate)
        {
            foreach (var r in runners.Values) { r.Stop(now, "stop"); r.Dispose(); }
            runners.Clear();
            foreach (var w in writers.Values) w.Dispose();
            writers.Clear();
        }
    }
}

/// One custom log at work.
sealed class Runner(ProbeSpec spec, LogWriter log, string data) : IDisposable
{
    public ProbeSpec Spec { get; } = spec;
    readonly ProbeReader reader = new(spec, data);
    readonly object gate = new();
    EventLogWatcher? watcher;
    Task? busy;
    long lastRun, condSince = -1, dayBytes;
    int file = -1, failures;
    string day = "";
    bool capped;

    public double? Primary => reader.Primary;
    public string? Error { get; private set; }
    public long LastT { get; private set; }
    /// Whether the condition holds now.
    public bool On { get; private set; }
    public int Quickest => new[] { Spec.Every, Spec.Fast }.Where(x => x > 0).DefaultIfEmpty(int.MaxValue).Min();

    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    JsonObject Line(long t)
    {
        var o = LogLine.Of("p", t);
        o["id"] = Spec.Id;
        return o;
    }

    public void Start(long now)
    {
        Header(now, "on", null);
        if (Spec.Kind != "events" || Spec.Paused) return;
        try
        {
            string channel = Spec.Source["channel"]!.GetValue<string>(), query = Spec.Source["query"]!.GetValue<string>();
            watcher = new EventLogWatcher(new EventLogQuery(channel, PathType.LogName, query));
            watcher.EventRecordWritten += (_, a) =>
            {
                if (a.EventRecord is EventRecord r) using (r) OnEvent(channel, r);
                else if (a.EventException is Exception ex) Fail(Now, ex);
            };
            watcher.Enabled = true;
        }
        catch (Exception e) { Fail(now, e); }
    }

    void OnEvent(string channel, EventRecord r)
    {
        try
        {
            long t = r.TimeCreated is DateTime at ? new DateTimeOffset(at.ToUniversalTime()).ToUnixTimeMilliseconds() : Now;
            var o = Line(t);
            o["e"] = new JsonObject
            {
                ["log"] = channel, ["source"] = r.ProviderName ?? "Unknown", ["id"] = r.Id,
                ["level"] = RecorderCore.LevelWord(r.Level), ["message"] = EventLogs.Message(r),
            };
            Write(o, essential: false);
            LastT = t;
        }
        catch (Exception e) { Fail(Now, e); }
    }

    void Header(long t, string what, string? why)
    {
        var o = LogLine.Of("probe", t);
        o["id"] = Spec.Id;
        o["what"] = what;
        if (why != null) o["why"] = why;
        if (what == "on") o["spec"] = Spec.ToJson(withOwner: false);
        log.Write(o, essential: true, flush: true);
        file = log.FileNumber;
    }

    void Write(JsonObject o, bool essential)
    {
        lock (gate)
        {
            long t = (long)Json.Num(o["t"], Now);
            string d = LogFiles.NameFor(t);
            if (d != day) { day = d; dayBytes = 0; capped = false; }
            if (dayBytes >= ProbeRules.ProbeDayCap && !essential)
            {
                if (!capped)
                {
                    capped = true;
                    var n = Line(t);
                    n["err"] = "This custom log reached its limit for the day; it carries on tomorrow.";
                    log.Write(n, essential: true);
                }
                return;
            }
            string text = o.ToJsonString();
            dayBytes += text.Length + 1;
            log.Write(o, essential, flush: essential);
            // A new day's file: readers that start there need to know what this log is.
            if (log.FileNumber != file) Header(t, "on", null);
        }
    }

    void Fail(long t, Exception e)
    {
        Error = e is RigException ? e.Message : EventLogs.Clean(e.Message, 200);
        // The first time, then once an hour or so at one reading a minute: enough to see, never a flood.
        if (++failures == 1 || failures % 60 == 0)
        {
            var o = Line(t);
            o["err"] = Error;
            Write(o, essential: true);
        }
    }

    static double? Metric(Reading? r, string m) => r == null ? null : m switch
    {
        "cpuTemp" => r.Cpu, "gpuTemp" => r.Gpu, "cpuLoad" => r.CpuLoad, "memLoad" => r.Mem, _ => null,
    };

    public void Tick(long now, ProbeEngine.Snap? snap, Func<string, double?> other)
    {
        if (Spec.Paused || Spec.Kind == "events") return;
        bool on = false;
        if (Spec.When is { } w)
        {
            double? v = w.Metric != null ? Metric(snap?.Reading, w.Metric) : other(w.Probe!);
            bool holds = v is double d && w.Holds(d);
            if (!holds) condSince = -1;
            else if (condSince < 0) condSince = now;
            bool nowOn = holds && now - condSince >= w.ForSec * 1000L;
            if (nowOn != On)
            {
                On = nowOn;
                var o = Line(now);
                o["when"] = nowOn;
                if (v is double dv) o["cv"] = Math.Round(dv, 2);
                Write(o, essential: true);
            }
            on = On;
        }
        int interval = on && Spec.Fast > 0 ? Spec.Fast : Spec.Every;
        if (interval == 0 || now - lastRun < interval * 1000L - 300) return;
        if (busy is { IsCompleted: false }) return;
        lastRun = now;
        var sensors = snap?.Sensors;
        busy = Task.Run(() =>
        {
            try
            {
                var v = reader.Read(now, sensors);
                failures = 0;
                Error = null;
                if (v == null) return;
                var o = Line(now);
                o["v"] = v;
                Write(o, essential: false);
                LastT = now;
            }
            catch (Exception e) { Fail(now, e); }
        });
    }

    public void Stop(long now, string why)
    {
        try { if (watcher != null) { watcher.Enabled = false; watcher.Dispose(); watcher = null; } } catch { }
        busy?.Wait(TimeSpan.FromSeconds(why == "stop" ? 2 : 0));
        Header(now, "off", why);
    }

    public JsonObject Status()
    {
        var o = new JsonObject
        {
            ["id"] = Spec.Id, ["label"] = Spec.Label, ["kind"] = Spec.Kind, ["by"] = Spec.By, ["owner"] = Spec.Owner,
            ["createdAt"] = Spec.CreatedAt, ["expiresAt"] = Spec.ExpiresAt, ["every"] = Spec.Every,
            ["state"] = Spec.Paused ? "paused" : Error != null ? "error" : Spec.When != null && Spec.Every == 0 && !On ? "waiting" : "on",
        };
        if (Spec.Fast > 0) o["fast"] = Spec.Fast;
        if (Spec.When != null) o["when"] = Spec.When.ToJson();
        if (Error != null) o["error"] = Error;
        if (LastT > 0) o["lastT"] = LastT;
        if (Spec.IsScript)
        {
            o["admin"] = Spec.Admin;
            o["shell"] = Spec.Source["shell"]?.DeepClone();
            o["hash"] = Spec.Hash;
            o["approvedAt"] = Spec.ApprovedAt;
        }
        return o;
    }

    public void Dispose()
    {
        try { watcher?.Dispose(); } catch { }
        reader.Dispose();
    }
}

/// Reads one custom log's value. Keeps what a kind needs between reads (a counter, the last processor times).
public sealed class ProbeReader(ProbeSpec spec, string data) : IDisposable
{
    public ProbeSpec Spec { get; } = spec;
    /// The latest number it read, for conditions that read this log.
    public double? Primary { get; private set; }

    PerformanceCounter? counter;
    Dictionary<int, TimeSpan> procCpu = [];
    long procAt;
    bool? procRunning;
    string? lastTail;

    string S(string key) => Spec.Source[key]?.GetValue<string>() ?? "";

    /// Whether a custom log can be read now. Null when it can; otherwise why not, in words for the person.
    public static string? Try(ProbeSpec spec, Sensors? hw)
    {
        try
        {
            if (spec.Kind == "events")
            {
                using var r = new EventLogReader(new EventLogQuery(spec.Source["channel"]!.GetValue<string>(), PathType.LogName, spec.Source["query"]!.GetValue<string>()) { ReverseDirection = true });
                r.ReadEvent()?.Dispose();
                return null;
            }
            if (spec.Kind == "sensor" && hw == null) return null;
            using var reader = new ProbeReader(spec, RecorderPaths.Data);
            reader.Read(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), spec.Kind == "sensor" ? hw!.Snapshot().Sensors : null);
            return null;
        }
        catch (EventLogNotFoundException) { return $"There's no event log called \"{spec.Source["channel"]}\" on this PC."; }
        catch (EventLogException e) { return $"Windows didn't accept that event log query: {EventLogs.Clean(e.Message, 200)}"; }
        catch (Exception e) { return e is RigException ? e.Message : $"That can't be read on this PC: {EventLogs.Clean(e.Message, 200)}"; }
    }

    /// One reading, or null when there's nothing new to write.
    public JsonNode? Read(long now, IReadOnlyList<SensorDto>? sensors)
    {
        switch (Spec.Kind)
        {
            case "sensor": return Sensor(sensors);
            case "counter": return Counter();
            case "wmi": return Wmi();
            case "process": return ProcessUse(now);
            case "file": return FileInfoOf();
            case "folder": return Folder();
            case "registry": return RegistryValue();
            case "script": return Script();
            default: return null;
        }
    }

    JsonNode Sensor(IReadOnlyList<SensorDto>? sensors)
    {
        if (sensors == null) throw new RigException("The sensors can't be read right now.");
        string m = S("match");
        var hits = sensors.Where(s => s.Id.Equals(m, StringComparison.OrdinalIgnoreCase)).ToList();
        if (hits.Count == 0)
        {
            var words = m.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            hits = [.. sensors.Where(s => words.All(w => $"{s.HwName} {s.Type} {s.Name} {s.Id}".Contains(w, StringComparison.OrdinalIgnoreCase))).Take(8)];
        }
        if (hits.Count == 0) throw new RigException($"No sensor on this PC matches \"{m}\".");
        Primary = hits[0].Value;
        var o = new JsonObject();
        foreach (var s in hits)
        {
            string key = $"{s.Name} ({s.Type})";
            for (int i = 2; o.ContainsKey(key); i++) key = $"{s.Name} ({s.Type}) {i}";
            o[key] = s.Value is double d ? Math.Round(d, 2) : null;
        }
        return o;
    }

    static readonly Regex CounterPath = new(@"^\\([^\\()]+)(?:\(([^()\\]*)\))?\\([^\\]+)$");

    JsonNode Counter()
    {
        if (counter == null)
        {
            var m = CounterPath.Match(S("path"));
            if (!m.Success) throw new RigException("That isn't a counter path.");
            string cat = m.Groups[1].Value, inst = m.Groups[2].Value, name = m.Groups[3].Value;
            if (!PerformanceCounterCategory.Exists(cat)) throw new RigException($"There's no performance counter category \"{cat}\" on this PC.");
            if (!PerformanceCounterCategory.CounterExists(name, cat)) throw new RigException($"\"{cat}\" has no counter \"{name}\".");
            counter = new PerformanceCounter(cat, name, inst, readOnly: true);
        }
        float f = counter.NextValue();
        Primary = f;
        return Math.Round(f, 3);
    }

    JsonNode Wmi()
    {
        var scope = new ManagementScope(S("namespace"));
        var opts = new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(10), ReturnImmediately = true, Rewindable = false };
        using var searcher = new ManagementObjectSearcher(scope, new ObjectQuery(S("query")), opts);
        using var found = searcher.Get();
        var rows = new JsonArray();
        Primary = null;
        foreach (ManagementBaseObject mo in found)
        {
            using (mo)
            {
                if (rows.Count >= 20) break;
                var row = new JsonObject();
                foreach (var prop in mo.Properties)
                {
                    if (row.Count >= 16) break;
                    var v = Scalar(prop.Value);
                    row[prop.Name] = v;
                    if (Primary == null && rows.Count == 0 && v is JsonValue jv && jv.TryGetValue(out double d)) Primary = d;
                }
                rows.Add(row);
            }
        }
        return rows;
    }

    JsonNode? ProcessUse(long now)
    {
        string name = S("name");
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        var ps = Process.GetProcessesByName(name);
        try
        {
            double cpuMs = 0;
            long mem = 0;
            var seen = new Dictionary<int, TimeSpan>();
            foreach (var p in ps)
            {
                try
                {
                    var c = p.TotalProcessorTime;
                    seen[p.Id] = c;
                    if (procCpu.TryGetValue(p.Id, out var prev)) cpuMs += (c - prev).TotalMilliseconds;
                    mem += p.WorkingSet64;
                }
                catch { }
            }
            double wall = procAt > 0 ? now - procAt : 0;
            procCpu = seen;
            procAt = now;
            double cpu = wall > 0 ? Math.Round(Math.Clamp(cpuMs / wall / Environment.ProcessorCount * 100, 0, 100), 1) : 0;
            bool running = ps.Length > 0;
            string? change = procRunning == null || procRunning == running ? null : running ? "started" : "stopped";
            procRunning = running;
            Primary = running ? cpu : null;
            // While it isn't running, only the moment it stops is worth a line.
            if (!running && change == null) return null;
            var o = new JsonObject { ["running"] = running, ["count"] = ps.Length, ["cpu"] = cpu, ["memMb"] = Math.Round(mem / 1048576.0) };
            if (change != null) o["change"] = change;
            return o;
        }
        finally { foreach (var p in ps) p.Dispose(); }
    }

    JsonNode? FileInfoOf()
    {
        var fi = new FileInfo(S("path"));
        if (!fi.Exists) { Primary = null; return new JsonObject { ["exists"] = false }; }
        Primary = fi.Length;
        var o = new JsonObject { ["exists"] = true, ["bytes"] = fi.Length, ["modified"] = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeMilliseconds() };
        if (S("read") != "tail") return o;
        using var fs = new FileStream(fi.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        long start = Math.Max(0, fs.Length - 4096);
        fs.Seek(start, SeekOrigin.Begin);
        var buf = new byte[fs.Length - start];
        fs.ReadExactly(buf);
        string text = Encoding.UTF8.GetString(buf);
        if (start > 0 && text.IndexOf('\n') is int nl and >= 0) text = text[(nl + 1)..];
        text = string.Concat(text.Where(c => !char.IsControl(c) || c is '\n' or '\t')).TrimEnd();
        if (text.Length > ProbeRules.MaxOutputChars) text = text[^ProbeRules.MaxOutputChars..];
        // A log that hasn't changed isn't written again.
        if (text == lastTail) return null;
        lastTail = text;
        o["tail"] = text;
        return o;
    }

    JsonNode Folder()
    {
        var dir = new DirectoryInfo(S("path"));
        if (!dir.Exists) throw new RigException($"There's no folder at {S("path")}.");
        var opts = new System.IO.EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint, ReturnSpecialDirectories = false };
        long bytes = 0;
        int files = 0;
        bool partial = false;
        var sw = Stopwatch.StartNew();
        foreach (var f in dir.EnumerateFiles("*", opts))
        {
            try { bytes += f.Length; } catch { }
            if (++files >= 500_000 || sw.ElapsedMilliseconds > 15_000) { partial = true; break; }
        }
        Primary = bytes;
        var o = new JsonObject { ["bytes"] = bytes, ["files"] = files };
        if (partial) o["partial"] = true;
        return o;
    }

    JsonNode? RegistryValue()
    {
        string key = S("key");
        int i = key.IndexOf('\\');
        string hive = (i < 0 ? key : key[..i]).ToUpperInvariant(), sub = i < 0 ? "" : key[(i + 1)..];
        RegistryKey root;
        switch (hive)
        {
            case "HKLM" or "HKEY_LOCAL_MACHINE": root = Registry.LocalMachine; break;
            // The account that asked, not the system's own.
            case "HKCU" or "HKEY_CURRENT_USER": root = Registry.Users; sub = sub.Length == 0 ? Spec.Owner : $@"{Spec.Owner}\{sub}"; break;
            case "HKU" or "HKEY_USERS": root = Registry.Users; break;
            case "HKCR" or "HKEY_CLASSES_ROOT": root = Registry.ClassesRoot; break;
            default: root = Registry.CurrentConfig; break;
        }
        using var k = root.OpenSubKey(sub, writable: false)
            ?? throw new RigException(hive.StartsWith("HKCU") || hive == "HKEY_CURRENT_USER" ? "That key isn't there, or you're signed out of Windows." : "That registry key isn't there.");
        if (Spec.Source["value"] is JsonValue jv && jv.TryGetValue(out string? name))
        {
            object? v = k.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
            if (v == null) throw new RigException($"That key has no value called \"{name}\".");
            var s = Scalar(v);
            Primary = s is JsonValue sv && sv.TryGetValue(out double d) ? d : null;
            return new JsonObject { [name.Length == 0 ? "(default)" : name] = s };
        }
        var o = new JsonObject();
        Primary = null;
        foreach (var n in k.GetValueNames().Take(20))
        {
            var s = Scalar(k.GetValue(n, null, RegistryValueOptions.DoNotExpandEnvironmentNames));
            o[n.Length == 0 ? "(default)" : n] = s;
            if (Primary == null && s is JsonValue sv && sv.TryGetValue(out double d)) Primary = d;
        }
        return o;
    }

    JsonNode Script()
    {
        var r = Scripts.Run(Spec, data);
        Primary = double.TryParse(r.Out.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double d) ? d : null;
        var o = new JsonObject { ["exit"] = r.Exit, ["ms"] = r.Ms, ["out"] = r.Out };
        if (r.Err.Length > 0) o["err"] = r.Err;
        if (r.TimedOut) o["timedOut"] = true;
        return o;
    }

    /// A WMI or registry value as JSON: numbers as numbers, text and lists as short text.
    public static JsonNode? Scalar(object? v) => v switch
    {
        null => null,
        bool b => JsonValue.Create(b),
        string s => JsonValue.Create(EventLogs.Clean(s, 300)),
        byte[] bytes => JsonValue.Create(Convert.ToHexString(bytes, 0, Math.Min(bytes.Length, 64))),
        sbyte or byte or short or ushort or int or uint or long or ulong or float or double or decimal => JsonValue.Create(Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture)),
        Array a => JsonValue.Create(EventLogs.Clean(string.Join(", ", a.Cast<object?>().Take(20).Select(x => x?.ToString())), 300)),
        _ => JsonValue.Create(EventLogs.Clean(v.ToString() ?? "", 300)),
    };

    public void Dispose() => counter?.Dispose();
}

/// Approved scripts: written out from the approved text each time and run with a time limit, keeping the start of their output.
public static class Scripts
{
    public record Result(int Exit, long Ms, string Out, string Err, bool TimedOut);

    public static Result Run(ProbeSpec spec, string data)
    {
        // Only the exact text that was approved runs: Parse refuses a script whose hash doesn't match.
        string shell = spec.Source["shell"]!.GetValue<string>(), text = spec.Source["text"]!.GetValue<string>();
        if (spec.Hash != ProbeRules.ScriptHash(shell, spec.Admin, text)) throw new RigException("This script changed since it was approved, so it doesn't run.");
        string dir = Path.Combine(data, "scripts");
        Directory.CreateDirectory(dir);
        string file = Path.Combine(dir, spec.Id + (shell == "cmd" ? ".cmd" : ".ps1"));
        File.WriteAllText(file, text, new UTF8Encoding(encoderShouldEmitUTF8Identifier: shell != "cmd"));
        string sys = Environment.GetFolderPath(Environment.SpecialFolder.System);
        var (exe, args) = shell == "cmd"
            ? (Path.Combine(sys, "cmd.exe"), $"/d /c \"{file}\"")
            : (Path.Combine(sys, @"WindowsPowerShell\v1.0\powershell.exe"), $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{file}\"");
        int timeout = (int)Json.Num(spec.Source["timeout"], ProbeRules.DefaultScriptTimeout) * 1000;
        var sw = Stopwatch.StartNew();
        string? me = null;
        try { using var id = WindowsIdentity.GetCurrent(); me = id.User?.Value; } catch { }
        // An admin script runs with the recorder's own rights. Any other runs as the account that approved it, in its
        // own Windows session, so it has that account's rights and no more; while that account is signed out, it waits.
        var (exit, output, err, timedOut) = spec.Admin || me == spec.Owner
            ? RunHere(exe, args, timeout)
            : UserProcess.Run(spec.Owner, exe, args, timeout) ?? throw new RigException("This script runs as you, so it waits until you're signed in to Windows.");
        return new Result(exit, sw.ElapsedMilliseconds, Trim(output), Trim(err), timedOut);
    }

    static string Trim(string s)
    {
        s = string.Concat(s.Where(c => !char.IsControl(c) || c is '\n' or '\t')).Trim();
        return s.Length <= ProbeRules.MaxOutputChars ? s : s[..ProbeRules.MaxOutputChars];
    }

    static (int, string, string, bool) RunHere(string exe, string args, int timeoutMs)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetTempPath(),
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
        };
        using var p = Process.Start(psi) ?? throw new RigException("The script didn't start.");
        p.StandardInput.Close();
        var o = UserProcess.Drain(p.StandardOutput.BaseStream);
        var e = UserProcess.Drain(p.StandardError.BaseStream);
        bool done = p.WaitForExit(timeoutMs);
        if (!done) { try { p.Kill(entireProcessTree: true); } catch { } p.WaitForExit(5000); }
        return (done ? p.ExitCode : -1, UserProcess.Got(o), UserProcess.Got(e), !done);
    }
}

/// Starts a program in a signed-in account's own Windows session, with that account's token, from the system's service.
static class UserProcess
{
    /// Null when that account isn't signed in.
    public static (int Exit, string Out, string Err, bool TimedOut)? Run(string sid, string exe, string args, int timeoutMs)
    {
        IntPtr user = FindToken(sid);
        if (user == IntPtr.Zero) return null;
        IntPtr primary = IntPtr.Zero, env = IntPtr.Zero, outR = IntPtr.Zero, outW = IntPtr.Zero, errR = IntPtr.Zero, errW = IntPtr.Zero, inR = IntPtr.Zero, inW = IntPtr.Zero;
        var pi = new PROCESS_INFORMATION();
        try
        {
            if (!DuplicateTokenEx(user, MAXIMUM_ALLOWED, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out primary)) throw Win("copy your Windows sign-in for the script");
            if (!CreateEnvironmentBlock(out env, primary, false)) env = IntPtr.Zero;
            var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(), bInheritHandle = 1 };
            if (!CreatePipe(out outR, out outW, ref sa, 0) || !CreatePipe(out errR, out errW, ref sa, 0) || !CreatePipe(out inR, out inW, ref sa, 0)) throw Win("connect to the script");
            // The script gets only its own ends.
            SetHandleInformation(outR, HANDLE_FLAG_INHERIT, 0);
            SetHandleInformation(errR, HANDLE_FLAG_INHERIT, 0);
            SetHandleInformation(inW, HANDLE_FLAG_INHERIT, 0);
            var si = new STARTUPINFO
            {
                cb = Marshal.SizeOf<STARTUPINFO>(), lpDesktop = @"winsta0\default", dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
                wShowWindow = 0, hStdInput = inR, hStdOutput = outW, hStdError = errW,
            };
            var cmd = new StringBuilder($"\"{exe}\" {args}");
            if (!CreateProcessAsUser(primary, exe, cmd, IntPtr.Zero, IntPtr.Zero, true, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, env, null, ref si, out pi)) throw Win("start the script");
            Close(ref outW); Close(ref errW); Close(ref inR); Close(ref inW);
            var o = Drain(new FileStream(new SafeFileHandle(outR, ownsHandle: true), FileAccess.Read));
            outR = IntPtr.Zero;
            var e = Drain(new FileStream(new SafeFileHandle(errR, ownsHandle: true), FileAccess.Read));
            errR = IntPtr.Zero;
            bool timedOut = WaitForSingleObject(pi.hProcess, (uint)timeoutMs) != 0;
            if (timedOut)
            {
                try { using var p = Process.GetProcessById(pi.dwProcessId); p.Kill(entireProcessTree: true); } catch { }
                WaitForSingleObject(pi.hProcess, 5000);
            }
            GetExitCodeProcess(pi.hProcess, out uint code);
            return (timedOut ? -1 : unchecked((int)code), Got(o), Got(e), timedOut);
        }
        finally
        {
            Close(ref outR); Close(ref outW); Close(ref errR); Close(ref errW); Close(ref inR); Close(ref inW);
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
            Close(ref primary);
            CloseHandle(user);
        }
    }

    /// Reads a stream to its end on the thread pool, keeping the start and dropping the rest so the program never blocks on a full pipe.
    public static Task<string> Drain(Stream s) => Task.Run(() =>
    {
        using (s)
        {
            var keep = new MemoryStream();
            var buf = new byte[8192];
            int n;
            try { while ((n = s.Read(buf, 0, buf.Length)) > 0) if (keep.Length < 64 * 1024) keep.Write(buf, 0, (int)Math.Min(n, 64 * 1024 - keep.Length)); } catch { }
            return Encoding.UTF8.GetString(keep.ToArray());
        }
    });

    public static string Got(Task<string> t) => t.Wait(5000) ? t.Result : "";

    static IntPtr FindToken(string sid)
    {
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out var buf, out int count)) return IntPtr.Zero;
        try
        {
            int size = Marshal.SizeOf<WTS_SESSION_INFO>();
            IntPtr found = IntPtr.Zero;
            for (int i = 0; i < count; i++)
            {
                var s = Marshal.PtrToStructure<WTS_SESSION_INFO>(buf + i * size);
                if (s.State is not (WTSActive or WTSDisconnected)) continue;
                if (!WTSQueryUserToken(s.SessionId, out var t)) continue;
                bool match;
                try { using var id = new WindowsIdentity(t); match = id.User?.Value == sid; } catch { match = false; }
                // Prefer the session in front of the person over one left disconnected.
                if (match && (found == IntPtr.Zero || s.State == WTSActive)) { if (found != IntPtr.Zero) CloseHandle(found); found = t; }
                else CloseHandle(t);
            }
            return found;
        }
        finally { WTSFreeMemory(buf); }
    }

    static void Close(ref IntPtr h) { if (h != IntPtr.Zero) { CloseHandle(h); h = IntPtr.Zero; } }
    static RigException Win(string what) => new($"Rig couldn't {what} (Windows error {Marshal.GetLastWin32Error()}).");

    const uint MAXIMUM_ALLOWED = 0x02000000, HANDLE_FLAG_INHERIT = 1, CREATE_NO_WINDOW = 0x08000000, CREATE_UNICODE_ENVIRONMENT = 0x400;
    const int SecurityImpersonation = 2, TokenPrimary = 1, STARTF_USESTDHANDLES = 0x100, STARTF_USESHOWWINDOW = 0x1, WTSActive = 0, WTSDisconnected = 4;

    [StructLayout(LayoutKind.Sequential)] struct WTS_SESSION_INFO { public uint SessionId; public IntPtr WinStationName; public int State; }
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb; public string? lpReserved; public string? lpDesktop; public string? lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [DllImport("wtsapi32.dll", SetLastError = true)] static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr sessions, out int count);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);
    [DllImport("wtsapi32.dll", SetLastError = true)] static extern bool WTSQueryUserToken(uint session, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int level, int type, out IntPtr newToken);
    [DllImport("userenv.dll", SetLastError = true)] static extern bool CreateEnvironmentBlock(out IntPtr env, IntPtr token, bool inherit);
    [DllImport("userenv.dll")] static extern bool DestroyEnvironmentBlock(IntPtr env);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES sa, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr token, string? app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string? cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
}
