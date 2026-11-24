// One walk through an app's window, in the worker, as the person.
//
// Everything goes through Windows UI Automation's COM interface. Nothing here
// types, moves the mouse or presses a place on the screen. The only calls that
// act are SelectionItem.Select, ExpandCollapse.Expand and Collapse,
// Toggle.Toggle, RangeValue.SetValue and Invoke, and Invoke is only ever made
// on the app's own Apply or OK button at the end of an approved change. A
// classic Windows drop-down list, which UI Automation can't set, takes the
// approved entry inside an approved change by three messages to its own
// window, the ones its list sends when a person picks an entry. Each call goes
// through Guard, which reads the control again just before it.
//
// A control is found by what it is (name, control type, automation id), never
// by where it sits, so a list that reorders or loads late is walked the same
// way. Each hop must match exactly one control that belongs to the app's own
// process; the walk waits a few seconds for one to appear, then stops and says
// so. It also stops when the person presses Stop on the bar this file shows,
// when another program's window opens, or when Windows asks for permission.
// After Stop nothing in the window is touched again, not even to put it back.

using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Nodes;

namespace Rig.Helper;

[ComImport, Guid("ff48dba4-60ef-4201-aa87-54103eef594e")]
class CUIAutomation { }

// Each interface lists its methods in Windows' own order (UIAutomationClient.h); the numbered ones only hold a place.

[ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomation
{
    void _3(); void _4(); void _5();
    [PreserveSig] int ElementFromHandle(IntPtr hwnd, out IUIAutomationElement? element);
    void _7(); void _8(); void _9(); void _10(); void _11(); void _12(); void _13(); void _14(); void _15(); void _16(); void _17();
    [PreserveSig] int get_ControlViewCondition(out IntPtr condition);
}

[ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationElement
{
    void _3(); void _4(); void _5();
    [PreserveSig] int FindAll(int scope, IntPtr condition, out IUIAutomationElementArray? found);
    void _7(); void _8(); void _9();
    [PreserveSig] int GetCurrentPropertyValue(int property, [MarshalAs(UnmanagedType.Struct)] out object? value);
    void _11(); void _12(); void _13(); void _14(); void _15();
    [PreserveSig] int GetCurrentPattern(int pattern, [MarshalAs(UnmanagedType.IUnknown)] out object? found);
}

[ComImport, Guid("14314595-b4bc-4055-95f2-58f2e42c9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationElementArray
{
    [PreserveSig] int get_Length(out int length);
    [PreserveSig] int GetElement(int index, out IUIAutomationElement? element);
}

[ComImport, Guid("fb377fbe-8ea6-46d5-9c73-6499642d3059"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationInvokePattern { [PreserveSig] int Invoke(); }

[ComImport, Guid("94cf8058-9b8d-4ab9-8bfd-4cd0a33c8c70"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationTogglePattern { [PreserveSig] int Toggle(); }

[ComImport, Guid("a8efa66a-0fda-421a-9194-38021f3578ea"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationSelectionItemPattern { [PreserveSig] int Select(); }

[ComImport, Guid("619be086-1f4e-4ee4-bafa-210128738730"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationExpandCollapsePattern { [PreserveSig] int Expand(); [PreserveSig] int Collapse(); }

[ComImport, Guid("59213f4f-7346-49e5-b120-80555987a148"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationRangeValuePattern { [PreserveSig] int SetValue(double value); }

/// UI Automation's numbers for properties, patterns and control types, and reads that answer a default when a control has gone.
static class Uia
{
    public const int ProcessId = 30002, ControlType = 30003, Name = 30005, IsEnabled = 30010, AutomationId = 30011, ClassName = 30012, IsPassword = 30019, NativeWindowHandle = 30020,
        ValueValue = 30045, RangeValue = 30047, RangeReadOnly = 30048, RangeMin = 30049, RangeMax = 30050, ExpandState = 30070, IsSelected = 30079, ToggleState = 30086;
    public const int Invoke = 10000, Range = 10003, ExpandCollapse = 10005, SelectionItem = 10010, Toggle = 10015;
    public const int Button = 50000, CheckBox = 50002, ComboBox = 50003, ListItem = 50007, RadioButton = 50013, Slider = 50015, TabItem = 50019, TreeItem = 50024,
        Group = 50026, DataItem = 50029, Document = 50030;
    const int Children = 2;

    static object? Value(IUIAutomationElement el, int property)
    {
        try { return el.GetCurrentPropertyValue(property, out object? v) >= 0 ? v : null; }
        catch (Exception e) when (e is not OutOfMemoryException) { return null; }
    }

    public static string Text(IUIAutomationElement el, int property) => Value(el, property) as string ?? "";
    public static int Int(IUIAutomationElement el, int property) => Value(el, property) is int i ? i : 0;
    public static bool Bool(IUIAutomationElement el, int property) => Value(el, property) is bool b && b;
    public static double Number(IUIAutomationElement el, int property) => Value(el, property) is double d ? d : double.NaN;
    public static string RuntimeId(IUIAutomationElement el) => Value(el, 30000) is int[] parts ? string.Join(".", parts) : "";

    public static T? Pattern<T>(IUIAutomationElement el, int pattern) where T : class
    {
        try { return el.GetCurrentPattern(pattern, out object? p) >= 0 ? p as T : null; }
        catch (Exception e) when (e is not OutOfMemoryException) { return null; }
    }

    public static List<IUIAutomationElement> ChildrenOf(IUIAutomationElement el, IntPtr condition)
    {
        var list = new List<IUIAutomationElement>();
        try
        {
            if (el.FindAll(Children, condition, out var found) < 0 || found == null || found.get_Length(out int n) < 0) return list;
            for (int i = 0; i < n; i++)
                if (found.GetElement(i, out var child) >= 0 && child != null) list.Add(child);
        }
        catch (Exception e) when (e is not OutOfMemoryException) { }
        return list;
    }
}

/// The few plain Win32 window calls the Stop bar, the walk and the self-test's window share.
static class Win
{
    public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    delegate bool EnumProc(IntPtr hwnd, IntPtr l);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WNDCLASSEX
    {
        public int cbSize; public uint style; public IntPtr lpfnWndProc; public int cbClsExtra, cbWndExtra; public IntPtr hInstance, hIcon, hCursor, hbrBackground;
        public string? lpszMenuName; public string lpszClassName; public IntPtr hIconSm;
    }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

    public const uint WS_POPUP = 0x80000000, WS_VISIBLE = 0x10000000, WS_CHILD = 0x40000000, WS_BORDER = 0x00800000, WS_OVERLAPPEDWINDOW = 0x00CF0000, WS_VSCROLL = 0x00200000;
    public const uint WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
    public const uint WM_DESTROY = 0x2, WM_CLOSE = 0x10, WM_SETFONT = 0x30, WM_COMMAND = 0x111, WM_TIMER = 0x113;
    const int GWL_STYLE = -16, GWL_EXSTYLE = -20, GW_OWNER = 4, DWMWA_CLOAKED = 14;
    const uint SMTO_ABORTIFHUNG = 0x2, AnswerMs = 2000;

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ushort RegisterClassExW(ref WNDCLASSEX c);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateWindowExW(uint ex, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] public static extern IntPtr DefWindowProcW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern int GetMessageW(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessageW(ref MSG msg);
    [DllImport("user32.dll")] public static extern void PostQuitMessage(int code);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr hwnd, uint msg, IntPtr w, string l);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int how);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] public static extern UIntPtr SetTimer(IntPtr hwnd, UIntPtr id, uint ms, IntPtr proc);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int which);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string? cls, string? title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string? cls, string? title);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, int which);
    [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr LoadCursorW(IntPtr instance, IntPtr name);
    [DllImport("gdi32.dll")] static extern IntPtr GetStockObject(int which);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string? name);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder name, int size);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, IntPtr w, string l, uint flags, uint ms, out IntPtr result);

    /// Window procedures stay alive for as long as their class does.
    static readonly List<WndProc> Kept = [];

    public static void Class(string name, WndProc proc)
    {
        lock (Kept) Kept.Add(proc);
        var c = new WNDCLASSEX
        {
            cbSize = Marshal.SizeOf<WNDCLASSEX>(), lpfnWndProc = Marshal.GetFunctionPointerForDelegate(proc), hInstance = GetModuleHandleW(null),
            hCursor = LoadCursorW(IntPtr.Zero, 32512), hbrBackground = 16, lpszClassName = name,
        };
        RegisterClassExW(ref c);
    }

    /// Makes a window or a control in one, in Windows' own dialog font.
    public static IntPtr Make(uint ex, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent = 0, int id = 0)
    {
        IntPtr made = CreateWindowExW(ex, cls, title, style, x, y, w, h, parent, id, GetModuleHandleW(null), IntPtr.Zero);
        if (made != IntPtr.Zero) SendMessageW(made, WM_SETFONT, GetStockObject(17), 1);
        return made;
    }

    /// Hands this thread's windows their messages until one of them asks to quit.
    public static void Loop()
    {
        while (GetMessageW(out MSG msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessageW(ref msg);
        }
    }

    /// Every top-level window a person could see right now.
    public static List<IntPtr> Tops()
    {
        var list = new List<IntPtr>();
        EnumWindows((h, _) =>
        {
            if (IsWindowVisible(h) && !(DwmGetWindowAttribute(h, DWMWA_CLOAKED, out int cloaked, 4) == 0 && cloaked != 0)) list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    /// A tooltip, a menu, a notification or an empty frame: a window that isn't an app's own or a question to answer.
    public static bool Passing(IntPtr hwnd) =>
        ((long)GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) != 0 || !GetWindowRect(hwnd, out RECT r) || r.Right <= r.Left || r.Bottom <= r.Top;

    public static bool Owned(IntPtr hwnd) => GetWindow(hwnd, GW_OWNER) != IntPtr.Zero;

    public static long Style(IntPtr hwnd) => (long)GetWindowLongPtrW(hwnd, GWL_STYLE);

    public static string ClassOf(IntPtr hwnd)
    {
        var name = new StringBuilder(64);
        return GetClassNameW(hwnd, name, name.Capacity) > 0 ? name.ToString() : "";
    }

    /// A message to another program's window that gives up when the program doesn't answer.
    public static IntPtr Send(IntPtr hwnd, uint msg, IntPtr w, IntPtr l) =>
        SendMessageTimeoutW(hwnd, msg, w, l, SMTO_ABORTIFHUNG, AnswerMs, out IntPtr r) != IntPtr.Zero ? r : throw new RigException("The app didn't answer, so Rig stopped.");
    public static IntPtr Send(IntPtr hwnd, uint msg, IntPtr w, string l) =>
        SendMessageTimeoutW(hwnd, msg, w, l, SMTO_ABORTIFHUNG, AnswerMs, out IntPtr r) != IntPtr.Zero ? r : throw new RigException("The app didn't answer, so Rig stopped.");

    public static int Pid(IntPtr hwnd)
    {
        Native.GetWindowThreadProcessId(hwnd, out uint pid);
        return (int)pid;
    }

    /// The window that holds an app's own controls, and its process. A packaged app's frame belongs to Windows
    /// (ApplicationFrameHost) and the app's part is a window inside it.
    public static (IntPtr Hwnd, int Pid) Content(IntPtr top)
    {
        int pid = Pid(top);
        if (!string.Equals(Path.GetFileName(Native.ProcessImage(pid)), "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase)) return (top, pid);
        IntPtr core = FindWindowExW(top, IntPtr.Zero, "Windows.UI.Core.CoreWindow", null);
        return core == IntPtr.Zero ? (top, pid) : (core, Pid(core));
    }
}

/// The bar that stays on top while a walk runs: what Rig is doing, and Stop.
sealed class StopBar : IDisposable
{
    public const string Class = "RigStopBar", Stopped = "You pressed Stop, so Rig stopped.";
    public const int StopId = 1;
    const int HardStopMs = 5000;

    volatile bool stopped;
    IntPtr hwnd;

    public bool Pressed => stopped;

    public StopBar(string text)
    {
        var ready = new ManualResetEventSlim();
        new Thread(() =>
        {
            const int w = 520, h = 40;
            Win.Class(Class, Proc);
            hwnd = Win.Make(Win.WS_EX_TOPMOST | Win.WS_EX_TOOLWINDOW | Win.WS_EX_NOACTIVATE, Class, "Rig", Win.WS_POPUP | Win.WS_BORDER | Win.WS_VISIBLE, Math.Max(0, (Win.GetSystemMetrics(0) - w) / 2), 8, w, h);
            Win.Make(0, "STATIC", text, Win.WS_CHILD | Win.WS_VISIBLE | 0x4000 | 0x200, 10, 4, w - 104, h - 10, hwnd);
            Win.Make(0, "BUTTON", "Stop", Win.WS_CHILD | Win.WS_VISIBLE, w - 86, 6, 74, h - 14, hwnd, StopId);
            Win.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x1 | 0x2 | 0x10 | 0x40);
            ready.Set();
            Win.Loop();
        }) { IsBackground = true }.Start();
        ready.Wait(5000);
        if (hwnd == IntPtr.Zero) throw new RigException("Rig couldn't show its Stop bar on your desktop, so it didn't touch the app.");
    }

    IntPtr Proc(IntPtr h, uint msg, IntPtr w, IntPtr l)
    {
        if (msg == Win.WM_COMMAND && ((long)w & 0xffff) == StopId) { Stop(); return 0; }
        if (msg == Win.WM_DESTROY) Win.PostQuitMessage(0);
        return Win.DefWindowProcW(h, msg, w, l);
    }

    void Stop()
    {
        if (stopped) return;
        stopped = true;
        // A walk checks before every call. One stuck inside a call to an app that doesn't answer is ended from here.
        new Thread(() =>
        {
            Thread.Sleep(HardStopMs);
            NativeWorker.Say(new JsonObject { ["ok"] = false, ["error"] = Stopped });
            Environment.Exit(1);
        }) { IsBackground = true }.Start();
    }

    public void Check()
    {
        if (stopped) throw new RigException(Stopped);
    }

    public void Dispose()
    {
        if (hwnd != IntPtr.Zero) Win.PostMessageW(hwnd, Win.WM_CLOSE, 0, 0);
    }
}

sealed class ScreenWalk : IDisposable
{
    const int MaxNodes = 5000, MaxDepth = 48, OpenMs = 30_000, FirstHopMs = 12_000, HopMs = 6_000, SettleMs = 3_000;
    static readonly int[] WayTypes = [Uia.TabItem, Uia.TreeItem, Uia.ListItem, Uia.DataItem, Uia.Group];
    static readonly int[] TargetTypes = [Uia.CheckBox, Uia.ComboBox, Uia.Slider, Uia.Button, Uia.Group, Uia.ListItem, Uia.TreeItem, Uia.DataItem];
    static readonly int[] CleanTypes = [Uia.Button, Uia.CheckBox, Uia.ComboBox, Uia.ListItem, Uia.RadioButton, Uia.Slider, Uia.TabItem, Uia.TreeItem];

    /// One control in a snapshot of the window, with the one it sits in.
    sealed class Node(IUIAutomationElement el, Node? parent, int depth = 0)
    {
        public int Depth => depth;
        public IUIAutomationElement El => el;
        public int Type { get; } = Uia.Int(el, Uia.ControlType);
        public string Name { get; } = Uia.Text(el, Uia.Name);
        string? says, id, cls;
        public string Says => says ??= ScreenRules.Plain(Name);
        public string Id => id ??= Uia.Text(el, Uia.AutomationId);
        public string Cls => cls ??= Uia.Text(el, Uia.ClassName);
        public bool Enabled => Uia.Bool(el, Uia.IsEnabled);
        public Hop Hop() => new(Name, Says, Type, Id, Cls);

        public bool Under(Node other)
        {
            for (var n = parent; n != null; n = n.Up) if (ReferenceEquals(n, other)) return true;
            return false;
        }
        Node? Up => parent;

        public bool InDocument()
        {
            for (var n = this; n != null; n = n.Up) if (n.Type == Uia.Document) return true;
            return false;
        }

        public bool InComboBox()
        {
            for (var n = parent; n != null; n = n.Up) if (n.Type == Uia.ComboBox) return true;
            return false;
        }
    }

    /// Where a walk ended: the control the last name stands for, what kind it is, its choices when it has them, and
    /// whether the walk opened a drop-down to see them.
    sealed record Spot(Node Named, Node Control, string Kind, List<Node> Items, bool Opened);

    readonly ScreenApp app;
    readonly StopBar bar;
    readonly IUIAutomation uia;
    readonly IntPtr controls;
    IntPtr hwnd;
    int pid;
    string image = "";
    HashSet<IntPtr> before = [];
    bool first;

    public ScreenWalk(ScreenApp app, bool changing, string setting)
    {
        this.app = app;
        bar = new StopBar($"Rig is {(changing ? "changing" : "reading")} {setting} in {app.Name}.");
        try
        {
            uia = (IUIAutomation)new CUIAutomation();
            if (uia.get_ControlViewCondition(out controls) < 0) throw new COMException();
        }
        catch (Exception e) when (e is COMException or InvalidCastException)
        {
            bar.Dispose();
            throw new RigException("Windows' UI Automation didn't start, so Rig can't read app windows on this PC.");
        }
    }

    public void Dispose() => bar.Dispose();

    // ----- The app's window -----

    /// The worker drives only windows at its own level or below. A window Windows won't describe counts as higher.
    public static bool TooHigh(int window, int mine) => window == 0 || window > mine;

    List<(IntPtr Hwnd, int Pid, string Image)> Windows()
    {
        var found = new List<(IntPtr, int, string)>();
        foreach (IntPtr top in Win.Tops())
        {
            if (Win.Owned(top) || Win.Passing(top) || Win.IsIconic(top)) continue;
            var (content, owner) = Win.Content(top);
            if (owner != Environment.ProcessId && Native.ProcessImage(owner) is string path && ScreenRules.Is(app, path)) found.Add((content, owner, path));
        }
        return found;
    }

    /// Asks Windows' shell to open an app from Rig's list or a Settings page. A program named by its .exe is never started.
    void Start()
    {
        if (app.Start.Length == 0) throw new RigException($"{app.Name} isn't open. {ScreenRules.Words("not-open")}");
        string explorer = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe");
        try { using var p = Process.Start(new ProcessStartInfo(explorer, app.Start) { UseShellExecute = false }); }
        catch (Exception e) when (e is Win32Exception or InvalidOperationException or FileNotFoundException) { throw new RigException($"Windows couldn't open {app.Name}."); }
    }

    /// Finds the app's one window, starting an app from Rig's list when it has none to show. Settings is always opened at its page.
    void Open()
    {
        var found = Windows();
        if (found.Count == 0 || app.Settings)
        {
            Start();
            var clock = Stopwatch.StartNew();
            do
            {
                bar.Check();
                Thread.Sleep(app.Settings ? 1500 : 250);
                found = Windows();
            } while (found.Count == 0 && clock.ElapsedMilliseconds < OpenMs);
        }
        if (found.Count == 0) throw new RigException($"{app.Name} didn't open a window Rig could find.");
        if (found.Count > 1) throw new RigException($"{app.Name} has more than one window open. Close the extra ones and ask again.");
        (hwnd, pid, image) = found[0];
        using var me = WindowsIdentity.GetCurrent();
        if (TooHigh(Native.ProcessIntegrity(pid), Native.Integrity(me.Token)))
            throw new RigException($"{app.Name} is running with admin rights, and Rig doesn't drive windows that have them. Close it, open it normally and ask again.");
        before = [.. Win.Tops()];
        first = true;
    }

    /// Stops the walk when Windows asks for permission or another program's window has opened since the walk began.
    /// After the app's Apply was pressed, a new window of the app's own is a question for the person, and stops it too.
    void Unexpected(bool asking = false)
    {
        var consent = Process.GetProcessesByName("consent");
        foreach (var c in consent) c.Dispose();
        if (consent.Length > 0) throw new RigException("Windows is asking for permission, and Rig doesn't answer that for you, so it stopped.");
        foreach (IntPtr top in Win.Tops())
        {
            if (before.Contains(top) || Win.Passing(top)) continue;
            int owner = Win.Content(top).Pid;
            if (owner == Environment.ProcessId) continue;
            if (owner == pid)
            {
                if (asking) throw new RigException($"{app.Name} opened another window, which may be a question for you. Rig doesn't answer those, so it stopped.");
                continue;
            }
            throw new RigException($"Another program's window opened while Rig was working in {app.Name} ({ScreenRules.Plain(Path.GetFileName(Native.ProcessImage(owner)) ?? "Rig can't tell which")}), so Rig stopped.");
        }
    }

    // ----- Finding controls -----

    List<Node> Snapshot()
    {
        bar.Check();
        if (uia.ElementFromHandle(hwnd, out var top) < 0 || top == null) throw new RigException($"{app.Name}'s window has gone.");
        var all = new List<Node> { new(top, null, 0) };
        // Some controls answer as their own descendants. A control is read once, by the id Windows gives it.
        var seen = new HashSet<string> { Uia.RuntimeId(top) };
        int frame = Uia.Int(top, Uia.ProcessId);
        for (int i = 0; i < all.Count; i++)
        {
            if (i % 50 == 0) bar.Check();
            if (all[i].Depth >= MaxDepth) continue;
            foreach (var child in Uia.ChildrenOf(all[i].El, controls))
            {
                // A drop-down's list is a window of its own, and Windows can hand back the desktop's controls beside it.
                if (Uia.Int(child, Uia.ProcessId) is var owner && owner != pid && owner != frame) continue;
                if (Uia.RuntimeId(child) is { Length: > 0 } rid && !seen.Add(rid)) continue;
                if (all.Count >= MaxNodes)
                {
                    var most = all.GroupBy(n => $"{n.Cls} {n.Says}".Trim()).OrderByDescending(g => g.Count()).First();
                    throw new RigException($"{app.Name}'s window holds more than Rig reads in one go, so it can't be sure which control is which (mostly {ScreenRules.Plain(most.Key)}, {most.Count()} times).");
                }
                all.Add(new Node(child, all[i], all[i].Depth + 1));
            }
        }
        return all;
    }

    /// The controls a hop could be. A look's hop is one of the goal's words and matches by plain name among the kinds a
    /// walk may pass or set. A replay's hop is what the look kept, and matches by the control's own name, type and id.
    static List<Node> Matches(List<Node> all, Hop hop, bool target)
    {
        if (hop.Type == 0) return all.Where(n => (target ? TargetTypes : WayTypes).Contains(n.Type) && n.Says.Equals(hop.Says, StringComparison.OrdinalIgnoreCase)).ToList();
        var same = all.Where(n => n.Type == hop.Type && n.Name == hop.Name && (hop.Id.Length == 0 || n.Id == hop.Id)).ToList();
        // An app update can reword a tab or a row. One with the same id, type and class is still the same stop on the
        // way. The control to set keeps its name or isn't the one the person approved.
        if (same.Count == 0 && hop.Id.Length > 0 && !target) same = all.Where(n => n.Type == hop.Type && n.Id == hop.Id && n.Cls == hop.Cls).ToList();
        return same;
    }

    /// Waits for the hop to match exactly one control of the app's own. Several are narrowed to those inside the hop
    /// before it. Null when the wait ran out, with how many matched and what the window held.
    Node? Find(Hop hop, Hop? previous, bool target, out List<Node> all, out int count)
    {
        var clock = Stopwatch.StartNew();
        int wait = first ? FirstHopMs : HopMs;
        first = false;
        while (true)
        {
            all = Snapshot();
            var found = Matches(all, hop, target);
            count = found.Count;
            if (found.Count > 1 && previous != null && Matches(all, previous, target: false) is [var parent]) found = found.Where(n => n.Under(parent)).ToList();
            if (found is [var one])
            {
                if (Uia.Int(one.El, Uia.ProcessId) != pid) throw new RigException($"{hop.Says} belongs to another program than {app.Name}, so Rig stopped.");
                return one;
            }
            if (clock.ElapsedMilliseconds > wait) return null;
            Thread.Sleep(250);
        }
    }

    RigException Lost(Hop hop, int count) => new(count == 0
        ? $"Rig couldn't find {hop.Says} in {app.Name} any more, so it stopped."
        : $"{app.Name} now shows {count} controls named {hop.Says}, so Rig can't tell which one it looked at. It stopped.");

    // ----- The closed set of calls that act -----

    /// Before every call that acts: the person hasn't pressed Stop, the control is still the app's own with the name and
    /// kind it was found by, it is switched on, isn't a password box or named like something Rig never presses, and
    /// nothing else has opened.
    void Guard(Node node)
    {
        bar.Check();
        if (Uia.Int(node.El, Uia.ProcessId) != pid) throw new RigException($"{node.Says} belongs to another program than {app.Name}, so Rig stopped.");
        if (Uia.Int(node.El, Uia.ControlType) != node.Type || Uia.Text(node.El, Uia.Name) != node.Name) throw new RigException($"{app.Name}'s window changed while Rig was working, so it stopped.");
        if (Uia.Bool(node.El, Uia.IsPassword)) throw new RigException("Rig never touches a password box.");
        if (ScreenRules.NeverName(node.Says)) throw new RigException(ScreenRules.Words("never-name"));
        if (!Uia.Bool(node.El, Uia.IsEnabled)) throw new RigException($"{node.Says} is greyed out in {app.Name}.");
        Unexpected();
    }

    void Did(int hr, Node node)
    {
        if (hr < 0) throw new RigException($"{app.Name} didn't take that ({node.Says}, Windows error 0x{hr:x8}).");
    }

    /// Opens a stop on the way: selects a tab, a list row or a tree row, and expands a row or a group that is folded.
    void Enter(Node node)
    {
        if (!node.Enabled) throw new RigException($"{node.Says} is greyed out in {app.Name}.");
        if (node.InComboBox()) throw new RigException(ScreenRules.Words("combo-row"));
        if (node.Type is Uia.TabItem or Uia.TreeItem or Uia.ListItem or Uia.DataItem && !app.Settings
            && Uia.Pattern<IUIAutomationSelectionItemPattern>(node.El, Uia.SelectionItem) is { } item && !Uia.Bool(node.El, Uia.IsSelected))
        {
            Guard(node);
            Did(item.Select(), node);
        }
        if (node.Type is Uia.TreeItem or Uia.ListItem or Uia.DataItem or Uia.Group
            && Uia.Pattern<IUIAutomationExpandCollapsePattern>(node.El, Uia.ExpandCollapse) is { } fold && Uia.Int(node.El, Uia.ExpandState) == 0)
        {
            Guard(node);
            Did(fold.Expand(), node);
        }
    }

    static string? KindOf(Node n) =>
        n.Type is Uia.CheckBox or Uia.Button && Uia.Pattern<IUIAutomationTogglePattern>(n.El, Uia.Toggle) != null ? "toggle"
        : n.Type == Uia.ComboBox ? "choice"
        : n.Type == Uia.Slider && Uia.Pattern<IUIAutomationRangeValuePattern>(n.El, Uia.Range) != null && !Uia.Bool(n.El, Uia.RangeReadOnly) ? "range"
        : null;

    /// The control the walk's last name stands for: a control Rig can set, the only such control in the row or group
    /// with that name, or that group's radio buttons. A row is selected first, since some apps show its control only then.
    Spot? Target(Hop hop, Hop? previous, out List<Node> all, out int count)
    {
        if (Find(hop, previous, target: true, out all, out count) is not Node named) return null;
        if (KindOf(named) == null && named.Type is Uia.ListItem or Uia.TreeItem or Uia.DataItem)
        {
            Enter(named);
            Thread.Sleep(300);
            if (Find(named.Hop(), previous, target: true, out all, out count) is not Node again) return null;
            named = again;
        }
        Node control = named;
        string? kind = KindOf(named);
        if (kind == null)
        {
            var inside = all.Where(n => n.Under(named)).ToList();
            var settable = inside.Where(n => KindOf(n) != null).ToList();
            int radios = inside.Count(n => n.Type == Uia.RadioButton);
            if (settable.Count == 1 && radios == 0) (control, kind) = (settable[0], KindOf(settable[0]));
            else if (settable.Count == 0 && radios >= 2) kind = "choice";
            else throw new RigException($"Rig found {named.Says} in {app.Name}, but not one control there that it can set.");
        }
        if (!control.Enabled) throw new RigException($"{named.Says} is greyed out in {app.Name}.");
        var items = kind == "choice" ? ItemsOf(control, all) : [];
        bool opened = false;
        if (kind == "choice" && items.Count == 0 && Uia.Pattern<IUIAutomationExpandCollapsePattern>(control.El, Uia.ExpandCollapse) is { } fold)
        {
            // A drop-down that makes its rows only when open. It is closed again when the walk ends.
            Guard(control);
            Did(fold.Expand(), control);
            opened = true;
            var clock = Stopwatch.StartNew();
            while (items.Count == 0 && clock.ElapsedMilliseconds < SettleMs)
            {
                Thread.Sleep(200);
                all = Snapshot();
                items = ItemsOf(control, all, byElement: true);
            }
        }
        return new Spot(named, control, kind!, items, opened);
    }

    /// A choice's rows: a drop-down's list items, or a group's radio buttons. After a new snapshot the control is a new
    /// node, so `byElement` finds its rows under the node that reads the same.
    static List<Node> ItemsOf(Node control, List<Node> all, bool byElement = false)
    {
        Node? holder = !byElement ? control : all.Where(n => n.Type == control.Type && n.Name == control.Name && n.Id == control.Id).ToList() is [var same] ? same : null;
        int rows = control.Type == Uia.ComboBox ? Uia.ListItem : Uia.RadioButton;
        return holder == null ? [] : all.Where(n => n.Type == rows && n.Under(holder)).ToList();
    }

    /// Closes a drop-down the walk opened, when Guard allows it. It runs as a walk ends, so a refusal leaves it open.
    void Close(Spot spot)
    {
        if (!spot.Opened || Uia.Pattern<IUIAutomationExpandCollapsePattern>(spot.Control.El, Uia.ExpandCollapse) is not { } fold || Uia.Int(spot.Control.El, Uia.ExpandState) == 0) return;
        try { Guard(spot.Control); }
        catch (RigException) { return; }
        fold.Collapse();
    }

    // ----- Reading -----

    /// The control's value right now, in the app's own words for a choice. Empty when a choice shows none.
    static string Now(Spot spot)
    {
        var c = spot.Control;
        switch (spot.Kind)
        {
            case "toggle": return Uia.Int(c.El, Uia.ToggleState) switch { 0 => "Off", 1 => "On", _ => "Mixed" };
            case "range": return double.IsNaN(Uia.Number(c.El, Uia.RangeValue)) ? "" : ScreenLook.Number(Uia.Number(c.El, Uia.RangeValue));
            default:
                string text = Uia.Text(c.El, Uia.ValueValue);
                if (spot.Items.Count(i => i.Name == text) == 1) return text;
                return spot.Items.Where(i => Uia.Bool(i.El, Uia.IsSelected)).ToList() is [var chosen] ? chosen.Name : "";
        }
    }

    /// Reads until two readings a moment apart agree, since an app may fill a control in after showing it.
    string Settled(Spot spot)
    {
        var clock = Stopwatch.StartNew();
        string value = Now(spot);
        while (true)
        {
            bar.Check();
            Thread.Sleep(200);
            string again = Now(spot);
            if (again == value && value.Length > 0) return value;
            if (clock.ElapsedMilliseconds > SettleMs) throw new RigException($"Rig couldn't read {spot.Named.Says} in {app.Name}.");
            value = again;
        }
    }

    /// screen.look in the worker: walks the goal's names, reads the last, and answers what a replay needs.
    public JsonObject Look(string asked, List<string> goal)
    {
        Open();
        string? signer = Signature.Signer(image);
        bool trusted = ScreenRules.Trusted(app, image, signer), document = false;
        JsonObject Missing(string word, int count, List<Node> all) => new()
        {
            ["refused"] = count == 0 ? $"Rig didn't find {word} in {app.Name}." : $"{app.Name} shows {count} controls named {word}, so Rig can't tell which one you mean.",
            ["shows"] = new JsonArray(all.Where(n => CleanTypes.Contains(n.Type) && n.Says.Length > 0 && !n.InDocument()).Select(n => n.Says).Distinct().Take(40).Select(s => (JsonNode)s).ToArray()),
            ["clean"] = trusted,
        };

        var hops = new List<Hop>();
        Hop? previous = null;
        foreach (string word in goal.SkipLast(1))
        {
            if (Find(new Hop("", word, 0, "", ""), previous, target: false, out var seen, out int many) is not Node node) return Missing(word, many, seen);
            Enter(node);
            document |= node.InDocument();
            hops.Add(previous = node.Hop());
        }
        if (Target(new Hop("", goal[^1], 0, "", ""), previous, out var all, out int count) is not Spot spot) return Missing(goal[^1], count, all);
        try
        {
            string value = Settled(spot);
            var options = spot.Kind switch
            {
                "toggle" => new List<(string Name, string Says)> { ("On", "On"), ("Off", "Off") },
                "choice" => spot.Items.Select(i => (i.Name, i.Says)).ToList(),
                _ => [],
            };
            if (options.Count > ScreenStep.MaxOptions || options.Any(o => o.Says.Length == 0) || options.Select(o => o.Says).Distinct().Count() != options.Count)
                throw new RigException($"{spot.Named.Says} in {app.Name} has choices Rig can't tell apart in plain words.");
            string says = spot.Kind == "choice" ? options.First(o => o.Name == value).Says : value;
            double min = spot.Kind == "range" ? Uia.Number(spot.Control.El, Uia.RangeMin) : 0, max = spot.Kind == "range" ? Uia.Number(spot.Control.El, Uia.RangeMax) : 0;
            if (double.IsNaN(min) || double.IsNaN(max)) throw new RigException($"Rig couldn't read how far {spot.Named.Says} goes in {app.Name}.");
            bool clean = trusted && !document && !spot.Named.InDocument() && !spot.Control.InDocument();
            return new JsonObject { ["look"] = new ScreenLook(asked, app.Name, image, signer ?? "", hops, spot.Named.Hop(), spot.Kind, says, options, min, max, clean).ToJson() };
        }
        finally { Close(spot); }
    }

    // ----- Replaying -----

    /// Walks the hops a look kept, in the program it looked at, to the same control.
    Spot Walk(ScreenLook look)
    {
        Open();
        string? signer = Signature.Signer(image);
        if (!ScreenRules.Trusted(app, image, signer) || (signer ?? "") != look.Signer || !string.Equals(Path.GetFileName(image), Path.GetFileName(look.Image), StringComparison.OrdinalIgnoreCase))
            throw new RigException($"{app.Name} isn't the program Rig looked at any more, so Rig stopped.");
        Hop? previous = null;
        foreach (var hop in look.Hops)
        {
            Enter(Find(hop, previous, target: false, out _, out int many) ?? throw Lost(hop, many));
            previous = hop;
        }
        var spot = Target(look.Target, previous, out _, out int count) ?? throw Lost(look.Target, count);
        if (spot.Kind == look.Kind) return spot;
        Close(spot);
        throw new RigException($"{look.Target.Says} in {app.Name} isn't the kind of control it was when Rig looked, so Rig stopped.");
    }

    /// A choice's value in the plain words the look gave it, or its own when the look didn't have it.
    static string Says(ScreenLook look, string value) =>
        look.Kind == "choice" && look.Options.FirstOrDefault(o => o.Name == value).Says is { Length: > 0 } known ? known : ScreenRules.Plain(value);

    public string Read(ScreenLook look)
    {
        var spot = Walk(look);
        try { return Says(look, Settled(spot)); }
        finally { Close(spot); }
    }

    /// Sets the control to `to` and presses the app's Apply. `from` is the value it must still have; null sets it whatever
    /// it reads. A change that fails part way is put back before the walk says so. One the person stopped part way is
    /// left as it stands, and the answer says so; it is null when the walk ran to the end.
    public string? Set(ScreenLook look, string? from, string to)
    {
        var spot = Walk(look);
        try
        {
            string was = Says(look, Settled(spot));
            if (from != null && !look.Same(was, from)) throw new RigException($"{look.Target.Says} reads {was} now, not {from} as when Rig looked, so Rig changed nothing.");
            if (look.Same(was, to)) return null;
            try
            {
                Put(look, spot, to);
                Commit();
            }
            catch (RigException) when (bar.Pressed) { }
            catch (RigException e) { throw new RigException($"{e.Message} {Back(look, was)}"); }
            return bar.Pressed ? $"{StopBar.Stopped} It had started setting {look.Target.Says} to {to} and didn't read it back, so check it in {app.Name}." : null;
        }
        finally { Close(spot); }
    }

    void Put(ScreenLook look, Spot spot, string to)
    {
        var c = spot.Control;
        RigException Gone() => new($"{look.Target.Says} in {app.Name} can't be set the way it could when Rig looked.");
        switch (look.Kind)
        {
            case "toggle":
                var toggle = Uia.Pattern<IUIAutomationTogglePattern>(c.El, Uia.Toggle) ?? throw Gone();
                for (int i = 0; i < 2 && Now(spot) != to; i++)
                {
                    Guard(c);
                    Did(toggle.Toggle(), c);
                    Thread.Sleep(200);
                }
                break;
            case "range":
                var range = Uia.Pattern<IUIAutomationRangeValuePattern>(c.El, Uia.Range) ?? throw Gone();
                Guard(c);
                Did(range.SetValue(double.Parse(to, CultureInfo.InvariantCulture)), c);
                break;
            default:
                string name = look.Options.FirstOrDefault(o => o.Says == to).Name ?? "";
                if (!spot.Items.Any(i => i.Name == name)) throw new RigException($"{look.Target.Says} in {app.Name} no longer offers {to}, so Rig changed nothing.");
                if (DropList(c) is var box && box != IntPtr.Zero)
                {
                    Close(spot);
                    Choose(c, box, name, to);
                    break;
                }
                Pick(spot.Items, name);
                // A drop-down takes the row for good when it closes, and the app's Apply must see it taken.
                Close(spot);
                if (Took(look, spot, to, 1000) || spot.Opened || Uia.Pattern<IUIAutomationExpandCollapsePattern>(c.El, Uia.ExpandCollapse) is not { } fold) break;
                // Some drop-downs take a row only while they are open, and some only once they have closed again.
                Guard(c);
                Did(fold.Expand(), c);
                Thread.Sleep(300);
                Pick(ItemsOf(c, Snapshot(), byElement: true), name);
                if (Uia.Int(c.El, Uia.ExpandState) != 0)
                {
                    Guard(c);
                    Did(fold.Collapse(), c);
                }
                if (!Took(look, spot, to, 1000)) Pick(spot.Items, name);
                break;
        }
        if (!Took(look, spot, to, SettleMs)) throw new RigException($"{app.Name} didn't take {to} for {look.Target.Says}. It reads {Says(look, Now(spot))}.");
    }

    const uint CBS_DROPDOWNLIST = 0x3, CBS_OWNERDRAW = 0x30, CBS_HASSTRINGS = 0x200, CB_FINDSTRINGEXACT = 0x158, CB_SETCURSEL = 0x14e, CBN_SELCHANGE = 1;

    /// The window of a classic Windows drop-down list of the app's own, the one kind UI Automation can't set: selecting
    /// its row only moves the open list's cursor, and closing the list puts the old entry back. Zero for any other.
    IntPtr DropList(Node control)
    {
        IntPtr box = Uia.Int(control.El, Uia.NativeWindowHandle);
        if (box == IntPtr.Zero || Win.ClassOf(box) != "ComboBox" || Win.Pid(box) != pid) return IntPtr.Zero;
        long style = Win.Style(box);
        return (style & 0x3) == CBS_DROPDOWNLIST && ((style & CBS_OWNERDRAW) == 0 || (style & CBS_HASSTRINGS) != 0) ? box : IntPtr.Zero;
    }

    /// Chooses the approved entry of a classic drop-down list as its own list does when a person picks one: the entry
    /// becomes the drop-down's, and the window that holds it is told. The read-back after it decides whether it took.
    void Choose(Node control, IntPtr box, string name, string to)
    {
        Guard(control);
        int at = (int)Win.Send(box, CB_FINDSTRINGEXACT, -1, name);
        if (at < 0 || (int)Win.Send(box, CB_FINDSTRINGEXACT, at, name) != at) throw new RigException($"{control.Says} in {app.Name} doesn't hold {to} exactly once, so Rig changed nothing.");
        IntPtr parent = Win.GetParent(box);
        if (parent == IntPtr.Zero || Win.Pid(parent) != pid) throw new RigException($"{control.Says} in {app.Name} isn't where a drop-down's list tells its choice, so Rig changed nothing.");
        Win.Send(box, CB_SETCURSEL, at, 0);
        Win.Send(parent, Win.WM_COMMAND, (Win.GetDlgCtrlID(box) & 0xffff) | (int)(CBN_SELCHANGE << 16), box);
    }

    void Pick(List<Node> rows, string name)
    {
        if (rows.Where(i => i.Name == name).ToList() is not [var row] || Uia.Pattern<IUIAutomationSelectionItemPattern>(row.El, Uia.SelectionItem) is not { } select) return;
        Guard(row);
        Did(select.Select(), row);
    }

    bool Took(ScreenLook look, Spot spot, string to, int ms)
    {
        var clock = Stopwatch.StartNew();
        while (!look.Same(Says(look, Now(spot)), to))
        {
            if (clock.ElapsedMilliseconds > ms) return false;
            Thread.Sleep(150);
        }
        return true;
    }

    /// Presses the app's own Apply button, or OK in a window that also has Cancel. No other button is ever pressed.
    void Commit()
    {
        Thread.Sleep(300);
        var buttons = Snapshot().Where(n => n.Type == Uia.Button && n.Enabled).ToList();
        List<Node> Named(string[] names) => buttons.Where(b => names.Contains(b.Says, StringComparer.OrdinalIgnoreCase)).ToList();
        var apply = Named(ScreenRules.Commit.Apply);
        if (apply.Count > 1) throw new RigException($"{app.Name} shows more than one Apply button, so Rig pressed none.");
        Node? press = apply is [var one] ? one : Named(ScreenRules.Commit.Ok) is [var ok] && Named(ScreenRules.Commit.Cancel).Count > 0 ? ok : null;
        if (press == null) return;
        var invoke = Uia.Pattern<IUIAutomationInvokePattern>(press.El, Uia.Invoke) ?? throw new RigException($"Rig couldn't press {press.Says} in {app.Name}.");
        Guard(press);
        Did(invoke.Invoke(), press);
        Thread.Sleep(400);
        Unexpected(asking: true);
    }

    /// Puts a half-made change back, and says in one sentence whether that worked.
    string Back(ScreenLook look, string was)
    {
        try
        {
            var spot = Walk(look);
            try
            {
                if (!look.Same(Says(look, Settled(spot)), was))
                {
                    Put(look, spot, was);
                    Commit();
                }
            }
            finally { Close(spot); }
            return $"Rig put {look.Target.Says} back to {was}.";
        }
        catch (RigException) { return $"Rig couldn't put {look.Target.Says} back to {was}, so check it in {app.Name}."; }
    }
}
