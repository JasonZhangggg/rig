// The parts of Windows a screen step calls: UI Automation's own COM
// interfaces, declared here by hand so the helper needs no UI framework, and
// the few window calls the walk, the Stop bar and the self-test's window use.
//
// Each interface lists its methods in the order Windows has them. A method
// Rig never calls is a numbered placeholder that only keeps the order. The
// five pattern interfaces at the end are every way Rig can act on a control;
// there is no keyboard or mouse input here and nothing that takes a point on
// the screen.

using System.Runtime.InteropServices;
using System.Text;

namespace Rig.Helper;

[ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomation
{
    void _1(); void _2(); void _3();
    IUIAutomationElement ElementFromHandle(IntPtr hwnd);
    void _5(); void _6(); void _7(); void _8(); void _9(); void _10(); void _11(); void _12(); void _13(); void _14(); void _15(); void _16(); void _17(); void _18();
    IUIAutomationCondition CreateTrueCondition();
}

[ComImport, Guid("352ffba8-0973-437c-a61f-f64cafd81df9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationCondition { }

[ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationElement
{
    void _1(); void _2(); void _3();
    IUIAutomationElementArray? FindAll(int scope, IUIAutomationCondition condition);
    void _5(); void _6(); void _7();
    [return: MarshalAs(UnmanagedType.Struct)] object? GetCurrentPropertyValue(int propertyId);
    void _9(); void _10(); void _11(); void _12(); void _13();
    [return: MarshalAs(UnmanagedType.IUnknown)] object? GetCurrentPattern(int patternId);
}

[ComImport, Guid("14314595-b4bc-4055-95f2-58f2e42c9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationElementArray
{
    int Length { get; }
    IUIAutomationElement GetElement(int index);
}

[ComImport, Guid("fb377fbe-8ea6-46d5-9c73-6499642d3059"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationInvokePattern { void Invoke(); }

[ComImport, Guid("a8efa66a-0fda-421a-9194-38021f3578ea"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationSelectionItemPattern { void Select(); }

[ComImport, Guid("619be086-1f4e-4ee4-bafa-210128738730"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationExpandCollapsePattern { void Expand(); void Collapse(); }

[ComImport, Guid("94cf8058-9b8d-4ab9-8bfd-4cd0a33c8c70"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationTogglePattern { void Toggle(); }

[ComImport, Guid("59213f4f-7346-49e5-b120-80555987a148"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IUIAutomationRangeValuePattern { void SetValue(double value); }

/// UI Automation's numbers for the properties, patterns and kinds of control Rig reads.
static class Uia
{
    public static readonly Guid Automation = new("ff48dba4-60ef-4201-aa87-54103eef594e");
    public const int Children = 2;
    public const int ProcessId = 30002, NativeWindowHandle = 30020, ControlType = 30003, Name = 30005, IsEnabled = 30010, AutomationId = 30011, IsPassword = 30019,
        ValueValue = 30045, RangeValue = 30047, RangeReadOnly = 30048, RangeMinimum = 30049, RangeMaximum = 30050,
        ExpandState = 30070, IsSelected = 30079, ToggleState = 30086;
    public const int InvokePattern = 10000, RangeValuePattern = 10003, ExpandCollapsePattern = 10005, SelectionItemPattern = 10010, TogglePattern = 10015;
    public const int Button = 50000, Window = 50032, CheckBox = 50002, ComboBox = 50003, ListItem = 50007, RadioButton = 50013, Slider = 50015,
        TabItem = 50019, TreeItem = 50024, Group = 50026, Document = 50030;
}

static class Win32
{
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr Hwnd; public uint Message; public IntPtr WParam, LParam; public uint Time; public POINT Pt; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASS
    {
        public uint Style; public IntPtr WndProc; public int ClsExtra, WndExtra; public IntPtr Instance, Icon, Cursor, Background;
        public string? MenuName; public string ClassName;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct TCITEM { public uint Mask; public uint State, StateMask; public string Text; public int TextMax, Image; public IntPtr Param; }
    [StructLayout(LayoutKind.Sequential)] public struct INITCOMMONCONTROLSEX { public int Size; public uint Icc; }

    public const int GWL_EXSTYLE = -20, GW_OWNER = 4, SW_HIDE = 0, SW_SHOWNOACTIVATE = 4, SM_CXSCREEN = 0, DEFAULT_GUI_FONT = 17, COLOR_BTNFACE = 15, DWMWA_CLOAKED = 14;
    public const uint WS_POPUP = 0x80000000, WS_VISIBLE = 0x10000000, WS_CHILD = 0x40000000, WS_BORDER = 0x00800000, WS_OVERLAPPEDWINDOW = 0x00CF0000, WS_TABSTOP = 0x00010000, WS_VSCROLL = 0x00200000,
        WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000,
        BS_AUTOCHECKBOX = 0x3, CBS_DROPDOWNLIST = 0x3,
        WM_DESTROY = 0x0002, WM_CLOSE = 0x0010, WM_SETFONT = 0x0030, WM_COMMAND = 0x0111, WM_TIMER = 0x0113,
        BM_GETCHECK = 0x00F0, BM_SETCHECK = 0x00F1, BM_CLICK = 0x00F5, CB_ADDSTRING = 0x0143, CB_GETCURSEL = 0x0147, CB_SETCURSEL = 0x014E,
        TCM_INSERTITEMW = 0x133E, TCM_GETCURSEL = 0x130B, TCIF_TEXT = 0x1, ICC_TAB_CLASSES = 0x8;

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, int which);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string? cls, string? title);
    [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr obj, int index, StringBuilder info, int length, out int needed);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string? name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern ushort RegisterClass(ref WNDCLASS cls);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateWindowEx(uint exStyle, string cls, string? title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int how);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);

    /// Shows a window where it is without giving it the keyboard, on top of every other window when `onTop`. Unlike
    /// ShowWindow, this isn't overridden by how the program itself was started, which for the worker is hidden.
    public static void Show(IntPtr hwnd, bool onTop) => SetWindowPos(hwnd, onTop ? new IntPtr(-1) : IntPtr.Zero, 0, 0, 0, 0, 0x1 | 0x2 | 0x10 | 0x40 | (onTop ? 0u : 0x4));
    [DllImport("user32.dll")] public static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] public static extern void PostQuitMessage(int code);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, string lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] public static extern IntPtr SendTabItem(IntPtr hwnd, uint msg, IntPtr wParam, ref TCITEM item);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int which);
    [DllImport("user32.dll")] public static extern IntPtr SetTimer(IntPtr hwnd, IntPtr id, uint ms, IntPtr proc);
    [DllImport("user32.dll")] public static extern IntPtr GetSysColorBrush(int index);
    [DllImport("gdi32.dll")] public static extern IntPtr GetStockObject(int which);
    [DllImport("comctl32.dll")] public static extern bool InitCommonControlsEx(ref INITCOMMONCONTROLSEX init);

    public static string ClassOf(IntPtr hwnd)
    {
        var name = new StringBuilder(256);
        GetClassName(hwnd, name, name.Capacity);
        return name.ToString();
    }

    public static bool Cloaked(IntPtr hwnd) => DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0;

    /// The full path of a process's program, or null when Windows won't say.
    public static string? ImageOf(int pid)
    {
        IntPtr p = OpenProcess(0x1000, false, pid);
        if (p == IntPtr.Zero) return null;
        try
        {
            var name = new StringBuilder(1024);
            int size = name.Capacity;
            return QueryFullProcessImageName(p, 0, name, ref size) ? name.ToString() : null;
        }
        finally { CloseHandle(p); }
    }

    /// Every window on this desktop that a person could be looking at: shown, with a size, and not a tooltip or a toast.
    public static List<IntPtr> TopWindows()
    {
        var found = new List<IntPtr>();
        EnumWindows((hwnd, _) =>
        {
            long ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
            if (IsWindowVisible(hwnd) && (ex & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) == 0 && !Cloaked(hwnd) && GetWindowRect(hwnd, out RECT r) && r.Right > r.Left && r.Bottom > r.Top) found.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    /// Whether this process is on the desktop the person sees and can use it: false on Windows' services' own desktop,
    /// and while Windows shows its permission prompt or sign-in screen in place of the desktop.
    public static bool OnInputDesktop()
    {
        var name = new StringBuilder(64);
        if (!GetUserObjectInformation(GetProcessWindowStation(), 2, name, name.Capacity * 2, out _) || !name.ToString().Equals("WinSta0", StringComparison.OrdinalIgnoreCase)) return false;
        IntPtr desktop = OpenInputDesktop(0, false, 0x0001);
        if (desktop == IntPtr.Zero) return false;
        bool mine = GetUserObjectInformation(desktop, 2, name, name.Capacity * 2, out _) && name.ToString().Equals("Default", StringComparison.OrdinalIgnoreCase);
        CloseDesktop(desktop);
        return mine;
    }
}
