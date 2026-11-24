// What the rules say about how long a program may run and as whom (an entry's
// `person` and `minutes` in commands.json), what an installer may change (a
// rule's `expects`), and where winget is.
//
// winget is an app execution alias in the person's own
// %LOCALAPPDATA%\Microsoft\WindowsApps, which isn't on the clean PATH a script
// gets, so the helper finds it itself: that alias, or App Installer's own copy
// under Program Files\WindowsApps. A script that uses winget gets an alias of
// Rig's own for that one path, ahead of everything the script says, so the
// model never names where it is.

using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public static class RunRules
{
    sealed record Row(bool Person, int Minutes);

    static readonly Dictionary<string, Row> Rows = Load();

    static Dictionary<string, Row> Load()
    {
        var rows = new Dictionary<string, Row>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in JsonNode.Parse(CommandCheck.Resource("Rig.Rules.commands.json"))!["commands"]!.AsArray())
        {
            if (e is not JsonObject o || (o["person"] == null && o["minutes"] == null)) continue;
            rows[o["name"]!.ToString()] = new Row(o["person"]?.GetValue<bool>() == true, (int)Json.Num(o["minutes"], 0));
        }
        return rows;
    }

    static IEnumerable<Row> Of(IEnumerable<FoundCommand> found, string? script) =>
        found.Where(c => script == null || c.Script == script).Select(c => Rows.GetValueOrDefault(c.Name)).OfType<Row>();

    /// Whether a step uses a program that runs only as the person, never with admin rights.
    public static bool AsPerson(IEnumerable<FoundCommand> found) => Of(found, null).Any(r => r.Person);

    /// How long a script may run: the longest its programs' rows allow, or `fallback`.
    public static int TimeoutMs(IEnumerable<FoundCommand> found, string script, int fallback) => Of(found, script).Select(r => r.Minutes * 60_000).Append(fallback).Max();

    /// The never-list places a script is expected to change, which are listed rather than put back: only when every command
    /// in it that changes something matched a rule with `expects`, so a word that merely names winget waives nothing.
    public static HashSet<string> Expects(IEnumerable<FoundCommand> found, string script)
    {
        var changing = found.Where(c => c.Script == script && c.Tier > 0).ToList();
        return changing.Count > 0 && changing.All(c => c.Expects != null) ? changing.SelectMany(c => c.Expects!).ToHashSet() : [];
    }

    /// Whether a step's run installs, updates or uninstalls an app: some command in it matched a rule that expects changes.
    public static bool Installs(IEnumerable<FoundCommand> found) => found.Any(c => c.Script == "run" && c.Expects is { Count: > 0 });
}

public static class Winget
{
    public const string Missing = "winget (Windows' App Installer) isn't set up for your Windows account on this PC, so Rig can't install or update apps with it. Get App Installer from the Microsoft Store, then ask again.";
    public const string Elevated = "Rig is running as administrator, and winget runs only as you, so Rig won't run it. Open Rig normally and ask again.";

    public static bool Uses(IEnumerable<FoundCommand> found) => found.Any(c => c.Name.Equals("winget", StringComparison.OrdinalIgnoreCase));

    /// winget for this person: their own App Installer alias, else App Installer's copy in its package folder. Null when neither is there.
    public static string? Find(Person person)
    {
        string alias = Path.Combine(person.LocalAppData(), @"Microsoft\WindowsApps\winget.exe");
        if (person.Do(() => IsAppAlias(alias))) return alias;
        return Packaged();
    }

    const uint IO_REPARSE_TAG_APPEXECLINK = 0x8000001B, FILE_ATTRIBUTE_REPARSE_POINT = 0x400;

    /// An app execution alias Windows made for an installed app, not a program someone put in its place.
    static bool IsAppAlias(string path)
    {
        var h = FindFirstFileW(path, out var data);
        if (h == new IntPtr(-1)) return false;
        FindClose(h);
        return (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 && data.dwReserved0 == IO_REPARSE_TAG_APPEXECLINK;
    }

    static readonly Regex Package = new(@"^Microsoft\.DesktopAppInstaller_(\d+(\.\d+){3})_(x64|arm64)__8wekyb3d8bbwe\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// The newest App Installer package for this PC's processor. Only Windows can write under WindowsApps.
    static string? Packaged()
    {
        string arch = RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "arm64" : "x64";
        try
        {
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WindowsApps");
            return Directory.EnumerateDirectories(root, "Microsoft.DesktopAppInstaller_*")
                .Select(d => (Dir: d, M: Package.Match(Path.GetFileName(d))))
                .Where(x => x.M.Success && x.M.Groups[3].Value.Equals(arch, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => Version.Parse(x.M.Groups[1].Value))
                .Select(x => Path.Combine(x.Dir, "winget.exe")).FirstOrDefault(File.Exists);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WIN32_FIND_DATAW
    {
        public uint dwFileAttributes;
        // Three FILETIMEs, each two 32-bit halves, so nothing is padded.
        public uint ftCreationLow, ftCreationHigh, ftAccessLow, ftAccessHigh, ftWriteLow, ftWriteHigh;
        public uint nFileSizeHigh, nFileSizeLow, dwReserved0, dwReserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string cFileName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string cAlternateFileName;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr FindFirstFileW(string name, out WIN32_FIND_DATAW data);
    [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr h);
}
