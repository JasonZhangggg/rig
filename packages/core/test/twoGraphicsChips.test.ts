// A laptop with two graphics chips: the Radeon built into its Ryzen and a dedicated RTX. LibreHardwareMonitor lists
// AMD's chips before NVIDIA's, so the Radeon's readings come first; none of them is the graphics card's.

import { describe, expect, it } from "vitest";
import {
  HistoryWindow, buildPC, cleanProcesses, findings, recorded, runRules, sampleFrom, captureKinds,
  type Inventory, type Recording, type Sensor, type Snapshot,
} from "../src";
import { DemoClient, fixtures, simulate } from "../src/demo";

const RADEON = "AMD Radeon 780M Graphics"; // how the sensors name it; Windows writes "AMD Radeon(TM) 780M Graphics"
const RTX = "NVIDIA GeForce RTX 4060 Laptop GPU";

const comet = (): Inventory => structuredClone(fixtures.comet.inv);

const sensor = (hwName: string, type: Sensor["type"], name: string, value: number | null): Sensor =>
  ({ id: `/${hwName === RTX ? "gpu-nvidia" : hwName === RADEON ? "gpu-amd" : "cpu"}/0/${type}/${name}`, hw: hwName === RTX || hwName === RADEON ? "gpu" : "cpu", hwName, type, name, value, min: null, max: null });

/** The laptop at a moment: the built-in Radeon warm and busy with the desktop, and the RTX at `rtx`°C, or asleep. */
function snap(rtx: { temp: number; load: number } | "asleep", radeon = { temp: 84, load: 38 }): Snapshot {
  const on = (v: number) => (rtx === "asleep" ? null : v);
  return {
    at: 0, elevated: true, game: null,
    sensors: [
      sensor("AMD Ryzen 9 8945HS w/ Radeon 780M Graphics", "temperature", "Core (Tctl/Tdie)", 70),
      sensor(RADEON, "temperature", "GPU Core", radeon.temp),
      sensor(RADEON, "load", "GPU Core", radeon.load),
      sensor(RADEON, "clock", "GPU Core", 2600),
      sensor(RTX, "temperature", "GPU Core", on(rtx === "asleep" ? 0 : rtx.temp)),
      sensor(RTX, "temperature", "GPU Hot Spot", on(rtx === "asleep" ? 0 : rtx.temp + 9)),
      sensor(RTX, "load", "GPU Core", on(rtx === "asleep" ? 0 : rtx.load)),
      sensor(RTX, "load", "D3D 3D", rtx === "asleep" ? 0 : rtx.load),
      sensor(RTX, "clock", "GPU Core", on(2310)),
    ],
  };
}

describe("a laptop with built-in and dedicated graphics", () => {
  it("shows the dedicated chip's own temperature and load under its name, not the built-in chip's", () => {
    const pc = buildPC(comet(), snap({ temp: 71, load: 96 }), null);
    expect(pc.parts!.gpu).toMatchObject({ name: RTX, temp: 71, load: 96, clock: "2.31 GHz" });
    expect(pc.parts!.gpu.asleep).toBeUndefined();
    // Its sensor list holds the RTX's sensors only.
    expect(pc.readings!.filter((r) => r.part === "gpu").map((r) => r.value)).toEqual([71, 80, 96, 96, 2310]);
  });

  it("says the dedicated chip is asleep when it has no reading, instead of showing the built-in chip's", () => {
    const pc = buildPC(comet(), snap("asleep"), null);
    expect(pc.parts!.gpu.temp).toBeUndefined();
    expect(pc.parts!.gpu.asleep).toBe(true);
    expect(pc.parts!.gpu.load).toBe(0);
    expect(pc.readings!.filter((r) => r.part === "gpu").map((r) => r.name)).toEqual(["D3D 3D"]);
  });

  it("doesn't warn that the graphics card runs warm, or alert that it's at its limit, from the built-in chip's reading", () => {
    const hot = snap("asleep", { temp: 92, load: 60 });
    expect(findings({ inv: comet(), snap: hot, facts: null }).map((f) => f.id)).not.toContain("gpu-warm");
    expect(findings({ inv: comet(), snap: hot, facts: null }).map((f) => f.id)).not.toContain("gpu-hot");
    expect(runRules({ inv: comet(), snap: hot, history: [], now: 0, holding: new Set() }).map((f) => f.id)).not.toContain("too-hot:gpu");
    // The RTX's own heat still counts.
    expect(findings({ inv: comet(), snap: snap({ temp: 88, load: 99 }), facts: null }).map((f) => f.id)).toContain("gpu-hot");
  });

  it("logs the dedicated chip's temperature and load in history and recordings", () => {
    const w = new HistoryWindow(0, fixtures.comet.inv.gpus[1].name);
    w.add(snap({ temp: 64, load: 40 }));
    expect(w.point()).toMatchObject({ gpu: 64, gpuLoad: 40, busy: false });
    const asleep = new HistoryWindow(0, fixtures.comet.inv.gpus[1].name);
    asleep.add(snap("asleep", { temp: 80, load: 90 }));
    expect(asleep.point()).toMatchObject({ gpu: null, gpuLoad: 0, busy: false });
    expect(sampleFrom(snap({ temp: 66, load: 81 }), captureKinds, undefined, RTX)).toMatchObject({ gpu: 66, gpuLoad: 81 });
  });

  it("files only the dedicated chip's sensors under the graphics card in a background recording", () => {
    const s = snap({ temp: 60, load: 50 }).sensors;
    const rec: Pick<Recording, "samples" | "sensors"> = { sensors: s.map(({ value: _v, min: _a, max: _b, ...ref }) => ref), samples: [{ t: 0, all: s.map((x) => x.value) }] };
    const r = recorded(rec, RTX);
    const gpu = r.parts.find((p) => p.id === "gpu")!;
    expect(gpu.sensors.map((i) => r.sensors[i].hwName)).toEqual([RTX, RTX, RTX, RTX, RTX]);
    expect(r.sensors[gpu.lead]).toMatchObject({ hwName: RTX, name: "GPU Core" });
  });
});

describe("each app's graphics use, chip by chip", () => {
  const top = [
    { name: "cs2.exe", cpu: 31, memMb: 6100, gpu: 88, gpus: { [RTX]: 88, "AMD Radeon(TM) 780M Graphics": 3 } },
    { name: "chrome.exe", cpu: 4, memMb: 2100, gpu: 41, gpus: { "AMD Radeon(TM) 780M Graphics": 41 } },
    { name: "Discord.exe", cpu: 1, memMb: 500 },
  ];

  it("counts only an app's use of the graphics card, not of the built-in chip", () => {
    const list = cleanProcesses(top, 8, RTX);
    expect(list.find((p) => p.name === "cs2.exe")!.gpu).toBe(88);
    expect(list.find((p) => p.name === "chrome.exe")!.gpu).toBeUndefined();
    expect(list.find((p) => p.name === "Discord.exe")!.gpu).toBeUndefined();
  });

  it("gives no app a share of the card when none used it, rather than another chip's", () => {
    expect(cleanProcesses([top[1]], 8, RTX)[0].gpu).toBeUndefined();
  });

  it("reads the same cleaned again, and keeps an older helper's one share as it was", () => {
    const once = cleanProcesses(top, 8, RTX);
    expect(cleanProcesses(once, 8, RTX)).toEqual(once);
    expect(cleanProcesses([{ name: "game.exe", cpu: 20, memMb: 4000, gpu: 70 }], 8, RTX)[0].gpu).toBe(70);
  });
});

describe("the demo's gaming laptop", () => {
  const inv = fixtures.comet.inv;
  const game = { cpu: 0.7, gpu: 1, game: "Cyberpunk 2077" };
  const rest = { cpu: 0.05, gpu: 0.03, game: null };

  it("has built-in Radeon graphics and an RTX laptop chip, and shows the RTX as its graphics card", () => {
    expect(inv.machine.kind).toBe("laptop");
    expect(inv.gpus.map((g) => [g.vendor, g.integrated])).toEqual([["amd", true], ["nvidia", false]]);
    const pc = buildPC(inv, simulate(inv, Date.now(), { activity: game }), null);
    expect(pc.parts!.gpu.name).toBe(RTX);
    expect(pc.parts!.gpu.temp).toBeGreaterThan(70);
    expect(pc.parts!.gpu.load).toBeGreaterThan(90);
  });

  it("puts the RTX to sleep at rest, and says so", () => {
    const s = simulate(inv, Date.now(), { activity: rest });
    // The Radeon still reports, first, as LibreHardwareMonitor lists it.
    expect(s.sensors.find((x) => x.hw === "gpu")!.hwName).toBe(RADEON);
    const pc = buildPC(inv, s, null);
    expect(pc.parts!.gpu).toMatchObject({ asleep: true, load: 0 });
    expect(pc.parts!.gpu.temp).toBeUndefined();
  });

  it("is in the demo, plugged in, with its game on the RTX and its browser on the Radeon", async () => {
    const demo = new DemoClient();
    const pc = (await demo.machines()).find((p) => p.id === "demo-comet")!;
    expect(pc).toMatchObject({ name: "Comet", kind: "laptop" });
    expect(pc.parts!.gpu.name).toBe(RTX);
    expect(pc.battery).toMatchObject({ level: 80, state: "plugged", time: { text: "Plugged in, holding at 80%" } });
    const apps = await demo.processes("demo-comet");
    expect(apps!.find((p) => p.name === "chrome.exe")!.gpu).toBeUndefined();
  });

  it("logs the RTX only while it's awake: games, never the Radeon's readings at rest", async () => {
    const week = await new DemoClient().history("demo-comet", "7d");
    const games = week.filter((p) => p.game), quiet = week.filter((p) => !p.game && !p.busy);
    expect(games.length).toBeGreaterThan(20);
    expect(games.every((p) => p.gpu != null && p.gpu >= 50)).toBe(true);
    expect(quiet.length).toBeGreaterThan(100);
    expect(quiet.every((p) => p.gpu == null)).toBe(true);
  });
});
