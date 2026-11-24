// The screen step's part of --selftest. The rule checks run anywhere. The
// rest need a desktop: the self-test opens a small window of its own with two
// tabs, check boxes, a drop-down list and buttons, and has the real worker
// look at it, change it and put it back through the same pipe calls the app
// makes. The window counts every press it gets, so a check can tell what Rig
// touched and what it left alone.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Rig.Helper;

/// The self-test's window. "General" holds two check boxes both named Twin and a plain button, More. "Advanced" holds
/// the check box Fast mode, the drop-down list Quality and a button named Reset. Apply is on both.
sealed class ScreenTestWindow : IDisposable
{
    public const string Class = "RigSelftestWindow";
    const int MoreId = 12, FastId = 20, ResetId = 22, ApplyId = 30;

    static readonly Win32.WndProc Proc = WndProc;
    static volatile ScreenTestWindow? open;

    readonly Thread thread;
    readonly ManualResetEventSlim ready = new();
    IntPtr window, tab, fast, quality;
    IntPtr[] general = [], advanced = [];
    int applied, more, reset;
    volatile bool appliedFast;

    public IntPtr Window => window;
    public bool Fast => Win32.SendMessage(fast, Win32.BM_GETCHECK, IntPtr.Zero, IntPtr.Zero) == 1;
    public void SetFast(bool on) => Win32.SendMessage(fast, Win32.BM_SETCHECK, on ? 1 : 0, IntPtr.Zero);
    public int Quality => (int)Win32.SendMessage(quality, Win32.CB_GETCURSEL, IntPtr.Zero, IntPtr.Zero);
    public void SetQuality(int choice) => Win32.SendMessage(quality, Win32.CB_SETCURSEL, choice, IntPtr.Zero);
    public int Tab => (int)Win32.SendMessage(tab, Win32.TCM_GETCURSEL, IntPtr.Zero, IntPtr.Zero);
    /// How many times Apply, More and Reset were pressed, and what Fast mode read at the last Apply.
    public int Applied => applied;
    public int More => more;
    public int Reset => reset;
    public bool AppliedFast => appliedFast;

    public ScreenTestWindow()
    {
        thread = new Thread(Run) { IsBackground = true, Name = "Rig self-test window" };
        thread.Start();
        ready.Wait(10_000);
        Thread.Sleep(300);
    }

    void Run()
    {
        IntPtr instance = Win32.GetModuleHandle(null);
        var init = new Win32.INITCOMMONCONTROLSEX { Size = Marshal.SizeOf<Win32.INITCOMMONCONTROLSEX>(), Icc = Win32.ICC_TAB_CLASSES };
        Win32.InitCommonControlsEx(ref init);
        var cls = new Win32.WNDCLASS { WndProc = Marshal.GetFunctionPointerForDelegate(Proc), Instance = instance, ClassName = Class, Background = Win32.GetSysColorBrush(Win32.COLOR_BTNFACE) };
        Win32.RegisterClass(ref cls);
        window = Win32.CreateWindowEx(0, Class, "Rig self-test", Win32.WS_OVERLAPPEDWINDOW, 80, 80, 420, 260, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
        IntPtr Child(string kind, string? text, uint style, int x, int y, int w, int h, int id = 0) =>
            Win32.CreateWindowEx(0, kind, text, Win32.WS_CHILD | style, x, y, w, h, window, id, instance, IntPtr.Zero);
        tab = Child("SysTabControl32", null, Win32.WS_VISIBLE, 10, 10, 380, 28);
        foreach (var (name, i) in new[] { "General", "Advanced" }.Select((n, i) => (n, i)))
        {
            var item = new Win32.TCITEM { Mask = Win32.TCIF_TEXT, Text = name };
            Win32.SendTabItem(tab, Win32.TCM_INSERTITEMW, i, ref item);
        }
        general =
        [
            Child("BUTTON", "Twin", Win32.BS_AUTOCHECKBOX | Win32.WS_VISIBLE, 20, 50, 150, 24),
            Child("BUTTON", "Twin", Win32.BS_AUTOCHECKBOX | Win32.WS_VISIBLE, 20, 80, 150, 24),
            Child("BUTTON", "More", Win32.WS_VISIBLE, 20, 110, 90, 26, MoreId),
        ];
        fast = Child("BUTTON", "Fast mode", Win32.BS_AUTOCHECKBOX, 20, 50, 150, 24, FastId);
        IntPtr label = Child("STATIC", "Quality", 0, 20, 84, 70, 20);
        quality = Child("COMBOBOX", null, Win32.CBS_DROPDOWNLIST | Win32.WS_VSCROLL | Win32.WS_TABSTOP, 100, 80, 150, 200);
        foreach (string choice in new[] { "Low", "Medium", "High" }) Win32.SendMessage(quality, Win32.CB_ADDSTRING, IntPtr.Zero, choice);
        Win32.SendMessage(quality, Win32.CB_SETCURSEL, IntPtr.Zero, IntPtr.Zero);
        advanced = [fast, label, quality, Child("BUTTON", "Reset", 0, 20, 114, 90, 26, ResetId)];
        Child("BUTTON", "Apply", Win32.WS_VISIBLE, 290, 180, 90, 26, ApplyId);
        open = this;
        // A tab control only says which tab is chosen; showing that tab's controls is the window's own job.
        Win32.SetTimer(window, 1, 50, IntPtr.Zero);
        Win32.ShowWindow(window, 1);
        Win32.Show(window, onTop: false);
        Win32.SetForegroundWindow(window);
        ready.Set();
        while (Win32.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            Win32.TranslateMessage(ref msg);
            Win32.DispatchMessage(ref msg);
        }
    }

    static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (open is ScreenTestWindow w && w.window == hwnd)
        {
            if (msg == Win32.WM_TIMER)
            {
                bool second = w.Tab == 1;
                foreach (IntPtr c in w.general) Win32.ShowWindow(c, second ? Win32.SW_HIDE : Win32.SW_SHOWNOACTIVATE);
                foreach (IntPtr c in w.advanced) Win32.ShowWindow(c, second ? Win32.SW_SHOWNOACTIVATE : Win32.SW_HIDE);
                return IntPtr.Zero;
            }
            if (msg == Win32.WM_COMMAND && (wParam.ToInt64() >> 16) == 0)
            {
                switch (wParam.ToInt64() & 0xffff)
                {
                    case ApplyId: w.appliedFast = w.Fast; Interlocked.Increment(ref w.applied); break;
                    case MoreId: Interlocked.Increment(ref w.more); break;
                    case ResetId: Interlocked.Increment(ref w.reset); break;
                }
            }
        }
        if (msg == Win32.WM_DESTROY) { Win32.PostQuitMessage(0); return IntPtr.Zero; }
        return Win32.DefWindowProc(hwnd, msg, wParam, lParam);
    }

    /// Every named control Windows shows for the window, for a failed check's report.
    public string Controls()
    {
        try
        {
            var uia = (IUIAutomation)Activator.CreateInstance(Type.GetTypeFromCLSID(Uia.Automation)!)!;
            var all = uia.CreateTrueCondition();
            var said = new List<string>();
            var queue = new Queue<IUIAutomationElement>([uia.ElementFromHandle(window)]);
            while (queue.Count > 0 && said.Count < 60)
            {
                var found = queue.Dequeue().FindAll(Uia.Children, all);
                for (int i = 0; i < (found?.Length ?? 0); i++)
                {
                    var el = found!.GetElement(i);
                    said.Add($"{el.GetCurrentPropertyValue(Uia.ControlType)}:{el.GetCurrentPropertyValue(Uia.Name)}");
                    queue.Enqueue(el);
                }
            }
            return string.Join(", ", said);
        }
        catch (Exception e) { return $"unreadable ({e.GetType().Name}: {e.Message})"; }
    }

    public void Dispose()
    {
        open = null;
        if (window != IntPtr.Zero) Win32.PostMessage(window, Win32.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        thread.Join(3000);
    }
}

public static partial class CommandSelfTest
{
    const string NoDesktop = Skip + "this self-test isn't on a desktop anyone can see, so no window could be opened and worked";
    static bool Desktop => Process.GetCurrentProcess().SessionId != 0 && Win32.OnInputDesktop();

    static JsonNode ScreenLook(Commands rig, string app, params string[] goal) =>
        rig.Handle("screen.look", new JsonObject { ["app"] = app, ["goal"] = new JsonArray(goal.Select(g => (JsonNode)g).ToArray()) });

    static JsonObject ScreenStepOf(JsonNode? lookId, string to) => new()
    {
        ["kind"] = "native",
        ["op"] = new JsonObject { ["name"] = "screen", ["lookId"] = lookId?.ToString(), ["to"] = to, ["does"] = "Changes a setting in the self-test's window." },
    };

    static string Words(JsonNode? n) => n?["refused"]?.ToString() ?? n?["verdict"]?["refused"]?.ToString() ?? "";

    static void ResetCount(Context ctx) { try { File.Delete(Path.Combine(ctx.Store.Root, "cap.json")); } catch (IOException) { } }

    static IEnumerable<string> ScreenRulesHold()
    {
        int examples = 0;
        foreach (var v in JsonNode.Parse(CommandCheck.Resource("Rig.Rules.vectors.json"))!.AsArray().Where(v => v!["as"]?.ToString() == "screen"))
        {
            examples++;
            string? refused = ScreenRules.Refusal(v!["image"]!.ToString(), v["page"]?.ToString());
            bool want = v["expect"]?["refused"] != null;
            if (want != (refused != null) || refused is { Length: < 20 }) yield return $"{v["image"]} ({v["note"]}) gave {refused ?? "no refusal"}";
        }
        if (examples < 15) yield return $"only {examples} examples of apps were checked";

        static string? Resolved(string ask) { try { return ScreenRules.Resolve(ask).Kind; } catch (RigException e) { return $"refused: {e.Message}"; } }
        foreach (string ask in new[] { "regedit.exe", @"C:\Windows\regedit.exe", "CHROME.EXE", @"C:\Program Files\Rig\Rig.exe", "ms-settings:windowsdefender", "ms-settings:signinoptions", "ms-settings:display/../accounts", "notepad", ScreenStep.TestApp, @"\\server\share\tool.exe", @"C:\Users\Public\tool.exe" })
            if (Resolved(ask)?.StartsWith("refused: ", StringComparison.Ordinal) != true) yield return $"\"{ask}\" was taken as an app Rig may drive";
        if (Resolved("ms-settings:display") != "settings" || Resolved("NVIDIA Control Panel") != "aumid" || Resolved("MSIAfterburner.exe") != "open" || Resolved(@"C:\Program Files (x86)\MSI Afterburner\MSIAfterburner.exe") != "open" || Resolved(@"C:\Windows\System32\logoff.exe") != "open")
            yield return "an app Rig may drive was refused";

        if (ScreenRules.Clean("Low\r\nLatency\tMode") != "Low Latency Mode" || ScreenRules.Clean("caf\u00e9 \u202eevil") != "caf? ?evil" || ScreenRules.Clean(new string('x', 500)).Length != ScreenRules.MaxText || ScreenRules.Plain("two\nlines") || ScreenRules.Plain(""))
            yield return "text from an app wasn't cut to one short plain line";
        if (!ScreenRules.NeverName("Reset to defaults") || !ScreenRules.NeverName("Enter PASSWORD") || ScreenRules.NeverName("Low Latency Mode")) yield return "the names Rig never opens or sets are wrong";

        string cmd = Path.Combine(Environment.SystemDirectory, "cmd.exe"), unsigned = Path.GetTempFileName();
        try
        {
            if (Signing.Signer(cmd) is not { Length: > 0 }) yield return "Windows' own cmd.exe read as unsigned";
            if (Signing.Signer(unsigned) != null) yield return "an empty file read as signed";
        }
        finally { File.Delete(unsigned); }
    }

    static IEnumerable<string> ScreenWithoutLook(Context ctx)
    {
        var rig = ctx.Rig;
        foreach (bool test in new[] { false, true })
        {
            rig.TestOnlyNativeOps = test;
            try
            {
                var forged = ScreenStepOf(CommandStore.NewId(), "On");
                forged["op"]!["look"] = new JsonObject { ["value"] = "Off", ["kind"] = "toggle", ["options"] = new JsonArray("On", "Off"), ["hops"] = new JsonArray() };
                foreach (var step in new[] { ScreenStepOf(CommandStore.NewId(), "On"), forged, ScreenStepOf("../../pending/x", "On"), ScreenStepOf(null, "On") })
                {
                    var p = StepPreview(rig, step);
                    if (!Is(p, "refused") || Words(p).Length < 20) yield return $"a screen step with no look of the helper's own wasn't refused: {p.ToJsonString()}";
                }
                foreach (var (app, goal) in new (string, string[])[]
                {
                    ("regedit.exe", ["Computer"]), (@"C:\Windows\System32\cmd.exe", ["Properties"]), ("ms-settings:windowsdefender", ["Virus protection"]), ("taskmgr.exe", ["Processes"]),
                    ("ms-settings:display", ["one\ntwo"]), ("ms-settings:display", []), ("ms-settings:display", Enumerable.Repeat("Next", 9).ToArray()),
                })
                {
                    var l = ScreenLook(rig, app, goal);
                    if (l["lookId"] != null || Words(l).Length < 20) yield return $"a look at {app} wasn't refused: {l.ToJsonString()}";
                }
            }
            finally { rig.TestOnlyNativeOps = false; }
        }
        var outside = ScreenLook(rig, ScreenStep.TestApp, "Advanced", "Fast mode");
        if (outside["lookId"] != null) yield return "the self-test's window could be looked at outside the self-test";
    }

    static IEnumerable<string> ScreenStopAndWatch()
    {
        if (!Desktop) { yield return NoDesktop; yield break; }
        using (var bar = new StopBar("Rig is changing Fast mode in the self-test. ") { EndsProcess = false })
        {
            if (bar.Window == IntPtr.Zero || !Win32.IsWindowVisible(bar.Window)) yield return "the Stop bar didn't show";
            else if ((Win32.GetWindowLongPtr(bar.Window, Win32.GWL_EXSTYLE).ToInt64() & Win32.WS_EX_TOPMOST) == 0) yield return "the Stop bar isn't on top";
            IntPtr stop = Win32.FindWindowEx(bar.Window, IntPtr.Zero, "BUTTON", "Stop");
            if (bar.Stopped) yield return "the Stop bar started out stopped";
            if (stop == IntPtr.Zero) yield return "the Stop bar has no Stop button";
            Win32.SendMessage(bar.Window, Win32.WM_COMMAND, 1, stop);
            if (!bar.Stopped) yield return "pressing Stop didn't stop";
        }

        var known = new HashSet<IntPtr>(Win32.TopWindows());
        using var window = new ScreenTestWindow();
        if (ScreenWalk.Unexpected([.. known], [0]) is not { Length: > 0 }) yield return "a window that opened during a walk wasn't noticed";
        if (ScreenWalk.Unexpected([.. known], [Environment.ProcessId]) is string mine) yield return $"the app's own new window stopped the walk ({mine})";
    }

    static IEnumerable<string> ScreenApplied(Context ctx)
    {
        if (!Desktop) { yield return NoDesktop; yield break; }
        var rig = ctx.Rig;
        ResetCount(ctx);
        using var window = new ScreenTestWindow();
        rig.TestOnlyNativeOps = true;
        try
        {
            var look = ScreenLook(rig, ScreenStep.TestApp, "Advanced", "Fast mode");
            if (look["lookId"] == null || look["value"]?.ToString() != "Off" || look["options"]?.ToJsonString() != "[\"On\",\"Off\"]" || look["path"]?.ToJsonString() != "[\"Advanced\",\"Fast mode\"]" || look["clean"]?.GetValue<bool>() != false)
            {
                yield return $"the look didn't read the check box: {look.ToJsonString()}; the window shows {window.Controls()}";
                yield break;
            }
            if (window.Fast || window.Applied + window.More + window.Reset != 0) yield return "a look changed or pressed something";
            if (window.Tab != 1) yield return "the look didn't open the tab";

            foreach (string to in new[] { "Maybe", "on", "Off", "1" })
            {
                var no = StepPreview(rig, ScreenStepOf(look["lookId"], to));
                if (!Is(no, "refused")) yield return $"a step to \"{to}\", which the look doesn't offer, wasn't refused: {no.ToJsonString()}";
            }

            // Hops sent with the step are dropped: what is stored is the walk the helper kept.
            var sent = ScreenStepOf(look["lookId"], "On");
            sent["op"]!["look"] = new JsonObject { ["hops"] = new JsonArray(new JsonObject { ["name"] = "Reset", ["type"] = Uia.Button, ["id"] = "" }) };
            var p = StepPreview(rig, sent);
            if (!Is(p, "ready") || Json.Num(p["verdict"]?["tier"], 0) != 3 || p["verdict"]?["admin"]?.GetValue<bool>() != false || p["read"]?.ToString() != "Off")
            {
                yield return $"the preview wasn't ready at tier 3: {p.ToJsonString()}";
                yield break;
            }
            var stored = JsonNode.Parse(File.ReadAllText(Path.Combine(ctx.Store.Root, "pending", p["nonce"] + ".json")))!["step"]!["op"]!["look"]!;
            if (stored["hops"]?.ToJsonString().Contains("Reset") != false || stored["hops"]?[0]?["name"]?.ToString() != "Advanced") yield return $"the stored step took its walk from the request: {stored.ToJsonString()}";
            if (window.Fast || window.Applied != 0) yield return "a preview changed something";

            var a = StepApply(rig, p);
            if (!Is(a, "applied")) { yield return $"it wasn't applied: {a.ToJsonString()}; the window shows {window.Controls()}"; yield break; }
            if (!window.Fast) yield return "the check box wasn't ticked";
            if (window.Applied != 1 || !window.AppliedFast) yield return $"Apply was pressed {window.Applied} times, and Fast mode read {window.AppliedFast} then";
            if (a["result"]?["before"]?.ToString() != "Off" || a["result"]?["after"]?.ToString() != "On") yield return $"apply didn't report the value before and after: {a["result"]?.ToJsonString()}";
            if (window.More + window.Reset != 0) yield return "a button other than Apply was pressed";

            var u = StepUndo(rig, a);
            if (!Is(u, "undone") || u["printed"]?.ToString() != "Off" || window.Fast) yield return $"undo didn't put it back: {u.ToJsonString()}";
            if (window.Applied != 2 || window.AppliedFast) yield return "undo didn't press Apply with the old value";

            var list = ScreenLook(rig, ScreenStep.TestApp, "Advanced", "Quality");
            if (list["value"]?.ToString() != "Low" || list["options"]?.ToJsonString() != "[\"Low\",\"Medium\",\"High\"]") { yield return $"the look didn't read the drop-down list: {list.ToJsonString()}; the window shows {window.Controls()}"; yield break; }
            var chosen = StepApply(rig, StepPreview(rig, ScreenStepOf(list["lookId"], "High")));
            if (!Is(chosen, "applied") || window.Quality != 2) yield return $"the list wasn't set to High: {chosen.ToJsonString()}";
            else if (!Is(StepUndo(rig, chosen), "undone") || window.Quality != 0) yield return "undo didn't put the list back to Low";
        }
        finally { rig.TestOnlyNativeOps = false; }
    }

    static IEnumerable<string> ScreenMoved(Context ctx)
    {
        if (!Desktop) { yield return NoDesktop; yield break; }
        var rig = ctx.Rig;
        ResetCount(ctx);
        using var window = new ScreenTestWindow();
        rig.TestOnlyNativeOps = true;
        try
        {
            var look = ScreenLook(rig, ScreenStep.TestApp, "Advanced", "Quality");
            var p = StepPreview(rig, ScreenStepOf(look["lookId"], "High"));
            if (!Is(p, "ready")) { yield return $"the preview wasn't ready: {p.ToJsonString()}"; yield break; }
            // Someone picks Medium in the app between the look and the approval.
            window.SetQuality(1);
            var a = StepApply(rig, p);
            if (Is(a, "applied") || a["error"]?.ToString().Contains("when Rig looked") != true) yield return $"a step whose value moved since the look wasn't refused at apply: {a.ToJsonString()}";
            if (window.Quality != 1 || window.Applied != 0) yield return $"Rig changed a setting that had moved since the look (Quality {window.Quality}, Apply pressed {window.Applied} times)";
        }
        finally { rig.TestOnlyNativeOps = false; }
    }

    static IEnumerable<string> ScreenStops(Context ctx)
    {
        if (!Desktop) { yield return NoDesktop; yield break; }
        var rig = ctx.Rig;
        using var window = new ScreenTestWindow();
        rig.TestOnlyNativeOps = true;
        try
        {
            var twin = ScreenLook(rig, ScreenStep.TestApp, "General", "Twin");
            if (twin["lookId"] != null || !Words(twin).Contains("2 controls")) yield return $"a name two controls share wasn't refused: {twin.ToJsonString()}";
            var more = ScreenLook(rig, ScreenStep.TestApp, "More", "Twin");
            if (more["lookId"] != null || !Words(more).Contains("never presses")) yield return $"a look that would have to press a button wasn't refused: {more.ToJsonString()}";
            var reset = ScreenLook(rig, ScreenStep.TestApp, "Advanced", "Reset");
            if (reset["lookId"] != null || Words(reset).Length < 20) yield return $"a look at a Reset button wasn't refused: {reset.ToJsonString()}";
            var gone = ScreenLook(rig, ScreenStep.TestApp, "Advanced", "Turbo");
            if (gone["lookId"] != null || !Words(gone).Contains("couldn't find")) yield return $"a look for a control that isn't there wasn't refused: {gone.ToJsonString()}";
            if (window.More + window.Reset + window.Applied != 0) yield return $"a look pressed a button (More {window.More}, Reset {window.Reset}, Apply {window.Applied})";
        }
        finally { rig.TestOnlyNativeOps = false; }
    }
}
