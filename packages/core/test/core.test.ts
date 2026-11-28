import { describe, expect, it } from "vitest";
import { buildPC, coreLoad, coresOf, describeCall, fixSteps, findReadings, sensorKinds, HistoryWindow, keyReadings, livePoint, type Reading, findings, score, validateCall, type Inventory, type Snapshot, type SystemFacts } from "../src";
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

  it("says why processor temperatures are missing when PawnIO isn't installed", () => {
    const ids = (driver: Snapshot["driver"], elevated = true) => findings({ inv: atlas(), snap: { at: 0, sensors: [], elevated, driver }, facts: null }).map((f) => f.id);
    expect(ids({ installed: false })).toContain("needs-driver");
    expect(ids({ installed: true, version: "2.0.1.0" })).not.toContain("needs-driver");
    expect(ids(undefined)).not.toContain("needs-driver");
    expect(ids({ installed: false }, false)).toEqual(expect.arrayContaining(["needs-admin"]));
    expect(ids({ installed: false }, false)).not.toContain("needs-driver");
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
    const calls = fixSteps([{ kind: "startup.app", name: "Steam", enabled: false }, { kind: "power.plan", guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" }]);
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
    await c.apply("demo-atlas", fixSteps([{ kind: "display.refreshRate", display: "LG 27GP850", hz: 165 }]), { by: "you" });
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

describe("each part's readings", () => {
  it("files every sensor under its part, with the lowest and highest the monitor kept", () => {
    const snap = simulate(atlas(), at3am);
    snap.sensors.find((s) => s.name === "GPU Core" && s.type === "temperature")!.min = 31;
    const pc = buildPC(atlas(), snap, facts(), {}, { [snap.sensors.find((s) => s.name === "GPU Core")!.id]: 88 });
    const by = (part: string) => pc.readings!.filter((r) => r.part === part).map((r) => r.name);
    expect(by("gpu")).toEqual(expect.arrayContaining(["GPU Core", "GPU Hot Spot", "GPU Fan 1"]));
    expect(by("ram")).toEqual(["Memory", "Memory Used", "Memory Available", "Virtual Memory"]);
    expect(by("fans")).toEqual(["Fan #1", "Fan #2", "Fan #3", "Fan #4"]);
    expect(by("motherboard")).toEqual(expect.arrayContaining(["System", "VRM MOS", "+12V", "Vcore"]));
    const core = pc.readings!.find((r) => r.part === "gpu" && r.name === "GPU Core" && r.type === "temperature")!;
    expect(core).toMatchObject({ min: 31, max: 88 });
    expect(Object.keys(pc.parts!)).toEqual(expect.arrayContaining([...new Set(pc.readings!.map((r) => r.part))]));
  });

  it("leaves out a memory stick's limit settings, and names virtual memory as such", () => {
    const snap = simulate(atlas(), at3am);
    const mem = (id: string, hwName: string, type: Snapshot["sensors"][number]["type"], name: string, value: number) => ({ id, hw: "memory" as const, hwName, type, name, value });
    snap.sensors.push(
      mem("/dimm/0/t/0", "DIMM #1", "temperature", "DIMM #1", 37),
      mem("/dimm/0/t/1", "DIMM #1", "temperature", "Temperature Sensor Resolution", 0),
      mem("/dimm/0/t/2", "DIMM #1", "temperature", "Thermal Sensor High Limit", 0),
      mem("/vram/load/0", "Virtual Memory", "load", "Memory", 68),
    );
    const pc = buildPC(atlas(), snap, facts());
    const ram = pc.readings!.filter((r) => r.part === "ram").map((r) => r.name);
    expect(ram).toContain("DIMM #1");
    expect(ram.filter((n) => /limit|resolution/i.test(n))).toEqual([]);
    expect(ram.filter((n) => n === "Memory")).toHaveLength(1);
    expect(ram).toContain("Virtual Memory");
  });

  it("logs each part's use and temperature per window: loads averaged, temperatures at their highest", () => {
    const inv = atlas();
    const w = new HistoryWindow(0);
    const quiet = simulate(inv, 0, { activity: { cpu: 0, gpu: 0, game: null } });
    const flat = simulate(inv, 1, { game: "Cyberpunk 2077" });
    w.add(quiet); w.add(flat);
    const p = w.point();
    const read = (s: typeof quiet, hw: string, type: string, name: RegExp) => s.sensors.find((x) => x.hw === hw && x.type === type && name.test(x.name))!.value!;
    expect(p.cpuLoad).toBe(Math.round((read(quiet, "cpu", "load", /total/i) + read(flat, "cpu", "load", /total/i)) / 2));
    expect(p.mem).toBe(Math.round((read(quiet, "memory", "load", /^memory$/i) + read(flat, "memory", "load", /^memory$/i)) / 2));
    expect(p.drive).toBe(Math.round(Math.max(...flat.sensors.filter((x) => x.hw === "storage" && x.type === "temperature").map((x) => x.value!))));
    expect(p.board).toBe(Math.round(read(flat, "board", "temperature", /system/i)));
    expect(new HistoryWindow(0).point()).toMatchObject({ cpuLoad: null, gpuLoad: null, mem: null, drive: null, board: null });
  });

  it("reads the PC as it is now in the shape of a history point, for the live charts", () => {
    const pc = buildPC(atlas(), simulate(atlas(), at3am), facts());
    const p = livePoint(pc, 5);
    expect(p).toMatchObject({ t: 5, cpu: pc.parts!.cpu.temp, gpu: pc.parts!.gpu.temp, cpuLoad: pc.parts!.cpu.load, mem: pc.parts!.ram.load, board: pc.parts!.motherboard.temp });
    expect(p.fan).toBe(Math.max(...pc.readings!.filter((r) => r.part === "fans").map((r) => Math.round(r.value!))));
    expect(livePoint({ ...pc, parts: {}, readings: [] }, 5)).toMatchObject({ cpu: null, gpu: null, fan: null, mem: null });
  });
});

describe("a part's sensors, as a hardware monitor shows them", () => {
  const r = (name: string, type: Reading["type"], value: number, part = "cpu"): Reading => ({ id: `${part}/${type}/${name}`, part, name, type, value, min: null, max: value + 5 });

  it("lines up each core's load, threads, clock, temperature and power, leaving out totals", () => {
    const cores = coresOf([
      r("CPU Total", "load", 30), r("CPU Core Max", "load", 90), r("Core Max", "temperature", 70), r("Bus Speed", "clock", 100),
      r("CPU Core #2 Thread #1", "load", 40), r("CPU Core #2 Thread #2", "load", 20), r("CPU Core #1", "load", 90),
      r("Core #1", "clock", 5000), r("Core #2", "clock", 4800), r("Core #1", "temperature", 68), r("Core #2 (SMU)", "power", 6.5),
    ]);
    expect(cores.map((c) => c.label)).toEqual(["Core 1", "Core 2"]);
    expect(coreLoad(cores[0])).toBe(90);
    expect(coreLoad(cores[1])).toBe(30);
    expect(cores[0]).toMatchObject({ clock: { value: 5000 }, temp: { value: 68 }, power: null });
    expect(cores[1]).toMatchObject({ temp: null, power: { value: 6.5 } });
  });

  it("keeps Intel's performance and efficient cores apart, each counted from 1", () => {
    const cores = coresOf([r("E-Core #1", "clock", 3600), r("P-Core #1", "clock", 4800), r("P-Core #2", "clock", 4700), r("E-Core #1", "temperature", 55)]);
    expect(cores.map((c) => c.label)).toEqual(["P-core 1", "P-core 2", "E-core 1"]);
    expect(cores[2].temp?.value).toBe(55);
  });

  it("reads the demo's processors: per-core temperatures on Intel, one per chiplet on Ryzen", () => {
    const amd = buildPC(atlas(), simulate(atlas(), at8pm), facts());
    const amdCores = coresOf(amd.readings!);
    expect(amdCores).toHaveLength(8);
    expect(amdCores.every((c) => c.threads.length === 2 && c.clock && !c.temp && c.power)).toBe(true);
    const inv = structuredClone(fixtures.pebble.inv);
    const intel = coresOf(buildPC(inv, simulate(inv, at8pm), structuredClone(fixtures.pebble.facts)).readings!);
    expect(intel).toHaveLength(16);
    expect(intel.every((c) => c.temp)).toBe(true);
  });

  it("picks the readings worth a glance for each part, from what it reports", () => {
    const pc = buildPC(atlas(), simulate(atlas(), at8pm), facts());
    const labels = (part: string) => keyReadings(part, pc.readings!).map((k) => k.label);
    expect(labels("cpu")).toEqual(["Package", "Fastest core", "Power", "Core voltage"]);
    expect(labels("gpu")).toEqual(["Core", "Hot spot", "Video memory", "Core clock", "Power", "Fan", "Video memory used"]);
    expect(labels("ssd")).toEqual(["Temperature", "Life used", "Reading", "Writing", "Space used"]);
    expect(labels("motherboard")).toEqual(["Processor socket", "Power delivery", "Chipset", "12 V rail", "Core voltage"]);
    const hottest = keyReadings("cpu", [r("Core #1", "temperature", 60), r("Core #2", "temperature", 71)]);
    expect(hottest).toEqual([{ label: "Hottest core", type: "temperature", value: 71, max: 76, note: "Core #2" }]);
    expect(keyReadings("cpu", [])).toEqual([]);
  });

  it("splits a part's sensors by kind, and finds a reading from a few words", () => {
    const pc = buildPC(atlas(), simulate(atlas(), at8pm), facts());
    const cpu = pc.readings!.filter((x) => x.part === "cpu");
    expect(sensorKinds(cpu).map((k) => k.title)).toEqual(["Temperatures", "Usage", "Speeds", "Power", "Voltages"]);
    expect(sensorKinds(cpu).reduce((n, k) => n + k.count, 0)).toBe(cpu.length);
    const names = (q: string) => findReadings(pc.readings!, q).map((x) => x.name);
    expect(names("core 3")).toEqual(expect.arrayContaining(["CPU Core #3 Thread #1", "CPU Core #3 Thread #2", "Core #3", "Core #3 (SMU)"]));
    expect(names("core 3").every((n) => /#3\b/.test(n))).toBe(true);
    const many = [r("Core #1", "temperature", 50), r("Core #13", "temperature", 50), r("CPU Core #1 Thread #3", "load", 5)];
    expect(findReadings(many, "core 1").map((x) => x.name)).toEqual(["Core #1", "CPU Core #1 Thread #3"]);
    expect(findReadings(many, "core 3")).toEqual([]);
    expect(names("hot spot")).toEqual(["GPU Hot Spot"]);
    expect(findReadings(pc.readings!, "gpu temp").every((x) => x.part === "gpu" && x.type === "temperature")).toBe(true);
    expect(findReadings(pc.readings!, "usage").every((x) => x.type === "load")).toBe(true);
    expect(names("12v")).toEqual(["+12V"]);
    expect(findReadings(pc.readings!, "  ")).toEqual([]);
  });
});
