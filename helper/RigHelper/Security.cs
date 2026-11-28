// Whether the PC is safe and up to date, in the shape of Rig's SecurityFacts
// (packages/core/src/safety.ts): the antivirus Windows Security Center knows
// about, Microsoft Defender's own status, Windows Firewall per network
// profile, Windows Update (last install, a restart waiting) and backup (File
// History, OneDrive's folder backup). Only reads, nothing here changes a
// setting. Each part is optional: one Windows doesn't answer for is left out,
// never guessed, and nothing here throws.
//
// Read with the other settings ("facts", every half minute), but kept for two
// minutes, and the list of installed updates for half an hour, since a WMI
// query can take a few seconds. A facts request waits a moment for a fresh
// read and otherwise answers with the last one.

using System.Globalization;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

public static class Security
{
    static readonly TimeSpan QueryTimeout = TimeSpan.FromSeconds(5);
    const long KeepMs = 2 * 60_000, KeepUpdatesMs = 30 * 60_000, Day = 86_400_000;
    /// How long a facts request waits for a fresh read before answering with the last one.
    static readonly TimeSpan WaitFor = TimeSpan.FromSeconds(3);

    static readonly object gate = new();
    static object? last;
    static long lastAt;
    static Task? running;
    static long updatesAt;
    static long? updatesInstalled;

    static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// The last read, fresh enough, or null before the first one finishes. `owner` is the SID of the account the Rig app
    /// runs as, whose File History and OneDrive are read; without it, this process's own account.
    public static object? Read(string? owner)
    {
        Task t;
        lock (gate)
        {
            if (last != null && Now() - lastAt < KeepMs) return last;
            running ??= Task.Run(() => Refresh(owner));
            t = running;
        }
        try { t.Wait(WaitFor); } catch { }
        lock (gate) return last;
    }

    static void Refresh(string? owner)
    {
        object? fresh = null;
        try { fresh = ReadNow(owner); } catch { }
        lock (gate)
        {
            if (fresh != null) { last = fresh; lastAt = Now(); }
            running = null;
        }
    }

    /// Everything, read now. Used by Read and by the self-test.
    public static object ReadNow(string? owner) => new
    {
        readAt = Now(),
        antivirus = Antivirus(),
        defender = Defender(),
        firewall = Firewall(),
        updates = Updates(),
        backup = Backup(owner),
    };

    // ----- WMI -----

    /// The rows of one query, or null when Windows didn't answer: no such namespace (Windows Server has no Security Center), no such class, or too slow.
    static List<ManagementBaseObject>? Query(string scope, string wql)
    {
        try
        {
            var options = new System.Management.EnumerationOptions { Timeout = QueryTimeout, ReturnImmediately = true, Rewindable = false };
            using var s = new ManagementObjectSearcher(new ManagementScope(scope), new ObjectQuery(wql), options);
            using var found = s.Get();
            return found.Cast<ManagementBaseObject>().ToList();
        }
        catch { return null; }
    }

    static object? Prop(ManagementBaseObject o, string name)
    {
        try { return o[name]; } catch { return null; }
    }

    static string Text(ManagementBaseObject o, string name) => (Prop(o, name)?.ToString() ?? "").Trim();

    /// Names come from the programs themselves: kept short and on one line.
    static string Clip(string s)
    {
        var t = new string(s.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return t.Length > 80 ? t[..80] : t;
    }

    // ----- Antivirus and other products Security Center knows -----

    /// productState is three bytes: the kind of product, whether it's on (0x10 in the middle byte) and whether its definitions are out of date (0x10 in the low byte).
    public static bool StateOn(uint state) => ((state >> 8) & 0x10) != 0;
    public static bool StateUpToDate(uint state) => (state & 0x10) == 0;

    static List<(string Name, uint State)>? Center(string cls)
    {
        var rows = Query(@"root\SecurityCenter2", $"SELECT displayName, productState FROM {cls}");
        if (rows == null) return null;
        var list = new List<(string Name, uint State)>();
        foreach (var o in rows)
        {
            string name = Clip(Text(o, "displayName"));
            uint state;
            try { state = Convert.ToUInt32(Prop(o, "productState") ?? 0u, CultureInfo.InvariantCulture); } catch { continue; }
            if (name.Length > 0 && list.Count < 8) list.Add((name, state));
        }
        return list;
    }

    static List<object>? Antivirus() =>
        Center("AntiVirusProduct")?.Select(p => (object)new { name = p.Name, enabled = StateOn(p.State), upToDate = StateUpToDate(p.State) }).ToList();

    static object? Defender()
    {
        // SELECT * so a property an older Windows lacks (AMRunningMode) doesn't fail the whole query.
        var o = Query(@"root\Microsoft\Windows\Defender", "SELECT * FROM MSFT_MpComputerStatus")?.FirstOrDefault();
        if (o == null) return null;
        string mode = Clip(Text(o, "AMRunningMode"));
        return new
        {
            realTime = Prop(o, "RealTimeProtectionEnabled") as bool?,
            signatureAgeDays = Days(Prop(o, "AntivirusSignatureAge")),
            quickScanAgeDays = Days(Prop(o, "QuickScanAge")),
            mode = mode.Length > 0 ? mode : null,
        };
    }

    /// An age in days, or null for Defender's "never" values (65535 and up).
    static int? Days(object? v)
    {
        try
        {
            if (v == null) return null;
            long d = Convert.ToInt64(v, CultureInfo.InvariantCulture);
            return d >= 0 && d < 65535 ? (int?)d : null;
        }
        catch { return null; }
    }

    // ----- Windows Firewall -----

    static object? Firewall()
    {
        var on = FirewallProfiles();
        var products = Center("FirewallProduct")?.Select(p => (object)new { name = p.Name, enabled = StateOn(p.State) }).ToList();
        if (on[0] == null && on[1] == null && on[2] == null && products == null) return null;
        return new { domain = on[0], @private = on[1], @public = on[2], products };
    }

    /// Domain, private and public, from Windows Firewall's own interface (the one Protection.cs uses), or the setting in the registry when the firewall service doesn't answer.
    static bool?[] FirewallProfiles()
    {
        var on = new bool?[3];
        int[] profiles = [1, 2, 4];
        try
        {
            var type = Type.GetTypeFromProgID("HNetCfg.FwPolicy2");
            if (type != null && Activator.CreateInstance(type) is object policy)
            {
                try
                {
                    for (int i = 0; i < 3; i++)
                    {
                        try { on[i] = Convert.ToBoolean(policy.GetType().InvokeMember("FirewallEnabled", BindingFlags.GetProperty, null, policy, new object[] { profiles[i] })); }
                        catch { }
                    }
                }
                finally { Marshal.ReleaseComObject(policy); }
            }
        }
        catch { }
        string[] keys = ["DomainProfile", "StandardProfile", "PublicProfile"];
        for (int i = 0; i < 3; i++)
        {
            if (on[i] != null) continue;
            try
            {
                using var k = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\{keys[i]}");
                if (k?.GetValue("EnableFirewall") is int v) on[i] = v != 0;
            }
            catch { }
        }
        return on;
    }

    // ----- Windows Update -----

    const string RebootRequired = @"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired";
    const string RebootPending = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending";

    static object? Updates()
    {
        long? installed = LastInstalled();
        bool? pending = null;
        long? since = null;
        try
        {
            pending = false;
            foreach (var path in new[] { RebootRequired, RebootPending })
            {
                using var k = Registry.LocalMachine.OpenSubKey(path);
                if (k == null) continue;
                pending = true;
                // About when the restart started waiting: when Windows last wrote the key.
                if (KeyWritten(k) is long t && (since == null || t < since)) since = t;
            }
        }
        catch { pending = null; since = null; }
        if (installed == null && pending == null) return null;
        return new { lastInstalledAt = installed, restartPending = pending, restartSince = since };
    }

    /// The newest install date in the list of installed updates. That list takes a moment to read, so it's kept for half an hour.
    static long? LastInstalled()
    {
        long now = Now();
        lock (gate) if (updatesAt != 0 && now - updatesAt < KeepUpdatesMs) return updatesInstalled;
        long? found = null;
        var rows = Query(@"root\cimv2", "SELECT InstalledOn FROM Win32_QuickFixEngineering");
        if (rows != null)
            foreach (var o in rows)
                if (InstalledOn(Text(o, "InstalledOn")) is long t && t <= now + Day && (found == null || t > found)) found = t;
        lock (gate) { updatesAt = now; updatesInstalled = found; }
        return found;
    }

    /// Win32_QuickFixEngineering's InstalledOn: "11/12/2026" on current Windows, a day as "20261112", or a FILETIME in hex on old ones.
    public static long? InstalledOn(string s)
    {
        if (s.Length == 0) return null;
        if (DateTime.TryParseExact(s, new[] { "M/d/yyyy", "yyyyMMdd" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
            return new DateTimeOffset(DateTime.SpecifyKind(d, DateTimeKind.Local)).ToUnixTimeMilliseconds();
        if (s.Length == 16 && long.TryParse(s, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out long ft))
        {
            try { return DateTimeOffset.FromFileTime(ft).ToUnixTimeMilliseconds(); } catch { }
        }
        return null;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int RegQueryInfoKey(SafeRegistryHandle key, IntPtr className, IntPtr classLength, IntPtr reserved, IntPtr subKeys, IntPtr maxSubKeyLength,
        IntPtr maxClassLength, IntPtr values, IntPtr maxValueNameLength, IntPtr maxValueLength, IntPtr securityDescriptor, out long lastWriteTime);

    /// When a registry key was last written, or null.
    static long? KeyWritten(RegistryKey k)
    {
        try
        {
            if (RegQueryInfoKey(k.Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out long ft) != 0 || ft <= 0) return null;
            return DateTimeOffset.FromFileTime(ft).ToUnixTimeMilliseconds();
        }
        catch { return null; }
    }

    // ----- Backup -----

    static object? Backup(string? owner)
    {
        try
        {
            // The person's own Software key, by the SID of the account the app runs as.
            using var software = owner != null ? Registry.Users.OpenSubKey($@"{owner}\Software") : Registry.CurrentUser.OpenSubKey("Software");
            if (software == null) return null;
            var oneDrive = OneDrive(software);
            long? fileHistory = FileHistory(software);
            if (oneDrive == null && fileHistory == null) return null;
            return new { fileHistoryAt = fileHistory, oneDrive };
        }
        catch { return null; }
    }

    /// The folders that live in a OneDrive account's folder, so OneDrive keeps a copy. Empty when none do; null when the folders couldn't be read.
    static List<string>? OneDrive(RegistryKey software)
    {
        try
        {
            using var shell = software.OpenSubKey(@"Microsoft\Windows\CurrentVersion\Explorer\Shell Folders");
            if (shell == null) return null;
            var roots = new List<string>();
            using (var accounts = software.OpenSubKey(@"Microsoft\OneDrive\Accounts"))
            {
                if (accounts != null)
                    foreach (var name in accounts.GetSubKeyNames().Take(10))
                    {
                        using var a = accounts.OpenSubKey(name);
                        if (a?.GetValue("UserFolder") is string f && f.Length > 3) roots.Add(f.TrimEnd('\\') + "\\");
                    }
            }
            var folders = new List<string>();
            foreach (var (value, word) in new[] { ("Desktop", "Desktop"), ("Personal", "Documents"), ("My Pictures", "Pictures") })
                if (shell.GetValue(value) is string path && roots.Any(r => path.StartsWith(r, StringComparison.OrdinalIgnoreCase))) folders.Add(word);
            return folders;
        }
        catch { return null; }
    }

    /// When File History last copied files, or null when it never has or Rig can't tell.
    static long? FileHistory(RegistryKey software)
    {
        try
        {
            using var k = software.OpenSubKey(@"Microsoft\Windows\CurrentVersion\FileHistory");
            if (k?.GetValue("ProtectedUpToTime") is long ft && ft > 0) return DateTimeOffset.FromFileTime(ft).ToUnixTimeMilliseconds();
        }
        catch { }
        return null;
    }

    // ----- Self-test -----

    /// The parts that don't need Windows to answer, judged the way safety.ts expects.
    public static IEnumerable<string> SelfChecks()
    {
        // Defender on and up to date, off, and on but out of date.
        if (!StateOn(0x061100) || !StateUpToDate(0x061100)) yield return "an antivirus that's on and up to date read wrong";
        if (StateOn(0x060100)) yield return "an antivirus that's off read as on";
        if (!StateOn(0x061110) || StateUpToDate(0x061110)) yield return "an out of date antivirus read as up to date";
        long? nov = InstalledOn("11/12/2026");
        if (nov == null || DateTimeOffset.FromUnixTimeMilliseconds(nov.Value).ToLocalTime().Day != 12) yield return "an update's install date didn't read";
        if (InstalledOn("20261112") != nov) yield return "an update's install date as yyyyMMdd didn't read";
        if (InstalledOn("") != null || InstalledOn("soon") != null) yield return "an empty install date read as a date";
        if (Days(65535u) != null || Days(9u) != 9) yield return "Defender's ages read wrong";
    }
}
