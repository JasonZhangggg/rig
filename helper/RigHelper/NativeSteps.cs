// Steps the helper approves by nonce, and the native ones among them.
//
// A step is a command (PowerShell, CommandCheck.cs) or a native op: a change
// PowerShell can't make, made by the helper's own code. Both go through the
// one approval path in Commands.cs: preview, a nonce, the fingerprint, the
// daily limit, the snapshot, the never-list readings before and after, the
// record and undo.
//
// A native op never runs in the helper itself, which may have admin rights.
// The helper only checks it, stores it, takes the snapshot and guards. The
// work is done by a worker: this same program started with --native-worker
// and the person's own Windows sign-in, on the desktop the Rig app is on, so
// it can do nothing the person couldn't. What the worker answers is read as
// data from outside, like a script's output.
//
// A new op is one class that implements INativeStep and one line in
// NativeSteps.All (and one member of NativeOp and one entry of nativeOps in
// packages/core/src/change.ts).

using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

/// A step as the helper keeps it: HelperStep in change.ts.
public abstract record HelperStep
{
    public abstract string Kind { get; }
    public abstract JsonObject ToJson();
    /// What an approval is of. packages/core/src/change.ts stepHash gives the same answer.
    public abstract string Hash();

    protected static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    public static HelperStep? From(JsonNode? n, out string? problem)
    {
        problem = "This isn't a kind of change Rig's helper makes.";
        if (n is not JsonObject o) return null;
        switch (Str(o["kind"]))
        {
            case "command":
                return Command.From(o["cmd"], out problem) is Command cmd ? new CommandStep(cmd) : null;
            case "native":
                if (o["op"] is not JsonObject op || Str(op["name"]) is not string name) return null;
                problem = null;
                return new NativeOpStep(name, op.DeepClone().AsObject());
            default:
                return null;
        }
    }

    /// The step of a pipe request: `{ step }`, or `{ cmd }` from a Rig app from before native ops.
    public static HelperStep? Sent(string method, JsonNode? p, out string? problem) =>
        From(method.StartsWith("command.", StringComparison.Ordinal) ? Wrapped(p?["cmd"]) : p?["step"], out problem);

    /// The step in something the store holds, which before native ops held the command alone as `cmd`.
    public static HelperStep? Stored(JsonObject o) => From(o["step"] ?? Wrapped(o["cmd"]), out _);

    static JsonNode Wrapped(JsonNode? cmd) => new JsonObject { ["kind"] = "command", ["cmd"] = cmd?.DeepClone() };

    /// A value written so that no two values share a text: `encoded` in change.ts.
    public static string Encoded(JsonNode? n)
    {
        switch (n)
        {
            case null: return "z";
            case JsonObject o:
                return $"o{o.Count}{{{string.Concat(o.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"s{kv.Key.Length}:{kv.Key}{Encoded(kv.Value)}"))}}}";
            case JsonArray a:
                return $"a{a.Count}[{string.Concat(a.Select(Encoded))}]";
        }
        switch (n.GetValueKind())
        {
            case JsonValueKind.String: { string s = n.GetValue<string>(); return $"s{s.Length}:{s}"; }
            case JsonValueKind.True: return "t";
            case JsonValueKind.False: return "f";
            case JsonValueKind.Number:
                string text = n.ToJsonString();
                if (!Regex.IsMatch(text, @"^-?[0-9]{1,16}\z") || !long.TryParse(text, out long whole) || Math.Abs(whole) > 9007199254740991) throw new RigException("A step can only hold whole numbers.");
                return $"n{whole};";
            default: return "z";
        }
    }
}

public sealed record CommandStep(Command Cmd) : HelperStep
{
    public override string Kind => "command";
    public override JsonObject ToJson() => new() { ["kind"] = Kind, ["cmd"] = Cmd.ToJson() };
    /// A command's fingerprint is the one it had before native ops, so a Rig app from before them still approves it.
    public override string Hash() => Cmd.Hash();
}

/// A native op by name with its payload. `Op` is as it was sent until the op's own Check has rewritten it.
public sealed record NativeOpStep(string Name, JsonObject Op) : HelperStep
{
    public override string Kind => "native";
    public override JsonObject ToJson() => new() { ["kind"] = Kind, ["op"] = Op.DeepClone() };
    public override string Hash() =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("rig-step-1\n" + Encoded(ToJson())))).ToLowerInvariant();
}

/// What an op's check found: the op as Rig keeps and fingerprints it, with anything it doesn't know dropped, its tier
/// (1 to 3) and why, and the places it changes that Rig can snapshot and put back itself.
public sealed record NativeCheck(JsonObject Op, int Tier, IReadOnlyList<string> Reasons, IReadOnlyList<Touch> Touches);

public interface INativeStep
{
    /// The op's name: `name` in its payload.
    string Name { get; }

    /// Runs in the helper, before the op is stored, again before it runs and again before it is undone. Changes nothing.
    /// Throws a RigException that says in plain words why the op is refused. The tier is this code's own judgment, never
    /// something the payload says. The touches are held to the never list like a command's. Checking what it returned
    /// must return the same op, or the step is refused as changed.
    NativeCheck Check(JsonObject op);

    // The four below run only in the worker, as the person, with the op exactly as Check returned it.

    /// The state the op changes, as one line that reads the same whenever the state is the same. It is shown on the card,
    /// and compared before an undo to tell whether something else changed the state since.
    string Preview(JsonObject op);

    /// Makes the change and returns what Undo needs to put it back. Throws before changing anything, or not at all.
    JsonObject Apply(JsonObject op);

    /// Reads the change back: null when it holds, else what is there now, in plain words.
    string? Verify(JsonObject op);

    /// Puts back what Apply changed, from what Apply returned. Approved with the op: it runs only for an applied step.
    void Undo(JsonObject op, JsonObject back);
}

public static class NativeSteps
{
    /// Every native op the helper makes.
    static readonly INativeStep[] All = [new ScreenStep(test: false)];

    /// Known only inside --selftest, where they come first. Nothing that comes over the pipe can ask for these.
    static readonly INativeStep[] SelfTestOnly = [new SelftestOp(), new ScreenStep(test: true)];

    public static INativeStep? Find(string name, bool selfTest) =>
        (selfTest ? SelfTestOnly : []).Concat(All).FirstOrDefault(s => s.Name == name);
}

/// The worker: how the helper asks it, and what it does when started.
public static class NativeWorker
{
    public const int TimeoutMs = 120_000;
    public const string Flag = "--native-worker", SelfTestFlag = "--selftest-ops";
    public const string NoDesktop = "Rig's helper isn't running on your desktop, so it can't make this kind of change. Open Rig and ask again.";

    /// `Integrity` and `Session` are the worker's own word on how Windows started it.
    public sealed record Answer(bool Ok, bool TimedOut, JsonObject Result, string Error, int Integrity, int Session);

    static Answer Failed(string error, bool timedOut = false) => new(false, timedOut, [], error, 0, -1);
    static string Short(string text) => text.Length <= 300 ? text : text[..300] + "…";

    /// Has a worker with the person's own sign-in do one part of a native op, and waits for its answer.
    public static Answer Ask(Person person, CommandStore store, string verb, NativeOpStep step, JsonObject? back, bool selfTest, int timeoutMs = TimeoutMs)
    {
        // Windows' services have no desktop of the person's to work on, and no Rig app to take the person's sign-in from.
        if (!selfTest && Process.GetCurrentProcess().SessionId == 0) return Failed(NoDesktop);
        if (Environment.ProcessPath is not string exe) return Failed("Rig's helper couldn't find its own program to start.");
        string file = Path.Combine(store.PersonScripts(person.Sid), CommandStore.NewId() + ".json");
        try
        {
            var request = new JsonObject { ["verb"] = verb, ["name"] = step.Name, ["op"] = step.Op.DeepClone(), ["back"] = back?.DeepClone() };
            File.WriteAllText(file, request.ToJsonString());
            var ran = person.Start(exe, $"{Flag} \"{file}\"" + (selfTest ? $" {SelfTestFlag}" : ""), timeoutMs, store.Empty());
            if (ran.TimedOut) return Failed($"It didn't finish in {timeoutMs / 1000} seconds, so Rig stopped it.", timedOut: true);
            JsonObject? said;
            try { said = JsonNode.Parse(ran.Out.Trim()) as JsonObject; } catch (JsonException) { said = null; }
            if (said == null) return Failed($"Rig's worker stopped without an answer (exit code {ran.Exit}).");
            bool ok = said["ok"]?.GetValueKind() == JsonValueKind.True && said["result"] is JsonObject;
            return new Answer(ok, false, ok ? said["result"]!.DeepClone().AsObject() : [], ok ? "" : Short(said["error"]?.ToString() ?? "Rig's worker stopped without saying why."),
                (int)Json.Num(said["integrity"], 0), (int)Json.Num(said["session"], -1));
        }
        catch (RigException e) { return Failed(e.Message); }
        finally { try { File.Delete(file); } catch { } }
    }

    /// RigHelper.exe --native-worker <file>: does the one part the file asks for and prints its answer as one line of JSON.
    public static int Run(string file, bool selfTest)
    {
        var answer = new JsonObject();
        using var me = WindowsIdentity.GetCurrent();
        try
        {
            if (!selfTest && Process.GetCurrentProcess().SessionId == 0) throw new RigException(NoDesktop);
            // With admin rights in force this could reach what the person can't, so it does nothing at all.
            if (!selfTest && Person.IsElevated(me.Token)) throw new RigException(Commands.AppElevated);
            if (JsonNode.Parse(File.ReadAllText(file)) is not JsonObject req || req["op"] is not JsonObject op) throw new RigException("Rig's worker was started without anything to do.");
            if (NativeSteps.Find(req["name"]?.ToString() ?? "", selfTest) is not INativeStep step) throw new RigException(Commands.UnknownOp);
            answer["result"] = req["verb"]?.ToString() switch
            {
                "preview" => new JsonObject { ["now"] = step.Preview(op) },
                // A look at an app's window, before there is a step: a read only the screen op offers (Screen.cs).
                "look" when step is ScreenStep screen => screen.Look(op),
                "apply" => new JsonObject { ["back"] = step.Apply(op) },
                "verify" => new JsonObject { ["problem"] = step.Verify(op), ["now"] = step.Preview(op) },
                "undo" when req["back"] is JsonObject back => Undone(step, op, back),
                _ => throw new RigException("Rig's worker was asked for something it doesn't do."),
            };
            answer["ok"] = true;
        }
        catch (Exception e)
        {
            answer["ok"] = false;
            answer["error"] = e is RigException ? e.Message : $"Rig's worker hit a problem: {e.Message}";
        }
        answer["integrity"] = Native.Integrity(me.Token);
        answer["session"] = Process.GetCurrentProcess().SessionId;
        // A windowed program has no console, so the answer goes straight to the handle the helper gave it.
        using (var o = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(Native.GetStdHandle(Native.STD_OUTPUT_HANDLE), ownsHandle: false), FileAccess.Write))
            o.Write(Encoding.UTF8.GetBytes(answer.ToJsonString()));
        return answer["ok"]!.GetValue<bool>() ? 0 : 1;
    }

    static JsonObject Undone(INativeStep step, JsonObject op, JsonObject back)
    {
        step.Undo(op, back);
        return new JsonObject { ["now"] = step.Preview(op) };
    }
}

/// The self-test's op: sets one value under HKCU\Software\RigSelftest, which no snapshot covers, so only its own Undo
/// puts it back. With `run` it also writes a Run value, which the helper must catch and put back itself.
sealed class SelftestOp : INativeStep
{
    public const string Key = @"Software\RigSelftest", Value = "Native", RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", RunValue = "RigSelftest";

    public string Name => "selftest";

    public NativeCheck Check(JsonObject op)
    {
        if (op["value"] is not JsonValue v || !v.TryGetValue(out string? value) || value.Length is 0 or > 64) throw new RigException("The self-test op needs a short value.");
        var kept = new JsonObject { ["name"] = Name, ["value"] = value };
        if (op["run"]?.GetValueKind() == JsonValueKind.True) kept["run"] = true;
        return new NativeCheck(kept, 2, ["Rig's own self-test change."], []);
    }

    static string? Now()
    {
        using var k = Registry.CurrentUser.OpenSubKey(Key);
        return k?.GetValue(Value) as string;
    }

    public string Preview(JsonObject op) => Now() ?? "Not set";

    public JsonObject Apply(JsonObject op)
    {
        string? was = Now();
        using (var k = Registry.CurrentUser.CreateSubKey(Key)) k.SetValue(Value, op["value"]!.GetValue<string>());
        if (op["run"] != null)
        {
            using var run = Registry.CurrentUser.CreateSubKey(RunKey);
            run.SetValue(RunValue, "rig-selftest-native");
        }
        return new JsonObject { ["was"] = was };
    }

    public string? Verify(JsonObject op) => Now() == op["value"]!.GetValue<string>() ? null : $"The test value reads {Now() ?? "nothing"}.";

    public void Undo(JsonObject op, JsonObject back)
    {
        if (back["was"] is JsonValue was)
        {
            using var k = Registry.CurrentUser.CreateSubKey(Key);
            k.SetValue(Value, was.GetValue<string>());
            return;
        }
        using (var k = Registry.CurrentUser.OpenSubKey(Key, writable: true))
        {
            if (k == null) return;
            k.DeleteValue(Value, throwOnMissingValue: false);
            if (k.ValueCount > 0 || k.SubKeyCount > 0) return;
        }
        Registry.CurrentUser.DeleteSubKey(Key, throwOnMissingSubKey: false);
    }
}
