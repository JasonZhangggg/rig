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
    static readonly TimeSpan QueryTimeout = TimeSpan.FromSeconds(5);

    static IEnumerable<ManagementBaseObject> Query(string wql, string scope = @"root\cimv2")
    {
        try
        {
            // A slow WMI provider (the Storage one is the usual suspect) gives up instead of holding Rig on its loading screen.
            var options = new System.Management.EnumerationOptions { Timeout = QueryTimeout, ReturnImmediately = true, Rewindable = false };
            using var s = new ManagementObjectSearcher(new ManagementScope(scope), new ObjectQuery(wql), options);
            using var found = s.Get();
            return found.Cast<ManagementBaseObject>().ToList();
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
        var chassis = Query("SELECT ChassisTypes FROM Win32_SystemEnclosure")
            .SelectMany(e => e["ChassisTypes"] is ushort[] t ? t.Select(x => (long)x) : []).ToList();
        var batteries = Query("SELECT Name, Chemistry FROM Win32_Battery").Select(x => new PcKind.Battery(Str(x, "Name"), Num(x, "Chemistry"))).ToList();
        // A UPS on a USB cable is a battery to Windows too, so the case and power profile decide first (PcKind).
        bool laptop = PcKind.Laptop(cs != null ? Num(cs, "PCSystemType") : 0, chassis, batteries);
        var battery = laptop && batteries.Any(PcKind.Internal) ? Battery() : null;

        string build = os != null ? Str(os, "BuildNumber") : Environment.OSVersion.Version.Build.ToString();
        using var cv = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        if (cv?.GetValue("UBR") is int ubr) build = $"{build}.{ubr}";
        string osName = (os != null ? Str(os, "Caption") : "Windows").Replace("Microsoft ", "");
        // Windows 11 still reports itself as 10 in some places; the build number settles it.
        if (int.TryParse(build.Split('.')[0], out int b) && b >= 22000) osName = osName.Replace("Windows 10", "Windows 11");

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
        using var crypto = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
        string guid = crypto?.GetValue("MachineGuid")?.ToString() ?? Environment.MachineName;
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
            // PCI\VEN_1002&DEV_73DF&SUBSYS_E4451DA2&... : the subsystem id (E445) and its vendor (1DA2) name the exact card and its maker.
            var sub = System.Text.RegularExpressions.Regex.Match(pnp, @"SUBSYS_([0-9A-F]{4})([0-9A-F]{4})", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            list.Add(new
            {
                name, vendor,
                subsysVendor = sub.Success ? sub.Groups[2].Value.ToLowerInvariant() : null,
                subsysId = sub.Success ? sub.Groups[1].Value.ToLowerInvariant() : null,
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
        const string fields = "Capacity, ConfiguredClockSpeed, Speed, Manufacturer, PartNumber, DeviceLocator";
        // SMBIOSMemoryType is missing from Windows before 10 1709, and asking for it there fails the whole query.
        var rows = Query($"SELECT {fields}, FormFactor, SMBIOSMemoryType FROM Win32_PhysicalMemory").ToList();
        if (rows.Count == 0) rows = Query($"SELECT {fields} FROM Win32_PhysicalMemory").ToList();
        var mods = rows
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
                    // Core decides soldered memory from these (shop.ts solderedMemory); 0 is Windows' "unknown".
                    formFactor = Opt(m, "FormFactor") is long ff and > 0 ? (long?)ff : null,
                    smbiosType = Opt(m, "SMBIOSMemoryType") is long t and > 0 ? (long?)t : null,
                };
            }).ToList();
        long slots = Query("SELECT MemoryDevices FROM Win32_PhysicalMemoryArray").Sum(a => Num(a, "MemoryDevices"));
        return new { totalMb = mods.Sum(m => m.capacityMb), slotsTotal = slots > 0 ? (long?)slots : null, modules = mods };
    }

    /// Windows' reliability counters per disk number. They change slowly and the Storage provider can be slow, so they're read once an hour.
    static (DateTime at, Dictionary<string, ManagementBaseObject> byDisk)? reliability;
    static Dictionary<string, ManagementBaseObject> Reliability()
    {
        if (reliability is { } r && DateTime.UtcNow - r.at < TimeSpan.FromHours(1)) return r.byDisk;
        // Needs admin rights; without them the list is empty and the screens say what's missing.
        var byDisk = Query("SELECT DeviceId, Wear, PowerOnHours, ReadErrorsUncorrected, WriteErrorsUncorrected FROM MSFT_StorageReliabilityCounter", @"root\Microsoft\Windows\Storage")
            .GroupBy(x => Str(x, "DeviceId")).ToDictionary(g => g.Key, g => g.First());
        reliability = (DateTime.UtcNow, byDisk);
        return byDisk;
    }

    static long? Opt(ManagementBaseObject? o, string p) { try { return o?[p] is null ? null : Convert.ToInt64(o[p]); } catch { return null; } }

    static object Disks(List<IHardware> lhm)
    {
        var list = new List<object>();
        var rel = Reliability();
        foreach (var d in Query("SELECT DeviceId, FriendlyName, Size, MediaType, BusType, HealthStatus FROM MSFT_PhysicalDisk", @"root\Microsoft\Windows\Storage"))
        {
            string model = Str(d, "FriendlyName");
            long bus = Num(d, "BusType"), media = Num(d, "MediaType");
            if (bus == 7 && media != 4) continue; // USB sticks and card readers
            var h = lhm.FirstOrDefault(x => x.HardwareType == HardwareType.Storage && string.Equals(x.Name.Trim(), model, StringComparison.OrdinalIgnoreCase));
            double? used = h?.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Level && s.Name.Contains("Percentage Used", StringComparison.OrdinalIgnoreCase))?.Value;
            double? life = h?.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Level && s.Name.Contains("Remaining Life", StringComparison.OrdinalIgnoreCase))?.Value;
            double? writtenGb = h?.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Data && (s.Name.Contains("Data Written") || s.Name.Contains("Total Bytes Written")))?.Value;
            string id = Str(d, "DeviceId");
            var counters = rel.GetValueOrDefault(id);
            string kind = bus == 17 ? "nvme" : media == 4 ? "ssd" : media == 3 ? "hdd" : "unknown";
            // Windows' own wear counter, when LibreHardwareMonitor can't read the drive's. Hard drives don't wear this way, and 0 often means "not counted".
            long? wear = kind is "nvme" or "ssd" && Opt(counters, "Wear") is long w0 and > 0 and <= 100 ? w0 : null;
            long? errors = Opt(counters, "ReadErrorsUncorrected") is long re && Opt(counters, "WriteErrorsUncorrected") is long we ? re + we : null;
            list.Add(new
            {
                model,
                sizeGb = Num(d, "Size") / 1_000_000_000,
                media = kind,
                number = int.TryParse(id, out int n) ? (int?)n : null,
                healthPercent = used is double u ? (int?)Math.Max(0, 100 - (int)Math.Round(u)) : life is double l ? (int?)Math.Round(l) : wear is long wr ? (int?)(100 - wr) : null,
                powerOnHours = Opt(counters, "PowerOnHours") is long hours and > 0 ? (long?)hours : null,
                errors,
                writtenTb = writtenGb is double w ? (double?)Math.Round(w / 1000, 1) : null,
                // Windows' own reading of the drive's self-test: 0 healthy, 1 warning, 2 unhealthy, 5 unknown.
                status = d["HealthStatus"] is null ? null : Num(d, "HealthStatus") switch { 0 => "healthy", 1 => "warning", 2 => "unhealthy", _ => (string?)null },
            });
        }
        return list;
    }

    static object Volumes()
    {
        // Which disk each lettered partition is on. A volume spread over several disks has partitions on each, so it gets none.
        var onDisk = Query("SELECT DiskNumber, DriveLetter FROM MSFT_Partition", @"root\Microsoft\Windows\Storage")
            .Select(p => (letter: p["DriveLetter"] switch { char c => c, ushort u => (char)u, _ => '\0' }, disk: (int)Num(p, "DiskNumber")))
            .Where(p => char.IsLetter(p.letter))
            .GroupBy(p => char.ToUpperInvariant(p.letter))
            .ToDictionary(g => g.Key, g => g.Select(p => p.disk).Distinct().Count() == 1 ? (int?)g.First().disk : null);
        return DriveInfo.GetDrives()
            .Where(d => d.DriveType == DriveType.Fixed && d.IsReady)
            .Select(d => new
            {
                letter = d.Name.TrimEnd('\\'),
                label = string.IsNullOrWhiteSpace(d.VolumeLabel) ? null : d.VolumeLabel,
                sizeGb = d.TotalSize / (1024L * 1024 * 1024),
                freeGb = d.AvailableFreeSpace / (1024L * 1024 * 1024),
                disk = onDisk.GetValueOrDefault(char.ToUpperInvariant(d.Name[0])),
            }).ToList();
    }

    static object Battery()
    {
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
    public static List<(string name, string gdi)> NamedScreens() => Named().Select(s => (s.name, s.gdi)).ToList();

    static List<Native.Screen> Named()
    {
        var seen = new Dictionary<string, int>();
        return Native.Screens().Select(s =>
        {
            seen[s.name] = seen.GetValueOrDefault(s.name) + 1;
            return seen[s.name] > 1 ? s with { name = $"{s.name} ({seen[s.name]})" } : s;
        }).ToList();
    }

    /// The kind of plug on the computer's side (DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY). Windows says the kind, not which
    /// of a card's several plugs of that kind.
    static string Connection(uint tech) => tech switch
    {
        5 => "hdmi",
        10 => "displayport",
        18 => "usb-c", // DisplayPort over USB-C or Thunderbolt
        4 => "dvi",
        0 => "vga",
        6 or 11 or 13 or 0x80000000 => "internal", // a laptop's own screen
        15 => "wireless", // Miracast
        _ => "other",
    };

    /// Windows' name for each graphics adapter by its device path, to say which one drives each screen.
    static Dictionary<string, string> AdapterNames()
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var v in Query("SELECT Name, PNPDeviceID FROM Win32_VideoController"))
        {
            string pnp = Str(v, "PNPDeviceID"), name = Str(v, "Name");
            if (pnp.Length > 0 && name.Length > 0) map[pnp] = name;
        }
        return map;
    }

    /// \\?\PCI#VEN_10DE&DEV_2783&...#4&1a2b&0&0008#{guid} -> PCI\VEN_10DE&DEV_2783&...\4&1a2b&0&0008, the PNPDeviceID form.
    static string PnpOf(string devicePath)
    {
        string p = devicePath.StartsWith(@"\\?\") ? devicePath[4..] : devicePath;
        int guid = p.IndexOf("#{", StringComparison.Ordinal);
        return (guid >= 0 ? p[..guid] : p).Replace('#', '\\');
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
        var adapters = AdapterNames();
        foreach (var sc in Named())
        {
            var dm = Native.NewDevMode();
            if (!Native.EnumDisplaySettings(sc.gdi, Native.ENUM_CURRENT_SETTINGS, ref dm)) continue;
            list.Add(new
            {
                sc.name, width = dm.dmPelsWidth, height = dm.dmPelsHeight, refreshHz = dm.dmDisplayFrequency,
                maxRefreshHz = Math.Max(dm.dmDisplayFrequency, MaxRefresh(sc.gdi, dm.dmPelsWidth, dm.dmPelsHeight)),
                primary = dm.dmPositionX == 0 && dm.dmPositionY == 0,
                connection = Connection(sc.tech),
                gpu = adapters.GetValueOrDefault(PnpOf(sc.adapter)),
            });
        }
        return list;
    }
}
