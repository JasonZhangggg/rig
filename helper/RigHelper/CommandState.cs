// What the general command runner reads and puts back.
//
// TouchStates takes the snapshot of what a command says it touches: registry
// values and keys through the Win32 API as type and bytes (or absent, with the
// deepest key that was there, so a restore removes only the keys the change
// made), files as copies up to a size cap, and a service's start type and
// whether it runs. Whether a service runs is shown, but is never drift: Windows
// starts and stops services by itself. The person's hive is HKEY_USERS\<their SID>, never this process's
// HKEY_CURRENT_USER. Anything in the person's reach is read and written with
// the person's rights; the helper's admin rights are used only for places
// the rules say need them, and only for a command approved as admin.
//
// Sentinels are the fixed places no command may change (the never list).
// They are read twice before a run, which must agree, and once after; a
// difference is a hit, and is put back where Windows lets it be: registry
// values, the hosts file, new services, accounts, administrators and
// scheduled tasks, service start types and remote access. Boot settings are
// only reported: importing a saved copy over them can leave a PC unable to
// start. What Windows changes by itself (drivers, its own services' updates,
// its own scheduled tasks) isn't watched.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

public sealed class TouchStates(Person person, bool admin)
{
    public const int MaxKeyEntries = 2000;
    public const long MaxKeyBytes = 4L << 20, MaxFileBytes = 8L << 20;
    const string Absent = "absent";

    public static bool IsAbsent(JsonNode? state) =>
        (state is JsonValue v && v.TryGetValue(out string? s) && s == Absent) || (state is JsonObject o && o["absent"] is JsonValue a && a.TryGetValue(out bool b) && b);

    /// A state without what doesn't count as a change since: the deepest key a registry snapshot found, and whether a service runs.
    public static JsonNode? Core(JsonNode? state)
    {
        if (state is not JsonObject o) return state?.DeepClone();
        var c = o.DeepClone().AsObject();
        c.Remove("anchor");
        c.Remove("running");
        return c;
    }

    public static bool SameCore(JsonNode? a, JsonNode? b) => (Core(a)?.ToJsonString() ?? "null") == (Core(b)?.ToJsonString() ?? "null");

    /// With the helper's rights only where the rules say the place needs admin, and only for a command approved as admin.
    bool Elevated(string place) => admin && Native.IsAdmin() && CommandCheck.NeedsAdmin(place);
    T Do<T>(string place, Func<T> act) => Elevated(place) ? act() : person.Do(act);

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

    static bool Exists(RegistryKey root, string sub) { using var k = root.OpenSubKey(sub); return k != null; }
    static string Parent(string sub) => sub.Contains('\\') ? sub[..sub.LastIndexOf('\\')] : "";

    /// The deepest part of the path that is there now.
    static string Anchor(RegistryKey root, string sub)
    {
        string at = sub;
        while (at.Length > 0 && !Exists(root, at)) at = Parent(at);
        return at;
    }

    /// Removes now-empty keys from `sub` up to, and not including, `anchor`: the keys a change made, and no others.
    static void Prune(RegistryKey root, string sub, string anchor)
    {
        for (string at = sub; at.Length > anchor.Length && at.StartsWith(anchor, StringComparison.OrdinalIgnoreCase); at = Parent(at))
        {
            using (var k = root.OpenSubKey(at))
            {
                if (k == null) continue;
                if (k.ValueCount > 0 || k.SubKeyCount > 0) return;
            }
            root.DeleteSubKey(at, throwOnMissingSubKey: false);
        }
    }

    JsonNode ReadRegistry(Touch t) => Do(t.Text, () =>
    {
        using var root = Root(t.Text, out string sub);
        using var key = root.OpenSubKey(sub);
        if (t.Value != null)
        {
            var o = new JsonObject { ["key"] = key != null, ["value"] = key == null ? Absent : ReadValue(key, t.Value) };
            if (key == null) o["anchor"] = Anchor(root, sub);
            return o;
        }
        if (key == null) return (JsonNode)new JsonObject { ["absent"] = true, ["anchor"] = Anchor(root, sub) };
        int entries = 0;
        long bytes = 0;
        return ReadTree(key, ref entries, ref bytes);
    });

    void WriteRegistry(Touch t, JsonNode state) => Do(t.Text, () =>
    {
        using var root = Root(t.Text, out string sub);
        if (t.Value == null)
        {
            if (IsAbsent(state))
            {
                root.DeleteSubKeyTree(sub, throwOnMissingSubKey: false);
                if (state["anchor"]?.ToString() is string top) Prune(root, Parent(sub), top);
                return 0;
            }
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
        using (var key = root.OpenSubKey(sub, writable: true))
        {
            if (key == null) return 0;
            key.DeleteValue(t.Value, throwOnMissingValue: false);
        }
        // The key wasn't there before the change either: take away the keys the change made once nothing is left in them.
        if (state["key"]?.GetValue<bool>() == false) Prune(root, sub, state["anchor"]?.ToString() ?? sub);
        return 0;
    });

    // ----- Files -----

    /// The helper's own rights reach a file only through folders that only admins could have made or changed. Anywhere
    /// else the person's rights do it, so a link the person planted leads only where the person could go anyway.
    bool AsHelper(string path) => Elevated(path) && AdminFile.Trusted(path);

    JsonNode ReadFile(Touch t, string? copyTo)
    {
        byte[]? bytes = AsHelper(t.Text) ? AdminFile.Read(t.Text, MaxFileBytes) : person.Do(() =>
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
        if (AsHelper(t.Text))
        {
            AdminFile.Write(t.Text, bytes);
            return;
        }
        person.Do(() =>
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

    // ----- Devices -----

    const int CR_SUCCESS = 0, CR_NO_SUCH_DEVNODE = 0x0D, CR_INVALID_DEVICE_ID = 0x1E;
    const uint DN_HAS_PROBLEM = 0x400;
    /// Windows' problem code for a device that is turned off.
    const uint CM_PROB_DISABLED = 22;

    /// Whether a device that is there has a problem, and which: 22 is turned off. Absent when Windows doesn't have it now.
    static JsonNode ReadDevice(Touch t)
    {
        int rc = CM_Locate_DevNodeW(out uint node, t.Text, 0);
        if (rc is CR_NO_SUCH_DEVNODE or CR_INVALID_DEVICE_ID) return Absent;
        uint status = 0, problem = 0;
        if (rc == CR_SUCCESS) rc = CM_Get_DevNode_Status(out status, out problem, node, 0);
        if (rc != CR_SUCCESS) throw new RigException($"Windows wouldn't say how the device is (error {rc})");
        return new JsonObject { ["problem"] = (status & DN_HAS_PROBLEM) != 0 ? problem : 0 };
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
        // Whether it runs is put back as far as Windows lets it: a service may stop or start again by itself.
        bool want = state["running"]?.GetValue<bool>() == true;
        try
        {
            using var sc = new ServiceController(t.Text);
            if (want && sc.Status != ServiceControllerStatus.Running) { sc.Start(); sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(15)); }
            if (!want && sc.Status != ServiceControllerStatus.Stopped && sc.CanStop) { sc.Stop(); sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(15)); }
        }
        catch (Exception e) when (e is InvalidOperationException or System.ServiceProcess.TimeoutException or System.ComponentModel.Win32Exception) { }
    }

    // ----- One touch -----

    /// The state of one touch now, or null for a kind Rig can't read. A file is also copied to `copyTo` when given. A device
    /// is read but not snapshotted: nothing writes it back, and its undo script turns it back.
    public JsonNode? Read(Touch t, string? copyTo = null)
    {
        try
        {
            return t.Kind switch { "registry" => ReadRegistry(t), "file" => ReadFile(t, copyTo), "service" => ReadService(t), "device" => ReadDevice(t), _ => null };
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
            case "device":
                if (IsAbsent(state)) return null;
                return (uint)Json.Num(state["problem"], 0) switch { 0 => "On", CM_PROB_DISABLED => "Off", var p => $"Not working (Windows' problem code {p})" };
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
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Locate_DevNodeW(out uint node, string id, uint flags);
    [DllImport("cfgmgr32.dll")] static extern int CM_Get_DevNode_Status(out uint status, out uint problem, uint node, uint flags);
    const int ERROR_FILE_NOT_FOUND = 2, ERROR_MORE_DATA = 234;
    const uint SC_MANAGER_CONNECT = 0x1, SERVICE_CHANGE_CONFIG = 0x2, SERVICE_NO_CHANGE = 0xFFFFFFFF, SERVICE_CONFIG_DELAYED_AUTO_START_INFO = 3;
}

public sealed record SentinelHit(string Sentinel, string Before, string After)
{
    public JsonObject ToJson() => new() { ["sentinel"] = Sentinel, ["before"] = Before, ["after"] = After };
}

/// One reading of the never-list places: for each sentinel, its items and what each holds. Registry items hold "type:hex".
public sealed class Sentinels(Person person, string work)
{
    public sealed class Reading : Dictionary<string, SortedDictionary<string, string>>
    {
        public byte[]? Hosts;
        public Dictionary<string, byte[]> Tasks { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    static readonly Dictionary<string, string> Plain = new()
    {
        ["services"] = "the list of Windows services or how they start", ["run"] = "the apps that start with Windows", ["ifeo"] = "which program Windows opens in place of another",
        ["winlogon"] = "what runs when you sign in", ["defenderExclusions"] = "the places Defender skips", ["localUsers"] = "the accounts on this PC",
        ["administrators"] = "who is an administrator on this PC", ["rdp"] = "Remote Desktop", ["winrm"] = "remote management",
        ["rootCertificates"] = "the certificates Windows trusts", ["hosts"] = "the hosts file", ["proxy"] = "the proxy settings",
        ["scheduledTasks"] = "the scheduled tasks", ["bcd"] = "how Windows starts up",
    };

    public const string Unread = "(Rig couldn't read all of this)";

    /// A sentinel in the words packages/ui's sentinelWords uses.
    public static string Words(string sentinel) => Plain.TryGetValue(sentinel, out string? w) ? w : sentinel;

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

    /// Services whose start type Windows changes by itself, so a change there says nothing about the command. None of them is a protection.
    static readonly HashSet<string> SelfStarting = new(StringComparer.OrdinalIgnoreCase)
        { "BITS", "TrustedInstaller", "DoSvc", "sppsvc", "ClipSVC", "msiserver", "AppXSvc", "InstallService", "WSearch", "edgeupdate", "edgeupdatem", "gupdate", "gupdatem", "MozillaMaintenance" };

    /// Services that update themselves by moving their program to a new version's folder: what they run isn't watched, how they start is.
    static readonly HashSet<string> NewVersions = new(StringComparer.OrdinalIgnoreCase)
        { "WinDefend", "WdNisSvc", "MDCoreSvc", "Sense", "SecurityHealthService", "MicrosoftEdgeElevationService" };

    /// Google's updater adds a service for each version it installs, named for that version and nothing else: a new one is
    /// still seen, but what it runs and how it starts aren't watched.
    static readonly Regex PerVersion = new(@"^GoogleUpdater(Internal)?Service\d+(\.\d+){3}\z", RegexOptions.CultureInvariant);

    /// Scheduled task folders Windows' own updaters fill and empty by themselves, each by itself: a task in a folder inside one is watched.
    static readonly string[] SelfTaskFolders =
    [
        @"\Microsoft\Windows\UpdateOrchestrator\", @"\Microsoft\Windows\WindowsUpdate\", @"\Microsoft\Windows\WindowsUpdate\RUXIM\", @"\Microsoft\Windows\WaaSMedic\",
        @"\Microsoft\Windows\InstallService\", @"\Microsoft\Windows\Windows Defender\", @"\Microsoft\Windows\SoftwareProtectionPlatform\", @"\Microsoft\Windows\Flighting\FeatureConfig\",
        @"\Microsoft\Windows\Flighting\OneSettings\", @"\Microsoft\Windows\Application Experience\",
    ];

    /// The tasks Edge's and Google's updaters make for themselves, by their whole names.
    static readonly Regex SelfTaskNames = new(@"^\\(MicrosoftEdgeUpdateTaskMachine(Core|UA)|GoogleUpdaterTask(System|User)\d+(\.\d+){3})(\{[^\\{}]+\})?\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    static bool SelfTask(string task) => SelfTaskNames.IsMatch(task) || SelfTaskFolders.Contains(task[..(task.LastIndexOf('\\') + 1)], StringComparer.OrdinalIgnoreCase);

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
            try { read(items); } catch (Exception e) { items[Unread] = e.GetType().Name; }
        }

        foreach (var w in Watched) Try(w.Sentinel, items => Collect(items, w.Key, w.Values, w.Depth));
        Try("services", items =>
        {
            using var services = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services");
            foreach (string name in services?.GetSubKeyNames() ?? [])
            {
                using var s = services!.OpenSubKey(name);
                // Programs that run as services, not device drivers, which Windows installs with a device, nor the copies of a
                // per-person service Windows makes for each sign-in.
                if (s?.GetValue("Type") is not int type || (type & 0x30) == 0 || (type & 0xC0) != 0) continue;
                if (PerVersion.IsMatch(name))
                {
                    items[name + Sep + "program"] = "";
                    continue;
                }
                items[name + Sep + "program"] = NewVersions.Contains(name) ? "" : s.GetValue("ImagePath", "", RegistryValueOptions.DoNotExpandEnvironmentNames)?.ToString() ?? "";
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
            foreach (string f in Directory.EnumerateFiles(root, "*", walk))
            {
                string task = f[root.Length..];
                if (SelfTask(task)) continue;
                // A task is known by what it does, not only by its name: its whole definition is fingerprinted and kept.
                byte[]? xml = null;
                try
                {
                    using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                    if (fs.Length <= 1 << 20) { xml = new byte[fs.Length]; fs.ReadExactly(xml); }
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
                items[task] = xml == null ? "" : Convert.ToHexString(SHA256.HashData(xml));
                if (xml != null) all.Tasks[task] = xml;
            }
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
        if (sentinel is "hosts" or "bcd" or "rootCertificates" or "scheduledTasks") return Label(item);
        if (registry) value = TouchStates.ShowValue(new JsonObject { ["type"] = int.Parse(value[..colon]), ["data"] = value[(colon + 1)..] });
        return value.Length == 0 ? Label(item) : $"{Label(item)} = {value}";
    }

    /// A key that is there with nothing of its own watched in it: whether it is there says nothing until a value appears.
    static bool KeyOnly(string item) => item.StartsWith("HK", StringComparison.Ordinal) && !item.Contains(Sep);

    static IEnumerable<(string Sentinel, string Item)> Changed(Reading before, Reading after)
    {
        foreach (var (sentinel, was) in before)
        {
            var now = after[sentinel];
            foreach (string item in was.Keys.Union(now.Keys, StringComparer.OrdinalIgnoreCase))
                if (was.TryGetValue(item, out string? a) != now.TryGetValue(item, out string? b) || a != b) yield return (sentinel, item);
        }
    }

    /// Two readings before a run: what differs between them is changing by itself, so it says nothing about the command.
    public (Reading Before, HashSet<(string, string)> Moving) Baseline()
    {
        var first = Read();
        var second = Read();
        return (second, Changed(first, second).ToHashSet());
    }

    /// The items that differ between two readings. A service named in `touches` may have its start type changed, and nothing else.
    public static List<(string Sentinel, string Item)> Differences(Reading before, Reading after, IEnumerable<Touch> touches, IReadOnlySet<(string, string)>? moving = null)
    {
        var allowed = touches.Where(t => t.Kind == "service").Select(t => t.Text + Sep + "start").ToHashSet(StringComparer.OrdinalIgnoreCase);
        var list = new List<(string, string)>();
        foreach (var (sentinel, item) in Changed(before, after))
        {
            bool gone = !after[sentinel].ContainsKey(item);
            if (moving?.Contains((sentinel, item)) == true || KeyOnly(item)) continue;
            if (sentinel == "services" && allowed.Contains(item)) continue;
            // A service, task or way in that went away is no one let in.
            if (gone && (sentinel is "services" or "scheduledTasks" || (sentinel == "winrm" && !item.StartsWith("HK", StringComparison.Ordinal)))) continue;
            list.Add((sentinel, item));
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

    /// Puts back what it can of the items that differ: registry values and keys, the hosts file, services, accounts,
    /// administrators, scheduled tasks and remote access. What it can't (boot settings, or what Windows refuses) shows up
    /// when the caller reads the sentinels again.
    public void PutBack(Reading before, Reading after, List<(string Sentinel, string Item)> differences, bool admin)
    {
        string[] order = ["administrators", "localUsers", "winrm", "services", "scheduledTasks"];
        // Nothing is removed on the word of a reading that missed some of what was there.
        var whole = differences.Where(d => !d.Item.StartsWith("HK", StringComparison.Ordinal) && !before[d.Sentinel].ContainsKey(Unread) && !after[d.Sentinel].ContainsKey(Unread));
        foreach (var (sentinel, item) in whole.OrderBy(d => Array.IndexOf(order, d.Sentinel)))
        {
            try { PutBackOther(sentinel, item, before, after, admin && Native.IsAdmin()); }
            catch (Exception e) when (e is InvalidOperationException or IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or System.ServiceProcess.TimeoutException or ArgumentException or FormatException) { }
        }
        T Do<T>(string path, Func<T> act) => path.StartsWith(@"HKLM\", StringComparison.Ordinal) && admin && Native.IsAdmin() ? act() : person.Do(act);
        // Keys that weren't there before go again once the values put back leave them empty, deepest first.
        var made = Changed(before, after).Where(d => KeyOnly(d.Item) && !before[d.Sentinel].ContainsKey(d.Item) && after[d.Sentinel].ContainsKey(d.Item)).ToList();
        differences = [.. differences, .. made];
        foreach (var (sentinel, item) in differences.OrderBy(d => KeyOnly(d.Item)).ThenByDescending(d => d.Item.Length))
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
                        if (was) { Open(path, writable: true)?.Dispose(); return 0; }
                        using (var k = Open(path)) if (k == null || k.ValueCount > 0 || k.SubKeyCount > 0) return 0;
                        int cut = path.LastIndexOf('\\');
                        using var parent = Open(path[..cut], writable: true);
                        parent?.DeleteSubKey(path[(cut + 1)..], throwOnMissingSubKey: false);
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

    /// Undoes one difference that isn't a registry value. Services, accounts and remote access need the helper's admin rights and a change
    /// approved with them; a scheduled task is put back with the helper's own rights, which reach at least the person's own tasks.
    void PutBackOther(string sentinel, string item, Reading before, Reading after, bool elevated)
    {
        bool was = before[sentinel].TryGetValue(item, out string? old), now = after[sentinel].ContainsKey(item);
        switch (sentinel)
        {
            case "scheduledTasks" when now:
                if (!was) Schtasks("/Delete", "/TN", item, "/F");
                else if (before.Tasks.TryGetValue(item, out byte[]? xml))
                {
                    string file = Path.Combine(work, CommandStore.NewId() + ".xml");
                    try
                    {
                        File.WriteAllBytes(file, xml);
                        Schtasks("/Create", "/TN", item, "/XML", file, "/F");
                    }
                    finally { File.Delete(file); }
                }
                break;
            case "services" when elevated:
                int tab = item.IndexOf(Sep);
                string name = item[..tab], part = item[(tab + 1)..];
                if (part == "program" && !was) ServiceControl.Delete(name);
                else if (part == "program") ServiceControl.Change(name, program: old);
                else if (part == "start" && was) ServiceControl.Change(name, start: uint.Parse(old!));
                else if (part == "dll") ServiceControl.Dll(name, was ? old : null);
                break;
            case "winrm" when elevated && !was && now:
                ServiceControl.Stop(item);
                break;
            case "localUsers" when elevated:
                if (!was) Accounts.Delete(item);
                else Accounts.Disable(item, old == "off");
                break;
            case "administrators" when elevated:
                Accounts.Administrator(item, was);
                break;
        }
    }

    static void Schtasks(params string[] args)
    {
        var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "schtasks.exe")) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("schtasks didn't start");
        var o = p.StandardOutput.ReadToEndAsync();
        var e = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(30_000)) { try { p.Kill(); } catch { } throw new InvalidOperationException("schtasks took too long"); }
        if (p.ExitCode != 0) throw new InvalidOperationException($"schtasks {p.ExitCode}: {e.Result.Trim()}");
    }
}

/// Services as the never list puts them back: removed when a change added one, and how one starts or what it runs as it was.
static class ServiceControl
{
    public static void Stop(string name)
    {
        using var sc = new ServiceController(name);
        if (sc.Status is ServiceControllerStatus.Stopped or ServiceControllerStatus.StopPending) return;
        sc.Stop();
        sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
    }

    public static void Delete(string name)
    {
        try { Stop(name); } catch (Exception e) when (e is InvalidOperationException or System.ServiceProcess.TimeoutException) { }
        With(name, DELETE, svc => DeleteService(svc));
    }

    public static void Change(string name, uint start = SERVICE_NO_CHANGE, string? program = null) =>
        With(name, SERVICE_CHANGE_CONFIG, svc => ChangeServiceConfigW(svc, SERVICE_NO_CHANGE, start, SERVICE_NO_CHANGE, program, null, IntPtr.Zero, null, null, null, null));

    /// Puts a service's own program file back, or removes it when the change added it.
    public static void Dll(string name, string? dll)
    {
        using var p = Registry.LocalMachine.CreateSubKey($@"SYSTEM\CurrentControlSet\Services\{name}\Parameters", writable: true);
        if (dll == null) p.DeleteValue("ServiceDll", throwOnMissingValue: false);
        else p.SetValue("ServiceDll", dll, RegistryValueKind.ExpandString);
    }

    static void With(string name, uint access, Func<IntPtr, bool> act)
    {
        if (name.IndexOfAny(['\\', '/']) >= 0) throw new ArgumentException("that isn't a service's name");
        IntPtr scm = OpenSCManagerW(null, null, SC_MANAGER_CONNECT), svc = IntPtr.Zero;
        try
        {
            if (scm != IntPtr.Zero) svc = OpenServiceW(scm, name, access);
            if (svc == IntPtr.Zero || !act(svc)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            if (svc != IntPtr.Zero) CloseServiceHandle(svc);
            if (scm != IntPtr.Zero) CloseServiceHandle(scm);
        }
    }

    const uint SC_MANAGER_CONNECT = 0x1, SERVICE_CHANGE_CONFIG = 0x2, DELETE = 0x00010000, SERVICE_NO_CHANGE = 0xFFFFFFFF;
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenSCManagerW(string? machine, string? database, uint access);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenServiceW(IntPtr scm, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ChangeServiceConfigW(IntPtr svc, uint type, uint start, uint error, string? path, string? group, IntPtr tag, string? deps, string? user, string? password, string? display);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DeleteService(IntPtr svc);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CloseServiceHandle(IntPtr h);
}


/// A file the helper reads or writes with its own admin rights. It goes ahead only where every folder on the way is an
/// ordinary folder owned by admins, the system or Windows' installer, and it opens the file itself without following a
/// link, refusing one that is a link, has a second name or isn't the file the path names.
static class AdminFile
{
    static readonly HashSet<string> Owners = OwnerSids();

    static HashSet<string> OwnerSids()
    {
        var set = new HashSet<string> { new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null).Value, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null).Value };
        try { set.Add(((SecurityIdentifier)new NTAccount("NT SERVICE", "TrustedInstaller").Translate(typeof(SecurityIdentifier))).Value); } catch (IdentityNotMappedException) { }
        return set;
    }

    static bool OwnedByAdmins(FileSystemInfo item) =>
        (item is DirectoryInfo d ? d.GetAccessControl(AccessControlSections.Owner).GetOwner(typeof(SecurityIdentifier)) : ((FileInfo)item).GetAccessControl(AccessControlSections.Owner).GetOwner(typeof(SecurityIdentifier))) is SecurityIdentifier o
        && Owners.Contains(o.Value);

    /// Whether only admins could have put what is at this path there.
    public static bool Trusted(string path)
    {
        try
        {
            string full = Path.GetFullPath(path);
            if (full.StartsWith(@"\\", StringComparison.Ordinal)) return false;
            for (var dir = new DirectoryInfo(Path.GetDirectoryName(full)!); dir != null; dir = dir.Parent)
            {
                if (!dir.Exists) continue;
                if (dir.Attributes.HasFlag(FileAttributes.ReparsePoint) || !OwnedByAdmins(dir)) return false;
            }
            var leaf = new FileInfo(full);
            return !leaf.Exists || (!leaf.Attributes.HasFlag(FileAttributes.ReparsePoint) && OwnedByAdmins(leaf));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException or InvalidOperationException) { return false; }
    }

    /// Whether only admins could have put anything in this folder: it, the folders above it and everything in it.
    public static bool TrustedTree(string dir)
    {
        try
        {
            var root = new DirectoryInfo(Path.GetFullPath(dir));
            if (root.FullName.StartsWith(@"\\", StringComparison.Ordinal) || !root.Exists) return false;
            for (var d = root; d != null; d = d.Parent)
                if (d.Attributes.HasFlag(FileAttributes.ReparsePoint) || !OwnedByAdmins(d)) return false;
            var walk = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = 0, IgnoreInaccessible = false };
            return root.EnumerateFileSystemInfos("*", walk).All(i => !i.Attributes.HasFlag(FileAttributes.ReparsePoint) && OwnedByAdmins(i));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.SecurityException or InvalidOperationException) { return false; }
    }

    /// Opens the file named, never one a link leads to. Null when there is nothing there and `create` is false.
    static SafeFileHandle? Open(string path, uint access, bool create)
    {
        string full = Path.GetFullPath(path);
        var h = CreateFileW(full, access, FILE_SHARE_READ, IntPtr.Zero, create ? OPEN_ALWAYS : OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
        if (h.IsInvalid)
        {
            int rc = Marshal.GetLastWin32Error();
            h.Dispose();
            if (!create && rc is ERROR_FILE_NOT_FOUND or ERROR_PATH_NOT_FOUND) return null;
            throw new RigException($"Windows wouldn't open it (error {rc})");
        }
        try
        {
            if (!GetFileInformationByHandle(h, out var info)) throw new RigException($"Windows wouldn't say what it is (error {Marshal.GetLastWin32Error()})");
            if ((info.Attributes & (uint)FileAttributes.ReparsePoint) != 0) throw new RigException("it is a link to somewhere else, which Rig doesn't follow with admin rights");
            if ((info.Attributes & (uint)FileAttributes.Directory) != 0) throw new RigException("it is a folder, and Rig snapshots single files");
            if (info.Links > 1) throw new RigException("it has more than one name, so it may be another file too");
            var name = new StringBuilder(1024);
            int len = GetFinalPathNameByHandleW(h, name, name.Capacity, 0);
            string final = len > 0 && len < name.Capacity ? name.ToString() : "";
            if (final.StartsWith(@"\\?\", StringComparison.Ordinal)) final = final[4..];
            if (!string.Equals(final, full, StringComparison.OrdinalIgnoreCase)) throw new RigException("it isn't where its path says, so it may be a link");
            return h;
        }
        catch
        {
            h.Dispose();
            throw;
        }
    }

    public static byte[]? Read(string path, long max)
    {
        using var h = Open(path, GENERIC_READ, create: false);
        if (h == null) return null;
        using var f = new FileStream(h, FileAccess.Read);
        if (f.Length > max) throw new RigException($"it is over {max >> 20} MB");
        var bytes = new byte[f.Length];
        f.ReadExactly(bytes);
        return bytes;
    }

    /// Writes the file as given, or removes it for null.
    public static void Write(string path, byte[]? bytes)
    {
        if (bytes == null)
        {
            using var gone = Open(path, DELETE, create: false);
            if (gone == null) return;
            var info = new FILE_DISPOSITION_INFO { DeleteFile = true };
            if (!SetFileInformationByHandle(gone, FileDispositionInfo, ref info, Marshal.SizeOf<FILE_DISPOSITION_INFO>())) throw new RigException($"Windows wouldn't remove it (error {Marshal.GetLastWin32Error()})");
            return;
        }
        using var h = Open(path, GENERIC_READ | GENERIC_WRITE, create: true)!;
        using var f = new FileStream(h, FileAccess.ReadWrite);
        f.SetLength(0);
        f.Write(bytes);
    }

    const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000, DELETE = 0x00010000, FILE_SHARE_READ = 1, OPEN_EXISTING = 3, OPEN_ALWAYS = 4, FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    const int ERROR_FILE_NOT_FOUND = 2, ERROR_PATH_NOT_FOUND = 3, FileDispositionInfo = 4;

    [StructLayout(LayoutKind.Sequential)]
    struct BY_HANDLE_FILE_INFORMATION
    {
        public uint Attributes;
        public uint CreatedLow, CreatedHigh, AccessedLow, AccessedHigh, WrittenLow, WrittenHigh;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [StructLayout(LayoutKind.Sequential)] struct FILE_DISPOSITION_INFO { [MarshalAs(UnmanagedType.U1)] public bool DeleteFile; }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out BY_HANDLE_FILE_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern int GetFinalPathNameByHandleW(SafeFileHandle h, StringBuilder name, int size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetFileInformationByHandle(SafeFileHandle h, int kind, ref FILE_DISPOSITION_INFO info, int size);
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

    static string AdministratorsGroup()
    {
        string group = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null).Translate(typeof(NTAccount)).Value;
        return group[(group.IndexOf('\\') + 1)..];
    }

    public static List<string> Administrators()
    {
        string group = AdministratorsGroup();
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

    public static void Delete(string name) => Check(NetUserDel(null, name), "NetUserDel");

    public static void Disable(string name, bool disabled)
    {
        Check(NetUserGetInfo(null, name, 1, out IntPtr buf), "NetUserGetInfo");
        int flags;
        try { flags = Marshal.PtrToStructure<USER_INFO_1>(buf).Flags; }
        finally { NetApiBufferFree(buf); }
        flags = disabled ? flags | UF_ACCOUNTDISABLE : flags & ~UF_ACCOUNTDISABLE;
        Check(NetUserSetInfo(null, name, 1008, ref flags, out _), "NetUserSetInfo");
    }

    /// Makes the account with this sid an administrator again, or no longer one.
    public static void Administrator(string sid, bool member)
    {
        var bytes = new byte[SecurityIdentifier.MaxBinaryLength];
        var id = new SecurityIdentifier(sid);
        id.GetBinaryForm(bytes, 0);
        IntPtr psid = Marshal.AllocHGlobal(id.BinaryLength);
        try
        {
            Marshal.Copy(bytes, 0, psid, id.BinaryLength);
            int rc = member ? NetLocalGroupAddMembers(null, AdministratorsGroup(), 0, ref psid, 1) : NetLocalGroupDelMembers(null, AdministratorsGroup(), 0, ref psid, 1);
            if (rc != ERROR_MEMBER_IN_ALIAS && rc != ERROR_MEMBER_NOT_IN_ALIAS) Check(rc, member ? "NetLocalGroupAddMembers" : "NetLocalGroupDelMembers");
        }
        finally { Marshal.FreeHGlobal(psid); }
    }

    static void Check(int rc, string call)
    {
        if (rc != 0) throw new InvalidOperationException($"{call} {rc}");
    }

    const int FILTER_NORMAL_ACCOUNT = 2, ERROR_MORE_DATA = 234, UF_ACCOUNTDISABLE = 2, ERROR_MEMBER_NOT_IN_ALIAS = 1377, ERROR_MEMBER_IN_ALIAS = 1378;
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserDel(string? server, string name);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserGetInfo(string? server, string name, int level, out IntPtr buf);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserSetInfo(string? server, string name, int level, ref int info, out int error);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetLocalGroupAddMembers(string? server, string group, int level, ref IntPtr members, int count);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetLocalGroupDelMembers(string? server, string group, int level, ref IntPtr members, int count);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct USER_INFO_1
    {
        public string Name; public IntPtr Password; public int PasswordAge, Priv; public IntPtr HomeDir, Comment; public int Flags; public IntPtr ScriptPath;
    }

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserEnum(string? server, int level, int filter, out IntPtr buf, int maxLen, out int read, out int total, ref int resume);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetLocalGroupGetMembers(string? server, string group, int level, out IntPtr buf, int maxLen, out int read, out int total, ref IntPtr resume);
    [DllImport("netapi32.dll")] static extern int NetApiBufferFree(IntPtr buf);
}
