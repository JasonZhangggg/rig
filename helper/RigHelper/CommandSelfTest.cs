// The general command's part of --selftest. It runs on the Windows CI runner
// with the real PowerShell 5.1: every shared vector through the real parser,
// the registry, file and service snapshot code against the real registry, the
// sentinels, and whole commands previewed, applied, verified, rolled back and
// undone. Everything it writes is under RigSelftest or a temp folder and is removed.

using System.Text;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public static class CommandSelfTest
{
    const string UserKey = @"HKCU\Software\RigSelftest", MachineKey = @"HKLM\SOFTWARE\RigSelftest", UserPath = @"HKCU:\Software\RigSelftest", MachinePath = @"HKLM:\SOFTWARE\RigSelftest";
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public static List<string> Checks()
    {
        var problems = new List<string>();
        string realHome = CommandHome.Root;
        CommandHome.Root = Path.Combine(Path.GetTempPath(), $"rig-commands-{Guid.NewGuid():N}");
        var person = Person.Self();
        void Step(string what, Func<IEnumerable<string>> check)
        {
            try { problems.AddRange(check().Select(p => $"commands, {what}: {p}")); }
            catch (Exception e) { problems.Add($"commands, {what}: {e.GetType().Name}: {e.Message}"); }
        }
        try
        {
            Clean(person);
            Step("vectors", Vectors);
            Step("fingerprint", Fingerprint);
            Step("running as the person", () => AsPerson(person));
            Step("registry snapshot", () => RegistryRoundTrip(person));
            Step("file snapshot", () => FileRoundTrip(person));
            Step("service snapshot", () => ServiceRead(person));
            Step("sentinels", () => SentinelsHold(person));
            Step("a harmless change", () => Harmless(person));
            Step("a change undone after something else changed it", () => Drift(person));
            Step("a failed change", () => FailedRun(person));
            Step("a hidden write to the Run key", () => HiddenRunKey(person));
            Step("the daily limit", () => Cap(person));
            Step("a change that needs admin rights", () => NeedsApproval(person));
        }
        finally
        {
            try { Clean(person); } catch (Exception e) { problems.Add($"commands, cleaning up: {e.Message}"); }
            try { if (Directory.Exists(CommandHome.Root)) Directory.Delete(CommandHome.Root, recursive: true); } catch (Exception e) { problems.Add($"commands, cleaning up: {e.Message}"); }
            CommandHome.Root = realHome;
        }
        return problems;
    }

    static void Clean(Person person)
    {
        Reg.DeleteKey(Reg.Users, $@"{person.Sid}\Software\RigSelftest");
        Reg.DeleteValue(Reg.Users, $@"{person.Sid}\{RunKey}", "RigSelftest");
        if (Native.IsAdmin()) Reg.DeleteKey(Reg.Machine, @"SOFTWARE\RigSelftest");
    }

    static IEnumerable<string> Vectors()
    {
        var vectors = JsonNode.Parse(CommandCheck.Resource("Rig.Rules.vectors.json"))!.AsArray();
        var got = CommandCheck.Scripts(vectors.Select(v => (v!["script"]!.GetValue<string>(), v["as"]!.GetValue<string>())).ToList());
        if (vectors.Count < 40) yield return $"only {vectors.Count} vectors are built in";
        for (int i = 0; i < vectors.Count; i++)
        {
            var (want, verdict) = (vectors[i]!["expect"]!.AsObject(), got[i]);
            string label = $"{vectors[i]!["as"]} {vectors[i]!["script"]!.ToJsonString()}";
            if ((int)Json.Num(verdict["rulesVersion"], -1) != CommandCheck.RulesVersion) yield return $"{label} has no rules version";
            if (want["refused"] != null)
            {
                if (CommandCheck.Allowed(verdict)) yield return $"{label} should be refused but is tier {CommandCheck.Tier(verdict)}";
                else if ((verdict["refused"]?.GetValue<string>() ?? "").Length <= 20) yield return $"{label} is refused without saying why";
            }
            else if (!CommandCheck.Allowed(verdict)) yield return $"{label} should be allowed but: {verdict["refused"]}";
            else if (want["tier"] != null && (int)Json.Num(want["tier"], -1) != CommandCheck.Tier(verdict)) yield return $"{label} should be tier {want["tier"]} but is tier {CommandCheck.Tier(verdict)}";
            else if (vectors[i]!["as"]!.GetValue<string>() == "read" && (CommandCheck.Tier(verdict) != 0 || CommandCheck.Admin(verdict))) yield return $"{label} is a read that isn't tier 0 without admin";
            if (want["commands"] is JsonArray names)
            {
                string expected = string.Join(",", names.Select(n => n!.GetValue<string>().ToLowerInvariant()));
                string found = string.Join(",", verdict["commands"]!.AsArray().Select(c => c!["name"]!.GetValue<string>().ToLowerInvariant()));
                if (expected != found) yield return $"{label} should find {expected} but found {found}";
            }
        }
    }

    static JsonObject Command(string read, string run, string? undo, params JsonObject[] touches)
    {
        var cmd = new JsonObject { ["does"] = "Sets a value for Rig's self-test.", ["read"] = read, ["run"] = run };
        if (undo != null) cmd["undo"] = undo;
        cmd["touches"] = new JsonArray(touches);
        return cmd;
    }
    static JsonObject Value(string key, string name) => new() { ["kind"] = "registry", ["key"] = key, ["value"] = name };
    static string ReadOf(string path, string name) => $"Get-ItemProperty -Path '{path}' -Name {name} -ErrorAction SilentlyContinue";
    static string SetOf(string path, string name, int value) => $"New-Item -Path '{path}' -Force | Out-Null\nSet-ItemProperty -Path '{path}' -Name {name} -Value {value}";

    static IEnumerable<string> Fingerprint()
    {
        // The same command and fingerprint as the test of commandHash in packages/core/test/check.test.ts.
        const string desktop = @"HKCU:\Control Panel\Desktop";
        var cmd = new JsonObject
        {
            ["does"] = "Makes menus open faster.", ["read"] = $"Get-ItemProperty -Path '{desktop}' -Name MenuShowDelay",
            ["run"] = $"Set-ItemProperty -Path '{desktop}' -Name MenuShowDelay -Value 100", ["undo"] = $"Set-ItemProperty -Path '{desktop}' -Name MenuShowDelay -Value 400",
            ["touches"] = new JsonArray(Value(@"HKCU\Control Panel\Desktop", "MenuShowDelay")),
        };
        if (CommandCheck.Fingerprint(cmd) != "76e2daca77a2b65316aaaaddc0874f0f65101c3a03e38d2bef3c37a13350e766") yield return "the helper and the app work out different fingerprints for the same command";
    }

    /// The path a read takes when the helper is elevated: PowerShell started with a copy of a token, its output read through pipes.
    static IEnumerable<string> AsPerson(Person person)
    {
        if (!Native.IsAdmin()) yield break;
        string file = Path.Combine(CommandHome.Folder("person", person.Sid), "selftest.ps1");
        File.WriteAllText(file, "Write-Output \"rig-ok $env:PSModulePath\"", new UTF8Encoding(true));
        var ran = PinnedShell.RunWithToken(person, file, 60_000);
        File.Delete(file);
        if (!ran.Ok || !ran.Out.Contains("rig-ok")) yield return $"PowerShell started with the person's token answered exit {ran.Exit}: {ran.Text}";
        else if (ran.Out.Contains("Documents", StringComparison.OrdinalIgnoreCase) || !ran.Out.Contains(@"System32\WindowsPowerShell\v1.0\Modules", StringComparison.OrdinalIgnoreCase)) yield return $"the module path isn't the cleaned one: {ran.Out.Trim()}";
    }

    static IEnumerable<string> RegistryRoundTrip(Person person)
    {
        var ctx = new SnapshotContext(person, Admin: false);
        string path = $@"{person.Sid}\Software\RigSelftest\Types";
        var key = new JsonObject { ["kind"] = "registry", ["key"] = $@"{UserKey}\Types" };
        Reg.Value[] values =
        [
            new("", 1, Encoding.Unicode.GetBytes("default\0")), new("Expand", 2, Encoding.Unicode.GetBytes("%TEMP%\\x\0")), new("Multi", 7, Encoding.Unicode.GetBytes("a\0b\0\0")),
            new("Dword", 4, BitConverter.GetBytes(7)), new("Qword", 11, BitConverter.GetBytes(1L << 40)), new("Binary", 3, [1, 2, 3]), new("None", 0, [9, 9]),
            new("Odd", 0x1234, [5]), new("Empty", 1, []),
        ];

        var absent = Snapshot.Read(key, ctx);
        if (absent["key"] != null || Snapshot.Show(absent) != null) yield return "a key that isn't there doesn't read as absent";
        foreach (var v in values) Reg.SetValue(Reg.Users, path, v);
        Reg.SetValue(Reg.Users, $@"{path}\Sub\Deeper", new Reg.Value("Leaf", 1, Encoding.Unicode.GetBytes("x\0")));

        var full = Snapshot.Read(key, ctx);
        var back = Reg.ReadKey(Reg.Users, path, new Reg.Budget(100, 1 << 20));
        if (back == null || back.Values.Count != values.Length) yield return $"wrote {values.Length} values and read {back?.Values.Count}";
        else foreach (var v in values)
            if (back.Values.FirstOrDefault(b => b.Name == v.Name) is not Reg.Value b || b.Type != v.Type || !b.Data.AsSpan().SequenceEqual(v.Data)) yield return $"the value {v.Name} (type {v.Type}) didn't come back as written";
        if (Reg.Show(values[1]) != @"REG_EXPAND_SZ %TEMP%\x" || Reg.Show(values[3]) != "REG_DWORD 7") yield return "values are shown wrongly";
        // What is kept survives being written to a file and read again.
        var stored = JsonNode.Parse(full.ToJsonString())!.AsObject();
        if (Snapshot.Hash(stored) != Snapshot.Hash(full)) yield return "a stored snapshot has a different fingerprint from the one taken";

        Reg.SetValue(Reg.Users, path, new Reg.Value("Dword", 1, Encoding.Unicode.GetBytes("now text\0")));
        Reg.DeleteValue(Reg.Users, path, "Expand");
        Reg.SetValue(Reg.Users, path, new Reg.Value("Extra", 4, BitConverter.GetBytes(1)));
        Reg.DeleteKey(Reg.Users, $@"{path}\Sub");
        Reg.SetValue(Reg.Users, $@"{path}\New\Key", new Reg.Value("x", 4, BitConverter.GetBytes(1)));
        if (Snapshot.Hash(Snapshot.Read(key, ctx)) == Snapshot.Hash(full)) yield return "a changed key has the same fingerprint as before";
        foreach (string left in Snapshot.Restore(key, stored, ctx, _ => [])) yield return $"restoring a key: {left}";
        if (Snapshot.Hash(Snapshot.Read(key, ctx)) != Snapshot.Hash(full)) yield return "a restored key isn't what it was (types, deleted values, extra values or subkeys)";

        foreach (string left in Snapshot.Restore(key, absent, ctx, _ => [])) yield return $"restoring an absent key: {left}";
        if (Reg.Exists(Reg.Users, path) || Reg.Exists(Reg.Users, $@"{person.Sid}\Software\RigSelftest")) yield return "restoring an absent key left it, or the key Rig made above it, behind";

        // One value: absent, then a value of another type, then absent again, with the keys made for it removed.
        var one = Value($@"{UserKey}\One\Two", "Flag");
        var none = Snapshot.Read(one, ctx);
        if (!none.ContainsKey("value") || none["value"] != null) yield return "a value that isn't there doesn't read as absent";
        Reg.SetValue(Reg.Users, $@"{person.Sid}\Software\RigSelftest\One\Two", new Reg.Value("Flag", 2, Encoding.Unicode.GetBytes("%windir%\0")));
        var set = Snapshot.Read(one, ctx);
        if (Snapshot.Show(set) != "REG_EXPAND_SZ %windir%") yield return $"an expandable value reads as {Snapshot.Show(set)}";
        Reg.SetValue(Reg.Users, $@"{person.Sid}\Software\RigSelftest\One\Two", new Reg.Value("Flag", 4, BitConverter.GetBytes(1)));
        foreach (string left in Snapshot.Restore(one, set, ctx, _ => [])) yield return $"restoring a value: {left}";
        if (Snapshot.Hash(Snapshot.Read(one, ctx)) != Snapshot.Hash(set)) yield return "a restored value doesn't have its old type and data";
        foreach (string left in Snapshot.Restore(one, none, ctx, _ => [])) yield return $"restoring an absent value: {left}";
        if (Reg.Exists(Reg.Users, $@"{person.Sid}\Software\RigSelftest")) yield return "restoring an absent value left the keys made for it behind";

        // A subtree past the cap says so instead of passing as whole.
        for (int i = 0; i < 12; i++) Reg.SetValue(Reg.Users, $@"{person.Sid}\Software\RigSelftest\Big", new Reg.Value($"v{i}", 4, BitConverter.GetBytes(i)));
        var budget = new Reg.Budget(10, 1 << 20);
        Reg.ReadKey(Reg.Users, $@"{person.Sid}\Software\RigSelftest\Big", budget);
        if (!budget.Over) yield return "a key past the cap read as whole";
        Reg.DeleteKey(Reg.Users, $@"{person.Sid}\Software\RigSelftest");
    }

    static IEnumerable<string> FileRoundTrip(Person person)
    {
        var ctx = new SnapshotContext(person, Admin: false);
        string dir = Path.Combine(Path.GetTempPath(), $"rig-selftest-files-{Guid.NewGuid():N}"), file = Path.Combine(dir, "settings.ini");
        Directory.CreateDirectory(dir);
        try
        {
            var touch = new JsonObject { ["kind"] = "file", ["path"] = file };
            var absent = Snapshot.Read(touch, ctx, dir, "a");
            if (absent["file"] != null) yield return "a file that isn't there doesn't read as absent";
            File.WriteAllBytes(file, [1, 2, 3, 0, 255]);
            var was = Snapshot.Read(touch, ctx, dir, "b");
            File.WriteAllText(file, "changed");
            if (Snapshot.Hash(Snapshot.Read(touch, ctx)) == Snapshot.Hash(was)) yield return "a changed file has the same fingerprint as before";
            foreach (string left in Snapshot.Restore(touch, was, ctx, name => File.ReadAllBytes(Path.Combine(dir, name)))) yield return $"restoring a file: {left}";
            if (!File.ReadAllBytes(file).AsSpan().SequenceEqual(new byte[] { 1, 2, 3, 0, 255 })) yield return "a restored file doesn't hold its old bytes";
            File.WriteAllBytes(Path.Combine(dir, "b.bin"), [7]);
            if (Snapshot.Restore(touch, was, ctx, name => File.ReadAllBytes(Path.Combine(dir, name))).Count == 0) yield return "a damaged copy was put back as if it were good";
            foreach (string left in Snapshot.Restore(touch, absent, ctx, _ => [])) yield return $"restoring an absent file: {left}";
            if (File.Exists(file)) yield return "restoring an absent file left it behind";
            if (Snapshot.Partial(Snapshot.Read(new JsonObject { ["kind"] = "file", ["path"] = dir }, ctx)) == null) yield return "a folder passed as a file Rig can snapshot";
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    static IEnumerable<string> ServiceRead(Person person)
    {
        var ctx = new SnapshotContext(person, Admin: true);
        var log = Snapshot.Read(new JsonObject { ["kind"] = "service", ["name"] = "EventLog" }, ctx);
        if (Snapshot.Show(log) is not string shown || !shown.StartsWith("Automatic", StringComparison.Ordinal) || !shown.EndsWith("running", StringComparison.Ordinal)) yield return $"the event log service reads as {Snapshot.Show(log)}";
        if (Snapshot.Show(Snapshot.Read(new JsonObject { ["kind"] = "service", ["name"] = "RigSelftestNoSuchService" }, ctx)) != null) yield return "a service that isn't there doesn't read as absent";
        if (!Native.IsAdmin()) yield break;
        // Putting a service back to what it already is goes through the same calls and changes nothing.
        foreach (string left in Snapshot.Restore(new JsonObject { ["kind"] = "service", ["name"] = "EventLog" }, log, ctx, _ => [])) yield return $"restoring a service: {left}";
        if (Snapshot.Hash(Snapshot.Read(new JsonObject { ["kind"] = "service", ["name"] = "EventLog" }, ctx)) != Snapshot.Hash(log)) yield return "the event log service changed when it was put back to what it was";
    }

    static IEnumerable<string> SentinelsHold(Person person)
    {
        var (a, b) = (Sentinels.Read(person), Sentinels.Read(person));
        foreach (var hit in a.Compare(b, [])) yield return $"two reads in a row differ at {hit.Sentinel}: {hit.Before} / {hit.After}";
        Reg.SetValue(Reg.Users, $@"{person.Sid}\{RunKey}", new Reg.Value("RigSelftest", 1, Encoding.Unicode.GetBytes("RigSelftest-harmless\0")));
        var c = Sentinels.Read(person);
        var hits = a.Compare(c, []);
        if (!hits.Any(h => h.Sentinel == "run" && h.After.Contains("RigSelftest-harmless"))) yield return $"a new Run value gave {hits.Count} hits: {string.Join(", ", hits.Select(h => h.Sentinel))}";
        foreach (string left in a.Restore(c, hits, person)) yield return $"putting the Run key back: {left}";
        if (Reg.ReadValue(Reg.Users, $@"{person.Sid}\{RunKey}", "RigSelftest") != null) yield return "the Run value is still there after the sentinels were restored";
        if (!Native.IsAdmin()) yield break;
        var declared = new JsonArray(new JsonObject { ["kind"] = "service", ["name"] = "EventLog" });
        if (a.Compare(a, declared).Count != 0) yield return "a declared service is a hit with nothing changed";
    }

    static JsonObject Call(CommandRunner runner, string method, JsonObject p) => runner.Handle(method, p).AsObject();
    static string Outcome(JsonObject reply) => reply["outcome"]?.GetValue<string>() ?? "";
    static string? Now(Person person, string name, string key = "RigSelftest") => Reg.ReadValue(Reg.Users, $@"{person.Sid}\Software\{key}", name) is Reg.Value v ? Reg.Show(v) : null;

    static IEnumerable<string> Harmless(Person person)
    {
        var runner = new CommandRunner(person, restorePoints: false);
        var cmd = Command(ReadOf(UserPath, "Speed"), SetOf(UserPath, "Speed", 7), null, Value(UserKey, "Speed"));
        var check = Call(runner, "command.check", new JsonObject { ["cmd"] = cmd.DeepClone(), ["tainted"] = false })["verdict"]!.AsObject();
        if (!CommandCheck.Allowed(check) || CommandCheck.Tier(check) != 2 || CommandCheck.Admin(check)) { yield return $"command.check answered {check.ToJsonString()}"; yield break; }

        var preview = Call(runner, "command.preview", new JsonObject { ["cmd"] = cmd.DeepClone(), ["tainted"] = false });
        if (Outcome(preview) != "ready") { yield return $"preview answered {preview.ToJsonString()}"; yield break; }
        if (preview["touches"]![0]!["value"] != null) yield return "preview says the value is already there";
        if (preview["read"]!.GetValue<string>().Contains('7')) yield return $"preview's read printed {preview["read"]}";
        if (!DateTimeOffset.TryParse(preview["expiresAt"]?.GetValue<string>(), out var expires) || expires < DateTimeOffset.UtcNow || expires > DateTimeOffset.UtcNow.AddMinutes(CommandRunner.NonceMinutes + 1)) yield return "preview's nonce has no sane expiry";
        if (Now(person, "Speed") != null) yield return "preview changed something";
        if (Outcome(Call(runner, "command.apply", new JsonObject { ["nonce"] = new string('0', 32) })) != "expired") yield return "a made-up nonce didn't answer expired";

        string nonce = preview["nonce"]!.GetValue<string>();
        var applied = Call(runner, "command.apply", new JsonObject { ["nonce"] = nonce });
        if (Outcome(applied) != "applied") { yield return $"apply answered {applied.ToJsonString()}"; yield break; }
        var result = applied["result"]!.AsObject();
        if (Now(person, "Speed") != "REG_DWORD 7") yield return $"after apply the value is {Now(person, "Speed")}";
        if (result["touches"]![0]!["before"] != null || result["touches"]![0]!["after"]?.GetValue<string>() != "REG_DWORD 7") yield return $"apply reports the touch as {result["touches"]!.ToJsonString()}";
        if (result["before"]!.GetValue<string>().Contains('7') || !result["after"]!.GetValue<string>().Contains('7')) yield return $"verify printed {result["before"]} then {result["after"]}";
        var undo = applied["undo"]!.AsObject();
        if (undo["kind"]?.GetValue<string>() != "command" || undo["fingerprint"]?.GetValue<string>().Length != 64 || undo["outside"] is not JsonArray || undo["script"] != null) yield return $"apply's undo record is {undo.ToJsonString()}";

        if (Outcome(Call(runner, "command.apply", new JsonObject { ["nonce"] = nonce })) != "expired") yield return "a reused nonce didn't answer expired";
        if (Directory.GetFiles(CommandHome.Folder("pending"), "*.json").Length != 0) yield return "a used nonce is still stored";
        if (Outcome(Call(new CommandRunner(person, restorePoints: false), "command.apply", new JsonObject { ["nonce"] = nonce })) != "expired") yield return "another helper accepted this helper's nonce";

        var undone = Call(runner, "command.undo", new JsonObject { ["id"] = undo["id"]!.GetValue<string>() });
        if (Outcome(undone) != "undone" || undone["left"]!.AsArray().Count != 0) yield return $"undo answered {undone.ToJsonString()}";
        if (Now(person, "Speed") != null || Reg.Exists(Reg.Users, $@"{person.Sid}\Software\RigSelftest")) yield return "undo didn't take the value and its key back to absent";
        if (Outcome(Call(runner, "command.undo", new JsonObject { ["id"] = undo["id"]!.GetValue<string>() })) != "unknown") yield return "undoing twice didn't answer unknown";
        if (Outcome(Call(runner, "command.undo", new JsonObject { ["id"] = @"..\..\x" })) != "unknown") yield return "a made-up undo id didn't answer unknown";
    }

    static IEnumerable<string> Drift(Person person)
    {
        var runner = new CommandRunner(person, restorePoints: false);
        var cmd = Command(ReadOf(UserPath, "Speed"), SetOf(UserPath, "Speed", 7), $"Set-ItemProperty -Path '{UserPath}' -Name Other -Value 0", Value(UserKey, "Speed"), Value(UserKey, "Other"));
        Reg.SetValue(Reg.Users, $@"{person.Sid}\Software\RigSelftest", new Reg.Value("Speed", 1, Encoding.Unicode.GetBytes("slow\0")));
        var preview = Call(runner, "command.preview", new JsonObject { ["cmd"] = cmd, ["tainted"] = false });
        if (Outcome(preview) != "ready" || preview["touches"]![0]!["value"]?.GetValue<string>() != "REG_SZ slow") { yield return $"preview answered {preview.ToJsonString()}"; yield break; }
        var applied = Call(runner, "command.apply", new JsonObject { ["nonce"] = preview["nonce"]!.GetValue<string>() });
        if (Outcome(applied) != "applied") { yield return $"apply answered {applied.ToJsonString()}"; yield break; }
        if (applied["undo"]!["script"] == null) yield return "apply's undo record leaves out the undo script";

        // Something else changes the value after Rig did. Undo must leave it and say so, and still run the undo script.
        Reg.SetValue(Reg.Users, $@"{person.Sid}\Software\RigSelftest", new Reg.Value("Speed", 4, BitConverter.GetBytes(9)));
        var undone = Call(runner, "command.undo", new JsonObject { ["id"] = applied["undo"]!["id"]!.GetValue<string>() });
        if (Now(person, "Speed") != "REG_DWORD 9") yield return $"undo overwrote a value something else had changed (now {Now(person, "Speed")})";
        if (Outcome(undone) != "failed" || !undone["error"]!.GetValue<string>().Contains("changed again") || !undone["error"]!.GetValue<string>().Contains("Other")) yield return $"undo after a later change answered {undone.ToJsonString()}";
        if (Now(person, "Other") != "REG_DWORD 0") yield return "the stored undo script didn't run";
        Reg.DeleteKey(Reg.Users, $@"{person.Sid}\Software\RigSelftest");
    }

    static IEnumerable<string> FailedRun(Person person)
    {
        var runner = new CommandRunner(person, restorePoints: false);
        var cmd = Command("Get-Date", SetOf(UserPath, "Half", 1) + "\nexit 3", null, new JsonObject { ["kind"] = "registry", ["key"] = UserKey });
        var preview = Call(runner, "command.preview", new JsonObject { ["cmd"] = cmd, ["tainted"] = false });
        if (Outcome(preview) != "ready") { yield return $"preview answered {preview.ToJsonString()}"; yield break; }
        var applied = Call(runner, "command.apply", new JsonObject { ["nonce"] = preview["nonce"]!.GetValue<string>() });
        if (Outcome(applied) != "rolledBack" || applied["error"] == null || applied["sentinels"]!.AsArray().Count != 0) yield return $"a change script that failed answered {applied.ToJsonString()}";
        if (Reg.Exists(Reg.Users, $@"{person.Sid}\Software\RigSelftest")) yield return "a failed change left its key behind";
        if (Directory.Exists(Path.Combine(CommandHome.Root, "undo")) && Directory.GetDirectories(Path.Combine(CommandHome.Root, "undo")).Length != 0) yield return "a rolled-back change left an undo record";
    }

    static IEnumerable<string> HiddenRunKey(Person person)
    {
        var runner = new CommandRunner(person, restorePoints: false);
        // The touches name only a harmless value, and the Run key's path is put together while the script runs, so the check can't see it.
        string run = SetOf(UserPath, "Decoy", 1) + "\n$where = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\{0}' -f 'Run'\nSet-ItemProperty -Path $where -Name RigSelftest -Value 'RigSelftest-harmless'";
        var cmd = Command(ReadOf(UserPath, "Decoy"), run, null, Value(UserKey, "Decoy"));
        var preview = Call(runner, "command.preview", new JsonObject { ["cmd"] = cmd, ["tainted"] = false });
        if (Outcome(preview) != "ready") { yield return $"preview answered {preview.ToJsonString()}"; yield break; }
        var applied = Call(runner, "command.apply", new JsonObject { ["nonce"] = preview["nonce"]!.GetValue<string>() });
        if (Outcome(applied) != "rolledBack") yield return $"a hidden write to the Run key answered {applied.ToJsonString()}";
        else
        {
            var hits = applied["sentinels"]!.AsArray();
            if (!hits.Any(h => h!["sentinel"]!.GetValue<string>() == "run" && h["after"]!.GetValue<string>().Contains("RigSelftest-harmless") && !h["before"]!.GetValue<string>().Contains("RigSelftest-harmless")))
                yield return $"the sentinel hits are {hits.ToJsonString()}";
            if (applied["error"] != null) yield return $"the rollback reports a problem: {applied["error"]}";
            if (applied["result"]!["touches"]![0]!["after"] != null) yield return "the rollback's result still shows the decoy value";
        }
        if (Reg.ReadValue(Reg.Users, $@"{person.Sid}\{RunKey}", "RigSelftest") != null) yield return "the Run value is still there after the rollback";
        if (Now(person, "Decoy") != null || Reg.Exists(Reg.Users, $@"{person.Sid}\Software\RigSelftest")) yield return "the decoy value is still there after the rollback";
    }

    static IEnumerable<string> Cap(Person person)
    {
        var runner = new CommandRunner(person, restorePoints: false);
        File.WriteAllText(Path.Combine(CommandHome.Root, "cap.json"), new JsonObject { ["day"] = DateTime.Now.ToString("yyyy-MM-dd"), ["count"] = CommandRunner.DailyCap }.ToJsonString());
        try
        {
            var preview = Call(runner, "command.preview", new JsonObject { ["cmd"] = Command(ReadOf(UserPath, "Speed"), SetOf(UserPath, "Speed", 7), null, Value(UserKey, "Speed")), ["tainted"] = false });
            if (Outcome(preview) != "ready") { yield return $"preview answered {preview.ToJsonString()}"; yield break; }
            var applied = Call(runner, "command.apply", new JsonObject { ["nonce"] = preview["nonce"]!.GetValue<string>() });
            if (Outcome(applied) != "refused" || applied["verdict"]?["status"]?.GetValue<string>() != "refused") yield return $"apply past the daily limit answered {applied.ToJsonString()}";
            if (Now(person, "Speed") != null) yield return "a change past the daily limit still ran";
        }
        finally { File.Delete(Path.Combine(CommandHome.Root, "cap.json")); }
    }

    static IEnumerable<string> NeedsApproval(Person person)
    {
        var runner = new CommandRunner(person, restorePoints: false);
        var cmd = Command(ReadOf(MachinePath, "Speed"), SetOf(MachinePath, "Speed", 7), null, Value(MachineKey, "Speed"));
        JsonObject Preview() => Call(runner, "command.preview", new JsonObject { ["cmd"] = cmd.DeepClone(), ["tainted"] = false });
        string? Machine() => Reg.ReadValue(Reg.Machine, @"SOFTWARE\RigSelftest", "Speed") is Reg.Value v ? Reg.Show(v) : null;

        var preview = Preview();
        if (Outcome(preview) != "ready" || preview["verdict"]!["admin"]!.GetValue<bool>() != true) { yield return $"preview answered {preview.ToJsonString()}"; yield break; }
        var applied = Call(runner, "command.apply", new JsonObject { ["nonce"] = preview["nonce"]!.GetValue<string>() });
        if (Outcome(applied) != "refused") yield return $"an admin change with no approval at Windows' prompt answered {applied.ToJsonString()}";
        if (Machine() != null) yield return "an admin change ran without approval";
        if (!Native.IsAdmin()) yield break;

        // The approval the app starts behind Windows' prompt: a file with the nonce and the command, and the fingerprint the app showed.
        preview = Preview();
        string nonce = preview["nonce"]!.GetValue<string>(), file = Path.Combine(Path.GetTempPath(), $"rig-approve-selftest-{Guid.NewGuid():N}.json");
        string hash = CommandCheck.Fingerprint(cmd);
        try
        {
            var other = (JsonObject)cmd.DeepClone();
            other["run"] = cmd["run"]!.GetValue<string>().Replace("7", "8");
            File.WriteAllText(file, new JsonObject { ["nonce"] = nonce, ["cmd"] = other, ["owner"] = person.Sid }.ToJsonString());
            if (CommandRunner.ApproveFromFile(file, hash) == RecorderSetup.Ok) yield return "a command changed after Approve was approved";
            if (CommandRunner.ApproveFromFile(file, CommandCheck.Fingerprint(other)) == RecorderSetup.Ok) yield return "a command the helper never previewed was approved under another one's nonce";
            File.WriteAllText(file, new JsonObject { ["nonce"] = nonce, ["cmd"] = cmd.DeepClone(), ["owner"] = person.Sid }.ToJsonString());
            if (CommandRunner.ApproveFromFile(file, hash) != RecorderSetup.Ok) yield return $"approving the previewed command failed: {(File.Exists(file + ".result") ? File.ReadAllText(file + ".result") : "no result")}";
        }
        finally { File.Delete(file); File.Delete(file + ".result"); }

        applied = Call(runner, "command.apply", new JsonObject { ["nonce"] = nonce });
        if (Outcome(applied) != "applied") { yield return $"an approved admin change answered {applied.ToJsonString()}"; yield break; }
        if (Machine() != "REG_DWORD 7") yield return $"after an approved admin change the value is {Machine()}";
        string id = applied["undo"]!["id"]!.GetValue<string>();
        if (!id.StartsWith("a-", StringComparison.Ordinal)) yield return "an admin change's undo record isn't kept in the admin-only folder";
        var undone = Call(runner, "command.undo", new JsonObject { ["id"] = id });
        if (Outcome(undone) != "undone" || Machine() != null || Reg.Exists(Reg.Machine, @"SOFTWARE\RigSelftest")) yield return $"undoing an admin change answered {undone.ToJsonString()}";
    }
}
