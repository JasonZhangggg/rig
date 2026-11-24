// The self-test's checks of screen steps (Screen.cs, ScreenWalk.cs).
//
// The self-test opens a small window of its own with plain Windows controls:
// three tabs, on the second a checkbox and a drop-down, on the third a list
// and a rich text box holding tabs of its own (UI Automation calls such
// a box a Document, as it does a web page); below them two checkboxes with the
// same name and an Apply button. The controls only take effect when Apply is
// pressed, and Apply is on only while a control differs from what it last
// took, as in a Windows settings dialog, so a check can tell a walk that set a
// control from one that also pressed Apply. The worker drives that window from
// its own process through UI Automation, exactly as it drives an app's. On a
// runner without a desktop the checks that need the window say so and are
// skipped.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;

namespace Rig.Helper;

static class ScreenSelfTest
{
    const string WindowClass = "RigSelftestWindow", App = ScreenRules.SelfTestApp, Skip = CommandSelfTest.Skip;
    const int ApplyId = 1, SharpenId = 10, QualityId = 11;
    const uint BM_GETCHECK = 0xf0, BM_SETCHECK = 0xf1, CB_ADDSTRING = 0x143, CB_GETCURSEL = 0x147, CB_SETCURSEL = 0x14e, CB_SHOWDROPDOWN = 0x14f, TCM_GETCURSEL = 0x130b, TCM_SETCURSEL = 0x130c, TCM_INSERTITEMW = 0x133e;
    const uint LB_ADDSTRING = 0x180, LB_SETCURSEL = 0x186, LB_GETCURSEL = 0x188;

    static IntPtr window, tab, nothing, sharpen, label, quality, modes, page, pageTabs, twin, apply;
    static int shown = -1;
    static bool hidden;
    /// What the window's Apply last took from its controls, and how often it was pressed.
    static volatile int applied, appliedSharpen, appliedQuality;
    /// `hide` takes the second tab's controls away, as a page an app is still loading; `linked` makes the first Twin
    /// follow the checkbox, as a setting that changes another.
    static volatile bool hide, linked, linkedSeen;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct TCITEM { public uint mask, dwState, dwStateMask; public string pszText; public int cchTextMax, iImage; public IntPtr lParam; }
    [StructLayout(LayoutKind.Sequential)] struct INITCOMMONCONTROLSEX { public int dwSize, dwICC; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr hwnd, uint msg, IntPtr w, ref TCITEM item);
    [DllImport("comctl32.dll")] static extern bool InitCommonControlsEx(ref INITCOMMONCONTROLSEX which);
    [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder info, int size, out int needed);
    [DllImport("user32.dll")] static extern bool EnableWindow(IntPtr hwnd, bool enable);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryW(string name);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SetWindowTextW(IntPtr hwnd, string text);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int size);

    static int Tab => (int)Win.SendMessageW(tab, TCM_GETCURSEL, 0, 0);
    static bool Sharpen => Win.SendMessageW(sharpen, BM_GETCHECK, 0, 0) == 1;
    static int Quality => (int)Win.SendMessageW(quality, CB_GETCURSEL, 0, 0);
    static int Mode => (int)Win.SendMessageW(modes, LB_GETCURSEL, 0, 0);
    static int Page => (int)Win.SendMessageW(pageTabs, TCM_GETCURSEL, 0, 0);
    static bool Dirty => Sharpen != (appliedSharpen == 1) || Quality != appliedQuality;

    static IntPtr Proc(IntPtr hwnd, uint msg, IntPtr w, IntPtr l)
    {
        switch (msg)
        {
            case Win.WM_COMMAND when ((long)w & 0xffff) == ApplyId && (((long)w >> 16) & 0xffff) == 0:
                appliedSharpen = Sharpen ? 1 : 0;
                appliedQuality = Quality;
                applied++;
                return 0;
            case Win.WM_TIMER:
                if (Tab != shown || hide != hidden)
                {
                    // A tab's controls exist for UI Automation only while that tab is open, like a page an app loads late.
                    (shown, hidden) = (Tab, hide);
                    Win.ShowWindow(nothing, shown == 0 ? 8 : 0);
                    foreach (IntPtr control in new[] { sharpen, label, quality }) Win.ShowWindow(control, shown == 1 && !hidden ? 8 : 0);
                    foreach (IntPtr control in new[] { modes, page }) Win.ShowWindow(control, shown == 2 ? 8 : 0);
                }
                if (linked && Sharpen != linkedSeen)
                {
                    linkedSeen = Sharpen;
                    Win.SendMessageW(twin, BM_SETCHECK, Sharpen ? 1 : 0, 0);
                }
                if (IsWindowEnabled(apply) != Dirty) EnableWindow(apply, Dirty);
                return 0;
            case Win.WM_DESTROY:
                Win.PostQuitMessage(0);
                break;
        }
        return Win.DefWindowProcW(hwnd, msg, w, l);
    }

    static void Open()
    {
        var ready = new ManualResetEventSlim();
        new Thread(() =>
        {
            var which = new INITCOMMONCONTROLSEX { dwSize = 8, dwICC = 0x8 };
            InitCommonControlsEx(ref which);
            Win.Class(WindowClass, Proc);
            const uint child = Win.WS_CHILD, seen = Win.WS_CHILD | Win.WS_VISIBLE, checkbox = 0x3, dropList = 0x3;
            IntPtr made = Win.Make(0, WindowClass, "Rig self-test", Win.WS_OVERLAPPEDWINDOW | Win.WS_VISIBLE, 120, 120, 470, 300);
            if (made != IntPtr.Zero)
            {
                tab = Win.Make(0, "SysTabControl32", "", seen, 10, 10, 430, 180, made, 2);
                Tabs(tab, "General", "Display", "More");
                nothing = Win.Make(0, "STATIC", "Nothing to set here.", seen, 30, 50, 300, 20, made);
                sharpen = Win.Make(0, "BUTTON", "Sharpen images", child | checkbox, 30, 50, 300, 24, made, SharpenId);
                label = Win.Make(0, "STATIC", "Quality", child, 30, 92, 80, 20, made);
                quality = Win.Make(0, "COMBOBOX", "", child | Win.WS_VSCROLL | dropList, 120, 88, 160, 200, made, QualityId);
                foreach (string choice in new[] { "Low", "Medium", "High" }) Win.SendMessageW(quality, CB_ADDSTRING, 0, choice);
                Win.SendMessageW(quality, CB_SETCURSEL, 0, 0);
                modes = Win.Make(0, "LISTBOX", "", child | Win.WS_BORDER, 30, 50, 120, 60, made, 30);
                foreach (string mode in new[] { "Fast", "Quiet" }) Win.SendMessageW(modes, LB_ADDSTRING, 0, mode);
                Win.SendMessageW(modes, LB_SETCURSEL, 0, 0);
                LoadLibraryW("msftedit.dll");
                page = Win.Make(0, "RICHEDIT50W", "", child | Win.WS_BORDER | 0x4, 170, 50, 250, 120, made, 31);
                pageTabs = Win.Make(0, "SysTabControl32", "", seen, 10, 10, 220, 60, page, 32);
                Tabs(pageTabs, "Page one", "Page two");
                twin = Win.Make(0, "BUTTON", "Twin", seen | checkbox, 30, 205, 90, 24, made, 20);
                Win.Make(0, "BUTTON", "Twin", seen | checkbox, 130, 205, 90, 24, made, 21);
                apply = Win.Make(0, "BUTTON", "Apply", seen | 0x08000000, 340, 203, 96, 28, made, ApplyId);
                Win.SetTimer(made, 1, 50, IntPtr.Zero);
                Win.SetWindowPos(made, 0, 0, 0, 0, 0, 0x1 | 0x2 | 0x4 | 0x40);
            }
            window = made;
            ready.Set();
            if (made != IntPtr.Zero) Win.Loop();
        }) { IsBackground = true }.Start();
        ready.Wait(10_000);
    }

    static void Tabs(IntPtr control, params string[] names)
    {
        for (int at = 0; at < names.Length; at++)
        {
            var item = new TCITEM { mask = 1, pszText = names[at] };
            SendMessageW(control, TCM_INSERTITEMW, at, ref item);
        }
    }

    /// Why this runner can't show a window to drive, or null when it can.
    static string? NoDesktop()
    {
        if (Process.GetCurrentProcess().SessionId == 0) return "this runner is in Windows' services session, which has no desktop";
        var station = new StringBuilder(256);
        if (!GetUserObjectInformationW(GetProcessWindowStation(), 2, station, station.Capacity * 2, out _) || !station.ToString().Equals("WinSta0", StringComparison.OrdinalIgnoreCase))
            return $"this runner isn't on an interactive desktop (window station {station})";
        if (window == IntPtr.Zero) Open();
        return window == IntPtr.Zero ? "this runner wouldn't open a window" : null;
    }

    static void Reset()
    {
        hide = linked = linkedSeen = false;
        SetWindowTextW(apply, "Apply");
        Win.SendMessageW(tab, TCM_SETCURSEL, 0, 0);
        Win.SendMessageW(pageTabs, TCM_SETCURSEL, 0, 0);
        Win.SendMessageW(modes, LB_SETCURSEL, 0, 0);
        Win.SendMessageW(sharpen, BM_SETCHECK, 0, 0);
        Win.SendMessageW(twin, BM_SETCHECK, 0, 0);
        Win.SendMessageW(quality, CB_SETCURSEL, 0, 0);
        appliedSharpen = appliedQuality = 0;
        Thread.Sleep(200);
        applied = 0;
    }

    static bool Is(JsonNode? n, string outcome) => n?["outcome"]?.ToString() == outcome;
    static JsonNode LookAt(Commands rig, string app, params string[] goal) =>
        rig.Handle("screen.look", new JsonObject { ["app"] = app, ["goal"] = new JsonArray(goal.Select(g => (JsonNode)g).ToArray()) });
    static JsonObject Step(string? lookId, string to, string does = "Rig's self-test change.") =>
        new() { ["kind"] = "native", ["op"] = new JsonObject { ["name"] = ScreenStep.OpName, ["lookId"] = lookId, ["to"] = to, ["does"] = does } };
    static JsonObject Step(JsonNode look, string to) => Step(look["lookId"]?.ToString(), to);
    static JsonNode Preview(Commands rig, JsonObject step) => rig.Handle("step.preview", new JsonObject { ["step"] = step.DeepClone() });
    static JsonNode Apply(Commands rig, JsonNode preview) => rig.Handle("step.apply", new JsonObject { ["nonce"] = preview["nonce"]?.ToString() });
    static JsonNode Undo(Commands rig, JsonNode applied, bool force = false) => rig.Handle("step.undo", new JsonObject { ["id"] = applied["undo"]?["id"]?.ToString(), ["force"] = force });
    static string Refusal(JsonNode? reply) => reply?["verdict"]?["refused"]?.ToString() ?? "";
    static string Options(JsonNode? look) => string.Join(",", (look?["options"] as JsonArray ?? []).Select(o => o?.ToString()));

    public static IEnumerable<(string Name, Func<IEnumerable<string>> Run)> Checks(Commands rig, CommandStore store) =>
    [
        ("screen: the apps a look may open, a step's fingerprint, and who signed a program", Rules),
        ("screen: a look at a refused program or page is refused", () => RefusedLooks(rig)),
        ("screen: a look reads a checkbox behind a tab and changes nothing", () => OnDesktop(rig, store, Looks)),
        ("screen: a value the control didn't offer, an unknown look and an unclean look are refused", () => OnDesktop(rig, store, NotOffered)),
        ("screen: apply sets it, presses Apply and reads it back, and undo puts it back", () => OnDesktop(rig, store, AppliedAndUndone)),
        ("screen: a value that moved since the look is refused at apply", () => OnDesktop(rig, store, Moved)),
        ("screen: Stop ends a walk", () => OnDesktop(rig, store, Stopped)),
        ("screen: after Stop during an apply nothing walks the window again", () => OnDesktop(rig, store, StoppedApply)),
        ("screen: an app that wants a button Rig doesn't know pressed isn't reported as changed", () => OnDesktop(rig, store, UnknownCommit)),
        ("screen: Apply isn't pressed over changes the card didn't show", () => OnDesktop(rig, store, NotShown)),
        ("screen: a look picks no list row and presses nothing in web content", () => OnDesktop(rig, store, LookActs)),
        ("screen: a look at a program that ships with Windows", () => OnDesktop(rig, store, RealProgram, last: true)),
    ];

    /// Runs a check that drives the self-test's window, with the worker's self-test switch on. What the check adds to
    /// the day's count of changes is taken off again, so the checks after it count as they did.
    static IEnumerable<string> OnDesktop(Commands rig, CommandStore store, Func<Commands, IEnumerable<string>> check, bool last = false)
    {
        if (NoDesktop() is string why) return [Skip + why];
        string cap = Path.Combine(store.Root, "cap.json");
        byte[]? counted = File.Exists(cap) ? File.ReadAllBytes(cap) : null;
        rig.TestOnlyNativeOps = true;
        try
        {
            Reset();
            return check(rig).ToList();
        }
        finally
        {
            rig.TestOnlyNativeOps = false;
            if (counted != null) File.WriteAllBytes(cap, counted); else File.Delete(cap);
            if (last) Win.PostMessageW(window, Win.WM_CLOSE, 0, 0);
        }
    }

    static IEnumerable<string> Rules()
    {
        foreach (var e in ScreenRules.Examples)
        {
            bool refused;
            try { ScreenRules.Resolve(e.App, selfTest: false); refused = false; } catch (RigException) { refused = true; }
            if (refused != e.Refused) yield return $"{e.App} was {(refused ? "refused" : "taken")}";
        }
        // packages/core/test/screen.test.ts holds the same value.
        string? hash = HelperStep.From(Step("0123456789abcdef0123456789abcdef", "Ultra", "Turns on the lowest-latency mode."), out _)?.Hash();
        if (hash != "11c8f16a31f39d8059a97c5e1fb5422f5f24bc917f7f4a05bf969ef4e0e04e3d") yield return $"a screen step's fingerprint is {hash}, not the app's";
        string plain = ScreenRules.Plain(" A\tB\r\n\u2019c\u2019 \u4e2d\u00ae ");
        if (plain != "A B 'c' ?" || ScreenRules.Plain(new string('x', 200)).Length != 80) yield return $"an app's text came out as \"{plain}\"";
        foreach (var e in ScreenRules.ImageExamples)
        {
            var app = ScreenRules.Resolve(e.App, selfTest: false);
            bool isIt = ScreenRules.Is(app, e.Image, e.Family), trusted = ScreenRules.Trusted(app, e.Image, e.Signer, e.Family);
            if (isIt != e.Is || trusted != e.Trusted) yield return $"{e.Image} (package \"{e.Family}\", signer \"{e.Signer}\") read as {(isIt ? "" : "not ")}{e.App}, {(trusted ? "" : "not ")}trusted";
        }
        foreach (var (name, never) in new[] { ("Reset", true), ("Restore defaults", true), ("Your account", true), ("Preset", false), ("Swipe", false), ("Low latency", false) })
            if (ScreenRules.NeverName(name) != never) yield return $"\"{name}\" {(never ? "wasn't" : "was")} taken for a name Rig never presses";
        if (!ScreenWalk.TooHigh(Native.HighIntegrity, Native.MediumIntegrity) || !ScreenWalk.TooHigh(0, Native.HighIntegrity) || ScreenWalk.TooHigh(Native.MediumIntegrity, Native.MediumIntegrity))
            yield return "a window with more rights than the worker wasn't told apart from one without";

        string cmd = Path.Combine(Environment.SystemDirectory, "cmd.exe"), unsigned = Path.Combine(Path.GetTempPath(), $"rig-selftest-{CommandStore.NewId()}.exe");
        if (Signature.Signer(cmd) is not string signer) yield return "Windows' own cmd.exe didn't read as signed";
        else if (!signer.Contains("Microsoft", StringComparison.Ordinal)) yield return $"Windows' own cmd.exe read as signed by \"{signer}\"";
        File.WriteAllBytes(unsigned, File.ReadAllBytes(cmd).Concat(new byte[] { 1 }).ToArray());
        try { if (Signature.Signer(unsigned) != null) yield return "a changed copy of cmd.exe read as signed"; }
        finally { File.Delete(unsigned); }
    }

    static IEnumerable<string> RefusedLooks(Commands rig)
    {
        foreach (string app in new[] { @"C:\Windows\regedit.exe", @"C:\Windows\System32\mmc.exe", "ms-settings:signinoptions", @"C:\Program Files\Rig\RigHelper.exe", App })
        {
            var r = LookAt(rig, app, "Anything");
            if (r["refused"] == null || r["lookId"] != null) yield return $"a look at {app} wasn't refused: {r.ToJsonString()}";
        }
        var regedit = LookAt(rig, @"C:\Windows\regedit.exe", "Anything");
        if (regedit["refused"]?.ToString() != "Rig doesn't drive Windows' own admin tools.") yield return $"regedit was refused as: {regedit.ToJsonString()}";
        if (Process.GetProcessesByName("regedit").Length > 0) yield return "regedit is running";
        string charmap = Path.Combine(Environment.SystemDirectory, "charmap.exe");
        if (LookAt(rig, charmap)["refused"] == null || LookAt(rig, charmap, "two\nlines")["refused"] == null) yield return "a look with no control named, or one named over two lines, wasn't refused";
        var reset = LookAt(rig, charmap, "Options", "Restore defaults");
        if (reset["refused"]?.ToString() != ScreenRules.Words("never-name")) yield return $"a look through a control named like one Rig never presses answered {reset.ToJsonString()}";
    }

    static IEnumerable<string> Looks(Commands rig)
    {
        var look = LookAt(rig, App, "Display", "Sharpen images");
        if (look["lookId"]?.ToString() is not string id || !CommandStore.Id.IsMatch(id) || look["value"]?.ToString() != "Off" || Options(look) != "On,Off" || look["clean"]?.GetValue<bool>() != true
            || string.Join(" > ", (look["path"] as JsonArray ?? []).Select(w => w?.ToString())) != "Rig's self-test window > Display > Sharpen images")
        {
            yield return $"the look at the checkbox answered {look.ToJsonString()}";
            yield break;
        }
        if (Tab != 1) yield return "the look didn't open the second tab";
        if (Sharpen || applied != 0) yield return "a look ticked the checkbox or pressed Apply";

        var combo = LookAt(rig, App, "display", "quality");
        if (combo["value"]?.ToString() != "Low" || Options(combo) != "Low,Medium,High") yield return $"the look at the drop-down answered {combo.ToJsonString()}";
        if (Quality != 0 || applied != 0) yield return "a look changed the drop-down or pressed Apply";
        // A closed classic drop-down shows UI Automation no rows, so the list is opened first, as a person might leave it.
        Win.SendMessageW(tab, TCM_SETCURSEL, 1, 0);
        Thread.Sleep(300);
        Win.SendMessageW(quality, CB_SHOWDROPDOWN, 1, 0);
        JsonNode entry;
        try { entry = LookAt(rig, App, "Display", "High"); }
        finally { Win.SendMessageW(quality, CB_SHOWDROPDOWN, 0, 0); }
        if (entry["refused"]?.ToString() != ScreenRules.Words("combo-row")) yield return $"a look that named one of the drop-down's entries answered {entry.ToJsonString()}";
        if (Quality != 0 || applied != 0) yield return $"a look that named one of the drop-down's entries left it at {Quality}, and Apply was pressed {applied} times";

        var twin = LookAt(rig, App, "Twin");
        if (twin["refused"]?.ToString().Contains("2 controls named Twin") != true) yield return $"a name two controls share wasn't refused: {twin.ToJsonString()}";
        var none = LookAt(rig, App, "Display", "Not a control");
        var shows = (none["shows"] as JsonArray ?? []).Select(s => s?.ToString()).ToList();
        if (none["refused"] == null || !shows.Contains("Sharpen images") || !shows.Contains("Apply")) yield return $"a name that isn't there wasn't answered with what is: {none.ToJsonString()}";
    }

    static IEnumerable<string> NotOffered(Commands rig)
    {
        var look = LookAt(rig, App, "Display", "Sharpen images");
        if (look["lookId"] == null) { yield return $"the look answered {look.ToJsonString()}"; yield break; }
        var check = rig.Handle("step.check", new JsonObject { ["step"] = Step(look, "On") })["verdict"];
        if (check?["status"]?.ToString() != "allowed" || Json.Num(check["tier"], 0) != 3 || check["admin"]?.GetValue<bool>() != false) yield return $"a screen step checked as {check?.ToJsonString()}";
        var other = Preview(rig, Step(look, "Maybe"));
        if (!Is(other, "refused") || Refusal(other) != ScreenRules.Words("not-offered")) yield return $"a value the checkbox doesn't offer got {other.ToJsonString()}";
        var unknown = Preview(rig, Step(new string('f', 32), "On"));
        if (!Is(unknown, "refused") || Refusal(unknown) != ScreenRules.Words("unknown-look")) yield return $"a look Rig never made got {unknown.ToJsonString()}";
        var sent = Step(look, "On");
        sent["op"]!["hops"] = new JsonArray("Apply");
        if (rig.Check(HelperStep.From(sent, out _)).Step?.ToJson().ToJsonString().Contains("hops") != false) yield return "a step kept hops the app sent, or was refused for them";

        var unclean = new ScreenLook(App, "Rig's self-test window", "", "", [], new Hop("Sharpen images", "Sharpen images", Uia.CheckBox, "", ""), "toggle", "Off", [("On", "On"), ("Off", "Off")], 0, 0, Clean: false);
        var tainted = Preview(rig, Step(ScreenStep.Keep(unclean).Id, "On"));
        if (!Is(tainted, "refused") || Refusal(tainted) != ScreenRules.Words("unclean")) yield return $"a step on a look that wasn't clean got {tainted.ToJsonString()}";
        var resets = unclean with { Kind = "choice", Value = "Low", Options = [("Low", "Low"), ("Reset everything", "Reset everything")], Clean = true };
        var never = Preview(rig, Step(ScreenStep.Keep(resets).Id, "Reset everything"));
        if (!Is(never, "refused") || Refusal(never) != ScreenRules.Words("never-name")) yield return $"a step to a value named like one Rig never sets got {never.ToJsonString()}";
        if (Sharpen || applied != 0) yield return "a refused step changed something";
    }

    static IEnumerable<string> AppliedAndUndone(Commands rig)
    {
        var look = LookAt(rig, App, "Display", "Sharpen images");
        var p = Preview(rig, Step(look, "On"));
        if (!Is(p, "ready") || Json.Num(p["verdict"]?["tier"], 0) != 3 || p["read"]?.ToString() != "Sharpen images: Off") { yield return $"the preview answered {p.ToJsonString()} after the look {look.ToJsonString()}"; yield break; }
        if (Sharpen || applied != 0) yield return "a preview ticked the checkbox or pressed Apply";
        var a = Apply(rig, p);
        if (!Is(a, "applied")) { yield return $"it wasn't applied: {a.ToJsonString()}"; yield break; }
        if (!Sharpen) yield return "the checkbox isn't ticked";
        if (applied != 1 || appliedSharpen != 1) yield return $"the window's Apply was pressed {applied} times and took {appliedSharpen}";
        if (a["result"]?["before"]?.ToString() != "Sharpen images: Off" || a["result"]?["after"]?.ToString() != "Sharpen images: On") yield return $"apply read back {a["result"]?.ToJsonString()}";
        if (!Is(Apply(rig, p), "expired")) yield return "a nonce worked twice";
        var u = Undo(rig, a);
        if (!Is(u, "undone") || u["printed"]?.ToString() != "Sharpen images: Off") yield return $"undo answered {u.ToJsonString()}";
        if (Sharpen || appliedSharpen != 0 || applied != 2) yield return $"after undo the checkbox is {(Sharpen ? "ticked" : "clear")}, and Apply was pressed {applied} times and took {appliedSharpen}";
        if (!Is(Undo(rig, a), "unknown")) yield return "a change could be undone twice";

        var q = LookAt(rig, App, "Display", "Quality");
        var b = Apply(rig, Preview(rig, Step(q, "High")));
        if (!Is(b, "applied") || Quality != 2 || appliedQuality != 2) { yield return $"the drop-down wasn't set to High (it shows {Quality}, Apply took {appliedQuality}): {b.ToJsonString()} after the look {q.ToJsonString()}"; yield break; }
        // Someone else picks Medium in the app and applies it.
        Win.SendMessageW(quality, CB_SETCURSEL, 1, 0);
        Win.SendMessageW(window, Win.WM_COMMAND, ApplyId, 0);
        var drifted = Undo(rig, b);
        if (!Is(drifted, "drifted") || Quality != 1) yield return $"undo didn't stop at a value someone else set: {drifted.ToJsonString()}";
        var forced = Undo(rig, b, force: true);
        if (!Is(forced, "undone") || Quality != 0 || appliedQuality != 0) yield return $"undo with force left the drop-down at {Quality} (Apply took {appliedQuality}): {forced.ToJsonString()}";
    }

    static IEnumerable<string> Moved(Commands rig)
    {
        var look = LookAt(rig, App, "Display", "Sharpen images");
        var p = Preview(rig, Step(look, "On"));
        if (!Is(p, "ready")) { yield return $"the preview answered {p.ToJsonString()}"; yield break; }
        Win.SendMessageW(sharpen, BM_SETCHECK, 1, 0);
        var a = Apply(rig, p);
        if (!Is(a, "refused") || !Refusal(a).Contains("has moved since Rig looked")) yield return $"apply after the value moved answered {a.ToJsonString()}";
        if (!Sharpen || applied != 0) yield return "a refused apply changed the checkbox or pressed Apply";
        var again = Preview(rig, Step(look, "On"));
        if (!Is(again, "refused") || !Refusal(again).Contains("has moved since Rig looked")) yield return $"a preview after the value moved answered {again.ToJsonString()}";
    }

    static IEnumerable<string> Stopped(Commands rig)
    {
        var pressed = Task.Run(() =>
        {
            for (int i = 0; i < 100; i++)
            {
                if (Win.FindWindowW(StopBar.Class, null) is var bar && bar != IntPtr.Zero) return Win.PostMessageW(bar, Win.WM_COMMAND, StopBar.StopId, 0);
                Thread.Sleep(100);
            }
            return false;
        });
        var clock = Stopwatch.StartNew();
        var r = LookAt(rig, App, "Not there yet", "Sharpen images");
        if (!pressed.Result) yield return "the worker showed no Stop bar";
        if (r["refused"]?.ToString() != StopBar.Stopped) yield return $"the stopped look answered {r.ToJsonString()}";
        if (clock.Elapsed.TotalSeconds > 9) yield return $"Stop took {clock.Elapsed.TotalSeconds:0.0} seconds";
        if (Sharpen || applied != 0) yield return "a stopped look changed something";
    }

    static string Title(IntPtr hwnd)
    {
        var text = new StringBuilder(256);
        return GetWindowTextW(hwnd, text, text.Capacity) > 0 ? text.ToString() : "";
    }

    static string Error(JsonNode? reply) => reply?["error"]?.ToString() ?? "";
    static string Left(JsonNode? reply) => string.Join("; ", (reply?["left"] as JsonArray ?? []).Select(l => l?.ToString()));

    /// Stop is pressed on the apply's own bar before the checkbox is set (its tab is emptied so the walk waits there).
    /// Every Stop bar that shows is noted: one after Stop is a walk that shouldn't have started.
    static IEnumerable<string> StoppedApply(Commands rig)
    {
        var look = LookAt(rig, App, "Display", "Sharpen images");
        var p = Preview(rig, Step(look, "On"));
        if (!Is(p, "ready")) { yield return $"the preview answered {p.ToJsonString()}"; yield break; }
        var bars = new List<string>();
        using var over = new ManualResetEventSlim();
        var watch = Task.Run(() =>
        {
            IntPtr last = IntPtr.Zero;
            bool pressed = false;
            while (!over.IsSet)
            {
                IntPtr bar = Win.FindWindowW(StopBar.Class, null);
                if (bar != IntPtr.Zero && bar != last)
                {
                    last = bar;
                    string text = Title(bar);
                    lock (bars) bars.Add((pressed ? "after Stop: " : "") + text);
                    if (!pressed && text.StartsWith("Rig is changing", StringComparison.Ordinal))
                    {
                        hide = true;
                        pressed = Win.PostMessageW(bar, Win.WM_COMMAND, StopBar.StopId, 0);
                    }
                }
                Thread.Sleep(10);
            }
            return pressed;
        });
        JsonNode a;
        try { a = Apply(rig, p); }
        finally
        {
            over.Set();
            hide = false;
        }
        if (!watch.Result) yield return $"the apply showed no Stop bar to press (bars: {string.Join(" | ", bars)})";
        if (bars.Any(b => b.StartsWith("after Stop", StringComparison.Ordinal))) yield return $"after Stop Rig walked the window again: {string.Join(" | ", bars)}";
        if (!Is(a, "rolledBack") || !Error(a).Contains(StopBar.Stopped) || !Error(a).Contains("hadn't changed")) yield return $"the stopped apply answered {a.ToJsonString()}";
        if (Left(a).Length > 0) yield return $"a change stopped before it began was reported as maybe made: {Left(a)}";
        if (Sharpen || applied != 0) yield return "a stopped apply changed the checkbox or pressed Apply";
    }

    /// The window's Apply reads "Use these", a name not on Rig's list.
    static IEnumerable<string> UnknownCommit(Commands rig)
    {
        SetWindowTextW(apply, "Use these");
        var look = LookAt(rig, App, "Display", "Sharpen images");
        var a = Apply(rig, Preview(rig, Step(look, "On")));
        if (!Is(a, "rolledBack") || !Error(a).Contains("Use these") || !Error(a).Contains("put Sharpen images back to Off")) yield return $"apply with a commit button Rig doesn't know answered {a.ToJsonString()}";
        if (Sharpen || applied != 0) yield return $"the checkbox is {(Sharpen ? "ticked" : "clear")} and the unknown button was pressed {applied} times";
    }

    /// Apply is pressed neither over the person's own unapplied edit nor over a control the change moved by itself.
    static IEnumerable<string> NotShown(Commands rig)
    {
        Win.SendMessageW(quality, CB_SETCURSEL, 1, 0);
        Thread.Sleep(200);
        var look = LookAt(rig, App, "Display", "Sharpen images");
        var a = Apply(rig, Preview(rig, Step(look, "On")));
        if (!Is(a, "rolledBack") || !Error(a).Contains(ScreenRules.Words("waiting").TrimEnd('.'))) yield return $"apply over an edit waiting in the app answered {a.ToJsonString()}";
        if (Sharpen || applied != 0 || Quality != 1) yield return $"apply over a waiting edit left the checkbox {(Sharpen ? "ticked" : "clear")}, the drop-down at {Quality}, and pressed Apply {applied} times";

        Reset();
        linkedSeen = Sharpen;
        linked = true;
        look = LookAt(rig, App, "Display", "Sharpen images");
        var b = Apply(rig, Preview(rig, Step(look, "On")));
        if (!Is(b, "rolledBack") || !Error(b).Contains("also changed Twin") || !Error(b).Contains("put Sharpen images back to Off")) yield return $"apply that also moved another control answered {b.ToJsonString()}";
        if (Sharpen || applied != 0) yield return $"apply that also moved another control left the checkbox {(Sharpen ? "ticked" : "clear")} and pressed Apply {applied} times";
    }

    /// A list row can be the setting, so a look doesn't pick one; tabs inside a Document stand in for a web page's.
    static IEnumerable<string> LookActs(Commands rig)
    {
        var row = LookAt(rig, App, "More", "Quiet");
        if (row["refused"]?.ToString() != ScreenRules.Words("list-row")) yield return $"a look that named a list's row answered {row.ToJsonString()}";
        if (Mode != 0) yield return "a look picked a row in a list";

        var web = LookAt(rig, App, "More", "Page two", "Anything");
        if (web["refused"]?.ToString() == ScreenRules.Words("web-content") && Page == 0) yield break;
        if (StandIn() is string why) { yield return Skip + why; yield break; }
        yield return $"a look through tabs inside a Document answered {web.ToJsonString()}, and the tabs show page {Page + 1}";
    }

    /// Why the rich text box with tabs in it doesn't stand in for web content on this Windows, or null when it does.
    static string? StandIn()
    {
        var uia = (IUIAutomation)new CUIAutomation();
        if (uia.get_ControlViewCondition(out IntPtr controls) < 0 || uia.ElementFromHandle(page, out var box) < 0 || box == null) return "UI Automation wouldn't describe the text box";
        if (Uia.Int(box, Uia.ControlType) != Uia.Document) return "this Windows doesn't call a rich text box a Document";
        return Uia.ChildrenOf(box, controls).Any(c => Uia.Int(c, Uia.ControlType) == 50018) ? null : "this Windows doesn't show the tabs inside the text box as part of it";
    }

    /// A program named by its .exe is never started by a look, only used once it is open: here the self-test opens it.
    static IEnumerable<string> RealProgram(Commands rig)
    {
        string exe = Path.Combine(Environment.SystemDirectory, "charmap.exe");
        if (!File.Exists(exe)) { yield return Skip + "this Windows has no Character Map"; yield break; }
        var before = Process.GetProcessesByName("charmap").Select(p => p.Id).ToHashSet();
        JsonNode look;
        try
        {
            if (before.Count == 0)
            {
                var closed = LookAt(rig, exe, "Advanced view");
                if (closed["refused"]?.ToString().Contains(ScreenRules.Words("not-open")) != true) yield return $"a look at a program that isn't open answered {closed.ToJsonString()}";
                if (Process.GetProcessesByName("charmap").Length > 0) yield return "a look started Character Map";
            }
            using (var started = Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false })!)
            {
                for (int i = 0; i < 100 && started.MainWindowHandle == IntPtr.Zero; i++)
                {
                    Thread.Sleep(100);
                    started.Refresh();
                }
            }
            Thread.Sleep(500);
            look = LookAt(rig, exe, "Advanced view");
        }
        finally
        {
            foreach (var p in Process.GetProcessesByName("charmap").Where(p => !before.Contains(p.Id)))
                try { p.Kill(); } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
        }
        if (look["lookId"] == null || look["value"]?.ToString() is not ("On" or "Off") || Options(look) != "On,Off" || look["path"]?[0]?.ToString() != "charmap")
            yield return $"the look at Character Map's Advanced view checkbox answered {look.ToJsonString()}";
        else if (look["clean"]?.GetValue<bool>() != true) yield return $"a signed program in Windows' own folder didn't give a clean look: {look.ToJsonString()}";
    }
}
