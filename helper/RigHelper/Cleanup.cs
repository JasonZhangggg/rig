// How much the usual safe-to-clear places hold, in the shape of Rig's CleanupSizes (packages/core/src/freeSpace.ts).
//
// Only reads: it sizes folders and counts files, and never opens, moves or deletes one. It answers within a few
// seconds, however big the folders are: each place stops when the time is up and says it's partial. A place it
// can't read is left out, so the call never throws. Old downloads are a size and a count, never file names.
// The person's own places (their temp folder, Recycle Bin, Downloads, picture previews) are those of the account
// the Rig app runs as, which isn't this process's own when someone else typed the admin password.

using System.Diagnostics;
using System.IO.Enumeration;
using System.Security.Principal;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

public static partial class Cleanup
{
    /// The whole read stops after this long, well inside the app's wait for an answer.
    static readonly TimeSpan Budget = TimeSpan.FromSeconds(8);
    /// A download counts as old after this long.
    const int OldDays = 90;
    const string DownloadsFolder = "{374DE290-123F-4565-9164-39C4925E467B}";
    // Files that live in the cloud (OneDrive's online-only files) take no space here.
    const FileAttributes InCloud = FileAttributes.Offline | (FileAttributes)0x00040000 /* RECALL_ON_OPEN */ | (FileAttributes)0x00400000 /* RECALL_ON_DATA_ACCESS */;

    [GeneratedRegex(@"^S-1-5-21-\d+-\d+-\d+-\d+$")]
    private static partial Regex Sid();

    record struct Sized(long Bytes, long Files, bool Partial);

    /// Every place's size now. `owner` is the SID of the account the Rig app runs as, when the helper knows it.
    public static JsonObject Sizes(string? owner)
    {
        var clock = Stopwatch.StartNew();
        var spots = new JsonArray();
        string? sid = PersonSid(owner);
        string? profile = Profile(sid);
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string sysDrive = (Path.GetPathRoot(windows) ?? @"C:\").TrimEnd('\\').ToUpperInvariant();

        void Add(string kind, string drive, Sized s, bool counted = false)
        {
            if (s.Bytes <= 0) return;
            var o = new JsonObject { ["kind"] = kind, ["gb"] = Gb(s.Bytes), ["drive"] = drive };
            if (counted) o["files"] = s.Files;
            if (s.Partial) o["partial"] = true;
            spots.Add(o);
        }
        Sized Sum(params Sized[] all) => new(all.Sum(x => x.Bytes), all.Sum(x => x.Files), all.Any(x => x.Partial));
        string DriveOf(string path) => (Path.GetPathRoot(path) ?? sysDrive).TrimEnd('\\').ToUpperInvariant();

        Try(() => Add("windowsOld", sysDrive, Folder(Path.Combine(sysDrive + "\\", "Windows.old"), clock)));
        Try(() => Add("windowsTemp", sysDrive, Folder(Path.Combine(windows, "Temp"), clock)));
        if (profile != null) Try(() => { string t = Path.Combine(profile, "AppData", "Local", "Temp"); Add("userTemp", DriveOf(t), Folder(t, clock)); });
        Try(() => Add("updateCache", sysDrive, Folder(Path.Combine(windows, "SoftwareDistribution", "Download"), clock)));
        Try(() => Add("deliveryOptimization", sysDrive, Folder(Path.Combine(windows, @"ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache"), clock)));
        Try(() =>
        {
            var dumps = new List<Sized> { Folder(Path.Combine(windows, "Minidump"), clock), Folder(Path.Combine(windows, "LiveKernelReports"), clock), One(Path.Combine(windows, "MEMORY.DMP")) };
            if (profile != null) dumps.Add(Folder(Path.Combine(profile, "AppData", "Local", "CrashDumps"), clock));
            Add("crashDumps", sysDrive, Sum([.. dumps]));
        });
        if (profile != null)
        {
            Try(() =>
            {
                string explorer = Path.Combine(profile, "AppData", "Local", "Microsoft", "Windows", "Explorer");
                Add("thumbnails", DriveOf(explorer), Sum(Files(explorer, "thumbcache_*.db"), Files(explorer, "iconcache_*.db")));
            });
        }
        if (sid != null)
        {
            foreach (var d in Fixed())
                Try(() => Add("recycleBin", d.TrimEnd('\\').ToUpperInvariant(), Folder(Path.Combine(d, "$Recycle.Bin", sid), clock)));
        }
        if (profile != null)
        {
            Try(() =>
            {
                string? dl = Downloads(sid, profile);
                if (dl != null) Add("oldDownloads", DriveOf(dl), Folder(dl, clock, DateTime.UtcNow.AddDays(-OldDays)), counted: true);
            });
        }

        var o = new JsonObject { ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["spots"] = spots };
        bool? sense = null;
        Try(() => sense = StorageSenseOn(sid));
        o["storageSense"] = sense is bool b ? JsonValue.Create(b) : null;
        return o;
    }

    /// A cheap check for --selftest: the read answers in time, and every spot it lists has a known kind and a size.
    public static IEnumerable<string> SelfChecks()
    {
        var clock = Stopwatch.StartNew();
        var o = Sizes(null);
        if (clock.Elapsed > Budget + TimeSpan.FromSeconds(4)) yield return $"cleanup.sizes took {clock.Elapsed.TotalSeconds:0} s";
        if (o["spots"] is not JsonArray spots) { yield return "cleanup.sizes answered without spots"; yield break; }
        string[] kinds = ["recycleBin", "userTemp", "windowsTemp", "updateCache", "deliveryOptimization", "windowsOld", "thumbnails", "crashDumps", "oldDownloads"];
        foreach (var s in spots)
        {
            if (s?["kind"]?.GetValue<string>() is not string k || !kinds.Contains(k)) yield return "cleanup.sizes listed a place Rig doesn't know";
            if (s?["gb"] is not JsonValue) yield return "cleanup.sizes listed a place without a size";
            if (s?["name"] != null || s?["path"] != null) yield return "cleanup.sizes named a file or folder";
        }
    }

    static void Try(Action a) { try { a(); } catch { /* a place Rig can't read is left out */ } }

    static double Gb(long bytes) => Math.Round(bytes / (1024.0 * 1024 * 1024), 2);

    static IEnumerable<string> Fixed()
    {
        try { return DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady).Select(d => d.RootDirectory.FullName).ToList(); }
        catch { return []; }
    }

    /// The person's SID: the Rig app's account when the helper knows it, else this process's own.
    static string? PersonSid(string? owner)
    {
        if (owner != null && Sid().IsMatch(owner)) return owner;
        try { var me = WindowsIdentity.GetCurrent().User?.Value; return me != null && Sid().IsMatch(me) ? me : null; } catch { return null; }
    }

    static string? Profile(string? sid)
    {
        if (sid == null) return null;
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey($@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\{sid}", writable: false);
            if (k?.GetValue("ProfileImagePath") is not string p || p.Length == 0) return null;
            string full = Environment.ExpandEnvironmentVariables(p);
            return Path.IsPathFullyQualified(full) && Directory.Exists(full) ? full : null;
        }
        catch { return null; }
    }

    /// The person's Downloads folder, wherever they moved it, read from their own hive; their profile's Downloads otherwise.
    static string? Downloads(string? sid, string profile)
    {
        string fallback = Path.Combine(profile, "Downloads");
        if (sid == null) return Directory.Exists(fallback) ? fallback : null;
        try
        {
            using var k = Registry.Users.OpenSubKey($@"{sid}\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders", writable: false);
            if (k?.GetValue(DownloadsFolder, null, RegistryValueOptions.DoNotExpandEnvironmentNames) is string raw && raw.Length > 0)
            {
                // Only the person's own profile is filled in: this process's other variables are another account's.
                string p = Regex.Replace(raw, "%USERPROFILE%", profile.Replace("$", "$$"), RegexOptions.IgnoreCase);
                if (!p.Contains('%') && Path.IsPathFullyQualified(p) && !p.StartsWith(@"\\") && Directory.Exists(p)) return p;
            }
        }
        catch { }
        return Directory.Exists(fallback) ? fallback : null;
    }

    /// Whether Storage Sense is on in the person's own settings. Null when their hive can't be read.
    static bool? StorageSenseOn(string? sid)
    {
        if (sid == null) return null;
        using var user = Registry.Users.OpenSubKey(sid, writable: false);
        if (user == null) return null;
        using var k = user.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy", writable: false);
        return k?.GetValue("01") is int v && v == 1;
    }

    static Sized One(string path)
    {
        try
        {
            string dir = Path.GetDirectoryName(path)!, name = Path.GetFileName(path);
            var opts = new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = 0 };
            var f = new DirectoryInfo(dir).EnumerateFiles(name, opts).FirstOrDefault();
            return f == null ? default : new(f.Length, 1, false);
        }
        catch { return default; }
    }

    /// Files matching a pattern directly in one folder.
    static Sized Files(string dir, string pattern)
    {
        if (!Directory.Exists(dir)) return default;
        try
        {
            var opts = new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = 0, MatchType = MatchType.Win32 };
            long bytes = 0, n = 0;
            foreach (var f in new DirectoryInfo(dir).EnumerateFiles(pattern, opts)) { bytes += f.Length; n++; }
            return new(bytes, n, false);
        }
        catch { return default; }
    }

    /// Bytes and files in a folder and everything under it, without following links; with `olderThan`, only files from before then.
    static Sized Folder(string dir, Stopwatch clock, DateTime? olderThan = null)
    {
        if (!Directory.Exists(dir) || clock.Elapsed > Budget) return default;
        long bytes = 0, n = 0;
        bool partial = false;
        try
        {
            var opts = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = 0, ReturnSpecialDirectories = false };
            DateTimeOffset cut = olderThan ?? DateTime.MaxValue;
            var files = new FileSystemEnumerable<long>(dir, (ref FileSystemEntry e) => e.Length, opts)
            {
                ShouldIncludePredicate = (ref FileSystemEntry e) => !e.IsDirectory && (e.Attributes & InCloud) == 0
                    && (olderThan == null || (e.CreationTimeUtc < cut && e.LastWriteTimeUtc < cut)),
                ShouldRecursePredicate = (ref FileSystemEntry e) => (e.Attributes & FileAttributes.ReparsePoint) == 0,
            };
            foreach (long len in files)
            {
                bytes += len;
                n++;
                if (clock.Elapsed > Budget) { partial = true; break; }
            }
        }
        catch { partial = bytes > 0; }
        return new(bytes, n, partial);
    }
}
