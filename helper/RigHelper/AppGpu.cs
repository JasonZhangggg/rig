// The display.appGpu fix (packages/core/src/actions.ts): Windows' graphics preference for one app, as Settings >
// System > Display > Graphics keeps it, in HKCU\Software\Microsoft\DirectX\UserGpuPreferences: one string value per
// program, named by its full path, like "GpuPreference=2;". Other settings in the same string stay where they are.
// It reads what is there first, so the call it returns puts that back, and it reads the change back to check it held.

using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

public sealed class AppGpuStep : IStep
{
    public const string Key = @"Software\Microsoft\DirectX\UserGpuPreferences";
    static readonly Regex AppFile = new(@"^[a-z0-9][a-z0-9 _.()+'&-]{0,99}\.exe$", RegexOptions.IgnoreCase);
    static readonly Regex PrefPart = new(@"^\s*GpuPreference\s*=\s*(\S*)\s*$", RegexOptions.IgnoreCase);
    static readonly string[] Choices = ["none", "auto", "saving", "high"];

    static string App(JsonObject c) { string a = Steps.S(c, "app"); return AppFile.IsMatch(a) ? a : throw new RigException("app must be the program's file name, like game.exe."); }
    static string Gpu(JsonObject c) { string g = Steps.S(c, "gpu"); return Choices.Contains(g) ? g : throw new RigException("gpu must be auto, saving or high."); }

    /// A full path Rig accepts for the app: on a local drive, ending in the app's own file name, with no wildcards or steps up a folder.
    public static bool PathOk(string path, string app) =>
        path.Length <= 260 && Regex.IsMatch(path, @"^[A-Za-z]:\\") && path.IndexOfAny(['*', '?', '"', '<', '>', '|', '/']) < 0 && !path.Any(char.IsControl)
        && !path.Split('\\').Any(p => p == ".." || p == ".") && path.EndsWith("\\" + app, StringComparison.OrdinalIgnoreCase);

    /// The program's full path: the one the call carries (an undo), else the running app's own, else the one Windows already keeps a preference for.
    static string PathOf(JsonObject c, string app)
    {
        if (c["path"] is JsonValue v && v.TryGetValue(out string? given))
            return PathOk(given, app) ? given : throw new RigException("path must be the program's full path, ending in its file name.");
        var running = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(app)))
        {
            using (p)
            {
                try { var f = p.MainModule?.FileName; if (f != null && PathOk(f, app)) running.Add(f); }
                catch { /* it closed, or Windows won't say where it runs from */ }
            }
        }
        if (running.Count == 1) return running.First();
        if (running.Count > 1) throw new RigException($"{app} is running from more than one folder. Close all but one, then try again.");
        var kept = Known().Keys.Where(k => PathOk(k, app)).ToList();
        if (kept.Count == 1) return kept[0];
        throw new RigException($"Open {app} first, so Rig can find its program, then try again.");
    }

    /// Every program Windows keeps a graphics setting for, by full path, with the string it stores.
    public static Dictionary<string, string> Known()
    {
        var all = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        using var k = Registry.CurrentUser.OpenSubKey(Key);
        if (k == null) return all;
        foreach (var n in k.GetValueNames()) if (n.Length > 0 && k.GetValue(n) is string s) all[n] = s;
        return all;
    }

    /// The preference in a stored string: auto (0), saving (1), high (2), or none when it has none. One Rig can't put back exactly is refused.
    public static string PrefOf(string? stored)
    {
        foreach (var part in (stored ?? "").Split(';'))
        {
            var m = PrefPart.Match(part);
            if (!m.Success) continue;
            return m.Groups[1].Value switch
            {
                "0" => "auto",
                "1" => "saving",
                "2" => "high",
                _ => throw new RigException("Windows keeps a graphics setting for this app that Rig doesn't know, so Rig left it alone."),
            };
        }
        return "none";
    }

    /// The stored string with the preference set in place (or taken out for none), every other setting kept as it was. Null when nothing is left.
    public static string? WithPref(string? stored, string gpu)
    {
        string? mine = gpu switch { "auto" => "GpuPreference=0", "saving" => "GpuPreference=1", "high" => "GpuPreference=2", _ => null };
        var parts = (stored ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries).Select(p => p.Trim()).Where(p => p.Length > 0).ToList();
        int at = parts.FindIndex(p => PrefPart.IsMatch(p));
        if (at >= 0) { if (mine == null) parts.RemoveAt(at); else parts[at] = mine; }
        else if (mine != null) parts.Insert(0, mine);
        return parts.Count == 0 ? null : string.Join(";", parts) + ";";
    }

    /// Facts: each program's preference by its file name in lower case, for the ones that have one.
    public static Dictionary<string, string> Preferences()
    {
        var prefs = new Dictionary<string, string>();
        foreach (var (path, stored) in Known())
        {
            string name = Path.GetFileName(path).ToLowerInvariant();
            if (!AppFile.IsMatch(name) || prefs.ContainsKey(name)) continue;
            try { var pref = PrefOf(stored); if (pref != "none") prefs[name] = pref; } catch (RigException) { }
        }
        return prefs;
    }

    /// A preference in Windows' own words, as Settings shows it.
    static string Words(string gpu) => gpu switch { "high" => "High performance", "saving" => "Power saving", _ => "Let Windows decide" };

    public JsonNode? Read(JsonObject call) => null;

    public JsonObject Apply(JsonObject c)
    {
        string app = App(c), gpu = Gpu(c), path = PathOf(c, app);
        using var k = Registry.CurrentUser.CreateSubKey(Key, true);
        var stored = k.GetValue(path) as string;
        string was = PrefOf(stored);
        var next = WithPref(stored, gpu);
        if (next == null) k.DeleteValue(path, false);
        else k.SetValue(path, next, RegistryValueKind.String);
        return new JsonObject { ["kind"] = "display.appGpu", ["app"] = app, ["path"] = path, ["gpu"] = was };
    }

    public string? Verify(JsonObject c)
    {
        string app = App(c), gpu = Gpu(c), path = PathOf(c, app);
        using var k = Registry.CurrentUser.OpenSubKey(Key);
        string now = PrefOf(k?.GetValue(path) as string);
        return now == gpu ? null : $"Windows' graphics setting for {app} reads {Words(now)}.";
    }

    /// What the selftest holds the string handling to. Nothing here touches the registry.
    public static IEnumerable<string> SelfChecks()
    {
        if (WithPref("SwapEffectUpgradeEnable=1;", "high") != "GpuPreference=2;SwapEffectUpgradeEnable=1;") yield return "a graphics preference wasn't added beside the app's other settings";
        if (WithPref("GpuPreference=1;VRROptimizeEnable=0;", "high") != "GpuPreference=2;VRROptimizeEnable=0;") yield return "a graphics preference wasn't changed in place";
        if (WithPref("GpuPreference=2;", "none") != null) yield return "taking the only graphics preference away left a value behind";
        if (PrefOf("VRROptimizeEnable=0;GpuPreference=2;") != "high" || PrefOf(null) != "none" || PrefOf("GpuPreference=0;") != "auto") yield return "a graphics preference reads wrong";
        if (!PathOk(@"C:\Games\Baldurs Gate 3\bin\bg3.exe", "bg3.exe")) yield return "a game's path was refused";
        foreach (var bad in new[] { @"C:\Games\..\bg3.exe", "bg3.exe", @"C:\Games\other.exe", @"\\server\share\bg3.exe", @"C:\Games\*\bg3.exe" })
            if (PathOk(bad, "bg3.exe")) yield return $"the path {bad} went through";
    }
}
