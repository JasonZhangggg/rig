// Windows APIs the helper calls directly.

using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Rig.Helper;

static partial class Native
{
    public static bool IsAdmin()
    {
        using var id = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint processId);

    // ----- Windows in front -----
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }

    public static bool IsFullScreen(IntPtr w)
    {
        if (w == GetShellWindow() || w == GetDesktopWindow()) return false;
        if (!GetWindowRect(w, out var r)) return false;
        var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(MonitorFromWindow(w, 2), ref mi)) return false;
        var m = mi.rcMonitor;
        return r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom;
    }

    // ----- Display modes -----
    public const int ENUM_CURRENT_SETTINGS = -1;
    public const int DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_DISPLAYFREQUENCY = 0x400000;
    public const int CDS_UPDATEREGISTRY = 0x1, CDS_TEST = 0x2, DISP_CHANGE_SUCCESSFUL = 0;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields;
        public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int ChangeDisplaySettingsEx(string deviceName, ref DEVMODE devMode, IntPtr hwnd, int flags, IntPtr param);

    public static DEVMODE NewDevMode() => new() { dmSize = (short)Marshal.SizeOf<DEVMODE>(), dmDeviceName = "", dmFormName = "" };

    // ----- Display names (QueryDisplayConfig) -----
    const uint QDC_ONLY_ACTIVE_PATHS = 2;
    const uint GET_SOURCE_NAME = 1, GET_TARGET_NAME = 2, GET_ADAPTER_NAME = 4;

    [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }

    [StructLayout(LayoutKind.Sequential)]
    struct PATH_INFO
    {
        public LUID srcAdapter; public uint srcId, srcModeIdx, srcStatus;
        public LUID tgtAdapter; public uint tgtId, tgtModeIdx, tech, rotation, scaling, refNum, refDen, scanLine; public int targetAvailable; public uint tgtStatus;
        public uint flags;
    }

    [StructLayout(LayoutKind.Sequential, Size = 64)] struct MODE_INFO { public uint infoType, id; public LUID adapter; }

    [StructLayout(LayoutKind.Sequential)] struct HEADER { public uint type, size; public LUID adapter; public uint id; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SOURCE_NAME { public HEADER header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string gdiName; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct TARGET_NAME
    {
        public HEADER header; public uint flags, tech; public ushort edidMaker, edidProduct; public uint connector;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string friendlyName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string devicePath;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ADAPTER_NAME { public HEADER header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string adapterDevicePath; }

    [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint paths, [Out] PATH_INFO[] p, ref uint modes, [Out] MODE_INFO[] m, IntPtr topology);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref SOURCE_NAME info);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref TARGET_NAME info);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref ADAPTER_NAME info);

    /// One active screen: the monitor's own name, the GDI name (\\.\DISPLAY1) used to change its mode, the kind of
    /// plug Windows says it's on (DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY) and the device path of the graphics driving it.
    public record struct Screen(string name, string gdi, uint tech, string adapter);

    public static List<Screen> Screens()
    {
        var list = new List<Screen>();
        if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out uint np, out uint nm) != 0) return list;
        var paths = new PATH_INFO[np];
        var modes = new MODE_INFO[nm];
        if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref np, paths, ref nm, modes, IntPtr.Zero) != 0) return list;
        for (int i = 0; i < np; i++)
        {
            var src = new SOURCE_NAME { header = new HEADER { type = GET_SOURCE_NAME, size = (uint)Marshal.SizeOf<SOURCE_NAME>(), adapter = paths[i].srcAdapter, id = paths[i].srcId }, gdiName = "" };
            var tgt = new TARGET_NAME { header = new HEADER { type = GET_TARGET_NAME, size = (uint)Marshal.SizeOf<TARGET_NAME>(), adapter = paths[i].tgtAdapter, id = paths[i].tgtId }, friendlyName = "", devicePath = "" };
            if (DisplayConfigGetDeviceInfo(ref src) != 0) continue;
            DisplayConfigGetDeviceInfo(ref tgt);
            string name = string.IsNullOrWhiteSpace(tgt.friendlyName) ? (paths[i].tech == 0x80000000 ? "Built-in screen" : "Screen") : tgt.friendlyName;
            var ad = new ADAPTER_NAME { header = new HEADER { type = GET_ADAPTER_NAME, size = (uint)Marshal.SizeOf<ADAPTER_NAME>(), adapter = paths[i].tgtAdapter }, adapterDevicePath = "" };
            string adapter = DisplayConfigGetDeviceInfo(ref ad) == 0 ? ad.adapterDevicePath : "";
            list.Add(new Screen(name, src.gdiName, paths[i].tech, adapter));
        }
        return list;
    }

    // ----- Power plans -----
    public static readonly Guid SUB_PROCESSOR = new("54533251-82be-4824-96c1-47b60b740d00");
    public static readonly Guid PROCTHROTTLEMAX = new("bc5038f7-23e0-4960-96da-33abaf5935ec");
    const uint ACCESS_SCHEME = 16;

    [DllImport("powrprof.dll")] static extern uint PowerEnumerate(IntPtr root, IntPtr scheme, IntPtr sub, uint access, uint index, byte[]? buffer, ref uint size);
    [DllImport("powrprof.dll")] static extern uint PowerReadFriendlyName(IntPtr root, ref Guid scheme, IntPtr sub, IntPtr setting, byte[]? buffer, ref uint size);
    [DllImport("powrprof.dll")] static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr scheme);
    [DllImport("powrprof.dll")] public static extern uint PowerSetActiveScheme(IntPtr root, ref Guid scheme);
    [DllImport("powrprof.dll")] public static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
    [DllImport("powrprof.dll")] public static extern uint PowerReadDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
    [DllImport("powrprof.dll")] public static extern uint PowerWriteACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
    [DllImport("powrprof.dll")] public static extern uint PowerWriteDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr mem);

    public static Guid ActiveScheme()
    {
        if (PowerGetActiveScheme(IntPtr.Zero, out IntPtr p) != 0) throw new RigException("Couldn't read the power plan.");
        try { return Marshal.PtrToStructure<Guid>(p); } finally { LocalFree(p); }
    }

    public static List<(Guid guid, string name)> Schemes()
    {
        var list = new List<(Guid, string)>();
        for (uint i = 0; ; i++)
        {
            uint size = 16;
            var buf = new byte[16];
            if (PowerEnumerate(IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, ACCESS_SCHEME, i, buf, ref size) != 0) break;
            var g = new Guid(buf);
            uint n = 0;
            PowerReadFriendlyName(IntPtr.Zero, ref g, IntPtr.Zero, IntPtr.Zero, null, ref n);
            var nb = new byte[n];
            string name = PowerReadFriendlyName(IntPtr.Zero, ref g, IntPtr.Zero, IntPtr.Zero, nb, ref n) == 0
                ? System.Text.Encoding.Unicode.GetString(nb).TrimEnd('\0') : g.ToString();
            list.Add((g, name));
        }
        return list;
    }

    // ----- Visual effects -----
    public const uint SPI_SETANIMATION = 0x0049, SPI_SETUIEFFECTS = 0x103F, SPI_SETCLIENTAREAANIMATION = 0x1043, SPI_SETDRAGFULLWINDOWS = 0x0025;
    public const uint SPIF_UPDATEINIFILE = 1, SPIF_SENDCHANGE = 2;
    [StructLayout(LayoutKind.Sequential)] public struct ANIMATIONINFO { public uint cbSize; public int iMinAnimate; }
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfo(uint action, uint param, IntPtr pvParam, uint winIni);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfo(uint action, uint param, ref ANIMATIONINFO pvParam, uint winIni);
}
