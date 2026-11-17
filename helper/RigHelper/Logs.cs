// Read-only views for Rig's Logs screen and recordings: the Windows events
// that explain PC problems, and the busiest apps right now. Shapes match
// RawEvent and ProcessUse in packages/core/src/recordings.ts. Nothing here
// changes the PC, and every list is bounded.

using System.Diagnostics;
using System.Diagnostics.Eventing.Reader;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public record EventDto(long T, string Log, string Source, int Id, string Level, string Message);
public record ProcessDto(string Name, double Cpu, long MemMb, double? Gpu);

public static class EventLogs
{
    public const int MaxEvents = 300;
    public const int MaxDays = 30;
    const int MessageMax = 300;

    /// Sources whose warnings matter: driver resets, corrected hardware errors and disk retries are logged as warnings, not errors.
    static readonly string[] WarningSources =
    [
        "Display", "nvlddmkm", "amdkmdag", "amdwddmg", "atikmdag", "igfx", "dxgkrnl",
        "Microsoft-Windows-WHEA-Logger", "disk", "Ntfs", "Microsoft-Windows-Ntfs", "volmgr", "stornvme", "storahci",
    ];

    /// What to read from each log, newest first: every critical and error, plus warnings from the sources above.
    public static IEnumerable<(string log, string xpath, int cap)> Queries(DateTime sinceUtc)
    {
        string since = $"TimeCreated[@SystemTime>='{sinceUtc:yyyy-MM-ddTHH:mm:ss.fffZ}']";
        string sources = string.Join(" or ", WarningSources.Select(s => $"@Name='{s}'"));
        yield return ("System", $"*[System[(Level=1 or Level=2) and {since}]]", 150);
        yield return ("System", $"*[System[Provider[{sources}] and (Level=3) and {since}]]", 100);
        yield return ("Application", $"*[System[(Level=1 or Level=2) and {since}]]", 100);
    }

    public static List<EventDto> Read(long sinceMs, int max)
    {
        max = Math.Clamp(max, 1, MaxEvents);
        var floor = DateTime.UtcNow.AddDays(-MaxDays);
        var since = DateTimeOffset.FromUnixTimeMilliseconds(Math.Max(0, sinceMs)).UtcDateTime;
        if (since < floor) since = floor;

        var list = new List<EventDto>();
        int failed = 0, asked = 0;
        foreach (var (log, xpath, cap) in Queries(since))
        {
            asked++;
            try
            {
                using var reader = new EventLogReader(new EventLogQuery(log, PathType.LogName, xpath) { ReverseDirection = true });
                for (int n = 0; n < cap; n++)
                {
                    using var rec = reader.ReadEvent();
                    if (rec == null) break;
                    if (rec.TimeCreated is not DateTime at) continue;
                    list.Add(new EventDto(new DateTimeOffset(at.ToUniversalTime()).ToUnixTimeMilliseconds(), log, rec.ProviderName ?? "Unknown", rec.Id, Level(rec.Level), Message(rec)));
                }
            }
            catch (Exception e) when (e is EventLogException or UnauthorizedAccessException) { failed++; }
        }
        if (failed == asked) throw new RigException("Windows wouldn't let Rig read its event log.");
        return list.OrderByDescending(e => e.T).Take(max).ToList();
    }

    static string Level(byte? level) => level switch { 1 => "critical", 3 => "warning", _ => "error" };

    static string Message(EventRecord rec)
    {
        string? text = null;
        try { text = rec.FormatDescription(); } catch (EventLogException) { }
        // No message file for this source: the raw values still say which app, module or device it was.
        if (string.IsNullOrWhiteSpace(text))
        {
            try { text = string.Join(", ", rec.Properties.Select(p => p.Value?.ToString()).Where(v => !string.IsNullOrWhiteSpace(v)).Take(8)); }
            catch (EventLogException) { text = ""; }
        }
        return Clean(text ?? "", MessageMax);
    }

    public static string Clean(string text, int max)
    {
        string one = Regex.Replace(text, @"\s+", " ").Trim();
        return one.Length <= max ? one : one[..max];
    }
}

public static class Processes
{
    public const int MaxTop = 15;
    static readonly HashSet<string> NoExe = new(StringComparer.OrdinalIgnoreCase) { "System", "Registry", "Memory Compression", "Secure System" };
    static readonly object gate = new();
    static Dictionary<int, TimeSpan>? lastCpu;
    static long lastAt;
    static Dictionary<string, CounterSample>? lastGpu;

    record Seen(int Pid, string Name, TimeSpan Cpu, long Bytes);

    static List<Seen> Sample()
    {
        var list = new List<Seen>();
        foreach (var p in Process.GetProcesses())
        {
            using (p)
            {
                if (p.Id == 0) continue;
                // Protected processes refuse to say how much time they've used; skip them.
                try { list.Add(new Seen(p.Id, p.ProcessName, p.TotalProcessorTime, p.WorkingSet64)); } catch { }
            }
        }
        return list;
    }

    /// The busiest apps since the last call (or over a short pause on the first), grouped by name:
    /// the top few by processor share plus the biggest by memory.
    public static List<ProcessDto> Top(int top)
    {
        top = Math.Clamp(top, 1, MaxTop);
        lock (gate)
        {
            if (lastCpu == null || Stopwatch.GetElapsedTime(lastAt) > TimeSpan.FromMinutes(2))
            {
                lastCpu = Sample().ToDictionary(s => s.Pid, s => s.Cpu);
                lastAt = Stopwatch.GetTimestamp();
                Gpu();
                Thread.Sleep(400);
            }
            var now = Sample();
            double elapsed = Stopwatch.GetElapsedTime(lastAt).TotalMilliseconds;
            var gpu = Gpu();
            var rows = Rank(now.Select(s => (s.Name, s.Bytes, Ms: lastCpu.TryGetValue(s.Pid, out var before) ? (s.Cpu - before).TotalMilliseconds : 0, Gpu: gpu != null && gpu.TryGetValue(s.Pid, out double g) ? g : (double?)null)),
                elapsed, Environment.ProcessorCount, top);
            lastCpu = now.ToDictionary(s => s.Pid, s => s.Cpu);
            lastAt = Stopwatch.GetTimestamp();
            return rows;
        }
    }

    /// Pure part of Top: turns per-process processor time over a stretch into shares of the whole processor.
    public static List<ProcessDto> Rank(IEnumerable<(string Name, long Bytes, double Ms, double? Gpu)> procs, double elapsedMs, int cores, int top)
    {
        double whole = Math.Max(1, elapsedMs) * Math.Max(1, cores);
        var groups = procs.GroupBy(p => p.Name, StringComparer.OrdinalIgnoreCase).Select(g => new ProcessDto(
            NoExe.Contains(g.Key) ? g.Key : g.Key + ".exe",
            Math.Round(Math.Clamp(g.Sum(p => Math.Max(0, p.Ms)) / whole * 100, 0, 100), 1),
            g.Sum(p => p.Bytes) / (1024 * 1024),
            g.Any(p => p.Gpu != null) ? Math.Round(Math.Min(100, g.Sum(p => p.Gpu ?? 0))) : null)).ToList();
        var byCpu = groups.OrderByDescending(p => p.Cpu).ThenByDescending(p => p.MemMb).Take(top);
        var byMem = groups.OrderByDescending(p => p.MemMb).Take(3);
        return byCpu.Union(byMem).OrderByDescending(p => p.Cpu).ThenByDescending(p => p.MemMb).Take(MaxTop).ToList();
    }

    /// Share of the graphics card's 3D engine per process id, from Windows' own counters. Null when they aren't there.
    static Dictionary<int, double>? Gpu()
    {
        try
        {
            var data = new PerformanceCounterCategory("GPU Engine").ReadCategory();
            if (data["Utilization Percentage"] is not InstanceDataCollection util) return null;
            var now = new Dictionary<string, CounterSample>();
            var use = new Dictionary<int, double>();
            foreach (InstanceData inst in util.Values)
            {
                if (!inst.InstanceName.EndsWith("engtype_3D", StringComparison.OrdinalIgnoreCase)) continue;
                now[inst.InstanceName] = inst.Sample;
                var m = Regex.Match(inst.InstanceName, @"^pid_(\d+)_");
                if (!m.Success || lastGpu == null || !lastGpu.TryGetValue(inst.InstanceName, out var before)) continue;
                double v = CounterSample.Calculate(before, inst.Sample);
                if (double.IsNaN(v) || v <= 0) continue;
                int pid = int.Parse(m.Groups[1].Value);
                use[pid] = use.GetValueOrDefault(pid) + v;
            }
            bool first = lastGpu == null;
            lastGpu = now;
            return first ? null : use;
        }
        catch { return null; }
    }
}
