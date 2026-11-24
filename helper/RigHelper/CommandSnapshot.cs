// What a command says it touches, read before it runs and put back on undo or
// rollback: registry keys and values (typed, with "absent" as a state of its
// own), files up to a size cap, and a service's start type and whether it was
// running. Each state has a fingerprint, so undo can tell when something else
// changed it since, and Rig never says it put something back that it didn't.

using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

/// Who reads and writes for a snapshot: the person's SID for HKCU, and a wrapper that acts as the person when the command doesn't run as admin,
/// so putting a file or key back never does more than the person could.
public sealed record SnapshotContext(Person Person, bool Admin)
{
    public T Io<T>(Func<T> read)
    {
        if (Admin) return read();
        T result = default!;
        Person.As(() => result = read());
        return result;
    }
    public void Io(Action act) { if (Admin) act(); else Person.As(act); }
}

public static class Snapshot
{
    public const int MaxValues = 5000;
    public const long MaxRegistryBytes = 8L << 20, MaxFileBytes = 32L << 20;

    static string Kind(JsonObject touch) => touch["kind"]!.GetValue<string>();
    static string Text(JsonObject touch, string field) => touch[field]!.GetValue<string>();

    public static string Name(JsonObject touch) => Kind(touch) switch
    {
        "registry" => touch["value"] is JsonValue v ? $@"{Text(touch, "key")}\{(v.GetValue<string>().Length == 0 ? "(Default)" : v.GetValue<string>())}" : Text(touch, "key"),
        "file" => Text(touch, "path"),
        "service" => $"the {Text(touch, "name")} service",
        _ => Text(touch, "name"),
    };

    /// The touch's state now. With `copies`, a file's bytes are kept there under `tag` so it can be put back.
    public static JsonObject Read(JsonObject touch, SnapshotContext ctx, string? copies = null, string tag = "")
    {
        switch (Kind(touch))
        {
            case "registry":
            {
                var (root, path) = Reg.Resolve(Text(touch, "key"), ctx.Person.Sid);
                return ctx.Io(() =>
                {
                    var state = new JsonObject { ["kind"] = "registry", ["anchor"] = Reg.Anchor(root, path) };
                    if (touch["value"] is JsonValue name)
                        state["value"] = Reg.ReadValue(root, path, name.GetValue<string>()) is Reg.Value v ? Reg.ToJson(v) : null;
                    else
                    {
                        var budget = new Reg.Budget(MaxValues, MaxRegistryBytes);
                        state["key"] = Reg.ReadKey(root, path, budget) is Reg.Key k ? Reg.ToJson(k) : null;
                        if (budget.Over) state["partial"] = $"{Name(touch)} holds more than Rig snapshots ({MaxValues} values or {MaxRegistryBytes >> 20} MB)";
                    }
                    return state;
                });
            }
            case "file":
            {
                string path = Text(touch, "path");
                var state = new JsonObject { ["kind"] = "file" };
                byte[]? bytes = ctx.Io(() =>
                {
                    if (Directory.Exists(path)) { state["partial"] = $"{path} is a folder, and Rig snapshots single files"; state["file"] = new JsonObject { ["folder"] = true }; return null; }
                    if (!File.Exists(path)) { state["file"] = null; return null; }
                    long size = new FileInfo(path).Length;
                    if (size > MaxFileBytes) { state["partial"] = $"{path} is bigger than Rig copies ({MaxFileBytes >> 20} MB)"; state["file"] = new JsonObject { ["size"] = size }; return null; }
                    return File.ReadAllBytes(path);
                });
                if (bytes != null)
                {
                    var file = new JsonObject { ["size"] = bytes.LongLength, ["sha256"] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() };
                    if (copies != null) { file["copy"] = $"{tag}.bin"; File.WriteAllBytes(Path.Combine(copies, $"{tag}.bin"), bytes); }
                    state["file"] = file;
                }
                return state;
            }
            case "service":
            {
                string name = ServiceName(touch);
                var (root, path) = (Reg.Machine, $@"SYSTEM\CurrentControlSet\Services\{name}");
                var state = new JsonObject { ["kind"] = "service", ["service"] = null };
                if (Reg.ReadValue(root, path, "Start") is not { Data.Length: 4 } start) return state;
                bool running = false;
                try { using var sc = new ServiceController(name); running = sc.Status is ServiceControllerStatus.Running or ServiceControllerStatus.StartPending; } catch (InvalidOperationException) { }
                state["service"] = new JsonObject
                {
                    ["start"] = BitConverter.ToInt32(start.Data),
                    ["delayed"] = Reg.ReadValue(root, path, "DelayedAutostart") is { Data.Length: 4 } d && BitConverter.ToInt32(d.Data) != 0,
                    ["running"] = running,
                };
                return state;
            }
            default:
                return new JsonObject { ["kind"] = "none", ["partial"] = $"Rig has no snapshot for {Name(touch)}" };
        }
    }

    static string ServiceName(JsonObject touch)
    {
        string name = Text(touch, "name").Trim();
        return Regex.IsMatch(name, @"^[^\\/""<>|:*?]{1,256}$") ? name : throw new RigException($"\"{name}\" isn't a service name.");
    }

    /// Why this state can't be put back in full, or null when it can.
    public static string? Partial(JsonObject state) => state["partial"]?.GetValue<string>();

    static readonly string[] Starts = ["Boot", "System", "Automatic", "Manual", "Disabled"];

    /// The state in a few words for the card. Null means it isn't there.
    public static string? Show(JsonObject state)
    {
        switch (state["kind"]!.GetValue<string>())
        {
            case "registry":
                if (state.ContainsKey("value")) return state["value"] is JsonNode v ? Reg.Show(Reg.ValueOf(v)) : null;
                if (state["key"] is not JsonNode k) return null;
                var flat = new SortedDictionary<string, string>(StringComparer.Ordinal);
                Reg.Flatten(Reg.KeyOf(k), "", flat);
                int keys = flat.Count(f => f.Value == "key") - 1, values = flat.Count - keys - 1;
                var top = Reg.KeyOf(k).Values;
                string list = string.Join("; ", top.Take(6).Select(x => $"{(x.Name.Length == 0 ? "(Default)" : x.Name)} = {Reg.Show(x)}"));
                return $"{values} value{(values == 1 ? "" : "s")}, {keys} subkey{(keys == 1 ? "" : "s")}{(list.Length > 0 ? $": {list}{(top.Count > 6 ? "; ..." : "")}" : "")}";
            case "file":
                if (state["file"] is not JsonObject f) return null;
                if (f["folder"] != null) return "a folder";
                return f["sha256"] is JsonNode sha ? $"{Json.Num(f["size"], 0):0} bytes, sha256 {sha.GetValue<string>()[..16]}" : $"{Json.Num(f["size"], 0):0} bytes";
            case "service":
                if (state["service"] is not JsonObject s) return null;
                int start = (int)Json.Num(s["start"], -1);
                string type = start is >= 0 and < 5 ? Starts[start] : $"start type {start}";
                return $"{type}{(s["delayed"]?.GetValue<bool>() == true ? " (delayed start)" : "")}, {(s["running"]?.GetValue<bool>() == true ? "running" : "stopped")}";
            default: return null;
        }
    }

    /// A fingerprint of the state itself: equal exactly when the same things hold the same data. Whether a service happens to be running isn't part of it.
    public static string Hash(JsonObject state)
    {
        var s = (JsonObject)state.DeepClone();
        s.Remove("anchor");
        s.Remove("partial");
        (s["file"] as JsonObject)?.Remove("copy");
        (s["service"] as JsonObject)?.Remove("running");
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s.ToJsonString()))).ToLowerInvariant();
    }

    /// Puts the touch back to `state`. Returns what it couldn't put back, in plain words; empty when it's all back.
    /// `copy` hands back a file Rig kept, by the name in the snapshot.
    public static List<string> Restore(JsonObject touch, JsonObject state, SnapshotContext ctx, Func<string, byte[]> copy)
    {
        var left = new List<string>();
        try
        {
            switch (state["kind"]!.GetValue<string>())
            {
                case "registry":
                {
                    var (root, path) = Reg.Resolve(Text(touch, "key"), ctx.Person.Sid);
                    string anchor = state["anchor"]!.GetValue<string>();
                    bool keyWasThere = anchor.Equals(path, StringComparison.OrdinalIgnoreCase);
                    ctx.Io(() =>
                    {
                        if (touch["value"] is JsonValue name)
                        {
                            if (state["value"] is JsonNode v) Reg.SetValue(root, path, Reg.ValueOf(v));
                            else Reg.DeleteValue(root, path, name.GetValue<string>());
                            if (!keyWasThere) Reg.Prune(root, path, anchor);
                        }
                        else if (state["key"] is JsonNode k)
                        {
                            if (Partial(state) != null) throw new RigException(Partial(state)!);
                            Reg.WriteKey(root, path, Reg.KeyOf(k));
                        }
                        else
                        {
                            Reg.DeleteKey(root, path);
                            if (path.Contains('\\')) Reg.Prune(root, path[..path.LastIndexOf('\\')], anchor);
                        }
                    });
                    break;
                }
                case "file":
                {
                    string path = Text(touch, "path");
                    if (Partial(state) != null) throw new RigException(Partial(state)!);
                    byte[]? bytes = state["file"] is JsonObject f ? copy(Path.GetFileName(f["copy"]!.GetValue<string>())) : null;
                    if (bytes != null && Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != state["file"]!["sha256"]!.GetValue<string>())
                        throw new RigException($"Rig's copy of {path} is damaged");
                    ctx.Io(() =>
                    {
                        if (bytes == null) { if (File.Exists(path)) File.Delete(path); }
                        else if (!File.Exists(path) || !File.ReadAllBytes(path).AsSpan().SequenceEqual(bytes)) File.WriteAllBytes(path, bytes);
                    });
                    break;
                }
                case "service":
                {
                    string name = ServiceName(touch);
                    if (state["service"] is not JsonObject s)
                    {
                        if (Read(touch, ctx)["service"] != null) left.Add($"{Name(touch)} didn't exist before, and Rig doesn't remove services here");
                        break;
                    }
                    Services.SetStart(name, (uint)Json.Num(s["start"], 3), s["delayed"]?.GetValue<bool>() == true);
                    using var sc = new ServiceController(name);
                    bool want = s["running"]?.GetValue<bool>() == true, running = sc.Status is ServiceControllerStatus.Running or ServiceControllerStatus.StartPending;
                    if (want && !running) { sc.Start(); sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30)); }
                    else if (!want && running && sc.CanStop) { sc.Stop(); sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30)); }
                    else if (!want && running) left.Add($"{Name(touch)} was stopped before and can't be stopped now");
                    break;
                }
                default:
                    left.Add(Partial(state) ?? $"Rig has no snapshot for {Name(touch)}");
                    break;
            }
        }
        catch (Exception e) when (e is RigException or IOException or UnauthorizedAccessException or InvalidOperationException or System.ComponentModel.Win32Exception or System.ServiceProcess.TimeoutException)
        {
            left.Add($"{Name(touch)}: {e.Message.TrimEnd('.')}");
        }
        return left;
    }
}

/// The service changes a restore needs, through the service manager itself.
public static class Services
{
    public const uint NoChange = 0xFFFFFFFF;
    const uint SC_MANAGER_CONNECT = 1, SERVICE_CHANGE_CONFIG = 0x2, SERVICE_STOP = 0x20, DELETE = 0x10000, SERVICE_CONFIG_DELAYED_AUTO_START_INFO = 3, SERVICE_CONTROL_STOP = 1;

    static void With(string name, uint access, Action<IntPtr> act)
    {
        IntPtr scm = OpenSCManagerW(null, null, SC_MANAGER_CONNECT);
        if (scm == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        try
        {
            IntPtr svc = OpenServiceW(scm, name, access);
            if (svc == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            try { act(svc); } finally { CloseServiceHandle(svc); }
        }
        finally { CloseServiceHandle(scm); }
    }

    /// Sets a service's start type and, when given, the program it runs.
    public static void Configure(string name, uint start, string? image) => With(name, SERVICE_CHANGE_CONFIG, svc =>
    {
        if (!ChangeServiceConfigW(svc, NoChange, start, NoChange, image, null, IntPtr.Zero, null, null, null, null)) throw new System.ComponentModel.Win32Exception();
    });

    public static void SetStart(string name, uint start, bool delayed) => With(name, SERVICE_CHANGE_CONFIG, svc =>
    {
        if (!ChangeServiceConfigW(svc, NoChange, start, NoChange, null, null, IntPtr.Zero, null, null, null, null)) throw new System.ComponentModel.Win32Exception();
        // Only an automatic service can start delayed; Windows refuses the flag on any other, and it means nothing there.
        if (start == 2) { int flag = delayed ? 1 : 0; ChangeServiceConfig2W(svc, SERVICE_CONFIG_DELAYED_AUTO_START_INFO, ref flag); }
    });

    /// Stops a service and removes it: only ever for one that appeared during a run that is being rolled back.
    public static void Remove(string name) => With(name, SERVICE_STOP | DELETE, svc =>
    {
        ControlService(svc, SERVICE_CONTROL_STOP, new byte[36]);
        if (!DeleteService(svc)) throw new System.ComponentModel.Win32Exception();
    });

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenSCManagerW(string? machine, string? database, uint access);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenServiceW(IntPtr scm, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ChangeServiceConfigW(IntPtr svc, uint type, uint start, uint error, string? path, string? group, IntPtr tag, string? deps, string? user, string? password, string? display);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool ChangeServiceConfig2W(IntPtr svc, uint level, ref int info);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool ControlService(IntPtr svc, uint control, [Out] byte[] status);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DeleteService(IntPtr svc);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CloseServiceHandle(IntPtr h);
}
