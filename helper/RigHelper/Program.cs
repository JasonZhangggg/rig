// RigHelper: started by the Rig app (with admin rights when the person says
// Yes), it connects back to the app's private pipe and answers one JSON
// request per line. It reads sensors, the PC's parts, a few settings, the
// Windows event log and the busiest apps, and makes only the changes in Rig's
// fix catalog. It quits when the app does. Run with --service it is Rig's
// background recorder instead (RecorderService.cs).

using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        // RigHelper.exe --selftest out.json: reads everything once and writes it to a file.
        // Used by CI on a Windows runner, and handy for checking a PC by hand.
        if (Arg(args, "--selftest") is string outFile)
        {
            using var hw0 = new Sensors();
            var h = new Handler(hw0);
            var all = new JsonObject();
            long weekAgo = DateTimeOffset.UtcNow.AddDays(-7).ToUnixTimeMilliseconds();
            var calls = new (string method, JsonNode? p)[]
            {
                ("hello", null), ("inventory", null), ("facts", null), ("snapshot", null),
                ("events", new JsonObject { ["sinceMs"] = weekAgo }), ("processes", new JsonObject { ["top"] = 8 }),
            };
            foreach (var (m, p) in calls)
            {
                try { all[m] = h.Handle(m, p); } catch (Exception e) { all[m] = new JsonObject { ["error"] = e.ToString() }; }
            }
            if (SelfChecks(all, weekAgo).ToList() is { Count: > 0 } problems) all["checks"] = new JsonObject { ["error"] = string.Join("; ", problems) };
            await File.WriteAllTextAsync(outFile, all.ToJsonString(new JsonSerializerOptions(Json.Options) { WriteIndented = true }));
            return all.Any(kv => kv.Value is JsonObject o && o["error"] != null) ? 1 : 0;
        }

        // The background recorder: run by Windows as a service, installed and removed by Rig's installer and Settings.
        if (args.Contains("--service")) { System.ServiceProcess.ServiceBase.Run(new RecorderService()); return 0; }
        if (args.Contains("--install-recorder")) return RecorderSetup.Install(Arg(args, "--app-dir"));
        if (args.Contains("--uninstall-recorder")) return RecorderSetup.Uninstall(Arg(args, "--app-dir"));
        // RigHelper.exe --approve-script <file>: started behind Windows' permission prompt when the person approves a script in Rig.
        if (Arg(args, "--approve-script") is string approveFile) return ProbeStore.ApproveFromFile(approveFile, Arg(args, "--hash"));
        // RigHelper.exe --record-for 60 --data-dir <folder>: records in this process for a while, for the CI smoke test.
        if (Arg(args, "--record-for") is string secs && int.TryParse(secs, out int recordSecs) && Arg(args, "--data-dir") is string recordDir)
            return RecorderCore.RunFor(recordDir, Math.Clamp(recordSecs, 1, 3600));

        string? pipe = Arg(args, "--pipe");
        if (pipe == null || !int.TryParse(Arg(args, "--parent"), out int parent)) return 2;
        const string prefix = @"\\.\pipe\";
        if (!pipe.StartsWith(prefix, StringComparison.Ordinal)) return 2;

        Process app;
        try { app = Process.GetProcessById(parent); } catch { return 3; }

        using var client = new NamedPipeClientStream(".", pipe[prefix.Length..], PipeDirection.InOut, PipeOptions.Asynchronous);
        try { await client.ConnectAsync(15000); } catch { return 4; }

        // Only talk to the Rig app that started us.
        if (!Native.GetNamedPipeServerProcessId(client.SafePipeHandle.DangerousGetHandle(), out uint server) || server != parent) return 5;

        using var cts = new CancellationTokenSource();
        app.EnableRaisingEvents = true;
        app.Exited += (_, _) => cts.Cancel();

        using var hw = new Sensors();
        var rig = new Handler(hw);
        var reader = new StreamReader(client, new UTF8Encoding(false));
        var writer = new StreamWriter(client, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };

        try
        {
            while (!cts.IsCancellationRequested)
            {
                string? line = await reader.ReadLineAsync(cts.Token);
                if (line == null) break;
                JsonNode? id = null;
                JsonObject reply;
                try
                {
                    var req = JsonNode.Parse(line)!.AsObject();
                    id = req["id"]?.DeepClone();
                    string method = req["method"]?.GetValue<string>() ?? "";
                    JsonNode? result = rig.Handle(method, req["params"]);
                    reply = new JsonObject { ["id"] = id, ["result"] = result };
                }
                catch (Exception e)
                {
                    reply = new JsonObject { ["id"] = id, ["error"] = new JsonObject { ["message"] = e is RigException ? e.Message : $"Rig's helper hit a problem: {e.Message}" } };
                }
                await writer.WriteLineAsync(reply.ToJsonString(Json.Options));
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { }
        return 0;
    }

    /// What the self-test holds the read-only log calls to: bounded lists, sane values, nothing older than asked for.
    static IEnumerable<string> SelfChecks(JsonObject all, long sinceMs)
    {
        if (all["events"] is JsonArray events)
        {
            if (events.Count > EventLogs.MaxEvents) yield return $"events returned {events.Count} entries";
            foreach (var e in events)
            {
                if (Json.Num(e?["t"], 0) < sinceMs) { yield return "events returned an entry older than asked for"; break; }
                if ((e?["message"]?.GetValue<string>() ?? "").Length > 300) { yield return "an event message is longer than 300 characters"; break; }
                if (e?["level"]?.GetValue<string>() is not ("critical" or "error" or "warning")) { yield return "an event has an unknown level"; break; }
            }
        }
        if (all["processes"] is JsonArray procs)
        {
            if (procs.Count == 0 || procs.Count > Processes.MaxTop) yield return $"processes returned {procs.Count} entries";
            if (procs.Any(p => Json.Num(p?["cpu"], -1) is not (>= 0 and <= 100))) yield return "a process has a processor share outside 0 to 100";
        }
        var ranked = Processes.Rank([("game", 6L << 30, 3200, 90), ("game", 1L << 30, 800, null), ("idle", 1L << 20, 0, null), ("System", 1L << 22, 400, null)], 1000, 8, 2);
        if (ranked.Count != 3 || ranked[0] is not { Name: "game.exe", Cpu: 50, MemMb: 7168, Gpu: 90 } || ranked[1].Name != "System") yield return "process ranking is off";
        if (EventLogs.Clean("a\r\n  b\tc", 4) != "a b ") yield return "event message clean-up is off";
        if (EventLogs.Queries(DateTime.UnixEpoch).Count() != 3) yield return "event queries are off";
        foreach (var p in RecorderChecks()) yield return p;
        foreach (var p in ProbeChecks()) yield return p;
    }

    /// The background recorder's pure rules: file names, pruning, the line format and when it takes a closer look.
    static IEnumerable<string> RecorderChecks()
    {
        const long day = 86_400_000;
        long now = DateTimeOffset.Parse("2026-11-18T12:00:00Z").ToUnixTimeMilliseconds();
        if (LogFiles.NameFor(now) != "2026-11-18.jsonl") yield return "recorder file names are off";
        var files = new[] { ("2026-10-01.jsonl", 10L), ("2026-11-17.jsonl", 150L << 20), ("2026-11-18.jsonl", 100L << 20), ("status.json", 1L) };
        var drop = LogFiles.Prune(files, now);
        if (!drop.SequenceEqual(new[] { "2026-10-01.jsonl", "2026-11-17.jsonl" })) yield return $"recorder pruning is off: {string.Join(",", drop)}";
        if (LogFiles.Prune([("2026-01-01.jsonl", 999L << 20)], now).Count != 0) yield return "recorder pruning dropped the only file";

        var line = LogLine.Sample(now, [41.5, null], [new ProcessDto("game.exe", 50, 2048, 90)], detail: true).ToJsonString();
        if (line != """{"k":"s","t":1795003200000,"v":[41.5,null],"top":[{"name":"game.exe","cpu":50,"memMb":2048,"gpu":90}],"d":1}""") yield return $"recorder sample line is off: {line}";

        var w = new Watch();
        SensorDto S(string hw, string type, string name, double? v) => new($"/{hw}/{name}", hw, hw, type, name, v, null, null);
        var r = Reading.From(now, [S("cpu", "temperature", "Core Max", 70), S("cpu", "temperature", "CPU Core #1 Distance to TjMax", 30), S("gpu", "temperature", "GPU Hot Spot", 99), S("gpu", "temperature", "GPU Core", 60)]);
        if (r.Cpu != 70 || r.Gpu != 60) yield return $"recorder picks the wrong temperatures: {r.Cpu} {r.Gpu}";
        r = r with { Gpu = 70 };
        if (w.Check(r with { T = now }) != null) yield return "recorder fired on a calm reading";
        if (w.Check(r with { T = now + 5000, Gpu = 90 }) != null) yield return "recorder fired on one hot reading";
        if (w.Check(r with { T = now + 10_000, Gpu = 90 })?.Why != "gpu-hot") yield return "recorder missed a hot graphics card";
        if (w.Check(r with { T = now + 15_000, Gpu = 91 }) != null) yield return "recorder fired twice for the same heat";
        if (w.Check(r with { T = now + 20_000, Cpu = 97 })?.Why != "cpu-jump") yield return "recorder missed a sudden jump";
        var crash = new EventDto(now, "Application", "Application Error", 1000, "error", "x");
        if (w.Check(crash)?.Why != "event") yield return "recorder missed a crash event";
        if (w.Check(crash with { T = now + day, Source = "DistributedCOM", Id = 10016 }) != null) yield return "recorder fired on a harmless error";
    }

    /// Custom logs: what's accepted, what's refused, and that a script runs only as approved.
    static IEnumerable<string> ProbeChecks()
    {
        long now = DateTimeOffset.Parse("2026-11-18T12:00:00Z").ToUnixTimeMilliseconds();
        const string me = "S-1-5-21-1000-2000-3000-1001";
        string Hash(string text, bool admin = false) => ProbeRules.ScriptHash("powershell", admin, text);
        JsonObject Spec(JsonObject source, double hours = 1, Action<JsonObject>? more = null)
        {
            var o = new JsonObject { ["id"] = "t-1", ["label"] = "Test", ["createdAt"] = now, ["expiresAt"] = now + (long)(hours * 3_600_000), ["source"] = source };
            more?.Invoke(o);
            return o;
        }
        JsonObject Src(string kind, params (string K, JsonNode? V)[] fields)
        {
            var o = new JsonObject { ["kind"] = kind };
            foreach (var (k, v) in fields) o[k] = v;
            return o;
        }
        (ProbeSpec? P, string? E) Try(JsonObject spec) => ProbeRules.Parse(spec, now, me);

        var good = new[]
        {
            Spec(Src("sensor", ("match", "GPU Hot Spot"))),
            Spec(Src("counter", ("path", @"\Processor(_Total)\% Processor Time"))),
            Spec(Src("events", ("channel", "Microsoft-Windows-Kernel-Power/Thermal-Operational"), ("query", "*[System[EventID=1]]"))),
            Spec(Src("wmi", ("namespace", @"root\wmi"), ("query", "SELECT * FROM MSAcpi_ThermalZoneTemperature"))),
            Spec(Src("process", ("name", "game.exe"))),
            Spec(Src("file", ("path", @"C:\Games\log.txt"), ("read", "tail"))),
            Spec(Src("folder", ("path", @"C:\Users\Public"))),
            Spec(Src("registry", ("key", @"HKCU\Software\Rig"), ("value", "x"))),
            Spec(Src("sensor", ("match", "CPU Package")), more: o =>
            {
                o["every"] = 0; o["fast"] = 1;
                o["when"] = new JsonObject { ["metric"] = "gpuTemp", ["op"] = ">", ["value"] = 85 };
            }),
            Spec(Src("script", ("text", "Get-Date")), more: o => { o["every"] = 60; o["hash"] = Hash("Get-Date"); }),
        };
        foreach (var j in good) if (Try(j).E is string e) yield return $"probe refused: {e} in {j.ToJsonString()}";

        var bad = new (string Why, JsonObject Spec)[]
        {
            ("a command line", Spec(Src("process", ("name", "cmd.exe /c del x")))),
            ("a WMI method call", Spec(Src("wmi", ("query", "EXEC Win32_Process.Create")))),
            ("a network path", Spec(Src("file", ("path", @"\\server\share\x")))),
            ("a relative path", Spec(Src("folder", ("path", @"..\x")))),
            ("a 1 second log for a week", Spec(Src("sensor", ("match", "x")), hours: 7 * 24, more: o => o["every"] = 1)),
            ("an unknown kind", Spec(Src("shell", ("text", "x")))),
            ("a script with no approval", Spec(Src("script", ("text", "Get-Date")))),
            ("a script approved as something else", Spec(Src("script", ("text", @"Remove-Item C:\x")), more: o => o["hash"] = Hash("Get-Date"))),
            ("a user script asking for admin", Spec(Src("script", ("text", "Get-Date"), ("admin", true)), more: o => o["hash"] = Hash("Get-Date"))),
            ("a script run every second", Spec(Src("script", ("text", "Get-Date")), more: o => { o["every"] = 1; o["hash"] = Hash("Get-Date"); })),
            ("a log that already ended", Spec(Src("process", ("name", "game.exe")), hours: -1)),
        };
        foreach (var (why, j) in bad) if (Try(j).P != null) yield return $"probe accepted {why}";

        var admin = Try(Spec(Src("script", ("text", "Get-Date"), ("admin", true)), more: o => o["hash"] = Hash("Get-Date", admin: true)));
        if (admin.P is not { IsScript: true, Admin: true }) yield return $"approved admin script refused: {admin.E}";
        var cond = new ProbeCondition("gpuTemp", null, ">=", 85, 0);
        if (!cond.Holds(85) || cond.Holds(84.9)) yield return "probe conditions compare wrongly";
        if (ProbeReader.Scalar(new byte[] { 1, 255 })?.ToJsonString() != "\"01FF\"" || ProbeReader.Scalar(42u)?.ToJsonString() != "42") yield return "probe values convert wrongly";
    }

    static string? Arg(string[] args, string name)
    {
        int i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}

/// An error whose message is meant for the person, shown as is.
public class RigException(string message) : Exception(message);

public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };
    public static JsonNode? From<T>(T value) => JsonSerializer.SerializeToNode(value, Options);

    /// A number from a request or a reply, whichever number type it was written as.
    public static double Num(JsonNode? n, double fallback) =>
        n is not JsonValue v ? fallback : v.TryGetValue(out double d) ? d : v.TryGetValue(out long l) ? l : v.TryGetValue(out int i) ? i : fallback;
}

public class Handler(Sensors hw)
{
    public JsonNode? Handle(string method, JsonNode? p) => method switch
    {
        "hello" => Json.From(new { version = typeof(Handler).Assembly.GetName().Version?.ToString() ?? "0", elevated = Native.IsAdmin() }),
        "inventory" => Json.From(Inventory.Read(hw)),
        "facts" => Json.From(Facts.Read()),
        "snapshot" => Json.From(hw.Snapshot()),
        "events" => Json.From(EventLogs.Read((long)Json.Num(p?["sinceMs"], 0), (int)Json.Num(p?["max"], EventLogs.MaxEvents))),
        "processes" => Json.From(Processes.Top((int)Json.Num(p?["top"], 8))),
        "apply" => new JsonObject { ["undo"] = Actions.Apply(p?["call"] as JsonObject ?? throw new RigException("No change was given.")) },
        "recorder.probes" => ProbeStore.Edit(p, hw),
        _ => throw new RigException($"Rig's helper doesn't know \"{method}\"."),
    };
}
