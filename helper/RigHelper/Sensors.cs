// Live readings from LibreHardwareMonitor, in the shape Rig's Snapshot uses
// (packages/core/src/telemetry.ts). CPU temperatures and motherboard fans
// need admin rights and the PawnIO driver; graphics, drives and battery work
// without them.

using LibreHardwareMonitor.Hardware;

namespace Rig.Helper;

public record SensorDto(string Id, string Hw, string HwName, string Type, string Name, double? Value, double? Min, double? Max);
public record DriverDto(bool Installed, string? Version);
public record SnapshotDto(long At, List<SensorDto> Sensors, string? Game, bool Elevated, DriverDto Driver);

public sealed class Sensors : IDisposable
{
    readonly Computer pc;
    readonly object gate = new();

    /// storage: false leaves drives out, for the background recorder, so reading health data never wakes a sleeping hard drive.
    public Sensors(bool storage = true)
    {
        pc = new Computer
        {
            IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true, IsMotherboardEnabled = true,
            IsControllerEnabled = true, IsStorageEnabled = storage, IsBatteryEnabled = true, IsPsuEnabled = true,
        };
        pc.Open();
    }

    public IEnumerable<IHardware> Hardware { get { lock (gate) return pc.Hardware.ToList(); } }

    public SnapshotDto Snapshot() =>
        new(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Readings(), Foreground.Game(), Native.IsAdmin(), Driver());

    /// Just the sensors, for the background recorder, which has no use for the game in front or the driver's version.
    public List<SensorDto> Readings()
    {
        var list = new List<SensorDto>();
        lock (gate)
        {
            foreach (var h in pc.Hardware) Read(h, null, list);
        }
        return list;
    }

    /// Sensors that would keep their own history of readings in memory. Rig wants none.
    public int KeepingHistory()
    {
        int n = 0;
        void Count(IHardware h) { n += h.Sensors.Count(s => s.ValuesTimeWindow != TimeSpan.Zero); foreach (var sub in h.SubHardware) Count(sub); }
        lock (gate) foreach (var h in pc.Hardware) Count(h);
        return n;
    }

    /// PawnIO is the driver LibreHardwareMonitor reads processor temperatures and board fans through.
    public static DriverDto Driver() =>
        LibreHardwareMonitor.PawnIo.PawnIo.IsInstalled ? new(true, LibreHardwareMonitor.PawnIo.PawnIo.Version?.ToString()) : new(false, null);

    static void Read(IHardware h, IHardware? parent, List<SensorDto> list)
    {
        h.Update();
        string kind = Kind(parent?.HardwareType ?? h.HardwareType);
        foreach (var s in h.Sensors)
        {
            // LibreHardwareMonitor keeps a day of every sensor's readings by default, about 250 KB a sensor.
            // Rig keeps its own history, so it needs none of that.
            if (s.ValuesTimeWindow != TimeSpan.Zero) s.ValuesTimeWindow = TimeSpan.Zero;
            string? type = Type(s.SensorType);
            if (type == null) continue;
            list.Add(new SensorDto(s.Identifier.ToString(), kind, parent?.Name ?? h.Name, type, s.Name, Round(s.Value), Round(s.Min), Round(s.Max)));
        }
        foreach (var sub in h.SubHardware) Read(sub, parent ?? h, list);
    }

    static double? Round(float? v) => v is float f && !float.IsNaN(f) && !float.IsInfinity(f) ? Math.Round(f, 1) : null;

    public static string Kind(HardwareType t) => t switch
    {
        HardwareType.Cpu => "cpu",
        HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel => "gpu",
        HardwareType.Motherboard or HardwareType.SuperIO or HardwareType.EmbeddedController => "board",
        HardwareType.Memory => "memory",
        HardwareType.Storage => "storage",
        HardwareType.Battery => "battery",
        HardwareType.Psu => "psu",
        HardwareType.Cooler => "cooler",
        HardwareType.Network => "network",
        _ => "other",
    };

    static string? Type(SensorType t) => t switch
    {
        SensorType.Temperature => "temperature",
        SensorType.Load => "load",
        SensorType.Fan => "fan",
        SensorType.Clock => "clock",
        SensorType.Power => "power",
        SensorType.Voltage => "voltage",
        SensorType.Data or SensorType.SmallData => "data",
        SensorType.Level => "level",
        SensorType.Control => "control",
        SensorType.Throughput => "throughput",
        SensorType.Current => "current",
        _ => null,
    };

    public void Dispose() { lock (gate) pc.Close(); }
}

/// The game in front, when there is one: a full-screen window that isn't the desktop or a browser.
static class Foreground
{
    static readonly HashSet<string> NotGames = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "chrome", "msedge", "firefox", "brave", "opera", "vlc", "mpc-hc64", "applicationframehost", "rig", "powerpnt", "zoom", "teams", "ms-teams",
    };

    public static string? Game()
    {
        try
        {
            IntPtr w = Native.GetForegroundWindow();
            if (w == IntPtr.Zero || !Native.IsFullScreen(w)) return null;
            Native.GetWindowThreadProcessId(w, out uint pid);
            using var p = System.Diagnostics.Process.GetProcessById((int)pid);
            if (NotGames.Contains(p.ProcessName)) return null;
            string title = p.MainWindowTitle;
            return string.IsNullOrWhiteSpace(title) ? p.ProcessName : title;
        }
        catch { return null; }
    }
}
