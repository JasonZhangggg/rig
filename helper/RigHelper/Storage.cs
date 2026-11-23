// What fills each drive, in the shape of Rig's StorageScan (packages/core/src/telemetry.ts).
//
// Sizing folders is slow on a big drive, so it never runs on a request: "storage"
// answers at once with the last scan, and starts a new one on its own thread when
// that's a day old (or when asked). The thread runs in Windows' background mode,
// which lowers its disk priority as well as its processor priority, and the result
// is kept in %ProgramData%\Rig\storage.json so a restart doesn't scan again.

using System.Diagnostics;
using System.IO.Enumeration;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

public static partial class StorageScan
{
    static readonly object gate = new();
    static JsonObject? last;
    static bool loaded;
    static Thread? worker;
    static readonly TimeSpan Stale = TimeSpan.FromHours(24);
    /// One drive gives up after this long; what wasn't sized yet shows as Other.
    static readonly TimeSpan PerVolume = TimeSpan.FromMinutes(5);
    static string CachePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rig", "storage.json");

    /// The last scan, and whether one is running. Starts one when there's none, it's a day old, or `fresh`.
    public static JsonObject Read(bool fresh)
    {
        lock (gate)
        {
            if (!loaded) { loaded = true; last = Load(); }
            long? at = last?["at"] is JsonValue v && v.TryGetValue(out long t) ? t : null;
            bool stale = at is null || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - at > Stale.TotalMilliseconds;
            if ((fresh || stale) && worker == null)
            {
                worker = new Thread(Run) { IsBackground = true, Name = "Rig storage scan", Priority = ThreadPriority.Lowest };
                worker.Start();
            }
            var o = new JsonObject { ["running"] = worker != null, ["volumes"] = last?["volumes"]?.DeepClone() ?? new JsonArray() };
            if (at != null) o["at"] = at;
            return o;
        }
    }

    /// Cheap checks for --selftest: a folder is sized, and the Windows drive files Windows as Windows.
    public static IEnumerable<string> SelfChecks()
    {
        if (FolderSize(AppContext.BaseDirectory, [], Stopwatch.StartNew()) <= 0) yield return "the storage scan sized its own folder as empty";
        string sysRoot = Path.GetPathRoot(Environment.SystemDirectory) ?? @"C:\";
        var items = Items(sysRoot, []);
        if (!items.Any(i => i.Kind == "windows")) yield return $"the storage scan found no Windows folder on {sysRoot}";
        if (!items.Any(i => i.Kind == "apps")) yield return $"the storage scan found no apps on {sysRoot}";
    }

    static JsonObject? Load()
    {
        try { return JsonNode.Parse(File.ReadAllText(CachePath)) as JsonObject; } catch { return null; }
    }

    static void Run()
    {
        JsonObject? result = null;
        try
        {
            // Background mode: Windows serves this thread's disk reads after everyone else's.
            SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN);
            result = Scan();
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(CachePath)!);
                File.WriteAllText(CachePath, result.ToJsonString());
            }
            catch { /* without admin rights ProgramData may be read-only: keep it in memory */ }
        }
        catch { }
        finally
        {
            SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_END);
            lock (gate)
            {
                if (result != null) last = result;
                worker = null;
            }
        }
    }

    record Item(string Kind, string Name, string Path);

    static JsonObject Scan()
    {
        var games = GameFolders();
        var skip = new HashSet<string>(games.Select(g => g.Path), StringComparer.OrdinalIgnoreCase);
        var volumes = new JsonArray();
        foreach (var d in DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady))
        {
            string root = d.RootDirectory.FullName;
            var items = Items(root, games.Where(g => g.Path.StartsWith(root, StringComparison.OrdinalIgnoreCase)));
            var clock = Stopwatch.StartNew();
            var sized = new List<(Item item, long bytes)>();
            foreach (var it in items)
            {
                if (clock.Elapsed > PerVolume) break;
                // A game's own folder found again as an ordinary folder (a game installed at the top of a drive) is counted once, as the game.
                if (it.Kind != "games" && skip.Contains(it.Path)) continue;
                long b = it.Kind == "system" ? FileSize(it.Path) : FolderSize(it.Path, skip, clock);
                if (b > 0) sized.Add((it, b));
            }
            var fills = new JsonArray();
            foreach (var kind in sized.GroupBy(x => x.item.Kind))
            {
                var top = kind.GroupBy(x => x.item.Name, StringComparer.OrdinalIgnoreCase)
                    .Select(g => (name: g.First().item.Name, bytes: g.Sum(x => x.bytes)))
                    .OrderByDescending(x => x.bytes).Take(5)
                    .Select(x => (JsonNode)new JsonObject { ["name"] = x.name, ["gb"] = Gb(x.bytes) });
                fills.Add(new JsonObject { ["kind"] = kind.Key, ["gb"] = Gb(kind.Sum(x => x.bytes)), ["top"] = new JsonArray(top.ToArray()) });
            }
            volumes.Add(new JsonObject { ["letter"] = root.TrimEnd('\\'), ["fills"] = fills });
        }
        return new JsonObject { ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["volumes"] = volumes };
    }

    // Gigabytes as Windows counts them (1024³ bytes), like the volumes' sizes.
    static double Gb(long bytes) => Math.Round(bytes / (1024.0 * 1024 * 1024), 1);

    static readonly HashSet<string> SystemRoot = new(StringComparer.OrdinalIgnoreCase)
    {
        "$Recycle.Bin", "System Volume Information", "Recovery", "Boot", "Config.Msi", "Documents and Settings", "PerfLogs", "$WinREAgent", "$SysReset", "$Windows.~BT", "$Windows.~WS", "OneDriveTemp", "MSOCache",
    };
    static readonly HashSet<string> VendorRoot = new(StringComparer.OrdinalIgnoreCase) { "Intel", "AMD", "NVIDIA", "Drivers", "inetpub", "ESD" };
    /// Launchers' folders at the top of a drive. The games in them are sized one by one; what's left (Steam's workshop and caches) is still games.
    static readonly Dictionary<string, string> GameRoot = new(StringComparer.OrdinalIgnoreCase) { ["SteamLibrary"] = "Steam library extras", ["XboxGames"] = "Xbox app extras", ["Epic Games"] = "Epic Games extras", ["Riot Games"] = "Riot Games" };
    static readonly string[] AppRoots = ["Program Files", "Program Files (x86)", "ProgramData"];
    static readonly (string file, string name)[] SystemFiles = [("pagefile.sys", "Page file"), ("hiberfil.sys", "Hibernation file"), ("swapfile.sys", "Swap file")];

    /// What to size on one drive, each filed under a kind: Windows, its apps, the games, people's own files and Windows' page and sleep files.
    static List<Item> Items(string root, IEnumerable<Item> games)
    {
        var list = new List<Item>(games);
        string sysRoot = Path.GetPathRoot(Environment.SystemDirectory) ?? @"C:\";
        bool system = string.Equals(sysRoot, root, StringComparison.OrdinalIgnoreCase);
        foreach (var (file, name) in SystemFiles) list.Add(new("system", name, Path.Combine(root, file)));
        foreach (var dir in Children(root))
        {
            string name = Path.GetFileName(dir);
            if (SystemRoot.Contains(name) || name.StartsWith('$')) continue;
            if (name.Equals("Windows", StringComparison.OrdinalIgnoreCase)) list.Add(new(system ? "windows" : "files", name, dir));
            else if (name.Equals("Windows.old", StringComparison.OrdinalIgnoreCase)) list.Add(new("windows", "Previous Windows", dir));
            else if (AppRoots.Contains(name, StringComparer.OrdinalIgnoreCase)) list.AddRange(Children(dir).Select(c => new Item("apps", Path.GetFileName(c), c)));
            else if (name.Equals("Users", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var profile in Children(dir))
                    foreach (var c in Children(profile))
                    {
                        string n = Path.GetFileName(c);
                        // Apps keep their data in AppData; it's filed with the apps, without the account's name.
                        list.Add(n.Equals("AppData", StringComparison.OrdinalIgnoreCase) ? new("apps", "App data in user folders", c) : new("files", n, c));
                    }
            }
            else if (VendorRoot.Contains(name)) list.Add(new("apps", name, dir));
            else if (GameRoot.TryGetValue(name, out var extras)) list.Add(new("games", extras, dir));
            else list.Add(new("files", name, dir));
        }
        return list;
    }

    static IEnumerable<string> Children(string dir)
    {
        try
        {
            var opts = new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint, ReturnSpecialDirectories = false };
            return Directory.EnumerateDirectories(dir, "*", opts).ToList();
        }
        catch { return []; }
    }

    static long FileSize(string path)
    {
        try
        {
            // Read from the folder listing: Windows keeps these files open, so they can't be opened to ask.
            string dir = Path.GetDirectoryName(path)!, name = Path.GetFileName(path);
            var opts = new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = 0 };
            return new DirectoryInfo(dir).EnumerateFiles(name, opts).FirstOrDefault()?.Length ?? 0;
        }
        catch { return 0; }
    }

    // Files that live in the cloud (OneDrive's online-only files) take no space here.
    const FileAttributes InCloud = FileAttributes.Offline | (FileAttributes)0x00040000 /* RECALL_ON_OPEN */ | (FileAttributes)0x00400000 /* RECALL_ON_DATA_ACCESS */;

    /// Bytes in a folder and everything under it. Doesn't follow links or enter the game folders (they're sized on their own).
    static long FolderSize(string dir, HashSet<string> skip, Stopwatch clock)
    {
        if (!Directory.Exists(dir)) return 0;
        long sum = 0;
        try
        {
            // AttributesToSkip has to be cleared: by default hidden and system files, AppData among them, are left out.
            var opts = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = 0, ReturnSpecialDirectories = false };
            var files = new FileSystemEnumerable<long>(dir, (ref FileSystemEntry e) => e.Length, opts)
            {
                ShouldIncludePredicate = (ref FileSystemEntry e) => !e.IsDirectory && (e.Attributes & InCloud) == 0,
                ShouldRecursePredicate = (ref FileSystemEntry e) => (e.Attributes & FileAttributes.ReparsePoint) == 0 && (skip.Count == 0 || !skip.Contains(e.ToFullPath())),
            };
            foreach (long n in files)
            {
                sum += n;
                if (clock.Elapsed > PerVolume) break;
            }
        }
        catch { }
        return sum;
    }

    /// Each installed game's folder, from the launchers' own lists: Steam, Epic, GOG, and the Xbox app's folder on each drive.
    static List<Item> GameFolders()
    {
        var found = new Dictionary<string, Item>(StringComparer.OrdinalIgnoreCase);
        void Add(string? path, string? name)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            try { path = Path.GetFullPath(path).TrimEnd('\\'); } catch { return; }
            if (!Directory.Exists(path) || found.ContainsKey(path)) return;
            found[path] = new("games", string.IsNullOrWhiteSpace(name) ? Path.GetFileName(path) : name.Trim(), path);
        }

        foreach (var lib in SteamLibraries())
            foreach (var g in Children(Path.Combine(lib, "steamapps", "common"))) Add(g, null);

        try
        {
            string manifests = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Epic\EpicGamesLauncher\Data\Manifests");
            if (Directory.Exists(manifests))
                foreach (var f in Directory.EnumerateFiles(manifests, "*.item"))
                {
                    try
                    {
                        var j = JsonNode.Parse(File.ReadAllText(f));
                        Add(j?["InstallLocation"]?.GetValue<string>(), j?["DisplayName"]?.GetValue<string>());
                    }
                    catch { }
                }
        }
        catch { }

        try
        {
            using var gog = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\GOG.com\Games");
            foreach (var id in gog?.GetSubKeyNames() ?? [])
            {
                using var k = gog!.OpenSubKey(id);
                Add(k?.GetValue("path") as string, k?.GetValue("gameName") as string);
            }
        }
        catch { }

        foreach (var d in DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady))
            foreach (var g in Children(Path.Combine(d.RootDirectory.FullName, "XboxGames"))) Add(g, null);

        // A folder inside another game's folder is part of that game.
        var all = found.Values.ToList();
        return all.Where(g => !all.Any(o => o != g && g.Path.StartsWith(o.Path + "\\", StringComparison.OrdinalIgnoreCase))).ToList();
    }

    [GeneratedRegex("\"path\"\\s+\"([^\"]+)\"", RegexOptions.IgnoreCase)]
    private static partial Regex SteamPath();

    /// Steam's install folder and every library it lists in libraryfolders.vdf.
    static List<string> SteamLibraries()
    {
        var libs = new List<string>();
        string? steam = null;
        try { using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam"); steam = k?.GetValue("InstallPath") as string; } catch { }
        try { if (steam == null) { using var k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"); steam = (k?.GetValue("SteamPath") as string)?.Replace('/', '\\'); } } catch { }
        if (steam == null) return libs;
        libs.Add(steam);
        try
        {
            string vdf = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
            if (File.Exists(vdf))
                foreach (Match m in SteamPath().Matches(File.ReadAllText(vdf))) libs.Add(m.Groups[1].Value.Replace(@"\\", @"\"));
        }
        catch { }
        return libs.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    const int THREAD_MODE_BACKGROUND_BEGIN = 0x00010000, THREAD_MODE_BACKGROUND_END = 0x00020000;
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentThread();
    [DllImport("kernel32.dll")] static extern bool SetThreadPriority(IntPtr thread, int priority);
}
