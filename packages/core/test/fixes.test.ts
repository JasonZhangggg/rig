// The typed fixes that make the common Windows settings faster and safer than a
// general command: a registry value, how a service starts, and a power setting.
// What the model may propose, what the card shows, and what undo puts back.

import { describe, expect, it } from "vitest";
import {
  cardTier, checkStep, describeCall, fixSteps, LocalClient, MemoryStore, NOT_READ, registryRawOf, registryRawText, validateCall,
  type ActionCall, type FixApplied, type FixNow, type HelperLink, type UndoCall,
} from "../src";
import { SimulatedLink, fixtures } from "../src/demo";

const reg = (key: string, name: string, type: string, value: unknown) => ({ kind: "registry.set", key, name, type, value });
const svc = (name: string, start: string) => ({ kind: "service.startType", name, start });
const pow = (subgroup: string, setting: string, ac: number, dc: number) => ({ kind: "power.setting", subgroup, setting, ac, dc });
const fix = (call: unknown) => fixSteps([call as ActionCall]);
const tierOf = (call: unknown) => cardTier(fix(call));

describe("registry.set", () => {
  it("takes a typed value in this person's settings or the whole PC's", () => {
    expect(validateCall(reg("HKCU\\Control Panel\\Desktop", "MenuShowDelay", "string", "100"))).toBeNull();
    expect(validateCall(reg("HKCU:\\Control Panel\\Desktop", "MenuShowDelay", "string", "100"))).toBeNull();
    expect(validateCall(reg("HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR", "AllowGameDVR", "dword", 0))).toBeNull();
    expect(validateCall(reg("HKCU\\Software\\Rig", "", "expandString", "%USERPROFILE%\\x"))).toBeNull();
    expect(validateCall(reg("HKCU\\Software\\Rig", "Big", "qword", "18446744073709551615"))).toBeNull();
    expect(validateCall(reg("HKCU\\Software\\Rig", "List", "multiString", ["a", "b"]))).toBeNull();
  });

  it("refuses values that don't fit their type, and binary", () => {
    expect(validateCall(reg("HKCU\\Software\\Rig", "x", "binary", "00ff"))).toMatch(/type must be/);
    expect(validateCall(reg("HKCU\\Software\\Rig", "x", "dword", 4294967296))).toMatch(/0 to 4294967295/);
    expect(validateCall(reg("HKCU\\Software\\Rig", "x", "dword", -1))).toMatch(/0 to 4294967295/);
    expect(validateCall(reg("HKCU\\Software\\Rig", "x", "dword", "1"))).toMatch(/whole number/);
    expect(validateCall(reg("HKCU\\Software\\Rig", "x", "qword", "18446744073709551616"))).toMatch(/18446744073709551615/);
    expect(validateCall(reg("HKCU\\Software\\Rig", "x", "string", 5))).toMatch(/text/);
    expect(validateCall(reg("HKCU\\Software\\Rig", "x", "string", "a\u0000b"))).toMatch(/text/);
    expect(validateCall(reg("HKCU\\Software\\Rig", "x", "multiString", ["a", ""]))).toMatch(/no empty lines/);
  });

  it("only writes HKCU or HKLM keys it can name exactly", () => {
    for (const key of ["HKCR\\.txt", "HKU\\S-1-5-18\\Software", "HKCU", "HKCU\\", "HKCU\\Software\\*", "HKCU\\Software\\..\\x", "\\\\server\\HKLM\\x", "Software\\Rig"]) {
      expect(validateCall(reg(key, "x", "dword", 1)), key).toMatch(/key must be/);
    }
  });

  it("refuses the never list, anything that lowers a protection, and places that pick which program runs", () => {
    expect(validateCall(reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Updater", "string", "C:\\x.exe"))).toMatch(/Run keys/);
    expect(validateCall(reg("HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon", "Shell", "string", "x.exe"))).toMatch(/sign-in/);
    expect(validateCall(reg("HKLM\\SYSTEM\\CurrentControlSet\\Services\\Spooler", "ImagePath", "expandString", "x.exe"))).toMatch(/which program a service runs/);
    expect(validateCall(reg("HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", "EnableLUA", "dword", 0))).toMatch(/User Account Control/);
    expect(validateCall(reg("HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender", "DisableAntiSpyware", "dword", 1))).toMatch(/Defender/);
    expect(validateCall(reg("HKCU\\Software\\Classes\\ms-settings\\shell\\open\\command", "", "string", "x.exe"))).toMatch(/never/);
    expect(validateCall(reg("HKCU\\Software\\Classes\\CLSID\\{0}\\InprocServer32", "", "string", "x.dll"))).toMatch(/which program opens/);
    expect(validateCall(reg("HKCU\\Environment", "Path", "expandString", "C:\\x"))).toMatch(/where Windows finds/);
    expect(validateCall(reg("HKCU\\Software\\RigHelper", "x", "dword", 1))).toMatch(/its own files/);
  });

  it("is tier 1 for this person's settings and tier 2, with admin, for the whole PC", () => {
    expect(tierOf(reg("HKCU\\Control Panel\\Desktop", "MenuShowDelay", "string", "100"))).toBe(1);
    expect(checkStep(fix(reg("HKCU\\Control Panel\\Desktop", "MenuShowDelay", "string", "100"))[0])).toMatchObject({ status: "allowed", tier: 1, admin: false });
    expect(checkStep(fix(reg("HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR", "AllowGameDVR", "dword", 0))[0])).toMatchObject({ status: "allowed", tier: 2, admin: true });
    expect(tierOf(reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "x", "string", "y"))).toBe("refused");
  });

  it("shows the value now beside the new one, and says when it isn't there", () => {
    const call = reg("HKCU\\Control Panel\\Desktop", "MenuShowDelay", "string", "100") as ActionCall;
    expect(describeCall(call, null)).toEqual(["HKCU\\Control Panel\\Desktop\\MenuShowDelay", NOT_READ, "\"100\""]);
    expect(describeCall(call, null, [], { kind: "registry.set", was: registryRawOf("string", "400") })).toEqual(["HKCU\\Control Panel\\Desktop\\MenuShowDelay", "\"400\"", "\"100\""]);
    expect(describeCall(call, null, [], { kind: "registry.set", was: null })[1]).toBe("Not set");
    // The same digits as a number and as text read differently, so the type shows.
    expect(describeCall(reg("HKCU:\\Software\\Rig", "", "dword", 1) as ActionCall, null, [], { kind: "registry.set", was: registryRawOf("string", "1") })).toEqual(["HKCU\\Software\\Rig\\(Default)", "\"1\" (text)", "1 (number)"]);
  });

  it("reads every stored type back in plain words", () => {
    expect(registryRawText(registryRawOf("dword", 4294967295))).toBe("4294967295");
    expect(registryRawText(registryRawOf("qword", "18446744073709551615"))).toBe("18446744073709551615");
    expect(registryRawText(registryRawOf("multiString", ["one", "two"]))).toBe("\"one\", \"two\"");
    expect(registryRawText({ type: 3, data: btoa("\u0001\u00ff") })).toBe("01 ff (2 bytes)");
    expect(registryRawText(null)).toBe("Not set");
  });
});

describe("service.startType", () => {
  it("changes how an ordinary service starts, at tier 2 with admin", () => {
    expect(validateCall(svc("SysMain", "disabled"))).toBeNull();
    expect(validateCall(svc("MSSQL$SQLEXPRESS", "manual"))).toBeNull();
    expect(checkStep(fix(svc("Spooler", "automaticDelayed"))[0])).toMatchObject({ status: "allowed", tier: 2, admin: true });
  });

  it("refuses Windows' security services, by name or display name, and the never list's services", () => {
    for (const name of ["WinDefend", "mpssvc", "wscsvc", "SecurityHealthService", "Sense", "WdNisSvc", "BFE", "EventLog", "wuauserv", "Windows Update"]) {
      expect(validateCall(svc(name, "disabled")), name).toMatch(/own protections/);
    }
    expect(validateCall(svc("WdFilter", "disabled"))).toMatch(/security services/);
    expect(validateCall(svc("TermService", "automatic"))).toMatch(/Remote Desktop/);
    expect(validateCall(svc("sshd", "automatic"))).toMatch(/SSH server/);
    expect(validateCall(svc("WinRM", "automatic"))).toMatch(/WinRM/);
    expect(validateCall(svc("RigHelper", "disabled"))).toMatch(/its own files/);
  });

  it("refuses odd names and start types", () => {
    expect(validateCall(svc("Spool*", "manual"))).toMatch(/service's name/);
    expect(validateCall(svc("..\\x", "manual"))).toMatch(/service's name/);
    expect(validateCall(svc("Spooler", "boot"))).toMatch(/start must be/);
  });

  it("shows how it starts now and after", () => {
    const call = svc("SysMain", "disabled") as ActionCall;
    expect(describeCall(call, null)).toEqual(["SysMain service", NOT_READ, "Off (disabled)"]);
    expect(describeCall(call, null, [], { kind: "service.startType", start: "automatic", display: "SysMain" })).toEqual(["SysMain service", "Starts with Windows", "Off (disabled)"]);
  });
});

describe("power.setting", () => {
  const usb = ["2a737441-1930-4402-8d77-b2bebba308a3", "48e6b7a6-50f5-4782-a5d4-53bb8f07e226"] as const;

  it("takes an allowed setting by GUID or powercfg alias, at tier 1", () => {
    expect(validateCall(pow(...usb, 0, 1))).toBeNull();
    expect(validateCall(pow("SUB_VIDEO", "VIDEOIDLE", 600, 300))).toBeNull();
    expect(validateCall(pow("sub_processor", "procthrottlemin", 5, 5))).toBeNull();
    expect(validateCall(pow("238C9FA8-0AAD-41ED-83F4-97BE242C8F20", "STANDBYIDLE", 0, 900))).toBeNull();
    expect(checkStep(fix(pow("SUB_PCIEXPRESS", "ASPM", 0, 2))[0])).toMatchObject({ status: "allowed", tier: 1, admin: false });
  });

  it("refuses settings outside the list and values outside each one's range", () => {
    expect(validateCall(pow("SUB_PROCESSOR", "PERFBOOSTMODE", 0, 0))).toMatch(/one of Rig's power settings/);
    expect(validateCall(pow("SUB_VIDEO", "STANDBYIDLE", 0, 0))).toMatch(/one of Rig's power settings/);
    expect(validateCall(pow(...usb, 2, 1))).toMatch(/0 to 1/);
    expect(validateCall(pow("SUB_PROCESSOR", "PROCTHROTTLEMAX", 40, 100))).toMatch(/50 to 100/);
    expect(validateCall(pow("SUB_VIDEO", "VIDEOIDLE", 30, 300))).toMatch(/0 for never or 60/);
    expect(validateCall(pow("SUB_SLEEP", "HIBERNATEIDLE", 0, 90000))).toMatch(/86400/);
    expect(validateCall(pow("SUB_PROCESSOR", "SYSCOOLPOL", 0.5, 1))).toMatch(/0 to 1/);
  });

  it("shows plugged in and battery, in minutes, names or percent", () => {
    expect(describeCall(pow("SUB_VIDEO", "VIDEOIDLE", 0, 300) as ActionCall, null, [], { kind: "power.setting", ac: 600, dc: 5400 })).toEqual(["Turn off the screen after (plugged in / battery)", "10 minutes / 1 hour 30 minutes", "Never / 5 minutes"]);
    expect(describeCall(pow(...usb, 0, 0) as ActionCall, null)).toEqual(["USB selective suspend (plugged in / battery)", NOT_READ, "Off / same"]);
    // The facts already hold the processor cap.
    expect(describeCall(pow("SUB_PROCESSOR", "PROCTHROTTLEMAX", 99, 99) as ActionCall, fixtures.atlas.facts)).toEqual(["Maximum processor state (plugged in / battery)", "100% / same", "99% / same"]);
  });
});

/** A helper that records every call and answers from the demo's made-up settings, like the real one. */
function recording(over: { readFix?: boolean; verify?: (c: UndoCall) => FixApplied["verify"] } = {}) {
  let t = new Date("2026-11-17T20:00:00").getTime();
  const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => t });
  const applied: UndoCall[] = [];
  const read: ActionCall[] = [];
  const link: HelperLink = {
    hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(),
    apply: async (c) => { applied.push(structuredClone(c)); const r = await sim.apply(c); return over.verify ? { ...r, verify: over.verify(c) } : r; },
    ...(over.readFix === false ? {} : { readFix: async (c: ActionCall): Promise<FixNow> => { read.push(c); return sim.readFix(c); } }),
  };
  const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => (t += 1000) });
  return { client, sim, applied, read };
}

describe("LocalClient with the typed fixes", () => {
  const menu = reg("HKCU\\Control Panel\\Desktop", "MenuShowDelay", "string", "100") as ActionCall;
  const fresh = reg("HKCU:\\Software\\RigTest", "Probe", "dword", 7) as ActionCall;

  it("reads the registry value for the preview, writes it, and undo puts the old value back with its type", async () => {
    const { client, sim, applied, read } = recording();
    await client.start();
    expect(await client.preview(client.id, fixSteps([menu]))).toEqual([["HKCU\\Control Panel\\Desktop\\MenuShowDelay", "\"400\"", "\"100\""]]);
    expect(read).toEqual([menu]);

    const change = await client.apply(client.id, fixSteps([menu]), { by: "rig" });
    expect(change).toMatchObject({ tier: 1, result: "", diff: [["HKCU\\Control Panel\\Desktop\\MenuShowDelay", "\"400\"", "\"100\""]] });
    expect(applied).toEqual([menu]);
    expect(await sim.readFix(menu)).toEqual({ kind: "registry.set", was: registryRawOf("string", "100") });

    await client.undo(client.id, change.id);
    expect(applied[1]).toEqual({ kind: "registry.restore", key: "HKCU\\Control Panel\\Desktop", name: "MenuShowDelay", was: registryRawOf("string", "400") });
    expect(await sim.readFix(menu)).toEqual({ kind: "registry.set", was: registryRawOf("string", "400") });

    await client.redo(client.id, change.id);
    expect(applied[2]).toEqual(menu);
    client.stop();
  });

  it("removes a value on undo when it wasn't there", async () => {
    const { client, sim, applied } = recording();
    await client.start();
    const change = await client.apply(client.id, fixSteps([fresh]), { by: "you" });
    expect(change.diff).toEqual([["HKCU\\Software\\RigTest\\Probe", "Not set", "7"]]);
    await client.undo(client.id, change.id);
    expect(applied[1]).toEqual({ kind: "registry.restore", key: "HKCU\\Software\\RigTest", name: "Probe", was: null });
    expect(await sim.readFix(fresh)).toEqual({ kind: "registry.set", was: null });
    client.stop();
  });

  it("fills in what was there from the helper's undo when an older helper can't read it first", async () => {
    const { client, applied } = recording({ readFix: false });
    await client.start();
    const steps = fixSteps([menu, svc("SysMain", "disabled") as ActionCall, pow("SUB_SLEEP", "STANDBYIDLE", 0, 900) as ActionCall]);
    expect((await client.preview(client.id, steps)).map((r) => r[1])).toEqual([NOT_READ, NOT_READ, NOT_READ]);
    const change = await client.apply(client.id, steps, { by: "rig" });
    expect(change.tier).toBe(2);
    expect(change.diff).toEqual([
      ["HKCU\\Control Panel\\Desktop\\MenuShowDelay", "\"400\"", "\"100\""],
      ["SysMain service", "Starts with Windows", "Off (disabled)"],
      ["Sleep after (plugged in / battery)", "30 minutes / 15 minutes", "Never / 15 minutes"],
    ]);
    await client.undo(client.id, change.id);
    expect(applied.slice(3)).toEqual([
      { kind: "power.setting", subgroup: "238c9fa8-0aad-41ed-83f4-97be242c8f20", setting: "29f6c1db-86da-48c5-9fdb-f2b67b1f44da", ac: 1800, dc: 900 },
      { kind: "service.startType", name: "SysMain", start: "automatic" },
      { kind: "registry.restore", key: "HKCU\\Control Panel\\Desktop", name: "MenuShowDelay", was: registryRawOf("string", "400") },
    ]);
    client.stop();
  });

  it("says so on the change when reading a fix back shows it didn't hold", async () => {
    const { client } = recording({ verify: (c) => (c.kind === "service.startType" ? { ok: false, problem: "SysMain still starts with Windows." } : { ok: true }) });
    await client.start();
    const change = await client.apply(client.id, fixSteps([svc("SysMain", "disabled") as ActionCall]), { by: "rig" });
    expect(change.status).toBe("applied");
    expect(change.result).toBe("Rig read it back afterwards and it didn't hold: SysMain still starts with Windows. Windows or another app may have changed it back.");
    expect(change.applied[0]).toMatchObject({ unverified: "SysMain still starts with Windows." });
    client.stop();
  });

  it("puts the registry back when a later step fails", async () => {
    const { client, sim, applied } = recording({ readFix: false });
    await client.start();
    const steps = fixSteps([fresh, svc("NoSuchService", "manual") as ActionCall]);
    await expect(client.apply(client.id, steps, { by: "rig" })).rejects.toThrow(/no service called NoSuchService/);
    expect(applied.at(-1)).toEqual({ kind: "registry.restore", key: "HKCU\\Software\\RigTest", name: "Probe", was: null });
    expect(await sim.readFix(fresh)).toEqual({ kind: "registry.set", was: null });
    expect(await client.changes(client.id)).toHaveLength(0);
    client.stop();
  });

  it("won't preview a refused registry write", async () => {
    const { client, applied } = recording();
    await client.start();
    await expect(client.preview(client.id, fix(reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "x", "string", "y")))).rejects.toThrow(/Run keys/);
    expect(applied).toEqual([]);
    client.stop();
  });
});
