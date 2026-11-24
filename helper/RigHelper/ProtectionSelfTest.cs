// The protection ops' part of --selftest, with admin rights only. It turns
// Rig's self-test protection (a value under HKLM\SOFTWARE\RigSelftest) off
// through the whole step path, with a real Windows service of its own keeping
// a ledger of its own: this same program, started by Windows' service manager
// as the system, the way Rig's recorder is. No real protection is changed;
// the real rows are only read.

using System.Management;
using System.ServiceProcess;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace Rig.Helper;

public static class ProtectionSelfTest
{
    const string ServiceName = "RigSelftestReverts";

    public static void Run(Action<string, Func<IEnumerable<string>>> check, Commands rig, CommandStore store, string sid, string ledger)
    {
        (Store, Sid) = (store, sid);
        string wasDir = Reverts.Dir, wasService = Reverts.Service;
        (Reverts.Dir, Reverts.Service, Protections.SelfTest) = (ledger, ServiceName, true);
        try
        {
            check("a protection's fingerprint, tier and what Rig refuses", () => Refused(rig));
            check("the real protections can be read", RealRows);
            check("without the service nothing is turned off", () => NoService(rig));
            RecorderSetup.Scm.CreateOrUpdate(ServiceName, "Rig self-test", $"\"{Environment.ProcessPath}\" --service {RecorderService.SelfTestFlag} \"{ledger}\"", "Rig's self-test. Safe to delete.");
            Start();
            check("a protection turned off is turned back on by the service", () => ComesBack(rig));
            check("keeping it off takes the second choice, and undoing that arms it again", () => KeptOff(rig));
            check("a protection the person turned back on is left alone", () => RaisedByHand(rig));
            check("a protection due while the PC was off is turned back on when the service starts", () => DueAtStart(rig));
            check("stopping the service turns it back on first", () => Stopped(rig));
            check("removing Rig turns it back on first", () => Removed(rig));
        }
        finally
        {
            try { Stop(); } catch { }
            try { RecorderSetup.Scm.Delete(ServiceName); } catch { }
            Protections.TestSeconds = null;
            (Reverts.Dir, Reverts.Service, Protections.SelfTest) = (wasDir, wasService, false);
            try { Registry.LocalMachine.DeleteSubKeyTree(Protections.TestKey, throwOnMissingSubKey: false); } catch { }
            try { Directory.Delete(ledger, recursive: true); } catch { }
        }
    }

    static CommandStore Store = null!;
    static string Sid = "";

    static void Start()
    {
        using var sc = new ServiceController(ServiceName);
        if (sc.Status != ServiceControllerStatus.Running) sc.Start();
        sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
    }

    static void Stop()
    {
        using var sc = new ServiceController(ServiceName);
        if (sc.Status == ServiceControllerStatus.Stopped) return;
        sc.Stop();
        sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(40));
    }

    /// Ends the service's process the way losing power would: nothing in it gets to run.
    static void Kill()
    {
        using var found = new ManagementObjectSearcher($"SELECT ProcessId FROM Win32_Service WHERE Name = '{ServiceName}'");
        foreach (ManagementObject s in found.Get())
            using (s)
                if (Convert.ToInt32(s["ProcessId"]) is int pid and > 0)
                    using (var p = System.Diagnostics.Process.GetProcessById(pid)) { p.Kill(); p.WaitForExit(10_000); }
        using var sc = new ServiceController(ServiceName);
        sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
    }

    static JsonObject Op(string name, string id = Protections.TestRow, JsonNode? revertAfter = null)
    {
        var op = new JsonObject { ["name"] = name, ["id"] = id };
        if (revertAfter != null) op["revertAfter"] = revertAfter;
        return op;
    }

    static JsonNode Preview(Commands rig, JsonObject op) => rig.Handle("step.preview", new JsonObject { ["step"] = new JsonObject { ["kind"] = "native", ["op"] = op.DeepClone() } });
    static JsonNode Apply(Commands rig, JsonNode preview) => rig.Handle("step.apply", new JsonObject { ["nonce"] = preview["nonce"]?.ToString() });
    static JsonNode Undo(Commands rig, JsonNode applied) => rig.Handle("step.undo", new JsonObject { ["id"] = applied["undo"]?["id"]?.ToString(), ["force"] = false });
    static bool Is(JsonNode? n, string outcome) => n?["outcome"]?.ToString() == outcome;
    static string Said(JsonNode? n) => n?.ToJsonString() ?? "nothing";
    static string Why(JsonNode? n) => n?["verdict"]?["refused"]?.ToString() ?? "";

    static string? Value() { using var k = Registry.LocalMachine.OpenSubKey(Protections.TestKey); return k?.GetValue(Protections.TestValue) as string; }
    static bool Off() => Value() == "Off";
    static void SetOn() { using var k = Registry.LocalMachine.CreateSubKey(Protections.TestKey); k.SetValue(Protections.TestValue, "On", RegistryValueKind.String); }
    static string Last() => Reverts.Last(Protections.TestRow) is JsonObject o ? $"{o["why"]} {o["was"]}".Trim() : "nothing";

    static bool Wait(Func<bool> until, int seconds)
    {
        for (var waited = System.Diagnostics.Stopwatch.StartNew(); waited.Elapsed.TotalSeconds < seconds; Thread.Sleep(200))
            if (until()) return true;
        return until();
    }

    /// The step as the app would approve it: the same check Windows' prompt leads to, with this self-test as the app.
    static JsonNode Approved(Commands rig, JsonObject op, out string? problem)
    {
        var p = Preview(rig, op);
        problem = !Is(p, "ready") || p["verdict"]?["tier"]?.GetValue<int>() != 3 || p["verdict"]?["admin"]?.GetValue<bool>() != true ? $"the preview wasn't ready at tier 3 with admin rights: {Said(p)}" : null;
        if (problem != null) return p;
        string request = Path.Combine(Store.Work, "approve.json");
        File.WriteAllText(request, new JsonObject { ["nonce"] = p["nonce"]?.ToString(), ["owner"] = Sid }.ToJsonString());
        try { if (Commands.ApproveFromFile(request, p["hash"]?.ToString(), Store) != RecorderSetup.Ok) problem = "the approval was turned down"; }
        finally { File.Delete(request); }
        return p;
    }

    /// When the entry TurnOff last made is due.
    static long due;
    static void UntilDue(int andMs) => Thread.Sleep((int)Math.Max(0, due - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) + andMs);

    /// Turns the test row off for `seconds` through the whole path. Null with `problem` set when it didn't go through.
    static JsonNode? TurnOff(Commands rig, int seconds, out string? problem)
    {
        SetOn();
        Protections.TestSeconds = seconds;
        var p = Approved(rig, Op("protection", revertAfter: 15), out problem);
        if (problem != null) return null;
        var a = Apply(rig, p);
        if (!Is(a, "applied") || !Off()) { problem = $"an approved protection change didn't turn it off: {Said(a)}"; return null; }
        if (Reverts.Find(Protections.TestRow) is not { Armed: > 0 } entry) { problem = "it was turned off without an armed entry in the ledger"; return null; }
        due = entry.Due;
        return a;
    }

    /// The same op as packages/core/test/protection.test.ts, with the same fingerprint.
    static IEnumerable<string> Refused(Commands rig)
    {
        var real = new JsonObject { ["name"] = "protection", ["id"] = "firewallPublic", ["revertAfter"] = 60 };
        string hash = new NativeOpStep("protection", real).Hash();
        if (hash != Fingerprint) yield return $"a protection step's fingerprint is {hash}, not the app's";
        if (Protections.RevertAfter.Count != 3 || Protections.DefaultMinutes != 60) yield return "the table's times aren't 15, 60 and 240 with 60 the default";
        if (Protections.Rows.Any(r => r.Id.Contains("uac", StringComparison.OrdinalIgnoreCase) || r.Key.Contains(@"Policies\System", StringComparison.OrdinalIgnoreCase))) yield return "User Account Control is in the table";
        if (CommandCheck.OnNeverList(@"Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name EnableLUA -Value 0", "run") == null) yield return "a command that turns off User Account Control isn't on the never list";
        foreach (var (what, op) in new (string, JsonObject)[]
        {
            ("a row that isn't in the table", Op("protection", "uac")),
            ("a time that isn't offered", Op("protection", revertAfter: 5)),
            ("a time given as text", Op("protection", revertAfter: "60")),
            ("keeping off a row that isn't off", Op("keepOff")),
        })
            if (Preview(rig, op) is var p && (Is(p, "ready") || Why(p).Length == 0)) yield return $"{what} wasn't refused: {Said(p)}";
        Protections.SelfTest = false;
        try { if (Is(Preview(rig, Op("protection")), "ready")) yield return "the self-test's row can be named outside the self-test"; }
        finally { Protections.SelfTest = true; }
    }

    internal const string Fingerprint = "7bc76eee6f83b98ef81fd5ce1c0349dda30fa5aae2c9a13b266fddc3179612ee";

    static IEnumerable<string> RealRows()
    {
        foreach (var row in Protections.Rows)
        {
            string? problem = null;
            try { Protections.On(row); if (row.Kind == "defender") Protections.TamperProtected(row); }
            catch (RigException e) { problem = e.Message; }
            // A runner without Defender or the firewall service can't say; a PC has both.
            if (problem != null) yield return row.Kind == "registry" ? $"{row.Id}: {problem}" : $"{CommandSelfTest.Skip}{row.Id} can't be read on this runner: {problem}";
        }
        if (Protections.State()["rows"] is not JsonArray { Count: > 0 }) yield return "protection.state listed no rows";
    }

    static IEnumerable<string> NoService(Commands rig)
    {
        SetOn();
        var p = Preview(rig, Op("protection", revertAfter: 15));
        if (Is(p, "ready") || Why(p) != Reverts.NoService) yield return $"with no service the step wasn't refused in plain words: {Said(p)}";
        if (Off()) yield return "it was turned off";
    }

    static IEnumerable<string> ComesBack(Commands rig)
    {
        SetOn();
        var p = Preview(rig, Op("protection"));
        if (p["hash"]?.ToString() != new NativeOpStep("protection", Op("protection", revertAfter: 60)).Hash()) yield return $"a step with no time didn't get the default, 1 hour: {Said(p)}";
        if (!Is(Apply(rig, p), "declined") || Off()) yield return "a protection change without Windows' prompt wasn't answered declined, or ran";
        if (TurnOff(rig, 8, out string? problem) == null) { yield return problem!; yield break; }
        var state = (Protections.State()["rows"] as JsonArray)?.FirstOrDefault(r => r?["id"]?.ToString() == Protections.TestRow);
        if (state?["on"]?.GetValue<bool>() != false || state?["due"] == null) yield return $"protection.state didn't say it is off and due: {Said(state)}";
        if (!Wait(() => !Off(), 30)) { yield return "the service didn't turn it back on"; yield break; }
        if (!Wait(() => Reverts.Find(Protections.TestRow) == null, 5)) yield return "the entry stayed in the ledger";
        if (Last() != "due off") yield return $"the log says \"{Last()}\", not that it was due and turned back on";
    }

    static IEnumerable<string> KeptOff(Commands rig)
    {
        var a = TurnOff(rig, 20, out string? problem);
        if (a == null) { yield return problem!; yield break; }
        var p = Approved(rig, Op("keepOff"), out problem);
        if (problem != null) { yield return problem; yield break; }
        var kept = Apply(rig, p);
        if (!Is(kept, "applied") || Reverts.Find(Protections.TestRow) != null) { yield return $"keeping it off didn't take it out of the ledger: {Said(kept)}"; yield break; }
        UntilDue(3000);
        if (!Off()) yield return "the service turned it back on after the person chose to keep it off";
        if (Last() != "kept") yield return $"the log says \"{Last()}\", not that it was kept off";
        var again = Undo(rig, kept);
        if (!Is(again, "undone") || Reverts.Find(Protections.TestRow) is not { Armed: > 0 } armed) { yield return $"undoing the choice didn't arm it again: {Said(again)}"; yield break; }
        if (armed.Due < DateTimeOffset.UtcNow.AddMinutes(14).ToUnixTimeMilliseconds()) yield return "armed again for less than a quarter of an hour";
        var now = Undo(rig, a);
        if (!Is(now, "undone") || Off() || Reverts.Find(Protections.TestRow) != null) yield return $"\"Turn it back on now\" didn't turn it on and clear the ledger: {Said(now)}";
        if (Last() != "undone") yield return $"the log says \"{Last()}\", not that the person turned it back on in Rig";
    }

    static IEnumerable<string> RaisedByHand(Commands rig)
    {
        if (TurnOff(rig, 8, out string? problem) == null) { yield return problem!; yield break; }
        SetOn();
        if (!Wait(() => Reverts.Find(Protections.TestRow) == null, 30)) { yield return "the entry stayed in the ledger"; yield break; }
        if (Last() != "due on") yield return $"the log says \"{Last()}\", not that it was already on";
        if (Off()) yield return "it is off";
    }

    static IEnumerable<string> DueAtStart(Commands rig)
    {
        if (TurnOff(rig, 8, out string? problem) == null) { yield return problem!; yield break; }
        Kill();
        UntilDue(1000);
        if (!Off()) yield return "something turned it back on while the service wasn't running";
        Start();
        if (!Wait(() => !Off(), 20)) { yield return "the service didn't turn it back on when it started"; yield break; }
        if (!Wait(() => Reverts.Find(Protections.TestRow) == null, 5)) yield return "the entry stayed in the ledger";
        if (Last() != "start off") yield return $"the log says \"{Last()}\", not that it came due while the service was off";
    }

    static IEnumerable<string> Stopped(Commands rig)
    {
        if (TurnOff(rig, 600, out string? problem) == null) { yield return problem!; yield break; }
        Stop();
        if (Off()) yield return "stopping the service left it off";
        if (Last() != "stop off") yield return $"the log says \"{Last()}\", not that the service stopped";
        if (Reverts.Find(Protections.TestRow) != null) yield return "the entry stayed in the ledger";
        Start();
    }

    /// What RecorderSetup.Uninstall and RemoveSelf do once the service is stopped, here with one that was killed.
    static IEnumerable<string> Removed(Commands rig)
    {
        if (TurnOff(rig, 600, out string? problem) == null) { yield return problem!; yield break; }
        Kill();
        if (!Off()) yield return "something turned it back on while the service wasn't running";
        Reverts.RaiseAll("uninstall", forget: true);
        if (Off()) yield return "removing Rig left it off";
        if (Directory.Exists(Reverts.Dir)) yield return "the ledger's folder is still there";
    }
}
