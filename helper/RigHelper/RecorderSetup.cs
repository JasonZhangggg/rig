// Installs and removes Rig's background recorder service. The installer runs
// "RigHelper.exe --install-recorder --app-dir <Rig's folder>" through the
// Windows prompt after it copies Rig, and "--uninstall-recorder --app-dir
// <Rig's folder>" before it removes Rig. Settings in the app runs the same
// two commands to turn the recorder on and off.
//
// Rig installs for one Windows user, in a folder that user can change. A
// service runs as the system, so it must never start a program from there:
// the recorder runs its own copy in Program Files, where only admins can
// write, and keeps its log in ProgramData, where everyone can read it but only
// admins and the system can write.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public static class RecorderSetup
{
    /// Exit codes the app and the installer can tell apart. StillOff: removed, but a protection Rig turned off for a
    /// while didn't come back on.
    public const int Ok = 0, NotAdmin = 6, Failed = 7, StillOff = 8;

    public static int Install(string? appDir)
    {
        if (!Native.IsAdmin()) return NotAdmin;
        try
        {
            string data = RecorderPaths.Data, program = RecorderPaths.Program;
            Log(data, $"install from {Environment.ProcessPath} for {appDir ?? "(no app folder)"}");
            StopService(TimeSpan.FromSeconds(20));

            Directory.CreateDirectory(program);
            string exe = Path.Combine(program, RecorderPaths.ExeName);
            string self = Environment.ProcessPath ?? throw new InvalidOperationException("Can't tell where RigHelper is.");
            if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(exe), StringComparison.OrdinalIgnoreCase))
                Retry(() => File.Copy(self, exe, overwrite: true));

            SecureDataFolder(data);
            if (appDir != null) SetInstallDirs(data, InstallDirs(data).Append(Path.GetFullPath(appDir)));

            Scm.CreateOrUpdate(RecorderPaths.ServiceName, RecorderPaths.SelfTest ? "Rig self-test recorder" : "Rig background recorder", $"\"{exe}\" {RecorderPaths.ServiceArgs}",
                "Keeps a log of temperatures, load, crashes and power events for Rig, even while the Rig app is closed. It also turns back on a Windows protection that Rig turned off for a while. It makes no other change.");
            using var sc = new ServiceController(RecorderPaths.ServiceName);
            if (sc.Status != ServiceControllerStatus.Running)
            {
                sc.Start();
                sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            }
            Log(data, "installed and running");
            return Ok;
        }
        catch (Exception e)
        {
            Log(RecorderPaths.Data, $"install failed: {e}");
            return Failed;
        }
    }

    /// With appDir, only that Rig install lets go of the recorder; it stays while another user's Rig still has it.
    /// Without, the recorder and its log are removed outright (turning it off in Settings).
    public static int Uninstall(string? appDir)
    {
        if (!Native.IsAdmin()) return NotAdmin;
        string data = RecorderPaths.Data;
        try
        {
            if (appDir != null)
            {
                string me = Path.GetFullPath(appDir);
                var others = InstallDirs(data).Where(d => !string.Equals(d, me, StringComparison.OrdinalIgnoreCase)).ToList();
                if (others.Any(d => File.Exists(Path.Combine(d, "Rig.exe"))))
                {
                    SetInstallDirs(data, others);
                    Log(data, $"{me} let go; kept for {string.Join(", ", others)}");
                    return Ok;
                }
            }
            StopService(TimeSpan.FromSeconds(20));
            bool stillOff = RaiseProtections("uninstall");
            Scm.Delete(RecorderPaths.ServiceName);
            WaitGone(TimeSpan.FromSeconds(20));
            DeleteFolder(RecorderPaths.Program);
            DeleteFolder(data);
            DeleteIfEmpty(Path.GetDirectoryName(RecorderPaths.Program));
            DeleteIfEmpty(Path.GetDirectoryName(data));
            return stillOff ? StillOff : Ok;
        }
        catch (Exception e)
        {
            Log(data, $"uninstall failed: {e}");
            return Failed;
        }
    }

    /// Called by the running service when every Rig install it knew of is gone.
    public static void RemoveSelf()
    {
        RaiseProtections("uninstall");
        try { Scm.Delete(RecorderPaths.ServiceName); } catch { }
        try { DeleteFolder(RecorderPaths.Data); } catch { }
        // Its own program can't be deleted while it runs: a hidden command does it a few seconds after the service stops.
        try
        {
            string dir = RecorderPaths.Program;
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c ping 127.0.0.1 -n 8 > nul & rmdir /s /q \"{dir}\"")
            { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        }
        catch { }
    }

    /// Nothing is left to turn a protection back on once the service is gone, so every one Rig turned off for a while
    /// is turned on first, and only then is the ledger removed. The service does the same as it stops; this covers one
    /// that was killed or never ran. One that won't come back on is said in Windows' own event log, which outlives
    /// Rig's folders, and the answer is true.
    static bool RaiseProtections(string why)
    {
        List<string> stuck;
        try
        {
            if (!Directory.Exists(RecorderPaths.Reverts)) return false;
            var ledger = Ledger.Open();
            stuck = ledger.RaiseAll(Protections.Finder(RecorderPaths.SelfTest), why);
            ledger.Drop();
        }
        catch (Exception e) { stuck = [e.Message]; }
        if (stuck.Count == 0) return false;
        string line = $"{StillOffWords} {string.Join("; ", stuck)}";
        Log(RecorderPaths.Data, line);
        try { EventLog.WriteEntry(RecorderPaths.ServiceName, line, EventLogEntryType.Warning); } catch { }
        return true;
    }

    public const string StillOffWords = "Rig removed its background service, but couldn't turn these protections back on. Turn them on in Windows Security:";

    /// Rig installs other than appDir that are still on this PC.
    public static IEnumerable<string> OtherInstalls(string? appDir)
    {
        string? me = appDir == null ? null : Path.GetFullPath(appDir);
        return InstallDirs(RecorderPaths.Data).Where(d => !string.Equals(d, me, StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(d, "Rig.exe")));
    }

    public static void SetupLog(string line) => Log(RecorderPaths.Data, line);

    public static bool IsInstalled()
    {
        try { using var sc = new ServiceController(RecorderPaths.ServiceName); _ = sc.Status; return true; }
        catch (InvalidOperationException) { return false; }
    }

    // ----- The list of Rig installs (config.json) -----

    public static List<string> InstallDirs(string data)
    {
        try
        {
            var arr = JsonNode.Parse(File.ReadAllText(RecorderPaths.Config(data)))?["installDirs"] as JsonArray;
            return arr?.Select(n => n?.GetValue<string>()).OfType<string>().ToList() ?? [];
        }
        catch { return []; }
    }

    static void SetInstallDirs(string data, IEnumerable<string> dirs)
    {
        var arr = new JsonArray();
        foreach (var d in dirs.Distinct(StringComparer.OrdinalIgnoreCase)) arr.Add(d);
        File.WriteAllText(RecorderPaths.Config(data), new JsonObject { ["installDirs"] = arr }.ToJsonString());
    }

    // ----- Files -----

    /// ProgramData\Rig\Recorder: the system and admins may change it, everyone else may only read.
    static void SecureDataFolder(string data)
    {
        // ProgramData lets anyone make folders. One made before Rig, or a link pointing somewhere else, is replaced,
        // so the system never writes or deletes where someone else chose.
        foreach (var d in new[] { Path.GetDirectoryName(data)!, data })
            if (Directory.Exists(d) && File.GetAttributes(d).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(d);
        if (Directory.Exists(data) && !OwnedByAdmins(data)) Directory.Delete(data, recursive: true);
        var dir = Directory.CreateDirectory(data);
        var sec = new DirectorySecurity();
        sec.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        const InheritanceFlags all = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
        sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
        sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, all, PropagationFlags.None, AccessControlType.Allow));
        dir.SetAccessControl(sec);
    }

    static bool OwnedByAdmins(string dir)
    {
        var owner = new DirectoryInfo(dir).GetAccessControl().GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
        return owner != null && (owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid) || owner.IsWellKnown(WellKnownSidType.LocalSystemSid));
    }

    static void DeleteFolder(string dir)
    {
        if (!Directory.Exists(dir)) return;
        Retry(() => Directory.Delete(dir, recursive: true));
    }

    static void DeleteIfEmpty(string? dir)
    {
        try { if (dir != null && Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir); } catch { }
    }

    static void Retry(Action act)
    {
        for (int i = 0; ; i++)
        {
            try { act(); return; }
            catch (IOException) when (i < 10) { Thread.Sleep(500); }
            catch (UnauthorizedAccessException) when (i < 10) { Thread.Sleep(500); }
        }
    }

    /// setup.log next to the recorder's log, so a failed install can be looked into.
    static void Log(string data, string line)
    {
        try
        {
            Directory.CreateDirectory(data);
            string path = Path.Combine(data, "setup.log");
            if (File.Exists(path) && new FileInfo(path).Length > 256 * 1024) File.Delete(path);
            File.AppendAllText(path, $"{DateTimeOffset.Now:u} {line}{Environment.NewLine}");
        }
        catch { }
    }

    // ----- The service -----

    static void StopService(TimeSpan wait)
    {
        try
        {
            using var sc = new ServiceController(RecorderPaths.ServiceName);
            if (sc.Status is ServiceControllerStatus.Stopped) return;
            if (sc.Status is not ServiceControllerStatus.StopPending) sc.Stop();
            sc.WaitForStatus(ServiceControllerStatus.Stopped, wait);
        }
        catch (InvalidOperationException) { /* not installed */ }
        catch (System.ServiceProcess.TimeoutException) { KillStrays(); }
    }

    /// A recorder that won't stop in time: end it, so its program file can be replaced or removed.
    static void KillStrays()
    {
        foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(RecorderPaths.ExeName)))
            using (p) { try { p.Kill(); p.WaitForExit(5000); } catch { } }
    }

    static void WaitGone(TimeSpan wait)
    {
        var until = DateTime.UtcNow + wait;
        while (IsInstalled() && DateTime.UtcNow < until) Thread.Sleep(250);
        if (IsInstalled()) KillStrays();
    }

    /// Creating, changing and deleting the service through the Service Control Manager.
    static class Scm
    {
        const uint SC_MANAGER_ALL_ACCESS = 0xF003F, SERVICE_ALL_ACCESS = 0xF01FF, SERVICE_NO_CHANGE = 0xFFFFFFFF;
        const uint SERVICE_WIN32_OWN_PROCESS = 0x10, SERVICE_AUTO_START = 2, SERVICE_ERROR_NORMAL = 1;
        const uint CONFIG_DESCRIPTION = 1, CONFIG_FAILURE_ACTIONS = 2, CONFIG_DELAYED_AUTO_START = 3;
        const int ERROR_SERVICE_DOES_NOT_EXIST = 1060, ERROR_SERVICE_MARKED_FOR_DELETE = 1072;

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenSCManagerW(string? machine, string? database, uint access);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenServiceW(IntPtr scm, string name, uint access);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr CreateServiceW(IntPtr scm, string name, string display, uint access, uint type, uint start, uint error, string path, string? group, IntPtr tag, string? deps, string? user, string? password);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool ChangeServiceConfigW(IntPtr svc, uint type, uint start, uint error, string? path, string? group, IntPtr tag, string? deps, string? user, string? password, string? display);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ChangeServiceConfig2W(IntPtr svc, uint level, IntPtr info);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool DeleteService(IntPtr svc);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool CloseServiceHandle(IntPtr h);

        [StructLayout(LayoutKind.Sequential)] struct SC_ACTION { public int Type; public int Delay; }
        [StructLayout(LayoutKind.Sequential)] struct FAILURE_ACTIONS { public int ResetPeriod; public IntPtr RebootMsg; public IntPtr Command; public int Count; public IntPtr Actions; }

        static IntPtr Manager()
        {
            var h = OpenSCManagerW(null, null, SC_MANAGER_ALL_ACCESS);
            return h != IntPtr.Zero ? h : throw new InvalidOperationException($"Couldn't open the service manager (error {Marshal.GetLastWin32Error()}).");
        }

        public static void CreateOrUpdate(string name, string display, string path, string description)
        {
            var scm = Manager();
            try
            {
                var svc = OpenServiceW(scm, name, SERVICE_ALL_ACCESS);
                if (svc == IntPtr.Zero)
                {
                    // A service deleted a moment ago can linger until its last handle closes; wait it out.
                    for (int i = 0; i < 40 && svc == IntPtr.Zero; i++)
                    {
                        svc = CreateServiceW(scm, name, display, SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, path, null, IntPtr.Zero, null, null, null);
                        if (svc == IntPtr.Zero && Marshal.GetLastWin32Error() == ERROR_SERVICE_MARKED_FOR_DELETE) Thread.Sleep(250); else break;
                    }
                    if (svc == IntPtr.Zero) throw new InvalidOperationException($"Couldn't create the service (error {Marshal.GetLastWin32Error()}).");
                }
                else if (!ChangeServiceConfigW(svc, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, path, null, IntPtr.Zero, null, null, null, display))
                    throw new InvalidOperationException($"Couldn't update the service (error {Marshal.GetLastWin32Error()}).");
                try { Configure(svc, description); } finally { CloseServiceHandle(svc); }
            }
            finally { CloseServiceHandle(scm); }
        }

        /// Its description, a delayed start so it doesn't slow down booting, and a restart a minute after it fails.
        static void Configure(IntPtr svc, string description)
        {
            var text = Marshal.StringToHGlobalUni(description);
            var desc = Marshal.AllocHGlobal(IntPtr.Size);
            var delayed = Marshal.AllocHGlobal(4);
            var actions = Marshal.AllocHGlobal(Marshal.SizeOf<SC_ACTION>() * 3);
            var failure = Marshal.AllocHGlobal(Marshal.SizeOf<FAILURE_ACTIONS>());
            try
            {
                Marshal.WriteIntPtr(desc, text);
                ChangeServiceConfig2W(svc, CONFIG_DESCRIPTION, desc);
                Marshal.WriteInt32(delayed, 1);
                ChangeServiceConfig2W(svc, CONFIG_DELAYED_AUTO_START, delayed);
                for (int i = 0; i < 3; i++) Marshal.StructureToPtr(new SC_ACTION { Type = 1, Delay = 60_000 }, actions + i * Marshal.SizeOf<SC_ACTION>(), false);
                Marshal.StructureToPtr(new FAILURE_ACTIONS { ResetPeriod = 86_400, Count = 3, Actions = actions }, failure, false);
                ChangeServiceConfig2W(svc, CONFIG_FAILURE_ACTIONS, failure);
            }
            finally
            {
                Marshal.FreeHGlobal(text); Marshal.FreeHGlobal(desc); Marshal.FreeHGlobal(delayed); Marshal.FreeHGlobal(actions); Marshal.FreeHGlobal(failure);
            }
        }

        public static void Delete(string name)
        {
            var scm = Manager();
            try
            {
                var svc = OpenServiceW(scm, name, SERVICE_ALL_ACCESS);
                if (svc == IntPtr.Zero)
                {
                    if (Marshal.GetLastWin32Error() == ERROR_SERVICE_DOES_NOT_EXIST) return;
                    throw new InvalidOperationException($"Couldn't open the service (error {Marshal.GetLastWin32Error()}).");
                }
                try
                {
                    if (!DeleteService(svc) && Marshal.GetLastWin32Error() != ERROR_SERVICE_MARKED_FOR_DELETE)
                        throw new InvalidOperationException($"Couldn't delete the service (error {Marshal.GetLastWin32Error()}).");
                }
                finally { CloseServiceHandle(svc); }
            }
            finally { CloseServiceHandle(scm); }
        }
    }
}

static partial class Native
{
    [StructLayout(LayoutKind.Sequential)]
    public struct SYSTEM_POWER_STATUS { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int BatteryLifeTime, BatteryFullLifeTime; }
    [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);

    public const int ProcessPowerThrottling = 4;
    [StructLayout(LayoutKind.Sequential)] public struct PROCESS_POWER_THROTTLING_STATE { public uint Version, ControlMask, StateMask; }
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetProcessInformation(IntPtr process, int infoClass, ref PROCESS_POWER_THROTTLING_STATE info, int size);
}
