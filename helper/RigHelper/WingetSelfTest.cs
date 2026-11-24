// winget's part of --selftest: where the helper finds winget on this runner,
// which steps may leave what an installer changes, and what an apply does with
// those never-list places. It installs nothing: the change is `winget
// --version`, what an installer would do is written beside it with
// TestOnlyExtra, and TestOnlyExpects stands in for an install's rule. The
// grammar's vectors run with every other shared vector. Its own store, so its
// tier 2 changes don't count against the other checks.

using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace Rig.Helper;

public static partial class CommandSelfTest
{
    const string ProxyKey = @"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    static void Winget(Action<string, Func<IEnumerable<string>>> check, Context ctx)
    {
        string? found = Rig.Helper.Winget.Find(ctx.Person);
        check("winget's path", () => WingetPath(ctx, found));
        check("winget's alias keeps a path with curly quotes in it", () => QuotedPath(ctx));
        check("only an install, update or uninstall may leave what an installer changes", () => Waived(ctx));
        check("an installer's Run value is listed, not put back", () => found == null ? [NoWinget] : Expected(ctx));
        check("a step that only names winget has its Run value put back", () => found == null ? [NoWinget] : NamesOnly(ctx));
        check("a hard hit after an install runs its undo and rolls back", () => found == null ? [NoWinget] : HardHit(ctx));
        check("a failed install is uninstalled and rolled back", () => found == null ? [NoWinget] : FailedInstall(ctx));
        check("an install that stopped because the app was there isn't uninstalled", () => found == null ? [NoWinget] : AlreadyThere(ctx));
        check("a failed install with no undo leaves what its installer changed and says so", () => found == null ? [NoWinget] : NoWayBack(ctx));
    }

    static readonly HashSet<string> Installer = ["services", "run", "scheduledTasks"];
    const string Installed = $"New-Item -Path '{UserPath}' -Force | Out-Null; Set-ItemProperty -Path '{UserPath}' -Name Installed -Value 1";
    const string RunValue = @"$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }; Set-ItemProperty -LiteralPath $k -Name RigSelftest -Value 'rig-selftest'";
    const string ProxyHit = @"Set-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name ProxyServer -Value 'rig-selftest:8080'";
    /// A read that shows whether the stand-in installer ran, as `winget list` shows whether an app is there.
    const string ReadInstalled = $"Get-ItemProperty -Path '{UserPath}' -Name Installed -ErrorAction SilentlyContinue";

    static IEnumerable<string> Waived(Context ctx)
    {
        var app = new Touch("other", "The app Foo.Bar", null);
        const string list = "winget list --id 'Foo.Bar' --exact --source winget --accept-source-agreements", install = "winget install --exact --source winget --id 'Foo.Bar' --silent --accept-source-agreements";
        const string uninstall = "winget uninstall --exact --source winget --id 'Foo.Bar' --silent --accept-source-agreements", mark = $"Set-ItemProperty -Path '{UserPath}' -Name A -Value 1";
        (HashSet<string> Run, HashSet<string> Undo, bool Installs)? Of(string run, string undo, Touch touch)
        {
            var v = ctx.Rig.Check(new Command("Changes an app.", "winget list --id 'Foo.Bar' --exact --source winget", run, undo, [touch])).Verdict;
            return v.Allowed ? (RunRules.Expects(v.Commands, "run"), RunRules.Expects(v.Commands, "undo"), RunRules.Installs(v.Commands)) : null;
        }
        var key = new Touch("registry", UserKey, null);
        if (Of($"{list}\n{install}", uninstall, app) is not var (run, undo, installs)) yield return "an install was refused";
        else
        {
            if (!run.SetEquals(Installer) || !installs) yield return $"an install may leave {string.Join(", ", run)}";
            if (!undo.SetEquals(Installer)) yield return $"its uninstall undo may leave {string.Join(", ", undo)}";
        }
        if (Of($"winget --version\n{mark}", mark, key) is not var (named, _, namedInstalls)) yield return "winget --version beside a registry change was refused";
        else if (named.Count > 0 || namedInstalls) yield return $"a step that only names winget may leave {string.Join(", ", named)}";
        if (Of($"{install}\n{mark}", uninstall, key) is not var (mixed, _, mixedInstalls)) yield return "an install beside a registry change was refused";
        else if (mixed.Count > 0 || !mixedInstalls) yield return $"an install beside another change may leave {string.Join(", ", mixed)}";
    }

    const string NoWinget = Skip + "winget isn't on this runner";

    /// A change that runs winget and nothing else, with an undo that leaves a mark, as an install's would uninstall.
    static JsonObject WingetStep(string read = "winget --version", bool undo = true)
    {
        var step = new JsonObject
        {
            ["does"] = "Runs winget.",
            ["read"] = read,
            ["run"] = "winget --version",
            ["touches"] = new JsonArray(new JsonObject { ["kind"] = "other", ["name"] = "The app Rig.Selftest" }),
        };
        if (undo) step["undo"] = $"winget --version\nNew-Item -Path '{UserPath}' -Force | Out-Null\nSet-ItemProperty -Path '{UserPath}' -Name Undone -Value 1";
        return step;
    }

    static IEnumerable<string> WingetPath(Context ctx, string? found)
    {
        if (found == null) { yield return NoWinget; yield break; }
        if (!File.Exists(found)) yield return $"it found {found}, which isn't there";
        var r = ctx.Call("command.read", new JsonObject { ["script"] = "winget --version" });
        if (r["printed"]?.ToString().TrimStart().StartsWith('v') != true) yield return $"winget --version as a read didn't print a version: {r.ToJsonString()}";
    }

    static IEnumerable<string> QuotedPath(Context ctx)
    {
        const string path = "C:\\Users\\Rig O\u2019Brien\\Rig\u2018s 'x'\\winget.exe";
        string file = Path.Combine(Directory.CreateDirectory(ctx.Store.Work).FullName, "rig-alias.ps1");
        try
        {
            PowerShellHost.Write(file, "(Get-Alias -Name winget).Definition", stopOnError: true, path);
            var ran = PowerShellHost.RunHere(PowerShellHost.Args(file), 60_000, ctx.Store.Empty(), ctx.Store.Work);
            if (ran.Out.Trim() != path) yield return $"the alias is {ran.Printed}";
        }
        finally { try { File.Delete(file); } catch { } }
    }

    static JsonNode ApplyWith(Context ctx, string extra, out JsonNode preview, JsonObject? step = null, bool installer = true)
    {
        preview = ctx.Preview(step ?? WingetStep());
        if (!Is(preview, "ready")) return preview;
        ctx.Rig.TestOnlyExtra = extra;
        ctx.Rig.TestOnlyExpects = installer ? Installer : null;
        try { return ctx.Apply(preview); }
        finally { ctx.Rig.TestOnlyExtra = null; ctx.Rig.TestOnlyExpects = null; }
    }

    static IEnumerable<string> Expected(Context ctx)
    {
        Clean(ctx.Person);
        try
        {
            var a = ApplyWith(ctx, RunValue, out var p);
            if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
            if (!Is(a, "applied")) { yield return $"it wasn't applied: {a.ToJsonString()}"; yield break; }
            if (a["result"]?["alsoChanged"] is not JsonArray also || !also.Any(x => x?.ToString().Contains("the apps that start with Windows") == true && x.ToString().Contains("rig-selftest")))
                yield return $"the Run value wasn't listed as what the installer also changed: {a["result"]?["alsoChanged"]?.ToJsonString()}";
            if (Value(ctx.Person, RunKey, "RigSelftest") as string != "rig-selftest") yield return "the Run value was put back";
            if (Exists(ctx.Person, Key)) yield return "the undo ran";
            var u = ctx.Undo(a);
            if (!Is(u, "undone")) yield return $"it wasn't undone: {u.ToJsonString()}";
            if (Value(ctx.Person, Key, "Undone") is null) yield return "the undo didn't run";
        }
        finally { Clean(ctx.Person); }
    }

    static IEnumerable<string> NamesOnly(Context ctx)
    {
        Clean(ctx.Person);
        try
        {
            var a = ApplyWith(ctx, RunValue, out var p, installer: false);
            if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
            if (!Is(a, "rolledBack")) yield return $"it wasn't rolled back: {a.ToJsonString()}";
            if (Value(ctx.Person, RunKey, "RigSelftest") != null) yield return "the Run value wasn't put back";
            if (Exists(ctx.Person, Key)) yield return "the undo ran";
        }
        finally { Clean(ctx.Person); }
    }

    static IEnumerable<string> FailedInstall(Context ctx)
    {
        Clean(ctx.Person);
        try
        {
            var a = ApplyWith(ctx, $"{Installed}; {RunValue}; throw 'rig-selftest: the installer failed'", out var p, WingetStep(ReadInstalled));
            if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
            if (!Is(a, "rolledBack") || a["error"] == null) yield return $"it wasn't rolled back as failed: {a.ToJsonString()}";
            if (Value(ctx.Person, Key, "Undone") is null) yield return "the step's undo didn't run";
            if (Value(ctx.Person, RunKey, "RigSelftest") != null) yield return "the installer's Run value wasn't put back after the undo";
        }
        finally { Clean(ctx.Person); }
    }

    static IEnumerable<string> AlreadyThere(Context ctx)
    {
        Clean(ctx.Person);
        object? was = Value(ctx.Person, ProxyKey, "ProxyServer");
        try
        {
            var a = ApplyWith(ctx, $"{ProxyHit}; throw 'rig-selftest: the app is already installed'", out var p, WingetStep(ReadInstalled));
            if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
            if (!Is(a, "rolledBack")) yield return $"it wasn't rolled back: {a.ToJsonString()}";
            if (Exists(ctx.Person, Key)) yield return "the undo ran, which would uninstall the app the person already had";
            if (!Equals(Value(ctx.Person, ProxyKey, "ProxyServer"), was)) yield return $"the proxy wasn't put back: {Value(ctx.Person, ProxyKey, "ProxyServer")}";
        }
        finally { PutProxyBack(ctx, was); Clean(ctx.Person); }
    }

    static IEnumerable<string> NoWayBack(Context ctx)
    {
        Clean(ctx.Person);
        try
        {
            var a = ApplyWith(ctx, $"{Installed}; {RunValue}; throw 'rig-selftest: the installer failed'", out var p, WingetStep(ReadInstalled, undo: false));
            if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
            if (!Is(a, "rolledBack")) { yield return $"it wasn't rolled back: {a.ToJsonString()}"; yield break; }
            if (Value(ctx.Person, RunKey, "RigSelftest") as string != "rig-selftest") yield return "the installer's Run value was taken out while the app may still be there";
            var left = a["left"] as JsonArray ?? [];
            if (!left.Any(l => l?.ToString().Contains("the apps that start with Windows") == true)) yield return $"the Run value wasn't listed: {left.ToJsonString()}";
            if (!left.Any(l => l?.ToString().Contains("partly installed") == true)) yield return $"it didn't say the app may be partly installed: {left.ToJsonString()}";
        }
        finally { Clean(ctx.Person); }
    }

    static void PutProxyBack(Context ctx, object? was)
    {
        using var hive = Hive(ctx.Person, ProxyKey, out string path);
        using var k = hive.OpenSubKey(path, writable: true);
        if (k == null || k.GetValue("ProxyServer") as string != "rig-selftest:8080") return;
        if (was == null) k.DeleteValue("ProxyServer", throwOnMissingValue: false);
        else k.SetValue("ProxyServer", was);
    }

    static IEnumerable<string> HardHit(Context ctx)
    {
        Clean(ctx.Person);
        object? was = Value(ctx.Person, ProxyKey, "ProxyServer");
        try
        {
            var a = ApplyWith(ctx, $"{Installed}; {ProxyHit}", out var p, WingetStep(ReadInstalled));
            if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
            if (!Is(a, "rolledBack") || a["sentinels"] is not JsonArray hit || !hit.Any(h => h?["sentinel"]?.ToString() == "proxy"))
                yield return $"the proxy change wasn't a hit that rolled it back: {a.ToJsonString()}";
            if (Value(ctx.Person, Key, "Undone") is null) yield return "the step's undo didn't run before the rollback";
            if (!Equals(Value(ctx.Person, ProxyKey, "ProxyServer"), was)) yield return $"the proxy wasn't put back: {Value(ctx.Person, ProxyKey, "ProxyServer")}";
        }
        finally { PutProxyBack(ctx, was); Clean(ctx.Person); }
    }
}
