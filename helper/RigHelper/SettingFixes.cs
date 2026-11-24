// The typed fixes that reach most Windows settings (packages/core/src/actions.ts):
// one registry value, how a service starts, one power setting on the active
// plan. Each reads what is there first, so the call it returns puts back exactly
// that, and each is held to the same never list as general commands, from the
// rules files embedded in this exe (commands.json and fixes.json).

using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

/// The never list and the typed fixes' own rules, read from the same files the server and the app check against.
public static class FixRules
{
    record TextRule(string Says, string[] Contains);

    static JsonObject Load(string name)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name) ?? throw new InvalidOperationException($"{name} isn't in the helper.");
        return JsonNode.Parse(s)!.AsObject();
    }

    static readonly JsonObject Commands = Load("Rig.Rules.commands.json"), Fixes = Load("Rig.Rules.fixes.json");

    static TextRule Rule(JsonNode? n) => new(n!["says"]!.GetValue<string>(), n["contains"]!.AsArray().Select(c => Squash(c!.GetValue<string>())).ToArray());
    // A change is held to every never-list row, the ones about reading secrets included.
    static readonly TextRule[] Never = Commands["neverText"]!.AsArray().Select(Rule).ToArray();
    static readonly TextRule[] Protect = Commands["protectText"]!.AsArray().Select(Rule).ToArray();
    static readonly TextRule RegistryNever = Rule(Fixes["registryNever"]);

    /// The services Set-Service and Stop-Service treat as Windows' own protections, by name and display name.
    static readonly HashSet<string> Security = Commands["commands"]!.AsArray()
        .Where(c => c?["name"]?.GetValue<string>() is "Set-Service" or "Stop-Service")
        .SelectMany(c => c!["when"]?.AsArray() ?? new JsonArray())
        .Where(w => w?["tier"]?.GetValue<int>() == 3 && w["has"] is JsonArray)
        .SelectMany(w => w!["has"]!.AsArray().Select(h => h!.GetValue<string>()))
        .ToHashSet(StringComparer.Ordinal);

    public static readonly IReadOnlyList<PowerInfo> Power = Fixes["power"]!.AsArray().Select(p => new PowerInfo(
        p!["id"]!.GetValue<string>(), p["title"]!.GetValue<string>(),
        Guid.Parse(p["subgroup"]!.GetValue<string>()), p["subgroupAlias"]?.GetValue<string>(),
        Guid.Parse(p["setting"]!.GetValue<string>()), p["settingAlias"]?.GetValue<string>(),
        p["windows"]![0]!.GetValue<uint>(), p["windows"]![1]!.GetValue<uint>())).ToList();

    /// The rules' way of comparing text, as check.ts does it: fold A to Z, short hive names, \ only, no quotes, colons, plus signs or spaces, one \ at a time.
    public static string Squash(string text)
    {
        var sb = new StringBuilder(text.Length);
        foreach (char ch in text) sb.Append(ch is >= 'A' and <= 'Z' ? (char)(ch + 32) : ch);
        string s = sb.ToString().Replace("hkey_local_machine", "hklm").Replace("hkey_current_user", "hkcu").Replace('/', '\\');
        s = Regex.Replace(s, "[`'\"+: \t\r\n]", "");
        return Regex.Replace(s, @"\\+", @"\");
    }

    static string? Fits(TextRule[] rules, string flat) => rules.FirstOrDefault(r => r.Contains.Any(flat.Contains))?.Says;

    /// Why a change to this text is refused: a never-list row, or a protection it would lower. Null when neither fits.
    public static string? Refusal(string text)
    {
        string flat = Squash(text);
        return (Fits(Never, flat) ?? Fits(Protect, flat)) is string says ? $"{says}." : null;
    }

    public static string? RegistryRefusal(string key, string name)
    {
        string text = $@"{key}\{name}";
        if (Refusal(text) is string no) return no;
        return Fits([RegistryNever], Squash(text)) is string says ? $"{says}." : null;
    }

    public const string ServicesKey = @"SYSTEM\CurrentControlSet\Services\";

    public static string? ServiceRefusal(string name)
    {
        if (Security.Contains(name.ToLowerInvariant()))
            return "It's one of Windows' own protections (Defender, the firewall, Security Center, the event log or Windows Update), so Rig doesn't change how it starts.";
        return Refusal($@"HKLM\{ServicesKey}{name}\");
    }

    /// The selftest's look at the rules: they loaded, and they refuse what the server refuses.
    public static IEnumerable<string> SelfChecks()
    {
        if (Never.Length == 0 || Protect.Length == 0 || Security.Count < 9 || Power.Count < 8) yield return "the fix rules didn't load from the embedded files";
        if (Squash("HKEY_CURRENT_USER/Software\\\\Microsoft\\ 'Windows'") != @"hkcu\software\microsoft\windows") yield return "the fix rules compare text differently from the app";
        if (RegistryRefusal(@"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "x") == null) yield return "a registry write to the Run key wasn't refused";
        if (RegistryRefusal(@"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System", "EnableLUA") == null) yield return "a registry write that lowers UAC wasn't refused";
        if (RegistryRefusal(@"HKCU\Software\Classes\CLSID\{0}\InprocServer32", "") == null) yield return "a registry write that picks a program wasn't refused";
        if (RegistryRefusal(@"HKCU\Control Panel\Desktop", "MenuShowDelay") != null) yield return "an ordinary registry write was refused";
        foreach (var s in new[] { "WinDefend", "wuauserv", "Windows Update", "WdFilter", "TermService", "sshd" })
            if (ServiceRefusal(s) == null) yield return $"changing how {s} starts wasn't refused";
        if (ServiceRefusal("SysMain") != null) yield return "changing how an ordinary service starts was refused";
    }
}

public record PowerInfo(string Id, string Title, Guid Subgroup, string? SubgroupAlias, Guid Setting, string? SettingAlias, uint Min, uint Max);

/// The person at the Rig app: HKCU in a fix is their hive, found by SID under HKEY_USERS, because the helper may run elevated as another account.
public static class Person
{
    static string? sid;

    /// The SID of the account that runs the Rig app that started this helper (`--parent`, which Main has checked is the pipe's other end), else this process's own.
    public static string Sid => sid ??= FromApp() ?? WindowsIdentity.GetCurrent().User?.Value ?? throw new RigException("Rig couldn't tell which Windows account this is.");

    static string? FromApp()
    {
        var args = Environment.GetCommandLineArgs();
        int i = Array.IndexOf(args, "--parent");
        if (i < 0 || i + 1 >= args.Length || !int.TryParse(args[i + 1], out int pid)) return null;
        IntPtr process = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
        if (process == IntPtr.Zero) return null;
        try
        {
            if (!OpenProcessToken(process, 0x8 /* TOKEN_QUERY */, out IntPtr token)) return null;
            try { using var id = new WindowsIdentity(token); return id.User?.Value; }
            finally { CloseHandle(token); }
        }
        catch { return null; }
        finally { CloseHandle(process); }
    }

    /// The person's hive, open for writing. If it isn't loaded under HKEY_USERS (it is while they're signed in), this account's HKCU, which is the same hive unless an administrator elevated for them with their own password.
    public static RegistryKey Hive() => Registry.Users.OpenSubKey(Sid, writable: true) ?? Registry.CurrentUser;

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
}

/// registry.set and registry.restore: one value, typed, with an exact undo.
public sealed class RegistryStep : IStep
{
    static readonly Regex KeyRe = new(@"^(?:registry::)?(hkey_current_user|hkcu|hkey_local_machine|hklm)(?::\\|\\)(.+)$", RegexOptions.IgnoreCase);
    static readonly Dictionary<string, uint> Types = new() { ["string"] = 1, ["expandString"] = 2, ["dword"] = 4, ["qword"] = 11, ["multiString"] = 7 };
    const int NotFound = 2;

    /// HKCU\... or HKLM\..., as the app stores it, or a refusal.
    public static string Key(JsonObject c)
    {
        string raw = Steps.S(c, "key");
        var m = KeyRe.Match(raw.Trim());
        string rest = m.Success ? m.Groups[2].Value.TrimEnd('\\') : "";
        if (!m.Success || raw.Length > 1024 || raw.Contains(@"\\") || raw.IndexOfAny(['*', '?']) >= 0 || raw.Any(char.IsControl)
            || rest.Length == 0 || rest.Split('\\').Any(p => p.Trim().Length == 0 || p is "." or ".." || p.Length > 255))
            throw new RigException("That isn't a registry key Rig can change: it must start with HKCU\\ or HKLM\\ and have no wildcards.");
        return $@"{(m.Groups[1].Value.ToLowerInvariant() is "hkcu" or "hkey_current_user" ? "HKCU" : "HKLM")}\{rest}";
    }

    static string Name(JsonObject c) =>
        c["name"] is JsonValue v && v.TryGetValue(out string? s) && s.Length <= 16383 && !s.Any(char.IsControl) ? s : throw new RigException("name must be the value's name, or \"\" for the default value.");

    static (RegistryKey Root, string Path) Open(string key) => key.StartsWith(@"HKLM\") ? (Registry.LocalMachine, key[5..]) : (Person.Hive(), key[5..]);

    /// The value as Windows stores it, or null when it or its key isn't there.
    static (uint Type, byte[] Data)? ReadRaw(string key, string name)
    {
        var (root, path) = Open(key);
        using (root)
        {
            using var k = root.OpenSubKey(path);
            if (k == null) return null;
            uint size = 0;
            int rc = RegQueryValueExW(k.Handle, name, IntPtr.Zero, out uint type, null, ref size);
            if (rc == NotFound) return null;
            var data = new byte[size];
            rc = RegQueryValueExW(k.Handle, name, IntPtr.Zero, out type, data, ref size);
            if (rc == NotFound) return null;
            if (rc != 0) throw new RigException($"Rig couldn't read {name} in {key} (Windows error {rc}).");
            return (type, data.AsSpan(0, (int)size).ToArray());
        }
    }

    static JsonObject? RawJson((uint Type, byte[] Data)? raw) => raw is { } r ? new JsonObject { ["type"] = r.Type, ["data"] = Convert.ToBase64String(r.Data) } : null;

    /// Writes the value (or removes it when `raw` is null). Returns the highest key it had to make, if any. Removing also removes the keys up to `made` that are left empty.
    static string? WriteRaw(string key, string name, (uint Type, byte[] Data)? raw, string? made)
    {
        var (root, path) = Open(key);
        using (root)
        {
            if (raw is not { } r)
            {
                using (var k = root.OpenSubKey(path, writable: true)) k?.DeleteValue(name, throwOnMissingValue: false);
                if (made != null && made.StartsWith(@$"{key[..4]}\") && (path + @"\").StartsWith(made[5..] + @"\", StringComparison.OrdinalIgnoreCase))
                    for (string p = path; p.Length >= made.Length - 5; p = p[..Math.Max(0, p.LastIndexOf('\\'))])
                    {
                        using (var k = root.OpenSubKey(p)) if (k == null || k.ValueCount > 0 || k.SubKeyCount > 0) break;
                        root.DeleteSubKey(p, throwOnMissingSubKey: false);
                        if (!p.Contains('\\')) break;
                    }
                return null;
            }
            string? first = null;
            var parts = path.Split('\\');
            for (int i = 1; i <= parts.Length && first == null; i++)
            {
                string p = string.Join('\\', parts[..i]);
                using var k = root.OpenSubKey(p);
                if (k == null) first = $@"{key[..4]}\{p}";
            }
            using (var k = root.CreateSubKey(path, writable: true))
            {
                int rc = RegSetValueExW(k.Handle, name, 0, r.Type, r.Data, (uint)r.Data.Length);
                if (rc != 0) throw new RigException(rc == 5 ? $"Rig's helper needs admin rights to change {key}." : $"Windows didn't save {name} in {key} (error {rc}).");
            }
            return first;
        }
    }

    /// A typed value as bytes, the way regedit stores it: little-endian numbers, UTF-16 text ending in a NUL, a list ending in two.
    static (uint Type, byte[] Data) Encode(JsonObject c)
    {
        string type = Steps.S(c, "type");
        if (!Types.TryGetValue(type, out uint t)) throw new RigException("type must be dword, qword, string, expandString or multiString.");
        var v = c["value"];
        byte[] Text(string s) => Encoding.Unicode.GetBytes(s + "\0");
        string Str(JsonNode? n) => n is JsonValue x && x.TryGetValue(out string? s) && !s.Contains('\0') && s.Length <= 32767 ? s : throw new RigException($"A {type} value must be text.");
        return type switch
        {
            "dword" => (t, BitConverter.GetBytes(v is JsonValue d && d.TryGetValue(out long n) && n is >= 0 and <= uint.MaxValue ? (uint)n : throw new RigException("A dword value must be a whole number from 0 to 4294967295."))),
            "qword" => (t, BitConverter.GetBytes(
                v is JsonValue q && (q.TryGetValue(out long l) && l >= 0 ? (ulong?)l : q.TryGetValue(out string? qs) && Regex.IsMatch(qs, @"^\d{1,20}$") && ulong.TryParse(qs, out ulong u) ? u : null) is ulong w
                    ? w : throw new RigException("A qword value must be a whole number from 0 to 18446744073709551615."))),
            "multiString" => (t, v is JsonArray a && a.Count <= 1000 && a.All(x => Str(x).Length > 0)
                ? Encoding.Unicode.GetBytes(string.Join("\0", a.Select(Str)) + "\0\0") : throw new RigException("A multiString value must be a list of text, with no empty lines.")),
            _ => (t, Text(Str(v))),
        };
    }

    static (string Key, string Name) Checked(JsonObject c)
    {
        string key = Key(c), name = Name(c);
        if (FixRules.RegistryRefusal(key, name) is string no) throw new RigException(no);
        return (key, name);
    }

    static (uint, byte[])? Wanted(JsonObject c)
    {
        if (Steps.S(c, "kind") == "registry.set") return Encode(c);
        if (c["was"] is not JsonObject was) return null;
        uint type = was["type"] is JsonValue tv && tv.TryGetValue(out long n) && n is >= 0 and <= uint.MaxValue ? (uint)n : throw new RigException("The saved value has no type.");
        try { return (type, Convert.FromBase64String(Steps.S(was, "data", allowEmpty: true))); }
        catch (FormatException) { throw new RigException("The saved value isn't readable."); }
    }

    public JsonNode? Read(JsonObject c)
    {
        var (key, name) = Checked(c);
        return new JsonObject { ["kind"] = "registry.set", ["was"] = RawJson(ReadRaw(key, name)) };
    }

    public JsonObject Apply(JsonObject c)
    {
        var (key, name) = Checked(c);
        var wanted = Wanted(c);
        var was = ReadRaw(key, name);
        string? made = WriteRaw(key, name, wanted, c["made"]?.GetValue<string>());
        var undo = new JsonObject { ["kind"] = "registry.restore", ["key"] = key, ["name"] = name, ["was"] = RawJson(was) };
        if (made != null) undo["made"] = made;
        return undo;
    }

    public string? Verify(JsonObject c)
    {
        var (key, name) = Checked(c);
        var wanted = Wanted(c);
        var now = ReadRaw(key, name);
        if (wanted is not { } w) return now == null ? null : $"{name} is still in {key}.";
        return now is { } n && n.Type == w.Item1 && n.Data.AsSpan().SequenceEqual(w.Item2) ? null : $"{(name.Length == 0 ? "The default value" : name)} in {key} doesn't hold the new value.";
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegQueryValueExW(SafeRegistryHandle key, string? name, IntPtr reserved, out uint type, byte[]? data, ref uint size);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegSetValueExW(SafeRegistryHandle key, string? name, int reserved, uint type, byte[] data, uint size);
}

/// service.startType: how a service starts. It never starts or stops the service.
public sealed class ServiceStep : IStep
{
    static readonly Regex NameRe = new(@"^[A-Za-z0-9_.$ -]{1,256}$");

    sealed record Found(string Name, string Display, string Start);

    static Found Look(JsonObject c)
    {
        string asked = Steps.S(c, "name").Trim();
        if (!NameRe.IsMatch(asked)) throw new RigException("name must be a service's name.");
        if (FixRules.ServiceRefusal(asked) is string no) throw new RigException(no);
        using var sc = new ServiceController(asked);
        string name, display;
        ServiceStartMode mode;
        try
        {
            name = sc.ServiceName;
            display = sc.DisplayName;
            mode = sc.StartType;
            if ((sc.ServiceType & (ServiceType.Win32OwnProcess | ServiceType.Win32ShareProcess)) == 0) throw new RigException($"{asked} is a driver, not a service Rig changes.");
        }
        catch (InvalidOperationException) { throw new RigException($"There's no service called {asked} on this PC."); }
        // The name Windows knows it by, and the one it shows, are held to the rules too: a display name can stand for a protected service.
        if ((FixRules.ServiceRefusal(name) ?? FixRules.ServiceRefusal(display)) is string no2) throw new RigException(no2);
        string start = mode switch
        {
            ServiceStartMode.Automatic => Delayed(name) ? "automaticDelayed" : "automatic",
            ServiceStartMode.Manual => "manual",
            ServiceStartMode.Disabled => "disabled",
            _ => throw new RigException($"{display} starts with Windows' drivers, so Rig doesn't change it."),
        };
        return new(name, display, start);
    }

    static bool Delayed(string name)
    {
        using var k = Registry.LocalMachine.OpenSubKey(FixRules.ServicesKey + name);
        return k?.GetValue("DelayedAutostart") is int v && v == 1;
    }

    static string Wanted(JsonObject c)
    {
        string s = Steps.S(c, "start");
        return s is "automatic" or "automaticDelayed" or "manual" or "disabled" ? s : throw new RigException("start must be automatic, automaticDelayed, manual or disabled.");
    }

    public JsonNode? Read(JsonObject c)
    {
        var f = Look(c);
        return new JsonObject { ["kind"] = "service.startType", ["start"] = f.Start, ["display"] = f.Display };
    }

    public JsonObject Apply(JsonObject c)
    {
        string start = Wanted(c);
        var f = Look(c);
        IntPtr scm = OpenSCManagerW(null, null, 0x1 /* SC_MANAGER_CONNECT */);
        if (scm == IntPtr.Zero) throw new RigException("Rig couldn't reach Windows' service manager.");
        try
        {
            IntPtr svc = OpenServiceW(scm, f.Name, 0x1 | 0x2 /* SERVICE_QUERY_CONFIG | SERVICE_CHANGE_CONFIG */);
            if (svc == IntPtr.Zero)
                throw new RigException(Marshal.GetLastWin32Error() == 5 ? "Rig's helper needs admin rights to change how a service starts." : $"Rig couldn't open the {f.Display} service.");
            try
            {
                uint type = start switch { "manual" => 3u, "disabled" => 4u, _ => 2u };
                if (!ChangeServiceConfigW(svc, NoChange, type, NoChange, null, null, IntPtr.Zero, null, null, null, null))
                    throw new RigException($"Windows didn't change how {f.Display} starts (error {Marshal.GetLastWin32Error()}).");
                if (start is "automatic" or "automaticDelayed")
                {
                    var info = new DelayedInfo { Delayed = start == "automaticDelayed" ? 1 : 0 };
                    if (!ChangeServiceConfig2W(svc, 3 /* SERVICE_CONFIG_DELAYED_AUTO_START_INFO */, ref info))
                        throw new RigException($"Windows didn't change whether {f.Display} waits a little after startup (error {Marshal.GetLastWin32Error()}).");
                }
            }
            finally { CloseServiceHandle(svc); }
        }
        finally { CloseServiceHandle(scm); }
        return new JsonObject { ["kind"] = "service.startType", ["name"] = f.Name, ["start"] = f.Start };
    }

    public string? Verify(JsonObject c)
    {
        var f = Look(c);
        return f.Start == Wanted(c) ? null : $"{f.Display} still starts as before ({f.Start}).";
    }

    const uint NoChange = 0xffffffff;
    [StructLayout(LayoutKind.Sequential)] struct DelayedInfo { public int Delayed; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenSCManagerW(string? machine, string? db, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenServiceW(IntPtr scm, string name, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ChangeServiceConfigW(IntPtr svc, uint type, uint start, uint error, string? path, string? group, IntPtr tag, string? deps, string? user, string? password, string? display);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ChangeServiceConfig2W(IntPtr svc, uint level, ref DelayedInfo info);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CloseServiceHandle(IntPtr h);
}

/// power.setting: one allowed setting on the active plan, plugged in and on battery.
public sealed class PowerStep : IStep
{
    static bool Same(string asked, Guid guid, string? alias) =>
        (Guid.TryParse(asked, out var g) && g == guid && Regex.IsMatch(asked, "^[0-9a-fA-F-]{36}$")) || (alias != null && string.Equals(asked, alias, StringComparison.OrdinalIgnoreCase));

    public static PowerInfo Info(JsonObject c)
    {
        string sub = Steps.S(c, "subgroup"), set = Steps.S(c, "setting");
        return FixRules.Power.FirstOrDefault(p => Same(sub, p.Subgroup, p.SubgroupAlias) && Same(set, p.Setting, p.SettingAlias))
            ?? throw new RigException("That isn't one of the power settings Rig changes.");
    }

    public static (uint Ac, uint Dc) ReadNow(PowerInfo p)
    {
        Guid scheme = Native.ActiveScheme(), sub = p.Subgroup, set = p.Setting;
        if (Native.PowerReadACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint ac) != 0 || Native.PowerReadDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint dc) != 0)
            throw new RigException($"This PC's power plan doesn't have the {p.Title} setting.");
        return (ac, dc);
    }

    static uint Value(JsonObject c, string k, PowerInfo p) =>
        c[k] is JsonValue v && v.TryGetValue(out long n) && n >= p.Min && n <= p.Max ? (uint)n : throw new RigException($"{k} must be a whole number from {p.Min} to {p.Max}.");

    public JsonNode? Read(JsonObject c)
    {
        var (ac, dc) = ReadNow(Info(c));
        return new JsonObject { ["kind"] = "power.setting", ["ac"] = ac, ["dc"] = dc };
    }

    public JsonObject Apply(JsonObject c)
    {
        var p = Info(c);
        uint ac = Value(c, "ac", p), dc = Value(c, "dc", p);
        var was = ReadNow(p);
        Guid scheme = Native.ActiveScheme(), sub = p.Subgroup, set = p.Setting;
        if (Native.PowerWriteACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, ac) != 0 || Native.PowerWriteDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, dc) != 0)
            throw new RigException($"Windows didn't save the {p.Title} setting.");
        Native.PowerSetActiveScheme(IntPtr.Zero, ref scheme); // applies it now
        return new JsonObject { ["kind"] = "power.setting", ["subgroup"] = p.Subgroup.ToString(), ["setting"] = p.Setting.ToString(), ["ac"] = was.Ac, ["dc"] = was.Dc };
    }

    public string? Verify(JsonObject c)
    {
        var p = Info(c);
        var now = ReadNow(p);
        return now.Ac == Value(c, "ac", p) && now.Dc == Value(c, "dc", p) ? null : $"{p.Title} reads {now.Ac} plugged in and {now.Dc} on battery.";
    }
}
