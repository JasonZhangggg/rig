// How the general command runner starts PowerShell, and as whom.
//
// Every run is pinned: Windows PowerShell 5.1 by its full System32 path, no
// profile, no prompts, a module path and PATH that hold only Windows' own
// folders, and the script read from a file only admins can change. The same
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
    public static readonly string Exe = Path.Combine(Sys, @"WindowsPowerShell\v1.0\powershell.exe");
    static readonly string Modules = Path.Combine(Sys, @"WindowsPowerShell\v1.0\Modules");
    public static string Folder => Sys;

    public static readonly IReadOnlyDictionary<string, string> Pinned = new Dictionary<string, string>
    {
        ["PSModulePath"] = Modules,
        ["Path"] = $@"{Sys};{Sys}\Wbem;{Sys}\WindowsPowerShell\v1.0",
        ["PATHEXT"] = ".COM;.EXE;.BAT;.CMD",
    };

    public static string Args(string file, params string[] more) =>
        $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{file}\"" + string.Concat(more.Select(m => $" \"{m}\""));

    /// Writes a script as UTF-8 with a byte order mark, behind one line of Rig's own: PowerShell adds the person's module
    /// folder back when it starts, so the line pins the module path again and makes the output UTF-8. A change stops at its first error.
    public static void Write(string file, string script, bool stopOnError)
    {
        string first = $"try {{ [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false }} catch {{ }}; $env:PSModulePath = '{Modules}'" + (stopOnError ? "; $ErrorActionPreference = 'Stop'" : "");
        File.WriteAllText(file, first + "\r\n" + script, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
    }

    /// Runs with the helper's own rights.
    public static Ran RunHere(string args, int timeoutMs)
    {
        var psi = new ProcessStartInfo(Exe, args)
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Sys,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
        };
        foreach (var (k, v) in Pinned) psi.Environment[k] = v;
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
    readonly IntPtr primary;
    readonly SafeAccessTokenHandle? borrowed;

    Person(string sid, IntPtr primary)
    {
        Sid = sid;
        this.primary = primary;
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
            var person = new Person(theirs, token);
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

    /// Whether scripts run with the helper's own rights because the helper has none beyond the person's.
    public bool Here => primary == IntPtr.Zero;

    /// Does something to the person's own files or registry with the person's rights, not the helper's.
    public T Do<T>(Func<T> act) => borrowed == null ? act() : WindowsIdentity.RunImpersonated(borrowed, act);

    /// Runs a script file with the person's rights.
    public PowerShellHost.Ran Run(string file, int timeoutMs)
    {
        string args = PowerShellHost.Args(file);
        if (primary == IntPtr.Zero) return PowerShellHost.RunHere(args, timeoutMs);
        var (exit, o, e, timedOut) = UserProcess.RunAs(primary, PowerShellHost.Exe, args, timeoutMs, desktop: null, PowerShellHost.Pinned, PowerShellHost.Folder, logonService: true);
        return new PowerShellHost.Ran(exit, o, e, timedOut);
    }

    public void Dispose()
    {
        borrowed?.Dispose();
        if (primary != IntPtr.Zero) CloseHandle(primary);
    }

    static RigException Win(string what) => new($"Rig couldn't {what} (Windows error {Marshal.GetLastWin32Error()}), so it can't look or change anything as you.");

    const uint MAXIMUM_ALLOWED = 0x02000000, TOKEN_DUPLICATE = 0x2, TOKEN_QUERY = 0x8;
    const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, SecurityImpersonation = 2, TokenPrimary = 1, TokenImpersonation = 2;

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int level, int type, out IntPtr newToken);
}
