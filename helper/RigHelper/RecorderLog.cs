// Rig's background recorder: where it keeps its log, what a line looks like,
// how old logs are dropped and when a moment deserves a closer look. Pure
// code with no Windows calls, so the self-test can check it anywhere.
//
// The log is one JSON object per line, one file per UTC day, in
// %ProgramData%\Rig\Recorder\logs\YYYY-MM-DD.jsonl. Field "k" says what a line is:
//   start    the recorder started: {v, boot, prev: {t, clean}}
//   stop     it stopped on purpose: {why}
//   sensors  the sensor list the next "s" lines refer to: {list: [[id, hw, hwName, type, name], ...]}
//   s        one reading: {v: [value per sensor, in list order], top?: [busiest apps], d?: 1 when in a closer look}
//   e        a Windows event, shaped like RawEvent in packages/core/src/recordings.ts
//   power    sleep, wake, plugged in or on battery: {what, pct?}
//   anomaly  a closer look started: {why, text}
//   probe    a reading from a specific probe: {name, v}
//   note     something about the recorder itself: {text}
// Readers skip lines they don't understand, so new kinds can be added freely.

using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public static class RecorderPaths
{
    /// Set only by --selftest and by the service it installs (--service --selftest-service): the service, its folders
    /// and the ledger get names of their own, so a self-test never touches an installed Rig.
    public static bool SelfTest;
    public const string SelfTestFlag = "--selftest-service";
    static string Tail => SelfTest ? "Selftest" : "";

    public static string ServiceName => "RigRecorder" + Tail;
    public static string ExeName => $"RigRecorder{Tail}.exe";
    public static string ServiceArgs => SelfTest ? $"--service {SelfTestFlag}" : "--service";

    /// %ProgramData%\Rig\Recorder: the log, the status file and the list of Rig installs.
    public static string Data => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rig", "Recorder" + Tail);
    /// %ProgramFiles%\Rig\Recorder: the service's own copy of the helper, where only admins can change it.
    public static string Program => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Rig", "Recorder" + Tail);
    /// %ProgramData%\Rig\Reverts: the ledger of protections that are off for now (Reverts.cs). Admins and the system only.
    public static string Reverts => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rig", "Reverts" + Tail);
    public static string Logs(string data) => Path.Combine(data, "logs");
    public static string Status(string data) => Path.Combine(data, "status.json");
    public static string Config(string data) => Path.Combine(data, "config.json");
}

public static class LogFiles
{
    public const string Ext = ".jsonl";
    /// Logs older than this are deleted.
    public const int KeepDays = 30;
    /// All logs together stay under this; the oldest days go first.
    public const long MaxBytes = 200L << 20;
    /// One day's file stops taking readings past this, so a runaway can't fill the drive. Events still go in, up to twice this.
    public const long DayCap = 25L << 20;

    public static string NameFor(long t) => DateTimeOffset.FromUnixTimeMilliseconds(t).UtcDateTime.ToString("yyyy-MM-dd") + Ext;

    static readonly Regex DayFile = new(@"^\d{4}-\d{2}-\d{2}\.jsonl$");
    public static bool IsLog(string name) => DayFile.IsMatch(name);

    /// Which log files to delete: anything older than keepDays, then the oldest until the rest fits in maxBytes.
    /// Today's file (the newest) is never deleted. Files that aren't day logs are left alone.
    public static List<string> Prune(IEnumerable<(string Name, long Bytes)> files, long nowMs, int keepDays = KeepDays, long maxBytes = MaxBytes)
    {
        var logs = files.Where(f => IsLog(f.Name)).OrderBy(f => f.Name, StringComparer.Ordinal).ToList();
        if (logs.Count == 0) return [];
        string oldest = NameFor(nowMs - (long)keepDays * 86_400_000);
        string newest = logs[^1].Name;
        var drop = logs.Where(f => string.CompareOrdinal(f.Name, oldest) < 0 && f.Name != newest).Select(f => f.Name).ToList();
        long total = logs.Where(f => !drop.Contains(f.Name)).Sum(f => f.Bytes);
        foreach (var f in logs)
        {
            if (total <= maxBytes || f.Name == newest) break;
            if (drop.Contains(f.Name)) continue;
            drop.Add(f.Name);
            total -= f.Bytes;
        }
        return drop;
    }
}

/// Builds the log's lines.
public static class LogLine
{
    public static JsonObject Of(string kind, long t) => new() { ["k"] = kind, ["t"] = t };

    public static JsonObject Sensors(long t, IReadOnlyList<SensorDto> list)
    {
        var arr = new JsonArray();
        foreach (var s in list) arr.Add(new JsonArray(s.Id, s.Hw, s.HwName, s.Type, s.Name));
        var o = Of("sensors", t);
        o["list"] = arr;
        return o;
    }

    public static JsonObject Sample(long t, IReadOnlyList<double?> values, IReadOnlyList<ProcessDto>? top, bool detail)
    {
        var v = new JsonArray();
        foreach (var x in values) v.Add(x is double d ? JsonValue.Create(d) : null);
        var o = Of("s", t);
        o["v"] = v;
        if (top != null) o["top"] = Json.From(top);
        if (detail) o["d"] = 1;
        return o;
    }

    public static JsonObject Event(EventDto e)
    {
        var o = Of("e", e.T);
        o["log"] = e.Log; o["source"] = e.Source; o["id"] = e.Id; o["level"] = e.Level; o["message"] = e.Message;
        return o;
    }
}

/// The sensors worth keeping in the log: temperatures, loads, fans, power draw, levels (battery, wear) and fan controls.
/// Clocks and voltages change every second and rarely explain a problem, so they're left out.
public static class LogSensors
{
    static readonly HashSet<string> Kept = ["temperature", "load", "fan", "power", "level", "control"];
    public static List<SensorDto> Pick(IEnumerable<SensorDto> all) => all.Where(s => Kept.Contains(s.Type)).ToList();
}

/// The key of the sensor list the recorder last saw, built again only when the list changes.
/// The ids come from Sensors, which hands out the same string for a sensor every time, so most checks are reference compares.
public sealed class SensorKey
{
    string[] ids = [];
    string key = "";

    public string Of(IReadOnlyList<SensorDto> list)
    {
        if (list.Count == ids.Length)
        {
            int i = 0;
            while (i < ids.Length && string.Equals(list[i].Id, ids[i], StringComparison.Ordinal)) i++;
            if (i == ids.Length) return key;
        }
        ids = new string[list.Count];
        for (int i = 0; i < ids.Length; i++) ids[i] = list[i].Id;
        return key = string.Join("|", ids);
    }
}

/// The few numbers the recorder watches to decide when to take a closer look.
public record Reading(long T, double? Cpu, double? Gpu, double? CpuLoad, double? Mem)
{
    static readonly Regex NotCpuTemp = new("distance|tjmax", RegexOptions.IgnoreCase);
    static readonly Regex NotGpuCore = new("hot ?spot|junction|memory", RegexOptions.IgnoreCase);

    public static Reading From(long t, IReadOnlyList<SensorDto> s)
    {
        static double? Max(IEnumerable<SensorDto> xs) => xs.Select(x => x.Value).Max();
        var cpuTemps = s.Where(x => x.Hw == "cpu" && x.Type == "temperature" && !NotCpuTemp.IsMatch(x.Name));
        var gpuTemps = s.Where(x => x.Hw == "gpu" && x.Type == "temperature").ToList();
        var gpuCore = gpuTemps.Where(x => !NotGpuCore.IsMatch(x.Name)).ToList();
        return new Reading(t, Max(cpuTemps), Max(gpuCore.Count > 0 ? gpuCore : gpuTemps),
            s.FirstOrDefault(x => x.Hw == "cpu" && x.Type == "load" && x.Name.Equals("CPU Total", StringComparison.OrdinalIgnoreCase))?.Value,
            s.FirstOrDefault(x => x.Hw == "memory" && x.Type == "load" && x.Name.Equals("Memory", StringComparison.OrdinalIgnoreCase))?.Value);
    }
}

/// Decides when something looks wrong. Pure: feed it readings and events with their times.
public sealed class Watch
{
    public const double CpuHot = 95, GpuHot = 88, MemFull = 95, JumpTo = 80, JumpBy = 25;
    public const long JumpWindowMs = 60_000;
    /// The same reason won't start another closer look within this long.
    public const long CooldownMs = 30 * 60_000;
    /// At most this many closer looks a day.
    public const int PerDay = 24;

    readonly List<Reading> recent = [];
    readonly Dictionary<string, long> fired = new();
    Reading? last;
    string day = "";
    int today;

    /// A reason and a plain sentence when this reading starts a closer look, else null.
    public (string Why, string Text)? Check(Reading r)
    {
        recent.Add(r);
        recent.RemoveAll(x => r.T - x.T > JumpWindowMs);
        var prev = last;
        last = r;
        static bool Both(double? a, double? b, double at) => a >= at && b >= at;

        if (Both(r.Cpu, prev?.Cpu, CpuHot) && Fire("cpu-hot", r.T)) return ("cpu-hot", $"The processor reached {r.Cpu:0}°C");
        if (Both(r.Gpu, prev?.Gpu, GpuHot) && Fire("gpu-hot", r.T)) return ("gpu-hot", $"The graphics card reached {r.Gpu:0}°C");
        foreach (var (name, value, pick) in new (string, double?, Func<Reading, double?>)[] { ("cpu", r.Cpu, x => x.Cpu), ("gpu", r.Gpu, x => x.Gpu) })
        {
            double? low = recent.Select(pick).Min();
            if (value >= JumpTo && low != null && value - low >= JumpBy && Fire($"{name}-jump", r.T))
                return ($"{name}-jump", $"The {(name == "cpu" ? "processor" : "graphics card")} jumped from {low:0}°C to {value:0}°C within a minute");
        }
        if (Both(r.Mem, prev?.Mem, MemFull) && Fire("mem-full", r.T)) return ("mem-full", $"Memory was {r.Mem:0}% full");
        return null;
    }

    static readonly Regex Trouble = new(
        @"^(bugcheck|microsoft-windows-wer-systemerrorreporting|application error|application hang|display|nvlddmkm|amdkmdag|amdwddmg|atikmdag|igfx\w*|dxgkrnl|microsoft-windows-whea-logger|disk|ntfs|microsoft-windows-ntfs|volmgr|stornvme|storahci|microsoft-windows-kernel-power)$",
        RegexOptions.IgnoreCase);

    /// A Windows event that starts a closer look: crashes, driver resets, hardware and disk errors, power loss.
    /// Matches the kinds packages/core/src/recordings.ts calls crash, driver, hardware, disk and shutdown.
    public (string Why, string Text)? Check(EventDto e)
    {
        if (e.Level == "info" || !Trouble.IsMatch(e.Source)) return null;
        if (e.Source.EndsWith("Kernel-Power", StringComparison.OrdinalIgnoreCase) && e.Id != 41) return null;
        if (e.Source.Equals("Display", StringComparison.OrdinalIgnoreCase) && e.Id != 4101) return null;
        return Fire("event", e.T) ? ("event", $"Windows logged {e.Source} event {e.Id}") : null;
    }

    bool Fire(string why, long t)
    {
        string d = LogFiles.NameFor(t);
        if (d != day) { day = d; today = 0; }
        if (today >= PerDay || (fired.TryGetValue(why, out long at) && t - at < CooldownMs)) return false;
        fired[why] = t;
        today++;
        return true;
    }
}

/// The last few minutes of readings, so a closer look also shows what led up to it.
public sealed class Ring(int size)
{
    public sealed record Entry(long T, double?[] Values, List<ProcessDto>? Top, int Header) { public bool Written { get; set; } }
    readonly Queue<Entry> q = new();
    public void Add(Entry e) { q.Enqueue(e); while (q.Count > size) q.Dequeue(); }
    /// Entries from before a time that aren't in the log yet and were read with this sensor list, oldest first. Marks them written.
    public List<Entry> TakeUnwritten(int header, long before)
    {
        var list = q.Where(e => !e.Written && e.Header == header && e.T < before).ToList();
        foreach (var e in list) e.Written = true;
        return list;
    }
}
