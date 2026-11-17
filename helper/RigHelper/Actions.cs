// The fix catalog (packages/core/src/actions.ts), carried out. Every change
// reads the current value first and returns the call that puts it back. Any
// call that isn't in the catalog, or has odd values, is refused.

using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

public static class Actions
{
    static string S(JsonObject c, string k) => c[k] is JsonValue v && v.TryGetValue(out string? s) && s.Length > 0 ? s : throw new RigException($"{k} is missing.");
    static bool B(JsonObject c, string k) => c[k] is JsonValue v && v.TryGetValue(out bool b) ? b : throw new RigException($"{k} must be true or false.");
    static int I(JsonObject c, string k, int min, int max) =>
        c[k] is JsonValue v && v.TryGetValue(out int n) && n >= min && n <= max ? n : throw new RigException($"{k} must be a whole number from {min} to {max}.");

    public static JsonObject Apply(JsonObject call)
    {
        string kind = S(call, "kind");
        return kind switch
        {
            "power.plan" => PowerPlan(S(call, "guid")),
            "startup.app" => StartupApp(S(call, "name"), B(call, "enabled")),
            "windows.gameMode" => GameMode(B(call, "enabled")),
            "windows.visualEffects" => VisualEffects(S(call, "mode")),
            "power.maxProcessorState" => MaxProcessorState(I(call, "ac", 50, 100), I(call, "dc", 50, 100)),
            "display.refreshRate" => RefreshRate(S(call, "display"), I(call, "hz", 24, 600)),
            _ => throw new RigException($"\"{kind}\" isn't a change Rig makes."),
        };
    }

    static JsonObject PowerPlan(string guid)
    {
        if (!Regex.IsMatch(guid, "^[0-9a-fA-F-]{36}$") || !Guid.TryParse(guid, out var target)) throw new RigException("That isn't a power plan id.");
        if (!Native.Schemes().Any(s => s.guid == target)) throw new RigException("That power plan isn't on this PC.");
        var was = Native.ActiveScheme();
        if (Native.PowerSetActiveScheme(IntPtr.Zero, ref target) != 0) throw new RigException("Windows didn't switch the power plan.");
        return new JsonObject { ["kind"] = "power.plan", ["guid"] = was.ToString() };
    }

    static JsonObject StartupApp(string name, bool enabled)
    {
        var e = Facts.StartupEntries().FirstOrDefault(x => string.Equals(x.App.Name, name, StringComparison.OrdinalIgnoreCase))
            ?? throw new RigException($"{name} isn't a startup app on this PC.");
        using var k = e.Hive.CreateSubKey(Facts.Approved + e.ApprovedKey, true);
        // Same format Task Manager writes: 02 = on; 03 + the time it was turned off = off.
        var value = new byte[12];
        value[0] = enabled ? (byte)2 : (byte)3;
        if (!enabled) BitConverter.GetBytes(DateTime.UtcNow.ToFileTimeUtc()).CopyTo(value, 4);
        k.SetValue(e.ValueName, value, RegistryValueKind.Binary);
        return new JsonObject { ["kind"] = "startup.app", ["name"] = e.App.Name, ["enabled"] = e.App.Enabled };
    }

    static JsonObject GameMode(bool enabled)
    {
        bool was = Facts.GameMode();
        using var k = Registry.CurrentUser.CreateSubKey(Facts.GameBar, true);
        k.SetValue("AutoGameModeEnabled", enabled ? 1 : 0, RegistryValueKind.DWord);
        return new JsonObject { ["kind"] = "windows.gameMode", ["enabled"] = was };
    }

    static JsonObject VisualEffects(string mode)
    {
        int value = mode switch { "auto" => 0, "appearance" => 1, "performance" => 2, _ => throw new RigException("mode must be auto, appearance or performance.") };
        string was = Facts.VisualEffects();
        using (var k = Registry.CurrentUser.CreateSubKey(Facts.Effects, true)) k.SetValue("VisualFXSetting", value, RegistryValueKind.DWord);

        // Turn the main animations off or on now, so the change shows without signing out.
        bool on = mode != "performance";
        const uint flags = Native.SPIF_UPDATEINIFILE | Native.SPIF_SENDCHANGE;
        Native.SystemParametersInfo(Native.SPI_SETUIEFFECTS, 0, (IntPtr)(on ? 1 : 0), flags);
        Native.SystemParametersInfo(Native.SPI_SETCLIENTAREAANIMATION, 0, (IntPtr)(on ? 1 : 0), flags);
        Native.SystemParametersInfo(Native.SPI_SETDRAGFULLWINDOWS, on ? 1u : 0u, IntPtr.Zero, flags);
        var anim = new Native.ANIMATIONINFO { cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<Native.ANIMATIONINFO>(), iMinAnimate = on ? 1 : 0 };
        Native.SystemParametersInfo(Native.SPI_SETANIMATION, anim.cbSize, ref anim, flags);

        // "Custom" can't be rebuilt exactly, so Undo goes back to letting Windows choose.
        return new JsonObject { ["kind"] = "windows.visualEffects", ["mode"] = was == "custom" ? "auto" : was };
    }

    static JsonObject MaxProcessorState(int ac, int dc)
    {
        Guid scheme = Native.ActiveScheme(), sub = Native.SUB_PROCESSOR, set = Native.PROCTHROTTLEMAX;
        Native.PowerReadACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint wasAc);
        Native.PowerReadDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, out uint wasDc);
        if (Native.PowerWriteACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, (uint)ac) != 0
            || Native.PowerWriteDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref set, (uint)dc) != 0)
            throw new RigException("Windows didn't save the processor setting.");
        Native.PowerSetActiveScheme(IntPtr.Zero, ref scheme); // applies it now
        return new JsonObject { ["kind"] = "power.maxProcessorState", ["ac"] = (int)Math.Clamp(wasAc, 50, 100), ["dc"] = (int)Math.Clamp(wasDc, 50, 100) };
    }

    static JsonObject RefreshRate(string display, int hz)
    {
        var (name, gdi) = Inventory.NamedScreens().FirstOrDefault(s => s.name == display);
        if (gdi == null) throw new RigException($"There's no screen called {display}.");
        var cur = Native.NewDevMode();
        if (!Native.EnumDisplaySettings(gdi, Native.ENUM_CURRENT_SETTINGS, ref cur)) throw new RigException($"Couldn't read {name}'s settings.");
        int was = cur.dmDisplayFrequency;
        if (hz > Inventory.MaxRefresh(gdi, cur.dmPelsWidth, cur.dmPelsHeight)) throw new RigException($"{name} doesn't offer {hz} Hz at this resolution.");

        var dm = cur;
        dm.dmDisplayFrequency = hz;
        dm.dmFields = Native.DM_PELSWIDTH | Native.DM_PELSHEIGHT | Native.DM_DISPLAYFREQUENCY;
        if (Native.ChangeDisplaySettingsEx(gdi, ref dm, IntPtr.Zero, Native.CDS_TEST, IntPtr.Zero) != Native.DISP_CHANGE_SUCCESSFUL)
            throw new RigException($"{name} said no to {hz} Hz. Try a different cable or port.");
        if (Native.ChangeDisplaySettingsEx(gdi, ref dm, IntPtr.Zero, Native.CDS_UPDATEREGISTRY, IntPtr.Zero) != Native.DISP_CHANGE_SUCCESSFUL)
            throw new RigException($"Windows didn't switch {name} to {hz} Hz.");
        return new JsonObject { ["kind"] = "display.refreshRate", ["display"] = name, ["hz"] = was };
    }
}
