// Installs and removes PawnIO, the signed driver LibreHardwareMonitor reads
// processor temperatures and board fans through (https://pawnio.eu). Rig's
// installer bundles PawnIO's official setup and passes it with --pawnio when
// it runs the helper behind the Windows prompt, so one prompt covers both the
// recorder and PawnIO. Rig removes PawnIO only if Rig installed it.

using System.Diagnostics;
using Microsoft.Win32;

namespace Rig.Helper;

public static class PawnIOSetup
{
    const string UninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO";
    const string RigKey = @"SOFTWARE\Rig";
    const string Marker = "PawnIOInstalledByRig";

    static Version? Installed()
    {
        using var k = Registry.LocalMachine.OpenSubKey(UninstallKey);
        return Version.TryParse(k?.GetValue("DisplayVersion") as string, out var v) ? v : null;
    }

    /// Runs the bundled setup when PawnIO is missing or older than it.
    public static void Install(string setup, Action<string> log)
    {
        try
        {
            if (!File.Exists(setup)) { log($"pawnio: no setup at {setup}"); return; }
            var bundled = Version.TryParse(FileVersionInfo.GetVersionInfo(setup).FileVersion, out var b) ? b : null;
            var have = Installed();
            if (have != null && (bundled == null || have >= bundled)) { log($"pawnio: {have} already installed"); return; }
            int code = Run(setup, "-install -silent");
            var now = Installed();
            log($"pawnio: setup {bundled} exited {code}, installed {now?.ToString() ?? "none"}");
            if (have == null && now != null)
            {
                using var k = Registry.LocalMachine.CreateSubKey(RigKey);
                k.SetValue(Marker, "1");
            }
        }
        catch (Exception e) { log($"pawnio: install failed: {e.Message}"); }
    }

    /// Removes PawnIO if Rig installed it. Call only when no other Rig install remains.
    public static void Uninstall(string setup, Action<string> log)
    {
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey(RigKey, writable: true);
            if (k?.GetValue(Marker) as string != "1") { log("pawnio: not installed by Rig, kept"); return; }
            if (!File.Exists(setup)) { log($"pawnio: no setup at {setup}, kept"); return; }
            int code = Run(setup, "-uninstall -silent");
            log($"pawnio: uninstall exited {code}, installed {Installed()?.ToString() ?? "none"}");
            if (Installed() == null)
            {
                k.DeleteValue(Marker, throwOnMissingValue: false);
                if (k.ValueCount == 0 && k.SubKeyCount == 0) Registry.LocalMachine.DeleteSubKey(RigKey, throwOnMissingSubKey: false);
            }
        }
        catch (Exception e) { log($"pawnio: uninstall failed: {e.Message}"); }
    }

    static int Run(string exe, string args)
    {
        using var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true })!;
        if (!p.WaitForExit(TimeSpan.FromMinutes(2))) { try { p.Kill(); } catch { } return -1; }
        return p.ExitCode;
    }
}
