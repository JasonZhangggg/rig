// The registry as Windows stores it: every value with its exact type number and
// bytes, read and written through the Win32 API, so a snapshot can put back
// what was there (or that nothing was) without reg export and import. HKCU is
// always the person's own hive, found by SID under HKEY_USERS, because the
// helper may be running elevated as a different account.

using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public static class Reg
{
    public sealed record Value(string Name, uint Type, byte[] Data);
    public sealed class Key
    {
        public List<Value> Values = [];
        public List<(string Name, Key Key)> Keys = [];
    }

    /// How much of a subtree Rig will hold. Past it, the read stops and says so rather than keep half a key as if it were whole.
    public sealed class Budget(int values, long bytes)
    {
        public int Values = values;
        public long Bytes = bytes;
        public bool Over;
        public bool Spend(int data) { Values--; Bytes -= data; if (Values < 0 || Bytes < 0) Over = true; return !Over; }
    }

    public static readonly IntPtr Machine = new(unchecked((int)0x80000002)), Users = new(unchecked((int)0x80000003));
    const int NotFound = 2, PathNotFound = 3, MoreData = 234, NoMoreItems = 259;
    const uint Read = 0x20019, Write = 0x20006, Delete = 0x10000;
    const int MaxDepth = 32;

    /// "HKLM\..." or "HKCU\..." as a Win32 root and path. HKCU is the person's hive.
    public static (IntPtr Root, string Path) Resolve(string key, string sid)
    {
        string k = key.Trim().TrimEnd('\\');
        if (k.StartsWith(@"HKLM\", StringComparison.OrdinalIgnoreCase)) return (Machine, k[5..]);
        if (k.StartsWith(@"HKCU\", StringComparison.OrdinalIgnoreCase)) return (Users, $@"{sid}\{k[5..]}");
        throw new RigException($"{key} isn't a registry key Rig can use; it must start with HKLM\\ or HKCU\\.");
    }

    static RigException Failed(string what, string path, int code) => new($"Rig couldn't {what} the registry key {path} (Windows error {code}).");

    static IntPtr Open(IntPtr root, string path, uint access, bool missingIsZero = true)
    {
        int rc = RegOpenKeyExW(root, path, 0, access, out IntPtr h);
        if (rc == 0) return h;
        if (missingIsZero && rc is NotFound or PathNotFound) return IntPtr.Zero;
        throw Failed(access == Read ? "read" : "change", path, rc);
    }

    public static bool Exists(IntPtr root, string path)
    {
        IntPtr h = Open(root, path, Read);
        if (h == IntPtr.Zero) return false;
        RegCloseKey(h);
        return true;
    }

    /// The whole key with everything under it, or null when it isn't there. Stops early when the budget runs out.
    public static Key? ReadKey(IntPtr root, string path, Budget budget, int depth = 0)
    {
        IntPtr h = Open(root, path, Read);
        if (h == IntPtr.Zero) return null;
        try
        {
            var key = new Key();
            var name = new char[16384];
            var data = new byte[4096];
            for (uint i = 0; ; i++)
            {
                uint nameLen = (uint)name.Length, dataLen = (uint)data.Length;
                int rc = RegEnumValueW(h, i, name, ref nameLen, IntPtr.Zero, out uint type, data, ref dataLen);
                if (rc == MoreData) { data = new byte[Math.Max(dataLen, data.Length * 2)]; i--; continue; }
                if (rc == NoMoreItems) break;
                if (rc != 0) throw Failed("read", path, rc);
                if (!budget.Spend((int)dataLen)) return key;
                key.Values.Add(new Value(new string(name, 0, (int)nameLen), type, data.AsSpan(0, (int)dataLen).ToArray()));
            }
            var subs = new List<string>();
            for (uint i = 0; ; i++)
            {
                uint nameLen = (uint)name.Length;
                int rc = RegEnumKeyExW(h, i, name, ref nameLen, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (rc == NoMoreItems) break;
                if (rc != 0) throw Failed("read", path, rc);
                subs.Add(new string(name, 0, (int)nameLen));
            }
            key.Values.Sort((a, b) => string.CompareOrdinal(a.Name.ToUpperInvariant(), b.Name.ToUpperInvariant()));
            subs.Sort((a, b) => string.CompareOrdinal(a.ToUpperInvariant(), b.ToUpperInvariant()));
            foreach (string sub in subs)
            {
                if (depth >= MaxDepth || !budget.Spend(0)) { budget.Over = true; return key; }
                if (ReadKey(root, $@"{path}\{sub}", budget, depth + 1) is Key child) key.Keys.Add((sub, child));
                if (budget.Over) return key;
            }
            return key;
        }
        finally { RegCloseKey(h); }
    }

    /// One value, or null when the value or its key isn't there. The default value's name is "".
    public static Value? ReadValue(IntPtr root, string path, string name)
    {
        IntPtr h = Open(root, path, Read);
        if (h == IntPtr.Zero) return null;
        try
        {
            var data = new byte[1024];
            for (; ; )
            {
                uint len = (uint)data.Length;
                int rc = RegQueryValueExW(h, name, IntPtr.Zero, out uint type, data, ref len);
                if (rc == MoreData) { data = new byte[Math.Max(len, data.Length * 2)]; continue; }
                if (rc == NotFound) return null;
                if (rc != 0) throw Failed("read", path, rc);
                return new Value(name, type, data.AsSpan(0, (int)len).ToArray());
            }
        }
        finally { RegCloseKey(h); }
    }

    static IntPtr Create(IntPtr root, string path)
    {
        int rc = RegCreateKeyExW(root, path, 0, null, 0, Read | Write | Delete, IntPtr.Zero, out IntPtr h, out _);
        if (rc != 0) throw Failed("change", path, rc);
        return h;
    }

    public static void SetValue(IntPtr root, string path, Value v)
    {
        IntPtr h = Create(root, path);
        try
        {
            int rc = RegSetValueExW(h, v.Name, 0, v.Type, v.Data, (uint)v.Data.Length);
            if (rc != 0) throw Failed("change", path, rc);
        }
        finally { RegCloseKey(h); }
    }

    public static void DeleteValue(IntPtr root, string path, string name)
    {
        IntPtr h = Open(root, path, Read | Write);
        if (h == IntPtr.Zero) return;
        try
        {
            int rc = RegDeleteValueW(h, name);
            if (rc != 0 && rc != NotFound) throw Failed("change", path, rc);
        }
        finally { RegCloseKey(h); }
    }

    /// Removes a key and everything under it. Fine when it's already gone.
    public static void DeleteKey(IntPtr root, string path)
    {
        int rc = RegDeleteTreeW(root, path);
        if (rc is NotFound or PathNotFound) return;
        if (rc != 0) throw Failed("remove", path, rc);
        rc = RegDeleteKeyExW(root, path, 0x100, 0);
        if (rc != 0 && rc is not (NotFound or PathNotFound)) throw Failed("remove", path, rc);
    }

    /// Removes a key only if nothing is in it. True when it's gone.
    public static bool DeleteIfEmpty(IntPtr root, string path)
    {
        if (ReadKey(root, path, new Budget(1, 1 << 20)) is not Key k) return true;
        if (k.Values.Count > 0 || k.Keys.Count > 0) return false;
        return RegDeleteKeyExW(root, path, 0x100, 0) is 0 or NotFound or PathNotFound;
    }

    /// Makes the key exactly what `want` holds: values and subkeys that aren't in it go, everything in it is written.
    public static void WriteKey(IntPtr root, string path, Key want)
    {
        IntPtr h = Create(root, path);
        RegCloseKey(h);
        var now = ReadKey(root, path, new Budget(int.MaxValue, long.MaxValue), MaxDepth) ?? new Key();
        foreach (var v in now.Values)
            if (!want.Values.Any(w => w.Name.Equals(v.Name, StringComparison.OrdinalIgnoreCase))) DeleteValue(root, path, v.Name);
        foreach (var v in want.Values)
            if (!now.Values.Any(n => n.Name.Equals(v.Name, StringComparison.OrdinalIgnoreCase) && n.Type == v.Type && n.Data.AsSpan().SequenceEqual(v.Data))) SetValue(root, path, v);
        foreach (string sub in SubKeys(root, path))
            if (!want.Keys.Any(w => w.Name.Equals(sub, StringComparison.OrdinalIgnoreCase))) DeleteKey(root, $@"{path}\{sub}");
        foreach (var (name, key) in want.Keys) WriteKey(root, $@"{path}\{name}", key);
    }

    public static List<string> SubKeys(IntPtr root, string path)
    {
        var subs = new List<string>();
        IntPtr h = Open(root, path, Read);
        if (h == IntPtr.Zero) return subs;
        try
        {
            var name = new char[16384];
            for (uint i = 0; ; i++)
            {
                uint nameLen = (uint)name.Length;
                int rc = RegEnumKeyExW(h, i, name, ref nameLen, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (rc == NoMoreItems) break;
                if (rc != 0) throw Failed("read", path, rc);
                subs.Add(new string(name, 0, (int)nameLen));
            }
        }
        finally { RegCloseKey(h); }
        return subs;
    }

    /// The deepest part of the path that exists now, so a restore can remove the keys a change made and no others. "" when not even the first part exists.
    public static string Anchor(IntPtr root, string path)
    {
        string at = path;
        while (at.Length > 0 && !Exists(root, at)) at = at.Contains('\\') ? at[..at.LastIndexOf('\\')] : "";
        return at;
    }

    /// Removes now-empty keys from `path` up to, and not including, `anchor`.
    public static void Prune(IntPtr root, string path, string anchor)
    {
        for (string at = path; at.Length > anchor.Length && at.StartsWith(anchor, StringComparison.OrdinalIgnoreCase) && at.Contains('\\'); at = at[..at.LastIndexOf('\\')])
            if (!DeleteIfEmpty(root, at)) return;
    }

    static readonly string[] TypeNames = ["REG_NONE", "REG_SZ", "REG_EXPAND_SZ", "REG_BINARY", "REG_DWORD", "REG_DWORD_BIG_ENDIAN", "REG_LINK", "REG_MULTI_SZ", "REG_RESOURCE_LIST", "REG_FULL_RESOURCE_DESCRIPTOR", "REG_RESOURCE_REQUIREMENTS_LIST", "REG_QWORD"];

    /// A value in words: its type and what it holds. Long binary data is shown by its size and fingerprint, so two different values never read the same.
    public static string Show(Value v)
    {
        string type = v.Type < TypeNames.Length ? TypeNames[v.Type] : $"type {v.Type}";
        string data = v.Type switch
        {
            1 or 2 => Encoding.Unicode.GetString(v.Data).TrimEnd('\0'),
            7 => string.Join(" | ", Encoding.Unicode.GetString(v.Data).TrimEnd('\0').Split('\0')),
            4 when v.Data.Length == 4 => BitConverter.ToUInt32(v.Data).ToString(),
            11 when v.Data.Length == 8 => BitConverter.ToUInt64(v.Data).ToString(),
            _ => v.Data.Length <= 32 ? Convert.ToHexString(v.Data) : $"{v.Data.Length} bytes, sha256 {Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(v.Data))[..16]}",
        };
        return $"{type} {data}".TrimEnd();
    }

    /// Every value under a key as "path\name" and what it holds, and every key as a line of its own, for comparing two reads.
    public static void Flatten(Key key, string prefix, IDictionary<string, string> into)
    {
        into[prefix + @"\"] = "key";
        foreach (var v in key.Values) into[$@"{prefix}\\{v.Name}"] = Show(v);
        foreach (var (name, sub) in key.Keys) Flatten(sub, $@"{prefix}\{name}", into);
    }

    public static JsonObject ToJson(Value v) => new() { ["name"] = v.Name, ["type"] = v.Type, ["data"] = Convert.ToBase64String(v.Data) };
    public static Value ValueOf(JsonNode n) => new(n["name"]!.GetValue<string>(), (uint)Json.Num(n["type"], 0), Convert.FromBase64String(n["data"]!.GetValue<string>()));

    public static JsonObject ToJson(Key k)
    {
        var values = new JsonArray();
        foreach (var v in k.Values) values.Add(ToJson(v));
        var keys = new JsonArray();
        foreach (var (name, sub) in k.Keys) keys.Add(new JsonObject { ["name"] = name, ["key"] = ToJson(sub) });
        return new JsonObject { ["values"] = values, ["keys"] = keys };
    }

    public static Key KeyOf(JsonNode n)
    {
        var k = new Key();
        foreach (var v in n["values"]!.AsArray()) k.Values.Add(ValueOf(v!));
        foreach (var s in n["keys"]!.AsArray()) k.Keys.Add((s!["name"]!.GetValue<string>(), KeyOf(s["key"]!)));
        return k;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegOpenKeyExW(IntPtr key, string sub, uint options, uint access, out IntPtr result);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegCreateKeyExW(IntPtr key, string sub, uint reserved, string? cls, uint options, uint access, IntPtr security, out IntPtr result, out uint disposition);
    [DllImport("advapi32.dll")] static extern int RegCloseKey(IntPtr key);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegEnumValueW(IntPtr key, uint index, [Out] char[] name, ref uint nameLen, IntPtr reserved, out uint type, [Out] byte[]? data, ref uint dataLen);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegEnumKeyExW(IntPtr key, uint index, [Out] char[] name, ref uint nameLen, IntPtr reserved, IntPtr cls, IntPtr clsLen, IntPtr written);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegQueryValueExW(IntPtr key, string? name, IntPtr reserved, out uint type, [Out] byte[]? data, ref uint dataLen);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegSetValueExW(IntPtr key, string? name, uint reserved, uint type, byte[]? data, uint dataLen);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegDeleteValueW(IntPtr key, string? name);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegDeleteTreeW(IntPtr key, string? sub);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern int RegDeleteKeyExW(IntPtr key, string sub, uint view, uint reserved);
}
