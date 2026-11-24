// Graphics driver settings: the table Rig offers (rules/gpu.json, embedded,
// shared with packages/core/src/gpu.ts), the `gpu` native op that changes one
// NVIDIA setting as the person, and the `gpu` read.
//
// The op's undo is per setting, never a copy of NVIDIA's database file (the
// driver keeps the database in memory and writes the file whole). Apply notes,
// for each id it sets, whether the profile held it and whether that was
// NVIDIA's predefined value or the person's own, and whether Rig made the
// game's profile or added the game to one. Undo sets the old value back, puts
// NVIDIA's predefined one back, takes out what wasn't there, and removes what
// Rig made. Every read back is a fresh session loaded from the driver.

using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public static class GpuTable
{
    public sealed record Value(string Key, string Says, IReadOnlyList<(uint Id, uint To)> Set);
    public sealed record Range(uint Id, int Min, int Max, string Says);

    public sealed record Setting(string Key, string Name, string Says, int Tier, bool GlobalOnly, IReadOnlyList<Value> Values, Range? Range)
    {
        /// The named value, or a number in the range written plainly, or null.
        public Value? Choice(string value)
        {
            if (Values.FirstOrDefault(v => v.Key == value) is Value named) return named;
            if (Range is not Range r || !Regex.IsMatch(value, @"^[1-9][0-9]{0,9}\z") || !long.TryParse(value, out long n) || n < r.Min || n > r.Max) return null;
            return new Value(value, r.Says.Replace("{n}", value), [(r.Id, (uint)n)]);
        }

        /// The value these driver values amount to: a named one, a number in the range, or null when it's something else.
        public Value? Reading(Func<uint, uint> now)
        {
            if (Values.FirstOrDefault(v => v.Set.All(s => now(s.Id) == s.To)) is Value named) return named;
            return Range is Range r && now(r.Id) is uint n && n >= r.Min && n <= r.Max ? Choice(n.ToString()) : null;
        }

        /// Every id the setting reads, the first one being where its value is said to come from.
        public IEnumerable<uint> Ids => Values.SelectMany(v => v.Set.Select(s => s.Id)).Concat(Range is Range r ? [r.Id] : []).Distinct();

        public string Allowed => $"{Name} takes one of: {string.Join(", ", Values.Select(v => v.Key))}{(Range is Range r ? $", or a whole number from {r.Min} to {r.Max}" : "")}.";
    }

    sealed record Table(IReadOnlyDictionary<string, Setting> Settings, IReadOnlyDictionary<uint, uint> Defaults);

    static readonly Lazy<Table> table = new(Load);
    public static IReadOnlyDictionary<string, Setting> Settings => table.Value.Settings;
    public static uint Default(uint id) => table.Value.Defaults.TryGetValue(id, out uint d) ? d : 0;

    /// A DRS id or value as the table writes it: a whole number, or hex text like "0x60925292".
    static uint Num(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? Convert.ToUInt32(s[2..], 16) : (uint)Json.Num(n, -1);

    static Table Load()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Rig.Rules.gpu.json") ?? throw new RigException("Rig's graphics settings list is missing from the helper.");
        var nvidia = (JsonNode.Parse(s) as JsonObject)?["nvidia"] as JsonObject ?? throw new RigException("Rig's graphics settings list can't be read.");
        var defaults = nvidia["defaults"]!.AsObject().ToDictionary(kv => Num(JsonValue.Create(kv.Key)), kv => Num(kv.Value));
        var settings = new Dictionary<string, Setting>(StringComparer.Ordinal);
        foreach (var (key, e) in nvidia["settings"]!.AsObject())
        {
            var values = e!["values"]!.AsObject().Select(kv => new Value(kv.Key, kv.Value!["says"]!.GetValue<string>(),
                kv.Value["set"]!.AsObject().Select(x => (Num(JsonValue.Create(x.Key)), Num(x.Value))).ToList())).ToList();
            var range = e["range"] is JsonObject r ? new Range(Num(r["id"]), (int)Json.Num(r["min"], 0), (int)Json.Num(r["max"], 0), r["says"]!.GetValue<string>()) : null;
            settings[key] = new Setting(key, e["name"]!.GetValue<string>(), e["says"]!.GetValue<string>(), (int)Json.Num(e["tier"], 3), e["scope"]?.ToString() == "global", values, range);
        }
        return new Table(settings, defaults);
    }

    static readonly Regex App = new(@"^[a-z0-9][a-z0-9 _.()+-]{0,99}\.exe\z");

    /// A program file name as NVIDIA's database matches it, in lower case, or null when it isn't one. Same as gpuApp in gpu.ts.
    public static string? AppName(JsonNode? n)
    {
        if (n is not JsonValue v || !v.TryGetValue(out string? s)) return null;
        string app = s.ToLowerInvariant();
        return App.IsMatch(app) && !app.Contains("..") ? app : null;
    }

    public const string BadApp = "app must be the game's program file name, like game.exe, with no folder.";
}

/// The `gpu` native op: one NVIDIA driver setting to one value from the table, for one game or for the whole PC.
public sealed class GpuStep : INativeStep
{
    public string Name => "gpu";

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    /// Same rules and words as canonicalGpu in packages/core/src/gpu.ts.
    public NativeCheck Check(JsonObject op)
    {
        string? vendor = Str(op["vendor"]);
        if (vendor != "nvidia") throw new RigException(vendor is "amd" or "intel" ? "Rig can only change NVIDIA's graphics settings for now." : "vendor must be nvidia.");
        if (Str(op["setting"]) is not string key || !GpuTable.Settings.TryGetValue(key, out var setting))
            throw new RigException($"Rig doesn't change that graphics setting. It changes: {string.Join(", ", GpuTable.Settings.Keys)}.");
        string value = op["value"] is JsonValue jv ? jv.GetValueKind() switch { JsonValueKind.String => jv.GetValue<string>(), JsonValueKind.Number => jv.ToJsonString(), _ => "" } : "";
        if (setting.Choice(value) == null) throw new RigException(setting.Allowed);
        string? app = null;
        if (op["app"] is JsonNode a && Str(a) != "")
        {
            app = GpuTable.AppName(a) ?? throw new RigException(GpuTable.BadApp);
            if (setting.GlobalOnly) throw new RigException($"{setting.Name} is one setting for the whole PC, not for one game. Leave app out.");
        }
        if (Str(op["does"]) is not string does || does.Trim().Length == 0 || does.Length > 300) throw new RigException("does must be one plain sentence.");
        var kept = new JsonObject { ["name"] = Name, ["vendor"] = vendor };
        if (app != null) kept["app"] = app;
        kept["setting"] = key;
        kept["value"] = value;
        kept["does"] = does;
        return new NativeCheck(kept, setting.Tier, ["A graphics driver setting from Rig's own list. Rig notes how it was and puts it back exactly on undo."], []);
    }

    static GpuTable.Setting SettingOf(JsonObject op) => GpuTable.Settings[op["setting"]!.GetValue<string>()];
    static GpuTable.Value ChoiceOf(JsonObject op) => SettingOf(op).Choice(op["value"]!.GetValue<string>())!;
    static string? AppOf(JsonObject op) => Str(op["app"]);
    static string RigProfile(string app) => $"Rig {app}";

    public string Preview(JsonObject op)
    {
        using var drs = NvApi.Open().Session();
        return Gpu.Line(drs, SettingOf(op), AppOf(op));
    }

    public JsonObject Apply(JsonObject op)
    {
        var choice = ChoiceOf(op);
        string? app = AppOf(op);
        using var drs = NvApi.Open().Session();
        IntPtr profile;
        bool madeProfile = false, addedApp = false;
        if (app == null) profile = drs.Global();
        else if ((profile = drs.App(app)) == IntPtr.Zero)
        {
            // The game has no profile of its own: Rig gives it one, or finds the one it made before.
            profile = drs.ProfileNamed(RigProfile(app));
            if (profile == IntPtr.Zero) { profile = drs.CreateProfile(RigProfile(app)); madeProfile = true; }
            drs.AddApp(profile, app);
            addedApp = true;
        }
        var old = new JsonArray();
        foreach (var (id, _) in choice.Set)
        {
            var s = drs.Get(profile, id);
            string was = s == null || !s.In(app == null) ? "absent" : s.Predefined ? "predefined" : "user";
            var o = new JsonObject { ["id"] = $"0x{id:X8}", ["was"] = was };
            if (was == "user") o["value"] = s!.Value;
            old.Add(o);
        }
        foreach (var (id, to) in choice.Set) drs.Set(profile, id, to);
        // Nothing reaches the driver until this; a failure before it leaves everything as it was.
        drs.Save();
        var back = new JsonObject { ["madeProfile"] = madeProfile, ["addedApp"] = addedApp, ["old"] = old };
        if (madeProfile || addedApp) back["profile"] = RigProfile(app!);
        return back;
    }

    public string? Verify(JsonObject op)
    {
        var setting = SettingOf(op);
        var choice = ChoiceOf(op);
        string? app = AppOf(op);
        using var drs = NvApi.Open().Session();
        IntPtr profile = app == null ? drs.Global() : drs.App(app);
        if (profile == IntPtr.Zero) return $"{app} isn't in NVIDIA's settings.";
        foreach (var (id, to) in choice.Set)
            if (drs.Get(profile, id) is not { } s || !s.In(app == null) || s.Value != to) return Gpu.Line(drs, setting, app);
        return null;
    }

    public void Undo(JsonObject op, JsonObject back)
    {
        string? app = AppOf(op);
        using var drs = NvApi.Open().Session();
        bool on(string key) => back[key]?.GetValueKind() == JsonValueKind.True;
        if (app != null && on("madeProfile"))
        {
            // Rig made the game's profile, so taking the profile out puts everything back. Only Rig's own, by its name.
            IntPtr made = drs.ProfileNamed(back["profile"]?.ToString() ?? "");
            if (made != IntPtr.Zero) { drs.DeleteProfile(made); drs.Save(); }
            return;
        }
        IntPtr profile = app == null ? drs.Global() : drs.App(app);
        if (profile == IntPtr.Zero) throw new RigException($"{app} isn't in NVIDIA's settings any more, so there is nothing to put back.");
        foreach (var o in back["old"] as JsonArray ?? [])
        {
            uint id = Convert.ToUInt32(o!["id"]!.GetValue<string>()[2..], 16);
            switch (o["was"]?.ToString())
            {
                case "user": drs.Set(profile, id, (uint)Json.Num(o["value"], 0)); break;
                case "predefined": drs.RestoreDefault(profile, id); break;
                default: drs.Delete(profile, id); break;
            }
        }
        if (app != null && on("addedApp")) drs.RemoveApp(profile, app);
        drs.Save();
    }
}

/// The `gpu` read, and the lines both it and the op's preview show.
public static class Gpu
{
    static DriverDll.Maker Maker(string vendor) => vendor switch
    {
        "nvidia" => DriverDll.Nvidia,
        "amd" => DriverDll.Amd,
        "intel" => DriverDll.Intel,
        _ => throw new RigException("A gpu read needs vendor: nvidia, amd or intel."),
    };

    /// A setting as the driver has it now for a game (or the whole PC): the value in plain words and where it comes from.
    static (GpuTable.Value? Value, string Says, string From) Now(NvApi.Drs drs, GpuTable.Setting setting, IntPtr global, IntPtr profile)
    {
        var cache = new Dictionary<uint, NvApi.Setting?>();
        NvApi.Setting? Of(uint id)
        {
            if (!cache.TryGetValue(id, out var s))
            {
                s = profile != IntPtr.Zero ? drs.Get(profile, id) : null;
                if (s == null || s.From == NvApi.Where.Default) s = drs.Get(global, id) is { } g && g.From != NvApi.Where.Default ? g with { From = NvApi.Where.Global } : s;
                cache[id] = s;
            }
            return s;
        }
        uint Value(uint id) => Of(id)?.Value ?? GpuTable.Default(id);
        var value = setting.Reading(Value);
        uint first = setting.Ids.First();
        string from = Of(first) switch
        {
            null => "the driver's default",
            { From: NvApi.Where.Profile } when profile != IntPtr.Zero && profile != global => "set for this game",
            { From: NvApi.Where.Default } => "the driver's default",
            _ => "from the global settings",
        };
        string says = value?.Says ?? $"something Rig doesn't offer ({string.Join(", ", setting.Ids.Select(id => $"0x{id:X8} = 0x{Value(id):X}"))})";
        return (value, says, from);
    }

    /// Where a game's settings live, in words that never repeat a name someone other than NVIDIA wrote.
    static string ProfileWords(NvApi.Drs drs, IntPtr profile)
    {
        var (name, predefined) = drs.Info(profile);
        return predefined ? $"NVIDIA's own profile \"{name}\"" : "a profile made on this PC";
    }

    /// One line for the card: the setting, for whom, its value now and where that comes from.
    public static string Line(NvApi.Drs drs, GpuTable.Setting setting, string? app)
    {
        IntPtr global = drs.Global(), profile = app == null ? global : drs.App(app);
        var (_, says, from) = Now(drs, setting, global, profile);
        string whose = app == null ? "every game" : profile == IntPtr.Zero ? $"{app} (no NVIDIA profile yet)" : $"{app}, in {ProfileWords(drs, profile)}";
        return $"{setting.Name} for {whose}: {says} ({from})";
    }

    /// read_pc kind gpu. Checked again here against the same table; the answer is JSON text.
    public static string Read(JsonObject req)
    {
        string vendor = req["vendor"]?.ToString() ?? "";
        var maker = Maker(vendor);
        string? app = null;
        if (req["app"] is JsonNode a && a.ToString() != "") app = GpuTable.AppName(a) ?? throw new RigException(GpuTable.BadApp);
        var keys = new List<string>();
        if (req["settings"] is JsonArray list)
            foreach (var k in list.Take(16))
                keys.Add(k is JsonValue kv && kv.TryGetValue(out string? s) && GpuTable.Settings.ContainsKey(s) ? s : throw new RigException("settings must be keys from Rig's list of graphics settings, like vsync or lowLatency. Leave it out for all of them."));
        if (vendor != "nvidia")
        {
            // The driver is checked to be there and the maker's, and nothing of it is loaded.
            using (DriverDll.Checked(maker)) { }
            string where = vendor == "amd" ? "AMD Software: Adrenalin Edition" : "Intel Graphics Software";
            throw new RigException($"{maker.Who}'s graphics driver is on this PC, but Rig can't read its settings yet. They are in {where}.");
        }

        var api = NvApi.Open();
        using var drs = api.Session();
        IntPtr global = drs.Global(), profile = app == null ? global : drs.App(app);
        var settings = new JsonObject();
        foreach (var setting in keys.Count > 0 ? keys.Select(k => GpuTable.Settings[k]) : GpuTable.Settings.Values)
        {
            var (value, says, from) = Now(drs, setting, global, profile);
            settings[setting.Key] = new JsonObject { ["name"] = setting.Name, ["value"] = value?.Key, ["says"] = says, ["from"] = from, ["wholePcOnly"] = setting.GlobalOnly ? true : null };
        }
        var o = new JsonObject
        {
            ["vendor"] = "nvidia", ["driver"] = api.DriverVersion(), ["for"] = app ?? "the whole PC",
            ["profile"] = app == null ? "the global settings" : profile == IntPtr.Zero ? "none yet: the global settings apply, and a change gives the game a profile of its own" : ProfileWords(drs, profile),
            ["settings"] = settings,
        };
        return o.ToJsonString();
    }

    // ----- Self-test: CI has no graphics card, so it proves the table, the checks and the "no driver" path. -----

    public static (JsonObject Summary, List<string> Problems) SelfTest()
    {
        var checks = new JsonArray();
        var problems = new List<string>();
        void Check(string name, Func<IEnumerable<string>> run)
        {
            List<string> found;
            try { found = run().ToList(); } catch (Exception e) { found = [$"stopped: {e.GetType().Name}: {e.Message}"]; }
            string? skipped = found.FirstOrDefault(f => f.StartsWith(Skip, StringComparison.Ordinal));
            if (skipped != null) found.Remove(skipped);
            var row = new JsonObject { ["name"] = name, ["ok"] = found.Count == 0 };
            if (skipped != null) row["skipped"] = skipped[Skip.Length..];
            if (found.Count > 0) row["problems"] = new JsonArray(found.Select(f => (JsonNode)f).ToArray());
            checks.Add(row);
            problems.AddRange(found.Select(f => $"gpu, {name}: {f}"));
        }
        Check("the settings table loads", TableLoads);
        Check("a gpu step is checked as the app checks it", StepChecks);
        Check("without a driver the read says so in plain words", NoDriver);
        Check("a planted nvapi64.dll is never loaded", Planted);
        Check("the signer check refuses an unsigned file and another maker's", Signers);
        Check("a gpu step through the worker, with no NVIDIA driver", ThroughWorker);
        int passed = checks.Count(c => c?["ok"]?.GetValue<bool>() == true);
        return (new JsonObject { ["passed"] = passed, ["failed"] = checks.Count - passed, ["checks"] = checks }, problems);
    }

    const string Skip = "skipped: ";
    static bool Present(DriverDll.Maker m) => File.Exists(DriverDll.PathOf(m));

    static string? Fails(Action f)
    {
        try { f(); return null; } catch (RigException e) { return e.Message; }
    }

    static IEnumerable<string> TableLoads()
    {
        var all = GpuTable.Settings;
        if (all.Count < 15) yield return $"only {all.Count} settings";
        foreach (var s in all.Values)
        {
            if (s.Tier != 1) yield return $"{s.Key} is tier {s.Tier}";
            if (s.Values.Count == 0) yield return $"{s.Key} has no values";
        }
        if (all["vsync"].Choice("off")?.Set is not [(0x00A879CF, 0x08416747)]) yield return "vsync off isn't NVIDIA's force-off value";
        if (all["maxFrameRate"].Choice("141")?.Set is not [(0x10835002, 141)] || all["maxFrameRate"].Choice("19") != null) yield return "max frame rate's range isn't read right";
        // A value is read back from the driver values it sets, and the driver's defaults stand in for what nothing sets.
        if (all["vsync"].Reading(id => GpuTable.Default(id))?.Key != "app") yield return "vsync doesn't read as the game's own setting with nothing set";
        if (all["anisotropic"].Reading(id => id == 0x10D2BB16 ? 1u : 16u)?.Key != "x16") yield return "16x anisotropic filtering doesn't read back";
    }

    static readonly JsonObject Sample = new() { ["name"] = "gpu", ["vendor"] = "nvidia", ["app"] = "Game.exe", ["setting"] = "maxFrameRate", ["value"] = 141, ["does"] = "Caps the frame rate at 141.", ["admin"] = true };

    static IEnumerable<string> StepChecks()
    {
        var step = new GpuStep();
        var kept = step.Check((JsonObject)Sample.DeepClone());
        // packages/core/test/gpu.test.ts holds the same fingerprint for the same op.
        string hash = new NativeOpStep("gpu", kept.Op).Hash();
        if (hash != "24df9e27fb32ca00223a69c7f96c1c566caeb81ff39f04e219fdb83eaf220a54") yield return $"its fingerprint is {hash}, not the app's: {kept.Op.ToJsonString()}";
        if (kept.Tier != 1 || kept.Touches.Count != 0) yield return $"it is tier {kept.Tier} with {kept.Touches.Count} touches";
        if (step.Check(kept.Op).Op.ToJsonString() != kept.Op.ToJsonString()) yield return "checking what the check kept changed it";
        string? Refused(params (string Key, JsonNode? Value)[] with)
        {
            var op = (JsonObject)Sample.DeepClone();
            foreach (var (k, v) in with) op[k] = v;
            return Fails(() => step.Check(op));
        }
        if (Refused(("setting", "0x00A879CF"))?.StartsWith("Rig doesn't change that graphics setting.") != true) yield return "a free setting id wasn't refused";
        if (Refused(("value", "5")) != "Max frame rate takes one of: off, or a whole number from 20 to 1000.") yield return "a value out of range wasn't refused in the app's words";
        if (Refused(("vendor", "amd")) != "Rig can only change NVIDIA's graphics settings for now.") yield return "an AMD change wasn't refused";
        if (Refused(("setting", "shaderCache"), ("value", "off")) != "Shader cache size is one setting for the whole PC, not for one game. Leave app out.") yield return "a whole-PC setting for one game wasn't refused";
        if (Refused(("app", @"C:\Games\game.exe")) != GpuTable.BadApp) yield return "an app with a folder wasn't refused";
    }

    static IEnumerable<string> NoDriver()
    {
        var read = (string vendor) => Fails(() => Read(new JsonObject { ["vendor"] = vendor, ["app"] = "game.exe" }));
        if (Present(DriverDll.Nvidia)) yield return $"{Skip}this PC has NVIDIA's driver";
        else if (read("nvidia") != DriverDll.Missing(DriverDll.Nvidia)) yield return $"the NVIDIA read said: {read("nvidia")}";
        foreach (var (vendor, maker) in new[] { ("amd", DriverDll.Amd), ("intel", DriverDll.Intel) })
        {
            string? said = read(vendor);
            if (Present(maker) ? said?.Contains("can't read its settings yet") != true && said?.Contains("won't use it") != true : said != DriverDll.Missing(maker))
                yield return $"the {vendor} read said: {said}";
        }
        if (Fails(() => Read(new JsonObject { ["vendor"] = "nvidia", ["settings"] = new JsonArray("0x00A879CF") })) is not string bad || !bad.StartsWith("settings must be keys")) yield return "a free setting id was read";
    }

    static IEnumerable<string> Planted()
    {
        // Next to the helper and in the folder it runs in: where a bare-name load would look first.
        var planted = new List<string>();
        foreach (string dir in new[] { AppContext.BaseDirectory, Environment.CurrentDirectory }.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            string file = Path.Combine(dir, DriverDll.Nvidia.File);
            if (File.Exists(file)) continue;
            try { File.WriteAllBytes(file, [(byte)'M', (byte)'Z', 0, 0]); planted.Add(file); } catch (Exception) { }
        }
        if (planted.Count == 0) { yield return $"{Skip}no folder to plant a file in"; yield break; }
        try
        {
            string? said = Fails(() => Read(new JsonObject { ["vendor"] = "nvidia" }));
            if (!Present(DriverDll.Nvidia) && said != DriverDll.Missing(DriverDll.Nvidia)) yield return $"with a planted file the read said: {said}";
            var loaded = Process.GetCurrentProcess().Modules.Cast<ProcessModule>().Select(m => m.FileName).Where(f => planted.Contains(f, StringComparer.OrdinalIgnoreCase)).ToList();
            if (loaded.Count > 0) yield return $"the planted file was loaded: {string.Join(", ", loaded)}";
        }
        finally { foreach (string f in planted) try { File.Delete(f); } catch { } }
    }

    static IEnumerable<string> Signers()
    {
        string unsigned = Path.Combine(Path.GetTempPath(), "rig-selftest-" + CommandStore.NewId() + ".dll");
        File.WriteAllBytes(unsigned, [(byte)'M', (byte)'Z', 0, 0]);
        try
        {
            using var f = new FileStream(unsigned, FileMode.Open, FileAccess.Read, FileShare.Read);
            string? said = DriverDll.Problem(f.SafeFileHandle, unsigned, DriverDll.Nvidia);
            if (said?.Contains("won't use it") != true) yield return $"an unsigned file wasn't refused: {said ?? "it passed"}";
        }
        finally { try { File.Delete(unsigned); } catch { } }
        // A file Microsoft signed: good, and not NVIDIA's.
        string dotnet = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "dotnet", "dotnet.exe");
        if (!File.Exists(dotnet)) { yield return $"{Skip}no signed dotnet.exe on this PC"; yield break; }
        using var d = new FileStream(dotnet, FileMode.Open, FileAccess.Read, FileShare.Read);
        string? other = DriverDll.Problem(d.SafeFileHandle, dotnet, DriverDll.Nvidia);
        if (other != "The NVIDIA driver file on this PC (nvapi64.dll) is signed by Microsoft Corporation, not NVIDIA, so Rig won't use it.") yield return $"Microsoft's dotnet.exe as NVIDIA's: {other ?? "it passed"}";
        string? own = DriverDll.Problem(d.SafeFileHandle, dotnet, new DriverDll.Maker("dotnet.exe", ["Microsoft Corporation"], "Microsoft"));
        if (own != null) yield return $"Microsoft's own signature on dotnet.exe wasn't taken: {own}";
    }

    static IEnumerable<string> ThroughWorker()
    {
        if (Present(DriverDll.Nvidia)) { yield return $"{Skip}this PC has NVIDIA's driver"; yield break; }
        bool elevated = Native.IsAdmin();
        string root = elevated ? CommandStore.AdminRoot + "-selftest-gpu-" + CommandStore.NewId() : Path.Combine(Path.GetTempPath(), "rig-selftest-gpu-" + CommandStore.NewId());
        try
        {
            var rig = new Commands(new CommandStore(root, secured: elevated), elevated ? Environment.ProcessId : null, restorePoints: false)
            {
                TestOnlyElevatedApp = elevated ? false : null,
                // Lets the worker run with the self-test's admin rights; the gpu op itself is known everywhere.
                TestOnlyNativeOps = true,
            };
            var step = new JsonObject { ["kind"] = "native", ["op"] = Sample.DeepClone() };
            var check = rig.Handle("step.check", new JsonObject { ["step"] = step.DeepClone() })["verdict"];
            if (check?["status"]?.ToString() != "allowed" || Json.Num(check["tier"], 0) != 1 || check["admin"]?.GetValue<bool>() != false) yield return $"step.check: {check?.ToJsonString()}";
            var amd = (JsonObject)step.DeepClone();
            amd["op"]!["vendor"] = "amd";
            if (rig.Handle("step.check", new JsonObject { ["step"] = amd })["verdict"]?["refused"]?.ToString() != "Rig can only change NVIDIA's graphics settings for now.") yield return "an AMD step wasn't refused by the helper";
            var preview = rig.Handle("step.preview", new JsonObject { ["step"] = step.DeepClone() });
            string? refused = preview["verdict"]?["refused"]?.ToString();
            if (preview["outcome"]?.ToString() != "refused" || refused?.Contains(DriverDll.Missing(DriverDll.Nvidia)) != true) yield return $"the preview wasn't refused with the worker's plain words: {preview.ToJsonString()}";
        }
        finally { try { Directory.Delete(root, recursive: true); } catch { } }
    }
}
