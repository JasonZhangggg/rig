// The firmware part of --selftest. CI runs on a virtual machine with no Dell,
// HP or Lenovo tools, so it proves the table, the "no maker tools" path, the
// refusals, the restart's preview (never the restart itself: nothing here
// runs shutdown.exe) and, with a stand-in for a maker's class, the whole
// approval path in the helper with admin rights: preview, approve, apply, the
// check after the restart and undo.

using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Rig.Helper;

public static class FirmwareSelfTest
{
    const string Skip = "skipped: ";

    /// A maker's class in memory: what Set was given, and a password state to report.
    sealed class MemoryBios(string maker, Dictionary<string, string> values) : IBios
    {
        public string Maker => maker;
        public string PasswordState = "none";
        public bool Present() => true;
        public string Password() => PasswordState;
        public Dictionary<string, string> Read(IEnumerable<string> names) => names.Where(values.ContainsKey).ToDictionary(n => n, n => values[n]);
        public void Set(string name, string value)
        {
            if (!values.ContainsKey(name)) throw new RigException("The stand-in has no such setting.");
            values[name] = value;
        }
        public string Now(string name) => values[name];
    }

    public static (JsonObject Summary, List<string> Problems) Run()
    {
        var checks = new JsonArray();
        var problems = new List<string>();
        var notes = new JsonObject();
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
            problems.AddRange(found.Select(f => $"firmware, {name}: {f}"));
        }
        Check("the firmware table loads, and no row is on its never list", TableLoads);
        Check("the read says when there are no maker tools, in Rig's own words", () => NoTools(notes));
        Check("a firmware step is refused in plain words here", Refusals);
        Check("restart into firmware setup: the preview reads OsIndicationsSupported and never restarts", () => RestartPreview(notes));
        Check("with a stand-in maker class: preview, approve, apply, the check after the restart, undo", StandIn);
        Check("a firmware password or the never list stops a change", PasswordAndNever);
        int passed = checks.Count(c => c?["ok"]?.GetValue<bool>() == true);
        return (new JsonObject { ["passed"] = passed, ["failed"] = checks.Count - passed, ["checks"] = checks, ["seen"] = notes }, problems);
    }

    static IEnumerable<string> TableLoads()
    {
        var t = FirmwareTable.Rules;
        if (t.Version < 1) yield return "the table has no version";
        if (t.Settings.Count != 6) yield return $"the table has {t.Settings.Count} settings, not 6";
        foreach (var s in t.Settings.Values)
        {
            foreach (var v in s.Allow) if (!s.Values.ContainsKey(v)) yield return $"{s.Key} allows {v}, which isn't one of its values";
            foreach (var v in s.Values.Keys.Except(s.Allow)) if (!s.Refuse.ContainsKey(v)) yield return $"{s.Key} refuses {v} without saying why";
            if (FirmwareTable.Never(s.Key) is string n) yield return $"{s.Key} is on the never list: {n}";
            foreach (var (maker, row) in s.Makers)
            {
                if (!t.Makers.ContainsKey(maker)) yield return $"{s.Key} names an unknown maker {maker}";
                if (FirmwareTable.Never(row.Attribute) is string never) yield return $"{maker}'s {row.Attribute} is on the never list: {never}";
                foreach (var v in row.Values.Keys) if (!s.Values.ContainsKey(v)) yield return $"{maker}'s {s.Key} maps {v}, which isn't one of its values";
            }
        }
        if (FirmwareTable.MakerOf("Dell Inc.") != "dell" || FirmwareTable.MakerOf("HP") != "hp" || FirmwareTable.MakerOf("Hewlett-Packard") != "hp" || FirmwareTable.MakerOf("LENOVO") != "lenovo") yield return "a maker's name isn't matched";
        if (FirmwareTable.MakerOf("Microsoft Corporation") != null || FirmwareTable.MakerOf("HPE-like Corp") != null || FirmwareTable.MakerOf(null) != null) yield return "another maker's name was matched";
    }

    static IEnumerable<string> NoTools(JsonObject notes)
    {
        var (maker, bios) = Firmware.Find();
        if (bios != null) { yield return $"{Skip}this PC has {Firmware.MakerName(maker)}'s firmware tools"; yield break; }
        var o = JsonNode.Parse(Firmware.Read()) as JsonObject;
        notes["read"] = o?.DeepClone();
        if (o == null) { yield return "the read isn't JSON"; yield break; }
        if (o["makerTools"]?.GetValue<bool>() != false) yield return "the read says there are maker tools";
        if (o["next"]?.ToString() != Firmware.NoInterface(maker)) yield return $"the read's next step is {o["next"]}";
        if (o["settings"] != null) yield return "the read lists settings without maker tools";
        if (maker == null && o["maker"]?.ToString() != "not Dell, HP or Lenovo") yield return $"the read names the maker {o["maker"]}";
        var known = new Dictionary<string, string[]>
        {
            ["tpm"] = ["on", "off", "not found", "not known"], ["secureBoot"] = ["on", "off", "not supported", "not known"],
            ["virtualization"] = ["on", "off", "not known"], ["driveEncryption"] = ["on", "off", "not known"], ["firmwareSetupFromWindows"] = ["yes", "no", "not known"],
        };
        foreach (var (k, ok) in known) if (!ok.Contains(o[k]?.ToString())) yield return $"{k} reads {o[k]}";
        if (Reads.Read(new JsonObject { ["kind"] = "firmware" }, null)["text"]?.ToString() is not string text || !text.Contains("\"makerTools\":false")) yield return "read_pc firmware doesn't reach the firmware read";
    }

    static Commands Rig(string root, bool elevated) =>
        new(new CommandStore(root, secured: elevated), elevated ? Environment.ProcessId : null, restorePoints: false) { TestOnlyElevatedApp = elevated ? false : null };

    static string Root(string what) => Native.IsAdmin() ? CommandStore.AdminRoot + $"-selftest-{what}-" + CommandStore.NewId() : Path.Combine(Path.GetTempPath(), $"rig-selftest-{what}-" + CommandStore.NewId());

    static JsonObject Step(string setting, string value) => new()
    {
        ["kind"] = "native", ["op"] = new JsonObject { ["name"] = "firmware", ["setting"] = setting, ["value"] = value, ["does"] = "Rig's self-test firmware change." },
    };

    static JsonNode? Verdict(Commands rig, JsonObject step) => rig.Handle("step.check", new JsonObject { ["step"] = step })["verdict"];

    static IEnumerable<string> Refusals()
    {
        var (maker, bios) = Firmware.Find();
        if (bios != null) { yield return $"{Skip}this PC has {Firmware.MakerName(maker)}'s firmware tools"; yield break; }
        string root = Root("firmware");
        try
        {
            var rig = Rig(root, Native.IsAdmin());
            var v = Verdict(rig, Step("virtualization", "on"));
            string want = Native.IsAdmin() ? Firmware.NoInterface(maker) : Firmware.NeedsAdmin;
            if (v?["status"]?.ToString() != "refused" || v["refused"]?.ToString() != want) yield return $"a set wasn't refused with Rig's words: {v?.ToJsonString()}";
            var p = rig.Handle("step.preview", new JsonObject { ["step"] = Step("virtualization", "on") });
            if (p["outcome"]?.ToString() != "refused") yield return $"a preview wasn't refused: {p.ToJsonString()}";
        }
        finally { try { Directory.Delete(root, recursive: true); } catch { } }
    }

    static IEnumerable<string> RestartPreview(JsonObject notes)
    {
        var (readable, supported, why) = Firmware.Setup();
        notes["osIndicationsSupported"] = new JsonObject { ["readable"] = readable, ["supported"] = supported, ["says"] = why };
        if (!Native.IsAdmin()) { yield return $"{Skip}the self-test has no admin rights"; yield break; }
        string root = Root("restart");
        int before = Process.GetProcessesByName("shutdown").Length;
        try
        {
            var rig = Rig(root, true);
            var step = new JsonObject { ["kind"] = "native", ["op"] = new JsonObject { ["name"] = "restartToFirmware", ["extra"] = "ignored" } };
            var v = Verdict(rig, (JsonObject)step.DeepClone());
            if (v?["status"]?.ToString() != "allowed" || Json.Num(v["tier"], 0) != 3 || v["admin"]?.GetValue<bool>() != true) yield return $"the restart's check: {v?.ToJsonString()}";
            var p = rig.Handle("step.preview", new JsonObject { ["step"] = step });
            notes["restartPreview"] = p["outcome"]?.ToString();
            if (supported)
            {
                if (p["outcome"]?.ToString() != "ready" || p["read"]?.ToString()?.StartsWith(why, StringComparison.Ordinal) != true) yield return $"the preview didn't say firmware setup can open: {p.ToJsonString()}";
            }
            else if (p["outcome"]?.ToString() != "refused" || p["verdict"]?["refused"]?.ToString()?.Contains(why) != true) yield return $"the preview wasn't refused with the firmware's words: {p.ToJsonString()}";
            // The preview only reads: nothing is waiting to restart.
            if (Process.GetProcessesByName("shutdown").Length > before) yield return "shutdown.exe ran";
        }
        finally { try { Directory.Delete(root, recursive: true); } catch { } }
    }

    static IEnumerable<string> StandIn()
    {
        if (!Native.IsAdmin()) { yield return $"{Skip}the self-test has no admin rights"; yield break; }
        var bios = new MemoryBios("dell", new() { ["Virtualization"] = "Disabled", ["WakeOnLan"] = "LanWithPxeBoot", ["TpmSecurity"] = "Disabled" });
        string root = Root("firmware-standin");
        Firmware.TestOnlyBios = bios;
        try
        {
            var store = new CommandStore(root, secured: true);
            var rig = new Commands(store, Environment.ProcessId, restorePoints: false) { TestOnlyElevatedApp = false };
            var p = rig.Handle("step.preview", new JsonObject { ["step"] = Step("virtualization", "on") });
            if (p["outcome"]?.ToString() != "ready") { yield return $"the preview: {p.ToJsonString()}"; yield break; }
            if (p["verdict"]?["admin"]?.GetValue<bool>() != true || Json.Num(p["verdict"]?["tier"], 0) != 3) yield return $"the verdict isn't tier 3 with admin rights: {p["verdict"]?.ToJsonString()}";
            if (p["read"]?.ToString()?.StartsWith("Virtualization (Intel VT-x or AMD-V): Off\nDrive encryption on drive ", StringComparison.Ordinal) != true) yield return $"the preview reads {p["read"]}";

            // Without Windows' prompt answered, nothing runs.
            var early = rig.Handle("step.apply", new JsonObject { ["nonce"] = p["nonce"]?.ToString() });
            if (early["outcome"]?.ToString() != "declined" || bios.Now("Virtualization") != "Disabled") yield return $"it ran before it was approved: {early.ToJsonString()}";
            var person = Person.Find(Environment.ProcessId);
            string file = Path.Combine(store.Work, "approve.json");
            File.WriteAllText(file, new JsonObject { ["nonce"] = p["nonce"]?.ToString(), ["owner"] = person.Sid }.ToJsonString());
            if (Commands.ApproveFromFile(file, p["hash"]?.ToString(), store) != RecorderSetup.Ok) { yield return "it couldn't be approved"; yield break; }
            var a = rig.Handle("step.apply", new JsonObject { ["nonce"] = p["nonce"]?.ToString() });
            if (a["outcome"]?.ToString() != "applied") { yield return $"the apply: {a.ToJsonString()}"; yield break; }
            if (bios.Now("Virtualization") != "Enabled") yield return $"the stand-in reads {bios.Now("Virtualization")}";
            if (a["result"]?["after"]?.ToString()?.StartsWith("Virtualization (Intel VT-x or AMD-V): On", StringComparison.Ordinal) != true) yield return $"the result reads {a["result"]?["after"]}";
            string id = a["undo"]?["id"]?.ToString() ?? "";

            // Before a restart nothing is due; after one, Windows' own reading is reported once.
            if (AfterRestart.Report(store)["found"] is not JsonArray { Count: 0 }) yield return "a check was due before any restart";
            var found = AfterRestart.Report(store, AfterRestart.Boot() + 10 * 60_000)["found"] as JsonArray;
            string? says = found?.FirstOrDefault()?["says"]?.ToString();
            if (found?.Count != 1 || found[0]?["id"]?.ToString() != id || says?.StartsWith("After the restart, ", StringComparison.Ordinal) != true || !says.Contains("Virtualization (Intel VT-x or AMD-V)")) yield return $"after the restart it said {found?.ToJsonString()}";
            if (AfterRestart.Report(store, AfterRestart.Boot() + 10 * 60_000)["found"] is not JsonArray { Count: 0 }) yield return "the check after the restart was answered twice";

            var u = rig.Handle("step.undo", new JsonObject { ["id"] = id });
            if (u["outcome"]?.ToString() != "undone" || bios.Now("Virtualization") != "Disabled") yield return $"the undo: {u.ToJsonString()}, the stand-in reads {bios.Now("Virtualization")}";

            // A value Rig doesn't know comes back exactly as it was: Dell's "LAN with PXE boot" isn't one Rig offers.
            var w = rig.Handle("step.preview", new JsonObject { ["step"] = Step("wakeOnLan", "off") });
            if (w["read"]?.ToString()?.StartsWith("Wake on LAN: a value Rig doesn't know\n", StringComparison.Ordinal) != true) yield return $"an unknown value reads {w["read"]}";
            File.WriteAllText(file, new JsonObject { ["nonce"] = w["nonce"]?.ToString(), ["owner"] = person.Sid }.ToJsonString());
            Commands.ApproveFromFile(file, w["hash"]?.ToString(), store);
            var wa = rig.Handle("step.apply", new JsonObject { ["nonce"] = w["nonce"]?.ToString() });
            var wu = rig.Handle("step.undo", new JsonObject { ["id"] = wa["undo"]?["id"]?.ToString() });
            if (wu["outcome"]?.ToString() != "undone" || bios.Now("WakeOnLan") != "LanWithPxeBoot") yield return $"the old value didn't come back: {wu.ToJsonString()}, {bios.Now("WakeOnLan")}";

            // Dell lets Windows change the security chip only with a password, so it is refused with Dell's own words.
            var tpm = Verdict(rig, Step("tpm", "on"));
            if (tpm?["refused"]?.ToString() != FirmwareTable.Rules.Settings["tpm"].Makers["dell"].Why) yield return $"Dell's security chip: {tpm?.ToJsonString()}";
        }
        finally
        {
            Firmware.TestOnlyBios = null;
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    static IEnumerable<string> PasswordAndNever()
    {
        var bios = new MemoryBios("hp", new() { ["Virtualization Technology (VTx)"] = "Disable" }) { PasswordState = "set" };
        string root = Root("firmware-never");
        Firmware.TestOnlyBios = bios;
        try
        {
            var rig = Rig(root, Native.IsAdmin());
            var pw = Verdict(rig, Step("virtualization", "on"));
            if (pw?["refused"]?.ToString()?.StartsWith("A firmware (BIOS) password is set on this PC") != true) yield return $"with a password set: {pw?.ToJsonString()}";
            bios.PasswordState = "not known";
            if (Verdict(rig, Step("virtualization", "on"))?["refused"]?.ToString()?.StartsWith("Rig couldn't tell whether a firmware (BIOS) password is set") != true) yield return "a password state Rig couldn't read wasn't refused";
            foreach (var (setting, value) in new[] { ("bootOrder", "usb"), ("tpm", "off"), ("secureBoot", "off"), ("sataMode", "raid"), ("tpmClear", "on") })
            {
                var v = Verdict(rig, Step(setting, value));
                if (v?["status"]?.ToString() != "refused" || v["why"]?.ToString() != "never") yield return $"{setting} {value} wasn't refused as never: {v?.ToJsonString()}";
            }
            if (bios.Now("Virtualization Technology (VTx)") != "Disable") yield return "a refused step changed the stand-in";
        }
        finally
        {
            Firmware.TestOnlyBios = null;
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
