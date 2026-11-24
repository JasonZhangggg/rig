// The general command's part of --selftest. It runs on the Windows CI runner
// with the real PowerShell 5.1: every shared vector through the real parser,
// the registry, file and service snapshot code against the real PC, the
// sentinels, and whole commands previewed, applied, verified, rolled back and
// undone. Everything it writes is under RigSelftest, a temp folder or its own
// store, and is removed. Each check is named, so the output says which passed.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace Rig.Helper;

public static class CommandSelfTest
{
    const string Key = @"Software\RigSelftest", RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string UserKey = @"HKCU\Software\RigSelftest", UserPath = @"HKCU:\Software\RigSelftest";

    sealed class Context(Commands rig, CommandStore store, Person person, bool elevated, string root)
    {
        public Commands Rig => rig;
        public CommandStore Store => store;
        public Person Person => person;
        public bool Elevated => elevated;
        public string Root => root;
        public JsonNode Call(string method, JsonObject p) => rig.Handle(method, p);
        public JsonNode Preview(JsonObject cmd) => Call("command.preview", new JsonObject { ["cmd"] = cmd.DeepClone() });
        public JsonNode Apply(JsonNode preview) => Call("command.apply", new JsonObject { ["nonce"] = preview["nonce"]?.ToString() });
        public JsonNode Undo(JsonNode applied, bool force = false) => Call("command.undo", new JsonObject { ["id"] = applied["undo"]?["id"]?.ToString(), ["force"] = force });
    }

    /// The summary for the self-test's output, and the problems found, each led by the check's name.
    public static (JsonObject Summary, List<string> Problems) Run()
    {
        var checks = new JsonArray();
        var problems = new List<string>();
        bool elevated = Native.IsAdmin();
        string root = elevated ? CommandStore.AdminRoot + "-selftest-" + CommandStore.NewId() : Path.Combine(Path.GetTempPath(), "rig-selftest-commands-" + CommandStore.NewId());
        Person? person = null;
        int elevation = 0;
        void Check(string name, Func<IEnumerable<string>> run)
        {
            var watch = Stopwatch.StartNew();
            List<string> found;
            try { found = run().ToList(); }
            catch (Exception e) { found = [$"stopped: {e.GetType().Name}: {e.Message}"]; }
            // A check the runner can't make says so in a line of its own, which is reported and isn't a failure.
            string? skipped = found.FirstOrDefault(f => f.StartsWith(Skip, StringComparison.Ordinal));
            if (skipped != null) found.Remove(skipped);
            var row = new JsonObject { ["name"] = name, ["ok"] = found.Count == 0, ["seconds"] = Math.Round(watch.Elapsed.TotalSeconds, 1) };
            if (skipped != null) row["skipped"] = skipped[Skip.Length..];
            if (found.Count > 0) row["problems"] = new JsonArray(found.Select(f => (JsonNode)f).ToArray());
            checks.Add(row);
            problems.AddRange(found.Select(f => $"commands, {name}: {f}"));
        }
        try
        {
            var store = new CommandStore(root, secured: elevated);
            // With admin rights the helper acts as the person through the token of the app that started it. Here the
            // self-test is that app, so the same path is taken with its own token.
            int? app = elevated ? Environment.ProcessId : null;
            person = Person.Find(app);
            elevation = person.Elevation;
            // The self-test with admin rights is an app started as administrator; it stands in for one started normally.
            var ctx = new Context(new Commands(store, app, restorePoints: false) { TestOnlyElevatedApp = elevated ? false : null }, store, person, elevated, root);
            Clean(ctx.Person);
            Check("every shared vector through PowerShell's parser", () => Vectors(ctx));
            Check("a command's fingerprint", Fingerprint);
            Check("running as the person", () => AsPerson(ctx));
            Check("scripts start in an empty folder with a clean environment", () => CleanStart(ctx));
            Check("registry snapshot round trip", () => RegistryRoundTrip(ctx));
            Check("registry restore removes the keys a change made", () => RegistryAnchors(ctx));
            Check("file snapshot round trip", () => FileRoundTrip(ctx));
            Check("admin file access refuses links", () => AdminFiles(ctx));
            Check("service snapshot round trip", () => ServiceRoundTrip(ctx));
            Check("two sentinel readings agree", () => SentinelsAgree(ctx));
            Check("a new Run value is a hit and is put back", () => SentinelPutBack(ctx));
            Check("a harmless change, applied and undone", () => Harmless(ctx));
            Check("undo after something else changed it", () => Drift(ctx));
            Check("a failed change is rolled back", () => FailedRun(ctx));
            Check("a hidden write to the Run key is caught", () => HiddenRunKey(ctx));
            Check("an app running as administrator is refused", () => ElevatedApp(ctx));
            Check("command.read", () => ReadOnly(ctx));
            Check("a step's fingerprint", StepFingerprint);
            Check("the native worker runs as the person", () => NativeWorkerRuns(ctx));
            Check("a native step, applied and undone", () => NativeApplied(ctx));
            Check("a native step that writes to the Run key is rolled back", () => NativeRunKey(ctx));
            FileEditSelfTest.Run(Check, new Commands(new CommandStore(root + "-files", secured: elevated), app, restorePoints: false) { TestOnlyElevatedApp = elevated ? false : null, TestOnlyNativeOps = true });
            Check("a native step whose worker dies after its change may have changed it", () => NativeDied(ctx));
            Check("a file that changed after its preview is refused", () => FileChanged(ctx));
            Check("HKCU for another account", OtherAccount);
            if (elevated)
            {
                Check("the command store is admins' only", () => StoreLocked(ctx));
                Check("a link planted in the store is refused and the store rebuilt", () => PlantedStore(ctx));
                Check("a store file the person's own account owns is refused and the store rebuilt", () => OwnedStore(ctx));
                Check("a store made under the object-creator owner policy is admins' own", () => CreatorOwnerStore(ctx));
                Check("a change that needs admin rights", () => NeedsApproval(ctx));
                Check("services, tasks and accounts a change made are put back", () => NeverPutBack(ctx));
                Check("a limited app token", () => LimitedToken(ctx));
                Check("a native step for an app without admin rights", () => NativeLimited(ctx));
            }
            Check("the daily limit", () => Cap(ctx));
        }
        catch (Exception e) { Check("setting up", () => [$"{e.GetType().Name}: {e.Message}"]); }
        finally
        {
            if (person != null)
            {
                try { Clean(person); } catch (Exception e) { problems.Add($"commands, cleaning up: {e.Message}"); }
                person.Dispose();
            }
            try { Directory.Delete(root, recursive: true); } catch { }
            try { Directory.Delete(root + "-files", recursive: true); } catch { }
            try { string parent = Path.GetDirectoryName(root)!; if (elevated && !Directory.EnumerateFileSystemEntries(parent).Any()) Directory.Delete(parent); } catch { }
        }
        int passed = checks.Count(c => c?["ok"]?.GetValue<bool>() == true);
        return (new JsonObject { ["passed"] = passed, ["failed"] = checks.Count - passed, ["appElevation"] = elevation, ["worker"] = workerSeen, ["checks"] = checks }, problems);
    }

    static RegistryKey Hive(Person person, string sub, out string path)
    {
        path = $@"{person.Sid}\{sub}";
        return RegistryKey.OpenBaseKey(RegistryHive.Users, RegistryView.Registry64);
    }

    static object? Value(Person person, string sub, string name)
    {
        using var hive = Hive(person, sub, out string path);
        using var k = hive.OpenSubKey(path);
        return k?.GetValue(name);
    }

    static bool Exists(Person person, string sub)
    {
        using var hive = Hive(person, sub, out string path);
        using var k = hive.OpenSubKey(path);
        return k != null;
    }

    static void Clean(Person person)
    {
        using var hive = RegistryKey.OpenBaseKey(RegistryHive.Users, RegistryView.Registry64);
        hive.DeleteSubKeyTree($@"{person.Sid}\{Key}", throwOnMissingSubKey: false);
        using (var run = hive.OpenSubKey($@"{person.Sid}\{RunKey}", writable: true)) run?.DeleteValue("RigSelftest", throwOnMissingValue: false);
        if (Native.IsAdmin()) Registry.LocalMachine.DeleteSubKeyTree(@"SOFTWARE\RigSelftest", throwOnMissingSubKey: false);
    }

    const string Skip = "skipped: ";

    static bool Is(JsonNode? n, string outcome) => n?["outcome"]?.ToString() == outcome;

    // ----- The checker -----

    static IEnumerable<string> Vectors(Context ctx)
    {
        var vectors = JsonNode.Parse(CommandCheck.Resource("Rig.Rules.vectors.json"))!.AsArray();
        static string TextOf(JsonNode v) => v["times"] is JsonNode n ? string.Join("; ", Enumerable.Repeat(v["script"]!.ToString(), (int)Json.Num(n, 1))) : v["script"]!.ToString();
        var scripts = new List<string>();
        foreach (var v in vectors)
        {
            if (v!["as"]?.ToString() != "step") scripts.Add(TextOf(v));
            else if (v["step"]?["cmd"] is JsonObject cmd) scripts.AddRange(new[] { "read", "run", "undo" }.Select(k => cmd[k]?.ToString()).OfType<string>());
        }
        var texts = scripts.Where(s => CommandCheck.Precheck(s) == null).Distinct().ToList();
        var parsed = ctx.Rig.Parse(texts);
        var problems = new List<string>();
        if (parsed.Count != texts.Count) problems.Add($"the parser answered for {parsed.Count} of {texts.Count} scripts");
        JsonNode? Parsed(string s) => texts.IndexOf(s) is int i and >= 0 && i < parsed.Count ? parsed[i] : null;

        int wrong = 0;
        foreach (var v in vectors)
        {
            string use = v!["as"]!.ToString(), label;
            Verdict got;
            if (use == "step" && v["step"]?["kind"]?.ToString() == "native")
            {
                got = ctx.Rig.Check(HelperStep.From(v["step"], out string? problem), problem).Verdict;
                label = $"step ({v["note"]})";
            }
            else if (use == "step")
            {
                var cmd = Command.From(v["step"]?["cmd"], out string? problem);
                got = CommandCheck.CheckStep(cmd, problem, list => list.Select(Parsed).ToList()).Verdict;
                label = $"step ({v["note"]}) {v["step"]?["cmd"]?["run"]}";
            }
            else
            {
                string text = TextOf(v);
                got = CommandCheck.CheckScript(text, use, Parsed(text));
                label = $"[{use}] {v["script"]}";
            }
            var want = v["expect"]!;
            string? off = want["refused"] != null
                ? (got.Allowed ? $"allowed at tier {got.Tier}" : got.Refused.Length <= 20 ? "refused without saying why" : want["why"] is JsonNode why && why.ToString() != got.Why ? $"refused as {got.Why}" : null)
                : !got.Allowed ? $"refused: {got.Refused}"
                : want["tier"] != null && (int)Json.Num(want["tier"], -1) != got.Tier ? $"tier {got.Tier}" : null;
            if (off == null && want["commands"] is JsonArray names && !names.Select(n => n!.ToString().ToLowerInvariant()).SequenceEqual(got.Commands.Select(c => c.Name.ToLowerInvariant())))
                off = $"commands {string.Join(", ", got.Commands.Select(c => c.Name))}";
            if (off == null && want["reasons"] is JsonArray reasons)
            {
                string said = got.Allowed ? string.Join(" ", got.Reasons).ToLowerInvariant() : "";
                if (reasons.Select(r => r!.ToString().ToLowerInvariant()).FirstOrDefault(r => !said.Contains(r)) is string missing) off = $"no reason saying \"{missing}\"";
            }
            if (off != null && ++wrong <= 8) problems.Add($"{(label.Length > 160 ? label[..160] + "…" : label)} gave {off}");
        }
        if (wrong > 8) problems.Add($"{wrong} of {vectors.Count} vectors gave the wrong verdict");
        return problems;
    }

    static IEnumerable<string> Fingerprint()
    {
        // packages/core/test/check.test.ts holds the same value.
        var menus = new Command("Makes menus open faster.", @"Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name MenuShowDelay",
            @"Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name MenuShowDelay -Value 100", @"Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name MenuShowDelay -Value 400",
            [new Touch("registry", @"HKCU\Control Panel\Desktop", "MenuShowDelay")]);
        if (menus.Hash() != "684001665991492c95d668bca82a394c0671daabf81b71ae978766d18c07e053") yield return $"it is {menus.Hash()}, not the app's";
    }

    static IEnumerable<string> OtherAccount()
    {
        var mine = new Command("x", "Get-Date", @"Set-ItemProperty -Path 'HKLM:\SOFTWARE\RigSelftest' -Name A -Value 1", null, [new Touch("registry", @"HKCU\Software\RigSelftest", null)]);
        var machine = mine with { Touches = [new Touch("registry", @"HKLM\SOFTWARE\RigSelftest", null)] };
        var hidden = machine with { Run = @"Set-ItemProperty -Path 'Registry::HKEY_CURRENT_USER\Software\RigSelftest' -Name A -Value 1" };
        if (Commands.OtherAccount(true, "S-1-5-21-1-1-1-500", "S-1-5-21-1-1-1-1001", mine, []) == null) yield return "an admin command touching HKCU for another account wasn't refused";
        if (Commands.OtherAccount(true, "S-1-5-21-1-1-1-500", "S-1-5-21-1-1-1-1001", hidden, []) == null) yield return "an admin command naming HKEY_CURRENT_USER in its script for another account wasn't refused";
        if (Commands.OtherAccount(true, "S-1-5-21-1-1-1-500", "S-1-5-21-1-1-1-1001", machine, []) != null) yield return "an admin command under HKLM only was refused";
        if (Commands.OtherAccount(true, "S-1-5-21-1-1-1-1001", "S-1-5-21-1-1-1-1001", mine, []) != null) yield return "an admin command for the same account was refused";
        if (Commands.OtherAccount(false, "S-1-5-21-1-1-1-500", "S-1-5-21-1-1-1-1001", mine, []) != null) yield return "a command without admin rights was refused";
    }

    // ----- Running as the person -----

    static IEnumerable<string> AsPerson(Context ctx)
    {
        if (ctx.Person.Sid != Person.Mine()) yield return "the person isn't the account that started the self-test";
        if (ctx.Elevated && ctx.Person.Here) yield return "with admin rights, scripts would run with the helper's own rights";
        string file = Path.Combine(ctx.Store.PersonScripts(ctx.Person.Sid), "as-person.ps1");
        PowerShellHost.Write(file, "Write-Output ('rig-as-' + 'person'); $env:PSModulePath", stopOnError: true);
        var watch = Stopwatch.StartNew();
        var ran = ctx.Person.Run(file, Commands.ReadTimeoutMs, ctx.Store.Empty());
        File.Delete(file);
        if (!ran.Ok || !ran.Out.Contains("rig-as-person")) yield return $"PowerShell didn't run as the person ({(ran.TimedOut ? "timed out" : $"exit {ran.Exit}")}): {ran.Printed}";
        else if (ran.Out.Split('\n').Skip(1).FirstOrDefault()?.Trim() is string modules && modules.Contains(';')) yield return $"the module path wasn't pinned: {modules}";
        if (watch.Elapsed.TotalSeconds > 15) yield return $"it took {watch.Elapsed.TotalSeconds:0} seconds";
    }

    static IEnumerable<string> CleanStart(Context ctx)
    {
        const string Leak = "RIG_SELFTEST_LEAK", Stray = "rig-selftest-stray.txt";
        string system = Path.Combine(Environment.SystemDirectory, Stray);
        string script = $"(Get-Location).Path; \"cor=$env:COR_ENABLE_PROFILING\"; \"leak=$env:{Leak}\"; \"path=$env:Path\"; \"temp=$env:TEMP\"; Set-Content -Path {Stray} -Value x -ErrorAction SilentlyContinue";
        Environment.SetEnvironmentVariable("COR_ENABLE_PROFILING", "1");
        Environment.SetEnvironmentVariable(Leak, "1");
        var runs = new List<(string Who, PowerShellHost.Ran Ran, string Folder)>();
        try
        {
            string file = Path.Combine(ctx.Store.PersonScripts(ctx.Person.Sid), "clean-start.ps1");
            PowerShellHost.Write(file, script, stopOnError: false);
            string folder = ctx.Store.Empty();
            runs.Add(("the person", ctx.Person.Run(file, Commands.ReadTimeoutMs, folder), folder));
            File.Delete(file);
            if (ctx.Elevated)
            {
                file = Path.Combine(ctx.Store.Work, "clean-start.ps1");
                PowerShellHost.Write(file, script, stopOnError: false);
                folder = ctx.Store.Empty();
                runs.Add(("admin rights", PowerShellHost.RunHere(PowerShellHost.Args(file), Commands.ReadTimeoutMs, folder, ctx.Store.Work), folder));
                File.Delete(file);
            }
        }
        finally
        {
            Environment.SetEnvironmentVariable("COR_ENABLE_PROFILING", null);
            Environment.SetEnvironmentVariable(Leak, null);
        }
        string sys = Environment.SystemDirectory;
        foreach (var (who, ran, folder) in runs)
        {
            var lines = ran.Out.Split('\n').Select(l => l.Trim()).ToList();
            string Of(string name) => lines.FirstOrDefault(l => l.StartsWith(name + "=", StringComparison.Ordinal))?[(name.Length + 1)..] ?? "(missing)";
            if (!ran.Ok || lines.Count < 5) { yield return $"with {who}, the script didn't run ({(ran.TimedOut ? "timed out" : $"exit {ran.Exit}")}): {ran.Printed}"; continue; }
            if (!string.Equals(lines[0].TrimEnd('\\'), folder.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) yield return $"with {who}, it started in {lines[0]}, not the empty folder";
            if (Of("cor") != "" || Of("leak") != "") yield return $"with {who}, the helper's own environment reached the script";
            if (!string.Equals(Of("path"), $@"{sys};{sys}\WindowsPowerShell\v1.0", StringComparison.OrdinalIgnoreCase)) yield return $"with {who}, the path was {Of("path")}";
            if (who == "admin rights" && !string.Equals(Of("temp").TrimEnd('\\'), ctx.Store.Work.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) yield return $"with admin rights, temp was {Of("temp")}";
        }
        if (File.Exists(system)) { try { File.Delete(system); } catch { } yield return "a relative write landed in System32"; }
        string again = ctx.Store.Empty();
        if (Directory.EnumerateFileSystemEntries(again).Any()) yield return "the empty folder wasn't emptied before the next run";
        if (ctx.Elevated && new DirectoryInfo(again).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>()
            .Any(r => r.AccessControlType == AccessControlType.Allow && r.IdentityReference.Value is not ("S-1-5-18" or "S-1-5-32-544") && (r.FileSystemRights & (FileSystemRights.WriteData | FileSystemRights.AppendData | FileSystemRights.Delete | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership)) != 0))
            yield return "someone besides admins can change the empty folder";
    }

    // ----- Snapshots -----

    static IEnumerable<string> RegistryRoundTrip(Context ctx)
    {
        var states = new TouchStates(ctx.Person, admin: false);
        string sub = Key + @"\Types";
        using (var hive = Hive(ctx.Person, sub, out string path))
        using (var k = hive.CreateSubKey(path, writable: true))
        {
            k.SetValue("Text", "menus", RegistryValueKind.String);
            k.SetValue("Expand", @"%SystemRoot%\rig", RegistryValueKind.ExpandString);
            k.SetValue("Dword", unchecked((int)0xFFFFFFF0), RegistryValueKind.DWord);
            k.SetValue("Qword", unchecked((long)0xFFFFFFFFFFFFFFF0), RegistryValueKind.QWord);
            k.SetValue("Multi", new[] { "a", "b" }, RegistryValueKind.MultiString);
            k.SetValue("Binary", new byte[] { 0, 1, 254, 255 }, RegistryValueKind.Binary);
            k.SetValue("None", new byte[] { 7 }, RegistryValueKind.None);
            k.SetValue("", "default");
            using var child = k.CreateSubKey("Child");
            child.SetValue("Inner", 5, RegistryValueKind.DWord);
        }
        var whole = new Touch("registry", $@"{UserKey}\Types", null);
        var one = new Touch("registry", $@"{UserKey}\Types", "Dword");
        // A snapshot is kept as JSON in the record and read back from it, so it is held to that, not to the object in memory.
        var kept = JsonNode.Parse(states.Read(whole)!.ToJsonString());
        var keptOne = JsonNode.Parse(states.Read(one)!.ToJsonString());
        using (var hive = Hive(ctx.Person, sub, out string path))
        using (var k = hive.OpenSubKey(path, writable: true)!)
        {
            k.SetValue("Text", 3, RegistryValueKind.DWord);
            k.DeleteValue("Qword");
            k.SetValue("Dword", 1, RegistryValueKind.DWord);
            k.SetValue("Added", "x");
            k.DeleteSubKeyTree("Child");
            k.CreateSubKey("Extra")!.Dispose();
        }
        states.Write(whole, kept!, null);
        if (!TouchStates.SameCore(states.Read(whole), kept)) yield return "a whole key didn't come back as it was";
        using (var hive = Hive(ctx.Person, sub, out string path))
        using (var k = hive.OpenSubKey(path)!)
        {
            if (k.GetValueKind("Text") != RegistryValueKind.String || k.GetValue("Text") as string != "menus") yield return "a text value came back as the wrong type";
            if (k.GetValueKind("Expand") != RegistryValueKind.ExpandString) yield return "an expandable text value came back as the wrong type";
            if (k.GetValueKind("Dword") != RegistryValueKind.DWord || unchecked((uint)(int)k.GetValue("Dword")!) != 0xFFFFFFF0) yield return "a number with its top bit set came back wrong";
            if (k.GetValueKind("Qword") != RegistryValueKind.QWord) yield return "a 64-bit number came back as the wrong type";
            if (k.GetValueKind("None") != RegistryValueKind.None) yield return "a value of no type came back as another type";
            if (k.GetValue("Added") != null || k.OpenSubKey("Extra") != null || k.OpenSubKey("Child") == null) yield return "values and subkeys weren't put back as they were";
        }
        using (var hive = Hive(ctx.Person, sub, out string path))
        using (var k = hive.OpenSubKey(path, writable: true)!) k.SetValue("Dword", "now text");
        states.Write(one, keptOne!, null);
        using (var hive = Hive(ctx.Person, sub, out string path))
        using (var k = hive.OpenSubKey(path)!)
            if (k.GetValueKind("Dword") != RegistryValueKind.DWord || unchecked((uint)(int)k.GetValue("Dword")!) != 0xFFFFFFF0) yield return "one value didn't come back with its type";
        if (TouchStates.Show(one, keptOne) != "4294967280") yield return $"the card would show the value as {TouchStates.Show(one, keptOne)}";
    }

    static IEnumerable<string> RegistryAnchors(Context ctx)
    {
        var states = new TouchStates(ctx.Person, admin: false);
        using (var hive = Hive(ctx.Person, Key, out string path)) hive.CreateSubKey(path)!.Dispose();
        var value = new Touch("registry", $@"{UserKey}\A\B\C", "Flag");
        var whole = new Touch("registry", $@"{UserKey}\New\Deep", null);
        var wasValue = JsonNode.Parse(states.Read(value)!.ToJsonString());
        var wasWhole = JsonNode.Parse(states.Read(whole)!.ToJsonString());
        if (!TouchStates.IsAbsent(wasWhole)) yield return "a key that isn't there wasn't read as absent";
        using (var hive = Hive(ctx.Person, Key, out string path))
        {
            using (var c = hive.CreateSubKey(path + @"\A\B\C")!) c.SetValue("Flag", 1);
            using (var d = hive.CreateSubKey(path + @"\New\Deep\Er")!) d.SetValue("V", 1);
        }
        states.Write(value, wasValue!, null);
        states.Write(whole, wasWhole!, null);
        if (Exists(ctx.Person, Key + @"\A")) yield return "putting a value back left behind the keys the change made for it";
        if (Exists(ctx.Person, Key + @"\New")) yield return "putting a key back left behind the keys the change made above it";
        if (!Exists(ctx.Person, Key)) yield return "putting things back removed a key that was there before";
        if (!TouchStates.SameCore(states.Read(value), wasValue) || !TouchStates.SameCore(states.Read(whole), wasWhole)) yield return "reading again after the restore doesn't match the snapshot";
    }

    static IEnumerable<string> FileRoundTrip(Context ctx)
    {
        var states = new TouchStates(ctx.Person, admin: ctx.Elevated);
        string dir = Path.Combine(Path.GetTempPath(), "rig-selftest-files-" + CommandStore.NewId());
        Directory.CreateDirectory(dir);
        try
        {
            string file = Path.Combine(dir, "settings.ini"), copy = Path.Combine(ctx.Store.Work, "file.bin"), copy2 = Path.Combine(ctx.Store.Work, "file2.bin");
            File.WriteAllText(file, "[rig]\nlevel=1\n");
            var t = new Touch("file", file, null);
            var was = JsonNode.Parse(states.Read(t, copy)!.ToJsonString());
            File.WriteAllText(file, "changed");
            states.Write(t, was!, copy);
            if (File.ReadAllText(file) != "[rig]\nlevel=1\n" || !TouchStates.SameCore(states.Read(t), was)) yield return "a file didn't come back as it was";
            var fresh = new Touch("file", Path.Combine(dir, "new.txt"), null);
            var none = states.Read(fresh, copy2);
            File.WriteAllText(fresh.Text, "made by the change");
            states.Write(fresh, none!, copy2);
            if (File.Exists(fresh.Text)) yield return "a file the change made wasn't removed";
            if (!ctx.Elevated) yield break;

            // Under ProgramData, in a folder only admins could have made, the helper's own rights do it.
            string machine = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "RigSelftest-" + CommandStore.NewId());
            Directory.CreateDirectory(machine);
            try
            {
                var m = new Touch("file", Path.Combine(machine, "app.cfg"), null);
                File.WriteAllText(m.Text, "one");
                if (!AdminFile.Trusted(m.Text)) yield return "a file in a folder the helper made under ProgramData wasn't trusted";
                string mcopy = Path.Combine(ctx.Store.Work, "m.bin");
                var mwas = states.Read(m, mcopy);
                File.WriteAllText(m.Text, "two");
                states.Write(m, mwas!, mcopy);
                if (File.ReadAllText(m.Text) != "one") yield return "a file under ProgramData didn't come back with admin rights";
            }
            finally { Directory.Delete(machine, recursive: true); }
        }
        finally { try { Directory.Delete(dir, recursive: true); } catch { } }
    }

    static IEnumerable<string> AdminFiles(Context ctx)
    {
        string machine = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "RigSelftest-" + CommandStore.NewId());
        string target = Path.Combine(machine, "target"), link = Path.Combine(machine, "link");
        Directory.CreateDirectory(target);
        try
        {
            File.WriteAllText(Path.Combine(target, "x.txt"), "target");
            var mk = Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "cmd.exe"), $"/c mklink /J \"{link}\" \"{target}\"") { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true });
            mk!.WaitForExit(10_000);
            if (!Directory.Exists(link)) { yield return "the test couldn't make a junction"; yield break; }
            if (AdminFile.Trusted(Path.Combine(link, "x.txt"))) yield return "a path through a junction was trusted for the helper's admin rights";
            var states = new TouchStates(ctx.Person, admin: true);
            string? read = null;
            try { states.Read(new Touch("file", Path.Combine(link, "x.txt"), null)); read = "read"; }
            catch (RigException e) { read = e.Message; }
            if (read == null) yield return "reading through a junction gave nothing";
            if (ctx.Elevated)
            {
                string sym = Path.Combine(machine, "sym.txt");
                bool made = false;
                try { File.CreateSymbolicLink(sym, Path.Combine(target, "x.txt")); made = true; } catch (IOException) { } catch (UnauthorizedAccessException) { }
                if (made)
                {
                    string? refused = null;
                    try { AdminFile.Write(sym, "over"u8.ToArray()); } catch (RigException e) { refused = e.Message; }
                    if (refused == null || File.ReadAllText(Path.Combine(target, "x.txt")) != "target") yield return "an admin write followed a link to another file";
                }
            }
        }
        finally
        {
            try { if (Directory.Exists(link)) Directory.Delete(link); } catch { }
            try { Directory.Delete(machine, recursive: true); } catch { }
        }
    }

    static IEnumerable<string> ServiceRoundTrip(Context ctx)
    {
        string? name = new[] { "Spooler", "W32Time" }.FirstOrDefault(n => Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{n}") is RegistryKey k && k.GetValue("Start") is int);
        if (name == null) { yield return "no test service is installed"; yield break; }
        var t = new Touch("service", name, null);
        var states = new TouchStates(ctx.Person, admin: true);
        var was = JsonNode.Parse(states.Read(t)!.ToJsonString())!;
        if (was["start"] == null) { yield return "the service's start type wasn't read"; yield break; }
        var flipped = was.DeepClone().AsObject();
        flipped["running"] = !(was["running"]?.GetValue<bool>() ?? false);
        if (!TouchStates.SameCore(was, flipped)) yield return "whether a service runs counted as a change";
        if (!ctx.Elevated) yield break;
        var other = was.DeepClone().AsObject();
        other["start"] = (int)Json.Num(was["start"], 3) == 3 ? 4 : 3;
        try
        {
            states.Write(t, other, null);
            if ((int)Json.Num(states.Read(t)?["start"], -1) != (int)Json.Num(other["start"], -1)) yield return "the start type wasn't changed";
        }
        finally { states.Write(t, was, null); }
        if (!TouchStates.SameCore(states.Read(t), was)) yield return "the service didn't come back as it was";
    }

    // ----- Sentinels -----

    static IEnumerable<string> SentinelsAgree(Context ctx)
    {
        var watch = new Sentinels(ctx.Person, ctx.Store.Work);
        var (before, moving) = watch.Baseline();
        var again = watch.Read();
        var off = Sentinels.Differences(before, again, [], moving);
        if (off.Count > 0) yield return $"a third reading differs with nothing run: {string.Join("; ", Sentinels.Hits(before, again, off).Select(h => $"{h.Sentinel}: {h.Before} -> {h.After}"))}";
        if (before.Values.Any(items => items.ContainsKey("(Rig couldn't read all of this)"))) yield return $"some sentinels couldn't be read: {string.Join(", ", before.Where(kv => kv.Value.ContainsKey("(Rig couldn't read all of this)")).Select(kv => kv.Key))}";
    }

    static IEnumerable<string> SentinelPutBack(Context ctx)
    {
        var watch = new Sentinels(ctx.Person, ctx.Store.Work);
        bool had = Exists(ctx.Person, RunKey);
        var (before, moving) = watch.Baseline();
        using (var hive = Hive(ctx.Person, RunKey, out string path))
        using (var k = hive.CreateSubKey(path, writable: true)!) k.SetValue("RigSelftest", "rig-selftest");
        var after = watch.Read();
        var hits = Sentinels.Differences(before, after, [], moving);
        if (!hits.Any(h => h.Sentinel == "run")) yield return "a new Run value wasn't a hit";
        watch.PutBack(before, after, hits, admin: false);
        if (Value(ctx.Person, RunKey, "RigSelftest") != null) yield return "the Run value wasn't put back";
        if (!had && Exists(ctx.Person, RunKey)) yield return "the Run key the write made wasn't removed";
    }

    // ----- Whole commands -----

    static JsonObject Harmless() => new()
    {
        ["does"] = "Sets a test value.",
        ["read"] = $@"Get-ItemProperty -Path '{UserPath}' -Name Flag -ErrorAction SilentlyContinue",
        ["run"] = $@"New-Item -Path '{UserPath}' -Force | Out-Null; Set-ItemProperty -Path '{UserPath}' -Name Flag -Value 1",
        ["undo"] = $@"Remove-ItemProperty -Path '{UserPath}' -Name Flag -ErrorAction SilentlyContinue",
        ["touches"] = new JsonArray(new JsonObject { ["kind"] = "registry", ["key"] = UserKey, ["value"] = "Flag" }),
    };

    static IEnumerable<string> Harmless(Context ctx)
    {
        Clean(ctx.Person);
        var cmd = Harmless();
        if (ctx.Call("command.check", new JsonObject { ["cmd"] = cmd.DeepClone() })["verdict"]?["status"]?.ToString() != "allowed") yield return "command.check refused it";
        var p = ctx.Preview(cmd);
        if (!Is(p, "ready") || p["verdict"]?["admin"]?.GetValue<bool>() != false) { yield return $"the preview wasn't ready: {p.ToJsonString()}"; yield break; }
        if (p["touches"] is not JsonArray { Count: 1 } shown || shown[0]!["value"] != null) yield return "the preview didn't show the test value as absent";
        if (Exists(ctx.Person, Key)) yield return "a preview changed the registry";
        var a = ctx.Apply(p);
        if (!Is(a, "applied")) { yield return $"it wasn't applied: {a.ToJsonString()}"; yield break; }
        if (Value(ctx.Person, Key, "Flag") is not 1) yield return "it didn't write its value";
        if (a["result"]?["touches"]?[0]?["before"] != null || a["result"]?["touches"]?[0]?["after"]?.ToString() != "1") yield return "apply didn't report the value before and after";
        if (a["result"]?["before"]?.ToString().Contains("Flag") != false || a["result"]?["after"]?.ToString().Contains("Flag") != true) yield return $"running read again didn't show the change: {a["result"]?.ToJsonString()}";
        if (!Is(ctx.Apply(p), "expired")) yield return "a nonce worked twice";
        if (!Is(ctx.Call("command.apply", new JsonObject { ["nonce"] = CommandStore.NewId() }), "expired")) yield return "a made-up nonce wasn't answered expired";
        var u = ctx.Undo(a);
        if (!Is(u, "undone") || u["left"] is not JsonArray { Count: 0 }) yield return $"undo didn't finish cleanly: {u.ToJsonString()}";
        if (Exists(ctx.Person, Key)) yield return "undo didn't put the test key back to absent";
        if (!Is(ctx.Undo(a), "unknown")) yield return "a change could be undone twice";
    }

    static IEnumerable<string> Drift(Context ctx)
    {
        Clean(ctx.Person);
        var a = ctx.Apply(ctx.Preview(Harmless()));
        if (!Is(a, "applied")) { yield return $"it wasn't applied: {a.ToJsonString()}"; yield break; }
        using (var hive = Hive(ctx.Person, Key, out string path))
        using (var k = hive.CreateSubKey(path, writable: true)!) k.SetValue("Flag", 7);
        var u = ctx.Undo(a);
        if (!Is(u, "drifted") || u["changed"] is not JsonArray { Count: 1 } || Value(ctx.Person, Key, "Flag") is not 7) yield return $"undo didn't stop at a later change: {u.ToJsonString()}";
        var f = ctx.Undo(a, force: true);
        if (!Is(f, "undone") || Exists(ctx.Person, Key)) yield return $"undo with force didn't put it back: {f.ToJsonString()}";
    }

    static IEnumerable<string> FailedRun(Context ctx)
    {
        Clean(ctx.Person);
        var failing = Harmless();
        failing["run"] = $@"New-Item -Path '{UserPath}' -Force | Out-Null; Set-ItemProperty -Path '{UserPath}' -Name Flag -Value 1; Get-Item -Path 'HKCU:\Software\RigSelftest\Missing'; Set-ItemProperty -Path '{UserPath}' -Name After -Value 1";
        var a = ctx.Apply(ctx.Preview(failing));
        if (!Is(a, "rolledBack") || a["error"] == null) yield return $"a change that failed wasn't rolled back: {a.ToJsonString()}";
        if (Value(ctx.Person, Key, "After") != null) yield return "the change kept running after its first error";
        if (Exists(ctx.Person, Key)) yield return "the rollback left the test key behind";
    }

    static IEnumerable<string> HiddenRunKey(Context ctx)
    {
        Clean(ctx.Person);
        bool had = Exists(ctx.Person, RunKey);
        var sneaky = Harmless();
        var p = ctx.Preview(sneaky);
        if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
        // What the check can't see: a write to the Run key, making the key first so the write itself can't fail.
        ctx.Rig.TestOnlyExtra = @"$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }; Set-ItemProperty -LiteralPath $k -Name RigSelftest -Value 'rig-selftest'";
        JsonNode a;
        try { a = ctx.Apply(p); }
        finally { ctx.Rig.TestOnlyExtra = null; }
        if (!Is(a, "rolledBack") || a["sentinels"] is not JsonArray hit || !hit.Any(h => h?["sentinel"]?.ToString() == "run" && h["after"]?.ToString().Contains("rig-selftest") == true))
            yield return $"the write wasn't reported as a Run key hit: {a.ToJsonString()}";
        if (a["error"] != null || a["left"] is not JsonArray { Count: 0 }) yield return $"the rollback reported something left over: {a["error"]} {a["left"]?.ToJsonString()}";
        if (Value(ctx.Person, RunKey, "RigSelftest") != null) yield return "the Run value was left behind";
        if (!had && Exists(ctx.Person, RunKey)) yield return "the Run key the write made was left behind";
        if (Exists(ctx.Person, Key)) yield return "the rollback left the test key behind";
    }

    static IEnumerable<string> ElevatedApp(Context ctx)
    {
        Clean(ctx.Person);
        var p = ctx.Preview(Harmless());
        if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
        bool? was = ctx.Rig.TestOnlyElevatedApp;
        ctx.Rig.TestOnlyElevatedApp = true;
        JsonNode a;
        try { a = ctx.Apply(p); }
        finally { ctx.Rig.TestOnlyElevatedApp = was; }
        if (!Is(a, "refused") || a["verdict"]?["refused"]?.ToString() != Commands.AppElevated) yield return $"it wasn't refused in the app's words: {a.ToJsonString()}";
        if (Exists(ctx.Person, Key)) yield return "the change ran";
        if (!Is(ctx.Apply(p), "applied")) yield return "the card couldn't ask again once Rig ran normally";
        Clean(ctx.Person);
    }

    static IEnumerable<string> ReadOnly(Context ctx)
    {
        var r = ctx.Call("command.read", new JsonObject { ["script"] = @"Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name MenuShowDelay" });
        if (r["printed"]?.ToString().Contains("MenuShowDelay") != true) yield return $"a plain read didn't print: {r.ToJsonString()}";
        var c = ctx.Call("command.read", new JsonObject { ["script"] = $@"Set-ItemProperty -Path '{UserPath}' -Name Flag -Value 1" });
        if (c["verdict"]?["status"]?.ToString() != "refused" || c["printed"] != null || Exists(ctx.Person, Key)) yield return $"a change was run as a read: {c.ToJsonString()}";
    }

    // ----- Admin rights -----

    static IEnumerable<string> StoreLocked(Context ctx)
    {
        var rules = new DirectoryInfo(ctx.Root).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>();
        if (rules.Any(r => r.IdentityReference.Value is not ("S-1-5-18" or "S-1-5-32-544"))) yield return "more than admins and the system can reach it";
        if (!ctx.Store.Sound()) yield return "the store as Rig set it up has something in it that isn't admins' own";
    }

    static IEnumerable<string> PlantedStore(Context ctx)
    {
        Clean(ctx.Person);
        var p = ctx.Preview(Harmless());
        if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
        string target = Path.Combine(Path.GetTempPath(), "rig-selftest-planted-" + CommandStore.NewId()), link = Path.Combine(ctx.Root, "records", "planted");
        Directory.CreateDirectory(target);
        JsonNode a;
        try
        {
            Directory.CreateSymbolicLink(link, target);
            a = ctx.Apply(p);
        }
        finally { try { Directory.Delete(target, recursive: true); } catch { } }
        if (!Is(a, "refused") || a["verdict"]?["refused"]?.ToString() != Commands.StoreRebuilt) yield return $"it wasn't refused in the store's words: {a.ToJsonString()}";
        if (Exists(ctx.Person, Key)) yield return "the change ran";
        if (new DirectoryInfo(link).Exists || File.Exists(link)) yield return "the planted link was left in the store";
        if (!ctx.Store.Sound()) yield return "the rebuilt store isn't sound";
        if (!Is(ctx.Apply(ctx.Preview(Harmless())), "applied")) yield return "a change couldn't run once the store was rebuilt";
        Clean(ctx.Person);
    }

    static readonly SecurityIdentifier Admins = new(WellKnownSidType.BuiltinAdministratorsSid, null);

    static SecurityIdentifier? OwnerOf(FileSystemInfo item) =>
        (item is DirectoryInfo d ? d.GetAccessControl(AccessControlSections.Owner) : (FileSystemSecurity)((FileInfo)item).GetAccessControl(AccessControlSections.Owner)).GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;

    /// The account this runs as, when it isn't one the store trusts as an owner.
    static SecurityIdentifier? Untrusted()
    {
        using var id = WindowsIdentity.GetCurrent();
        return id.User is SecurityIdentifier me && !me.IsWellKnown(WellKnownSidType.LocalSystemSid) ? me : null;
    }

    static IEnumerable<string> OwnedStore(Context ctx)
    {
        if (Untrusted() is not SecurityIdentifier me) { yield return Skip + "this runs as the system, which the store trusts as an owner"; yield break; }
        Clean(ctx.Person);
        var p = ctx.Preview(Harmless());
        if (!Is(p, "ready")) { yield return $"the test command was refused before it ran: {p.ToJsonString()}"; yield break; }
        var file = new FileInfo(Path.Combine(ctx.Root, "records", "owned.json"));
        File.WriteAllText(file.FullName, "{}");
        var sec = file.GetAccessControl(AccessControlSections.Owner);
        sec.SetOwner(me);
        file.SetAccessControl(sec);
        if (!Equals(OwnerOf(file), me)) { yield return Skip + "Windows wouldn't make this runner's own account the owner of a file in the store"; yield break; }
        var a = ctx.Apply(p);
        if (!Is(a, "refused") || a["verdict"]?["refused"]?.ToString() != Commands.StoreRebuilt) yield return $"it wasn't refused in the store's words: {a.ToJsonString()}";
        if (Exists(ctx.Person, Key)) yield return "the change ran";
        if (File.Exists(file.FullName)) yield return "the file the person's account owns was left in the store";
        if (!ctx.Store.Sound()) yield return "the rebuilt store isn't sound";
        if (!Is(ctx.Apply(ctx.Preview(Harmless())), "applied")) yield return "a change couldn't run once the store was rebuilt";
        Clean(ctx.Person);
    }

    /// Stands in for a PC whose policy makes an admin's new files the admin's own: the self-test's token is told to make
    /// them its own account's, and a new store is set up and used under it.
    static IEnumerable<string> CreatorOwnerStore(Context ctx)
    {
        if (Untrusted() is not SecurityIdentifier me) { yield return Skip + "this runs as the system, which the store trusts as an owner"; yield break; }
        if (Native.DefaultOwner() is not SecurityIdentifier was) { yield return Skip + "Windows wouldn't say who owns what this process makes"; yield break; }
        string root = CommandStore.AdminRoot + "-selftest-owner-" + CommandStore.NewId(), probe = Path.Combine(Path.GetTempPath(), "rig-selftest-owner-" + CommandStore.NewId());
        try
        {
            if (!Native.SetDefaultOwner(me)) { yield return Skip + "Windows wouldn't make this runner's own account the owner of what it makes"; yield break; }
            var made = Directory.CreateDirectory(probe);
            if (!Equals(OwnerOf(made), me)) { yield return Skip + "this runner's new folders aren't its own account's even when told so"; yield break; }
            var store = new CommandStore(root, secured: true);
            if (!Equals(Native.DefaultOwner(), Admins)) yield return "setting up the store didn't make Administrators the owner of what the helper makes";
            if (!store.Sound()) yield return "the new store has something in it that isn't admins' own";
            Clean(ctx.Person);
            var rig = new Commands(store, Environment.ProcessId, restorePoints: false) { TestOnlyElevatedApp = false };
            var p = rig.Handle("command.preview", new JsonObject { ["cmd"] = Harmless() });
            if (!Is(p, "ready")) { yield return $"the preview wasn't ready: {p.ToJsonString()}"; yield break; }
            var a = rig.Handle("command.apply", new JsonObject { ["nonce"] = p["nonce"]?.ToString() });
            if (!Is(a, "applied")) { yield return $"it wasn't applied: {a.ToJsonString()}"; yield break; }
            if (!store.Sound()) yield return "the store has something in it that isn't admins' own after a change";
            var u = rig.Handle("command.undo", new JsonObject { ["id"] = a["undo"]?["id"]?.ToString() });
            if (!Is(u, "undone")) yield return $"it wasn't undone: {u.ToJsonString()}";
        }
        finally
        {
            Native.SetDefaultOwner(was);
            Clean(ctx.Person);
            try { Directory.Delete(probe, recursive: true); } catch { }
            try { Directory.Delete(root, recursive: true); } catch { }
            try { Directory.Delete(root + "-files", recursive: true); } catch { }
        }
    }

    static IEnumerable<string> NeedsApproval(Context ctx)
    {
        var system = new JsonObject
        {
            ["does"] = "Sets a test value for all accounts.",
            ["read"] = @"Get-ItemProperty -Path 'HKLM:\SOFTWARE\RigSelftest' -Name Flag -ErrorAction SilentlyContinue",
            ["run"] = @"New-Item -Path 'HKLM:\SOFTWARE\RigSelftest' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\SOFTWARE\RigSelftest' -Name Flag -Value 1",
            ["touches"] = new JsonArray(new JsonObject { ["kind"] = "registry", ["key"] = @"HKLM\SOFTWARE\RigSelftest" }),
        };
        static bool There() { using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\RigSelftest"); return k != null; }
        string hash = Command.From(system, out _)!.Hash(), request = Path.Combine(ctx.Store.Work, "approve.json");
        var p = ctx.Preview(system);
        if (p["verdict"]?["admin"]?.GetValue<bool>() != true) { yield return $"a change under HKLM wasn't marked as needing admin rights: {p.ToJsonString()}"; yield break; }
        if (!Is(ctx.Apply(p), "declined") || There()) yield return "an admin command without Windows' prompt wasn't answered declined, or ran";
        File.WriteAllText(request, new JsonObject { ["nonce"] = p["nonce"]?.ToString(), ["owner"] = ctx.Person.Sid }.ToJsonString());
        if (Commands.ApproveFromFile(request, new string('0', 64), ctx.Store) != Commands.Changed) yield return "an approval with the wrong fingerprint was accepted";
        File.WriteAllText(request, new JsonObject { ["nonce"] = p["nonce"]?.ToString(), ["owner"] = "S-1-5-21-0-0-0-1" }.ToJsonString());
        if (Commands.ApproveFromFile(request, hash, ctx.Store) != Commands.Changed) yield return "an approval for another account was accepted";
        File.WriteAllText(request, new JsonObject { ["nonce"] = p["nonce"]?.ToString(), ["owner"] = ctx.Person.Sid }.ToJsonString());
        if (Commands.ApproveFromFile(request, hash, ctx.Store) != RecorderSetup.Ok) yield return "an approval with the right fingerprint was turned down";
        var a = ctx.Apply(p);
        if (!Is(a, "applied") || Registry.LocalMachine.OpenSubKey(@"SOFTWARE\RigSelftest")?.GetValue("Flag") is not 1) { yield return $"an approved admin command didn't run: {a.ToJsonString()}"; yield break; }
        var u = ctx.Undo(a);
        if (!Is(u, "undone") || There()) yield return $"undo didn't remove the admin test key: {u.ToJsonString()}";
    }

    const string TestService = "RigSelftestService", TestTask = "RigSelftestTask", TestUser = "RigSelftestUser", StartService = "W32Time";

    static PowerShellHost.Ran Admin(Context ctx, string script)
    {
        string file = Path.Combine(ctx.Store.Work, CommandStore.NewId() + ".ps1");
        PowerShellHost.Write(file, script, stopOnError: false);
        try { return PowerShellHost.RunHere(PowerShellHost.Args(file), Commands.RunTimeoutMs, ctx.Store.Empty(), ctx.Store.Work); }
        finally { File.Delete(file); }
    }

    static int? StartOf(string service) => Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{service}")?.GetValue("Start") as int?;

    static IEnumerable<string> NeverPutBack(Context ctx)
    {
        int? start = StartOf(StartService);
        if (start == null) { yield return $"{StartService} isn't installed"; yield break; }
        string other = start == 4 ? "Manual" : "Disabled";
        var system = new JsonObject
        {
            ["does"] = "Sets a test value for all accounts.",
            ["read"] = @"Get-ItemProperty -Path 'HKLM:\SOFTWARE\RigSelftest' -Name Flag -ErrorAction SilentlyContinue",
            ["run"] = @"New-Item -Path 'HKLM:\SOFTWARE\RigSelftest' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\SOFTWARE\RigSelftest' -Name Flag -Value 1",
            ["touches"] = new JsonArray(new JsonObject { ["kind"] = "registry", ["key"] = @"HKLM\SOFTWARE\RigSelftest" }),
        };
        var p = ctx.Preview(system);
        File.WriteAllText(Path.Combine(ctx.Store.Work, "approve.json"), new JsonObject { ["nonce"] = p["nonce"]?.ToString(), ["owner"] = ctx.Person.Sid }.ToJsonString());
        if (Commands.ApproveFromFile(Path.Combine(ctx.Store.Work, "approve.json"), Command.From(system, out _)!.Hash(), ctx.Store) != RecorderSetup.Ok) { yield return "the test change couldn't be approved"; yield break; }
        var admins = Accounts.Administrators();
        ctx.Rig.TestOnlyExtra = $@"New-Service -Name {TestService} -BinaryPathName '%SystemRoot%\System32\svchost.exe -k RigSelftest' -StartupType Disabled | Out-Null
Register-ScheduledTask -TaskName {TestTask} -Action (New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit') -Trigger (New-ScheduledTaskTrigger -Once -At '2030-01-01T00:00:00') -User 'NT AUTHORITY\SYSTEM' | Out-Null
New-LocalUser -Name {TestUser} -NoPassword | Out-Null
Add-LocalGroupMember -SID S-1-5-32-544 -Member {TestUser}
Set-Service -Name {StartService} -StartupType {other}";
        JsonNode a;
        try { a = ctx.Apply(p); }
        finally { ctx.Rig.TestOnlyExtra = null; }
        try
        {
            var hit = (a["sentinels"] as JsonArray)?.Select(h => h?["sentinel"]?.ToString()).ToHashSet() ?? [];
            if (!Is(a, "rolledBack")) yield return $"it wasn't rolled back: {a.ToJsonString()}";
            foreach (string s in new[] { "services", "scheduledTasks", "localUsers", "administrators" })
                if (!hit.Contains(s)) yield return $"{s} wasn't a hit";
            if (a["left"] is not JsonArray { Count: 0 }) yield return $"it said it couldn't put back: {a["left"]?.ToJsonString()}";
            if (Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{TestService}") != null) yield return "the new service is still there";
            if (File.Exists(Path.Combine(Environment.SystemDirectory, "Tasks", TestTask))) yield return "the new scheduled task is still there";
            if (Accounts.Users().Any(u => u.Name.Equals(TestUser, StringComparison.OrdinalIgnoreCase))) yield return "the new account is still there";
            if (!Accounts.Administrators().ToHashSet().SetEquals(admins)) yield return "who is an administrator didn't come back as it was";
            if (StartOf(StartService) != start) yield return $"{StartService} starts as {StartOf(StartService)}, not {start}";
            using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\RigSelftest")) if (k != null) yield return "the test key the change made is still there";
        }
        finally
        {
            Admin(ctx, $@"sc.exe delete {TestService} | Out-Null
Unregister-ScheduledTask -TaskName {TestTask} -Confirm:$false -ErrorAction SilentlyContinue
Remove-LocalUser -Name {TestUser} -ErrorAction SilentlyContinue");
            using (var k = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{StartService}", writable: true)) k?.SetValue("Start", start!.Value, RegistryValueKind.DWord);
            Registry.LocalMachine.DeleteSubKeyTree(@"SOFTWARE\RigSelftest", throwOnMissingSubKey: false);
        }
    }

    static IEnumerable<string> LimitedToken(Context ctx)
    {
        IntPtr app = IntPtr.Zero, token = IntPtr.Zero;
        int pid = 0;
        string? cant = null;
        try { app = Limited.Start(Path.Combine(Environment.SystemDirectory, "PING.EXE") + " -n 600 127.0.0.1", out pid, out token); }
        catch (InvalidOperationException e) { cant = e.Message; }
        if (cant != null) { yield return $"{Skip}the runner couldn't make a limited token: {cant}"; yield break; }
        try
        {
            using var person = Person.Find(pid);
            if (person.Sid != ctx.Person.Sid) yield return "the limited token is another account";
            var rig = new Commands(ctx.Store, pid, restorePoints: false) { TestOnlyElevatedApp = false };
            string file = Path.Combine(ctx.Store.PersonScripts(person.Sid), "limited.ps1");
            PowerShellHost.Write(file, "Write-Output ('rig-' + 'limited'); ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')", stopOnError: true);
            var ran = person.Run(file, Commands.ReadTimeoutMs, ctx.Store.Empty());
            File.Delete(file);
            if (!ran.Ok || !ran.Out.Contains("rig-limited"))
            {
                // Whether any console program starts with that token on this runner, through Windows' logon service and directly.
                string cmd = Path.Combine(Environment.SystemDirectory, "cmd.exe"), folder = ctx.Store.Empty();
                string Try(bool service)
                {
                    try
                    {
                        var r = UserProcess.RunAs(token, cmd, "/c echo rig-cmd", 10_000, desktop: null, PowerShellHost.Clean(folder), folder, logonService: service, keep: PowerShellHost.Theirs);
                        return r.TimedOut ? "timed out" : r.Out.Contains("rig-cmd") ? "ran" : $"exit {r.Exit}";
                    }
                    catch (RigException e) { return e.Message; }
                }
                string viaService = Try(true), direct = Try(false);
                string why = $"PowerShell with the limited token {(ran.TimedOut ? "timed out" : $"exit {ran.Exit}: {ran.Printed}")}; cmd.exe through the logon service {viaService}, started directly {direct}";
                yield return viaService != "ran" && direct != "ran" ? $"{Skip}this runner starts no console program with a medium-integrity token ({why})" : why;
                yield break;
            }
            if (!ran.Out.Contains("False")) yield return $"the script ran as an administrator: {ran.Out.Trim()}";
            Clean(ctx.Person);
            var p = rig.Handle("command.preview", new JsonObject { ["cmd"] = Harmless() });
            if (!Is(p, "ready") || p["verdict"]?["admin"]?.GetValue<bool>() != false) { yield return $"the test command wasn't ready without admin rights: {p.ToJsonString()}"; yield break; }
            rig.TestOnlyExtra = @"New-Item -Path 'HKLM:\SOFTWARE\RigSelftest' -Force | Out-Null";
            JsonNode a;
            try { a = rig.Handle("command.apply", new JsonObject { ["nonce"] = p["nonce"]?.ToString() }); }
            finally { rig.TestOnlyExtra = null; }
            using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\RigSelftest")) if (k != null) yield return "a command without admin rights wrote under HKLM";
            if (!Is(a, "rolledBack")) yield return $"the failed HKLM write wasn't rolled back: {a.ToJsonString()}";
            if (Exists(ctx.Person, Key)) yield return "the rollback left the test key behind";
        }
        finally
        {
            Limited.Stop(app, token);
            Registry.LocalMachine.DeleteSubKeyTree(@"SOFTWARE\RigSelftest", throwOnMissingSubKey: false);
            Clean(ctx.Person);
        }
    }

    /// A stand-in for a Rig app started normally: the self-test's own token with its administrators group turned off and
    /// its privileges taken away, at medium integrity, as Windows' everyday token for an administrator is.
    static class Limited
    {
        public static IntPtr Start(string cmd, out int pid, out IntPtr limited, bool lua = true)
        {
            IntPtr own = IntPtr.Zero, token = IntPtr.Zero, sid = IntPtr.Zero;
            try
            {
                if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, out own)) throw Win("open its own token");
                if (!CreateRestrictedToken(own, lua ? DISABLE_MAX_PRIVILEGE | LUA_TOKEN : 0, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out token)) throw Win("CreateRestrictedToken");
                if (!ConvertStringSidToSidW("S-1-16-8192", out sid)) throw Win("ConvertStringSidToSid");
                var label = new TOKEN_MANDATORY_LABEL { Sid = sid, Attributes = SE_GROUP_INTEGRITY };
                if (!SetTokenInformation(token, TokenIntegrityLevel, ref label, Marshal.SizeOf<TOKEN_MANDATORY_LABEL>() + GetLengthSid(sid))) throw Win("set medium integrity");
                var si = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFO>() };
                if (!CreateProcessAsUserW(token, null, new System.Text.StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, false, CREATE_NO_WINDOW, IntPtr.Zero, null, ref si, out PROCESS_INFORMATION pi)) throw Win("CreateProcessAsUser");
                CloseHandle(pi.hThread);
                pid = pi.dwProcessId;
                limited = token;
                token = IntPtr.Zero;
                return pi.hProcess;
            }
            finally
            {
                if (sid != IntPtr.Zero) LocalFree(sid);
                if (token != IntPtr.Zero) CloseHandle(token);
                if (own != IntPtr.Zero) CloseHandle(own);
            }
        }

        public static void Stop(IntPtr process, IntPtr limited)
        {
            if (limited != IntPtr.Zero) CloseHandle(limited);
            if (process == IntPtr.Zero) return;
            TerminateProcess(process, 0);
            CloseHandle(process);
        }

        static InvalidOperationException Win(string what) => new($"{what} failed with Windows error {Marshal.GetLastWin32Error()}");

        const uint TOKEN_ASSIGN_PRIMARY = 0x1, TOKEN_DUPLICATE = 0x2, TOKEN_QUERY = 0x8, TOKEN_ADJUST_DEFAULT = 0x80, DISABLE_MAX_PRIVILEGE = 0x1, LUA_TOKEN = 0x4, SE_GROUP_INTEGRITY = 0x20, CREATE_NO_WINDOW = 0x08000000;
        const int TokenIntegrityLevel = 25;

        [StructLayout(LayoutKind.Sequential)] struct TOKEN_MANDATORY_LABEL { public IntPtr Sid; public uint Attributes; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct STARTUPINFO
        {
            public int cb; public string? lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }
        [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)]
        static extern bool CreateRestrictedToken(IntPtr token, uint flags, int disableCount, IntPtr disable, int deleteCount, IntPtr delete, int restrictCount, IntPtr restrict, out IntPtr newToken);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSidW(string sid, out IntPtr psid);
        [DllImport("advapi32.dll")] static extern int GetLengthSid(IntPtr sid);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int infoClass, ref TOKEN_MANDATORY_LABEL info, int length);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CreateProcessAsUserW(IntPtr token, string? app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string? cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    }

    static IEnumerable<string> Cap(Context ctx)
    {
        Clean(ctx.Person);
        int counted = 0;
        while (counted <= Commands.DailyCap && ctx.Store.CountToday(Commands.DailyCap)) counted++;
        if (ctx.Store.CountToday(Commands.DailyCap)) yield return "the count went past the daily limit";
        var a = ctx.Apply(ctx.Preview(Harmless()));
        if (!Is(a, "limit") || !DateTimeOffset.TryParse(a["until"]?.ToString(), out var until) || until <= DateTimeOffset.UtcNow) yield return $"a change past the daily limit wasn't answered limit: {a.ToJsonString()}";
        if (Exists(ctx.Person, Key)) yield return "a change past the daily limit ran";
        ctx.Rig.TestOnlyNativeOps = true;
        try
        {
            var n = StepApply(ctx.Rig, StepPreview(ctx.Rig, NativeStep("rig-cap")));
            if (!Is(n, "limit")) yield return $"a native step past the daily limit wasn't answered limit: {n.ToJsonString()}";
            if (Exists(ctx.Person, Key)) yield return "a native step past the daily limit ran";
        }
        finally { ctx.Rig.TestOnlyNativeOps = false; }
    }

    // ----- Native steps -----

    /// What the worker said of itself, for the self-test's output.
    static JsonObject? workerSeen;

    static JsonObject NativeStep(string value, bool run = false)
    {
        var op = new JsonObject { ["name"] = "selftest", ["value"] = value };
        if (run) op["run"] = true;
        return new JsonObject { ["kind"] = "native", ["op"] = op };
    }

    static JsonNode StepPreview(Commands rig, JsonObject step) => rig.Handle("step.preview", new JsonObject { ["step"] = step.DeepClone() });
    static JsonNode StepApply(Commands rig, JsonNode preview) => rig.Handle("step.apply", new JsonObject { ["nonce"] = preview["nonce"]?.ToString() });
    static JsonNode StepUndo(Commands rig, JsonNode applied, bool force = false) => rig.Handle("step.undo", new JsonObject { ["id"] = applied["undo"]?["id"]?.ToString(), ["force"] = force });
    static NativeOpStep TestOp(string value) => (NativeOpStep)HelperStep.From(NativeStep(value), out _)!;

    static IEnumerable<string> StepFingerprint()
    {
        // packages/core/test/check.test.ts holds the same value.
        string? hash = HelperStep.From(NativeStep("rig", run: true), out _)?.Hash();
        if (hash != "50bcf6ce4cdf697f2b1132c10add612042fab4e88029143c42eed35ed06afbf6") yield return $"a native step's is {hash}, not the app's";
        string wrote = HelperStep.Encoded(JsonNode.Parse("""{"b":[1,-2,true,null],"a":"x"}"""));
        if (wrote != "o2{s1:as1:xs1:ba4[n1;n-2;tz]}") yield return $"a value is written {wrote}";
        bool fraction;
        try { HelperStep.Encoded(JsonNode.Parse("1.5")); fraction = true; } catch (RigException) { fraction = false; }
        if (fraction) yield return "a fraction was fingerprinted";
        var command = HelperStep.From(new JsonObject { ["kind"] = "command", ["cmd"] = Harmless() }, out _);
        if (command?.Hash() != Command.From(Harmless(), out _)!.Hash()) yield return "a command step's isn't the command's own";
        if (HelperStep.Sent("command.preview", new JsonObject { ["cmd"] = Harmless() }, out _)?.Hash() != command?.Hash()) yield return "a command sent the way an older Rig app sends it isn't the same step";
        if (HelperStep.From(new JsonObject { ["kind"] = "fix", ["call"] = new JsonObject() }, out _) != null) yield return "a fix was taken as a step to approve by nonce";
    }

    static IEnumerable<string> NativeWorkerRuns(Context ctx)
    {
        Clean(ctx.Person);
        using var me = WindowsIdentity.GetCurrent();
        int mine = Native.Integrity(me.Token), session = Process.GetCurrentProcess().SessionId;
        var said = NativeWorker.Ask(ctx.Person, ctx.Store, "preview", TestOp("rig-worker"), null, selfTest: true);
        workerSeen = new JsonObject { ["ok"] = said.Ok, ["integrity"] = said.Integrity, ["session"] = said.Session, ["personIntegrity"] = ctx.Person.Integrity, ["helperIntegrity"] = mine, ["helperSession"] = session };
        if (!said.Ok) { yield return $"the worker didn't answer: {said.Error}"; yield break; }
        if (said.Result["now"]?.ToString() != "Not set") yield return $"the worker read {said.Result.ToJsonString()}";
        if (said.Integrity == 0 || said.Integrity != ctx.Person.Integrity) yield return $"the worker ran at integrity 0x{said.Integrity:x}, and the person's programs run at 0x{ctx.Person.Integrity:x}";
        if (said.Session != session) yield return $"the worker ran in session {said.Session}, not the helper's {session}";
        // Outside the self-test the worker doesn't know the test op, and with admin rights in force it does nothing at all.
        var real = NativeWorker.Ask(ctx.Person, ctx.Store, "apply", TestOp("rig-worker"), null, selfTest: false);
        workerSeen["outsideSelfTest"] = real.Error;
        if (real.Ok || real.Error is not (NativeWorker.NoDesktop or Commands.AppElevated or Commands.UnknownOp)) yield return $"the worker took the test op outside the self-test: {real.Error}";
        if (Exists(ctx.Person, Key)) yield return "the worker made the test op's change outside the self-test";
    }

    static int Counted(Context ctx)
    {
        try { return (int)Json.Num(JsonNode.Parse(File.ReadAllText(Path.Combine(ctx.Store.Root, "cap.json")))?["count"], 0); }
        catch (IOException) { return 0; }
    }

    static IEnumerable<string> NativeApplied(Context ctx)
    {
        Clean(ctx.Person);
        var rig = ctx.Rig;
        var step = NativeStep("rig-1");
        var unknown = StepPreview(rig, step);
        if (!Is(unknown, "refused") || unknown["verdict"]?["refused"]?.ToString() != Commands.UnknownOp) yield return $"the test op was known outside the self-test's own switch: {unknown.ToJsonString()}";
        rig.TestOnlyNativeOps = true;
        try
        {
            if (rig.Handle("step.check", new JsonObject { ["step"] = step.DeepClone() })["verdict"]?["status"]?.ToString() != "allowed") yield return "step.check refused it";
            var p = StepPreview(rig, step);
            if (!Is(p, "ready") || p["nonce"] == null || Json.Num(p["verdict"]?["tier"], 0) != 2 || p["verdict"]?["admin"]?.GetValue<bool>() != false || p["read"]?.ToString() != "Not set")
            {
                yield return $"the preview wasn't ready: {p.ToJsonString()}";
                yield break;
            }
            if (Exists(ctx.Person, Key)) yield return "a preview changed the registry";
            if (p["hash"]?.ToString() != TestOp("rig-1").Hash()) yield return $"the preview didn't give the stored step's fingerprint: {p["hash"]}";

            // The stored step is swapped for another after the preview.
            string file = Path.Combine(ctx.Store.Root, "pending", p["nonce"] + ".json");
            var stored = JsonNode.Parse(File.ReadAllText(file))!;
            stored["step"]!["op"]!["value"] = "rig-swapped";
            File.WriteAllText(file, stored.ToJsonString());
            var swapped = StepApply(rig, p);
            if (!Is(swapped, "refused") || Exists(ctx.Person, Key)) yield return $"a step changed after its preview wasn't refused, or ran: {swapped.ToJsonString()}";
            if (!Is(StepApply(rig, p), "expired")) yield return "the nonce of a changed step still worked";

            int counted = Counted(ctx);
            p = StepPreview(rig, step);
            var a = StepApply(rig, p);
            if (!Is(a, "applied")) { yield return $"it wasn't applied: {a.ToJsonString()}"; yield break; }
            if (Value(ctx.Person, Key, SelftestOp.Value) as string != "rig-1") yield return "the worker didn't write the value";
            if (a["undo"]?["kind"]?.ToString() != "native" || a["result"]?["before"]?.ToString() != "Not set" || a["result"]?["after"]?.ToString() != "rig-1") yield return $"apply didn't report the state before and after: {a.ToJsonString()}";
            if (Counted(ctx) != counted + 1) yield return $"the daily count went from {counted} to {Counted(ctx)}";
            if (!Is(StepApply(rig, p), "expired") || !Is(ctx.Apply(p), "expired")) yield return "a nonce worked twice";

            using (var hive = Hive(ctx.Person, Key, out string path))
            using (var k = hive.CreateSubKey(path, writable: true)!) k.SetValue(SelftestOp.Value, "someone-else");
            var u = StepUndo(rig, a);
            if (!Is(u, "drifted") || Value(ctx.Person, Key, SelftestOp.Value) as string != "someone-else") yield return $"undo didn't stop at a later change: {u.ToJsonString()}";
            var f = StepUndo(rig, a, force: true);
            if (!Is(f, "undone") || f["printed"]?.ToString() != "Not set" || Exists(ctx.Person, Key)) yield return $"undo with force didn't put it back: {f.ToJsonString()}";
            if (!Is(StepUndo(rig, a), "unknown")) yield return "a change could be undone twice";

            // A command goes the same way under the new names.
            var c = StepApply(rig, StepPreview(rig, new JsonObject { ["kind"] = "command", ["cmd"] = Harmless() }));
            if (!Is(c, "applied") || c["undo"]?["kind"]?.ToString() != "command" || Value(ctx.Person, Key, "Flag") is not 1) yield return $"a command sent as a step wasn't applied: {c.ToJsonString()}";
            else if (!Is(StepUndo(rig, c), "undone") || Exists(ctx.Person, Key)) yield return "a command sent as a step wasn't undone";
        }
        finally
        {
            rig.TestOnlyNativeOps = false;
            Clean(ctx.Person);
        }
    }

    static IEnumerable<string> NativeRunKey(Context ctx)
    {
        Clean(ctx.Person);
        var rig = ctx.Rig;
        rig.TestOnlyNativeOps = true;
        try
        {
            var p = StepPreview(rig, NativeStep("rig-2", run: true));
            if (!Is(p, "ready")) { yield return $"the preview wasn't ready: {p.ToJsonString()}"; yield break; }
            var a = StepApply(rig, p);
            if (!Is(a, "rolledBack") || a["sentinels"] is not JsonArray hit || !hit.Any(h => h?["sentinel"]?.ToString() == "run" && h["after"]?.ToString().Contains("rig-selftest-native") == true))
                yield return $"the write wasn't reported as a Run key hit: {a.ToJsonString()}";
            if (a["left"] is not JsonArray { Count: 0 }) yield return $"the rollback reported something left over: {a["left"]?.ToJsonString()}";
            if (Value(ctx.Person, RunKey, "RigSelftest") != null) yield return "the Run value was left behind";
            if (Exists(ctx.Person, Key)) yield return "the op's own change was left behind";
        }
        finally
        {
            rig.TestOnlyNativeOps = false;
            Clean(ctx.Person);
        }
    }

    static IEnumerable<string> NativeDied(Context ctx)
    {
        Clean(ctx.Person);
        var rig = ctx.Rig;
        string cap = Path.Combine(ctx.Store.Root, "cap.json");
        string? count = File.Exists(cap) ? File.ReadAllText(cap) : null;
        rig.TestOnlyNativeOps = true;
        try
        {
            var step = NativeStep("rig-3");
            step["op"]!["die"] = true;
            var p = StepPreview(rig, step);
            if (!Is(p, "ready")) { yield return $"the preview wasn't ready: {p.ToJsonString()}"; yield break; }
            var a = StepApply(rig, p);
            if (!Is(a, "rolledBack") || a["left"] is not JsonArray left || !left.Any(l => l?.ToString().StartsWith("This may still be changed", StringComparison.Ordinal) == true && l.ToString().Contains("rig-3")))
                yield return $"a worker that died after its change wasn't reported as having maybe changed it: {a.ToJsonString()}";
        }
        finally
        {
            rig.TestOnlyNativeOps = false;
            Clean(ctx.Person);
            // Later checks need room under the daily limit.
            if (count != null) File.WriteAllText(cap, count);
        }
    }

    static IEnumerable<string> FileChanged(Context ctx)
    {
        // A long path: a short one (RUNNER~1) is refused by the check.
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RigSelftest-" + CommandStore.NewId());
        Directory.CreateDirectory(dir);
        try
        {
            string file = Path.Combine(dir, "driver.inf");
            File.WriteAllText(file, "one");
            var cmd = new JsonObject
            {
                ["does"] = "Writes a test file.",
                ["read"] = $"Get-FileHash -LiteralPath '{file}' -Algorithm SHA256 | Format-List -Property Hash",
                ["run"] = $"Set-Content -LiteralPath '{file}' -Value 'two'",
                ["undo"] = $"Set-Content -LiteralPath '{file}' -Value 'one'",
                ["touches"] = new JsonArray(new JsonObject { ["kind"] = "file", ["path"] = file }),
            };
            var p = ctx.Preview(cmd);
            if (!Is(p, "ready")) { yield return $"the preview wasn't ready: {p.ToJsonString()}"; yield break; }
            File.WriteAllText(file, "swapped");
            var a = ctx.Apply(p);
            if (!Is(a, "refused") || a["verdict"]?["refused"]?.ToString().Contains("changed since you looked at it") != true) yield return $"a file that changed after its preview wasn't refused: {a.ToJsonString()}";
            if (File.ReadAllText(file) != "swapped") yield return "the change ran on a file that changed after its preview";
        }
        finally { try { Directory.Delete(dir, recursive: true); } catch { } }
    }

    /// The Rig app's token is the person's everyday one: the worker must run at its level, below the helper's own.
    static IEnumerable<string> NativeLimited(Context ctx)
    {
        var tried = new List<string>();
        var found = new List<string>();
        bool ran = false;
        // The token Windows gives an everyday app first; then, for runners that start nothing with that one, the self-test's
        // own token lowered to the same level.
        foreach (bool lua in new[] { true, false })
        {
            if (ran) break;
            string what = lua ? "a limited token" : "its own token at medium integrity";
            IntPtr app = IntPtr.Zero, token = IntPtr.Zero;
            int pid = 0;
            try { app = Limited.Start(Path.Combine(Environment.SystemDirectory, "PING.EXE") + " -n 600 127.0.0.1", out pid, out token, lua); }
            catch (InvalidOperationException e) { tried.Add($"{what}: {e.Message}"); continue; }
            try
            {
                Person person;
                try { person = Person.Find(pid); }
                catch (RigException e) { tried.Add($"{what}: {e.Message}"); continue; }
                using var mine = person;
                var said = NativeWorker.Ask(person, ctx.Store, "preview", TestOp("rig-limited"), null, selfTest: true, timeoutMs: 20_000);
                if (!said.Ok) { tried.Add($"{what}: {said.Error}"); continue; }
                ran = true;
                workerSeen ??= [];
                workerSeen["withoutAdminRights"] = new JsonObject { ["token"] = what, ["integrity"] = said.Integrity, ["personIntegrity"] = person.Integrity };
                if (said.Integrity != Native.MediumIntegrity) found.Add($"with {what} as the app's, the worker ran at integrity 0x{said.Integrity:x}");
                var rig = new Commands(ctx.Store, pid, restorePoints: false) { TestOnlyElevatedApp = false, TestOnlyNativeOps = true };
                Clean(ctx.Person);
                var a = StepApply(rig, StepPreview(rig, NativeStep("rig-limited")));
                if (!Is(a, "applied") || Value(ctx.Person, Key, SelftestOp.Value) as string != "rig-limited") found.Add($"with {what} the step wasn't applied: {a.ToJsonString()}");
                else if (!Is(StepUndo(rig, a), "undone") || Exists(ctx.Person, Key)) found.Add($"with {what} the step wasn't undone");
            }
            finally
            {
                Limited.Stop(app, token);
                Clean(ctx.Person);
            }
        }
        if (!ran) found.Add($"{Skip}this runner starts no worker with a medium-integrity token ({string.Join("; ", tried)})");
        return found;
    }
}
