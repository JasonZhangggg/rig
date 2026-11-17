import { describe, expect, it } from "vitest";
import { buildPC, describeCall, findings, score, validateCall, type Inventory, type Snapshot, type SystemFacts } from "../src";
import { DemoClient, fixtures, simulate } from "../src/demo";

const atlas = () => structuredClone(fixtures.atlas.inv);
const facts = () => structuredClone(fixtures.atlas.facts);
const at8pm = Date.UTC(2026, 10, 17, 20, 0);
const at3am = Date.UTC(2026, 10, 17, 3, 0);

describe("buildPC", () => {
  it("makes every part the 3D scene can select on a tower", () => {
    const pc = buildPC(atlas(), simulate(atlas(), at3am), facts());
    expect(Object.keys(pc.parts!).sort()).toEqual(["case", "cpu", "fans", "gpu", "motherboard", "psu", "ram", "ssd"]);
    expect(pc.kind).toBe("tower");
    expect(pc.parts!.cpu.temp).toBeGreaterThan(30);
  });

  it("makes laptop parts and a battery tile", () => {
    const inv = structuredClone(fixtures.pebble.inv);
    const pc = buildPC(inv, simulate(inv, at3am), structuredClone(fixtures.pebble.facts));
    expect(Object.keys(pc.parts!).sort()).toEqual(["battery", "board", "chassis", "cpu", "fans", "ram", "ssd"]);
    expect(pc.stats!.map((s) => s.label)).toContain("Battery");
  });

  it("names unnamed Windows PCs kindly and keeps a chosen name", () => {
    const inv = atlas();
    inv.machine.hostname = "DESKTOP-4KF2J9A";
    expect(buildPC(inv, null, null).name).toBe("My PC");
    expect(buildPC(inv, null, null, { name: "Atlas" }).name).toBe("Atlas");
  });

  it("works before the first reading arrives", () => {
    const pc = buildPC(atlas(), null, null);
    expect(pc.parts!.cpu.temp).toBeUndefined();
    expect(pc.health).toBeGreaterThan(0);
  });
});

describe("health", () => {
  it("flags a hot graphics card and the slow screen", () => {
    const inv = atlas();
    const fs = findings({ inv, snap: simulate(inv, at8pm, { game: "Cyberpunk 2077", dust: 1 }), facts: facts() });
    const ids = fs.map((f) => f.id);
    expect(ids).toContain("gpu-warm");
    expect(fs.find((f) => f.id.startsWith("hz-"))?.fix).toEqual([{ kind: "display.refreshRate", display: "LG 27GP850", hz: 165 }]);
    expect(ids).toContain("startup");
  });

  it("is quiet when everything is fine", () => {
    const inv = atlas();
    inv.displays[0].refreshHz = 165;
    const f = facts();
    f.startupApps.forEach((a) => (a.enabled = false));
    const fs = findings({ inv, snap: simulate(inv, at3am), facts: f });
    expect(fs).toEqual([]);
    expect(score(false, fs).health).toBe(100);
  });

  it("warns about a nearly full drive and Windows 10", () => {
    const inv = atlas();
    inv.volumes[0].freeGb = 90;
    inv.machine.os.name = "Windows 10 Home";
    const ids = findings({ inv, snap: null, facts: null }).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["vol-C:", "win10"]));
  });

  it("asks for admin when sensors are limited", () => {
    const snap: Snapshot = { at: 0, sensors: [], elevated: false };
    expect(findings({ inv: atlas(), snap, facts: null })[0].title).toMatch(/can't read every temperature/);
  });
});

describe("actions", () => {
  it("rejects anything not in the catalog", () => {
    expect(validateCall({ kind: "registry.write", key: "HKLM" })).toMatch(/Unknown/);
    expect(validateCall({ kind: "power.maxProcessorState", ac: 20, dc: 100 })).toMatch(/percent/);
    expect(validateCall({ kind: "power.plan", guid: "381b4222-f694-41f0-9685-ff5bb260df2e" })).toBeNull();
  });

  it("describes a change with the current value", () => {
    const f: SystemFacts = facts();
    expect(describeCall({ kind: "power.plan", guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" }, f)).toEqual(["Power plan", "Balanced", "High performance"]);
    expect(describeCall({ kind: "startup.app", name: "Steam", enabled: false }, f)).toEqual(["Steam", "Starts with Windows", "Off"]);
  });
});

describe("demo client", () => {
  it("applies, undoes and redoes a change", async () => {
    const c = new DemoClient();
    const calls = [{ kind: "startup.app" as const, name: "Steam", enabled: false }, { kind: "power.plan" as const, guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" }];
    const ch = await c.apply("demo-atlas", calls, { by: "you" });
    expect(ch.diff).toEqual([["Steam", "Starts with Windows", "Off"], ["Power plan", "Balanced", "High performance"]]);
    expect(await c.preview("demo-atlas", calls)).toEqual([["Steam", "Off", "Off"], ["Power plan", "High performance", "High performance"]]);
    await c.undo("demo-atlas", ch.id);
    expect(await c.preview("demo-atlas", calls)).toEqual([["Steam", "Starts with Windows", "Off"], ["Power plan", "Balanced", "High performance"]]);
    const again = await c.redo("demo-atlas", ch.id);
    expect(again.status).toBe("applied");
  });

  it("fixes the screen refresh rate and the issue goes away", async () => {
    const c = new DemoClient();
    let pc = (await c.machines())[0];
    expect(pc.issues!.some((i) => i.id.startsWith("hz-"))).toBe(true);
    await c.apply("demo-atlas", [{ kind: "display.refreshRate", display: "LG 27GP850", hz: 165 }], { by: "you" });
    pc = (await c.machines())[0];
    expect(pc.issues!.some((i) => i.id.startsWith("hz-"))).toBe(false);
  });

  it("streams a proposal in chat", async () => {
    const c = new DemoClient();
    const events: string[] = [];
    await c.chat("demo-atlas", [{ id: "1", from: "you", text: "Why is startup so slow?" }], (e) => events.push(e.type));
    expect(events).toContain("proposal");
    expect(events.at(-1)).toBe("done");
  });
});

// Keep the fixture type honest
const _check: Inventory = fixtures.atlas.inv;
void _check;
