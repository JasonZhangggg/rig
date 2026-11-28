// The helper task's part of --selftest (HelperTask.cs). With admin rights, as on CI's Windows runner, it registers a
// test task of its own ("RigHelperSelftest-<SID>", pointing at this program and naming this program as the app), reads
// it back, runs it the way the app does and talks to the helper it starts over a real pipe, checks a run with extra
// arguments slipped into the pipe's value is refused, and removes the task again.

using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public static class HelperTaskSelfTest
{
    const string Skip = "skipped: ";
    const string TestPrefix = "RigHelperSelftest-";

    public static (JsonObject Summary, List<string> Problems) Run()
    {
        var checks = new JsonArray();
        var problems = new List<string>();
        var notes = new JsonObject();
        void Check(string name, Func<IEnumerable<string>> run)
        {
            List<string> found;
            try { found = run().ToList(); } catch (Exception e) { found = [$"stopped: {e.GetType().Name}: {e.Message}"]; }
            string? skipped = found.FirstOrDefault(f => f.StartsWith(Skip, StringComparison.Ordinal));
            if (skipped != null) found.Remove(skipped);
            var row = new JsonObject { ["name"] = name, ["ok"] = found.Count == 0 };
            if (skipped != null) row["skipped"] = skipped[Skip.Length..];
            if (found.Count > 0) row["problems"] = new JsonArray(found.Select(f => (JsonNode)f).ToArray());
            checks.Add(row);
            problems.AddRange(found.Select(f => $"helper task, {name}: {f}"));
        }
        Check("the task's helper takes only its own command line", Arguments);
        Check("the task's helper serves only the Rig.exe it names, as the same account", Serves);
        Check("the task runs with the account's full rights, at normal priority, with no time limit", TaskXml);
        Check("a copy of another build isn't started", Builds);
        Check("registered, read back, started like the app does, and answered over the pipe", () => EndToEnd(notes));
        int passed = checks.Count(c => c?["ok"]?.GetValue<bool>() == true);
        return (new JsonObject { ["passed"] = passed, ["failed"] = checks.Count - passed, ["checks"] = checks, ["seen"] = notes }, problems);
    }

    static string NewPipe() => @"\\.\pipe\rig-helper-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    static IEnumerable<string> Arguments()
    {
        string app = @"C:\Users\someone\AppData\Local\Rig\Rig.exe", pipe = NewPipe();
        string[] Line(string p, string parent) => [HelperTask.Flag, "--app-exe", app, "--pipe", p, "--parent", parent];
        if (HelperTask.ParseTaskArgs(Line(pipe, "1234")) is not { } ok || ok.AppExe != app || ok.Pipe != pipe || ok.Parent != 1234)
            yield return "the task's own command line was refused";
        // What Task Scheduler would hand over if the app's values carried more arguments in them.
        var refused = new Dictionary<string, string[]>
        {
            ["an approval slipped into the pipe"] = [HelperTask.Flag, "--app-exe", app, "--pipe", pipe, "--approve-step", @"C:\x.json", "--parent", "1"],
            ["an install slipped into the process id"] = [HelperTask.Flag, "--app-exe", app, "--pipe", pipe, "--parent", "1", "--install-recorder"],
            ["a pipe that isn't Rig's"] = Line(@"\\.\pipe\something-else", "1"),
            ["a pipe name with more after it"] = Line(pipe + "0", "1"),
            ["a process id that isn't a number"] = Line(pipe, "1 --selftest"),
            ["a negative process id"] = Line(pipe, "-4"),
            ["a process id of 0"] = Line(pipe, "0"),
            ["an app that isn't a full path"] = [HelperTask.Flag, "--app-exe", "Rig.exe", "--pipe", pipe, "--parent", "1"],
            ["the arguments in another order"] = [HelperTask.Flag, "--pipe", pipe, "--app-exe", app, "--parent", "1"],
            ["no task flag first"] = ["--selftest", "--app-exe", app, "--pipe", pipe, "--parent", "1"],
        };
        foreach (var (what, line) in refused)
            if (HelperTask.ParseTaskArgs(line) != null) yield return $"{what} was taken";
        if (HelperTask.Start([HelperTask.StartFlag, "--pipe", @"\\.\pipe\x", "--parent", "1"]) != HelperTask.BadArgs) yield return "--start-task took a pipe that isn't Rig's";
        if (HelperTask.Start([HelperTask.StartFlag, "--pipe", pipe, "--parent", "x"]) != HelperTask.BadArgs) yield return "--start-task took a process id that isn't a number";
        if (HelperTask.Arguments(app) != $"--from-task --app-exe \"{app}\" --pipe $(Arg0) --parent $(Arg1)") yield return $"the task's arguments are {HelperTask.Arguments(app)}";
    }

    static IEnumerable<string> Serves()
    {
        string app = @"C:\Users\someone\AppData\Local\Rig\Rig.exe", sid = "S-1-5-21-1-2-3-1001";
        if (!HelperTask.Serves(app, app.ToUpperInvariant(), sid, sid)) yield return "the named Rig.exe was refused";
        if (HelperTask.Serves(app, @"C:\Users\someone\Downloads\Rig.exe", sid, sid)) yield return "a Rig.exe in another folder was served";
        if (HelperTask.Serves(app, @"C:\Windows\System32\cmd.exe", sid, sid)) yield return "another program was served";
        if (HelperTask.Serves(app, app, "S-1-5-21-1-2-3-1002", sid)) yield return "the app running as another account was served";
        if (HelperTask.Serves(app, null, sid, sid)) yield return "an app whose program Windows wouldn't name was served";
        if (HelperTask.Serves(app, app, null, sid)) yield return "an app whose account Windows wouldn't name was served";
    }

    static IEnumerable<string> TaskXml()
    {
        var doc = System.Xml.Linq.XDocument.Parse(HelperTask.Xml("S-1-5-21-1-2-3-1001", @"C:\Program Files\Rig\Helper\RigHelper.exe", @"C:\Users\a\AppData\Local\Rig\Rig.exe"));
        string Text(string name) => doc.Descendants().FirstOrDefault(e => e.Name.LocalName == name)?.Value ?? "(none)";
        if (Text("RunLevel") != "HighestAvailable") yield return $"run level {Text("RunLevel")}";
        if (Text("LogonType") != "InteractiveToken") yield return $"logon type {Text("LogonType")}";
        if (Text("UserId") != "S-1-5-21-1-2-3-1001") yield return $"user {Text("UserId")}";
        if (Text("Priority") != "5") yield return $"priority {Text("Priority")}";
        if (Text("ExecutionTimeLimit") != "PT0S") yield return $"time limit {Text("ExecutionTimeLimit")}";
        if (Text("DisallowStartIfOnBatteries") != "false" || Text("StopIfGoingOnBatteries") != "false") yield return "it stops on battery";
        if (Text("MultipleInstancesPolicy") != "Parallel") yield return $"more than one at a time: {Text("MultipleInstancesPolicy")}";
        if (doc.Descendants().Any(e => e.Name.LocalName == "Triggers")) yield return "it has a trigger, so it would start without Rig asking";
        if (Text("Command") != @"C:\Program Files\Rig\Helper\RigHelper.exe") yield return $"program {Text("Command")}";
        if (!Text("Arguments").StartsWith(HelperTask.Flag + " ", StringComparison.Ordinal)) yield return $"arguments {Text("Arguments")}";
    }

    static IEnumerable<string> Builds()
    {
        string? self = Environment.ProcessPath;
        if (self == null) { yield return Skip + "no program path"; yield break; }
        if (!HelperTask.SameBuild(self, self)) yield return "this program isn't the same build as itself";
        string cmd = Path.Combine(Environment.SystemDirectory, "cmd.exe");
        if (HelperTask.SameBuild(self, cmd)) yield return "cmd.exe counted as the same build";
        if (HelperTask.StartTask(TestPrefix + "none", cmd, self, NewPipe(), Environment.ProcessId) != HelperTask.Stale) yield return "a task program of another build was started";
        if (HelperTask.StartTask(TestPrefix + "none", Path.Combine(Path.GetTempPath(), "no-such-rig-helper.exe"), self, NewPipe(), Environment.ProcessId) != HelperTask.NoTask)
            yield return "a missing task program didn't answer no task";
        if (HelperTask.StartTask(TestPrefix + "none", self, self, NewPipe(), Environment.ProcessId) != HelperTask.NoTask) yield return "a task that doesn't exist didn't answer no task";
    }

    static IEnumerable<string> EndToEnd(JsonObject notes)
    {
        if (!Native.IsAdmin()) { yield return Skip + "needs admin rights"; yield break; }
        string? self = Environment.ProcessPath;
        if (self == null) { yield return Skip + "no program path"; yield break; }
        string sid = Person.Mine(), name = TestPrefix + sid;
        var found = new List<string>();
        try
        {
            HelperTask.Register(name, sid, self, self);
            if (HelperTask.Read(name) is not { } read) found.Add("the task wasn't there after registering it");
            else
            {
                notes["task"] = new JsonObject { ["runLevel"] = read.RunLevel, ["logonType"] = read.LogonType, ["priority"] = read.Priority, ["path"] = read.Path, ["arguments"] = read.Arguments };
                // 1: TASK_RUNLEVEL_HIGHEST. 3: TASK_LOGON_INTERACTIVE_TOKEN.
                if (read.RunLevel != 1) found.Add($"run level {read.RunLevel}");
                if (read.LogonType != 3) found.Add($"logon type {read.LogonType}");
                if (read.Priority != 5) found.Add($"priority {read.Priority}");
                if (!string.Equals(read.Path, self, StringComparison.OrdinalIgnoreCase)) found.Add($"program {read.Path}");
                if (read.Arguments != HelperTask.Arguments(self)) found.Add($"arguments {read.Arguments}");
            }
            if (HelperTask.Security(name) is string sddl)
            {
                notes["security"] = sddl;
                // Windows may write the account as an alias (LA for the built-in Administrator), so read the access list.
                var me = new SecurityIdentifier(sid);
                var mine = new RawSecurityDescriptor(sddl).DiscretionaryAcl?.OfType<CommonAce>().Where(a => a.SecurityIdentifier == me && a.AceQualifier == AceQualifier.AccessAllowed).ToList() ?? [];
                int rights = mine.Aggregate(0, (r, a) => r | a.AccessMask);
                // FILE_EXECUTE, and none of: write, append, write attributes or extended attributes, delete, change access or owner, generic write or all.
                const int execute = 0x20, change = 0x2 | 0x4 | 0x10 | 0x100 | 0x10000 | 0x40000 | 0x80000 | 0x40000000 | 0x10000000;
                if ((rights & execute) == 0) found.Add($"the account it's for may not run it: {sddl}");
                if ((rights & change) != 0) found.Add($"the account it's for may change it: {sddl}");
            }
            found.AddRange(Talk(name, self, notes));
            found.AddRange(Smuggled(name, notes));
        }
        finally
        {
            try { HelperTask.Delete(name); } catch (Exception e) { found.Add($"removing the test task: {e.Message}"); }
        }
        if (HelperTask.Read(name) != null) found.Add("the test task was still there after removing it");
        foreach (var f in found) yield return f;
    }

    /// The app's side, as helper.rs does it: a pipe for one connection, the task started with its name and this process's
    /// id, then a hello that has to come back with admin rights.
    static List<string> Talk(string name, string self, JsonObject notes)
    {
        var found = new List<string>();
        string pipe = NewPipe();
        using var server = new NamedPipeServerStream(pipe[@"\\.\pipe\".Length..], PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        var watch = Stopwatch.StartNew();
        int started = HelperTask.StartTask(name, self, self, pipe, Environment.ProcessId);
        if (started != HelperTask.Started) { found.Add($"starting the task answered {started}"); return found; }
        try { server.WaitForConnectionAsync().Wait(TimeSpan.FromSeconds(30)); } catch (Exception e) { found.Add($"waiting for the helper: {e.Message}"); }
        if (!server.IsConnected)
        {
            found.Add($"the helper the task started didn't connect within 30 seconds (Task Scheduler's last result: {HelperTask.LastResult(name)?.ToString("x") ?? "none"})");
            return found;
        }
        notes["connectedMs"] = watch.ElapsedMilliseconds;
        if (Native.GetNamedPipeClientProcessId(server.SafePipeHandle.DangerousGetHandle(), out uint client))
        {
            string? image = Native.ProcessImage((int)client);
            notes["client"] = image;
            if (image == null || !string.Equals(Path.GetFullPath(image), Path.GetFullPath(self), StringComparison.OrdinalIgnoreCase)) found.Add($"the program that connected was {image ?? "unknown"}");
        }
        else found.Add("Windows wouldn't say which process connected");
        var writer = new StreamWriter(server, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
        var reader = new StreamReader(server, new UTF8Encoding(false));
        writer.WriteLine("{\"id\":1,\"method\":\"hello\",\"params\":null}");
        var line = reader.ReadLineAsync();
        if (!line.Wait(TimeSpan.FromSeconds(20)) || line.Result is not string answer) { found.Add("the helper didn't answer hello"); return found; }
        var hello = JsonNode.Parse(answer);
        notes["hello"] = hello?["result"]?.DeepClone();
        if (hello?["result"]?["elevated"]?.GetValue<bool>() != true) found.Add($"the helper the task started has no admin rights: {answer}");
        notes["helloMs"] = watch.ElapsedMilliseconds;
        return found;
    }

    /// A run whose values carry an approval: the helper has to refuse the whole command line and quit with 2.
    static List<string> Smuggled(string name, JsonObject notes)
    {
        var found = new List<string>();
        // The run above ends when its pipe closes. Wait for that, and a second more, so this run's start time differs.
        var watch = Stopwatch.StartNew();
        while (watch.Elapsed < TimeSpan.FromSeconds(20) && HelperTask.State(name) is { Running: true }) Thread.Sleep(250);
        Thread.Sleep(1100);
        DateTime before = HelperTask.State(name)?.LastRun ?? DateTime.MinValue;
        HelperTask.RunWith(name, [$@"\\.\pipe\rig-helper-{new string('0', 32)} --approve-step C:\nothing.json --hash 00", "1"]);
        watch.Restart();
        bool Ended() => HelperTask.State(name) is { Running: false } now && now.LastRun != before;
        while (watch.Elapsed < TimeSpan.FromSeconds(30) && !Ended()) Thread.Sleep(250);
        int? result = HelperTask.LastResult(name);
        notes["smuggledResult"] = result;
        if (result != 2) found.Add($"a run with an approval in its values ended with {result?.ToString() ?? "nothing"}, not 2");
        return found;
    }
}
