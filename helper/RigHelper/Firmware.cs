// Firmware (BIOS) settings and the restart into firmware setup.
//
// The settings are the few in rules/firmware.json, embedded, which the app and
// the server read too (packages/core/src/firmware.ts). A step names a setting
// and a value by their keys there; this code finds the PC's maker and turns
// them into that maker's exact attribute name and value text, and sends
// nothing else to the firmware:
//
//   Dell    root\dcim\sysman\biosattributes: EnumerationAttribute to read,
//           BIOSAttributeInterface.SetAttribute to set; the password state is
//           PasswordObject.IsPasswordSet in root\dcim\sysman\wmisecurity.
//   HP      root\HP\InstrumentedBIOS: HP_BIOSEnumeration to read,
//           HP_BIOSSettingInterface.SetBIOSSetting to set; the password state
//           is HP_BIOSPassword.IsSet.
//   Lenovo  root\wmi: Lenovo_BiosSetting to read, Lenovo_SetBiosSetting then
//           Lenovo_SaveBiosSettings to set; the password state is
//           Lenovo_BiosPasswordSettings.PasswordState.
//
// These are written from the makers' documents and haven't been run on their
// PCs yet. Rig never asks for or types a firmware password: with one set, it
// changes nothing. A change applies at the next restart, so its check right
// after is only that the firmware took it; after the restart Rig reads what
// Windows itself sees (AfterRestart). Both ops run in the helper with admin
// rights, behind Windows' permission prompt (NativeSteps.cs).

using System.Diagnostics;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

public static class FirmwareTable
{
    public sealed record MakerRow(string Attribute, Dictionary<string, string> Values, bool FromWindows, string? Why, string? Asks);
    public sealed record Setting(string Key, string Name, Dictionary<string, string> Values, string[] Allow, Dictionary<string, string> Refuse, bool Sealed, bool Undo, string? Windows, Dictionary<string, MakerRow> Makers);
    public sealed record Maker(string Key, string Name, string[] Match);

    public sealed record Table(int Version, Dictionary<string, Maker> Makers, Dictionary<string, Setting> Settings, (string Says, string[] Words)[] Never);

    static readonly Lazy<Table> table = new(Load);
    public static Table Rules => table.Value;

    static Dictionary<string, string> Map(JsonNode? n) => n is JsonObject o ? o.ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<string>()) : [];
    static string[] List(JsonNode? n) => n is JsonArray a ? a.Select(x => x!.GetValue<string>()).ToArray() : [];

    static Table Load()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Rig.Rules.firmware.json") ?? throw new RigException("Rig's firmware table is missing from the helper.");
        var o = JsonNode.Parse(s) as JsonObject ?? throw new RigException("Rig's firmware table can't be read.");
        var makers = o["makers"]!.AsObject().ToDictionary(kv => kv.Key, kv => new Maker(kv.Key, kv.Value!["name"]!.GetValue<string>(), List(kv.Value["match"])));
        var settings = new Dictionary<string, Setting>();
        foreach (var (key, n) in o["settings"]!.AsObject())
        {
            var rows = n!["makers"]!.AsObject().ToDictionary(kv => kv.Key, kv => new MakerRow(kv.Value!["attribute"]!.GetValue<string>(), Map(kv.Value["values"]),
                kv.Value["fromWindows"]?.GetValue<bool>() != false, kv.Value["why"]?.GetValue<string>(), kv.Value["asks"]?.GetValue<string>()));
            settings[key] = new Setting(key, n["name"]!.GetValue<string>(), Map(n["values"]), List(n["allow"]), Map(n["refuse"]),
                n["sealed"]?.GetValue<bool>() == true, n["undo"]?.GetValue<bool>() != false, n["windows"]?.GetValue<string>(), rows);
        }
        var never = (o["never"] as JsonArray ?? []).Select(x => (x!["says"]!.GetValue<string>(), List(x["words"]))).ToArray();
        return new Table((int)Json.Num(o["version"], 0), makers, settings, never);
    }

    public static string Fold(string s) => new(s.ToLowerInvariant().Where(char.IsAsciiLetterOrDigit).ToArray());

    /// The never words a setting's name falls under, or null. Same matching as firmwareNever in firmware.ts.
    public static string? Never(string setting)
    {
        string f = Fold(setting);
        return Rules.Never.FirstOrDefault(n => n.Words.Any(w => f.Contains(Fold(w)))).Says;
    }

    /// The maker's key for a Win32_ComputerSystem.Manufacturer, or null for any other maker.
    public static string? MakerOf(string? manufacturer)
    {
        string m = (manufacturer ?? "").Trim().ToLowerInvariant();
        return Rules.Makers.Values.FirstOrDefault(k => k.Match.Any(x => m == x || m.StartsWith(x + " ", StringComparison.Ordinal) || m.StartsWith(x + ",", StringComparison.Ordinal) || m.StartsWith(x + ".", StringComparison.Ordinal)))?.Key;
    }
}

/// One maker's firmware management class.
public interface IBios
{
    string Maker { get; }
    /// Whether the maker's class answers on this PC.
    bool Present();
    /// "none", "set", or "not known" when it couldn't be read.
    string Password();
    /// Each attribute's value now, for the names asked.
    Dictionary<string, string> Read(IEnumerable<string> names);
    /// Sets one attribute; throws in plain words when the firmware said no.
    void Set(string name, string value);
}

static class Wmi
{
    public static List<ManagementObject> Query(string ns, string wql)
    {
        using var q = new ManagementObjectSearcher(new ManagementScope(ns), new ObjectQuery(wql), new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(20) });
        return q.Get().Cast<ManagementObject>().ToList();
    }

    public static bool Answers(string ns, string wql)
    {
        try { return Query(ns, wql).Count > 0; }
        catch (ManagementException) { return false; }
        catch (COMException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    public static string First(object? v) => v switch { string s => s, string[] a => a.FirstOrDefault() ?? "", null => "", _ => v.ToString() ?? "" };

    public static object? Call(string ns, string cls, string method, Action<ManagementBaseObject> fill, string outName)
    {
        var target = Query(ns, $"SELECT * FROM {cls}").FirstOrDefault() ?? throw new RigException($"The firmware's {cls} isn't there, so nothing changed.");
        using (target)
        {
            using var args = target.GetMethodParameters(method);
            fill(args);
            using var done = target.InvokeMethod(method, args, null);
            return done?[outName];
        }
    }
}

sealed class DellBios : IBios
{
    const string Ns = @"root\dcim\sysman\biosattributes", Security = @"root\dcim\sysman\wmisecurity";
    public string Maker => "dell";
    public bool Present() => Wmi.Answers(Ns, "SELECT AttributeName FROM EnumerationAttribute");

    public string Password()
    {
        try
        {
            var all = Wmi.Query(Security, "SELECT NameId, IsPasswordSet FROM PasswordObject");
            if (all.Count == 0) return "not known";
            return all.Any(p => Convert.ToInt64(p["IsPasswordSet"] ?? 1L) != 0) ? "set" : "none";
        }
        catch (Exception e) when (e is ManagementException or COMException or UnauthorizedAccessException) { return "not known"; }
    }

    public Dictionary<string, string> Read(IEnumerable<string> names)
    {
        var want = names.ToHashSet(StringComparer.Ordinal);
        return Wmi.Query(Ns, "SELECT AttributeName, CurrentValue FROM EnumerationAttribute")
            .Select(o => (Name: o["AttributeName"]?.ToString() ?? "", Now: Wmi.First(o["CurrentValue"])))
            .Where(x => want.Contains(x.Name)).GroupBy(x => x.Name).ToDictionary(g => g.Key, g => g.First().Now);
    }

    public void Set(string name, string value)
    {
        var status = Wmi.Call(Ns, "BIOSAttributeInterface", "SetAttribute", a =>
        {
            a["SecType"] = 0u;
            a["SecHndCount"] = 0u;
            a["SecHandle"] = Array.Empty<byte>();
            a["AttributeName"] = name;
            a["AttributeValue"] = value;
        }, "Status");
        long code = Convert.ToInt64(status ?? -1L);
        if (code != 0) throw new RigException(code switch
        {
            3 => "Dell's firmware refused it: it needs a BIOS password, which Rig never uses. Nothing changed.",
            4 => "Dell's firmware doesn't let Windows change this one. Nothing changed.",
            2 => "Dell's firmware doesn't take that value here. Nothing changed.",
            _ => $"Dell's firmware didn't take it (code {code}). Nothing changed.",
        });
    }
}

sealed class HpBios : IBios
{
    const string Ns = @"root\HP\InstrumentedBIOS";
    public string Maker => "hp";
    public bool Present() => Wmi.Answers(Ns, "SELECT Name FROM HP_BIOSEnumeration");

    public string Password()
    {
        try
        {
            var all = Wmi.Query(Ns, "SELECT Name, IsSet FROM HP_BIOSPassword");
            if (all.Count == 0) return "not known";
            return all.Any(p => Convert.ToInt64(p["IsSet"] ?? 1L) != 0) ? "set" : "none";
        }
        catch (Exception e) when (e is ManagementException or COMException or UnauthorizedAccessException) { return "not known"; }
    }

    public Dictionary<string, string> Read(IEnumerable<string> names)
    {
        var want = names.ToHashSet(StringComparer.Ordinal);
        return Wmi.Query(Ns, "SELECT Name, CurrentValue FROM HP_BIOSEnumeration")
            .Select(o => (Name: o["Name"]?.ToString() ?? "", Now: Wmi.First(o["CurrentValue"])))
            .Where(x => want.Contains(x.Name)).GroupBy(x => x.Name).ToDictionary(g => g.Key, g => g.First().Now);
    }

    public void Set(string name, string value)
    {
        var said = Wmi.Call(Ns, "HP_BIOSSettingInterface", "SetBIOSSetting", a =>
        {
            a["Name"] = name;
            a["Value"] = value;
            // HP's way of saying there is no setup password. Rig never sends one.
            a["Password"] = "<utf-16/>";
        }, "Return");
        long code = Convert.ToInt64(said ?? -1L);
        if (code != 0) throw new RigException(code switch
        {
            6 => "HP's firmware refused it: it needs the setup password, which Rig never uses. Nothing changed.",
            1 => "HP's firmware doesn't let Windows change this one. Nothing changed.",
            5 => "HP's firmware doesn't take that value here. Nothing changed.",
            _ => $"HP's firmware didn't take it (code {code}). Nothing changed.",
        });
    }
}

sealed class LenovoBios : IBios
{
    const string Ns = @"root\wmi";
    public string Maker => "lenovo";
    public bool Present() => Wmi.Answers(Ns, "SELECT CurrentSetting FROM Lenovo_BiosSetting");

    public string Password()
    {
        try
        {
            var all = Wmi.Query(Ns, "SELECT PasswordState FROM Lenovo_BiosPasswordSettings");
            if (all.Count == 0) return "not known";
            return all.Any(p => Convert.ToInt64(p["PasswordState"] ?? 1L) != 0) ? "set" : "none";
        }
        catch (Exception e) when (e is ManagementException or COMException or UnauthorizedAccessException) { return "not known"; }
    }

    /// "Name,Value" or "Name,Value;[Optional:...]" as Lenovo writes CurrentSetting.
    public static (string Name, string Value)? Parse(string? setting)
    {
        if (string.IsNullOrEmpty(setting)) return null;
        int comma = setting.IndexOf(',');
        if (comma <= 0) return null;
        string value = setting[(comma + 1)..];
        int semi = value.IndexOf(';');
        return (setting[..comma], semi < 0 ? value : value[..semi]);
    }

    public Dictionary<string, string> Read(IEnumerable<string> names)
    {
        var want = names.ToHashSet(StringComparer.Ordinal);
        return Wmi.Query(Ns, "SELECT CurrentSetting FROM Lenovo_BiosSetting")
            .Select(o => Parse(o["CurrentSetting"]?.ToString())).Where(x => x != null).Select(x => x!.Value)
            .Where(x => want.Contains(x.Name)).GroupBy(x => x.Name).ToDictionary(g => g.Key, g => g.First().Value);
    }

    public void Set(string name, string value)
    {
        if (name.IndexOfAny([',', ';']) >= 0 || value.IndexOfAny([',', ';']) >= 0) throw new RigException("That value can't be sent to Lenovo's firmware. Nothing changed.");
        string? set = Wmi.Call(Ns, "Lenovo_SetBiosSetting", "SetBiosSetting", a => a["parameter"] = $"{name},{value}", "return")?.ToString();
        if (set != "Success") throw new RigException(set == "Access Denied" ? "Lenovo's firmware refused it: it needs a supervisor password, which Rig never uses. Nothing changed." : $"Lenovo's firmware didn't take it ({set ?? "no answer"}). Nothing changed.");
        string? saved = Wmi.Call(Ns, "Lenovo_SaveBiosSettings", "SaveBiosSettings", a => a["parameter"] = "", "return")?.ToString();
        if (saved != "Success") throw new RigException($"Lenovo's firmware took the value but didn't save it ({saved ?? "no answer"}), so it may not apply at the next restart.");
    }
}

public static class Firmware
{
    public const string NeedsAdmin = "Firmware settings need admin rights, and Rig's helper is running without them. Restart Rig and choose Yes when Windows asks, then try again. Nothing changed.";

    /// The self-test's stand-in for the PC's maker class. Only code in this process can set it.
    internal static IBios? TestOnlyBios { get; set; }

    static IBios For(string maker) => maker switch { "dell" => new DellBios(), "hp" => new HpBios(), _ => new LenovoBios() };

    static string? Manufacturer()
    {
        try { return Wmi.Query(@"root\cimv2", "SELECT Manufacturer FROM Win32_ComputerSystem").Select(o => o["Manufacturer"]?.ToString()).FirstOrDefault(); }
        catch (Exception e) when (e is ManagementException or COMException) { return null; }
    }

    /// The maker's key and its class, when this is a Dell, HP or Lenovo PC whose class answers.
    public static (string? Maker, IBios? Bios) Find()
    {
        if (TestOnlyBios != null) return (TestOnlyBios.Maker, TestOnlyBios);
        string? maker = FirmwareTable.MakerOf(Manufacturer());
        if (maker == null) return (null, null);
        var bios = For(maker);
        return (maker, bios.Present() ? bios : null);
    }

    public static string MakerName(string? maker) => maker != null && FirmwareTable.Rules.Makers.TryGetValue(maker, out var m) ? m.Name : "this PC's maker";

    public static string NoInterface(string? maker) => maker == null
        ? "Rig changes firmware settings only on Dell, HP and Lenovo PCs, through the maker's own tools in Windows. On this PC, change it in firmware setup: Rig can give you the steps and restart into it for you."
        : $"{MakerName(maker)}'s firmware tools aren't answering in Windows on this PC, so Rig can't change firmware settings here. Change it in firmware setup: Rig can give you the steps and restart into it for you.";

    /// The words for a setting's value in the maker's own text: the table's word, or a fixed phrase for any other value.
    public static string Words(FirmwareTable.Setting s, FirmwareTable.MakerRow row, string? native)
    {
        if (native == null) return "not shown by the firmware";
        string? key = row.Values.FirstOrDefault(kv => string.Equals(kv.Value, native, StringComparison.OrdinalIgnoreCase)).Key;
        return key != null && s.Values.TryGetValue(key, out var w) ? w : "a value Rig doesn't know";
    }

    // ----- What Windows itself reads -----

    public static string SystemDrive()
    {
        string d = Environment.GetEnvironmentVariable("SystemDrive") ?? "C:";
        return Regex.IsMatch(d, "^[A-Za-z]:$") ? d.ToUpperInvariant() : "C:";
    }

    /// "on", "off" or "not known": whether BitLocker or device encryption protects the system drive. No key is read.
    public static string Encryption()
    {
        try
        {
            var v = Wmi.Query(@"root\cimv2\Security\MicrosoftVolumeEncryption", $"SELECT ProtectionStatus FROM Win32_EncryptableVolume WHERE DriveLetter = '{SystemDrive()}'").FirstOrDefault();
            if (v == null) return "off";
            return Convert.ToInt64(v["ProtectionStatus"] ?? 2L) switch { 0 => "off", 1 => "on", _ => "not known" };
        }
        // Windows without BitLocker has no such namespace or class: nothing can be encrypted.
        catch (ManagementException e) when (e.ErrorCode is ManagementStatus.InvalidNamespace or ManagementStatus.InvalidClass) { return "off"; }
        catch (Exception e) when (e is ManagementException or COMException or UnauthorizedAccessException) { return "not known"; }
    }

    public static string EncryptionLine(string enc) => $"Drive encryption on drive {SystemDrive()} {enc}";

    public static string Tpm()
    {
        try
        {
            var t = Wmi.Query(@"root\cimv2\Security\MicrosoftTpm", "SELECT IsEnabled_InitialValue, IsActivated_InitialValue FROM Win32_Tpm").FirstOrDefault();
            if (t == null) return "not found";
            return t["IsEnabled_InitialValue"] is true && t["IsActivated_InitialValue"] is true ? "on" : "off";
        }
        catch (Exception e) when (e is ManagementException or COMException or UnauthorizedAccessException) { return "not known"; }
    }

    public static string SecureBoot()
    {
        using var k = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\SecureBoot\State");
        if (k == null) return "not supported";
        return k.GetValue("UEFISecureBootEnabled") switch { 1 => "on", 0 => "off", _ => "not known" };
    }

    public static string Virtualization()
    {
        try
        {
            if (Wmi.Query(@"root\cimv2", "SELECT HypervisorPresent FROM Win32_ComputerSystem").FirstOrDefault()?["HypervisorPresent"] is true) return "on";
            var cpus = Wmi.Query(@"root\cimv2", "SELECT VirtualizationFirmwareEnabled FROM Win32_Processor");
            if (cpus.Count == 0 || cpus.Any(c => c["VirtualizationFirmwareEnabled"] is not bool)) return "not known";
            return cpus.All(c => c["VirtualizationFirmwareEnabled"] is true) ? "on" : "off";
        }
        catch (Exception e) when (e is ManagementException or COMException) { return "not known"; }
    }

    public static string WindowsSees(string what) => what switch { "tpm" => Tpm(), "secureBoot" => SecureBoot(), "virtualization" => Virtualization(), _ => "not known" };

    public static JsonObject WindowsState() => new() { ["tpm"] = Tpm(), ["secureBoot"] = SecureBoot(), ["virtualization"] = Virtualization() };

    // ----- Firmware setup at a restart -----

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern uint GetFirmwareEnvironmentVariableExW(string name, string guid, byte[] buffer, uint size, out uint attributes);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFirmwareType(out int type);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValueW(string? system, string name, out long luid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TokenPrivilege state, int length, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct TokenPrivilege { public int Count; public long Luid; public int Attributes; }

    const string GlobalVariable = "{8BE4DF61-93CA-11D2-AA0D-00E098032B8C}";

    static void EnableSystemEnvironment()
    {
        if (!OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, out IntPtr token)) return;
        try
        {
            if (!LookupPrivilegeValueW(null, "SeSystemEnvironmentPrivilege", out long luid)) return;
            var p = new TokenPrivilege { Count = 1, Luid = luid, Attributes = 0x2 };
            AdjustTokenPrivileges(token, false, ref p, Marshal.SizeOf<TokenPrivilege>(), IntPtr.Zero, IntPtr.Zero);
        }
        finally { CloseHandle(token); }
    }

    /// Whether Windows can open firmware setup at the next restart: the firmware's OsIndicationsSupported has its first bit.
    /// Readable is false when Rig couldn't tell; Why says so in plain words either way.
    public static (bool Readable, bool Supported, string Why) Setup()
    {
        if (GetFirmwareType(out int type) && type == 1) return (true, false, "This PC starts in the older BIOS mode, so Windows can't open its firmware setup. Press its setup key (often Del, F2 or F10) as it starts.");
        EnableSystemEnvironment();
        var buf = new byte[8];
        uint n = GetFirmwareEnvironmentVariableExW("OsIndicationsSupported", GlobalVariable, buf, (uint)buf.Length, out _);
        if (n == 0)
        {
            int err = Marshal.GetLastWin32Error();
            return err switch
            {
                203 => (true, false, "This PC's firmware doesn't let Windows open its setup. Press its setup key (often Del, F2 or F10) as it starts."),
                1314 => (false, false, "Rig needs admin rights to check whether Windows can open firmware setup. Restart Rig and choose Yes when Windows asks."),
                _ => (false, false, $"Rig couldn't check whether Windows can open firmware setup (error {err})."),
            };
        }
        return (buf[0] & 1) == 1 ? (true, true, "Windows can open firmware setup at the next restart.") : (true, false, "This PC's firmware doesn't let Windows open its setup. Press its setup key (often Del, F2 or F10) as it starts.");
    }

    /// Runs System32's shutdown.exe by its full path and returns its exit code. Never with a path or text from anyone else.
    public static int Shutdown(params string[] args)
    {
        var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "shutdown.exe")) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Environment.SystemDirectory };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new RigException("Windows didn't start its restart program.");
        if (!p.WaitForExit(30_000)) { try { p.Kill(); } catch { } throw new RigException("Windows' restart program didn't answer."); }
        return p.ExitCode;
    }

    // ----- read_pc firmware -----

    /// What the chat's firmware read sees: only Rig's words and the table's rows, never the maker's own text.
    public static string Read()
    {
        var (maker, bios) = Find();
        var o = new JsonObject
        {
            ["maker"] = maker == null ? "not Dell, HP or Lenovo" : MakerName(maker),
            ["makerTools"] = bios != null,
        };
        string enc = Encryption();
        if (bios != null)
        {
            string pw = bios.Password();
            o["firmwarePassword"] = pw;
            var rows = FirmwareTable.Rules.Settings.Values.Where(s => s.Makers.ContainsKey(maker!)).ToList();
            Dictionary<string, string> now;
            try { now = bios.Read(rows.Select(s => s.Makers[maker!].Attribute)); }
            catch (Exception e) when (e is ManagementException or COMException or UnauthorizedAccessException) { now = []; o["problem"] = Native.IsAdmin() ? "Rig couldn't read the maker's firmware settings." : NeedsAdmin; }
            var list = new JsonArray();
            foreach (var s in rows)
            {
                var row = s.Makers[maker!];
                if (!now.TryGetValue(row.Attribute, out string? native)) continue;
                var canSet = s.Allow.Where(v => row.Values.ContainsKey(v)).ToList();
                var r = new JsonObject { ["setting"] = s.Key, ["name"] = s.Name, ["now"] = Words(s, row, native) };
                string? no = !row.FromWindows ? row.Why : pw != "none" ? "A firmware password is set, so Rig won't change it." : s.Sealed && enc != "off" ? "Drive encryption is on, so Rig won't change it." : null;
                if (no == null) r["canSet"] = new JsonArray(canSet.Select(v => (JsonNode)v).ToArray());
                else r["why"] = no;
                if (row.Asks != null) r["asks"] = row.Asks;
                list.Add(r);
            }
            o["settings"] = list;
        }
        else o["next"] = NoInterface(maker);
        o["tpm"] = Tpm();
        o["secureBoot"] = SecureBoot();
        o["virtualization"] = Virtualization();
        o["driveEncryption"] = enc;
        var setup = Setup();
        o["firmwareSetupFromWindows"] = !setup.Readable ? "not known" : setup.Supported ? "yes" : "no";
        return o.ToJsonString();
    }
}

/// A firmware setting from Rig's table set to one of its values, through the maker's class.
sealed class FirmwareStep : INativeStep, IAfterRestart
{
    public string Name => "firmware";
    public bool Admin => true;

    static string Text(JsonObject op, string key) => op[key] is JsonValue v && v.TryGetValue(out string? s) ? s : "";

    public NativeCheck Check(JsonObject op)
    {
        string key = Text(op, "setting"), value = Text(op, "value"), does = Text(op, "does");
        var all = FirmwareTable.Rules.Settings;
        if (key.Trim().Length == 0 || key.Length > 64) throw new RigException($"setting must be one of: {string.Join(", ", all.Keys)}.");
        if (does.Trim().Length == 0 || does.Length > 300) throw new RigException("does must be one plain sentence.");
        if (!all.TryGetValue(key, out var s))
        {
            if (FirmwareTable.Never(key) is string never) return new NativeCheck(Kept(key, value.Length > 32 ? value[..32] : value, does), 3, [], [], Never: never);
            throw new RigException($"Rig doesn't change that firmware setting. It changes: {string.Join(", ", all.Keys)}.");
        }
        if (!s.Values.ContainsKey(value)) throw new RigException($"{s.Name} takes one of: {string.Join(", ", s.Allow)}.");
        var kept = Kept(key, value, does);
        if (!s.Allow.Contains(value)) return new NativeCheck(kept, 3, [], [], Never: s.Refuse.TryGetValue(value, out var words) ? words : $"Rig doesn't set {s.Name} to {s.Values[value]}");

        if (!Native.IsAdmin() && Firmware.TestOnlyBios == null) throw new RigException(Firmware.NeedsAdmin);
        var (maker, bios) = Firmware.Find();
        if (bios == null) throw new RigException(Firmware.NoInterface(maker));
        if (!s.Makers.TryGetValue(maker!, out var row)) throw new RigException($"Rig doesn't offer {s.Name} on {Firmware.MakerName(maker)} PCs. Look for it in firmware setup.");
        if (!row.FromWindows) throw new RigException(row.Why ?? $"{Firmware.MakerName(maker)} doesn't let Windows change {s.Name}. Change it in firmware setup.");
        if (!row.Values.TryGetValue(value, out string? to)) throw new RigException($"{Firmware.MakerName(maker)}'s firmware doesn't offer {s.Values[value]} for {s.Name}.");
        string pw = bios.Password();
        if (pw == "set") throw new RigException("A firmware (BIOS) password is set on this PC, so Rig won't change firmware settings: it never asks for or types that password. You can change it in firmware setup.");
        if (pw != "none") throw new RigException("Rig couldn't tell whether a firmware (BIOS) password is set, so it won't change firmware settings. You can change it in firmware setup.");
        string enc = Firmware.Encryption();
        if (s.Sealed && enc != "off")
            throw new RigException($"Drive encryption (BitLocker or device encryption) {(enc == "on" ? "protects" : "may protect")} drive {Firmware.SystemDrive()}, and changing {s.Name} would make Windows ask for its recovery key at the next start. Rig won't change it while encryption is on. You can in firmware setup once you have your recovery key.");
        var reasons = new List<string> { "A firmware (BIOS) setting from Rig's own list. It applies at the next restart, and Rig checks it after that restart." };
        if (!s.Undo) reasons.Add($"Rig won't turn {s.Name} off again for you. You can in firmware setup.");
        if (enc != "off") reasons.Add($"Drive encryption may be on for drive {Firmware.SystemDrive()}. Windows can ask for its recovery key at the next start: have it ready before you apply.");
        if (row.Asks != null) reasons.Add(row.Asks);
        var held = new JsonObject { ["maker"] = maker, ["attribute"] = row.Attribute, ["to"] = to };
        return new NativeCheck(kept, 3, reasons, [], Held: held);
    }

    static JsonObject Kept(string key, string value, string does) => new() { ["name"] = "firmware", ["setting"] = key, ["value"] = value, ["does"] = does };

    static (FirmwareTable.Setting S, FirmwareTable.MakerRow Row, IBios Bios, string To) Parts(JsonObject op)
    {
        var s = FirmwareTable.Rules.Settings[Text(op, "setting")];
        var held = op["held"] as JsonObject ?? throw new RigException("Rig lost track of which firmware setting this is. Look again.");
        string maker = held["maker"]?.ToString() ?? "";
        var (found, bios) = Firmware.Find();
        if (bios == null || found != maker || !s.Makers.TryGetValue(maker, out var row) || row.Attribute != held["attribute"]?.ToString()) throw new RigException(Firmware.NoInterface(found));
        return (s, row, bios, held["to"]?.ToString() ?? "");
    }

    static string? Now(IBios bios, string attribute) => bios.Read([attribute]).TryGetValue(attribute, out var v) ? v : null;

    public string Preview(JsonObject op)
    {
        var (s, row, bios, _) = Parts(op);
        return $"{s.Name}: {Firmware.Words(s, row, Now(bios, row.Attribute))}\n{Firmware.EncryptionLine(Firmware.Encryption())}";
    }

    public JsonObject Apply(JsonObject op)
    {
        var (_, row, bios, to) = Parts(op);
        string was = Now(bios, row.Attribute) ?? throw new RigException("The firmware didn't show this setting's value, so Rig didn't change it.");
        bios.Set(row.Attribute, to);
        return new JsonObject { ["was"] = was };
    }

    public string? Verify(JsonObject op)
    {
        var (s, row, bios, to) = Parts(op);
        string? now = Now(bios, row.Attribute);
        // A change the firmware holds for the person to confirm at the next start may not show yet.
        if (string.Equals(now, to, StringComparison.OrdinalIgnoreCase) || row.Asks != null) return null;
        return $"The firmware reads {s.Name} as {Firmware.Words(s, row, now)}.";
    }

    public void Undo(JsonObject op, JsonObject back)
    {
        var (s, row, bios, _) = Parts(op);
        if (!s.Undo) throw new RigException($"Rig won't turn {s.Name} off again, because that lowers this PC's protection. You can change it in firmware setup.");
        if (back["was"] is not JsonValue v || !v.TryGetValue(out string? was) || was.Length is 0 or > 100) throw new RigException("Rig has no note of the old value.");
        bios.Set(row.Attribute, was);
    }

    public JsonObject Note(JsonObject op, JsonObject? back) => new() { ["kind"] = "firmware", ["setting"] = Text(op, "setting"), ["value"] = Text(op, "value"), ["held"] = op["held"]?.DeepClone() };
}

/// Restarts this PC in a minute into its firmware setup: System32's shutdown.exe /r /fw /t 60, by its full path. It takes
/// nothing from the op but its name, and the app offers it from a button it draws itself on a steps card.
sealed class RestartToFirmwareStep : INativeStep, IAfterRestart
{
    public const string OpName = "restartToFirmware", Seconds = "60";
    public string Name => OpName;
    public bool Admin => true;

    public NativeCheck Check(JsonObject op)
    {
        if (!Native.IsAdmin()) throw new RigException(Firmware.NeedsAdmin);
        string enc = Firmware.Encryption();
        var reasons = new List<string> { "Restarts this PC in one minute and opens its firmware setup. Save your work first; Cancel stops it." };
        if (enc != "off") reasons.Add($"Drive encryption may be on for drive {Firmware.SystemDrive()}. Changing Secure Boot or the security chip in setup will make Windows ask for its recovery key: have it ready.");
        return new NativeCheck(new JsonObject { ["name"] = OpName }, 3, reasons, []);
    }

    public string Preview(JsonObject op)
    {
        var (_, supported, why) = Firmware.Setup();
        if (!supported) throw new RigException(why);
        return $"{why}\n{Firmware.EncryptionLine(Firmware.Encryption())}";
    }

    public JsonObject Apply(JsonObject op)
    {
        var before = Firmware.WindowsState();
        int code = Firmware.Shutdown("/r", "/fw", "/t", Seconds);
        if (code == 1190) throw new RigException("A restart or shut down is already waiting on this PC. Nothing new was set.");
        if (code != 0) throw new RigException($"Windows didn't set up the restart (code {code}).");
        return new JsonObject { ["before"] = before };
    }

    public string? Verify(JsonObject op) => null;

    public void Undo(JsonObject op, JsonObject back)
    {
        int code = Firmware.Shutdown("/a");
        // 1116: no restart is waiting, because it already happened or was stopped.
        if (code != 0 && code != 1116) throw new RigException($"Windows didn't stop the restart (code {code}).");
    }

    public JsonObject Note(JsonObject op, JsonObject? back) => new() { ["kind"] = "restart", ["before"] = back?["before"]?.DeepClone() };
}

/// What to check once the PC has restarted after a firmware change: one list in the admin store. The app asks for what
/// is due when it starts ("firmware.after"), and each entry is answered once.
public static class AfterRestart
{
    const int Keep = 20;
    /// A restart moves the boot time by more than this; a clock that drifts doesn't.
    const long Slack = 120_000;

    static string File(CommandStore store) => Path.Combine(store.Root, "after-restart.json");
    public static long Boot() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - Environment.TickCount64;

    static JsonArray Load(CommandStore store)
    {
        string f = File(store);
        if (!System.IO.File.Exists(f) || !store.Trusted(f)) return [];
        try { return JsonNode.Parse(System.IO.File.ReadAllText(f)) as JsonArray ?? []; } catch { return []; }
    }

    static void Save(CommandStore store, JsonArray list)
    {
        string f = File(store);
        System.IO.File.WriteAllText(f + ".tmp", list.ToJsonString());
        System.IO.File.Move(f + ".tmp", f, overwrite: true);
    }

    public static void Note(CommandStore store, string id, JsonObject entry)
    {
        var list = Load(store);
        entry["id"] = id;
        entry["boot"] = Boot();
        entry["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        list.Add(entry);
        while (list.Count > Keep) list.RemoveAt(0);
        Save(store, list);
    }

    public static void Drop(CommandStore store, string id)
    {
        var list = Load(store);
        var mine = list.Where(e => e?["id"]?.ToString() == id).ToList();
        if (mine.Count == 0) return;
        foreach (var e in mine) list.Remove(e);
        Save(store, list);
    }

    /// What is due since the last restart, each as the id of its change and one sentence; those are taken off the list.
    public static JsonObject Report(CommandStore store, long? bootNow = null)
    {
        long boot = bootNow ?? Boot();
        var list = Load(store);
        var found = new JsonArray();
        var due = list.Where(e => Json.Num(e?["boot"], boot) < boot - Slack).ToList();
        foreach (var e in due)
        {
            list.Remove(e);
            string? says;
            try { says = Says((JsonObject)e!); } catch (Exception x) when (x is RigException or ManagementException or COMException) { says = null; }
            if (says != null) found.Add(new JsonObject { ["id"] = e!["id"]?.ToString(), ["says"] = says });
        }
        if (due.Count > 0) Save(store, list);
        return new JsonObject { ["found"] = found };
    }

    static readonly (string Key, string Name)[] Seen = [("tpm", "The security chip (TPM)"), ("secureBoot", "Secure Boot"), ("virtualization", "Virtualization")];

    static string? Says(JsonObject e)
    {
        if (e["kind"]?.ToString() == "restart")
        {
            var before = e["before"] as JsonObject;
            var changed = Seen.Where(x => before?[x.Key]?.ToString() is string was && was != "not known" && Firmware.WindowsSees(x.Key) is string now && now != "not known" && now != was)
                .Select(x => $"{x.Name} is {Firmware.WindowsSees(x.Key)} now").ToList();
            return changed.Count > 0
                ? $"Since the restart into firmware setup: {string.Join("; ", changed)}."
                : "Since the restart into firmware setup, the security chip, Secure Boot and virtualization read as before. If you changed something else, check it in Windows.";
        }
        if (!FirmwareTable.Rules.Settings.TryGetValue(e["setting"]?.ToString() ?? "", out var s)) return null;
        string want = s.Values.TryGetValue(e["value"]?.ToString() ?? "", out var w) ? w : "";
        if (s.Windows != null)
        {
            string now = Firmware.WindowsSees(s.Windows);
            if (now == "not known") return $"After the restart, Rig couldn't read {s.Name} from Windows. Check it in firmware setup.";
            bool took = string.Equals(now, want, StringComparison.OrdinalIgnoreCase);
            return took ? $"After the restart, Windows reads {s.Name} as {now}: the change took." : $"After the restart, Windows reads {s.Name} as {now}, not {want.ToLowerInvariant()}: the change didn't take. Check it in firmware setup.";
        }
        var held = e["held"] as JsonObject;
        var (maker, bios) = Firmware.Find();
        if (bios == null || maker != held?["maker"]?.ToString() || !s.Makers.TryGetValue(maker!, out var row)) return $"After the restart, Rig couldn't read {s.Name} again. Check it in firmware setup.";
        string? native = bios.Read([row.Attribute]).TryGetValue(row.Attribute, out var v) ? v : null;
        return $"After the restart, the firmware reads {s.Name} as {Firmware.Words(s, row, native)}. Windows can't check this one itself.";
    }
}
