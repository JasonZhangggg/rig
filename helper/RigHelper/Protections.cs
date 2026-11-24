// Protections Rig turns off for a while: the rows of rules/protections.json
// (embedded, the same file packages/core/src/protection.ts reads). A step
// names a row and a time and nothing else; how a row is read, turned off and
// turned back on is this file's own code, one way per kind, and no text from
// a step, the pipe or the ledger is ever run.
//
// Two native ops use the table. `protection` turns a row off: it first has
// Rig's background service take on turning it back on (Reverts.cs), and only
// then turns it off. `keepOff` stops the service turning it back on; only
// the Rig app's own button asks for it. Both need admin rights, so the helper
// makes them itself behind Windows' prompt instead of in the worker, and both
// go through the one approval path in Commands.cs. Undoing `protection` is
// turning the row back on.

using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace Rig.Helper;

/// One row. `Profile` is a firewall row's network kind; `Key`, `Value`, `On` and `Off` are a registry row's.
public sealed record Protection(string Id, string Name, string Kind, string Profile = "", string Key = "", string Value = "", string On = "", string Off = "");

public static class Protections
{
    public const string TestRow = "selftest", TestKey = @"SOFTWARE\RigSelftest", TestValue = "Protection";
    const int SettleMs = 10_000;

    /// Lets the self-test's row be named: a value under HKLM\SOFTWARE\RigSelftest. Only the self-test, and the service it
    /// starts for itself, set this.
    internal static bool SelfTest { get; set; }
    /// The self-test's wait before a row comes back on, in place of the step's minutes, so its checks take seconds.
    internal static int? TestSeconds { get; set; }

    static readonly Protection Test = new(TestRow, "Rig's self-test protection", "registry", Key: @"HKLM\" + TestKey, Value: TestValue, On: "On", Off: "Off");
    static readonly JsonObject Table = Load();
    public static readonly IReadOnlyList<Protection> Rows = (Table["rows"] as JsonArray ?? []).Select(Row).ToList();
    public static readonly IReadOnlyList<int> RevertAfter = (Table["revertAfter"] as JsonArray ?? []).Select(n => (int)Json.Num(n, 0)).ToList();
    public static readonly int DefaultMinutes = (int)Json.Num(Table["default"], 60);

    static JsonObject Load()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Rig.Rules.protections.json") ?? throw new RigException("Rig's list of protections is missing from the helper.");
        return JsonNode.Parse(s) as JsonObject ?? throw new RigException("Rig's list of protections can't be read.");
    }

    static Protection Row(JsonNode? n)
    {
        string S(string k) => n?[k]?.ToString() ?? "";
        return new Protection(S("id"), S("name"), S("kind"), S("profile"), S("key"), S("value"), S("on"), S("off"));
    }

    public static Protection? Find(string? id) => SelfTest && id == TestRow ? Test : Rows.FirstOrDefault(r => r.Id == id);

    public static string Words(int minutes) => minutes < 60 ? $"{minutes} minutes" : minutes == 60 ? "1 hour" : $"{minutes / 60} hours";

    // ----- Reading and setting a row -----

    public static bool On(Protection row) => Guarded(row, () => row.Kind switch
    {
        "firewall" => Firewall(row, null),
        "defender" => (bool)Defender()["RealTimeProtectionEnabled"],
        _ => !string.Equals(RegistryNow(row), row.Off, StringComparison.OrdinalIgnoreCase),
    });

    public static void Set(Protection row, bool on) => Guarded(row, () =>
    {
        switch (row.Kind)
        {
            case "firewall": Firewall(row, on); break;
            case "defender":
                using (var prefs = new ManagementClass(@"root\Microsoft\Windows\Defender:MSFT_MpPreference"))
                using (var args = prefs.GetMethodParameters("Set"))
                {
                    args["DisableRealtimeMonitoring"] = !on;
                    using var done = prefs.InvokeMethod("Set", args, null);
                }
                break;
            default:
                // Turned off only from the one state turning it back on restores.
                if (!on && RegistryNow(row) is string now && !string.Equals(now, row.On, StringComparison.OrdinalIgnoreCase))
                    throw new RigException($"{row.Name} is set in a way Rig doesn't know (\"{now}\"), so Rig left it alone.");
                using (var k = Registry.LocalMachine.CreateSubKey(row.Key[5..])) k.SetValue(row.Value, on ? row.On : row.Off, RegistryValueKind.String);
                break;
        }
        return true;
    });

    /// Whether the row reads `on` within a few seconds: Defender takes a moment to say so.
    public static bool Settled(Protection row, bool on)
    {
        for (int waited = 0; ; waited += 250)
        {
            if (On(row) == on) return true;
            if (waited >= SettleMs) return false;
            Thread.Sleep(250);
        }
    }

    /// The row's state as one line, for the card and for telling whether it changed.
    public static string Line(Protection row, string? off = null) => $"{row.Name}: {(On(row) ? "On" : off ?? "Off")}";

    /// Why Defender's real-time protection can't be turned off here, or null.
    public static string? TamperProtected(Protection row) =>
        row.Kind == "defender" && Guarded(row, () => Defender()["IsTamperProtected"] is true)
            ? "Tamper Protection is on, so Windows would ignore this and Defender would stay on. To pause real-time protection yourself, open Windows Security, Virus & threat protection, Manage settings."
            : null;

    static T Guarded<T>(Protection row, Func<T> work)
    {
        try { return work(); }
        catch (RigException) { throw; }
        catch (Exception e)
        {
            var why = e is TargetInvocationException { InnerException: Exception inner } ? inner : e;
            throw new RigException($"Rig couldn't reach {row.Name} on this PC ({why.Message.Trim().TrimEnd('.')}).");
        }
    }

    static string? RegistryNow(Protection row)
    {
        using var k = Registry.LocalMachine.OpenSubKey(row.Key[5..]);
        return k?.GetValue(row.Value)?.ToString();
    }

    /// Reads one profile of Windows Firewall, or with `on` sets it, through Windows' own firewall policy object.
    static bool Firewall(Protection row, bool? on)
    {
        int profile = row.Profile switch { "domain" => 1, "private" => 2, _ => 4 };
        var type = Type.GetTypeFromProgID("HNetCfg.FwPolicy2") ?? throw new RigException("Windows Firewall's settings aren't there on this PC.");
        object policy = Activator.CreateInstance(type)!;
        try
        {
            if (on is bool to) type.InvokeMember("FirewallEnabled", BindingFlags.SetProperty, null, policy, [profile, to]);
            return (bool)type.InvokeMember("FirewallEnabled", BindingFlags.GetProperty, null, policy, [profile])!;
        }
        finally { Marshal.ReleaseComObject(policy); }
    }

    static ManagementBaseObject Defender()
    {
        using var all = new ManagementObjectSearcher(@"root\Microsoft\Windows\Defender", "SELECT RealTimeProtectionEnabled, IsTamperProtected FROM MSFT_MpComputerStatus");
        return all.Get().Cast<ManagementBaseObject>().First();
    }

    // ----- "protection.state" -----

    static string Iso(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

    /// Each row's state now and, when this process may read the ledger, when the service turns it back on and what last
    /// ended a wait for it. Changes nothing.
    public static JsonObject State()
    {
        IReadOnlyList<Revert>? armed = null;
        try { armed = Reverts.All(); } catch (Exception e) when (e is IOException or UnauthorizedAccessException or RigException) { }
        var rows = new JsonArray();
        foreach (var row in Rows)
        {
            var o = new JsonObject { ["id"] = row.Id };
            try { o["on"] = On(row); } catch (RigException) { o["on"] = null; }
            if (armed?.FirstOrDefault(e => e.Row == row.Id) is Revert e) o["due"] = Iso(e.Due);
            if (armed != null && Reverts.Last(row.Id) is JsonObject last)
            {
                o["last"] = new JsonObject { ["at"] = Iso((long)Json.Num(last["t"], 0)), ["why"] = last["why"]?.ToString() };
                if (last["was"] is JsonNode was) o["last"]!["was"] = was.ToString();
            }
            rows.Add(o);
        }
        return new JsonObject { ["ledger"] = armed != null, ["rows"] = rows };
    }
}

/// Turns one row off for `revertAfter` minutes. Nothing is turned off until the service has taken on turning it back on.
sealed class ProtectionStep : INativeStep
{
    public string Name => "protection";
    public bool Elevated => true;

    static (Protection Row, int Minutes) Parts(JsonObject op)
    {
        var row = Protections.Find(op["id"]?.ToString()) ?? throw new RigException("This isn't a protection Rig turns off.");
        int minutes = op["revertAfter"] == null ? Protections.DefaultMinutes : op["revertAfter"]!.GetValueKind() == JsonValueKind.Number ? (int)Json.Num(op["revertAfter"], 0) : 0;
        if (!Protections.RevertAfter.Contains(minutes))
            throw new RigException($"Rig turns a protection off for {string.Join(", ", Protections.RevertAfter.Select(Protections.Words))}, nothing else.");
        return (row, minutes);
    }

    static NativeCheck Kept(Protection row, int minutes) => new(
        new JsonObject { ["name"] = "protection", ["id"] = row.Id, ["revertAfter"] = minutes }, 3,
        [$"It turns off a protection. Rig turns it back on by itself after {Protections.Words(minutes)}."], [], Held: []);

    public NativeCheck Check(JsonObject op)
    {
        var (row, minutes) = Parts(op);
        if (!Protections.On(row)) throw new RigException($"{row.Name} is already off, so there is nothing to turn off.");
        if (Protections.TamperProtected(row) is string tamper) throw new RigException(tamper);
        if (!Reverts.ServiceRunning()) throw new RigException(Reverts.NoService);
        return Kept(row, minutes);
    }

    /// Turning it back on needs none of what turning it off does.
    public NativeCheck Recheck(JsonObject op, JsonObject held) { var (row, minutes) = Parts(op); return Kept(row, minutes); }

    public string Preview(JsonObject op) => Protections.Line(Parts(op).Row);

    public JsonObject Apply(JsonObject op)
    {
        var (row, minutes) = Parts(op);
        long due = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + (Protections.TestSeconds is int seconds ? seconds * 1000L : minutes * 60_000L);
        if (Reverts.Arm(row.Id, due) is string unarmed) throw new RigException(unarmed);
        try { Protections.Set(row, false); }
        catch
        {
            try { Protections.Set(row, true); } catch (RigException) { }
            Reverts.Drop(row.Id, null);
            throw;
        }
        return new JsonObject { ["due"] = due };
    }

    public string? Verify(JsonObject op)
    {
        var row = Parts(op).Row;
        return Protections.Settled(row, false) ? null : $"{row.Name} still reads on. Something else on this PC, like your organization's settings, may be holding it on.";
    }

    public void Undo(JsonObject op, JsonObject back)
    {
        var row = Parts(op).Row;
        if (!Protections.On(row)) Protections.Set(row, true);
        if (!Protections.Settled(row, true)) throw new RigException($"{row.Name} still reads off. Turn it back on in Windows Security.");
        Reverts.Drop(row.Id, "undone");
    }
}

/// Stops the service turning a row back on. Its undo has the service take it on again, a quarter of an hour from then.
sealed class KeepOffStep : INativeStep
{
    const int UndoMinutes = 15;

    public string Name => "keepOff";
    public bool Elevated => true;

    static Protection Row(JsonObject op) => Protections.Find(op["id"]?.ToString()) ?? throw new RigException("This isn't a protection Rig turns off.");

    static NativeCheck Kept(Protection row) => new(new JsonObject { ["name"] = "keepOff", ["id"] = row.Id }, 3, ["It keeps a protection off. Rig won't turn it back on by itself any more."], [], Held: []);

    public NativeCheck Check(JsonObject op)
    {
        var row = Row(op);
        if (Protections.On(row)) throw new RigException($"{row.Name} is already back on, so there is nothing to keep off.");
        if (Reverts.Find(row.Id) == null) throw new RigException($"Rig isn't waiting to turn {row.Name} back on, so there is nothing to keep off.");
        return Kept(row);
    }

    public NativeCheck Recheck(JsonObject op, JsonObject held) => Kept(Row(op));

    public string Preview(JsonObject op)
    {
        var row = Row(op);
        return Protections.Line(row, Reverts.Find(row.Id) != null ? "Off, and Rig turns it back on by itself" : "Off, and it stays off");
    }

    public JsonObject Apply(JsonObject op)
    {
        Reverts.Drop(Row(op).Id, "kept");
        return [];
    }

    public string? Verify(JsonObject op) => Reverts.Find(Row(op).Id) == null ? null : "Rig is still set to turn it back on.";

    public void Undo(JsonObject op, JsonObject back)
    {
        var row = Row(op);
        if (Protections.On(row)) throw new RigException($"{row.Name} is already back on, so there is nothing to undo.");
        if (Reverts.Arm(row.Id, DateTimeOffset.UtcNow.AddMinutes(UndoMinutes).ToUnixTimeMilliseconds()) is string unarmed) throw new RigException(unarmed);
    }
}
