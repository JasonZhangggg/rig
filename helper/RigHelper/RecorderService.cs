// Rig's background recorder: RigHelper run as a Windows service (--service).
// It starts with Windows, has no window, and keeps a log that the Rig app
// reads, whether or not the app is open. Every few seconds it reads the
// sensors; every half minute it writes one reading; when something looks
// wrong (heat, a sudden jump, full memory, a crash or hardware error) it
// writes the last few minutes it held in memory and then every reading for a
// while. It also writes Windows' crash, error and power events as they
// happen, and sleep, wake and battery changes. It changes nothing on the PC.

using System.Diagnostics;
using System.Diagnostics.Eventing.Reader;
using System.Runtime;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public sealed class RecorderService : ServiceBase
{
    RecorderCore? core;
    Thread? thread;
    readonly CancellationTokenSource cts = new();

    public RecorderService()
    {
        ServiceName = RecorderPaths.ServiceName;
        CanStop = true;
        CanShutdown = true;
        CanHandlePowerEvent = true;
        AutoLog = false;
    }

    protected override void OnStart(string[] args)
    {
        core = new RecorderCore(RecorderPaths.Data, onSelfRemove: Stop);
        thread = new Thread(() => core.Run(cts.Token)) { IsBackground = true, Name = "Rig recorder" };
        thread.Start();
    }

    protected override void OnStop() => Halt("stop");
    protected override void OnShutdown() => Halt("shutdown");

    protected override bool OnPowerEvent(PowerBroadcastStatus status)
    {
        core?.Power(status);
        return true;
    }

    void Halt(string why)
    {
        cts.Cancel();
        // The recorder's own thread stops the service when it removes itself; it can't wait for itself.
        if (thread != null && thread != Thread.CurrentThread) thread.Join(TimeSpan.FromSeconds(15));
        core?.Close(why);
    }
}

public sealed class RecorderCore(string dataDir, Action? onSelfRemove = null)
{
    public const int TickMs = 5_000;
    public const int SampleEveryMs = 30_000;
    public const int AppsEveryMs = 60_000;
    /// A closer look lasts this long after the last thing that started it, and at most MaxDetailMs.
    public const int DetailMs = 3 * 60_000, MaxDetailMs = 15 * 60_000;
    const int StatusEveryMs = 60_000;
    const int PruneEveryMs = 6 * 3600_000;
    const int WatchdogEveryMs = 30 * 60_000;
    /// The garbage collector sizes its youngest generation from the processor's cache, often tens of megabytes, so the
    /// recorder's small, steady garbage would grow its memory for a long while before the first collection. Collecting
    /// that generation now and then (a millisecond or so) keeps it flat. A forced one is needed: an "optimized" one
    /// skips until the generation is nearly full.
    const int YoungGcEveryMs = 5 * 60_000;
    /// Events from before the recorder's first start: this many days back.
    const int BackfillDays = 30;
    const int BackfillPerQuery = 400;

    static string Version => typeof(RecorderCore).Assembly.GetName().Version?.ToString() ?? "0";
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    readonly LogWriter log = new(RecorderPaths.Logs(dataDir));
    readonly Watch watch = new();
    readonly Ring ring = new(60);
    readonly SensorKey sensorKey = new();
    readonly object gate = new();
    readonly HashSet<string> seenEvents = [];
    readonly List<EventLogWatcher> watchers = [];
    long lastEventT;
    long startedAt;
    ProbeEngine? probes;
    string state = "running";
    readonly object statusGate = new();
    long lastT;
    long wokeAt;
    bool? onAc;
    int missingInstalls;
    bool closed;

    /// Runs until cancelled. Exceptions in one round are written to the log and the next round carries on.
    public void Run(CancellationToken stop)
    {
        startedAt = Now;
        Efficiency.Apply();
        var prev = ReadStatus();
        lastEventT = Json.Num(prev?["lastEventT"], 0) is double le && le > 0 ? (long)le : 0;
        var start = LogLine.Of("start", startedAt);
        start["v"] = Version;
        start["boot"] = startedAt - Environment.TickCount64;
        if (prev?["lastT"] is JsonNode pt)
        {
            string was = prev["state"]?.GetValue<string>() ?? "running";
            start["prev"] = new JsonObject { ["t"] = pt.DeepClone(), ["state"] = was, ["clean"] = was == "stopped" };
        }
        log.Write(start, essential: true);
        WriteStatus("running");
        Prune();

        Sensors? hw = null;
        try { hw = new Sensors(storage: false); }
        catch (Exception e) { Note($"Couldn't open the sensors: {e.Message}"); }
        // Closed when the recorder stops, so the sensor driver is let go of too.
        using var closeSensors = hw;

        StartEvents();
        PowerNow();
        probes = new ProbeEngine(dataDir, Note, () => WriteStatus(state));
        probes.Start();
        // Opening the sensors and reading back a month of Windows' events leaves a few megabytes of garbage behind.
        // Hand it back once, so the recorder sits at its running size from the start rather than its startup peak.
        GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
        GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true);

        string header = "";
        int headerId = 0, headerFile = -1;
        long lastSample = 0, lastApps = 0, lastStatus = Now, lastPrune = Now, lastWatchdog = Now, lastYoungGc = Now, detailFrom = 0, detailUntil = 0, lastRound = 0;
        int failures = 0;

        while (!stop.IsCancellationRequested)
        {
            long now = Now;
            (List<SensorDto> Kept, Reading Reading)? lastReading = null;
            try
            {
                if (hw != null)
                {
                    var sensors = hw.Readings();
                    var kept = LogSensors.Pick(sensors);
                    string key = sensorKey.Of(kept);
                    if (key != header || headerFile != log.FileNumber)
                    {
                        // A new sensor list (a part woke up, a new day's file): readers need it before the next reading.
                        if (key != header) headerId++;
                        header = key;
                        log.Write(LogLine.Sensors(now, kept), essential: true);
                        headerFile = log.FileNumber;
                    }
                    var reading = Reading.From(now, kept);
                    probes?.Publish(new ProbeEngine.Snap(now, sensors, reading));
                    lastReading = (kept, reading);
                }
                // The sensors are read every second while a custom log wants them that often; the recorder's own rounds stay five seconds apart.
                if (hw != null && lastReading != null && now - lastRound >= TickMs - 500)
                {
                    lastRound = now;
                    var (kept, reading) = lastReading.Value;
                    var values = kept.Select(s => s.Value).ToArray();
                    bool detail = now < detailUntil;
                    bool wantApps = detail || now - lastApps >= AppsEveryMs;
                    bool due = detail || now - lastSample >= SampleEveryMs;
                    List<ProcessDto>? top = due && wantApps ? SafeTop(fresh: detail) : null;
                    if (top != null) lastApps = now;
                    var entry = new Ring.Entry(now, values, top, headerId);

                    // Right after waking, temperatures jump as fans catch up; give it a minute before judging.
                    (string Why, string Text)? fired = null;
                    if (now - wokeAt > 60_000) lock (gate) fired = watch.Check(reading);
                    // A crash or hardware event seen by the event watcher already wrote its marker line.
                    bool fromEvent = Interlocked.Exchange(ref pendingDetail, 0) == 1;
                    if (fired != null || fromEvent)
                    {
                        if (!detail) detailFrom = now;
                        detailUntil = Math.Min(now + DetailMs, detailFrom + MaxDetailMs);
                        if (fired is { } hit) Marker(now, hit.Why, hit.Text);
                        // What led up to it: the readings held in memory that aren't in the log yet.
                        foreach (var e in ring.TakeUnwritten(headerId, before: now)) log.Write(LogLine.Sample(e.T, e.Values, e.Top, detail: true));
                        if (top == null) { top = SafeTop(fresh: true); if (top != null) lastApps = now; entry = entry with { Top = top }; }
                        detail = true;
                    }

                    if (due || detail)
                    {
                        entry.Written = true;
                        log.Write(LogLine.Sample(now, values, entry.Top, detail), flush: true);
                        lastSample = now;
                    }
                    ring.Add(entry);
                }
                lastT = now;
                failures = 0;
            }
            catch (Exception e)
            {
                if (++failures <= 3) Note($"A reading failed: {e.Message}");
            }

            if (now - lastStatus >= StatusEveryMs) { lastStatus = now; WriteStatus("running"); PowerNow(); }
            if (now - lastPrune >= PruneEveryMs) { lastPrune = now; Prune(); }
            if (now - lastWatchdog >= WatchdogEveryMs) { lastWatchdog = now; if (Watchdog()) return; }
            if (now - lastYoungGc >= YoungGcEveryMs) { lastYoungGc = now; GC.Collect(0, GCCollectionMode.Forced, blocking: false); }

            stop.WaitHandle.WaitOne(probes?.WantsFastSensors == true ? 1000 : TickMs);
        }
    }

    /// fresh: false is the regular once-a-minute list, which may reuse a graphics share from a few minutes ago; a closer look reads it now.
    List<ProcessDto>? SafeTop(bool fresh)
    {
        try { return Processes.Top(5, fresh); } catch { return null; }
    }

    /// The line that says a closer look started, and why.
    void Marker(long t, string why, string text)
    {
        var a = LogLine.Of("anomaly", t);
        a["why"] = why;
        a["text"] = text;
        log.Write(a, essential: true, flush: true);
    }

    /// Called from an event callback: a crash or hardware error starts a closer look too. The loop picks it up on its next round.
    void EventAnomaly(EventDto e)
    {
        (string Why, string Text)? hit;
        lock (gate) hit = watch.Check(e);
        if (hit is not { } h) return;
        Marker(Now, h.Why, h.Text);
        Interlocked.Exchange(ref pendingDetail, 1);
    }
    int pendingDetail;

    // ----- Windows events -----

    /// What the recorder reads from the event log: every critical and error, warnings from the sources that explain
    /// hardware and driver trouble, and the power events that show when the PC started, shut down or restarted and why.
    public static IEnumerable<(string Log, string Xpath)> Queries(string? since)
    {
        string time = since == null ? "" : $" and TimeCreated[@SystemTime>'{since}']";
        string sources = string.Join(" or ", EventLogs.WarningSources.Select(s => $"@Name='{s}'"));
        yield return ("System", $"*[System[(Level=1 or Level=2){time}]]");
        yield return ("System", $"*[System[Provider[{sources}] and (Level=3){time}]]");
        yield return ("System", $"*[System[((Provider[@Name='Microsoft-Windows-Kernel-General'] and (EventID=12 or EventID=13)) or (Provider[@Name='User32'] and EventID=1074)){time}]]");
        yield return ("Application", $"*[System[(Level=1 or Level=2){time}]]");
    }

    public static string LevelWord(byte? level) => level switch { 1 => "critical", 2 => "error", 3 => "warning", _ => "info" };

    void StartEvents()
    {
        // Watch first, then read what landed while the recorder wasn't running; seenEvents drops the overlap.
        foreach (var (logName, xpath) in Queries(null))
        {
            try
            {
                var w = new EventLogWatcher(new EventLogQuery(logName, PathType.LogName, xpath));
                w.EventRecordWritten += (_, a) => { if (a.EventRecord is EventRecord r) using (r) Take(logName, r, live: true); };
                w.Enabled = true;
                watchers.Add(w);
            }
            catch (Exception e) { Note($"Couldn't watch the {logName} event log: {e.Message}"); }
        }

        long from = Math.Max(lastEventT, Now - BackfillDays * 86_400_000L);
        string since = DateTimeOffset.FromUnixTimeMilliseconds(from).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        var found = new List<(string log, EventRecord rec)>();
        foreach (var (logName, xpath) in Queries(since))
        {
            try
            {
                using var reader = new EventLogReader(new EventLogQuery(logName, PathType.LogName, xpath) { ReverseDirection = true });
                for (int n = 0; n < BackfillPerQuery; n++)
                {
                    var rec = reader.ReadEvent();
                    if (rec == null) break;
                    found.Add((logName, rec));
                }
            }
            catch (Exception e) { Note($"Couldn't read the {logName} event log: {e.Message}"); }
        }
        foreach (var (logName, rec) in found.OrderBy(f => f.rec.TimeCreated ?? DateTime.MinValue))
            using (rec) Take(logName, rec, live: false);
    }

    void Take(string logName, EventRecord rec, bool live)
    {
        try
        {
            if (rec.TimeCreated is not DateTime at) return;
            string key = $"{logName}|{rec.RecordId}|{at.Ticks}";
            lock (gate)
            {
                if (!seenEvents.Add(key)) return;
                if (seenEvents.Count > 5000) seenEvents.Clear();
            }
            var e = new EventDto(new DateTimeOffset(at.ToUniversalTime()).ToUnixTimeMilliseconds(), logName, rec.ProviderName ?? "Unknown", rec.Id, LevelWord(rec.Level), EventLogs.Message(rec));
            log.Write(LogLine.Event(e), essential: true, flush: true);
            lock (gate) lastEventT = Math.Max(lastEventT, e.T);
            if (live) EventAnomaly(e);
        }
        catch (Exception ex) { Note($"Couldn't read an event: {ex.Message}"); }
    }

    // ----- Power -----

    public void Power(PowerBroadcastStatus s)
    {
        long now = Now;
        switch (s)
        {
            case PowerBroadcastStatus.Suspend:
                PowerLine(now, "sleep", null);
                WriteStatus("asleep");
                break;
            case PowerBroadcastStatus.ResumeSuspend:
            case PowerBroadcastStatus.ResumeAutomatic:
                // Windows sends both on a normal wake; write it once.
                if (now - wokeAt > 30_000) { wokeAt = now; PowerLine(now, "wake", null); WriteStatus("running"); }
                break;
            case PowerBroadcastStatus.PowerStatusChange:
                PowerNow();
                break;
        }
    }

    /// Writes a line when the PC moves between the charger and its battery. PCs without a battery never write one.
    void PowerNow()
    {
        if (!Native.GetSystemPowerStatus(out var p) || (p.BatteryFlag & 128) != 0 || p.ACLineStatus > 1) return;
        bool ac = p.ACLineStatus == 1;
        if (onAc == ac) return;
        bool first = onAc == null;
        onAc = ac;
        // The first check only says where things stand when the recorder starts.
        PowerLine(Now, ac ? "ac" : "battery", p.BatteryLifePercent <= 100 ? p.BatteryLifePercent : null, first);
    }

    void PowerLine(long t, string what, int? pct, bool atStart = false)
    {
        var o = LogLine.Of("power", t);
        o["what"] = what;
        if (pct != null) o["pct"] = pct;
        if (atStart) o["atStart"] = true;
        log.Write(o, essential: true, flush: true);
    }

    // ----- Housekeeping -----

    void Note(string text)
    {
        var o = LogLine.Of("note", Now);
        o["text"] = EventLogs.Clean(text, 300);
        log.Write(o, essential: true);
    }

    JsonObject? ReadStatus()
    {
        try { return JsonNode.Parse(File.ReadAllText(RecorderPaths.Status(dataDir))) as JsonObject; } catch { return null; }
    }

    /// status.json: what the Rig app shows about the recorder, and how the next start tells a clean stop from power loss.
    void WriteStatus(string state)
    {
        try
        {
            long le;
            lock (gate) le = lastEventT;
            this.state = state;
            var o = new JsonObject
            {
                ["state"] = state, ["v"] = Version, ["pid"] = Environment.ProcessId, ["startedAt"] = startedAt,
                ["lastT"] = lastT > 0 ? lastT : Now, ["lastEventT"] = le,
            };
            if (probes != null) o["probes"] = probes.Status();
            string path = RecorderPaths.Status(dataDir), tmp = path + ".tmp";
            lock (statusGate)
            {
                File.WriteAllText(tmp, o.ToJsonString());
                File.Move(tmp, path, overwrite: true);
            }
        }
        catch { }
    }

    void Prune()
    {
        try
        {
            var dir = new DirectoryInfo(RecorderPaths.Logs(dataDir));
            if (!dir.Exists) return;
            var files = dir.GetFiles().Select(f => (f.Name, f.Length)).ToList();
            foreach (var name in LogFiles.Prune(files, Now))
                try { File.Delete(Path.Combine(dir.FullName, name)); } catch { }
        }
        catch { }
    }

    /// When Rig has been uninstalled without removing the recorder (the uninstaller's Windows prompt was refused),
    /// the recorder removes itself. True when it did and should stop.
    bool Watchdog()
    {
        var dirs = RecorderSetup.InstallDirs(dataDir);
        if (dirs.Count == 0 || dirs.Any(d => File.Exists(Path.Combine(d, "Rig.exe")))) { missingInstalls = 0; return false; }
        // Two checks in a row, half an hour apart, so an update that swaps files doesn't count.
        if (++missingInstalls < 2) return false;
        Close("uninstalled");
        RecorderSetup.RemoveSelf();
        onSelfRemove?.Invoke();
        return true;
    }

    public void Close(string why)
    {
        lock (gate) { if (closed) return; closed = true; }
        foreach (var w in watchers) { try { w.Enabled = false; w.Dispose(); } catch { } }
        try { probes?.Dispose(); } catch { }
        var o = LogLine.Of("stop", Now);
        o["why"] = why;
        log.Write(o, essential: true, flush: true);
        log.Dispose();
        WriteStatus("stopped");
    }

    /// Runs the recorder in this process for a while, writing to dataDir: for the CI smoke test and for checking a PC by hand.
    public static int RunFor(string dataDir, int seconds)
    {
        Directory.CreateDirectory(dataDir);
        var core = new RecorderCore(dataDir);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(seconds));
        core.Run(cts.Token);
        core.Close("stop");
        return 0;
    }
}

/// Appends lines to today's file. Safe to call from any thread.
public sealed class LogWriter(string dir) : IDisposable
{
    readonly object gate = new();
    FileStream? fs;
    string? name;
    bool capped;
    bool disposed;

    /// Goes up by one each time a new file is opened, so the loop knows to write the sensor list again.
    public int FileNumber { get; private set; }

    /// Writes one line. Readings stop past the day's cap; essential lines (events, power, start and stop) carry on to twice the cap.
    /// flush puts it on the disk itself, so it survives the PC losing power right after.
    public void Write(JsonObject line, bool essential = false, bool flush = false)
    {
        lock (gate)
        {
            if (disposed) return;
            try
            {
                long t = (long)Json.Num(line["t"], 0);
                string want = LogFiles.NameFor(Math.Max(t, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
                if (fs == null || name != want) Open(want);
                long size = fs!.Length;
                if (size >= LogFiles.DayCap * (essential ? 2 : 1))
                {
                    if (!capped && size < LogFiles.DayCap * 2) { capped = true; Append(new JsonObject { ["k"] = "note", ["t"] = t, ["text"] = "Today's log is full, so only events are kept until tomorrow." }); }
                    return;
                }
                Append(line);
                fs.Flush(flush);
            }
            catch { /* a full or locked drive: drop the line rather than stop recording */ }
        }
    }

    void Append(JsonObject line)
    {
        var bytes = Encoding.UTF8.GetBytes(line.ToJsonString() + "\n");
        fs!.Write(bytes, 0, bytes.Length);
    }

    void Open(string file)
    {
        fs?.Dispose();
        Directory.CreateDirectory(dir);
        // Others may read (the Rig app) and delete (pruning) while it's open.
        fs = new FileStream(Path.Combine(dir, file), FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
        // A line cut short by power loss would glue onto the next one; start on a fresh line.
        if (fs.Length > 0) { fs.Write("\n"u8); }
        name = file;
        capped = false;
        FileNumber++;
    }

    public void Dispose()
    {
        lock (gate) { disposed = true; try { fs?.Flush(true); fs?.Dispose(); } catch { } fs = null; }
    }
}

/// Keeps the recorder light: lower priority, and Windows' efficiency mode (EcoQoS) so it runs on the slow cores at low clocks.
static class Efficiency
{
    public static void Apply()
    {
        using var me = Process.GetCurrentProcess();
        try { me.PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }
        try
        {
            var state = new Native.PROCESS_POWER_THROTTLING_STATE { Version = 1, ControlMask = 1, StateMask = 1 };
            Native.SetProcessInformation(me.Handle, Native.ProcessPowerThrottling, ref state, Marshal.SizeOf<Native.PROCESS_POWER_THROTTLING_STATE>());
        }
        catch { }
    }
}
