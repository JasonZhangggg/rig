// What the general command runner reads and puts back.
//
// TouchStates takes the snapshot of what a command says it touches: registry
// values and keys through the Win32 API as type and bytes (or "absent"),
// files as copies up to a size cap, and a service's start type and whether it
// runs. The person's hive is HKEY_USERS\<their SID>, never this process's
// HKEY_CURRENT_USER. Anything in the person's reach is read and written with
// the person's rights; the helper's admin rights are used only for places
// the rules say need them, and only for a command approved as admin.
//
// Sentinels are the fixed places no command may change (the never list).
// They are compared before and after every run; a difference is a hit.

using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

public sealed class TouchStates(Person person, bool admin)
{
    public const int MaxKeyEntries = 2000;
    public const long MaxKeyBytes = 4L << 20, MaxFileBytes = 8L << 20;
    const string Absent = "absent";

    public static bool IsAbsent(JsonNode? state) => state is JsonValue v && v.TryGetValue(out string? s) && s == Absent;

    /// With the helper's rights only where the rules say the place needs admin, and only for a command approved as admin.
    T Do<T>(string place, Func<T> act) => admin && Native.IsAdmin() && CommandCheck.NeedsAdmin(place) ? act() : person.Do(act);

    // ----- Registry -----

    RegistryKey Root(string path, out string sub)
    {
        bool mine = path.StartsWith(@"HKCU\", StringComparison.OrdinalIgnoreCase);
        if (!mine && !path.StartsWith(@"HKLM\", StringComparison.OrdinalIgnoreCase)) throw new RigException($"{path} isn't under HKLM or HKCU.");
        sub = mine ? $@"{person.Sid}\{path[5..]}" : path[5..];
        return RegistryKey.OpenBaseKey(mine ? RegistryHive.Users : RegistryHive.LocalMachine, RegistryView.Registry64);
    }

    public static JsonNode ReadValue(RegistryKey key, string name)
    {
        int size = 0;
        int rc = RegQueryValueExW(key.Handle, name, IntPtr.Zero, out int type, null, ref size);
        if (rc == ERROR_FILE_NOT_FOUND) return Absent;
        if (rc != 0 && rc != ERROR_MORE_DATA) throw new RigException($"Rig couldn't read {key.Name}\\{name} (Windows error {rc}).");
        byte[] data = new byte[size];
        if (size > 0 && (rc = RegQueryValueExW(key.Handle, name, IntPtr.Zero, out type, data, ref size)) != 0) throw new RigException($"Rig couldn't read {key.Name}\\{name} (Windows error {rc}).");
        return new JsonObject { ["type"] = type, ["data"] = Convert.ToHexString(data, 0, size) };
    }

    public static void WriteValue(RegistryKey key, string name, JsonNode state)
    {
        byte[] data = Convert.FromHexString(state["data"]!.GetValue<string>());
        int rc = RegSetValueExW(key.Handle, name, 0, (int)Json.Num(state["type"], 0), data, data.Length);
        if (rc != 0) throw new RigException($"Rig couldn't write {key.Name}\\{name} (Windows error {rc}).");
    }

    static JsonObject ReadTree(RegistryKey key, ref int entries, ref long bytes)
    {
        var values = new JsonObject();
        foreach (string name in key.GetValueNames().OrderBy(n => n, StringComparer.Ordinal))
        {
            var v = ReadValue(key, name);
            if (IsAbsent(v)) continue;
            bytes += v["data"]!.GetValue<string>().Length / 2;
            if (++entries > MaxKeyEntries || bytes > MaxKeyBytes) throw new RigException("it holds more than Rig can snapshot");
            values[name] = v;
        }
        var keys = new JsonObject();
        foreach (string name in key.GetSubKeyNames().OrderBy(n => n, StringComparer.Ordinal))
        {
            if (++entries > MaxKeyEntries) throw new RigException("it holds more than Rig can snapshot");
            using var child = key.OpenSubKey(name) ?? throw new RigException($"Rig couldn't open {key.Name}\\{name}");
            keys[name] = ReadTree(child, ref entries, ref bytes);
        }
        return new JsonObject { ["values"] = values, ["keys"] = keys };
    }

    static void WriteTree(RegistryKey key, JsonNode tree)
    {
        var values = tree["values"]!.AsObject();
        var keys = tree["keys"]!.AsObject();
        foreach (string name in key.GetValueNames()) if (!values.ContainsKey(name)) key.DeleteValue(name, throwOnMissingValue: false);
        foreach (var (name, v) in values) WriteValue(key, name, v!);
        foreach (string name in key.GetSubKeyNames()) if (!keys.ContainsKey(name)) key.DeleteSubKeyTree(name, throwOnMissingSubKey: false);
        foreach (var (name, child) in keys)
        {
            using var k = key.CreateSubKey(name, writable: true);
            WriteTree(k, child!);
        }
    }

    JsonNode ReadRegistry(Touch t) => Do(t.Text, () =>
    {
        using var root = Root(t.Text, out string sub);
        using var key = root.OpenSubKey(sub);
        if (t.Value != null) return new JsonObject { ["key"] = key != null, ["value"] = key == null ? Absent : ReadValue(key, t.Value) };
        if (key == null) return (JsonNode)Absent;
        int entries = 0;
        long bytes = 0;
        return ReadTree(key, ref entries, ref bytes);
    });

    void WriteRegistry(Touch t, JsonNode state) => Do(t.Text, () =>
    {
        using var root = Root(t.Text, out string sub);
        if (t.Value == null)
        {
            if (IsAbsent(state)) { root.DeleteSubKeyTree(sub, throwOnMissingSubKey: false); return 0; }
            using var whole = root.CreateSubKey(sub, writable: true);
            WriteTree(whole, state);
            return 0;
        }
        if (!IsAbsent(state["value"]))
        {
            using var made = root.CreateSubKey(sub, writable: true);
            WriteValue(made, t.Value, state["value"]!);
            return 0;
        }
        bool empty;
        using (var key = root.OpenSubKey(sub, writable: true))
        {
            if (key == null) return 0;
            key.DeleteValue(t.Value, throwOnMissingValue: false);
            empty = key.ValueCount == 0 && key.SubKeyCount == 0;
        }
        // The key wasn't there before the change either: take it away again once nothing is left in it.
        if (empty && state["key"]?.GetValue<bool>() == false) root.DeleteSubKey(sub, throwOnMissingSubKey: false);
        return 0;
    });

    // ----- Files -----

    JsonNode ReadFile(Touch t, string? copyTo)
    {
        byte[]? bytes = Do(t.Text, () =>
        {
            if (Directory.Exists(t.Text)) throw new RigException("it is a folder, and Rig snapshots single files");
            if (!File.Exists(t.Text)) return null;
            if (new FileInfo(t.Text).Length > MaxFileBytes) throw new RigException($"it is over {MaxFileBytes >> 20} MB");
            return File.ReadAllBytes(t.Text);
        });
        if (bytes == null) return Absent;
        if (copyTo != null) File.WriteAllBytes(copyTo, bytes);
        return new JsonObject { ["size"] = bytes.Length, ["sha256"] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() };
    }

    void WriteFile(Touch t, JsonNode state, string? copy)
    {
        byte[]? bytes = IsAbsent(state) ? null : File.ReadAllBytes(copy ?? throw new RigException("its copy is missing"));
        Do(t.Text, () =>
        {
            if (bytes == null) File.Delete(t.Text);
            else File.WriteAllBytes(t.Text, bytes);
            return 0;
        });
    }

    // ----- Services -----

    static string ServiceKey(string name) =>
        name.IndexOfAny(['\\', '/']) < 0 ? $@"SYSTEM\CurrentControlSet\Services\{name}" : throw new RigException("that isn't a service's name");

    static JsonNode ReadService(Touch t)
    {
        using var key = Registry.LocalMachine.OpenSubKey(ServiceKey(t.Text));
        if (key?.GetValue("Start") is not int start) return Absent;
        bool running = false;
        try { using var sc = new ServiceController(t.Text); running = sc.Status == ServiceControllerStatus.Running; } catch { }
        return new JsonObject { ["start"] = start, ["delayed"] = key.GetValue("DelayedAutostart") is int d && d == 1, ["running"] = running };
    }

    void WriteService(Touch t, JsonNode state)
    {
        if (!(admin && Native.IsAdmin())) throw new RigException("it needs admin rights");
        if (IsAbsent(state)) throw new RigException("the service wasn't there before, and Rig doesn't remove services");
        IntPtr scm = OpenSCManagerW(null, null, SC_MANAGER_CONNECT), svc = IntPtr.Zero;
        try
        {
            if (scm != IntPtr.Zero) svc = OpenServiceW(scm, t.Text, SERVICE_CHANGE_CONFIG);
            if (svc == IntPtr.Zero) throw new RigException($"Windows wouldn't open the service (error {Marshal.GetLastWin32Error()})");
            if (!ChangeServiceConfigW(svc, SERVICE_NO_CHANGE, (uint)Json.Num(state["start"], 3), SERVICE_NO_CHANGE, null, null, IntPtr.Zero, null, null, null, null))
                throw new RigException($"Windows wouldn't change how the service starts (error {Marshal.GetLastWin32Error()})");
            int delayed = state["delayed"]?.GetValue<bool>() == true ? 1 : 0;
            ChangeServiceConfig2W(svc, SERVICE_CONFIG_DELAYED_AUTO_START_INFO, ref delayed);
        }
        finally
        {
            if (svc != IntPtr.Zero) CloseServiceHandle(svc);
            if (scm != IntPtr.Zero) CloseServiceHandle(scm);
        }
        bool want = state["running"]?.GetValue<bool>() == true;
        using var sc = new ServiceController(t.Text);
        if (want && sc.Status != ServiceControllerStatus.Running) { sc.Start(); sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(15)); }
        if (!want && sc.Status != ServiceControllerStatus.Stopped) { sc.Stop(); sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(15)); }
    }

    // ----- One touch -----

    /// The state of one touch now, or null for a kind Rig can't snapshot. A file is also copied to `copyTo` when given.
    public JsonNode? Read(Touch t, string? copyTo = null)
    {
        try
        {
            return t.Kind switch { "registry" => ReadRegistry(t), "file" => ReadFile(t, copyTo), "service" => ReadService(t), _ => null };
        }
        catch (Exception e) when (e is not RigException)
        {
            throw new RigException(e is UnauthorizedAccessException or System.Security.SecurityException ? "Windows wouldn't let Rig read it" : e.Message);
        }
    }

    /// Puts one touch back as a snapshot recorded it. Throws with the reason when it can't.
    public void Write(Touch t, JsonNode state, string? copy)
    {
        try
        {
            switch (t.Kind)
            {
                case "registry": WriteRegistry(t, state); break;
                case "file": WriteFile(t, state, copy); break;
                case "service": WriteService(t, state); break;
            }
        }
        catch (Exception e) when (e is not RigException)
        {
            throw new RigException(e is UnauthorizedAccessException or System.Security.SecurityException ? "Windows wouldn't let Rig change it" : e.Message);
        }
    }

    public static string Name(Touch t) => t.Kind == "registry" && t.Value != null ? $@"{t.Text}\{(t.Value.Length == 0 ? "(Default)" : t.Value)}" : t.Text;

    /// A state in words for the card. Null when it isn't there.
    public static string? Show(Touch t, JsonNode? state)
    {
        if (state == null) return "Rig can't read this kind of thing, so there is no snapshot of it.";
        switch (t.Kind)
        {
            case "registry" when t.Value != null:
                return IsAbsent(state["value"]) ? null : ShowValue(state["value"]!);
            case "registry":
                if (IsAbsent(state)) return null;
                var (values, keys) = Count(state);
                return $"{values} value{(values == 1 ? "" : "s")} and {keys} subkey{(keys == 1 ? "" : "s")}";
            case "file":
                return IsAbsent(state) ? null : $"{Json.Num(state["size"], 0):0} bytes, fingerprint {state["sha256"]!.GetValue<string>()[..12]}";
            default:
                if (IsAbsent(state)) return null;
                string start = (int)Json.Num(state["start"], -1) switch { 0 => "Boot", 1 => "System", 2 => state["delayed"]?.GetValue<bool>() == true ? "Automatic (delayed)" : "Automatic", 3 => "Manual", 4 => "Disabled", _ => "Unknown" };
                return $"{start}, {(state["running"]?.GetValue<bool>() == true ? "running" : "not running")}";
        }
    }

    static (int Values, int Keys) Count(JsonNode tree)
    {
        int values = tree["values"]!.AsObject().Count, keys = 0;
        foreach (var (_, child) in tree["keys"]!.AsObject())
        {
            var (v, k) = Count(child!);
            values += v;
            keys += k + 1;
        }
        return (values, keys);
    }

    public static string ShowValue(JsonNode value)
    {
        byte[] data = Convert.FromHexString(value["data"]!.GetValue<string>());
        string Text() => Encoding.Unicode.GetString(data).TrimEnd('\0');
        string shown = (int)Json.Num(value["type"], 0) switch
        {
            1 or 2 => Text(),
            4 when data.Length == 4 => BitConverter.ToUInt32(data).ToString(),
            11 when data.Length == 8 => BitConverter.ToUInt64(data).ToString(),
            7 => Text().Replace('\0', '\n'),
            _ => Convert.ToHexString(data),
        };
        return shown.Length <= 400 ? shown : shown[..400] + "…";
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegQueryValueExW(SafeRegistryHandle key, string name, IntPtr reserved, out int type, byte[]? data, ref int size);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegSetValueExW(SafeRegistryHandle key, string name, int reserved, int type, byte[] data, int size);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenSCManagerW(string? machine, string? database, uint access);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenServiceW(IntPtr scm, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ChangeServiceConfigW(IntPtr svc, uint type, uint start, uint error, string? path, string? group, IntPtr tag, string? deps, string? user, string? password, string? display);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool ChangeServiceConfig2W(IntPtr svc, uint level, ref int info);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CloseServiceHandle(IntPtr h);
    const int ERROR_FILE_NOT_FOUND = 2, ERROR_MORE_DATA = 234;
    const uint SC_MANAGER_CONNECT = 0x1, SERVICE_CHANGE_CONFIG = 0x2, SERVICE_NO_CHANGE = 0xFFFFFFFF, SERVICE_CONFIG_DELAYED_AUTO_START_INFO = 3;
}

public sealed record SentinelHit(string Sentinel, string Before, string After)
{
    public JsonObject ToJson() => new() { ["sentinel"] = Sentinel, ["before"] = Before, ["after"] = After };
}

/// One reading of the never-list places: for each sentinel, its items and what each holds. Registry items hold "type:hex".
public sealed class Sentinels(Person person)
{
    public sealed class Reading : Dictionary<string, SortedDictionary<string, string>>
    {
        public byte[]? Hosts;
    }

    sealed record Watch(string Sentinel, string Key, string[]? Values = null, int Depth = 0);

    static readonly string[] Proxy = ["ProxyEnable", "ProxyServer", "AutoConfigURL"];
    static readonly string[] Ifeo = ["Debugger", "VerifierDlls", "GlobalFlag"];
    static readonly Watch[] Watched =
    [
        new("run", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"),
        new("run", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce"),
        new("run", @"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"),
        new("run", @"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce"),
        new("run", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run"),
        new("run", @"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"),
        new("run", @"HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce"),
        new("run", @"HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run"),
        new("ifeo", @"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options", Ifeo, 1),
        new("ifeo", @"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows NT\CurrentVersion\Image File Execution Options", Ifeo, 1),
        new("ifeo", @"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SilentProcessExit", null, 1),
        // Only the hooks: the same key can hold a saved password, which Rig never reads.
        new("winlogon", @"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon", ["Shell", "Userinit", "Taskman", "AppSetup", "VmApplet", "GinaDLL"]),
        new("winlogon", @"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon", ["Shell", "Userinit"]),
        new("winlogon", @"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows", ["AppInit_DLLs", "LoadAppInit_DLLs"]),
        new("winlogon", @"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager", ["BootExecute"]),
        new("winlogon", @"HKLM\SYSTEM\CurrentControlSet\Control\Lsa", ["Authentication Packages", "Notification Packages", "Security Packages"]),
        new("defenderExclusions", @"HKLM\SOFTWARE\Microsoft\Windows Defender\Exclusions", null, 1),
        new("defenderExclusions", @"HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\Exclusions", null, 1),
        new("rdp", @"HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server", ["fDenyTSConnections"]),
        new("rdp", @"HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services", ["fDenyTSConnections"]),
        new("winrm", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Listener", null, 1),
        // Not AuthRoot: Windows adds to that list by itself as sites are visited.
        new("rootCertificates", @"HKLM\SOFTWARE\Microsoft\SystemCertificates\Root\Certificates", null, 1),
        new("rootCertificates", @"HKLM\SOFTWARE\Policies\Microsoft\SystemCertificates\Root\Certificates", null, 1),
        new("rootCertificates", @"HKLM\SOFTWARE\Microsoft\EnterpriseCertificates\Root\Certificates", null, 1),
        new("rootCertificates", @"HKCU\Software\Microsoft\SystemCertificates\Root\Certificates", null, 1),
        new("proxy", @"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings", Proxy),
        new("proxy", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings", Proxy),
        new("proxy", @"HKLM\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\Internet Settings", [.. Proxy, "ProxySettingsPerUser"]),
        new("proxy", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\Connections", ["WinHttpSettings"]),
    ];

    /// Services whose start type Windows changes by itself, so a change there says nothing about the command.
    static readonly HashSet<string> SelfStarting = new(StringComparer.OrdinalIgnoreCase)
        { "BITS", "TrustedInstaller", "wuauserv", "UsoSvc", "WaaSMedicSvc", "DoSvc", "sppsvc", "ClipSVC", "msiserver", "AppXSvc", "InstallService", "WSearch" };

    const int MaxItems = 20_000;
    const char Sep = '\t';
    static readonly string HostsFile = Path.Combine(Environment.SystemDirectory, @"drivers\etc\hosts");

    RegistryKey? Open(string path, bool writable = false)
    {
        bool mine = path.StartsWith(@"HKCU\", StringComparison.Ordinal);
        using var root = RegistryKey.OpenBaseKey(mine ? RegistryHive.Users : RegistryHive.LocalMachine, RegistryView.Registry64);
        string sub = mine ? $@"{person.Sid}\{path[5..]}" : path[5..];
        return writable ? root.CreateSubKey(sub, writable: true) : root.OpenSubKey(sub);
    }

    void Collect(SortedDictionary<string, string> items, string path, string[]? values, int depth)
    {
        if (items.Count > MaxItems) return;
        using var key = Open(path);
        if (key == null) return;
        if (values == null) items[path] = "";
        foreach (string name in values ?? key.GetValueNames())
        {
            var v = TouchStates.ReadValue(key, name);
            if (!TouchStates.IsAbsent(v)) items[path + Sep + name] = $"{v["type"]}:{v["data"]}";
        }
        if (depth > 0) foreach (string sub in key.GetSubKeyNames()) Collect(items, $@"{path}\{sub}", values, depth - 1);
    }

    public Reading Read()
    {
        var all = new Reading();
        SortedDictionary<string, string> Of(string sentinel) => all.TryGetValue(sentinel, out var d) ? d : all[sentinel] = new(StringComparer.OrdinalIgnoreCase);
        void Try(string sentinel, Action<SortedDictionary<string, string>> read)
        {
            var items = Of(sentinel);
            try { read(items); } catch (Exception e) { items["(Rig couldn't read all of this)"] = e.GetType().Name; }
        }

        foreach (var w in Watched) Try(w.Sentinel, items => Collect(items, w.Key, w.Values, w.Depth));
        Try("services", items =>
        {
            using var services = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services");
            foreach (string name in services?.GetSubKeyNames() ?? [])
            {
                using var s = services!.OpenSubKey(name);
                // Programs that run as services, not device drivers, which Windows installs with a device.
                if (s?.GetValue("Type") is not int type || (type & 0x30) == 0) continue;
                items[name + Sep + "program"] = s.GetValue("ImagePath", "", RegistryValueOptions.DoNotExpandEnvironmentNames)?.ToString() ?? "";
                if (!SelfStarting.Contains(name)) items[name + Sep + "start"] = s.GetValue("Start")?.ToString() ?? "";
                using var p = s.OpenSubKey("Parameters");
                if (p?.GetValue("ServiceDll", null, RegistryValueOptions.DoNotExpandEnvironmentNames) is string dll) items[name + Sep + "dll"] = dll;
            }
        });
        Try("winrm", items =>
        {
            foreach (string name in new[] { "WinRM", "sshd" })
                try { using var sc = new ServiceController(name); if (sc.Status != ServiceControllerStatus.Stopped) items[name] = "running"; } catch (InvalidOperationException) { }
        });
        Try("localUsers", items => { foreach (var (name, disabled) in Accounts.Users()) items[name] = disabled ? "off" : "on"; });
        Try("administrators", items => { foreach (string sid in Accounts.Administrators()) items[sid] = ""; });
        Try("hosts", items =>
        {
            all.Hosts = File.Exists(HostsFile) ? File.ReadAllBytes(HostsFile) : null;
            items[HostsFile] = all.Hosts == null ? "" : Convert.ToHexString(SHA256.HashData(all.Hosts));
        });
        Try("scheduledTasks", items =>
        {
            string root = Path.Combine(Environment.SystemDirectory, "Tasks");
            var walk = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = 0 };
            foreach (string f in Directory.EnumerateFiles(root, "*", walk)) items[f[root.Length..]] = "";
        });
        Try("bcd", items =>
        {
            using var bcd = Registry.LocalMachine.OpenSubKey("BCD00000000");
            if (bcd == null) return;
            using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            void Walk(RegistryKey k)
            {
                foreach (string v in k.GetValueNames().OrderBy(x => x, StringComparer.Ordinal)) sha.AppendData(Encoding.UTF8.GetBytes($"{k.Name}|{v}|{TouchStates.ReadValue(k, v).ToJsonString()}\n"));
                foreach (string s in k.GetSubKeyNames().OrderBy(x => x, StringComparer.Ordinal)) { using var c = k.OpenSubKey(s); if (c != null) Walk(c); }
            }
            Walk(bcd);
            items["boot settings"] = Convert.ToHexString(sha.GetHashAndReset());
        });
        return all;
    }

    static string Label(string item) => item.Replace(Sep, '\\');

    static string Shown(string sentinel, string item, string value)
    {
        int colon = value.IndexOf(':');
        bool registry = item.StartsWith("HK", StringComparison.Ordinal) && colon > 0 && int.TryParse(value[..colon], out _);
        if (sentinel is "hosts" or "bcd" or "rootCertificates") return Label(item);
        if (registry) value = TouchStates.ShowValue(new JsonObject { ["type"] = int.Parse(value[..colon]), ["data"] = value[(colon + 1)..] });
        return value.Length == 0 ? Label(item) : $"{Label(item)} = {value}";
    }

    /// The items that differ between two readings. A service named in `touches` may have its start type changed, and nothing else.
    public static List<(string Sentinel, string Item)> Differences(Reading before, Reading after, IEnumerable<Touch> touches)
    {
        var allowed = touches.Where(t => t.Kind == "service").Select(t => t.Text + Sep + "start").ToHashSet(StringComparer.OrdinalIgnoreCase);
        var list = new List<(string, string)>();
        foreach (var (sentinel, was) in before)
        {
            var now = after[sentinel];
            foreach (string item in was.Keys.Union(now.Keys, StringComparer.OrdinalIgnoreCase))
            {
                if (was.TryGetValue(item, out string? a) == now.TryGetValue(item, out string? b) && a == b) continue;
                if (sentinel == "services" && allowed.Contains(item)) continue;
                // A way in that stopped running is no one let in.
                if (sentinel == "winrm" && b == null && !item.StartsWith("HK", StringComparison.Ordinal)) continue;
                list.Add((sentinel, item));
            }
        }
        return list;
    }

    public static List<SentinelHit> Hits(Reading before, Reading after, List<(string Sentinel, string Item)> differences)
    {
        const string none = "(not there)";
        string Side(Reading r, string sentinel, IEnumerable<string> items)
        {
            string text = string.Join("\n", items.Select(i => r[sentinel].TryGetValue(i, out string? v) ? Shown(sentinel, i, v) : $"{Label(i)}: {none}"));
            return text.Length <= 600 ? text : text[..600] + "…";
        }
        return differences.GroupBy(d => d.Sentinel).Select(g => new SentinelHit(g.Key, Side(before, g.Key, g.Select(d => d.Item)), Side(after, g.Key, g.Select(d => d.Item)))).ToList();
    }

    /// Puts back what it can of the items that differ: registry values and keys, and the hosts file. What it can't
    /// (a new service, account or task, boot settings) shows up when the caller reads the sentinels again.
    public void PutBack(Reading before, Reading after, List<(string Sentinel, string Item)> differences, bool admin)
    {
        T Do<T>(string path, Func<T> act) => path.StartsWith(@"HKLM\", StringComparison.Ordinal) && admin && Native.IsAdmin() ? act() : person.Do(act);
        foreach (var (sentinel, item) in differences.OrderBy(d => d.Item.Length))
        {
            try
            {
                if (sentinel == "hosts" && admin && Native.IsAdmin())
                {
                    if (before.Hosts == null) File.Delete(HostsFile);
                    else File.WriteAllBytes(HostsFile, before.Hosts);
                }
                if (!item.StartsWith("HK", StringComparison.Ordinal) || sentinel is "services" or "bcd") continue;
                bool was = before[sentinel].TryGetValue(item, out string? old);
                int sep = item.IndexOf(Sep);
                string path = sep < 0 ? item : item[..sep];
                Do(path, () =>
                {
                    if (sep < 0)
                    {
                        if (was) Open(path, writable: true)?.Dispose();
                        else { int cut = path.LastIndexOf('\\'); using var parent = Open(path[..cut], writable: true); parent?.DeleteSubKeyTree(path[(cut + 1)..], throwOnMissingSubKey: false); }
                        return 0;
                    }
                    if (was)
                    {
                        using var key = Open(path, writable: true);
                        int colon = old!.IndexOf(':');
                        TouchStates.WriteValue(key!, item[(sep + 1)..], new JsonObject { ["type"] = int.Parse(old[..colon]), ["data"] = old[(colon + 1)..] });
                    }
                    else
                    {
                        using var root = RegistryKey.OpenBaseKey(path.StartsWith(@"HKCU\", StringComparison.Ordinal) ? RegistryHive.Users : RegistryHive.LocalMachine, RegistryView.Registry64);
                        using var key = root.OpenSubKey(path.StartsWith(@"HKCU\", StringComparison.Ordinal) ? $@"{person.Sid}\{path[5..]}" : path[5..], writable: true);
                        key?.DeleteValue(item[(sep + 1)..], throwOnMissingValue: false);
                    }
                    return 0;
                });
            }
            catch { }
        }
    }
}

/// Local accounts and who is an administrator, straight from Windows.
static class Accounts
{
    public static List<(string Name, bool Disabled)> Users()
    {
        var list = new List<(string, bool)>();
        int resume = 0, rc;
        do
        {
            rc = NetUserEnum(null, 1, FILTER_NORMAL_ACCOUNT, out IntPtr buf, -1, out int read, out _, ref resume);
            if (rc != 0 && rc != ERROR_MORE_DATA) throw new InvalidOperationException($"NetUserEnum {rc}");
            try
            {
                for (int i = 0; i < read; i++)
                {
                    var u = Marshal.PtrToStructure<USER_INFO_1>(buf + i * Marshal.SizeOf<USER_INFO_1>());
                    list.Add((u.Name, (u.Flags & UF_ACCOUNTDISABLE) != 0));
                }
            }
            finally { NetApiBufferFree(buf); }
        } while (rc == ERROR_MORE_DATA);
        return list;
    }

    public static List<string> Administrators()
    {
        string group = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null).Translate(typeof(NTAccount)).Value;
        group = group[(group.IndexOf('\\') + 1)..];
        var list = new List<string>();
        IntPtr resume = IntPtr.Zero;
        int rc;
        do
        {
            rc = NetLocalGroupGetMembers(null, group, 0, out IntPtr buf, -1, out int read, out _, ref resume);
            if (rc != 0 && rc != ERROR_MORE_DATA) throw new InvalidOperationException($"NetLocalGroupGetMembers {rc}");
            try
            {
                for (int i = 0; i < read; i++) list.Add(new SecurityIdentifier(Marshal.ReadIntPtr(buf, i * IntPtr.Size)).Value);
            }
            finally { NetApiBufferFree(buf); }
        } while (rc == ERROR_MORE_DATA);
        return list;
    }

    const int FILTER_NORMAL_ACCOUNT = 2, ERROR_MORE_DATA = 234, UF_ACCOUNTDISABLE = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct USER_INFO_1
    {
        public string Name; public IntPtr Password; public int PasswordAge, Priv; public IntPtr HomeDir, Comment; public int Flags; public IntPtr ScriptPath;
    }

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserEnum(string? server, int level, int filter, out IntPtr buf, int maxLen, out int read, out int total, ref int resume);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetLocalGroupGetMembers(string? server, string group, int level, out IntPtr buf, int maxLen, out int read, out int total, ref IntPtr resume);
    [DllImport("netapi32.dll")] static extern int NetApiBufferFree(IntPtr buf);
}
