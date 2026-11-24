// The power.setting fix (packages/core/src/actions.ts): one setting on the
// active plan, held to the ranges in fixes.json, which is embedded in this exe.
// It reads what is there first, so the call it returns puts that back.

using System.Reflection;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

/// The power settings Rig changes, read from the same file the server and the app check against.
public static class FixRules
{
    static JsonObject Load(string name)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name) ?? throw new InvalidOperationException($"{name} isn't in the helper.");
        return JsonNode.Parse(s)!.AsObject();
    }

    static readonly JsonObject Fixes = Load("Rig.Rules.fixes.json");

    public static readonly IReadOnlyList<PowerInfo> Power = Fixes["power"]!.AsArray().Select(p => new PowerInfo(
        p!["id"]!.GetValue<string>(), p["title"]!.GetValue<string>(),
        Guid.Parse(p["subgroup"]!.GetValue<string>()), p["subgroupAlias"]?.GetValue<string>(),
        Guid.Parse(p["setting"]!.GetValue<string>()), p["settingAlias"]?.GetValue<string>(),
        p["windows"]![0]!.GetValue<uint>(), p["windows"]![1]!.GetValue<uint>(),
        p["range"]![0]!.GetValue<uint>(), p["range"]![1]!.GetValue<uint>(), p["atLeast"]?.GetValue<uint>() ?? 0)).ToList();

    public static IEnumerable<string> SelfChecks()
    {
        if (Power.Count < 8) yield return "the power settings didn't load from the embedded file";
        foreach (var p in Power)
            if (p.From > p.To || p.From < p.Min || p.To > p.Max || (p.AtLeast != 0 && (p.AtLeast < p.From || p.AtLeast > p.To))) yield return $"{p.Title}'s range is outside Windows' own";
    }
}

/// Windows' own range is Min to Max; Rig sets only From to To, and a value that isn't 0 at least AtLeast.
public record PowerInfo(string Id, string Title, Guid Subgroup, string? SubgroupAlias, Guid Setting, string? SettingAlias, uint Min, uint Max, uint From, uint To, uint AtLeast)
{
    public bool Allows(long n) => n >= From && n <= To && (n == 0 || n >= AtLeast);

    /// The nearest value Rig would set: what undo puts back when the old value is one Rig doesn't set.
    public uint Nearest(uint n)
    {
        if (Allows(n)) return n;
        uint c = Math.Clamp(n, From, To);
        return c != 0 && c < AtLeast ? AtLeast : c;
    }

    public string Says => AtLeast != 0 ? $"0 for never or {AtLeast} to {To}" : $"a whole number from {From} to {To}";
}

/// power.setting: one allowed setting on the active plan, plugged in and on battery.
public sealed class PowerStep : IStep
{
    static bool Same(string asked, Guid guid, string? alias) =>
        (Guid.TryParse(asked, out var g) && g == guid && Regex.IsMatch(asked, "^[0-9a-fA-F-]{36}$")) || (alias != null && string.Equals(asked, alias, StringComparison.OrdinalIgnoreCase));

    public static PowerInfo Info(JsonObject c)
    {
        string sub = Steps.S(c, "subgroup"), set = Steps.S(c, "setting");
        return FixRules.Power.FirstOrDefault(p => Same(sub, p.Subgroup, p.SubgroupAlias) && Same(set, p.Setting, p.SettingAlias))
            ?? throw new RigException("That isn't one of the power settings Rig changes.");
    }

    public static (uint Ac, uint Dc) ReadNow(PowerInfo p)
    {
        Guid scheme = Native.ActiveScheme(), sub = p.Subgroup, set = p.Setting;
        if (Native.PowerReadACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint ac) != 0 || Native.PowerReadDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint dc) != 0)
            throw new RigException($"This PC's power plan doesn't have the {p.Title} setting.");
        return (ac, dc);
    }

    static uint Value(JsonObject c, string k, PowerInfo p) =>
        c[k] is JsonValue v && v.TryGetValue(out long n) && p.Allows(n) ? (uint)n : throw new RigException($"{k} must be {p.Says}.");

    public JsonNode? Read(JsonObject c)
    {
        var (ac, dc) = ReadNow(Info(c));
        return new JsonObject { ["kind"] = "power.setting", ["ac"] = ac, ["dc"] = dc };
    }

    public JsonObject Apply(JsonObject c)
    {
        var p = Info(c);
        uint ac = Value(c, "ac", p), dc = Value(c, "dc", p);
        var was = ReadNow(p);
        Guid scheme = Native.ActiveScheme(), sub = p.Subgroup, set = p.Setting;
        if (Native.PowerWriteACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, ac) != 0 || Native.PowerWriteDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, dc) != 0)
            throw new RigException($"Windows didn't save the {p.Title} setting.");
        Native.PowerSetActiveScheme(IntPtr.Zero, ref scheme); // applies it now
        return new JsonObject { ["kind"] = "power.setting", ["subgroup"] = p.Subgroup.ToString(), ["setting"] = p.Setting.ToString(), ["ac"] = p.Nearest(was.Ac), ["dc"] = p.Nearest(was.Dc) };
    }

    public string? Verify(JsonObject c)
    {
        var p = Info(c);
        var now = ReadNow(p);
        return now.Ac == Value(c, "ac", p) && now.Dc == Value(c, "dc", p) ? null : $"{p.Title} reads {now.Ac} plugged in and {now.Dc} on battery.";
    }
}
