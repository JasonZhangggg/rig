// Windows protections Rig may turn off for a while: the rows of
// rules/protections.json (built into the helper) and the code that reads,
// lowers and raises each one. There is no script text: a row is one of the
// kinds below, and a step names a row by its id.
//
// Lowering is a native step, `protection`, approved like any other (preview,
// nonce, Windows' prompt, apply). Unlike the other native ops it needs admin
// rights, so the helper makes it itself and no worker is started; it holds
// nothing but the fixed reads and writes in this file. Before it lowers
// anything the running service must have armed the revert (Reverts.cs).
// Keeping a row off past its time is a second step, `protectionKeep`, which
// only the Rig app's own button asks for.

using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace Rig.Helper;

/// One protection: how it is read, lowered and raised.
public interface IProtection
{
    string Id { get; }
    /// Plain words for it, like "Windows Firewall on public networks".
    string Name { get; }
    /// Whether a revert of this row may wait this long.
    bool Allows(int seconds);
    /// Why it can't be lowered on this PC, in plain words, or null.
    string? Blocked();
    /// Whether it is on. Throws when it can't be read.
    bool On();
    /// The row's own word for how it is on now, when there is more than one way; kept in the ledger for Raise.
    string? Was();
    void Lower();
    /// Turns it on. `was` is only ever used when it is one of the row's own words.
    void Raise(string? was);
}

public static class Protections
{
    static readonly JsonObject Table = JsonNode.Parse(CommandCheck.Resource("Rig.Rules.protections.json"))!.AsObject();
    public static readonly int[] Minutes = Table["revertAfter"]!.AsArray().Select(n => n!.GetValue<int>()).ToArray();
    public static readonly int DefaultMinutes = Table["defaultRevertAfter"]!.GetValue<int>();
    static readonly IProtection[] Rows = Table["rows"]!.AsArray().Select(r => Row(r!.AsObject())).ToArray();
    static readonly IProtection[] SelfTestRows = [new SelftestRow(1), new SelftestRow(2), new SelftestRow(3)];

    public static string Words(string key) => Table["words"]![key]!.ToString();
    public static IEnumerable<string> Ids => Rows.Select(r => r.Id);
    public static IEnumerable<IProtection> All => Rows;

    /// What is never lowered, by id, in plain words.
    public static string? Never(string id) => Table["never"]!.AsArray().FirstOrDefault(n => n?["id"]?.ToString() == id)?["says"]?.ToString();

    static bool EveryRowTime(int seconds) => Minutes.Any(m => m * 60 == seconds);

    static IProtection Row(JsonObject r)
    {
        string id = r["id"]!.ToString(), name = r["name"]!.ToString();
        return r["kind"]!.ToString() switch
        {
            "firewall" => new FirewallRow(id, name, r["profile"]!.ToString() switch { "domain" => 1, "private" => 2, "public" => 4, _ => throw new InvalidOperationException($"Unknown firewall profile in {id}.") }),
            "defenderRealtime" => new DefenderRow(id, name),
            "registry" => new RegistryRow(id, name, r["key"]!.ToString(), r["value"]!.ToString(), r["on"]!.AsArray().Select(n => n!.ToString()).ToArray(), r["off"]!.ToString(),
                r["policy"]?["key"]?.ToString(), r["policy"]?["value"]?.ToString()),
            _ => throw new InvalidOperationException($"Unknown kind of protection in {id}."),
        };
    }

    /// The rows by id. The self-test's rows are known only where `selfTest` says so.
    public static Func<string, IProtection?> Finder(bool selfTest) => id => Rows.Concat(selfTest ? SelfTestRows : []).FirstOrDefault(r => r.Id == id);

    /// "protection.reverts": what waits to come back on and how the last ones ended, for the app. A helper without
    /// admin rights can't read the ledger and says so. One with them also raises a row whose time passed a while ago,
    /// in case the service is gone.
    public static JsonObject Reverts(bool selfTest = false)
    {
        if (!Native.IsAdmin()) return new JsonObject { ["readable"] = false, ["waiting"] = new JsonArray(), ["ended"] = new JsonArray() };
        var ledger = Ledger.Open();
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        ledger.Settle(Finder(selfTest), arms: false, r => now > r.DueAt + RevertKeeper.AppGraceMs, "app");
        return ledger.Status();
    }

    sealed class FirewallRow(string id, string name, int profile) : IProtection
    {
        public string Id => id;
        public string Name => name;
        public bool Allows(int seconds) => EveryRowTime(seconds);
        public string? Was() => null;

        static T With<T>(Func<object, T> act)
        {
            var type = Type.GetTypeFromProgID("HNetCfg.FwPolicy2") ?? throw new RigException("Windows Firewall's own interface isn't on this PC.");
            object policy = Activator.CreateInstance(type)!;
            try { return act(policy); } finally { Marshal.ReleaseComObject(policy); }
        }

        static object? Get(object o, string member, params object[] args) => o.GetType().InvokeMember(member, BindingFlags.GetProperty, null, o, args);

        // 1: a group policy holds the firewall's settings, so a local change wouldn't take.
        public string? Blocked() => With(p => Convert.ToInt32(Get(p, "LocalPolicyModifyState")) == 1)
            ? "Your organisation's policy controls Windows Firewall on this PC, so Rig can't turn it off." : null;

        public bool On() => With(p => Convert.ToBoolean(Get(p, "FirewallEnabled", profile)));
        void Set(bool on) => With(p => p.GetType().InvokeMember("FirewallEnabled", BindingFlags.SetProperty, null, p, [profile, on]));
        public void Lower() => Set(false);
        public void Raise(string? was) => Set(true);
    }

    sealed class DefenderRow(string id, string name) : IProtection
    {
        const string Scope = @"root\Microsoft\Windows\Defender";

        public string Id => id;
        public string Name => name;
        public bool Allows(int seconds) => EveryRowTime(seconds);
        public string? Was() => null;

        static (bool On, bool Tamper) Status()
        {
            using var search = new ManagementObjectSearcher(Scope, "SELECT RealTimeProtectionEnabled, IsTamperProtected FROM MSFT_MpComputerStatus");
            using var found = search.Get();
            foreach (ManagementBaseObject o in found)
                using (o) return (o["RealTimeProtectionEnabled"] is true, o["IsTamperProtected"] is true);
            throw new RigException("Microsoft Defender didn't answer on this PC.");
        }

        public string? Blocked() => Status().Tamper
            ? "Tamper Protection is on, so Windows would ignore this and keep real-time protection running. Nothing was changed. To pause it yourself: Windows Security, Virus & threat protection, Manage settings. Windows turns it back on by itself after a while."
            : null;

        public bool On() => Status().On;

        static void Set(bool off)
        {
            using var prefs = new ManagementClass(Scope, "MSFT_MpPreference", null);
            using var args = prefs.GetMethodParameters("Set");
            args["DisableRealtimeMonitoring"] = off;
            using var done = prefs.InvokeMethod("Set", args, null);
            if (Convert.ToInt64(done?["ReturnValue"] ?? 0) != 0) throw new RigException($"Microsoft Defender refused the change (code {done?["ReturnValue"]}).");
            // Defender takes a moment to say so itself.
            for (int i = 0; i < 20 && Status().On == off; i++) Thread.Sleep(250);
        }

        public void Lower() => Set(off: true);
        public void Raise(string? was) => Set(off: false);
    }

    /// One text value under HKLM: `off` is off, anything else or nothing is on.
    sealed class RegistryRow(string id, string name, string key, string value, string[] on, string off, string? policyKey, string? policyValue) : IProtection
    {
        public string Id => id;
        public string Name => name;
        public bool Allows(int seconds) => EveryRowTime(seconds);

        static RegistryKey? Open(string path, bool write)
        {
            const string hklm = @"HKLM\";
            if (!path.StartsWith(hklm, StringComparison.Ordinal)) throw new InvalidOperationException("A protection's value is under HKLM.");
            using var hive = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            return write ? hive.CreateSubKey(path[hklm.Length..], writable: true) : hive.OpenSubKey(path[hklm.Length..]);
        }

        string? Now() { using var k = Open(key, write: false); return k?.GetValue(value)?.ToString(); }

        public string? Blocked()
        {
            if (policyKey == null || policyValue == null) return null;
            using var k = Open(policyKey, write: false);
            return k?.GetValue(policyValue) != null ? $"Your organisation's policy controls {name} on this PC, so Rig can't turn it off." : null;
        }

        public bool On() => !string.Equals(Now(), off, StringComparison.OrdinalIgnoreCase);
        public string? Was() => on.FirstOrDefault(x => string.Equals(x, Now(), StringComparison.OrdinalIgnoreCase));
        void Set(string text) { using var k = Open(key, write: true); k!.SetValue(value, text, RegistryValueKind.String); }
        public void Lower() => Set(off);
        public void Raise(string? was) => Set(on.FirstOrDefault(x => x == was) ?? on[0]);
    }

    /// The self-test's rows: a number under HKLM\SOFTWARE\RigSelftest, 0 for off. Known only to a self-test.
    public sealed class SelftestRow(int n) : IProtection
    {
        public const string Key = @"SOFTWARE\RigSelftest";
        public string Id => $"selftest-{n}";
        public string Name => $"Rig's test protection {n}";
        public string Value => $"Protection{n}";
        public bool Allows(int seconds) => seconds is >= 1 and <= 3600;
        public string? Blocked() => null;
        public string? Was() => null;
        public bool On() { using var k = Registry.LocalMachine.OpenSubKey(Key); return k?.GetValue(Value) is not 0; }
        public void Set(int v) { using var k = Registry.LocalMachine.CreateSubKey(Key, writable: true); k.SetValue(Value, v, RegistryValueKind.DWord); }
        public void Lower() => Set(0);
        public void Raise(string? was) => Set(1);
    }
}

/// `protection`: turns one row off for `revertAfter` minutes. The self-test's own copy knows the test rows and counts in seconds.
public sealed class ProtectionStep(bool selfTest = false) : INativeStep
{
    public const string OpName = "protection";
    public const string NeedsAdmin = "This needs admin rights, and Rig's helper is running without them. Restart Rig and choose Yes when Windows asks, then try again. Nothing was changed.";

    public string Name => OpName;
    public bool Admin => true;

    /// A row's own reads and writes, with whatever Windows threw said in plain words.
    internal static T Asked<T>(IProtection row, Func<T> act)
    {
        try { return act(); }
        catch (Exception e) when (e is not RigException) { throw new RigException($"Rig couldn't reach {row.Name} on this PC ({e.Message.TrimEnd('.')})."); }
    }

    static string IdOf(JsonObject op) => op["id"] is JsonValue v && v.TryGetValue(out string? s) ? s : "";

    internal static IProtection RowOf(JsonObject op, bool selfTest) =>
        Protections.Finder(selfTest)(IdOf(op)) ?? throw new RigException(Protections.Never(IdOf(op)) is string never ? $"{never}." : $"{Protections.Words("unknown")}: {string.Join(", ", Protections.Ids)}.");

    (IProtection Row, JsonObject Kept, int Seconds) Read(JsonObject op)
    {
        var row = RowOf(op, selfTest);
        int after = op["revertAfter"] == null ? Protections.DefaultMinutes : op["revertAfter"] is JsonValue v && v.TryGetValue(out int n) ? n : -1;
        int seconds = selfTest ? after : after * 60;
        if (!row.Allows(seconds)) throw new RigException($"{Protections.Words("revertAfter")}.");
        return (row, new JsonObject { ["name"] = Name, ["id"] = row.Id, ["revertAfter"] = after }, seconds);
    }

    // Held marks a step that was checked before, so its way back is rechecked as one that is already off.
    NativeCheck Checked(JsonObject kept, string? never = null) => new(kept, 3, [$"{Protections.Words("tier")}."], [], Held: new JsonObject { ["row"] = kept["id"]?.ToString() }, Never: never);

    public NativeCheck Check(JsonObject op)
    {
        if (Protections.Never(IdOf(op)) is string never) return Checked(new JsonObject { ["name"] = Name, ["id"] = IdOf(op) }, never);
        var (row, kept, _) = Read(op);
        if (Native.IsAdmin() && Ledger.Open().Read(row.Id) != null) throw new RigException(Ledger.Busy);
        if (Asked(row, row.Blocked) is string blocked) throw new RigException(blocked);
        if (!Asked(row, row.On)) throw new RigException($"{row.Name} is already off, so there is nothing to turn off.");
        return Checked(kept);
    }

    /// Before "Turn it back on now" the row is off and has its entry, which is the point.
    public NativeCheck Recheck(JsonObject op, JsonObject held) => Checked(Read(op).Kept);

    public string Preview(JsonObject op)
    {
        var row = Read(op).Row;
        return Asked(row, row.On) ? "On" : "Off";
    }

    public JsonObject Apply(JsonObject op)
    {
        var (row, _, seconds) = Read(op);
        if (!Native.IsAdmin()) throw new RigException(NeedsAdmin);
        var ledger = Ledger.Open();
        // No answer from the running service, no lowering.
        var armed = ledger.Arm(row.Id, seconds, Asked(row, row.Was), selfTest ? 4000 : Ledger.AckWaitMs);
        var lowered = Asked(row, () => ledger.Lower(armed, row));
        return new JsonObject { ["revert"] = new JsonObject { ["id"] = lowered.Id, ["dueAt"] = Ledger.Iso(lowered.DueAt) } };
    }

    public string? Verify(JsonObject op)
    {
        var row = Read(op).Row;
        return Asked(row, row.On) ? $"{row.Name} is still on." : null;
    }

    /// The way back only ever raises: "Turn it back on now", and what a failed lowering falls back to.
    public void Undo(JsonObject op, JsonObject back)
    {
        var row = Read(op).Row;
        if (!Native.IsAdmin()) throw new RigException(NeedsAdmin);
        Asked(row, () => { Ledger.Open().RaiseNow(row); return true; });
    }
}

/// `protectionKeep`: the person's second choice. It calls off the revert of a row that is off for now, so it stays off.
public sealed class ProtectionKeepStep(bool selfTest = false) : INativeStep
{
    public const string OpName = "protectionKeep";
    const string Waiting = "Off for now: Rig turns it back on by itself", Staying = "Off until you turn it back on";

    public string Name => OpName;
    public bool Admin => true;

    (IProtection Row, JsonObject Kept) Read(JsonObject op)
    {
        var row = ProtectionStep.RowOf(op, selfTest);
        return (row, new JsonObject { ["name"] = Name, ["id"] = row.Id });
    }

    NativeCheck Checked(JsonObject kept) => new(kept, 3, [$"{Protections.Words("keep")}."], [], Held: new JsonObject { ["row"] = kept["id"]?.ToString() });

    public NativeCheck Check(JsonObject op)
    {
        var (row, kept) = Read(op);
        if (!Native.IsAdmin()) throw new RigException(ProtectionStep.NeedsAdmin);
        if (Ledger.Open().Read(row.Id) is not { State: Revert.Lowered }) throw new RigException(Ledger.NothingToKeep);
        return Checked(kept);
    }

    public NativeCheck Recheck(JsonObject op, JsonObject held) => Checked(Read(op).Kept);

    public string Preview(JsonObject op)
    {
        var row = Read(op).Row;
        if (ProtectionStep.Asked(row, row.On)) return "On";
        return Native.IsAdmin() && Ledger.Open().Read(row.Id) != null ? Waiting : Staying;
    }

    public JsonObject Apply(JsonObject op)
    {
        if (!Native.IsAdmin()) throw new RigException(ProtectionStep.NeedsAdmin);
        Ledger.Open().Keep(Read(op).Row.Id);
        return [];
    }

    public string? Verify(JsonObject op) => Preview(op) == Staying ? null : "It is still set to come back on.";

    public void Undo(JsonObject op, JsonObject back) =>
        throw new RigException("Rig can't set the timer again. To turn this back on, choose Turn it back on now on the change that turned it off.");
}
