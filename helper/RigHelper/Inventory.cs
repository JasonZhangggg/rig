// The PC's parts, from WMI, LibreHardwareMonitor and the display APIs, in the
// shape of Rig's Inventory (packages/core/src/telemetry.ts).

using System.Globalization;
using System.Management;
using System.Security.Cryptography;
using System.Text;
using LibreHardwareMonitor.Hardware;
using Microsoft.Win32;

namespace Rig.Helper;

public static class Inventory
{
    static IEnumerable<ManagementBaseObject> Query(string wql, string scope = @"root\cimv2")
    {
        try
        {
            using var s = new ManagementObjectSearcher(scope, wql);
            return s.Get().Cast<ManagementBaseObject>().ToList();
        }
        catch { return []; }
    }

    static string Str(ManagementBaseObject o, string p) => (o[p]?.ToString() ?? "").Trim();
    static long Num(ManagementBaseObject o, string p) { try { return Convert.ToInt64(o[p] ?? 0L); } catch { return 0; } }
    static string Pretty(DateTime d, bool day) => d.ToString(day ? "MMM d, yyyy" : "MMM yyyy", CultureInfo.InvariantCulture);
    static DateTime? CimDate(string s) => s.Length >= 8 && DateTime.TryParseExact(s[..8], "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    public static object Read(Sensors hw)
    {
        var lhm = hw.Hardware.ToList();
        var cs = Query("SELECT Manufacturer, Model, PCSystemType FROM Win32_ComputerSystem").FirstOrDefault();
        var os = Query("SELECT Caption, BuildNumber FROM Win32_OperatingSystem").FirstOrDefault();
        var battery = Battery();

        string build = os != null ? Str(os, "BuildNumber") : Environment.OSVersion.Version.Build.ToString();
        var cv = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        if (cv?.GetValue("UBR") is int ubr) build = $"{build}.{ubr}";
        string osName = (os != null ? Str(os, "Caption") : "Windows").Replace("Microsoft ", "");
        // Windows 11 still reports itself as 10 in some places; the build number settles it.
        if (int.TryParse(build.Split('.')[0], out int b) && b >= 22000) osName = osName.Replace("Windows 10", "Windows 11");

        bool laptop = (cs != null && Num(cs, "PCSystemType") == 2) || battery != null;

        return new
        {
            machine = new
            {
                id = MachineId(),
                hostname = Environment.MachineName,
                manufacturer = cs != null ? Str(cs, "Manufacturer") : "",
                model = cs != null ? Str(cs, "Model") : "",
                kind = laptop ? "laptop" : "tower",
                os = new { name = osName, version = cv?.GetValue("DisplayVersion")?.ToString() ?? "", build },
            },
            cpu = Cpu(),
            gpus = Gpus(lhm),
            board = Board(),
            memory = Memory(),
            disks = Disks(lhm),
            volumes = Volumes(),
            battery,
            displays = Displays(),
        };
    }

    /// A stable id that doesn't reveal the Windows machine GUID itself.
    static string MachineId()
    {
        string guid = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography")?.GetValue("MachineGuid")?.ToString() ?? Environment.MachineName;
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("rig:" + guid)))[..20].ToLowerInvariant();
    }

    static object Cpu()
    {
        var p = Query("SELECT Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed FROM Win32_Processor").FirstOrDefault();
        if (p == null) return new { name = "Processor", cores = Environment.ProcessorCount, threads = Environment.ProcessorCount };
        long mhz = Num(p, "MaxClockSpeed");
        return new { name = Str(p, "Name"), cores = (int)Num(p, "NumberOfCores"), threads = (int)Num(p, "NumberOfLogicalProcessors"), maxClockMhz = mhz > 0 ? (long?)mhz : null };
    }

    static object Gpus(List<IHardware> lhm)
    {
        var list = new List<object>();
        foreach (var v in Query("SELECT Name, AdapterRAM, DriverVersion, DriverDate, PNPDeviceID FROM Win32_VideoController"))
        {
            string name = Str(v, "Name");
            string pnp = Str(v, "PNPDeviceID");
            if (name.Length == 0 || pnp.StartsWith("ROOT", StringComparison.OrdinalIgnoreCase)) continue; // remote and virtual adapters
            string vendor = pnp.Contains("VEN_10DE") || name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase) ? "nvidia"
                : pnp.Contains("VEN_1002") || name.Contains("AMD", StringComparison.OrdinalIgnoreCase) || name.Contains("Radeon", StringComparison.OrdinalIgnoreCase) ? "amd"
                : pnp.Contains("VEN_8086") || name.Contains("Intel", StringComparison.OrdinalIgnoreCase) ? "intel" : "other";
            bool integrated = vendor switch
            {
                // "Intel Arc A770" and "Arc B580" are cards; plain "Intel Arc Graphics" is built into the processor.
                "intel" => !System.Text.RegularExpressions.Regex.IsMatch(name, @"Arc.*\b[AB]\d{3}", System.Text.RegularExpressions.RegexOptions.IgnoreCase),
                "amd" => !System.Text.RegularExpressions.Regex.IsMatch(name, @"\bRX\b|PRO W|Instinct|R9|R7 ", System.Text.RegularExpressions.RegexOptions.IgnoreCase),
                _ => false,
            };
            // AdapterRAM stops at 4 GB, so prefer what the graphics driver reports through LHM.
            var g = lhm.FirstOrDefault(h => Sensors.Kind(h.HardwareType) == "gpu" && h.Name.Contains(name.Split(' ').Last(), StringComparison.OrdinalIgnoreCase));
            double? vram = g?.Sensors.FirstOrDefault(s => s.SensorType == SensorType.SmallData && s.Name.Contains("Memory Total", StringComparison.OrdinalIgnoreCase))?.Value;
            long ram = Num(v, "AdapterRAM");
            var date = CimDate(Str(v, "DriverDate"));
            list.Add(new
            {
                name, vendor,
                vramMb = vram is double mb && mb > 0 ? (long?)Math.Round(mb) : ram > 0 ? ram / (1024 * 1024) : null,
                driverVersion = DriverVersion(vendor, Str(v, "DriverVersion")),
                driverDate = date is DateTime d ? Pretty(d, true) : null,
                integrated,
            });
        }
        return list;
    }

    /// NVIDIA's own version (565.90) from the Windows one (32.0.15.6590).
    static string DriverVersion(string vendor, string win)
    {
        if (vendor != "nvidia") return win;
        string digits = win.Replace(".", "");
        return digits.Length >= 5 ? $"{digits[^5..^2]}.{digits[^2..]}" : win;
    }

    static object Board()
    {
        var b = Query("SELECT Manufacturer, Product FROM Win32_BaseBoard").FirstOrDefault();
        var bios = Query("SELECT SMBIOSBIOSVersion, ReleaseDate FROM Win32_BIOS").FirstOrDefault();
        var date = bios != null ? CimDate(Str(bios, "ReleaseDate")) : null;
        return new
        {
            manufacturer = b != null ? Str(b, "Manufacturer") : "",
            product = b != null ? Str(b, "Product") : "",
            biosVersion = bios != null ? Str(bios, "SMBIOSBIOSVersion") : "",
            biosDate = date is DateTime d ? Pretty(d, false) : null,
        };
    }

    static object Memory()
    {
        var mods = Query("SELECT Capacity, ConfiguredClockSpeed, Speed, Manufacturer, PartNumber, DeviceLocator FROM Win32_PhysicalMemory")
            .Select(m =>
            {
                long speed = Num(m, "ConfiguredClockSpeed");
                if (speed == 0) speed = Num(m, "Speed");
                string maker = Str(m, "Manufacturer");
                return new
                {
                    manufacturer = maker.Length == 0 || maker.StartsWith("Unknown", StringComparison.OrdinalIgnoreCase) ? null : maker,
                    partNumber = Str(m, "PartNumber") is { Length: > 0 } pn ? pn : null,
                    capacityMb = Num(m, "Capacity") / (1024 * 1024),
                    speedMhz = speed > 0 ? (long?)speed : null,
                    slot = Str(m, "DeviceLocator") is { Length: > 0 } s ? s : null,
                };
            }).ToList();
        long slots = Query("SELECT MemoryDevices FROM Win32_PhysicalMemoryArray").Sum(a => Num(a, "MemoryDevices"));
        return new { totalMb = mods.Sum(m => m.capacityMb), slotsTotal = slots > 0 ? (long?)slots : null, modules = mods };
    }

    static object Disks(List<IHardware> lhm)
    {
        var list = new List<object>();
        foreach (var d in Query("SELECT FriendlyName, Size, MediaType, BusType FROM MSFT_PhysicalDisk", @"root\Microsoft\Windows\Storage"))
        {
            string model = Str(d, "FriendlyName");
            long bus = Num(d, "BusType"), media = Num(d, "MediaType");
            if (bus == 7 && media != 4) continue; // USB sticks and card readers
            var h = lhm.FirstOrDefault(x => x.HardwareType == HardwareType.Storage && string.Equals(x.Name.Trim(), model, StringComparison.OrdinalIgnoreCase));
            double? used = h?.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Level && s.Name.Contains("Percentage Used", StringComparison.OrdinalIgnoreCase))?.Value;
            double? life = h?.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Level && s.Name.Contains("Remaining Life", StringComparison.OrdinalIgnoreCase))?.Value;
            double? writtenGb = h?.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Data && (s.Name.Contains("Data Written") || s.Name.Contains("Total Bytes Written")))?.Value;
            list.Add(new
            {
                model,
                sizeGb = Num(d, "Size") / 1_000_000_000,
                media = bus == 17 ? "nvme" : media == 4 ? "ssd" : media == 3 ? "hdd" : "unknown",
                healthPercent = used is double u ? (int?)Math.Max(0, 100 - (int)Math.Round(u)) : life is double l ? (int?)Math.Round(l) : null,
                writtenTb = writtenGb is double w ? (double?)Math.Round(w / 1000, 1) : null,
            });
        }
        return list;
    }

    static object Volumes() => DriveInfo.GetDrives()
        .Where(d => d.DriveType == DriveType.Fixed && d.IsReady)
        .Select(d => new
        {
            letter = d.Name.TrimEnd('\\'),
            label = string.IsNullOrWhiteSpace(d.VolumeLabel) ? null : d.VolumeLabel,
            sizeGb = d.TotalSize / (1024L * 1024 * 1024),
            freeGb = d.AvailableFreeSpace / (1024L * 1024 * 1024),
        }).ToList();

    static object? Battery()
    {
        if (!Query("SELECT Name FROM Win32_Battery").Any()) return null;
        long design = Query("SELECT DesignedCapacity FROM BatteryStaticData", @"root\wmi").Sum(x => Num(x, "DesignedCapacity"));
        long full = Query("SELECT FullChargedCapacity FROM BatteryFullChargedCapacity", @"root\wmi").Sum(x => Num(x, "FullChargedCapacity"));
        long cycles = Query("SELECT CycleCount FROM BatteryCycleCount", @"root\wmi").Sum(x => Num(x, "CycleCount"));
        return new
        {
            designWh = design > 0 ? (double?)Math.Round(design / 1000.0, 1) : null,
            fullWh = full > 0 ? (double?)Math.Round(full / 1000.0, 1) : null,
            cycles = cycles > 0 ? (long?)cycles : null,
        };
    }

    /// Screens with their names made unique, so a change can name one exactly.
    public static List<(string name, string gdi)> NamedScreens()
    {
        var seen = new Dictionary<string, int>();
        return Native.Screens().Select(s =>
        {
            seen[s.name] = seen.GetValueOrDefault(s.name) + 1;
            return (seen[s.name] > 1 ? $"{s.name} ({seen[s.name]})" : s.name, s.gdi);
        }).ToList();
    }

    public static int MaxRefresh(string gdi, int width, int height)
    {
        int best = 0;
        var dm = Native.NewDevMode();
        for (int i = 0; Native.EnumDisplaySettings(gdi, i, ref dm); i++)
            if (dm.dmPelsWidth == width && dm.dmPelsHeight == height) best = Math.Max(best, dm.dmDisplayFrequency);
        return best;
    }

    static object Displays()
    {
        var list = new List<object>();
        foreach (var (name, gdi) in NamedScreens())
        {
            var dm = Native.NewDevMode();
            if (!Native.EnumDisplaySettings(gdi, Native.ENUM_CURRENT_SETTINGS, ref dm)) continue;
            list.Add(new
            {
                name, width = dm.dmPelsWidth, height = dm.dmPelsHeight, refreshHz = dm.dmDisplayFrequency,
                maxRefreshHz = Math.Max(dm.dmDisplayFrequency, MaxRefresh(gdi, dm.dmPelsWidth, dm.dmPelsHeight)),
                primary = dm.dmPositionX == 0 && dm.dmPositionY == 0,
            });
        }
        return list;
    }
}
