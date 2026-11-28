// Lets the Rig app start its helper with admin rights without Windows asking each time it opens.
//
// The installer already asks Windows once, to set up the background recorder. With that same prompt, the helper
// copies itself to Program Files, where only admins can write, and adds a Task Scheduler task for the person who
// installed Rig: "RigHelper-<their account's SID>", set to run with the highest rights that account has, with no
// trigger, so it starts only when asked. When Rig opens, the helper in Rig's folder (with no admin rights) asks Task
// Scheduler to run that task (--start-task), and the task starts the Program Files copy, which connects back to the
// app's pipe as before. If there's no task, or it doesn't match this Rig, the app falls back to Windows' prompt.
//
// What keeps it Rig's own:
// - Only admins and the system can change the task or its program; the person may only read and run it.
// - The task's command line is fixed except the pipe and the app's process id, so the helper started from it accepts
//   exactly that shape (ParseTaskArgs) and nothing else: no other mode (approving a step, installing) can be reached
//   through it.
// - It serves only the Rig.exe the installer named, running as the same account, through the pipe that process made.
// - Steps that need admin rights still go through Windows' prompt one by one (--approve-step); this changes only how
//   the helper itself starts.

using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Rig.Helper;

public static class HelperTask
{
    /// The first argument of the helper the task starts.
    public const string Flag = "--from-task";
    /// The app runs the helper in its own folder with this to start the task.
    public const string StartFlag = "--start-task";
    /// Exit codes for --start-task. The app falls back to Windows' prompt on anything but Started.
    public const int Started = 0, BadArgs = 2, NoTask = 20, Stale = 21;

    public const string Prefix = "RigHelper-";
    public static string TaskName(string sid) => Prefix + sid;
    /// %ProgramFiles%\Rig\Helper: the task's copy of the helper.
    public static string Folder => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Rig", "Helper");
    public static string Exe => Path.Combine(Folder, "RigHelper.exe");

    // The app names its pipe rig-helper- and 32 hex digits (apps/desktop/src-tauri/src/helper.rs).
    static readonly Regex PipeName = new(@"^\\\\\.\\pipe\\rig-helper-[0-9a-f]{32}$", RegexOptions.CultureInvariant);

    /// The arguments the task's helper accepts, and only these, in this order:
    /// --from-task --app-exe <Rig.exe> --pipe <pipe> --parent <process id>.
    public static (string AppExe, string Pipe, int Parent)? ParseTaskArgs(string[] args)
    {
        if (args.Length != 7 || args[0] != Flag || args[1] != "--app-exe" || args[3] != "--pipe" || args[5] != "--parent") return null;
        if (!Path.IsPathFullyQualified(args[2]) || !PipeName.IsMatch(args[4])) return null;
        return ParseParent(args[6]) is int parent ? (args[2], args[4], parent) : null;
    }

    static int? ParseParent(string? s) =>
        s != null && s.Length <= 10 && int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out int n) && n > 0 ? n : null;

    /// The task's action: the Program Files copy, with the app's path fixed and the pipe and process id filled in per run.
    public static string Arguments(string appExe) => $"{Flag} --app-exe \"{appExe}\" --pipe $(Arg0) --parent $(Arg1)";

    /// Whether the helper the task starts may serve the process behind the pipe: the Rig.exe the task names, as this account.
    public static bool Serves(string appExe, string? image, string? serverSid, string mySid) =>
        image != null && serverSid != null && SamePath(image, appExe) && string.Equals(serverSid, mySid, StringComparison.OrdinalIgnoreCase);

    static bool SamePath(string a, string b)
    {
        try { return string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase); }
        catch (Exception) { return false; }
    }

    /// --start-task --pipe <pipe> --parent <id>: run by the app, without admin rights, to start this account's task.
    public static int Start(string[] args)
    {
        string? pipe = Arg(args, "--pipe");
        if (pipe == null || !PipeName.IsMatch(pipe) || ParseParent(Arg(args, "--parent")) is not int parent) return BadArgs;
        string sid;
        try { sid = Person.Mine(); } catch (Exception) { return NoTask; }
        return StartTask(TaskName(sid), Exe, Environment.ProcessPath, pipe, parent);
    }

    /// Starts the task when its program is the same build as `self`. A copy left from another version (an update whose
    /// prompt was refused) could speak another protocol, so the app asks Windows instead.
    public static int StartTask(string name, string exe, string? self, string pipe, int parent)
    {
        if (!File.Exists(exe)) return NoTask;
        if (self == null || !SameBuild(self, exe)) return Stale;
        try
        {
            return WithTask<int?>(name, task =>
            {
                if (!Convert.ToBoolean(Get(task, "Enabled"))) return NoTask;
                // One argument: the array of values for $(Arg0) and $(Arg1).
                Call(task, "Run", new object?[] { new string[] { pipe, parent.ToString(CultureInfo.InvariantCulture) } });
                return Started;
            }) ?? NoTask;
        }
        catch (Exception) { return NoTask; }
    }

    /// The same build: the same version (with the commit it was built from) and the same size.
    public static bool SameBuild(string a, string b)
    {
        try
        {
            var (fa, fb) = (FileVersionInfo.GetVersionInfo(a), FileVersionInfo.GetVersionInfo(b));
            return fa.ProductVersion != null && fa.ProductVersion == fb.ProductVersion && fa.FileVersion == fb.FileVersion
                && new FileInfo(a).Length == new FileInfo(b).Length;
        }
        catch (Exception) { return false; }
    }

    /// Run by the installer behind its one prompt (--install-recorder --helper-task): copies this helper to Program Files and
    /// adds or updates the task for this account, pointing at the Rig.exe in `appDir`.
    public static int Install(string? appDir, Action<string> log)
    {
        if (!Native.IsAdmin()) return RecorderSetup.NotAdmin;
        if (appDir == null) return RecorderSetup.Failed;
        try
        {
            string sid = Person.Mine();
            string self = Environment.ProcessPath ?? throw new InvalidOperationException("Can't tell where RigHelper is.");
            CopyTo(self, Folder, Exe);
            string app = Path.Combine(Path.GetFullPath(appDir), "Rig.exe");
            Register(TaskName(sid), sid, Exe, app);
            log($"helper task set up for {sid}: {Exe} serves {app}");
            return RecorderSetup.Ok;
        }
        catch (Exception e)
        {
            log($"helper task setup failed: {e}");
            return RecorderSetup.Failed;
        }
    }

    /// Run by the uninstaller: removes this account's task, and the Program Files copy once no other Rig install is left.
    public static void Uninstall(bool lastInstall, Action<string> log)
    {
        if (!Native.IsAdmin()) return;
        try
        {
            string sid = Person.Mine();
            Delete(TaskName(sid));
            log($"helper task removed for {sid}");
        }
        catch (Exception e) { log($"removing the helper task failed: {e}"); }
        if (lastInstall) RemoveProgram(log);
    }

    /// When every Rig install is gone (the background service finds this): every account's task, then the program.
    public static void RemoveAll(Action<string> log)
    {
        try
        {
            foreach (string name in Names().Where(n => n.StartsWith(Prefix + "S-", StringComparison.OrdinalIgnoreCase))) Delete(name);
        }
        catch (Exception e) { log($"removing the helper tasks failed: {e}"); }
        RemoveProgram(log);
    }

    static void RemoveProgram(Action<string> log)
    {
        string dir = Folder;
        if (!Directory.Exists(dir)) return;
        try { Directory.Delete(dir, recursive: true); }
        catch (Exception)
        {
            // A helper the task started may still be closing: a hidden command removes the folder a few seconds later.
            try
            {
                Process.Start(new ProcessStartInfo("cmd.exe", $"/c ping 127.0.0.1 -n 8 > nul & rmdir /s /q \"{dir}\"")
                { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
            }
            catch (Exception e) { log($"removing {dir} failed: {e.Message}"); }
        }
        try
        {
            string? parent = Path.GetDirectoryName(dir);
            if (parent != null && Directory.Exists(parent) && !Directory.EnumerateFileSystemEntries(parent).Any()) Directory.Delete(parent);
        }
        catch (Exception) { }
    }

    /// Copies the helper into `folder`. A copy that's running (a helper still closing as Rig updates) can't be replaced but
    /// can be renamed, so it's moved aside and deleted next time.
    public static void CopyTo(string self, string folder, string exe)
    {
        Directory.CreateDirectory(folder);
        foreach (string old in Directory.EnumerateFiles(folder, "RigHelper-old-*.exe"))
            try { File.Delete(old); } catch (Exception) { }
        if (File.Exists(exe) && SamePath(self, exe)) return;
        string fresh = Path.Combine(folder, "RigHelper.new");
        File.Copy(self, fresh, overwrite: true);
        if (File.Exists(exe))
        {
            try { File.Delete(exe); }
            catch (Exception) { File.Move(exe, Path.Combine(folder, $"RigHelper-old-{Environment.TickCount64}.exe")); }
        }
        File.Move(fresh, exe);
    }

    // Task Scheduler's scripting interface, as Protection.cs uses the firewall's.
    const int TASK_CREATE_OR_UPDATE = 6, TASK_LOGON_INTERACTIVE_TOKEN = 3, TASK_ENUM_HIDDEN = 1;

    /// Adds or replaces the task. Admins and the system have full control; the account it's for may read and run it, and
    /// may not change it.
    public static void Register(string name, string sid, string exe, string appExe)
    {
        string sddl = $"D:P(A;;FA;;;BA)(A;;FA;;;SY)(A;;FRFX;;;{sid})";
        WithRoot(root => Call(root, "RegisterTask", name, Xml(sid, exe, appExe), TASK_CREATE_OR_UPDATE, null, null, TASK_LOGON_INTERACTIVE_TOKEN, sddl));
    }

    /// The task: this account, signed in, with its full rights; no trigger, so it starts only when Rig asks; no time limit;
    /// normal priority (a task's default is below normal, which would slow sensor reads); and more than one at a time, so a
    /// helper still closing doesn't stop the next one.
    public static string Xml(string sid, string exe, string appExe)
    {
        XNamespace ns = "http://schemas.microsoft.com/windows/2004/02/mit/task";
        XElement E(string n, params object[] c) => new(ns + n, c);
        var task = E("Task", new XAttribute("version", "1.3"),
            E("RegistrationInfo",
                E("Author", "Rig"),
                E("Description", "Starts Rig's helper with admin rights when the Rig app opens, so it can read every sensor without Windows asking each time. Added by Rig's installer and removed when Rig is uninstalled.")),
            E("Principals", E("Principal", new XAttribute("id", "Author"),
                E("UserId", sid), E("LogonType", "InteractiveToken"), E("RunLevel", "HighestAvailable"))),
            E("Settings",
                E("MultipleInstancesPolicy", "Parallel"),
                E("DisallowStartIfOnBatteries", "false"),
                E("StopIfGoingOnBatteries", "false"),
                E("AllowHardTerminate", "true"),
                E("StartWhenAvailable", "false"),
                E("RunOnlyIfNetworkAvailable", "false"),
                E("IdleSettings", E("StopOnIdleEnd", "false"), E("RestartOnIdle", "false")),
                E("AllowStartOnDemand", "true"),
                E("Enabled", "true"),
                E("Hidden", "false"),
                E("RunOnlyIfIdle", "false"),
                E("WakeToRun", "false"),
                E("ExecutionTimeLimit", "PT0S"),
                E("Priority", "5")),
            E("Actions", new XAttribute("Context", "Author"),
                E("Exec", E("Command", exe), E("Arguments", Arguments(appExe)))));
        return new XDocument(task).ToString();
    }

    /// What the self-test checks of a registered task: (run level, logon type, priority, program, arguments).
    public static (int RunLevel, int LogonType, int Priority, string Path, string Arguments)? Read(string name) =>
        WithTask(name, task =>
        {
            object def = Get(task, "Definition")!;
            object principal = Get(def, "Principal")!, settings = Get(def, "Settings")!;
            object action = Get(Get(def, "Actions")!, "Item", 1)!;
            return ((int, int, int, string, string)?)(Convert.ToInt32(Get(principal, "RunLevel")), Convert.ToInt32(Get(principal, "LogonType")),
                Convert.ToInt32(Get(settings, "Priority")), Get(action, "Path")?.ToString() ?? "", Get(action, "Arguments")?.ToString() ?? "");
        });

    /// The last result Task Scheduler has for the task (267011 before its first run, 267009 while it runs).
    public static int? LastResult(string name) => WithTask(name, task => (int?)Convert.ToInt32(Get(task, "LastTaskResult")));

    /// Whether a copy of the task is running now (TASK_STATE_RUNNING), and when it last started.
    public static (bool Running, DateTime LastRun)? State(string name) =>
        WithTask(name, task => ((bool, DateTime)?)(Convert.ToInt32(Get(task, "State")) == 4, Convert.ToDateTime(Get(task, "LastRunTime"))));

    /// The task's security, as Windows keeps it (owner, group and access list).
    public static string? Security(string name) => WithTask(name, task => Call(task, "GetSecurityDescriptor", 0x7)?.ToString());

    /// Runs the task with any values, for the self-test's refused runs.
    internal static void RunWith(string name, string[] values) => WithTask<object>(name, task => Call(task, "Run", new object?[] { values }));

    public static void Delete(string name)
    {
        try { WithRoot(root => Call(root, "DeleteTask", name, 0)); }
        catch (Exception e) when (IsNotFound(e)) { }
    }

    static List<string> Names() => WithRoot(root =>
    {
        object tasks = Call(root, "GetTasks", TASK_ENUM_HIDDEN)!;
        int count = Convert.ToInt32(Get(tasks, "Count"));
        var names = new List<string>();
        for (int i = 1; i <= count; i++) names.Add(Get(Get(tasks, "Item", i)!, "Name")?.ToString() ?? "");
        return names;
    });

    static T? WithTask<T>(string name, Func<object, T?> act)
    {
        try { return WithRoot(root => act(Call(root, "GetTask", name)!)); }
        catch (Exception e) when (IsNotFound(e)) { return default; }
    }

    static T WithRoot<T>(Func<object, T> act)
    {
        var type = Type.GetTypeFromProgID("Schedule.Service") ?? throw new RigException("Task Scheduler's own interface isn't on this PC.");
        object service = Activator.CreateInstance(type)!;
        try
        {
            Call(service, "Connect");
            return act(Call(service, "GetFolder", "\\")!);
        }
        finally { Marshal.ReleaseComObject(service); }
    }

    // 0x80070002: no such task.
    static bool IsNotFound(Exception e) => (e is TargetInvocationException t ? t.InnerException : e) is COMException { HResult: unchecked((int)0x80070002) } or FileNotFoundException;

    static object? Get(object o, string member, params object?[] args) => o.GetType().InvokeMember(member, BindingFlags.GetProperty, null, o, args);
    static object? Call(object o, string member, params object?[] args) => o.GetType().InvokeMember(member, BindingFlags.InvokeMethod, null, o, args);

    static string? Arg(string[] args, string name)
    {
        int i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}
