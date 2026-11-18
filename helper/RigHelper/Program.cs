// RigHelper: started by the Rig app (with admin rights when the person says
// Yes), it connects back to the app's private pipe and answers one JSON
// request per line. It reads sensors, the PC's parts, a few settings, the
// Windows event log and the busiest apps, and makes only the changes in Rig's
// fix catalog. It quits when the app does.

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
        "hello" => Json.From(new { version = typeof(Handler).Assembly.GetName().Version?.ToString() ?? "0", elevated = Native.IsAdmin(), driver = Sensors.Driver() }),
        "inventory" => Json.From(Inventory.Read(hw)),
        "facts" => Json.From(Facts.Read()),
        "snapshot" => Json.From(hw.Snapshot()),
        "events" => Json.From(EventLogs.Read((long)Json.Num(p?["sinceMs"], 0), (int)Json.Num(p?["max"], EventLogs.MaxEvents))),
        "processes" => Json.From(Processes.Top((int)Json.Num(p?["top"], 8))),
        "apply" => new JsonObject { ["undo"] = Actions.Apply(p?["call"] as JsonObject ?? throw new RigException("No change was given.")) },
        _ => throw new RigException($"Rig's helper doesn't know \"{method}\"."),
    };
}
