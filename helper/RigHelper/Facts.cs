// The settings Rig can change, read fresh on every request, in the shape of
// Rig's SystemFacts (packages/core/src/telemetry.ts).

using Microsoft.Win32;

namespace Rig.Helper;

public record StartupApp(string Name, string Command, bool Enabled, string Scope);

/// Where a startup app lives, so it can be switched on or off the way Task Manager does.
public record StartupEntry(StartupApp App, RegistryKey Hive, string ApprovedKey, string ValueName);

public static class Facts
{
    public const string Approved = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\";
    const string Run = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string Run32 = @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";

    /// `owner` is the SID of the account the Rig app runs as, for the reads that belong to the person (Security.cs).
    public static object Read(string? owner = null)
    {
        var active = Native.ActiveScheme();
        return new
        {
            powerPlans = Native.Schemes().Select(s => new { guid = s.guid.ToString(), s.name, active = s.guid == active }).ToList(),
            startupApps = StartupEntries().Select(e => e.App).ToList(),
            gameMode = GameMode(),
            visualEffects = VisualEffects(),
            maxProcessorState = MaxProcessorState(),
            powerMode = PowerMode(),
            // Only the apps that have one, by file name: the full paths stay on this PC.
            gpuPreferences = Try(AppGpuStep.Preferences),
            // Updates, virus protection, the firewall and backup: kept a while, and left out until the first read is done.
            security = Security.Read(owner),
        };
    }

    /// Task Manager's on/off flag: first byte even means on. A missing value means on.
    static bool IsOn(RegistryKey hive, string approvedKey, string name)
    {
        using var k = hive.OpenSubKey(Approved + approvedKey);
        return k?.GetValue(name) is not byte[] b || b.Length == 0 || (b[0] & 1) == 0;
    }

    public static List<StartupEntry> StartupEntries()
    {
        var list = new List<StartupEntry>();
        void FromRun(RegistryKey hive, string path, string approved, string scope)
        {
            using var k = hive.OpenSubKey(path);
            if (k == null) return;
            foreach (var n in k.GetValueNames())
            {
                if (n.Length == 0) continue;
                list.Add(new StartupEntry(new StartupApp(n, k.GetValue(n)?.ToString() ?? "", IsOn(hive, approved, n), scope), hive, approved, n));
            }
        }
        void FromFolder(string folder, RegistryKey hive, string scope)
        {
            if (!Directory.Exists(folder)) return;
            foreach (var f in Directory.GetFiles(folder))
            {
                string file = Path.GetFileName(f);
                if (file.Equals("desktop.ini", StringComparison.OrdinalIgnoreCase)) continue;
                list.Add(new StartupEntry(new StartupApp(Path.GetFileNameWithoutExtension(f), f, IsOn(hive, "StartupFolder", file), scope), hive, "StartupFolder", file));
            }
        }
        FromRun(Registry.CurrentUser, Run, "Run", "user");
        FromRun(Registry.LocalMachine, Run, "Run", "machine");
        FromRun(Registry.LocalMachine, Run32, "Run32", "machine");
        FromFolder(Environment.GetFolderPath(Environment.SpecialFolder.Startup), Registry.CurrentUser, "user");
        FromFolder(Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup), Registry.LocalMachine, "machine");
        // One row per name: the first one found is the one Rig changes.
        return list.GroupBy(e => e.App.Name, StringComparer.OrdinalIgnoreCase).Select(g => g.First()).ToList();
    }

    public const string GameBar = @"Software\Microsoft\GameBar";
    public static bool GameMode() => UserValue(GameBar, "AutoGameModeEnabled") is not int v || v != 0;

    /// Reads one value and closes the key again, so reading settings every half minute leaves no open keys behind.
    static object? UserValue(string key, string name)
    {
        using var k = Registry.CurrentUser.OpenSubKey(key);
        return k?.GetValue(name);
    }

    public const string Effects = @"Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects";
    public static string VisualEffects() => (UserValue(Effects, "VisualFXSetting") as int?) switch
    {
        1 => "appearance",
        2 => "performance",
        3 => "custom",
        _ => "auto",
    };

    static T? Try<T>(Func<T> read) where T : class { try { return read(); } catch { return null; } }

    const string PowerSchemes = @"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes";

    /// Windows 11's power mode is an overlay on the plan, kept per power source; no overlay is Balanced.
    static string Mode(object? guid) => (guid as string)?.Trim().Trim('{', '}').ToLowerInvariant() switch
    {
        "961cc777-2547-4f9d-8174-7d86181b8a7a" => "efficiency",
        "ded574b5-45a0-4f42-8737-46345c09c238" => "performance",
        _ => "balanced",
    };

    /// Power mode plugged in and on battery (Settings > System > Power), and whether Battery saver is on now. Null when it can't be read.
    public static object? PowerMode() => Try<object>(() =>
    {
        using var k = Registry.LocalMachine.OpenSubKey(PowerSchemes);
        return new { ac = Mode(k?.GetValue("ActiveOverlayAcPowerScheme")), dc = Mode(k?.GetValue("ActiveOverlayDcPowerScheme")), saver = Native.BatterySaverOn() };
    });

    public static object MaxProcessorState()
    {
        Guid scheme = Native.ActiveScheme(), sub = Native.SUB_PROCESSOR, set = Native.PROCTHROTTLEMAX;
        Native.PowerReadACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint ac);
        Native.PowerReadDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint dc);
        return new { ac = (int)(ac == 0 ? 100 : ac), dc = (int)(dc == 0 ? 100 : dc) };
    }
}
