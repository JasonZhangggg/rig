// How the general command runner starts PowerShell, and as whom.
//
// Every run is pinned: Windows PowerShell 5.1 by its full System32 path, no
// profile, no prompts, an environment built afresh with a module path and
// PATH that hold only Windows' own folders, the script read from a file only
// admins can change, and an empty folder only admins can change as the folder
// it starts in, so a name without a path lands nowhere that matters. The same
// engine parses a script for the check and runs it.
//
// "The person" is whoever is using the Rig app. When the helper has admin
// rights, a read and any change that doesn't need them still run with the
// person's own rights: with a copy of the Rig app's own token, the one
// Windows gave the person when they started Rig. The helper also borrows that
// identity to read and write the person's files and registry, so a link
// planted there can't point the helper's admin rights at something else.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

public static class PowerShellHost
{
    public sealed record Ran(int Exit, string Out, string Err, bool TimedOut)
    {
        public bool Ok => !TimedOut && Exit == 0;
        /// What it printed, errors last, cut to what a card can show.
        public string Printed
        {
            get
            {
                string all = (Out.TrimEnd() + (Err.Trim().Length > 0 ? "\n" + Err.Trim() : "")).Trim();
                return all.Length <= ProbeRules.MaxOutputChars ? all : all[..ProbeRules.MaxOutputChars] + "\n…";
            }
        }
    }

    static readonly string Sys = Environment.SystemDirectory;
    static readonly string Windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
    public static readonly string Exe = Path.Combine(Sys, @"WindowsPowerShell\v1.0\powershell.exe");
    static readonly string Modules = Path.Combine(Sys, @"WindowsPowerShell\v1.0\Modules");

    /// The variables a script running as the person keeps from that person's own environment.
    public static readonly string[] Theirs = ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "USERNAME", "USERDOMAIN", "TEMP", "TMP"];

    /// Everything else a script starts with: Windows' own folders and nothing anyone can set for a program to pick up.
    public static Dictionary<string, string> Clean(string temp)
    {
        static string Folder(Environment.SpecialFolder f) => Environment.GetFolderPath(f);
        string data = Folder(Environment.SpecialFolder.CommonApplicationData), files = Folder(Environment.SpecialFolder.ProgramFiles), common = Folder(Environment.SpecialFolder.CommonProgramFiles);
        return new(StringComparer.OrdinalIgnoreCase)
        {
            ["SystemRoot"] = Windows, ["windir"] = Windows, ["SystemDrive"] = Path.GetPathRoot(Windows)!.TrimEnd('\\'),
            ["ComSpec"] = Path.Combine(Sys, "cmd.exe"),
            ["Path"] = $@"{Sys};{Sys}\WindowsPowerShell\v1.0",
            ["PATHEXT"] = ".COM;.EXE;.BAT;.CMD",
            ["PSModulePath"] = Modules,
            ["TEMP"] = temp, ["TMP"] = temp,
            ["ProgramData"] = data, ["ALLUSERSPROFILE"] = data,
            ["ProgramFiles"] = files, ["ProgramW6432"] = files, ["ProgramFiles(x86)"] = Folder(Environment.SpecialFolder.ProgramFilesX86),
            ["CommonProgramFiles"] = common, ["CommonProgramW6432"] = common, ["CommonProgramFiles(x86)"] = Folder(Environment.SpecialFolder.CommonProgramFilesX86),
            ["COMPUTERNAME"] = Environment.MachineName, ["OS"] = "Windows_NT", ["NUMBER_OF_PROCESSORS"] = Environment.ProcessorCount.ToString(),
            ["PROCESSOR_ARCHITECTURE"] = RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "ARM64" : "AMD64",
        };
    }

    /// The clean environment for a script with the helper's own rights: who the helper is, read from Windows, not from its own environment.
    internal static Dictionary<string, string> DiagMine(string temp) => Mine(temp);

    static Dictionary<string, string> Mine(string temp)
    {
        var env = Clean(temp);
        env["USERPROFILE"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        env["APPDATA"] = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        env["LOCALAPPDATA"] = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        env["USERNAME"] = Environment.UserName;
        env["USERDOMAIN"] = Environment.UserDomainName;
        return env;
    }

    public static string Args(string file, params string[] more) =>
        $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{file}\"" + string.Concat(more.Select(m => $" \"{m}\""));

    /// Writes a script as UTF-8 with a byte order mark, behind one line of Rig's own: PowerShell adds the person's module
    /// folder back when it starts, so the line pins the module path again and makes the output UTF-8. A change stops at its first error.
    public static void Write(string file, string script, bool stopOnError)
    {
        string first = $"try {{ [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false }} catch {{ }}; $env:PSModulePath = '{Modules}'" + (stopOnError ? "; $ErrorActionPreference = 'Stop'" : "");
        File.WriteAllText(file, first + "\r\n" + script, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
    }

    /// Runs with the helper's own rights, starting in `folder`, with temporary files in `temp`.
    public static Ran RunHere(string args, int timeoutMs, string folder, string temp)
    {
        var psi = new ProcessStartInfo(Exe, args)
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = folder,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
        };
        psi.Environment.Clear();
        foreach (var (k, v) in Mine(temp)) psi.Environment[k] = v;
        using var p = Process.Start(psi) ?? throw new RigException("PowerShell didn't start.");
        p.StandardInput.Close();
        var o = UserProcess.Drain(p.StandardOutput.BaseStream);
        var e = UserProcess.Drain(p.StandardError.BaseStream);
        bool done = p.WaitForExit(timeoutMs);
        if (!done) { try { p.Kill(entireProcessTree: true); } catch { } p.WaitForExit(5000); }
        return new Ran(done ? p.ExitCode : -1, UserProcess.Got(o), UserProcess.Got(e), !done);
    }
}

public sealed class Person : IDisposable
{
    public string Sid { get; }
    /// How Windows elevated the Rig app's token, one of the TokenElevationType values, or 0 when the helper is the person.
    public int Elevation { get; }
    /// The Rig app runs as administrator, so a change without admin rights would run with them all the same.
    public bool Elevated => Elevation == TokenElevationTypeFull;
    readonly IntPtr primary;
    readonly SafeAccessTokenHandle? borrowed;

    Person(string sid, IntPtr primary, int elevation = 0)
    {
        Sid = sid;
        this.primary = primary;
        Elevation = elevation;
        if (primary == IntPtr.Zero) return;
        if (!DuplicateTokenEx(primary, MAXIMUM_ALLOWED, IntPtr.Zero, SecurityImpersonation, TokenImpersonation, out IntPtr thread)) throw Win("borrow your Windows sign-in");
        borrowed = new SafeAccessTokenHandle(thread);
    }

    /// The account this helper runs as.
    public static string Mine()
    {
        using var me = WindowsIdentity.GetCurrent();
        return me.User?.Value ?? throw new RigException("Rig couldn't tell which Windows account this is.");
    }

    /// The person behind the Rig app with this process id. Without admin rights the helper already is the person.
    /// With them, the app's own token is the person's: an elevated helper with no app to take it from runs nothing.
    public static Person Find(int? appPid)
    {
        string mine = Mine();
        if (!Native.IsAdmin()) return new Person(mine, IntPtr.Zero);
        if (appPid is not int pid) throw new RigException("Rig's helper has admin rights but wasn't started by the Rig app, so it has no way to act as you. Restart Rig.");
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid), app = IntPtr.Zero, token = IntPtr.Zero;
        try
        {
            if (process == IntPtr.Zero || !OpenProcessToken(process, TOKEN_DUPLICATE | TOKEN_QUERY, out app)) throw Win("read the Rig app's Windows sign-in");
            string theirs;
            using (var id = new WindowsIdentity(app)) theirs = id.User?.Value ?? throw new RigException("Rig couldn't tell which Windows account you're signed in as.");
            if (!DuplicateTokenEx(app, MAXIMUM_ALLOWED, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out token)) throw Win("copy your Windows sign-in");
            var person = new Person(theirs, token, ElevationOf(app));
            token = IntPtr.Zero;
            return person;
        }
        finally
        {
            if (token != IntPtr.Zero) CloseHandle(token);
            if (app != IntPtr.Zero) CloseHandle(app);
            if (process != IntPtr.Zero) CloseHandle(process);
        }
    }

    public const int TokenElevationTypeDefault = 1, TokenElevationTypeFull = 2, TokenElevationTypeLimited = 3;

    /// How Windows elevated a token: full when it was started with "Run as administrator", limited for the same account's
    /// everyday token, default when the account has no second token. 0 when Windows won't say.
    public static int ElevationOf(IntPtr token) =>
        GetTokenInformation(token, TokenElevationTypeClass, out int type, sizeof(int), out _) ? type : 0;

    /// Whether scripts run with the helper's own rights because the helper has none beyond the person's.
    public bool Here => primary == IntPtr.Zero;

    /// Does something to the person's own files or registry with the person's rights, not the helper's.
    public T Do<T>(Func<T> act) => borrowed == null ? act() : WindowsIdentity.RunImpersonated(borrowed, act);

    /// Runs a script file with the person's rights, starting in `folder`. Temporary files go to the person's own temp folder.
    public PowerShellHost.Ran Run(string file, int timeoutMs, string folder)
    {
        string args = PowerShellHost.Args(file);
        if (primary == IntPtr.Zero) return PowerShellHost.RunHere(args, timeoutMs, folder, Path.GetTempPath());
        var (exit, o, e, timedOut) = UserProcess.RunAs(primary, PowerShellHost.Exe, args, timeoutMs, desktop: null, PowerShellHost.Clean(folder), folder, logonService: true, keep: PowerShellHost.Theirs);
        return new PowerShellHost.Ran(exit, o, e, timedOut);
    }

    public void Dispose()
    {
        borrowed?.Dispose();
        if (primary != IntPtr.Zero) CloseHandle(primary);
    }

    static RigException Win(string what) => new($"Rig couldn't {what} (Windows error {Marshal.GetLastWin32Error()}), so it can't look or change anything as you.");

    const uint MAXIMUM_ALLOWED = 0x02000000, TOKEN_DUPLICATE = 0x2, TOKEN_QUERY = 0x8;
    const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, SecurityImpersonation = 2, TokenPrimary = 1, TokenImpersonation = 2, TokenElevationTypeClass = 18;

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int level, int type, out IntPtr newToken);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int infoClass, out int info, int length, out int returned);
}
