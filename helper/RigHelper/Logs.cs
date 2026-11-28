// Read-only views for Rig's Logs screen and recordings: the Windows events
// that explain PC problems, and the busiest apps right now. Shapes match
// RawEvent and ProcessUse in packages/core/src/recordings.ts. Nothing here
// changes the PC, and every list is bounded.

using System.Diagnostics;
using System.Diagnostics.Eventing.Reader;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public record EventDto(long T, string Log, string Source, int Id, string Level, string Message);
/// Gpu is the share of the busiest graphics chip the app used; Gpus, each chip's share by the chip's name, so on a
/// laptop with built-in and dedicated graphics each share belongs to its own chip. Gpus is left out when a chip
/// couldn't be named, and Gpu then still never adds two chips together.
public record ProcessDto(string Name, double Cpu, long MemMb, double? Gpu, IReadOnlyDictionary<string, double>? Gpus = null);

public static class EventLogs
{
    public const int MaxEvents = 300;
    public const int MaxDays = 30;
    const int MessageMax = 300;

    /// Sources whose warnings matter: driver resets, corrected hardware errors and disk retries are logged as warnings, not errors.
    public static readonly string[] WarningSources =
    [
        "Display", "nvlddmkm", "amdkmdag", "amdwddmg", "atikmdag", "igfx", "dxgkrnl",
        "Microsoft-Windows-WHEA-Logger", "disk", "Ntfs", "Microsoft-Windows-Ntfs", "volmgr", "stornvme", "storahci",
    ];

    /// What to read from each log, newest first: every critical and error, plus warnings from the sources above.
    /// Then what changed on the PC (Windows updates, driver installs, app installs) and Windows' memory test
    /// results, so Rig can tell when a problem started right after a change.
    public static IEnumerable<(string log, string xpath, int cap)> Queries(DateTime sinceUtc)
    {
        string since = $"TimeCreated[@SystemTime>='{sinceUtc:yyyy-MM-ddTHH:mm:ss.fffZ}']";
        string sources = string.Join(" or ", WarningSources.Select(s => $"@Name='{s}'"));
        yield return ("System", $"*[System[(Level=1 or Level=2) and {since}]]", 150);
        yield return ("System", $"*[System[Provider[{sources}] and (Level=3) and {since}]]", 100);
        yield return ("Application", $"*[System[(Level=1 or Level=2) and {since}]]", 100);
        yield return ("System", $"*[System[Provider[@Name='Microsoft-Windows-WindowsUpdateClient'] and EventID=19 and {since}]]", 40);
        yield return ("System", $"*[System[Provider[@Name='Microsoft-Windows-UserPnp'] and EventID=20001 and {since}]]", 40);
        yield return ("System", $"*[System[Provider[@Name='Microsoft-Windows-MemoryDiagnostics-Results'] and {since}]]", 5);
        yield return ("Application", $"*[System[Provider[@Name='MsiInstaller'] and (EventID=11707 or EventID=1033) and {since}]]", 30);
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

    static string Level(byte? level) => level switch { 1 => "critical", 2 => "error", 3 => "warning", _ => "info" };

    public static string Message(EventRecord rec)
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
    /// Windows' graphics counters cost up to a second and a few megabytes to read, so the background recorder's
    /// once-a-minute list reuses each app's graphics share for this long. A closer look, a recording and the Logs
    /// screen read them fresh every time.
    public static readonly TimeSpan GpuEvery = TimeSpan.FromMinutes(5);
    static readonly HashSet<string> NoExe = new(StringComparer.OrdinalIgnoreCase) { "System", "Registry", "Memory Compression", "Secure System" };
    static readonly object gate = new();
    static Dictionary<int, TimeSpan>? lastCpu;
    static long lastAt;
    static Dictionary<string, CounterSample>? lastGpu;
    /// Each process's share of each graphics chip, by the chip's adapter id (its LUID, as the counters write it).
    static Dictionary<int, Dictionary<string, double>>? gpuShare;
    // When gpuShare was worked out; 0 until there's a share to reuse.
    static long gpuShareAt;

    /// How many times the graphics counters have been read, for the self-test.
    public static int GpuReads { get; private set; }

    record struct Seen(int Pid, string Name, TimeSpan Cpu, long Bytes);

    static List<Seen> Sample()
    {
        var all = Process.GetProcesses();
        var list = new List<Seen>(all.Length);
        foreach (var p in all)
        {
            // Each one holds a handle once asked for its processor time; let it go straight away.
            using (p)
            {
                if (p.Id == 0) continue;
                // Protected processes refuse to say how much time they've used; skip them.
                try { list.Add(new Seen(p.Id, p.ProcessName, p.TotalProcessorTime, p.WorkingSet64)); } catch { }
            }
        }
        return list;
    }

    static Dictionary<int, TimeSpan> CpuByPid(List<Seen> list)
    {
        var d = new Dictionary<int, TimeSpan>(list.Count);
        foreach (var s in list) d[s.Pid] = s.Cpu;
        return d;
    }

    /// The busiest apps since the last call (or over a short pause on the first), grouped by name:
    /// the top few by processor share plus the biggest by memory. fresh: false lets the graphics share be
    /// up to GpuEvery old, for the background recorder's regular list.
    public static List<ProcessDto> Top(int top, bool fresh = true)
    {
        top = Math.Clamp(top, 1, MaxTop);
        lock (gate)
        {
            if (lastCpu == null || Stopwatch.GetElapsedTime(lastAt) > TimeSpan.FromMinutes(2))
            {
                lastCpu = CpuByPid(Sample());
                lastAt = Stopwatch.GetTimestamp();
                // A share needs two readings of the graphics counters; take the first now unless one can be reused.
                if (fresh || !GpuReusable()) Gpu();
                Thread.Sleep(400);
            }
            var now = Sample();
            double elapsed = Stopwatch.GetElapsedTime(lastAt).TotalMilliseconds;
            var gpu = GpuShare(fresh);
            var names = gpu != null ? Adapters.Names(gpu.Values.SelectMany(d => d.Keys)) : null;
            var rows = Rank(now.Select(s => (s.Name, s.Bytes, Ms: lastCpu.TryGetValue(s.Pid, out var before) ? (s.Cpu - before).TotalMilliseconds : 0,
                    Gpu: gpu != null && gpu.TryGetValue(s.Pid, out var g) ? (IReadOnlyDictionary<string, double>)g : null)),
                elapsed, Environment.ProcessorCount, top, names);
            lastCpu = CpuByPid(now);
            lastAt = Stopwatch.GetTimestamp();
            return rows;
        }
    }

    static bool GpuReusable() => gpuShareAt != 0 && Stopwatch.GetElapsedTime(gpuShareAt) < GpuEvery;

    /// Each app's graphics share: read now, or the last one while it's recent enough and fresh isn't asked for.
    static Dictionary<int, Dictionary<string, double>>? GpuShare(bool fresh)
    {
        if (!fresh && GpuReusable()) return gpuShare;
        bool hadFirst = lastGpu != null;
        gpuShare = Gpu();
        // A first reading gives no share yet, so it isn't kept; nor is one that failed after a good one.
        // When the counters can't be read at all (no first reading either), that's kept, so they aren't retried every call.
        if (gpuShare != null || !hadFirst && lastGpu == null) gpuShareAt = Stopwatch.GetTimestamp();
        return gpuShare;
    }

    /// Pure part of Top: turns per-process processor time over a stretch into shares of the whole processor, and each
    /// app's graphics use into its share of each chip. An app's processes add up on the same chip, never across chips.
    /// names: each adapter id's chip name; Gpus is given only when every chip the app used has one.
    public static List<ProcessDto> Rank(IEnumerable<(string Name, long Bytes, double Ms, IReadOnlyDictionary<string, double>? Gpu)> procs, double elapsedMs, int cores, int top,
        IReadOnlyDictionary<string, string>? names = null)
    {
        double whole = Math.Max(1, elapsedMs) * Math.Max(1, cores);
        var groups = procs.GroupBy(p => p.Name, StringComparer.OrdinalIgnoreCase).Select(g =>
        {
            var byChip = new Dictionary<string, double>();
            foreach (var p in g) if (p.Gpu != null) foreach (var (chip, v) in p.Gpu) byChip[chip] = byChip.GetValueOrDefault(chip) + v;
            var shares = byChip.ToDictionary(e => e.Key, e => Math.Round(Math.Min(100, e.Value)));
            var named = shares.Count > 0 && names != null && shares.Keys.All(names.ContainsKey)
                ? shares.GroupBy(e => names[e.Key]).ToDictionary(n => n.Key, n => Math.Min(100, n.Sum(e => e.Value))) : null;
            return new ProcessDto(
                NoExe.Contains(g.Key) ? g.Key : g.Key + ".exe",
                Math.Round(Math.Clamp(g.Sum(p => Math.Max(0, p.Ms)) / whole * 100, 0, 100), 1),
                g.Sum(p => p.Bytes) / (1024 * 1024),
                shares.Count > 0 ? shares.Values.Max() : null,
                named);
        }).ToList();
        var byCpu = groups.OrderByDescending(p => p.Cpu).ThenByDescending(p => p.MemMb).Take(top);
        var byMem = groups.OrderByDescending(p => p.MemMb).Take(3);
        return byCpu.Union(byMem).OrderByDescending(p => p.Cpu).ThenByDescending(p => p.MemMb).Take(MaxTop).ToList();
    }

    /// The process id in a GPU Engine instance name ("pid_1234_luid_..._engtype_3D"), or -1.
    public static int GpuPid(string instance)
    {
        if (!instance.StartsWith("pid_", StringComparison.Ordinal)) return -1;
        var rest = instance.AsSpan(4);
        int end = rest.IndexOf('_');
        return end > 0 && int.TryParse(rest[..end], System.Globalization.NumberStyles.None, null, out int pid) ? pid : -1;
    }

    /// The graphics adapter in a GPU Engine instance name ("pid_1234_luid_0x00000000_0x0000D1B2_phys_0_..."):
    /// "luid_0x00000000_0x0000D1B2", the way Adapters names it, or null.
    public static string? GpuLuid(string instance)
    {
        int at = instance.IndexOf("_luid_0x", StringComparison.OrdinalIgnoreCase);
        if (at < 0) return null;
        var m = Regex.Match(instance.AsSpan(at + 1).ToString(), @"^luid_0x([0-9A-Fa-f]{8})_0x([0-9A-Fa-f]{8})");
        return m.Success ? $"luid_0x{m.Groups[1].Value.ToUpperInvariant()}_0x{m.Groups[2].Value.ToUpperInvariant()}" : null;
    }

    /// Share of each graphics chip's 3D engine per process id, from Windows' own counters, since the last reading,
    /// kept apart by chip. Null on the first reading and when the counters aren't there.
    static Dictionary<int, Dictionary<string, double>>? Gpu()
    {
        try
        {
            GpuReads++;
            var data = new PerformanceCounterCategory("GPU Engine").ReadCategory();
            if (data["Utilization Percentage"] is not InstanceDataCollection util) return null;
            var now = new Dictionary<string, CounterSample>(lastGpu?.Count ?? 64);
            var use = new Dictionary<int, Dictionary<string, double>>();
            foreach (InstanceData inst in util.Values)
            {
                if (!inst.InstanceName.EndsWith("engtype_3D", StringComparison.OrdinalIgnoreCase)) continue;
                now[inst.InstanceName] = inst.Sample;
                int pid = GpuPid(inst.InstanceName);
                string? chip = GpuLuid(inst.InstanceName);
                if (pid < 0 || chip == null || lastGpu == null || !lastGpu.TryGetValue(inst.InstanceName, out var before)) continue;
                double v = CounterSample.Calculate(before, inst.Sample);
                if (double.IsNaN(v) || v <= 0) continue;
                if (!use.TryGetValue(pid, out var mine)) use[pid] = mine = [];
                mine[chip] = mine.GetValueOrDefault(chip) + v;
            }
            bool first = lastGpu == null;
            lastGpu = now;
            return first ? null : use;
        }
        catch { return null; }
    }
}
