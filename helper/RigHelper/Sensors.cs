// Live readings from LibreHardwareMonitor, in the shape Rig's Snapshot uses
// (packages/core/src/telemetry.ts). CPU temperatures and motherboard fans
// need admin rights and the PawnIO driver; graphics, drives and battery work
// without them.

using LibreHardwareMonitor.Hardware;

namespace Rig.Helper;

public record SensorDto(string Id, string Hw, string HwName, string Type, string Name, double? Value, double? Min, double? Max);
public record SnapshotDto(long At, List<SensorDto> Sensors, string? Game, bool Elevated);

public sealed class Sensors : IDisposable
{
    readonly Computer pc = new()
    {
        IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true, IsMotherboardEnabled = true,
        IsControllerEnabled = true, IsStorageEnabled = true, IsBatteryEnabled = true, IsPsuEnabled = true,
    };
    readonly object gate = new();

    public Sensors() { pc.Open(); }

    public IEnumerable<IHardware> Hardware { get { lock (gate) return pc.Hardware.ToList(); } }

    public SnapshotDto Snapshot()
    {
        var list = new List<SensorDto>();
        lock (gate)
        {
            foreach (var h in pc.Hardware) Read(h, null, list);
        }
        return new SnapshotDto(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), list, Foreground.Game(), Native.IsAdmin());
    }

    static void Read(IHardware h, IHardware? parent, List<SensorDto> list)
    {
        h.Update();
        string kind = Kind(parent?.HardwareType ?? h.HardwareType);
        foreach (var s in h.Sensors)
        {
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
