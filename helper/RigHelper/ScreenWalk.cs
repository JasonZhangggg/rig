// Walking an app's window to one control, through UI Automation.
//
// Everything the window says is written by the app, and the app can change
// between one look and the next, so the walk trusts neither:
//
//   - A hop is found by its name among the controls of the kinds a hop may
//     be. It must match exactly one control, in the app's own process. None,
//     two, or one that belongs to another process stops the walk.
//   - Every action goes through Act, which reads the control's process, name
//     and kind again right before the call, and checks that the person
//     hasn't pressed Stop and that no window of another program has opened.
//   - The only actions are the five in Act's callers: select, expand,
//     collapse, toggle, set a slider, and invoke. A walk selects and expands;
//     invoke is only ever the app's Apply button, from PressApply.
//
// Runs only in the worker, with the person's own sign-in (NativeSteps.cs).

using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Rig.Helper;

/// One control on the walk as the look kept it: its name exactly as the app wrote it, its kind and the app's own id for it.
sealed record Hop(string Name, int Type, string Id);

/// What a control reads now. `Kind`: toggle, radio, choice or range.
sealed record ScreenReading(string Kind, string Value, IReadOnlyList<string> Options, string? Min = null, string? Max = null);

/// The app a walk is in, as ScreenRules.Resolve worked it out from Rig's own rules.
/// `Kind`: aumid or exe (one of Rig's listed apps, started when it isn't open), settings (a listed page), open (a
/// program named by its .exe, used only when it is open already) or test.
sealed record ScreenApp(string Kind, string Launch, string Image, string? Page);

sealed class ScreenWalk : IDisposable
{
    const int MaxControls = 6000, FindMs = 6000, StartMs = 20_000, PollMs = 150;
    static readonly HashSet<int> HopTypes = [Uia.TabItem, Uia.TreeItem, Uia.ListItem, Uia.Group, Uia.Button];
    /// In Settings a list or tree item leads to another page, and Rig stays on the page its rules let it open.
    static readonly HashSet<int> PageHopTypes = [Uia.TabItem, Uia.Group, Uia.Button];
    static readonly HashSet<int> TargetTypes = [Uia.CheckBox, Uia.RadioButton, Uia.ComboBox, Uia.Slider, Uia.Button];
    static readonly HashSet<int> Named = [.. HopTypes, .. TargetTypes];

    sealed record Control(IUIAutomationElement El, string Name, int Type, bool InDocument);

    readonly IUIAutomation uia;
    readonly IUIAutomationCondition all;
    readonly IUIAutomationElement root;
    readonly StopBar bar;
    readonly HashSet<IntPtr> known;
    readonly HashSet<int> ours;
    readonly int pid;
    readonly HashSet<int> hopTypes;

    /// The full path of the program the window belongs to.
    public string Image { get; }
    /// Something the walk read sat inside a document, which is where web pages and other outside text show.
    public bool ReadDocument { get; private set; }

    ScreenWalk(IntPtr window, int pid, int frame, string image, string saying, bool page)
    {
        this.pid = pid;
        hopTypes = page ? PageHopTypes : HopTypes;
        Image = image;
        uia = (IUIAutomation)Activator.CreateInstance(Type.GetTypeFromCLSID(Uia.Automation)!)!;
        all = uia.CreateTrueCondition();
        root = uia.ElementFromHandle(window);
        bar = new StopBar(saying);
        ours = [pid, frame, Environment.ProcessId];
        known = [.. Win32.TopWindows()];
    }

    public void Dispose() => bar.Dispose();

    // ----- Finding the app's window -----

    /// Finds the app's one window, starting the app when it isn't open, and holds it to Rig's rules: the program is one
    /// Rig drives, and it has no more rights than this worker, which has the person's.
    public static ScreenWalk Open(ScreenApp app, string saying)
    {
        if (!Win32.OnInputDesktop()) throw new RigException("Rig can't see your desktop right now, so it can't look at an app's window.");
        var windows = Windows(app);
        // Settings is always sent to the page again, so a walk starts from the page Rig may open and nowhere else.
        if (windows.Count == 0 || app.Kind == "settings")
        {
            Start(app);
            var waited = Stopwatch.StartNew();
            do { Thread.Sleep(300); windows = Windows(app); } while (windows.Count == 0 && waited.ElapsedMilliseconds < StartMs);
            if (app.Kind == "settings") Thread.Sleep(1200);
        }
        if (windows.Count == 0) throw new RigException(app.Kind == "open" ? "That app isn't open. Open it, then ask again." : "The app didn't open a window Rig could find.");
        if (windows.Count > 1) throw new RigException("That app has more than one window open, so Rig can't tell which one to use. Close the others, then ask again.");
        var (window, pid, frame, image) = windows[0];
        if (app.Kind != "test" && ScreenRules.Refusal(image, app.Page) is string refused) throw new RigException(refused);
        using var me = WindowsIdentity.GetCurrent();
        int theirs = Native.ProcessIntegrity(pid), mine = Native.Integrity(me.Token);
        if (theirs == 0 || theirs > mine) throw new RigException("That app is running as administrator. Rig only works an app's buttons with the rights you have yourself, so it won't touch this window.");
        return new ScreenWalk(window, pid, frame, image, saying, page: app.Kind == "settings");
    }

    /// The app's windows: each with the process its content belongs to. A packaged app's window belongs to Windows' frame
    /// host, with the app's own window inside it.
    static List<(IntPtr Window, int Pid, int Frame, string Image)> Windows(ScreenApp app)
    {
        var found = new List<(IntPtr, int, int, string)>();
        foreach (IntPtr top in Win32.TopWindows())
        {
            if (Win32.GetWindow(top, Win32.GW_OWNER) != IntPtr.Zero) continue;
            Win32.GetWindowThreadProcessId(top, out int frame);
            IntPtr window = top;
            int pid = frame;
            if (Win32.ClassOf(top) == "ApplicationFrameWindow")
            {
                window = Win32.FindWindowEx(top, IntPtr.Zero, "Windows.UI.Core.CoreWindow", null);
                if (window == IntPtr.Zero) continue;
                Win32.GetWindowThreadProcessId(window, out pid);
            }
            if (Win32.ImageOf(pid) is not string image) continue;
            bool match = app.Kind == "test" ? Win32.ClassOf(top) == app.Launch && image.Equals(Environment.ProcessPath, StringComparison.OrdinalIgnoreCase)
                : app.Image.Contains('\\') ? image.Equals(app.Image, StringComparison.OrdinalIgnoreCase)
                : Path.GetFileName(image).Equals(app.Image, StringComparison.OrdinalIgnoreCase);
            if (match) found.Add((window, pid, frame, image));
        }
        return found;
    }

    static void Start(ScreenApp app)
    {
        string explorer = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
        var start = app.Kind switch
        {
            "aumid" => new ProcessStartInfo(explorer, $"shell:AppsFolder\\{app.Launch}"),
            "settings" => new ProcessStartInfo(explorer, $"ms-settings:{app.Page}"),
            "exe" => new ProcessStartInfo(app.Launch),
            _ => null,
        };
        if (start == null) return;
        start.UseShellExecute = false;
        try { Process.Start(start)?.Dispose(); }
        catch (System.ComponentModel.Win32Exception e) when (e.NativeErrorCode == 740) { throw new RigException("That app only starts as administrator, and Rig never works the buttons of a window with more rights than you have."); }
        catch (System.ComponentModel.Win32Exception) { throw new RigException("Rig couldn't start that app."); }
    }

    // ----- ScreenReading the window -----

    static T? Prop<T>(IUIAutomationElement el, int property)
    {
        try { return el.GetCurrentPropertyValue(property) is T value ? value : default; }
        catch (COMException) { return default; }
        catch (InvalidCastException) { return default; }
    }

    static bool Has(IUIAutomationElement el, int pattern)
    {
        try { return el.GetCurrentPattern(pattern) != null; }
        catch (COMException) { return false; }
    }

    /// Every control under `from` that belongs to the app's own process and is of a kind Rig names. What another process
    /// drew inside the window is left out whole, so nothing in it can be matched or acted on.
    List<Control> Scan(IUIAutomationElement? from = null)
    {
        var found = new List<Control>();
        var queue = new Queue<(IUIAutomationElement El, bool InDocument)>();
        queue.Enqueue((from ?? root, false));
        int seen = 0;
        while (queue.Count > 0)
        {
            var (parent, inDocument) = queue.Dequeue();
            IUIAutomationElementArray? children;
            try { children = parent.FindAll(Uia.Children, all); } catch (COMException) { continue; }
            int count = children?.Length ?? 0;
            for (int i = 0; i < count; i++)
            {
                if (++seen > MaxControls) throw new RigException("This window has more controls than Rig can read safely, so it stopped.");
                IUIAutomationElement el;
                try { el = children!.GetElement(i); } catch (COMException) { continue; }
                if (Prop<int>(el, Uia.ProcessId) != pid) continue;
                int type = Prop<int>(el, Uia.ControlType);
                if (Named.Contains(type)) found.Add(new Control(el, Prop<string>(el, Uia.Name) ?? "", type, inDocument));
                queue.Enqueue((el, inDocument || type == Uia.Document));
            }
        }
        return found;
    }

    /// Stops the walk when the person pressed Stop, when Windows took the desktop for a permission or sign-in prompt, or
    /// when a window of another program opened since the walk began.
    void Check()
    {
        if (bar.Stopped) throw new RigException(StopBar.Pressed);
        if (!Win32.OnInputDesktop()) throw new RigException("Windows is asking for permission or showing its sign-in screen, so Rig stopped.");
        if (Unexpected(known, ours) is string other) throw new RigException($"A window Rig didn't expect opened ({other}), so it stopped.");
    }

    /// The program behind a window that wasn't there before and isn't one of ours, or null. Ours are remembered.
    public static string? Unexpected(HashSet<IntPtr> known, HashSet<int> ours)
    {
        foreach (IntPtr w in Win32.TopWindows())
        {
            if (known.Contains(w)) continue;
            Win32.GetWindowThreadProcessId(w, out int owner);
            if (!ours.Contains(owner)) return ScreenRules.Clean(Path.GetFileName(Win32.ImageOf(owner) ?? "another program"));
            known.Add(w);
        }
        return null;
    }

    /// The one control named `name` among `types`, waiting a little for the app to draw it. With `kept`, it must also be
    /// the very control the look found: same name to the letter, same kind, same id.
    Control Find(string name, HashSet<int> types, Hop? kept = null)
    {
        if (ScreenRules.NeverName(name)) throw new RigException($"Rig doesn't open or change anything named like that in an app (\"{name}\").");
        var waited = Stopwatch.StartNew();
        List<Control> hits;
        do
        {
            Check();
            hits = Scan().Where(c => types.Contains(c.Type) && ScreenRules.Clean(c.Name) == name).ToList();
            if (hits.Count == 1) break;
            Thread.Sleep(PollMs);
        } while (waited.ElapsedMilliseconds < FindMs);
        if (hits.Count == 0) throw new RigException($"Rig couldn't find \"{name}\" in the app's window.");
        if (hits.Count > 1) throw new RigException($"{hits.Count} controls in the app's window are named \"{name}\", so Rig can't tell which one is meant and stopped.");
        var hit = hits[0];
        if (kept != null && (hit.Name != kept.Name || hit.Type != kept.Type || (Prop<string>(hit.El, Uia.AutomationId) ?? "") != kept.Id))
            throw new RigException($"\"{name}\" isn't the same control it was when Rig looked, so Rig stopped. Look again.");
        if (hit.InDocument) ReadDocument = true;
        return hit;
    }

    // ----- Acting -----

    /// The one way anything in the window is acted on. Right before the call the control must still be the app's own,
    /// still have the name and kind it was found by, be switched on, and not be a password box.
    void Act(Control c, Action<IUIAutomationElement> call)
    {
        Check();
        if (Prop<int>(c.El, Uia.ProcessId) != pid || Prop<int>(c.El, Uia.ControlType) != c.Type || (Prop<string>(c.El, Uia.Name) ?? "") != c.Name)
            throw new RigException("The app's window changed while Rig was working, so it stopped.");
        if (Prop<bool>(c.El, Uia.IsPassword)) throw new RigException("Rig never touches a password box.");
        if (!Prop<bool>(c.El, Uia.IsEnabled)) throw new RigException($"\"{ScreenRules.Clean(c.Name)}\" is greyed out in the app, so it can't be changed right now.");
        try { call(c.El); }
        catch (COMException e) { throw new RigException($"The app didn't take it (\"{ScreenRules.Clean(c.Name)}\", Windows error 0x{e.HResult:x8})."); }
        catch (InvalidCastException) { throw new RigException($"\"{ScreenRules.Clean(c.Name)}\" can't be worked that way."); }
        Thread.Sleep(PollMs);
    }

    static T Pattern<T>(IUIAutomationElement el, int pattern) where T : class => (T?)el.GetCurrentPattern(pattern) ?? throw new InvalidCastException();

    void Select(Control c) => Act(c, el => Pattern<IUIAutomationSelectionItemPattern>(el, Uia.SelectionItemPattern).Select());
    void Expand(Control c) => Act(c, el => Pattern<IUIAutomationExpandCollapsePattern>(el, Uia.ExpandCollapsePattern).Expand());
    void Collapse(Control c) => Act(c, el => Pattern<IUIAutomationExpandCollapsePattern>(el, Uia.ExpandCollapsePattern).Collapse());
    void Toggle(Control c) => Act(c, el => Pattern<IUIAutomationTogglePattern>(el, Uia.TogglePattern).Toggle());
    void SetRange(Control c, double value) => Act(c, el => Pattern<IUIAutomationRangeValuePattern>(el, Uia.RangeValuePattern).SetValue(value));
    void Invoke(Control c) => Act(c, el => Pattern<IUIAutomationInvokePattern>(el, Uia.InvokePattern).Invoke());

    bool Collapsed(Control c) => Has(c.El, Uia.ExpandCollapsePattern) && Prop<int>(c.El, Uia.ExpandState) == 0;

    /// Walks through one hop: shows what is behind a tab, a tree item, a list item or a section, and presses nothing.
    void Through(Control c)
    {
        bool selects = c.Type is Uia.TabItem or Uia.TreeItem or Uia.ListItem && Has(c.El, Uia.SelectionItemPattern);
        if (!selects && !Has(c.El, Uia.ExpandCollapsePattern))
            throw new RigException($"Rig would have to press \"{ScreenRules.Clean(c.Name)}\" to go on, and a look never presses a button.");
        if (Collapsed(c)) Expand(c);
        if (selects && !Prop<bool>(c.El, Uia.IsSelected)) Select(c);
    }

    /// Walks the names of a goal, or the hops a look kept, to the last one: the control to read or set.
    public (List<Hop> Hops, Hop Target) Walk(IReadOnlyList<string> names, IReadOnlyList<Hop>? kept = null)
    {
        var hops = new List<Hop>();
        for (int i = 0; i < names.Count; i++)
        {
            bool last = i == names.Count - 1;
            var c = Find(names[i], last ? TargetTypes : hopTypes, kept?[i]);
            if (!last) Through(c);
            hops.Add(new Hop(c.Name, c.Type, Prop<string>(c.El, Uia.AutomationId) ?? ""));
            target = c;
        }
        return (hops.GetRange(0, hops.Count - 1), hops[^1]);
    }

    Control? target;
    Control Target => target ?? throw new InvalidOperationException("No walk yet.");

    static string Number(double n) => n.ToString("0.######", CultureInfo.InvariantCulture);

    List<Control> Items(Control list) => Scan(list.El).Where(c => c.Type == Uia.ListItem).ToList();

    /// What the control at the end of the walk reads now.
    public ScreenReading Read()
    {
        var c = Target;
        switch (c.Type)
        {
            case Uia.CheckBox or Uia.Button when Has(c.El, Uia.TogglePattern):
                return new ScreenReading("toggle", Prop<int>(c.El, Uia.ToggleState) switch { 0 => "Off", 1 => "On", _ => "Mixed" }, ["On", "Off"]);
            case Uia.RadioButton when Has(c.El, Uia.SelectionItemPattern):
                return new ScreenReading("radio", Prop<bool>(c.El, Uia.IsSelected) ? "On" : "Off", ["On"]);
            case Uia.Slider when Has(c.El, Uia.RangeValuePattern):
                if (Prop<bool>(c.El, Uia.RangeReadOnly)) throw new RigException("The app shows this slider but doesn't let it be set.");
                return new ScreenReading("range", Number(Prop<double>(c.El, Uia.RangeValue)), [], Number(Prop<double>(c.El, Uia.RangeMinimum)), Number(Prop<double>(c.El, Uia.RangeMaximum)));
            case Uia.ComboBox:
                // Many lists tell Windows their choices while closed. One that doesn't is opened to read them and closed again.
                var items = Items(c);
                bool opened = items.Count == 0 && Collapsed(c);
                if (opened) Expand(c);
                for (var waited = Stopwatch.StartNew(); opened && items.Count == 0 && waited.ElapsedMilliseconds < 2000; items = Items(c)) Thread.Sleep(PollMs);
                if (items.Any(i => i.InDocument)) ReadDocument = true;
                var chosen = items.Where(i => Prop<bool>(i.El, Uia.IsSelected)).Select(i => ScreenRules.Clean(i.Name)).ToList();
                // A choice Rig can't write in plain letters isn't offered, and two that read the same can't be told apart.
                var options = items.Where(i => i.Name.Length > 0 && ScreenRules.Clean(i.Name) == i.Name).Select(i => i.Name).ToList();
                if (opened) Collapse(c);
                if (options.Count != options.Distinct().Count()) throw new RigException("Two choices in this list read the same, so Rig can't tell them apart.");
                return new ScreenReading("choice", chosen.Count == 1 ? chosen[0] : ScreenRules.Clean(Prop<string>(c.El, Uia.ValueValue)), options);
            default:
                throw new RigException("Rig only sets check boxes, switches, option buttons, drop-down lists and sliders in an app.");
        }
    }

    /// Sets the control at the end of the walk. `to` is one of the options the look read, or a number in its range.
    public void Set(ScreenReading now, string to)
    {
        var c = Target;
        switch (now.Kind)
        {
            case "toggle":
                // A box with a third state takes two presses to get from one end to the other.
                for (int i = 0; i < 2 && Read().Value != to; i++) Toggle(c);
                break;
            case "radio":
                Select(c);
                break;
            case "range":
                SetRange(c, double.Parse(to, CultureInfo.InvariantCulture));
                break;
            case "choice":
                // Closed first, as it was read. A list that only takes a choice while open is opened for it.
                foreach (bool open in new[] { false, true })
                {
                    if (open && !Collapsed(c)) break;
                    if (open) Expand(c);
                    var items = Items(c).Where(i => i.Name == to).ToList();
                    if (items.Count > 1 || (items.Count == 0 && open)) throw new RigException($"The list no longer offers \"{to}\" exactly once, so Rig stopped.");
                    if (items.Count == 1) Select(items[0]);
                    if (open) Collapse(c);
                    if (items.Count == 1 && Read().Value == to) break;
                }
                break;
        }
    }

    /// Presses the app's own Apply button when it has exactly one that is switched on. The names it may have come from
    /// Rig's rules. An app with none applies as it goes.
    public void PressApply()
    {
        foreach (string name in ScreenRules.ApplyButtons)
        {
            var waited = Stopwatch.StartNew();
            List<Control> buttons;
            do
            {
                buttons = Scan().Where(c => c.Type == Uia.Button && c.Name == name).ToList();
                if (buttons.Count != 1 || Prop<bool>(buttons[0].El, Uia.IsEnabled)) break;
                Thread.Sleep(PollMs);
            } while (waited.ElapsedMilliseconds < 1500);
            if (buttons.Count == 0) continue;
            if (buttons.Count > 1) throw new RigException($"The app has {buttons.Count} buttons named \"{name}\", so Rig can't tell which one applies the change.");
            if (!Prop<bool>(buttons[0].El, Uia.IsEnabled)) return;
            var before = AppWindows();
            Invoke(buttons[0]);
            Thread.Sleep(400);
            // A question from the app after Apply ("Keep these changes?") is the person's to answer, not Rig's.
            if (AppWindows().Except(before).Any()) throw new RigException($"The app opened a window of its own after \"{name}\", and Rig doesn't answer an app's questions for you.");
            return;
        }
    }

    List<IntPtr> AppWindows() => Win32.TopWindows().Where(w => { Win32.GetWindowThreadProcessId(w, out int owner); return owner == pid; }).ToList();

    /// The value once the app has settled on it: read until it is `want` or a moment has passed.
    public string Settled(string want)
    {
        var waited = Stopwatch.StartNew();
        string value;
        do { Thread.Sleep(PollMs); value = Read().Value; } while (value != want && waited.ElapsedMilliseconds < 2000);
        return value;
    }
}

/// The bar the worker shows, always on top, while it works an app's window: what Rig is doing and a Stop button. Pressing
/// Stop ends the walk before its next action; a worker still going three seconds later is ended outright.
sealed class StopBar : IDisposable
{
    public const string Pressed = "You pressed Stop, so Rig stopped.";
    const string Class = "RigStopBar";
    const int Width = 560, Height = 40, StopId = 1;

    static readonly Win32.WndProc Proc = WndProc;
    static volatile StopBar? shown;

    readonly Thread thread;
    readonly ManualResetEventSlim ready = new();
    IntPtr window;
    volatile bool stopped;

    public bool Stopped => stopped;
    public IntPtr Window => window;
    /// Set false by the self-test, which presses Stop on purpose and must outlive it.
    public bool EndsProcess { get; set; } = true;

    public StopBar(string saying)
    {
        thread = new Thread(() => Run(saying)) { IsBackground = true, Name = "Rig stop bar" };
        thread.Start();
        ready.Wait(5000);
    }

    void Run(string saying)
    {
        IntPtr instance = Win32.GetModuleHandle(null);
        var cls = new Win32.WNDCLASS { WndProc = Marshal.GetFunctionPointerForDelegate(Proc), Instance = instance, ClassName = Class, Background = Win32.GetSysColorBrush(Win32.COLOR_BTNFACE) };
        Win32.RegisterClass(ref cls);
        int x = Math.Max(0, (Win32.GetSystemMetrics(Win32.SM_CXSCREEN) - Width) / 2);
        window = Win32.CreateWindowEx(Win32.WS_EX_TOPMOST | Win32.WS_EX_TOOLWINDOW | Win32.WS_EX_NOACTIVATE, Class, "Rig", Win32.WS_POPUP | Win32.WS_BORDER, x, 0, Width, Height, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
        IntPtr font = Win32.GetStockObject(Win32.DEFAULT_GUI_FONT);
        IntPtr text = Win32.CreateWindowEx(0, "STATIC", saying, Win32.WS_CHILD | Win32.WS_VISIBLE, 12, 12, Width - 110, 18, window, IntPtr.Zero, instance, IntPtr.Zero);
        IntPtr stop = Win32.CreateWindowEx(0, "BUTTON", "Stop", Win32.WS_CHILD | Win32.WS_VISIBLE, Width - 90, 6, 78, 26, window, StopId, instance, IntPtr.Zero);
        Win32.SendMessage(text, Win32.WM_SETFONT, font, 1);
        Win32.SendMessage(stop, Win32.WM_SETFONT, font, 1);
        shown = this;
        Win32.Show(window, onTop: true);
        ready.Set();
        while (Win32.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            Win32.TranslateMessage(ref msg);
            Win32.DispatchMessage(ref msg);
        }
    }

    static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == Win32.WM_COMMAND && (wParam.ToInt64() & 0xffff) == StopId && shown is StopBar bar && bar.window == hwnd)
        {
            bar.stopped = true;
            if (bar.EndsProcess) new Thread(() => { Thread.Sleep(3000); Environment.Exit(3); }) { IsBackground = true }.Start();
            return IntPtr.Zero;
        }
        if (msg == Win32.WM_DESTROY) { Win32.PostQuitMessage(0); return IntPtr.Zero; }
        return Win32.DefWindowProc(hwnd, msg, wParam, lParam);
    }

    public void Dispose()
    {
        if (window != IntPtr.Zero) Win32.PostMessage(window, Win32.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        thread.Join(2000);
    }
}
