// The never list, enforced after the fact: fixed places the helper reads before
// and after every run (the Sentinel union in packages/core/src/change.ts). A
// difference the command didn't declare is a never-list write. Whatever a
// script hid from the parser, it can't hide what it left behind here; the run
// is rolled back and the hit is reported with what was put back and what wasn't.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public sealed class Sentinels
{
    public sealed record Hit(string Sentinel, string Before, string After)
    {
        public JsonObject ToJson() => new() { ["sentinel"] = Sentinel, ["before"] = Before, ["after"] = After };
    }

    /// Registry places by sentinel. With value names, only those values are read: Winlogon also holds things Rig never reads.
    static readonly (string Sentinel, string Key, string[]? Values)[] Places =
    [
        ("run", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run", null),
        ("run", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce", null),
        ("run", @"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", null),
        ("run", @"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce", null),
        ("run", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run", null),
        ("run", @"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", null),
        ("run", @"HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce", null),
        ("run", @"HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run", null),
        ("ifeo", @"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options", null),
        ("ifeo", @"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows NT\CurrentVersion\Image File Execution Options", null),
        ("ifeo", @"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SilentProcessExit", null),
        ("winlogon", @"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon", ["Shell", "Userinit", "Taskman", "AppSetup", "GinaDLL", "VmApplet"]),
        ("winlogon", @"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Notify", null),
        ("winlogon", @"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon", ["Shell"]),
        ("defenderExclusions", @"HKLM\SOFTWARE\Microsoft\Windows Defender\Exclusions", null),
        ("defenderExclusions", @"HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\Exclusions", null),
        ("rdp", @"HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server", ["fDenyTSConnections"]),
        ("rdp", @"HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services", ["fDenyTSConnections"]),
        ("winrm", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Listener", null),
        ("rootCertificates", @"HKLM\SOFTWARE\Microsoft\SystemCertificates\ROOT\Certificates", null),
        ("rootCertificates", @"HKLM\SOFTWARE\Policies\Microsoft\SystemCertificates\Root\Certificates", null),
        ("rootCertificates", @"HKLM\SOFTWARE\Microsoft\EnterpriseCertificates\Root\Certificates", null),
        ("rootCertificates", @"HKCU\Software\Microsoft\SystemCertificates\Root\Certificates", null),
        ("proxy", @"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings", ["ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL"]),
        ("proxy", @"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections", ["DefaultConnectionSettings"]),
        ("proxy", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings", ["ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL"]),
        ("proxy", @"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\Connections", ["WinHttpSettings"]),
        ("proxy", @"HKLM\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\Internet Settings", ["ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL"]),
        ("bcd", @"HKLM\BCD00000000", null),
    ];
    static readonly string[] RemoteServices = ["WinRM", "sshd"];
    const string ServicesKey = @"SYSTEM\CurrentControlSet\Services", TasksKey = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tree";
    static readonly string HostsFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"drivers\etc\hosts");
    const string Unreadable = "Rig couldn't read this";

    readonly Dictionary<string, SortedDictionary<string, string>> items = [];
    readonly List<(string Sentinel, JsonObject Touch, JsonObject State)> registry = [];
    readonly Dictionary<string, List<Reg.Value>> services = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, JsonObject> remote = [];
    byte[]? hosts;

    SortedDictionary<string, string> Of(string sentinel) => items.TryGetValue(sentinel, out var d) ? d : items[sentinel] = new(StringComparer.OrdinalIgnoreCase);

    public static Sentinels Read(Person person)
    {
        var s = new Sentinels();
        var ctx = new SnapshotContext(person, Admin: true);
        foreach (var (sentinel, key, values) in Places)
            foreach (string? value in values ?? [null])
            {
                var touch = new JsonObject { ["kind"] = "registry", ["key"] = key };
                if (value != null) touch["value"] = value;
                var into = s.Of(sentinel);
                try
                {
                    var state = Snapshot.Read(touch, ctx);
                    s.registry.Add((sentinel, touch, state));
                    if (value != null) { if (Snapshot.Show(state) is string shown) into[$@"{key}\\{value}"] = shown; }
                    else if (state["key"] is JsonNode k) Reg.Flatten(Reg.KeyOf(k), key, into);
                }
                catch (RigException) { into[key] = Unreadable; }
            }

        var list = s.Of("services");
        List<string> names = [];
        try { names = Reg.SubKeys(Reg.Machine, ServicesKey); } catch (RigException) { list[ServicesKey] = Unreadable; }
        foreach (string name in names)
        {
            string path = $@"{ServicesKey}\{name}";
            try
            {
                if (Reg.ReadValue(Reg.Machine, path, "Type") is not Reg.Value type) continue;
                var kept = new List<Reg.Value> { type };
                if (Reg.ReadValue(Reg.Machine, path, "Start") is Reg.Value start) kept.Add(start);
                if (Reg.ReadValue(Reg.Machine, path, "ImagePath") is Reg.Value image) kept.Add(image);
                s.services[name] = kept;
                list[name] = string.Join("; ", kept.Select(v => $"{v.Name} {Reg.Show(v)}"));
            }
            catch (RigException) { list[name] = Unreadable; }
        }

        foreach (string name in RemoteServices)
        {
            var state = Snapshot.Read(new JsonObject { ["kind"] = "service", ["name"] = name }, ctx);
            s.remote[name] = state;
            if (Snapshot.Show(state) is string shown) s.Of("winrm")[$"the {name} service"] = shown;
        }

        var tasks = s.Of("scheduledTasks");
        try
        {
            if (Reg.ReadKey(Reg.Machine, TasksKey, new Reg.Budget(60_000, 64L << 20)) is Reg.Key tree) Tasks(tree, "", tasks);
        }
        catch (RigException) { tasks[TasksKey] = Unreadable; }

        try { foreach (var (name, disabled) in Accounts.Users()) s.Of("localUsers")[name] = disabled ? "turned off" : "turned on"; }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception) { s.Of("localUsers")["accounts"] = Unreadable; }
        try { foreach (string sid in Accounts.Administrators()) s.Of("administrators")[sid] = "administrator"; }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IdentityNotMappedException) { s.Of("administrators")["members"] = Unreadable; }

        try { s.hosts = File.Exists(HostsFile) ? File.ReadAllBytes(HostsFile) : null; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { s.Of("hosts")[HostsFile] = Unreadable; }
        if (s.hosts != null) s.Of("hosts")[HostsFile] = $"{s.hosts.Length} bytes, sha256 {Convert.ToHexString(SHA256.HashData(s.hosts))[..16]}";
        return s;
    }

    static void Tasks(Reg.Key key, string path, IDictionary<string, string> into)
    {
        if (key.Values.Any(v => v.Name.Equals("Id", StringComparison.OrdinalIgnoreCase))) into[path] = "a scheduled task";
        foreach (var (name, sub) in key.Keys) Tasks(sub, $@"{path}\{name}", into);
    }

    static readonly string[] Order = ["services", "run", "ifeo", "winlogon", "defenderExclusions", "localUsers", "administrators", "rdp", "winrm", "rootCertificates", "hosts", "proxy", "scheduledTasks", "bcd"];

    /// What differs between this read and a later one, leaving out what the command said it would change:
    /// the start type of a service it names, and the removal of a task it names. Nothing else on the list can be declared away.
    public List<Hit> Compare(Sentinels after, JsonArray touches)
    {
        var named = touches.Select(t => t!.AsObject()).ToList();
        var declaredServices = named.Where(t => t["kind"]!.GetValue<string>() == "service").Select(t => t["name"]!.GetValue<string>())
            .Concat(named.Where(t => t["kind"]!.GetValue<string>() == "registry").Select(t => t["key"]!.GetValue<string>())
                .Where(k => k.StartsWith($@"HKLM\{ServicesKey}\", StringComparison.OrdinalIgnoreCase)).Select(k => k[(ServicesKey.Length + 6)..].Split('\\')[0]))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var declaredTasks = named.Where(t => t["kind"]!.GetValue<string>() == "task").Select(t => t["name"]!.GetValue<string>().Trim('\\')).ToList();

        var hits = new List<Hit>();
        foreach (string sentinel in Order)
        {
            var (a, b) = (Of(sentinel), after.Of(sentinel));
            var changed = a.Keys.Union(b.Keys, StringComparer.OrdinalIgnoreCase).Where(k => a.GetValueOrDefault(k) != b.GetValueOrDefault(k)).ToList();
            if (sentinel == "services")
                changed.RemoveAll(k => declaredServices.Contains(k) && services.TryGetValue(k, out var was) && after.services.TryGetValue(k, out var now) && Same(was, now, "Type") && Same(was, now, "ImagePath"));
            if (sentinel == "scheduledTasks")
                changed.RemoveAll(k => !b.ContainsKey(k) && declaredTasks.Any(t => k.Trim('\\').Equals(t, StringComparison.OrdinalIgnoreCase) || k.EndsWith($@"\{t}", StringComparison.OrdinalIgnoreCase)));
            if (changed.Count == 0) continue;
            string Words(SortedDictionary<string, string> d) => Clip(string.Join("; ", changed.Order(StringComparer.OrdinalIgnoreCase).Select(k => $"{k}: {d.GetValueOrDefault(k) ?? "not there"}")));
            hits.Add(new Hit(sentinel, Words(a), Words(b)));
        }
        return hits;
    }

    static bool Same(List<Reg.Value> a, List<Reg.Value> b, string name)
    {
        Reg.Value? x = a.FirstOrDefault(v => v.Name == name), y = b.FirstOrDefault(v => v.Name == name);
        return x == null ? y == null : y != null && x.Type == y.Type && x.Data.AsSpan().SequenceEqual(y.Data);
    }

    static string Clip(string s) => s.Length <= 600 ? s : s[..600] + "...";

    /// Puts back what a later read shows changed, for the sentinels that were hit. Returns what it couldn't put back, in plain words.
    public List<string> Restore(Sentinels after, IEnumerable<Hit> hits, Person person)
    {
        var left = new List<string>();
        var hit = hits.Select(h => h.Sentinel).ToHashSet();
        var ctx = new SnapshotContext(person, Admin: true);
        void Try(string what, Action act)
        {
            try { act(); }
            catch (Exception e) when (e is RigException or IOException or UnauthorizedAccessException or InvalidOperationException or System.ComponentModel.Win32Exception) { left.Add($"{what}: {e.Message.TrimEnd('.')}"); }
        }

        foreach (var (sentinel, touch, state) in registry)
        {
            if (!hit.Contains(sentinel)) continue;
            if (sentinel == "bcd") continue;
            var now = after.registry.FirstOrDefault(r => JsonNode.DeepEquals(r.Touch, touch)).State;
            if (now != null && Snapshot.Hash(now) == Snapshot.Hash(state)) continue;
            left.AddRange(Snapshot.Restore(touch, state, ctx, _ => []));
        }
        if (hit.Contains("bcd")) left.Add("Windows' boot settings changed, and Rig doesn't write those; use the restore point or bcdedit to check them");

        if (hit.Contains("services"))
        {
            foreach (string name in after.services.Keys.Where(n => !services.ContainsKey(n))) Try($"removing the new service {name}", () => Services.Remove(name));
            foreach (var (name, was) in services)
            {
                if (!after.services.TryGetValue(name, out var now)) { left.Add($"the {name} service was removed, and Rig can't bring a service back"); continue; }
                if (Same(was, now, "Start") && Same(was, now, "ImagePath") && Same(was, now, "Type")) continue;
                if (!Same(was, now, "Type")) left.Add($"the {name} service changed its kind, and Rig doesn't change that back");
                uint start = was.FirstOrDefault(v => v.Name == "Start") is { Data.Length: 4 } s ? BitConverter.ToUInt32(s.Data) : Services.NoChange;
                string? image = was.FirstOrDefault(v => v.Name == "ImagePath") is Reg.Value i ? System.Text.Encoding.Unicode.GetString(i.Data).TrimEnd('\0') : null;
                Try($"the {name} service", () => Services.Configure(name, start, image));
            }
        }
        if (hit.Contains("winrm"))
            foreach (var (name, state) in remote)
                if (state["service"] != null) left.AddRange(Snapshot.Restore(new JsonObject { ["kind"] = "service", ["name"] = name }, state, ctx, _ => []));
        if (hit.Contains("scheduledTasks"))
        {
            foreach (string task in after.Of("scheduledTasks").Keys.Where(k => !Of("scheduledTasks").ContainsKey(k)))
                Try($"removing the new scheduled task {task}", () => DeleteTask(task));
            foreach (string task in Of("scheduledTasks").Keys.Where(k => !after.Of("scheduledTasks").ContainsKey(k))) left.Add($"the scheduled task {task} was removed, and Rig can't bring a task back");
        }
        if (hit.Contains("localUsers"))
            foreach (string user in after.Of("localUsers").Keys.Union(Of("localUsers").Keys))
            {
                bool was = Of("localUsers").ContainsKey(user), now = after.Of("localUsers").ContainsKey(user);
                if (!was && now) Try($"removing the new account {user}", () => Accounts.DeleteUser(user));
                else if (Of("localUsers").GetValueOrDefault(user) != after.Of("localUsers").GetValueOrDefault(user)) left.Add($"the account {user} changed ({Of("localUsers").GetValueOrDefault(user) ?? "not there"} before), and Rig doesn't change accounts");
            }
        if (hit.Contains("administrators"))
            foreach (string sid in after.Of("administrators").Keys.Union(Of("administrators").Keys))
            {
                bool was = Of("administrators").ContainsKey(sid), now = after.Of("administrators").ContainsKey(sid);
                if (was != now) Try(now ? $"taking {sid} out of the administrators" : $"putting {sid} back in the administrators", () => Accounts.SetAdministrator(sid, was));
            }
        if (hit.Contains("hosts"))
            Try("the hosts file", () => { if (hosts != null) File.WriteAllBytes(HostsFile, hosts); else File.Delete(HostsFile); });
        return left;
    }

    static void DeleteTask(string task)
    {
        var psi = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "schtasks.exe")) { UseShellExecute = false, CreateNoWindow = true };
        foreach (string a in new[] { "/delete", "/tn", task, "/f" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new RigException("Windows' task tool didn't start");
        if (!p.WaitForExit(30_000) || p.ExitCode != 0) throw new RigException("Windows' task tool didn't remove it");
    }
}

/// Local accounts and the administrators group, straight from Windows.
static class Accounts
{
    const int MoreData = 234, NormalAccounts = 2, Disabled = 2;

    public static List<(string Name, bool Disabled)> Users()
    {
        var users = new List<(string, bool)>();
        int resume = 0, rc;
        do
        {
            rc = NetUserEnum(null, 1, NormalAccounts, out IntPtr buf, -1, out int read, out _, ref resume);
            if (rc != 0 && rc != MoreData) throw new System.ComponentModel.Win32Exception(rc);
            try
            {
                int size = Marshal.SizeOf<USER_INFO_1>();
                for (int i = 0; i < read; i++)
                {
                    var u = Marshal.PtrToStructure<USER_INFO_1>(buf + i * size);
                    users.Add((u.name, (u.flags & Disabled) != 0));
                }
            }
            finally { NetApiBufferFree(buf); }
        } while (rc == MoreData);
        return users;
    }

    static string Group() => new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null).Translate(typeof(NTAccount)).Value.Split('\\')[^1];

    public static List<string> Administrators()
    {
        int rc = NetLocalGroupGetMembers(null, Group(), 0, out IntPtr buf, -1, out int read, out _, IntPtr.Zero);
        if (rc != 0) throw new System.ComponentModel.Win32Exception(rc);
        try
        {
            var sids = new List<string>();
            for (int i = 0; i < read; i++) sids.Add(new SecurityIdentifier(Marshal.ReadIntPtr(buf, i * IntPtr.Size)).Value);
            return sids;
        }
        finally { NetApiBufferFree(buf); }
    }

    public static void SetAdministrator(string sid, bool member)
    {
        var id = new SecurityIdentifier(sid);
        var bytes = new byte[id.BinaryLength];
        id.GetBinaryForm(bytes, 0);
        var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try
        {
            IntPtr entry = pin.AddrOfPinnedObject();
            int rc = member ? NetLocalGroupAddMembers(null, Group(), 0, ref entry, 1) : NetLocalGroupDelMembers(null, Group(), 0, ref entry, 1);
            if (rc != 0) throw new System.ComponentModel.Win32Exception(rc);
        }
        finally { pin.Free(); }
    }

    public static void DeleteUser(string name)
    {
        int rc = NetUserDel(null, name);
        if (rc != 0) throw new System.ComponentModel.Win32Exception(rc);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct USER_INFO_1 { public string name; public string? password; public int passwordAge, priv; public string? homeDir, comment; public int flags; public string? scriptPath; }

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserEnum(string? server, int level, int filter, out IntPtr buf, int maxLen, out int read, out int total, ref int resume);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetLocalGroupGetMembers(string? server, string group, int level, out IntPtr buf, int maxLen, out int read, out int total, IntPtr resume);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetLocalGroupAddMembers(string? server, string group, int level, ref IntPtr members, int count);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetLocalGroupDelMembers(string? server, string group, int level, ref IntPtr members, int count);
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)] static extern int NetUserDel(string? server, string user);
    [DllImport("netapi32.dll")] static extern int NetApiBufferFree(IntPtr buf);
}
