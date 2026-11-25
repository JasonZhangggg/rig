// The protections' part of --selftest: the revert ledger's state machine with
// a stand-in protection, then, with admin rights, the real thing end to end.
// A service is installed under the self-test's own name with its own folders,
// and a test value under HKLM\SOFTWARE\RigSelftest is lowered through the
// same step path the app uses, armed by that service, and raised by it: when
// its time is up, at the service's start, when it stops and when it is
// uninstalled. Nothing here touches a real protection or an installed Rig.

using System.Diagnostics;
using System.Diagnostics.Eventing.Reader;
using System.ServiceProcess;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace Rig.Helper;

public static class RevertSelfTest
{
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// A protection held in memory. `FailRaises`: how many times Raise does nothing first.
    sealed class Fake(bool on) : IProtection
    {
        public bool IsOn = on;
        public int FailRaises, Lowered;
        public string Id => "fake";
        public string Name => "The test protection";
        public bool Allows(int seconds) => seconds is >= 1 and <= 3600;
        public string? Blocked() => null;
        public bool On() => IsOn;
        public string? Was() => null;
        public void Lower() { Lowered++; IsOn = false; }
        public void Raise(string? was) { if (FailRaises-- > 0) return; IsOn = true; }
    }

    public static (JsonObject Summary, List<string> Problems) Run()
    {
        var checks = new JsonArray();
        var problems = new List<string>();
        void Check(string name, Func<IEnumerable<string>> run)
        {
            var watch = Stopwatch.StartNew();
            List<string> found;
            try { found = run().ToList(); }
            catch (Exception e) { found = [$"stopped: {e.GetType().Name}: {e.Message}"]; }
            var row = new JsonObject { ["name"] = name, ["ok"] = found.Count == 0, ["seconds"] = Math.Round(watch.Elapsed.TotalSeconds, 1) };
            if (found.Count > 0) row["problems"] = new JsonArray(found.Select(f => (JsonNode)f).ToArray());
            checks.Add(row);
            problems.AddRange(found.Select(f => $"reverts, {name}: {f}"));
        }
        JsonObject Summary(string? skipped = null)
        {
            int passed = checks.Count(c => c?["ok"]?.GetValue<bool>() == true);
            var o = new JsonObject { ["passed"] = passed, ["failed"] = checks.Count - passed, ["checks"] = checks };
            if (skipped != null) o["skipped"] = skipped;
            return o;
        }

        Check("the state machine allows these moves and no others", Moves);
        Check("stopped at any point, a revert ends with the protection on and one line in the log", Converges);
        Check("nothing is lowered without the service's answer", NoAnswer);
        Check("a revert waits for its time, and a clock set back doesn't put it off", Waits);
        Check("a protection that won't come back on is tried again", TriedAgain);
        Check("keeping it off is only for one that is off for now", KeepRules);
        Check("the real rows and the never list", RealRows);
        if (!Native.IsAdmin()) return (Summary("Without admin rights the self-test can't install a service, so the service path wasn't run."), problems);

        RecorderPaths.SelfTest = true;
        string root = CommandStore.AdminRoot + "-selftest-reverts-" + CommandStore.NewId();
        Person? person = null;
        try
        {
            RecorderSetup.Uninstall(null);
            foreach (var r in Rows) r.Set(1);
            var store = new CommandStore(root, secured: true);
            person = Person.Find(Environment.ProcessId);
            var t = new Service(new Commands(store, Environment.ProcessId, restorePoints: false) { TestOnlyElevatedApp = false, TestOnlyNativeOps = true }, store, person);
            Check("with no service running, nothing is lowered", () => NoService(t));
            Check("the test service installs and runs", () => RecorderSetup.Install(null) == RecorderSetup.Ok && ServicePid() != 0 ? [] : ["the self-test's service didn't install or start"]);
            Check("lowered through the service, raised by it when the time is up, and logged", () => RaisedWhenDue(t));
            Check("kept off only by a second approved choice, and turned back on by hand", () => KeptOff(t));
            Check("turned back on by the person first: left alone and logged", () => LeftAlone(t));
            Check("Turn it back on now", () => RaisedNow(t));
            Check("the service stopping turns it back on first", () => RaisedOnStop(t));
            Check("due while the service was off: raised at its start, also from a file it can't read", () => RaisedAtStart(t));
            Check("uninstall turns it back on first, with the service dead, then removes the ledger", () => RaisedOnUninstall(t));
            Check("uninstall with one that won't come back on says so, and Windows' event log says which", StillOffOnUninstall);
        }
        catch (Exception e) { Check("setting up", () => [$"{e.GetType().Name}: {e.Message}"]); }
        finally
        {
            try { RecorderSetup.Uninstall(null); } catch { }
            try { using var k = Registry.LocalMachine.OpenSubKey(Protections.SelftestRow.Key, writable: true); foreach (var r in Rows) k?.DeleteValue(r.Value, throwOnMissingValue: false); } catch { }
            try { using var k = Registry.LocalMachine.OpenSubKey(Protections.SelftestRow.Key); if (k is { ValueCount: 0, SubKeyCount: 0 }) Registry.LocalMachine.DeleteSubKey(Protections.SelftestRow.Key, throwOnMissingSubKey: false); } catch { }
            person?.Dispose();
            try { Directory.Delete(root, recursive: true); } catch { }
            RecorderPaths.SelfTest = false;
        }
        return (Summary(), problems);
    }

    // ----- The ledger alone, with a stand-in protection -----

    static string TempLedger() => Path.Combine(Path.GetTempPath(), "rig-selftest-reverts-" + CommandStore.NewId());

    static T WithLedger<T>(Func<Ledger, T> act)
    {
        string dir = TempLedger();
        try { return act(new Ledger(dir, secured: false)); }
        finally { try { Directory.Delete(dir, recursive: true); } catch { } }
    }

    static IEnumerable<string> Moves()
    {
        string[] states = [Revert.Asked, Revert.Armed, Revert.Lowered, Revert.Raised, Revert.Left, Revert.Kept, Revert.Unused, Revert.Broken];
        var allowed = new HashSet<(string, string)>
        {
            (Revert.Asked, Revert.Armed), (Revert.Asked, Revert.Unused),
            (Revert.Armed, Revert.Lowered), (Revert.Armed, Revert.Raised), (Revert.Armed, Revert.Unused),
            (Revert.Lowered, Revert.Raised), (Revert.Lowered, Revert.Left), (Revert.Lowered, Revert.Kept), (Revert.Lowered, Revert.Unused),
            (Revert.Broken, Revert.Raised), (Revert.Broken, Revert.Left),
        };
        foreach (string from in states)
            foreach (string to in states)
                if (Revert.Can(from, to) != allowed.Contains((from, to))) yield return $"{from} to {to} is {(Revert.Can(from, to) ? "allowed" : "refused")}";
        // What matters most: only a lowered one can be kept off, nothing is lowered that wasn't armed, and an end is an end.
        if (Revert.Can(Revert.Asked, Revert.Lowered) || Revert.Can(Revert.Asked, Revert.Kept) || Revert.Can(Revert.Armed, Revert.Kept) || Revert.Can(Revert.Raised, Revert.Lowered) || Revert.Can(Revert.Kept, Revert.Lowered))
            yield return "a move that must never happen is allowed";
    }

    /// Every state a crash or power cut can leave on disk, with the protection on or off, settled as the service would at its start.
    static IEnumerable<string> Converges()
    {
        long now = Now;
        var left = new (string What, Func<Revert?> Entry, string? Raw)[]
        {
            ("asked a moment ago", () => new Revert(CommandStore.NewId(), "fake", Revert.Asked, 1, Now), null),
            ("asked long ago, never armed", () => new Revert(CommandStore.NewId(), "fake", Revert.Asked, 1, now - 10 * 60_000), null),
            ("armed, never lowered", () => new Revert(CommandStore.NewId(), "fake", Revert.Armed, 1, now - 5000, now - 4000), null),
            ("lowered", () => new Revert(CommandStore.NewId(), "fake", Revert.Lowered, 1, now - 5000, now - 4000), null),
            ("raised, not yet logged", () => new Revert(CommandStore.NewId(), "fake", Revert.Raised, 1, now - 5000, now - 4000, EndedAt: now), null),
            ("left, not yet logged", () => new Revert(CommandStore.NewId(), "fake", Revert.Left, 1, now - 5000, now - 4000, EndedAt: now), null),
            ("unused, not yet logged", () => new Revert(CommandStore.NewId(), "fake", Revert.Unused, 1, now - 5000, EndedAt: now), null),
            ("half a file", () => null, "{\"id\":\"0123"),
            ("an empty file", () => null, ""),
            ("someone else's file", () => null, "{\"id\":\"00000000000000000000000000000000\",\"row\":\"other\",\"state\":\"kept\"}"),
            ("a state Rig doesn't know", () => null, "{\"id\":\"00000000000000000000000000000000\",\"row\":\"fake\",\"state\":\"paused\"}"),
        };
        foreach (var (what, entry, raw) in left)
            foreach (bool on in new[] { true, false })
            {
                // A row that was never lowered can't be off, and one already raised can't be either.
                var made = entry();
                if (!on && made is { State: Revert.Asked or Revert.Raised or Revert.Left or Revert.Unused }) continue;
                string? problem = WithLedger(ledger =>
                {
                    var fake = new Fake(on);
                    if (made != null) ledger.TestOnlyPut(made); else ledger.TestOnlyPutRaw("fake", raw!);
                    for (int round = 0; round < 3; round++)
                    {
                        // The one that gets armed on the first round has a second to wait.
                        if (round == 1 && ledger.Rows().Count != 0) Thread.Sleep(1100);
                        var stuck = ledger.Settle(_ => fake, arms: true, r => Now >= r.DueAt, "start").Stuck;
                        if (stuck.Count > 0) return $"round {round} was stuck: {stuck[0]}";
                    }
                    if (!fake.IsOn) return "the protection is still off";
                    if (fake.Lowered != 0) return "settling lowered the protection";
                    if (ledger.Rows().Count != 0) return "the entry is still there";
                    var log = ledger.Log();
                    return log.Count == 1 ? null : $"the log has {log.Count} lines";
                });
                if (problem != null) yield return $"{what}, protection {(on ? "on" : "off")}: {problem}";
            }

        // Stopped after the log line and before the file was removed: the line isn't written twice.
        string? twice = WithLedger(ledger =>
        {
            var fake = new Fake(false);
            var r = new Revert(CommandStore.NewId(), "fake", Revert.Lowered, 1, now - 5000, now - 4000);
            ledger.TestOnlyPut(r);
            ledger.Settle(_ => fake, arms: true, _ => true, "due");
            ledger.TestOnlyPut(r with { State = Revert.Raised, EndedAt = now });
            ledger.Settle(_ => fake, arms: true, _ => true, "start");
            return ledger.Log().Count == 1 && ledger.Rows().Count == 0 ? null : $"the log has {ledger.Log().Count} lines and {ledger.Rows().Count} entries are left";
        });
        if (twice != null) yield return $"logged, file not yet removed: {twice}";

        // Kept off is the one end that leaves the protection off, and only as the person chose.
        string? kept = WithLedger(ledger =>
        {
            var fake = new Fake(false);
            var r = new Revert(CommandStore.NewId(), "fake", Revert.Lowered, 1, now - 5000, now + 60_000);
            ledger.TestOnlyPut(r);
            ledger.TestOnlyEndWithoutFinish(r, Revert.Kept);
            ledger.Settle(_ => fake, arms: true, _ => true, "start");
            return !fake.IsOn && ledger.Rows().Count == 0 && ledger.Log().Single()["how"]?.ToString() == Revert.Kept ? null : "kept, not yet logged, didn't end as kept and off";
        });
        if (kept != null) yield return kept;
    }

    static IEnumerable<string> NoAnswer()
    {
        var problems = new List<string>();
        WithLedger(ledger =>
        {
            var fake = new Fake(true);
            try { ledger.Arm("fake", 5, null, waitMs: 400); problems.Add("an ask nobody armed came back armed"); }
            catch (RigException e) { if (e.Message != Ledger.NoService) problems.Add($"it said: {e.Message}"); }
            if (ledger.Rows().Count != 0) problems.Add("the unanswered ask was left in the ledger");
            if (ledger.Log().LastOrDefault()?["how"]?.ToString() != Revert.Unused) problems.Add("the unanswered ask wasn't logged as unused");

            // An entry that isn't the armed one in the ledger lowers nothing: one made up, and one the service has since ended.
            var forged = new Revert(CommandStore.NewId(), "fake", Revert.Armed, 5, Now, Now + 5000);
            try { ledger.Lower(forged, fake); problems.Add("a made-up armed entry was lowered"); } catch (RigException) { }
            ledger.TestOnlyPut(forged with { State = Revert.Asked });
            try { ledger.Lower(forged, fake); problems.Add("an entry still only asked was lowered"); } catch (RigException) { }
            if (fake.Lowered != 0 || !fake.IsOn) problems.Add("the protection was lowered");

            // Armed by the service's side, it is lowered, and a second ask for the same row is refused.
            ledger.Settle(_ => fake, arms: true, _ => false, "due");
            if (ledger.Read("fake") is not { State: Revert.Armed, DueAt: > 0 } armed) { problems.Add("the service's side didn't arm a fresh ask"); return 0; }
            if (armed.By != Environment.ProcessId) problems.Add("the armed entry doesn't say who armed it");
            ledger.Lower(armed, fake);
            if (fake.IsOn || ledger.Read("fake")?.State != Revert.Lowered) problems.Add("an armed entry wasn't lowered");
            try { ledger.Arm("fake", 5, null, waitMs: 200); problems.Add("a second ask for a row that is off for now was taken"); }
            catch (RigException e) { if (e.Message != Ledger.Busy) problems.Add($"a second ask said: {e.Message}"); }
            return 0;
        });
        // An ask only the helper's side looks at is never armed.
        WithLedger(ledger =>
        {
            ledger.TestOnlyPut(new Revert(CommandStore.NewId(), "fake", Revert.Asked, 5, Now));
            ledger.Settle(_ => new Fake(true), arms: false, _ => false, "app");
            if (ledger.Read("fake")?.State != Revert.Asked) problems.Add("something other than the service armed or ended a fresh ask");
            return 0;
        });
        return problems;
    }

    static IEnumerable<string> Waits()
    {
        var problems = new List<string>();
        WithLedger(ledger =>
        {
            var fake = new Fake(false);
            long now = Now;
            ledger.TestOnlyPut(new Revert(CommandStore.NewId(), "fake", Revert.Lowered, 600, now, now + 600_000));
            var round = ledger.Settle(_ => fake, arms: true, r => Now >= r.DueAt, "due");
            if (fake.IsOn || ledger.Read("fake")?.State != Revert.Lowered) problems.Add("a revert was made before its time");
            if (round.NextMs > Ledger.IdleMs) problems.Add($"the next look is {round.NextMs} ms away");
            return 0;
        });
        var keeper = new RevertKeeper(_ => null);
        var r = new Revert(CommandStore.NewId(), "fake", Revert.Lowered, 5, 1_000_000, 1_005_000);
        if (keeper.Due(r, now: 1_000_000, mono: 50_000)) problems.Add("due at once");
        if (keeper.Due(r, now: 900_000, mono: 52_000)) problems.Add("due two seconds in, with the clock set back");
        if (!keeper.Due(r, now: 900_000, mono: 55_000)) problems.Add("a clock set back put the revert off");
        if (!keeper.Due(r with { Id = CommandStore.NewId() }, now: 1_005_000, mono: 0)) problems.Add("not due when the clock says so");
        // First seen after a restart with the clock set back an hour: still no more than the five seconds approved.
        var late = r with { Id = CommandStore.NewId() };
        if (keeper.Due(late, now: 1_000_000 - 3_600_000, mono: 70_000)) problems.Add("due at once after a restart with the clock set back");
        if (!keeper.Due(late, now: 1_000_000 - 3_600_000 + 5_000, mono: 75_000)) problems.Add("a clock set back before a restart stretched the revert past its time");
        return problems;
    }

    static IEnumerable<string> TriedAgain() => WithLedger(ledger =>
    {
        var problems = new List<string>();
        var fake = new Fake(false) { FailRaises = 1 };
        ledger.TestOnlyPut(new Revert(CommandStore.NewId(), "fake", Revert.Lowered, 1, Now - 5000, Now - 4000));
        var first = ledger.Settle(_ => fake, arms: true, _ => true, "due");
        if (first.Stuck.Count != 1 || ledger.Read("fake")?.State != Revert.Lowered) problems.Add("a protection that read off after raising was taken as raised");
        if (first.NextMs > Ledger.RetryMs) problems.Add($"the next try is {first.NextMs} ms away");
        ledger.Settle(_ => fake, arms: true, _ => true, "due");
        if (!fake.IsOn || ledger.Rows().Count != 0 || ledger.Log().Single()["how"]?.ToString() != Revert.Raised) problems.Add("the second try didn't raise it and log it");
        // A row this copy doesn't know keeps its entry, for a copy that does.
        ledger.TestOnlyPut(new Revert(CommandStore.NewId(), "later", Revert.Lowered, 1, Now - 5000, Now - 4000));
        if (ledger.Settle(_ => null, arms: true, _ => true, "due").Stuck.Count != 1 || ledger.Read("later") == null) problems.Add("an entry for a row this copy doesn't know was dropped");
        return problems;
    });

    static IEnumerable<string> KeepRules() => WithLedger(ledger =>
    {
        var problems = new List<string>();
        var fake = new Fake(true);
        bool Refused() { try { ledger.Keep("fake"); return false; } catch (RigException e) { return e.Message == Ledger.NothingToKeep; } }
        if (!Refused()) problems.Add("keeping off something with no entry wasn't refused");
        ledger.TestOnlyPut(new Revert(CommandStore.NewId(), "fake", Revert.Armed, 60, Now, Now + 60_000));
        if (!Refused()) problems.Add("keeping off something not lowered yet wasn't refused");
        ledger.Lower(ledger.Read("fake")!, fake);
        ledger.Keep("fake");
        if (fake.IsOn || ledger.Rows().Count != 0 || ledger.Log().Single() is not JsonObject line || line["how"]?.ToString() != Revert.Kept || line["why"]?.ToString() != "you") problems.Add("the second choice didn't end the revert as kept by the person");
        ledger.Settle(_ => fake, arms: true, _ => true, "due", all: true);
        if (fake.IsOn) problems.Add("a kept-off protection was raised afterwards");
        // "Turn it back on now" raises it whether or not an entry is left.
        ledger.RaiseNow(fake);
        if (!fake.IsOn) problems.Add("it couldn't be turned back on after being kept off");
        return problems;
    });

    static IEnumerable<string> RealRows()
    {
        // Reads only: each real row answers on this PC. Defender isn't on every Windows the self-test runs on.
        foreach (var row in Protections.All)
        {
            string? problem = null;
            try { _ = row.On(); _ = row.Blocked(); }
            catch (Exception e) { problem = $"{row.Id} couldn't be read: {e.GetType().Name}: {e.Message}"; }
            if (problem != null && row.Id != "defender-realtime") yield return problem;
        }
        var real = new ProtectionStep();
        NativeCheck? Try(JsonObject op, out string? refused) { refused = null; try { return real.Check(op); } catch (RigException e) { refused = e.Message; return null; } }
        if (Try(new JsonObject { ["name"] = "protection", ["id"] = "uac", ["revertAfter"] = 60 }, out _)?.Never == null) yield return "User Account Control isn't on the never list";
        if (Try(new JsonObject { ["name"] = "protection", ["id"] = "selftest-1", ["revertAfter"] = 60 }, out _) != null) yield return "the test row is known outside the self-test";
        if (Try(new JsonObject { ["name"] = "protection", ["id"] = "firewall-public", ["revertAfter"] = 5 }, out _) != null) yield return "a time that isn't on the list was taken";
        if (Try(new JsonObject { ["name"] = "protection", ["id"] = "firewall-public", ["revertAfter"] = 100000 }, out _) != null) yield return "a far longer time was taken";
        if (Protections.Finder(false)("selftest-1") != null || Protections.Finder(true)("selftest-1") == null) yield return "the test rows aren't kept to the self-test";
        if (!real.Admin || !new ProtectionKeepStep().Admin) yield return "a protection step doesn't wait for Windows' prompt";
        foreach (var (script, what) in new[]
        {
            (@"Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name EnableLUA -Value 0", "turns off User Account Control"),
            ("Set-Service -Name RigRecorder -StartupType Disabled", "turns off Rig's service"),
            ("sc.exe stop RigRecorder", "stops Rig's service"),
            ("taskkill /F /IM RigRecorder.exe", "kills Rig's service"),
            (@"Remove-Item -LiteralPath 'C:\ProgramData\Rig\Reverts' -Recurse -Force", "removes the revert ledger"),
        })
            if (CommandCheck.OnNeverList(script, "run") == null) yield return $"a command that {what} isn't on the never list";
    }

    // ----- The real service -----

    static readonly Protections.SelftestRow[] Rows = [new(1), new(2), new(3)];

    sealed record Service(Commands Rig, CommandStore Store, Person Person)
    {
        public Ledger Ledger { get; } = Ledger.Open();
        public JsonNode Preview(JsonObject op) => Rig.Handle("step.preview", new JsonObject { ["step"] = new JsonObject { ["kind"] = "native", ["op"] = op } });
        public JsonNode Apply(JsonNode preview) => Rig.Handle("step.apply", new JsonObject { ["nonce"] = preview["nonce"]?.ToString() });
        public JsonNode Undo(JsonNode applied) => Rig.Handle("step.undo", new JsonObject { ["id"] = applied["undo"]?["id"]?.ToString() });
        /// What the app does behind Windows' prompt.
        public bool Approve(JsonNode preview)
        {
            string file = Path.Combine(Store.Work, "approve-revert.json");
            File.WriteAllText(file, new JsonObject { ["nonce"] = preview["nonce"]?.ToString(), ["owner"] = Person.Sid }.ToJsonString());
            return Commands.ApproveFromFile(file, preview["hash"]?.ToString(), Store) == RecorderSetup.Ok;
        }
        public JsonNode Lower(int row, int seconds)
        {
            var p = Preview(Lowering(row, seconds));
            return Is(p, "ready") && Approve(p) ? Apply(p) : p;
        }
        public JsonObject? Ended(string? id) => Ledger.Log().LastOrDefault(l => l["id"]?.ToString() == id);
    }

    static JsonObject Lowering(int row, int seconds) => new() { ["name"] = ProtectionStep.OpName, ["id"] = $"selftest-{row}", ["revertAfter"] = seconds };
    static JsonObject Keeping(int row) => new() { ["name"] = ProtectionKeepStep.OpName, ["id"] = $"selftest-{row}" };
    static bool Is(JsonNode? n, string outcome) => n?["outcome"]?.ToString() == outcome;
    static string? RevertId(JsonNode applied) => applied["result"]?["revert"]?["id"]?.ToString();

    static int ServicePid()
    {
        var found = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(RecorderPaths.ExeName));
        try { return found.FirstOrDefault()?.Id ?? 0; } finally { foreach (var p in found) p.Dispose(); }
    }

    static bool Wait(Func<bool> done, int seconds)
    {
        var waited = Stopwatch.StartNew();
        while (waited.Elapsed.TotalSeconds < seconds) { if (done()) return true; Thread.Sleep(200); }
        return done();
    }

    static IEnumerable<string> NoService(Service t)
    {
        var p = t.Preview(Lowering(1, 8));
        if (!Is(p, "ready") || Json.Num(p["verdict"]?["tier"], 0) != 3 || p["verdict"]?["admin"]?.GetValue<bool>() != true || p["read"]?.ToString() != "On") { yield return $"the preview wasn't a tier 3 admin step reading On: {p.ToJsonString()}"; yield break; }
        if (!Is(t.Apply(p), "declined") || !Rows[0].On()) yield return "without Windows' prompt it wasn't answered declined, or was lowered";
        if (!t.Approve(p)) yield return "the approval was turned down";
        var a = t.Apply(p);
        if (!Is(a, "rolledBack") || a["error"]?.ToString().Contains(Ledger.NoService) != true) yield return $"with no service it didn't stop with the plain reason: {a.ToJsonString()}";
        if (!Rows[0].On()) yield return "the protection was lowered with no service to raise it";
        if (t.Ledger.Rows().Count != 0) yield return "an entry was left in the ledger";
    }

    static IEnumerable<string> RaisedWhenDue(Service t)
    {
        var p = t.Preview(Lowering(1, 8));
        if (!Is(t.Apply(p), "declined") || !Rows[0].On() || t.Ledger.Rows().Count != 0) yield return "without Windows' prompt it wasn't answered declined, was lowered, or an entry was written";
        if (!t.Approve(p)) yield return "the approval was turned down";
        var a = t.Apply(p);
        if (!Is(a, "applied")) { yield return $"it wasn't applied: {a.ToJsonString()}"; yield break; }
        string? id = RevertId(a);
        if (Rows[0].On()) yield return "the test value wasn't lowered";
        if (a["result"]?["before"]?.ToString() != "On" || a["result"]?["after"]?.ToString() != "Off") yield return $"apply didn't report On then Off: {a.ToJsonString()}";
        if (id == null || !DateTimeOffset.TryParse(a["result"]?["revert"]?["dueAt"]?.ToString(), out var due) || Math.Abs((due - DateTimeOffset.UtcNow).TotalSeconds) > 12) yield return $"apply didn't say when it comes back on: {a.ToJsonString()}";
        var entry = t.Ledger.Read("selftest-1");
        if (entry is not { State: Revert.Lowered } || entry.Id != id) yield return $"the ledger doesn't hold it as lowered: {entry}";
        else if (entry.By == 0 || entry.By != ServicePid() || entry.By == Environment.ProcessId) yield return $"the entry was armed by process {entry.By}, and the service is {ServicePid()}";
        var status = Protections.Reverts(selfTest: true);
        if (status["waiting"]?.AsArray().Any(w => w?["id"]?.ToString() == id) != true) yield return $"the app isn't told it is waiting: {status.ToJsonString()}";
        var again = t.Preview(Lowering(1, 8));
        if (!Is(again, "refused") || again["verdict"]?["refused"]?.ToString() != Ledger.Busy) yield return $"a second lowering while one waits wasn't refused: {again.ToJsonString()}";

        if (!Wait(() => Rows[0].On(), 25)) { yield return "the service didn't raise it when its time was up"; yield break; }
        if (!Wait(() => t.Ledger.Rows().Count == 0, 5)) yield return "the entry wasn't dropped";
        var line = t.Ended(id);
        if (line?["how"]?.ToString() != Revert.Raised || line["why"]?.ToString() != "due") yield return $"it wasn't logged as raised when due: {line?.ToJsonString()}";
        status = Protections.Reverts(selfTest: true);
        if (status["ended"]?.AsArray().Any(w => w?["id"]?.ToString() == id && w?["how"]?.ToString() == Revert.Raised) != true) yield return "the app isn't told it was raised";
    }

    static IEnumerable<string> KeptOff(Service t)
    {
        var nothing = t.Preview(Keeping(1));
        if (!Is(nothing, "refused") || nothing["verdict"]?["refused"]?.ToString() != Ledger.NothingToKeep) yield return $"keeping off with nothing waiting wasn't refused: {nothing.ToJsonString()}";
        var started = Stopwatch.StartNew();
        var a = t.Lower(1, 12);
        if (!Is(a, "applied")) { yield return $"it wasn't lowered: {a.ToJsonString()}"; yield break; }
        string? id = RevertId(a);
        var p = t.Preview(Keeping(1));
        if (!Is(p, "ready") || Json.Num(p["verdict"]?["tier"], 0) != 3 || p["verdict"]?["admin"]?.GetValue<bool>() != true) { yield return $"the second choice wasn't a tier 3 admin step: {p.ToJsonString()}"; yield break; }
        // Asked for over the pipe without Windows' prompt, it changes nothing: the revert stays armed.
        if (!Is(t.Apply(p), "declined") || t.Ledger.Read("selftest-1")?.State != Revert.Lowered) yield return "without Windows' prompt the revert was called off";
        if (!t.Approve(p)) yield return "the approval was turned down";
        var k = t.Apply(p);
        if (!Is(k, "applied")) { yield return $"the second choice wasn't applied: {k.ToJsonString()}"; yield break; }
        if (t.Ledger.Rows().Count != 0 || t.Ended(id)?["how"]?.ToString() != Revert.Kept) yield return "the revert wasn't ended as kept";
        Thread.Sleep(Math.Max(0, 16_000 - (int)started.ElapsedMilliseconds));
        if (Rows[0].On()) yield return "the service raised a protection the person chose to keep off";
        if (Is(t.Undo(k), "undone")) yield return "the second choice could be undone into a timer again";
        var u = t.Undo(a);
        if (!Is(u, "undone") || !Rows[0].On()) yield return $"it couldn't be turned back on by hand afterwards: {u.ToJsonString()}";
    }

    static IEnumerable<string> LeftAlone(Service t)
    {
        var a = t.Lower(1, 8);
        if (!Is(a, "applied")) { yield return $"it wasn't lowered: {a.ToJsonString()}"; yield break; }
        Rows[0].Set(1);
        if (!Wait(() => t.Ledger.Rows().Count == 0, 25)) { yield return "the entry wasn't dropped when its time was up"; yield break; }
        var line = t.Ended(RevertId(a));
        if (line?["how"]?.ToString() != Revert.Left) yield return $"it wasn't logged as left alone: {line?.ToJsonString()}";
        if (!Rows[0].On()) yield return "it isn't on";
    }

    static IEnumerable<string> RaisedNow(Service t)
    {
        var a = t.Lower(1, 600);
        if (!Is(a, "applied")) { yield return $"it wasn't lowered: {a.ToJsonString()}"; yield break; }
        var u = t.Undo(a);
        if (!Is(u, "undone") || u["printed"]?.ToString() != "On" || !Rows[0].On()) yield return $"it wasn't turned back on: {u.ToJsonString()}";
        var line = t.Ended(RevertId(a));
        if (t.Ledger.Rows().Count != 0 || line?["how"]?.ToString() != Revert.Raised || line["why"]?.ToString() != "you") yield return $"it wasn't logged as raised by the person and dropped: {line?.ToJsonString()}";
    }

    static IEnumerable<string> RaisedOnStop(Service t)
    {
        var a = t.Lower(1, 600);
        if (!Is(a, "applied")) { yield return $"it wasn't lowered: {a.ToJsonString()}"; yield break; }
        using var sc = new ServiceController(RecorderPaths.ServiceName);
        sc.Stop();
        sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(40));
        if (!Rows[0].On()) yield return "the service stopped and left it off";
        var line = t.Ended(RevertId(a));
        if (t.Ledger.Rows().Count != 0 || line?["how"]?.ToString() != Revert.Raised || line["why"]?.ToString() != "stop") yield return $"it wasn't logged as raised at the stop and dropped: {line?.ToJsonString()}";
    }

    /// The service is stopped here. What a power cut would leave: one lowered and long due, one whose file is cut short,
    /// one armed and never lowered.
    static IEnumerable<string> RaisedAtStart(Service t)
    {
        using var sc = new ServiceController(RecorderPaths.ServiceName);
        if (sc.Status != ServiceControllerStatus.Stopped) { yield return "the service wasn't stopped for this check"; yield break; }
        long now = Now;
        var due = new Revert(CommandStore.NewId(), "selftest-2", Revert.Lowered, 900, now - 3 * 3600_000, now - 2 * 3600_000, By: 4);
        var never = new Revert(CommandStore.NewId(), "selftest-1", Revert.Armed, 900, now - 3 * 3600_000, now - 2 * 3600_000, By: 4);
        t.Ledger.TestOnlyPut(due);
        t.Ledger.TestOnlyPut(never);
        t.Ledger.TestOnlyPutRaw("selftest-3", "{\"id\":\"0123");
        Rows[1].Set(0);
        Rows[2].Set(0);
        sc.Start();
        sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(40));
        if (!Wait(() => t.Ledger.Rows().Count == 0, 30)) yield return $"entries were left after the start: {string.Join(", ", t.Ledger.Rows())}";
        if (!Rows[1].On()) yield return "one due while the service was off wasn't raised at its start";
        if (!Rows[2].On()) yield return "one whose file was cut short wasn't raised";
        var line = t.Ended(due.Id);
        if (line?["how"]?.ToString() != Revert.Raised || line["why"]?.ToString() != "start") yield return $"the due one wasn't logged as raised at the start: {line?.ToJsonString()}";
        if (t.Ended(never.Id)?["how"]?.ToString() != Revert.Unused) yield return "one armed and never lowered wasn't logged as unused";
        if (t.Ledger.Log().Count(l => l["row"]?.ToString() == "selftest-3" && l["how"]?.ToString() == Revert.Raised) != 1) yield return "the cut-short one wasn't logged as raised once";
    }

    static IEnumerable<string> RaisedOnUninstall(Service t)
    {
        var a = t.Lower(1, 600);
        if (!Is(a, "applied")) { yield return $"it wasn't lowered: {a.ToJsonString()}"; yield break; }
        foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(RecorderPaths.ExeName)))
            using (p) { p.Kill(); p.WaitForExit(10_000); }
        if (Rows[0].On()) yield return "killing the service raised it, so this check proves nothing";
        if (RecorderSetup.Uninstall(null) != RecorderSetup.Ok) yield return "the uninstall failed";
        if (!Rows[0].On()) yield return "the uninstall left it off";
        if (Directory.Exists(RecorderPaths.Reverts)) yield return "the ledger is still there";
        if (RecorderSetup.IsInstalled()) yield return "the service is still installed";
    }

    static IEnumerable<string> StillOffOnUninstall()
    {
        var since = DateTime.UtcNow.AddSeconds(-5);
        string row = "selftest-9";
        Ledger.Open().TestOnlyPut(new Revert(CommandStore.NewId(), row, Revert.Lowered, 60, Now - 120_000, Now - 60_000));
        int code = RecorderSetup.Uninstall(null);
        if (code != RecorderSetup.StillOff) yield return $"the uninstall answered {code}, not that a protection is still off";
        var query = new EventLogQuery("Application", PathType.LogName, $"*[System[Provider[@Name='{RecorderPaths.ServiceName}'] and TimeCreated[@SystemTime>='{since:yyyy-MM-dd'T'HH:mm:ss.fff'Z'}']]]");
        bool said = false;
        using (var reader = new EventLogReader(query))
            for (var e = reader.ReadEvent(); e != null && !said; e = reader.ReadEvent())
                using (e) said = e.ToXml().Contains(row, StringComparison.Ordinal);
        if (!said) yield return "Windows' event log doesn't say which protection is still off";
    }
}
