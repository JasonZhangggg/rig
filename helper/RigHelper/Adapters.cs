// Names Windows' graphics adapters by the id the GPU Engine performance counters carry in each instance name
// ("luid_0x00000000_0x0000D1B2"), so each app's graphics use can be filed under its own chip. On a laptop with
// built-in and dedicated graphics, the counters list both chips, and only the name tells them apart.
//
// The names come from DXGI (dxgi.dll in System32), the same list the counters are built from. The vtable slots
// and the DXGI_ADAPTER_DESC1 layout are Microsoft's published ones (dxgi.h).

using System.Runtime.InteropServices;

namespace Rig.Helper;

public static unsafe class Adapters
{
    static Dictionary<string, string> known = new(StringComparer.OrdinalIgnoreCase);
    static long lookedAt;
    static readonly TimeSpan LookAgainAfter = TimeSpan.FromMinutes(1);

    /// Each id's adapter name, for the ids given. An id that isn't known yet has the list read again, at most once
    /// a minute, since a dedicated chip that wakes or a dock that's plugged in can add one. An id still not known
    /// is left out.
    public static IReadOnlyDictionary<string, string> Names(IEnumerable<string> ids)
    {
        var wanted = ids.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (wanted.Any(id => !known.ContainsKey(id)) && (lookedAt == 0 || System.Diagnostics.Stopwatch.GetElapsedTime(lookedAt) > LookAgainAfter))
        {
            lookedAt = System.Diagnostics.Stopwatch.GetTimestamp();
            var fresh = Read();
            if (fresh != null) known = fresh;
        }
        var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in wanted) if (known.TryGetValue(id, out var n)) names[id] = n;
        return names;
    }

    /// The counters' way of writing an adapter id.
    public static string Id(uint low, int high) => $"luid_0x{(uint)high:X8}_0x{low:X8}";

    [DllImport("dxgi.dll"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);

    static Guid IDXGIFactory1 = new("770aae78-f26f-4dba-a829-253c83d1b387");
    const int DXGI_ERROR_NOT_FOUND = unchecked((int)0x887A0002);
    const int Release = 2, EnumAdapters1 = 12, GetDesc1 = 10;
    // DXGI_ADAPTER_DESC1: WCHAR Description[128], four UINTs, three SIZE_Ts, LUID AdapterLuid, UINT Flags.
    const int DescSize = 312, LuidAt = 296, FlagsAt = 304;
    const uint DXGI_ADAPTER_FLAG_SOFTWARE = 2;

    /// Every hardware adapter's name by its id, or null when DXGI can't be read.
    static Dictionary<string, string>? Read()
    {
        try
        {
            if (CreateDXGIFactory1(ref IDXGIFactory1, out var factory) < 0 || factory == IntPtr.Zero) return null;
            try
            {
                var list = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                var desc = stackalloc byte[DescSize];
                for (uint i = 0; i < 16; i++)
                {
                    IntPtr adapter;
                    var enumerate = (delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, int>)Slot(factory, EnumAdapters1);
                    int hr = enumerate(factory, i, &adapter);
                    if (hr == DXGI_ERROR_NOT_FOUND || hr < 0 || adapter == IntPtr.Zero) break;
                    try
                    {
                        var describe = (delegate* unmanaged[Stdcall]<IntPtr, byte*, int>)Slot(adapter, GetDesc1);
                        if (describe(adapter, desc) < 0) continue;
                        if ((*(uint*)(desc + FlagsAt) & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) continue;
                        string name = new string((char*)desc, 0, 128).TrimEnd('\0').Trim();
                        if (name.Length > 0) list[Id(*(uint*)(desc + LuidAt), *(int*)(desc + LuidAt + 4))] = name;
                    }
                    finally { Free(adapter); }
                }
                return list;
            }
            finally { Free(factory); }
        }
        catch { return null; }
    }

    static IntPtr Slot(IntPtr com, int index) => (*(IntPtr**)com)[index];

    static void Free(IntPtr com) => ((delegate* unmanaged[Stdcall]<IntPtr, uint>)Slot(com, Release))(com);
}
