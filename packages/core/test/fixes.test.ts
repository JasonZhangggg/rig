// power.setting, the typed fix for the power settings people change most:
// what the model may propose, what the card shows, and what undo puts back.

import { describe, expect, it } from "vitest";
import { cardTier, checkStep, describeCall, fixSteps, LocalClient, MemoryStore, NOT_READ, validateCall, type ActionCall, type FixApplied, type FixNow, type HelperLink } from "../src";
import { SimulatedLink, fixtures } from "../src/demo";

const pow = (subgroup: string, setting: string, ac: number, dc: number) => ({ kind: "power.setting", subgroup, setting, ac, dc }) as ActionCall;
const fix = (call: unknown) => fixSteps([call as ActionCall]);

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
    expect(describeCall(pow("SUB_VIDEO", "VIDEOIDLE", 0, 300), null, [], { kind: "power.setting", ac: 600, dc: 5400 })).toEqual(["Turn off the screen after (plugged in / battery)", "10 minutes / 1 hour 30 minutes", "Never / 5 minutes"]);
    expect(describeCall(pow(...usb, 0, 0), null)).toEqual(["USB selective suspend (plugged in / battery)", NOT_READ, "Off / same"]);
    // The facts already hold the processor cap.
    expect(describeCall(pow("SUB_PROCESSOR", "PROCTHROTTLEMAX", 99, 99), fixtures.atlas.facts)).toEqual(["Maximum processor state (plugged in / battery)", "100% / same", "99% / same"]);
  });
});

/** A helper that records every call and answers from the demo's made-up settings, like the real one. */
function recording(over: { readFix?: boolean; verify?: (c: ActionCall) => FixApplied["verify"] } = {}) {
  let t = new Date("2026-11-17T20:00:00").getTime();
  const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => t });
  const applied: ActionCall[] = [];
  const read: ActionCall[] = [];
  const link: HelperLink = {
    hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(),
    apply: async (c) => { applied.push(structuredClone(c)); const r = await sim.apply(c); return over.verify ? { ...r, verify: over.verify(c) } : r; },
    ...(over.readFix === false ? {} : { readFix: async (c: ActionCall): Promise<FixNow> => { read.push(c); return sim.readFix(c); } }),
  };
  const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => (t += 1000) });
  return { client, sim, applied, read };
}

describe("LocalClient with power.setting", () => {
  const sleep = pow("SUB_SLEEP", "STANDBYIDLE", 0, 900);
  const sleepGuids = { subgroup: "238c9fa8-0aad-41ed-83f4-97be242c8f20", setting: "29f6c1db-86da-48c5-9fdb-f2b67b1f44da" };
  const screenOff = pow("SUB_VIDEO", "VIDEOIDLE", 900, 600);

  it("reads the setting for the preview, changes it, and undo puts the old values back", async () => {
    const { client, sim, applied, read } = recording();
    await client.start();
    expect(await client.preview(client.id, fix(sleep))).toEqual([["Sleep after (plugged in / battery)", "30 minutes / 15 minutes", "Never / 15 minutes"]]);
    expect(read).toEqual([sleep]);

    const change = await client.apply(client.id, fix(sleep), { by: "rig" });
    expect(change).toMatchObject({ tier: 1, result: "", diff: [["Sleep after (plugged in / battery)", "30 minutes / 15 minutes", "Never / 15 minutes"]] });
    expect(applied).toEqual([sleep]);
    expect(await sim.readFix(sleep)).toEqual({ kind: "power.setting", ac: 0, dc: 900 });

    await client.undo(client.id, change.id);
    expect(applied[1]).toEqual({ kind: "power.setting", ...sleepGuids, ac: 1800, dc: 900 });
    expect(await sim.readFix(sleep)).toEqual({ kind: "power.setting", ac: 1800, dc: 900 });

    await client.redo(client.id, change.id);
    expect(applied[2]).toEqual(sleep);
    client.stop();
  });

  it("fills in what was there from the helper's undo when an older helper can't read it first", async () => {
    const { client, applied } = recording({ readFix: false });
    await client.start();
    const steps = fixSteps([sleep, screenOff]);
    expect((await client.preview(client.id, steps)).map((r) => r[1])).toEqual([NOT_READ, NOT_READ]);
    const change = await client.apply(client.id, steps, { by: "rig" });
    expect(change.diff).toEqual([
      ["Sleep after (plugged in / battery)", "30 minutes / 15 minutes", "Never / 15 minutes"],
      ["Turn off the screen after (plugged in / battery)", "10 minutes / 5 minutes", "15 minutes / 10 minutes"],
    ]);
    await client.undo(client.id, change.id);
    expect(applied.slice(2).map((c) => c.kind === "power.setting" && [c.ac, c.dc])).toEqual([[600, 300], [1800, 900]]);
    client.stop();
  });

  it("says so on the change when reading a fix back shows it didn't hold", async () => {
    const { client } = recording({ verify: () => ({ ok: false, problem: "Sleep after reads 1800 plugged in and 900 on battery." }) });
    await client.start();
    const change = await client.apply(client.id, fix(sleep), { by: "rig" });
    expect(change.status).toBe("applied");
    expect(change.result).toBe("Rig read it back afterwards and it didn't hold: Sleep after reads 1800 plugged in and 900 on battery. Windows or another app may have changed it back.");
    expect(change.applied[0]).toMatchObject({ unverified: "Sleep after reads 1800 plugged in and 900 on battery." });
    client.stop();
  });

  it("puts a power setting back when a later step fails", async () => {
    const { client, sim, applied } = recording({ readFix: false });
    await client.start();
    const steps = fixSteps([sleep, { kind: "startup.app", name: "Nothing like this", enabled: false }]);
    await expect(client.apply(client.id, steps, { by: "rig" })).rejects.toThrow(/Nothing was changed/);
    expect(applied.at(-1)).toEqual({ kind: "power.setting", ...sleepGuids, ac: 1800, dc: 900 });
    expect(await sim.readFix(sleep)).toEqual({ kind: "power.setting", ac: 1800, dc: 900 });
    expect(await client.changes(client.id)).toHaveLength(0);
    client.stop();
  });

  it("won't preview a value outside the setting's range", async () => {
    const { client, applied } = recording();
    await client.start();
    await expect(client.preview(client.id, fix(pow("SUB_PROCESSOR", "PROCTHROTTLEMAX", 10, 10)))).rejects.toThrow(/50 to 100/);
    expect(applied).toEqual([]);
    client.stop();
  });

  it("has no registry or service fix: those are command steps now", () => {
    expect(validateCall({ kind: "registry.set", key: "HKCU\\Control Panel\\Desktop", name: "MenuShowDelay", type: "string", value: "100" })).toMatch(/Unknown change/);
    expect(validateCall({ kind: "service.startType", name: "SysMain", start: "disabled" })).toMatch(/Unknown change/);
    expect(cardTier(fix({ kind: "registry.restore", key: "HKCU\\Software\\Rig", name: "x", was: null }))).toBe("refused");
  });
});
