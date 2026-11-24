// Graphics drivers' own DLLs, and Rig's own bindings to the part of NVIDIA's
// NVAPI that reads and writes the driver settings database (DRS), the one
// NVIDIA Control Panel's 3D settings live in.
//
// A driver DLL is only ever loaded from System32, by its full path, with its
// own dependencies looked for in System32 alone, and only once Windows says
// its signature is good and the signer is the maker. Nothing is loaded by a
// bare name, so a DLL planted next to Rig's helper is never picked up.
//
// The ids passed to nvapi_QueryInterface and the struct layouts are NVIDIA's
// published ones (nvapi_interface.h and nvapi.h in github.com/NVIDIA/nvapi).

using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Rig.Helper;

public static class DriverDll
{
    /// A maker's driver DLL: its file name in System32, the names its signature may carry, and the maker in plain words.
    public sealed record Maker(string File, string[] Signers, string Who);

    public static readonly Maker Nvidia = new("nvapi64.dll", ["NVIDIA Corporation"], "NVIDIA");
    public static readonly Maker Amd = new("amdadlx64.dll", ["Advanced Micro Devices, Inc.", "Advanced Micro Devices Inc."], "AMD");
    public static readonly Maker Intel = new("ControlLib.dll", ["Intel Corporation", "Intel(R) pGFX"], "Intel");

    public static string PathOf(Maker m) => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), m.File);

    public static string Missing(Maker m) => $"{m.Who}'s graphics driver isn't on this PC, so there are no {m.Who} settings to read or change.";

    /// Checks a maker's DLL in System32 without loading it: throws a RigException in plain words when it isn't there or
    /// isn't the maker's. Gives back the file held open so nobody can change it while the caller loads it.
    public static FileStream Checked(Maker m)
    {
        string path = PathOf(m);
        if (!File.Exists(path)) throw new RigException(Missing(m));
        var hold = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (Problem(hold.SafeFileHandle, path, m) is string problem) { hold.Dispose(); throw new RigException(problem); }
        return hold;
    }

    /// Loads a maker's DLL from System32 once it checks. The handle stays loaded for as long as this program runs.
    public static IntPtr Load(Maker m)
    {
        using var hold = Checked(m);
        IntPtr h = LoadLibraryExW(PathOf(m), IntPtr.Zero, LOAD_LIBRARY_SEARCH_SYSTEM32);
        if (h == IntPtr.Zero) throw new RigException($"{m.Who}'s graphics driver is on this PC, but Windows wouldn't load it ({new Win32Exception(Marshal.GetLastWin32Error()).Message.TrimEnd('.')}).");
        return h;
    }

    /// Why Rig won't use the file, in plain words, or null when Windows says its signature is good and it's the maker's.
    public static string? Problem(SafeFileHandle file, string path, Maker m)
    {
        if (Verify(file, path) is int status and not 0)
            return status == TRUST_E_NOSIGNATURE
                ? $"The {m.Who} driver file on this PC ({m.File}) isn't signed, so Rig won't use it."
                : $"Windows doesn't trust the signature on the {m.Who} driver file on this PC ({m.File}), so Rig won't use it.";
        string? signer;
        try
        {
            using var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
            signer = cert.GetNameInfo(X509NameType.SimpleName, forIssuer: false);
        }
        catch (Exception) { signer = null; }
        if (signer == null) return $"The {m.Who} driver file on this PC ({m.File}) carries no signature Rig can read, so Rig won't use it.";
        return m.Signers.Contains(signer, StringComparer.Ordinal) ? null : $"The {m.Who} driver file on this PC ({m.File}) is signed by {signer}, not {m.Who}, so Rig won't use it.";
    }

    // WinVerifyTrust, Authenticode policy, no prompts and nothing fetched from the network.
    const int TRUST_E_NOSIGNATURE = unchecked((int)0x800B0100);
    const uint LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800;
    static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WINTRUST_FILE_INFO { public uint cbStruct; public string pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }

    [StructLayout(LayoutKind.Sequential)]
    struct WINTRUST_DATA
    {
        public uint cbStruct; public IntPtr pPolicyCallbackData, pSIPClientData; public uint dwUIChoice, fdwRevocationChecks, dwUnionChoice;
        public IntPtr pFile; public uint dwStateAction; public IntPtr hWVTStateData, pwszURLReference; public uint dwProvFlags, dwUIContext; public IntPtr pSignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true)] static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref WINTRUST_DATA data);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryExW(string path, IntPtr file, uint flags);

    static int Verify(SafeFileHandle file, string path)
    {
        var info = new WINTRUST_FILE_INFO { cbStruct = (uint)Marshal.SizeOf<WINTRUST_FILE_INFO>(), pcwszFilePath = path, hFile = file.DangerousGetHandle() };
        IntPtr pInfo = Marshal.AllocHGlobal(Marshal.SizeOf<WINTRUST_FILE_INFO>());
        try
        {
            Marshal.StructureToPtr(info, pInfo, false);
            var data = new WINTRUST_DATA
            {
                cbStruct = (uint)Marshal.SizeOf<WINTRUST_DATA>(), dwUIChoice = 2 /* none */, fdwRevocationChecks = 0, dwUnionChoice = 1 /* file */,
                pFile = pInfo, dwStateAction = 1 /* verify */, dwProvFlags = 0x1000 /* cache only */,
            };
            var action = GenericVerifyV2;
            int status = WinVerifyTrust(new IntPtr(-1), ref action, ref data);
            data.dwStateAction = 2; // close
            WinVerifyTrust(new IntPtr(-1), ref action, ref data);
            return status;
        }
        finally
        {
            Marshal.DestroyStructure<WINTRUST_FILE_INFO>(pInfo);
            Marshal.FreeHGlobal(pInfo);
        }
    }
}

/// NVAPI, loaded once per program. Every call that fails throws a RigException in plain words.
public sealed unsafe class NvApi
{
    static NvApi? loaded;
    static readonly object gate = new();

    readonly delegate* unmanaged<uint, IntPtr> query;

    NvApi(IntPtr dll)
    {
        query = (delegate* unmanaged<uint, IntPtr>)NativeLibrary.GetExport(dll, "nvapi_QueryInterface");
        Ok(((delegate* unmanaged<int>)Fn(0x0150E828))(), "start");
    }

    /// NVAPI started, or a RigException that says why not in plain words.
    public static NvApi Open()
    {
        lock (gate) return loaded ??= new NvApi(DriverDll.Load(DriverDll.Nvidia));
    }

    IntPtr Fn(uint id)
    {
        IntPtr f = query(id);
        if (f == IntPtr.Zero) throw new RigException("NVIDIA's driver on this PC is too old for Rig to read its settings. Update it, then ask again.");
        return f;
    }

    public const int SettingNotFound = -160, ProfileNotFound = -163, ExecutableNotFound = -166;

    public static void Ok(int status, string doing)
    {
        if (status == 0) return;
        throw new RigException(status switch
        {
            -6 => "NVIDIA's driver is on this PC, but no NVIDIA graphics card is running a screen right now.",
            -137 => "NVIDIA's driver wants admin rights for this, and Rig changes graphics settings only as you. Change it in the NVIDIA Control Panel instead.",
            -182 => "More than one game in NVIDIA's settings has that file name. Change it in the NVIDIA Control Panel instead.",
            -167 => "That game is already in another of NVIDIA's profiles. Change it in the NVIDIA Control Panel instead.",
            _ => $"NVIDIA's driver couldn't {doing} (error {status}).",
        });
    }

    /// The driver's version, like 566.36.
    public string DriverVersion()
    {
        uint v;
        byte* branch = stackalloc byte[64];
        Ok(((delegate* unmanaged<uint*, byte*, int>)Fn(0x2926AAAD))(&v, branch), "say its version");
        return $"{v / 100}.{v % 100:00}";
    }

    public Drs Session() => new(this);

    /// One session of the driver settings database, loaded fresh from the driver when it starts.
    public sealed class Drs : IDisposable
    {
        readonly NvApi api;
        IntPtr h;

        internal Drs(NvApi api)
        {
            this.api = api;
            IntPtr s;
            Ok(((delegate* unmanaged<IntPtr*, int>)api.Fn(0x0694D52E))(&s), "open its settings");
            h = s;
            Ok(((delegate* unmanaged<IntPtr, int>)api.Fn(0x375DBD6B))(h), "load its settings");
        }

        public void Dispose()
        {
            if (h == IntPtr.Zero) return;
            ((delegate* unmanaged<IntPtr, int>)api.Fn(0xDAD9CFF8))(h);
            h = IntPtr.Zero;
        }

        public void Save() => Ok(((delegate* unmanaged<IntPtr, int>)api.Fn(0xFCBC7E14))(h), "save its settings");

        /// The profile the whole PC's settings live in.
        public IntPtr Global()
        {
            IntPtr p;
            Ok(((delegate* unmanaged<IntPtr, IntPtr*, int>)api.Fn(0x617BFF9F))(h, &p), "find the global settings");
            return p;
        }

        /// The profile the driver uses for a program by its file name, or zero when it has none.
        public IntPtr App(string exe)
        {
            var app = new byte[App3.Size];
            BitConverter.TryWriteBytes(app.AsSpan(0), App3.Version);
            fixed (char* name = Wide(exe))
            fixed (byte* a = app)
            {
                IntPtr p;
                int s = ((delegate* unmanaged<IntPtr, char*, IntPtr*, byte*, int>)api.Fn(0xEEE566B2))(h, name, &p, a);
                if (s is ExecutableNotFound or ProfileNotFound) return IntPtr.Zero;
                Ok(s, "look up the game");
                return p;
            }
        }

        public IntPtr ProfileNamed(string name)
        {
            fixed (char* n = Wide(name))
            {
                IntPtr p;
                int s = ((delegate* unmanaged<IntPtr, char*, IntPtr*, int>)api.Fn(0x7E4A9A0B))(h, n, &p);
                if (s == ProfileNotFound) return IntPtr.Zero;
                Ok(s, "look up a profile");
                return p;
            }
        }

        /// A profile's name, and whether it is one of NVIDIA's own.
        public (string Name, bool Predefined) Info(IntPtr profile)
        {
            var info = new byte[Profile1.Size];
            BitConverter.TryWriteBytes(info.AsSpan(0), Profile1.Version);
            fixed (byte* i = info) Ok(((delegate* unmanaged<IntPtr, IntPtr, byte*, int>)api.Fn(0x61CD6FD6))(h, profile, i), "read a profile");
            return (Text(info, 4), BitConverter.ToUInt32(info, Profile1.IsPredefined) != 0);
        }

        public IntPtr CreateProfile(string name)
        {
            var info = new byte[Profile1.Size];
            BitConverter.TryWriteBytes(info.AsSpan(0), Profile1.Version);
            Put(info, 4, name);
            fixed (byte* i = info)
            {
                IntPtr p;
                Ok(((delegate* unmanaged<IntPtr, byte*, IntPtr*, int>)api.Fn(0xCC176068))(h, i, &p), "make a profile for the game");
                return p;
            }
        }

        public void DeleteProfile(IntPtr profile) => Ok(((delegate* unmanaged<IntPtr, IntPtr, int>)api.Fn(0x17093206))(h, profile), "remove the profile Rig made");

        public void AddApp(IntPtr profile, string exe)
        {
            var app = new byte[App3.Size];
            BitConverter.TryWriteBytes(app.AsSpan(0), App3.Version);
            Put(app, App3.AppName, exe);
            fixed (byte* a = app) Ok(((delegate* unmanaged<IntPtr, IntPtr, byte*, int>)api.Fn(0x4347A9DE))(h, profile, a), "add the game to a profile");
        }

        public void RemoveApp(IntPtr profile, string exe)
        {
            fixed (char* name = Wide(exe)) Ok(((delegate* unmanaged<IntPtr, IntPtr, char*, int>)api.Fn(0x2C694BC6))(h, profile, name), "remove the game Rig added");
        }

        /// A DWORD setting as the driver gives it for a profile: null when nothing sets it, else its value, where that value
        /// comes from and whether it is NVIDIA's predefined one.
        public Setting? Get(IntPtr profile, uint id)
        {
            var s = new byte[Setting1.Size];
            BitConverter.TryWriteBytes(s.AsSpan(0), Setting1.Version);
            fixed (byte* p = s)
            {
                int status = ((delegate* unmanaged<IntPtr, IntPtr, uint, byte*, int>)api.Fn(0x73BF8338))(h, profile, id, p);
                if (status is SettingNotFound or ProfileNotFound) return null;
                Ok(status, "read a setting");
            }
            if (BitConverter.ToUInt32(s, Setting1.Type) != 0) throw new RigException("NVIDIA's driver holds this setting as something other than a number, so Rig left it alone.");
            return new Setting(BitConverter.ToUInt32(s, Setting1.Current), (Where)BitConverter.ToUInt32(s, Setting1.Location), BitConverter.ToUInt32(s, Setting1.IsCurrentPredefined) != 0);
        }

        public void Set(IntPtr profile, uint id, uint value)
        {
            var s = new byte[Setting1.Size];
            BitConverter.TryWriteBytes(s.AsSpan(0), Setting1.Version);
            BitConverter.TryWriteBytes(s.AsSpan(Setting1.Id), id);
            BitConverter.TryWriteBytes(s.AsSpan(Setting1.Type), 0u);
            BitConverter.TryWriteBytes(s.AsSpan(Setting1.Current), value);
            fixed (byte* p = s) Ok(((delegate* unmanaged<IntPtr, IntPtr, byte*, int>)api.Fn(0x577DD202))(h, profile, p), "change a setting");
        }

        /// Back to NVIDIA's predefined value for the profile.
        public void RestoreDefault(IntPtr profile, uint id) => Ok(((delegate* unmanaged<IntPtr, IntPtr, uint, int>)api.Fn(0x53F0381E))(h, profile, id), "put a setting back to NVIDIA's own");

        /// Takes a setting the profile didn't have out of it again.
        public void Delete(IntPtr profile, uint id)
        {
            int s = ((delegate* unmanaged<IntPtr, IntPtr, uint, int>)api.Fn(0xE4A26362))(h, profile, id);
            if (s != SettingNotFound) Ok(s, "take a setting back out");
        }
    }

    /// NVDRS_SETTING_LOCATION: where a setting's value comes from.
    public enum Where : uint { Profile = 0, Global = 1, Base = 2, Default = 3 }

    public sealed record Setting(uint Value, Where From, bool Predefined)
    {
        /// Whether the profile itself holds it: an app's own profile, or for the global settings anything but the driver's default.
        public bool In(bool global) => global ? From != Where.Default : From == Where.Profile;
    }

    // NVDRS_SETTING_V1: version, settingName[2048] (UTF-16), settingId, settingType, settingLocation, isCurrentPredefined,
    // isPredefinedValid, then two 4100-byte unions (predefined, current), packed to 4.
    static class Setting1
    {
        public const int Id = 4100, Type = 4104, Location = 4108, IsCurrentPredefined = 4112, Current = 8220, Size = 12320;
        public const uint Version = Size | (1u << 16);
    }

    // NVDRS_PROFILE_V1: version, profileName[2048], gpuSupport, isPredefined, numOfApps, numOfSettings.
    static class Profile1
    {
        public const int IsPredefined = 4104, Size = 4116;
        public const uint Version = Size | (1u << 16);
    }

    // NVDRS_APPLICATION_V3: version, isPredefined, appName, userFriendlyName, launcher, fileInFolder (each [2048]), flags.
    static class App3
    {
        public const int AppName = 8, Size = 16396;
        public const uint Version = Size | (3u << 16);
    }

    const int UnicodeMax = 2048;

    static char[] Wide(string s)
    {
        if (s.Length >= UnicodeMax) throw new RigException("That name is too long for NVIDIA's settings.");
        var w = new char[UnicodeMax];
        s.CopyTo(0, w, 0, s.Length);
        return w;
    }

    static void Put(byte[] buffer, int at, string s) => Encoding.Unicode.GetBytes(Wide(s), 0, s.Length, buffer, at);

    static string Text(byte[] buffer, int at)
    {
        var span = MemoryMarshal.Cast<byte, char>(buffer.AsSpan(at, UnicodeMax * 2));
        int end = span.IndexOf('\0');
        return new string(end < 0 ? span : span[..end]);
    }
}
