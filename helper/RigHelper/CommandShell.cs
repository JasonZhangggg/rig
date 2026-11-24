// How the helper runs PowerShell for a command: always Windows PowerShell 5.1
// by its full System32 path, with no profile, no prompts and a module path and
// PATH that hold only Windows' and Program Files' folders, the same engine for
// parsing and running. Reads and commands that don't need admin rights run as
// the person, with the token of the Rig app that started the helper.

using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

/// The Windows account Rig's app runs as. The helper may run elevated as someone else, so "the person" is never just the helper's own account.
public sealed class Person
{
    public string Sid { get; }
    readonly int? app;

    Person(string sid, int? app) { Sid = sid; this.app = app; }

    /// The helper's own account: the self-test, which has no app.
    public static Person Self()
    {
        using var id = WindowsIdentity.GetCurrent();
        return new Person(id.User?.Value ?? throw new RigException("Rig couldn't tell which Windows account this is."), null);
    }

    public static Person OfApp(int pid)
    {
        IntPtr token = OpenToken(pid);
        try { using var id = new WindowsIdentity(token); return new Person(id.User?.Value ?? throw new RigException("Rig couldn't tell which Windows account you're signed in as."), pid); }
        finally { CloseHandle(token); }
    }

    /// True when the helper already runs as the person, with the person's rights and no more.
    public bool IsHelper => app == null || !Native.IsAdmin();

    /// The person's own Local AppData folder, read from their part of the registry, or null when they aren't signed in.
    public string? Profile() =>
        Reg.ReadValue(Reg.Users, $@"{Sid}\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders", "Local AppData") is { Type: 1 or 2 } v
            ? System.Text.Encoding.Unicode.GetString(v.Data).TrimEnd('\0') : null;

    static IntPtr OpenToken(int pid)
    {
        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception();
        try
        {
            if (!OpenProcessToken(process, TOKEN_QUERY | TOKEN_DUPLICATE, out IntPtr token)) throw new Win32Exception();
            return token;
        }
        finally { CloseHandle(process); }
    }

    /// A copy of the person's token: a primary one to start a program with, or one to act as them for a moment.
    public SafeAccessTokenHandle Token(bool primary)
    {
        IntPtr token = OpenToken(app ?? Environment.ProcessId);
        try
        {
            if (!DuplicateTokenEx(token, MAXIMUM_ALLOWED, IntPtr.Zero, SecurityImpersonation, primary ? TokenPrimary : TokenImpersonation, out IntPtr copy)) throw new Win32Exception();
            return new SafeAccessTokenHandle(copy);
        }
        finally { CloseHandle(token); }
    }

    /// Runs with the person's rights and no more: what Rig reads and writes for a command that doesn't need admin rights.
    public void As(Action act)
    {
        if (IsHelper) { act(); return; }
        using var token = Token(primary: false);
        WindowsIdentity.RunImpersonated(token, act);
    }

    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x8, TOKEN_DUPLICATE = 0x2, MAXIMUM_ALLOWED = 0x02000000;
    const int SecurityImpersonation = 2, TokenPrimary = 1, TokenImpersonation = 2;
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int level, int type, out IntPtr copy);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
}

public static class PinnedShell
{
    public record Ran(int Exit, string Out, string Err, bool TimedOut)
    {
        public bool Ok => !TimedOut && Exit == 0;
        /// What it printed, errors last, as one text for the card.
        public string Text => (Out.TrimEnd() + (Err.Trim().Length > 0 ? "\n" + Err.Trim() : "")).Trim();
    }

    static readonly string Sys = Environment.GetFolderPath(Environment.SpecialFolder.System);
    public static readonly string Exe = Path.Combine(Sys, @"WindowsPowerShell\v1.0\powershell.exe");
    public const int MaxOutput = 16_000;

    static string Args(string file) => $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{file}\"";

    /// The environment a pinned run gets: only folders admins control decide which modules and programs a bare name finds.
    static void Clean(IDictionary<string, string?> env, bool elevated)
    {
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows), programs = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string first = string.Join(';', Sys, windows, Path.Combine(Sys, "Wbem"), Path.Combine(Sys, @"WindowsPowerShell\v1.0"));
        string? rest = elevated ? Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine) : env.TryGetValue("Path", out string? p) ? p : null;
        foreach (string k in env.Keys.Where(k => k.Equals("Path", StringComparison.OrdinalIgnoreCase) || k.Equals("PSModulePath", StringComparison.OrdinalIgnoreCase)
            || k.Equals("PATHEXT", StringComparison.OrdinalIgnoreCase) || k.Equals("PSExecutionPolicyPreference", StringComparison.OrdinalIgnoreCase)).ToList()) env.Remove(k);
        env["Path"] = string.IsNullOrEmpty(rest) ? first : $"{first};{rest}";
        env["PSModulePath"] = string.Join(';', Path.Combine(Sys, @"WindowsPowerShell\v1.0\Modules"), Path.Combine(programs, @"WindowsPowerShell\Modules"));
        env["PATHEXT"] = ".COM;.EXE;.BAT;.CMD";
    }

    /// Runs a script file with the helper's own rights.
    public static Ran RunHere(string file, int timeoutMs, string? input = null)
    {
        var psi = new ProcessStartInfo(Exe, Args(file))
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Sys,
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
        };
        Clean(psi.Environment, Native.IsAdmin());
        using var p = Process.Start(psi) ?? throw new RigException("PowerShell didn't start.");
        var o = UserProcess.Drain(p.StandardOutput.BaseStream);
        var e = UserProcess.Drain(p.StandardError.BaseStream);
        try { if (input != null) p.StandardInput.Write(input); p.StandardInput.Close(); } catch (IOException) { }
        bool done = p.WaitForExit(timeoutMs);
        if (!done) { try { p.Kill(entireProcessTree: true); } catch { } p.WaitForExit(5000); }
        return new Ran(done ? p.ExitCode : -1, UserProcess.Got(o), UserProcess.Got(e), !done);
    }

    /// Runs a script file as the person, unelevated. Throws a RigException that says so plainly when Windows won't start it.
    public static Ran RunAs(Person person, string file, int timeoutMs) => person.IsHelper ? RunHere(file, timeoutMs) : RunWithToken(person, file, timeoutMs);

    /// Starts PowerShell with the person's own token and environment, and reads what it prints through pipes.
    public static Ran RunWithToken(Person person, string file, int timeoutMs)
    {
        using var token = person.Token(primary: true);
        IntPtr outR = IntPtr.Zero, outW = IntPtr.Zero, errR = IntPtr.Zero, errW = IntPtr.Zero, inR = IntPtr.Zero, inW = IntPtr.Zero, env = IntPtr.Zero, block = IntPtr.Zero;
        var pi = new PROCESS_INFORMATION();
        try
        {
            var vars = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            if (CreateEnvironmentBlock(out env, token.DangerousGetHandle(), false))
                for (IntPtr at = env; Marshal.PtrToStringUni(at) is { Length: > 0 } line; at += (line.Length + 1) * 2)
                {
                    int eq = line.IndexOf('=', 1);
                    if (eq > 0) vars[line[..eq]] = line[(eq + 1)..];
                }
            Clean(vars, elevated: false);
            block = Marshal.StringToHGlobalUni(string.Concat(vars.OrderBy(v => v.Key, StringComparer.OrdinalIgnoreCase).Select(v => $"{v.Key}={v.Value}\0")) + "\0");

            var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(), bInheritHandle = 1 };
            if (!CreatePipe(out outR, out outW, ref sa, 0) || !CreatePipe(out errR, out errW, ref sa, 0) || !CreatePipe(out inR, out inW, ref sa, 0)) throw Plain("connect to PowerShell");
            SetHandleInformation(outR, HANDLE_FLAG_INHERIT, 0);
            SetHandleInformation(errR, HANDLE_FLAG_INHERIT, 0);
            SetHandleInformation(inW, HANDLE_FLAG_INHERIT, 0);
            var si = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFO>(), dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW, wShowWindow = 0, hStdInput = inR, hStdOutput = outW, hStdError = errW };
            var cmd = new StringBuilder($"\"{Exe}\" {Args(file)}");
            if (!CreateProcessWithTokenW(token.DangerousGetHandle(), 0, Exe, cmd, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, block, Sys, ref si, out pi)) throw Plain("start PowerShell");
            Close(ref outW); Close(ref errW); Close(ref inR); Close(ref inW);
            var o = UserProcess.Drain(new FileStream(new SafeFileHandle(outR, ownsHandle: true), FileAccess.Read));
            outR = IntPtr.Zero;
            var e = UserProcess.Drain(new FileStream(new SafeFileHandle(errR, ownsHandle: true), FileAccess.Read));
            errR = IntPtr.Zero;
            bool timedOut = WaitForSingleObject(pi.hProcess, (uint)timeoutMs) != 0;
            if (timedOut)
            {
                try { using var p = Process.GetProcessById(pi.dwProcessId); p.Kill(entireProcessTree: true); } catch { }
                WaitForSingleObject(pi.hProcess, 5000);
            }
            GetExitCodeProcess(pi.hProcess, out uint code);
            return new Ran(timedOut ? -1 : unchecked((int)code), UserProcess.Got(o), UserProcess.Got(e), timedOut);
        }
        finally
        {
            Close(ref outR); Close(ref outW); Close(ref errR); Close(ref errW); Close(ref inR); Close(ref inW);
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
            if (block != IntPtr.Zero) Marshal.FreeHGlobal(block);
        }
    }

    static RigException Plain(string what) => new($"Rig couldn't {what} as you, without admin rights (Windows error {Marshal.GetLastWin32Error()}).");

    /// What PowerShell's own parser finds in each script, in order: one run of the fixed parse script, which runs nothing it is given.
    /// Null for a script the parser gave no answer for.
    public static List<JsonObject?> Parse(IReadOnlyList<string> scripts)
    {
        string file = Path.Combine(CommandHome.Folder("engine"), "parse.ps1");
        File.WriteAllText(file, CommandCheck.Resource("Rig.Rules.parse.ps1"), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        var input = new StringBuilder();
        foreach (string s in scripts) input.Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(s))).Append('\n');
        var ran = RunHere(file, 60_000 + scripts.Count * 500, input.ToString());
        string[] lines = ran.Out.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var found = new List<JsonObject?>();
        for (int i = 0; i < scripts.Count; i++)
        {
            JsonObject? o = null;
            if (lines.Length == scripts.Count) try { o = JsonNode.Parse(lines[i]) as JsonObject; } catch (System.Text.Json.JsonException) { }
            found.Add(o);
        }
        return found;
    }

    static void Close(ref IntPtr h) { if (h != IntPtr.Zero) { CloseHandle(h); h = IntPtr.Zero; } }

    const uint HANDLE_FLAG_INHERIT = 1, CREATE_NO_WINDOW = 0x08000000, CREATE_UNICODE_ENVIRONMENT = 0x400;
    const int STARTF_USESTDHANDLES = 0x100, STARTF_USESHOWWINDOW = 0x1;
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb; public string? lpReserved; public string? lpDesktop; public string? lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessWithTokenW(IntPtr token, uint logonFlags, string? app, StringBuilder cmd, uint flags, IntPtr env, string? cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("userenv.dll", SetLastError = true)] static extern bool CreateEnvironmentBlock(out IntPtr env, IntPtr token, bool inherit);
    [DllImport("userenv.dll")] static extern bool DestroyEnvironmentBlock(IntPtr env);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES sa, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
}

/// Where the helper keeps what a command needs: pending approvals, snapshots, undo scripts and the scripts it runs.
/// With admin rights that is a folder only admins and the system can open; without, the helper is the person and keeps it in their own profile.
public static class CommandHome
{
    public static string Root = Default();

    public static string Default() => Native.IsAdmin()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rig", "Commands")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rig", "Commands");

    static void Secure(string dir, string? reader)
    {
        if (!Native.IsAdmin()) { Directory.CreateDirectory(dir); return; }
        if (Directory.Exists(dir) && File.GetAttributes(dir).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(dir);
        if (Directory.Exists(dir) && !OwnedByAdmins(dir)) Directory.Delete(dir, recursive: true);
        var info = Directory.CreateDirectory(dir);
        var sec = new DirectorySecurity();
        sec.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        sec.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        const InheritanceFlags all = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
        sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
        if (reader != null) sec.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(reader), FileSystemRights.ReadAndExecute, all, PropagationFlags.None, AccessControlType.Allow));
        info.SetAccessControl(sec);
    }

    static bool OwnedByAdmins(string dir)
    {
        var owner = new DirectoryInfo(dir).GetAccessControl().GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
        return owner != null && (owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid) || owner.IsWellKnown(WellKnownSidType.LocalSystemSid));
    }

    /// A folder under the root, made if it's missing. `reader` is an account that may read it (never write): the person, for scripts that run as them.
    public static string Folder(string name, string? reader = null)
    {
        // ProgramData lets anyone make folders, so one that isn't Rig's own, or is a link to somewhere else, is taken over before anything is kept in it.
        string parent = Path.GetDirectoryName(Root)!;
        if (Native.IsAdmin() && Directory.Exists(parent) && File.GetAttributes(parent).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(parent);
        Secure(Root, null);
        string dir = Path.Combine(Root, name);
        Secure(dir, reader);
        return dir;
    }
}
