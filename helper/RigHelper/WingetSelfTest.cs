// winget's part of --selftest: where the helper finds winget on this runner,
// and what an apply does with the never-list places an installer changes. It
// installs nothing: the change is `winget --version`, and what an installer
// would add is written beside it with TestOnlyExtra. The grammar's vectors run
// with every other shared vector. Its own store, so its tier 2 changes don't
// count against the other checks.

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
        check("an installer's Run value is listed, not put back", () => found == null ? [NoWinget] : Expected(ctx));
        check("a hard hit after an install runs its undo and rolls back", () => found == null ? [NoWinget] : HardHit(ctx));
    }

    const string NoWinget = Skip + "winget isn't on this runner";

    /// A change that runs winget and nothing else, with an undo that leaves a mark, as an install's would uninstall.
    static JsonObject WingetStep() => new()
    {
        ["does"] = "Runs winget.",
        ["read"] = "winget --version",
        ["run"] = "winget --version",
        ["undo"] = $"winget --version\nNew-Item -Path '{UserPath}' -Force | Out-Null\nSet-ItemProperty -Path '{UserPath}' -Name Undone -Value 1",
        ["touches"] = new JsonArray(new JsonObject { ["kind"] = "other", ["name"] = "The app Rig.Selftest" }),
    };

    static IEnumerable<string> WingetPath(Context ctx, string? found)
    {
        if (found == null) { yield return NoWinget; yield break; }
        if (!File.Exists(found)) yield return $"it found {found}, which isn't there";
        var r = ctx.Call("command.read", new JsonObject { ["script"] = "winget --version" });
        if (r["printed"]?.ToString().TrimStart().StartsWith('v') != true) yield return $"winget --version as a read didn't print a version: {r.ToJsonString()}";
    }

    static JsonNode ApplyWith(Context ctx, string extra, out JsonNode preview)
    {
        preview = ctx.Preview(WingetStep());
        if (!Is(preview, "ready")) return preview;
        ctx.Rig.TestOnlyExtra = extra;
        try { return ctx.Apply(preview); }
        finally { ctx.Rig.TestOnlyExtra = null; }
    }

    static IEnumerable<string> Expected(Context ctx)
    {
        Clean(ctx.Person);
        try
        {
            var a = ApplyWith(ctx, @"$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }; Set-ItemProperty -LiteralPath $k -Name RigSelftest -Value 'rig-selftest'", out var p);
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

    static IEnumerable<string> HardHit(Context ctx)
    {
        Clean(ctx.Person);
        object? was = Value(ctx.Person, ProxyKey, "ProxyServer");
        try
        {
            var a = ApplyWith(ctx, @"Set-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name ProxyServer -Value 'rig-selftest:8080'", out var p);
            if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
            if (!Is(a, "rolledBack") || a["sentinels"] is not JsonArray hit || !hit.Any(h => h?["sentinel"]?.ToString() == "proxy"))
                yield return $"the proxy change wasn't a hit that rolled it back: {a.ToJsonString()}";
            if (Value(ctx.Person, Key, "Undone") is null) yield return "the step's undo didn't run before the rollback";
            if (!Equals(Value(ctx.Person, ProxyKey, "ProxyServer"), was)) yield return $"the proxy wasn't put back: {Value(ctx.Person, ProxyKey, "ProxyServer")}";
        }
        finally
        {
            using var hive = Hive(ctx.Person, ProxyKey, out string path);
            using (var k = hive.OpenSubKey(path, writable: true))
                if (k != null && k.GetValue("ProxyServer") as string == "rig-selftest:8080")
                {
                    if (was == null) k.DeleteValue("ProxyServer", throwOnMissingValue: false);
                    else k.SetValue("ProxyServer", was);
                }
            Clean(ctx.Person);
        }
    }
}
