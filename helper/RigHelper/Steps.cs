// Every fix behind one shape: read what is there, make the change (returning
// the call that puts it back), and read it again to check it held. The six
// first fixes are still Actions.cs, unchanged; here each only gains a read and
// a check. A check that fails is reported with the change, not thrown: the
// change was made, and undo still puts it back.

using System.Text.Json.Nodes;

namespace Rig.Helper;

public interface IStep
{
    /// What the fix's target holds now, for the preview, in the app's FixNow shape. Null when the facts already hold it.
    JsonNode? Read(JsonObject call);
    /// Makes the change and returns the call that puts it back.
    JsonObject Apply(JsonObject call);
    /// Reads it back after Apply: null when the change holds, else what Windows shows now, in plain words.
    string? Verify(JsonObject call);
}

public static class Steps
{
    public static string S(JsonObject c, string k, bool allowEmpty = false) =>
        c[k] is JsonValue v && v.TryGetValue(out string? s) && (allowEmpty || s.Length > 0) ? s : throw new RigException($"{k} is missing.");
    static bool B(JsonObject c, string k) => c[k] is JsonValue v && v.TryGetValue(out bool b) ? b : throw new RigException($"{k} must be true or false.");
    static int I(JsonObject c, string k) => c[k] is JsonValue v && v.TryGetValue(out int n) ? n : throw new RigException($"{k} must be a whole number.");
    static string OnOff(bool on) => on ? "on" : "off";

    /// One of the six first fixes: Actions.Apply as it was, with a read-back check.
    sealed class Fix(Func<JsonObject, string?> verify) : IStep
    {
        public JsonNode? Read(JsonObject call) => null;
        public JsonObject Apply(JsonObject call) => Actions.Apply(call);
        public string? Verify(JsonObject call) => verify(call);
    }

    static readonly Dictionary<string, IStep> All = new()
    {
        ["power.plan"] = new Fix(c =>
        {
            var now = Native.ActiveScheme();
            return Guid.TryParse(S(c, "guid"), out var want) && now == want ? null : $"The power plan is still {Native.Schemes().FirstOrDefault(s => s.guid == now).name ?? "the one before"}.";
        }),
        ["startup.app"] = new Fix(c =>
        {
            string name = S(c, "name");
            bool want = B(c, "enabled");
            var app = Facts.StartupEntries().FirstOrDefault(x => string.Equals(x.App.Name, name, StringComparison.OrdinalIgnoreCase))?.App;
            return app == null ? $"{name} isn't in the startup list any more." : app.Enabled == want ? null : $"{app.Name} is still {OnOff(app.Enabled)} at startup.";
        }),
        ["windows.gameMode"] = new Fix(c => Facts.GameMode() == B(c, "enabled") ? null : $"Game Mode is still {OnOff(Facts.GameMode())}."),
        ["windows.visualEffects"] = new Fix(c =>
        {
            string now = Facts.VisualEffects();
            return now == S(c, "mode") ? null : $"Visual effects are still set to {now}.";
        }),
        ["power.maxProcessorState"] = new Fix(c =>
        {
            Guid scheme = Native.ActiveScheme(), sub = Native.SUB_PROCESSOR, set = Native.PROCTHROTTLEMAX;
            Native.PowerReadACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint ac);
            Native.PowerReadDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint dc);
            return ac == I(c, "ac") && dc == I(c, "dc") ? null : $"The processor cap reads {ac}% plugged in and {dc}% on battery.";
        }),
        ["display.refreshRate"] = new Fix(c =>
        {
            string display = S(c, "display");
            var (name, gdi) = Inventory.NamedScreens().FirstOrDefault(s => s.name == display);
            var cur = Native.NewDevMode();
            if (gdi == null || !Native.EnumDisplaySettings(gdi, Native.ENUM_CURRENT_SETTINGS, ref cur)) return $"Rig couldn't read {display}'s refresh rate back.";
            return cur.dmDisplayFrequency == I(c, "hz") ? null : $"{name} runs at {cur.dmDisplayFrequency} Hz.";
        }),
        ["power.setting"] = new PowerStep(),
    };

    // Anything else goes to Actions.Apply, which refuses it in the same words as before.
    static IStep? Of(JsonObject call) => All.GetValueOrDefault(S(call, "kind"));

    /// The pipe's "apply": the undo call as before, and what reading the change back showed.
    public static JsonObject Apply(JsonObject call)
    {
        if (Of(call) is not IStep step) return new JsonObject { ["undo"] = Actions.Apply(call) };
        var undo = step.Apply(call);
        string? problem;
        try { problem = step.Verify(call); }
        catch (Exception e) { problem = e is RigException ? e.Message : "Rig couldn't read it back to check."; }
        return new JsonObject { ["undo"] = undo, ["verify"] = problem == null ? new JsonObject { ["ok"] = true } : new JsonObject { ["ok"] = false, ["problem"] = problem } };
    }

    /// The pipe's "fix.read": what a fix's target holds now, for the preview.
    public static JsonNode? Read(JsonObject call) =>
        (Of(call) ?? throw new RigException($"\"{S(call, "kind")}\" isn't a change Rig makes.")).Read(call) ?? throw new RigException("Rig reads this one from the PC's settings.");

    /// What the selftest holds the fixes to. The power check only reads, and the values it offers are refused before anything is written.
    public static IEnumerable<string> SelfChecks()
    {
        foreach (var p in FixRules.SelfChecks()) yield return p;
        foreach (var p in PowerChecks()) yield return p;
    }

    static JsonObject Call(string json) => JsonNode.Parse(json)!.AsObject();

    static List<string> PowerChecks()
    {
        var problems = new List<string>();
        int read = 0;
        foreach (var p in FixRules.Power)
        {
            var call = Call($$"""{"kind":"power.setting","subgroup":"{{p.SubgroupAlias ?? p.Subgroup.ToString()}}","setting":"{{p.SettingAlias ?? p.Setting.ToString().ToUpperInvariant()}}","ac":0,"dc":0}""");
            try
            {
                var now = Read(call);
                uint ac = now?["ac"]?.GetValue<uint>() ?? uint.MaxValue, dc = now?["dc"]?.GetValue<uint>() ?? uint.MaxValue;
                if (ac < p.Min || ac > p.Max || dc < p.Min || dc > p.Max) problems.Add($"{p.Title} reads {ac} / {dc}, outside Windows' own range");
                read++;
            }
            // Some PCs' plans leave a setting out (a desktop has no hibernate, say); that's said in words, not a failure.
            catch (RigException) { }
            catch (Exception e) { problems.Add($"reading {p.Title} failed: {e.Message}"); }
        }
        if (read == 0) problems.Add("no power setting could be read on the active plan");
        try { Read(Call("""{"kind":"power.setting","subgroup":"SUB_PROCESSOR","setting":"PERFBOOSTMODE","ac":0,"dc":0}""")); problems.Add("a power setting outside the list was read"); }
        catch (RigException) { }
        foreach (var (setting, ac, dc) in new (string, long, long)[] { ("STANDBYIDLE", 1, 60), ("STANDBYIDLE", 60, 4294967295), ("ASPM", 0, 3) })
        {
            var sub = setting == "ASPM" ? "SUB_PCIEXPRESS" : "SUB_SLEEP";
            try { Apply(Call($$"""{"kind":"power.setting","subgroup":"{{sub}}","setting":"{{setting}}","ac":{{ac}},"dc":{{dc}}}""")); problems.Add($"{setting} at {ac} / {dc} went through"); }
            catch (RigException) { }
        }
        var sleep = FixRules.Power.First(p => p.SettingAlias == "STANDBYIDLE");
        if (sleep.Nearest(30) != 60 || sleep.Nearest(0) != 0 || sleep.Nearest(4294967295) != 86400 || sleep.Nearest(600) != 600) problems.Add("undo of a sleep time Rig doesn't set wouldn't put back the nearest one it does");
        return problems;
    }
}
