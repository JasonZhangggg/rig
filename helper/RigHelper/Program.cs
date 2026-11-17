// RigHelper: started by the Rig app (with admin rights when the person says
// Yes), it connects back to the app's private pipe and answers one JSON
// request per line. It reads sensors, the PC's parts and a few settings, and
// makes only the changes in Rig's fix catalog. It quits when the app does.

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
            foreach (var m in new[] { "hello", "inventory", "facts", "snapshot" })
            {
                try { all[m] = h.Handle(m, null); } catch (Exception e) { all[m] = new JsonObject { ["error"] = e.ToString() }; }
            }
            await File.WriteAllTextAsync(outFile, all.ToJsonString(new JsonSerializerOptions(Json.Options) { WriteIndented = true }));
            return all.Any(kv => kv.Value?["error"] != null) ? 1 : 0;
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
}

public class Handler(Sensors hw)
{
    public JsonNode? Handle(string method, JsonNode? p) => method switch
    {
        "hello" => Json.From(new { version = typeof(Handler).Assembly.GetName().Version?.ToString() ?? "0", elevated = Native.IsAdmin() }),
        "inventory" => Json.From(Inventory.Read(hw)),
        "facts" => Json.From(Facts.Read()),
        "snapshot" => Json.From(hw.Snapshot()),
        "apply" => new JsonObject { ["undo"] = Actions.Apply(p?["call"] as JsonObject ?? throw new RigException("No change was given.")) },
        _ => throw new RigException($"Rig's helper doesn't know \"{method}\"."),
    };
}
