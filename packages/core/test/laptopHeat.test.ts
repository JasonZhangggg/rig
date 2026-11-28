// Laptops run their processor at its limit under load by design. Rig only calls that a problem when it's real
// trouble (hot at rest, or losing real speed), and its advice fits a laptop: vents, a hard surface, dust in the fan.
import { describe, expect, it } from "vitest";
import {
  boostsToLimit, buildPC, emptyAlertState, findings, mobileChip, score, slowOrLoud, stepAlerts,
  type Alert, type Inventory, type Sensor, type Snapshot,
} from "../src";
import { fixtures } from "../src/demo";

const NOW = Date.UTC(2026, 10, 20, 20, 0);
const MIN = 60_000;

// The graphics sensors carry the dedicated chip's name, as LibreHardwareMonitor reports them, so Rig matches them to it.
const RTX = "NVIDIA GeForce RTX 4080 Laptop GPU";

/** A gaming laptop: Intel's 14th gen HX chip and an NVIDIA laptop graphics chip beside the built-in one. */
function gamingLaptop(): Inventory {
  const inv = structuredClone(fixtures.pebble.inv);
  inv.machine = { ...inv.machine, manufacturer: "Lenovo", model: "Legion Pro 7i", hostname: "Legion" };
  inv.cpu = { name: "Intel(R) Core(TM) i9-14900HX", cores: 24, threads: 32, maxClockMhz: 2200 };
  inv.gpus = [
    { name: "Intel(R) UHD Graphics", vendor: "intel", integrated: true },
    { name: RTX, vendor: "nvidia", vramMb: 12288, integrated: false },
  ];
  return inv;
}

const sensor = (hw: Sensor["hw"], type: Sensor["type"], name: string, value: number, max: number | null = null): Sensor =>
  ({ id: `/${hw}/0/${type}/${name}`, hw, hwName: hw === "gpu" ? RTX : hw, type, name, value, min: null, max });

/** Readings at a moment: processor temperature and load, its cores' clocks now and the fastest they've run, the graphics and two laptop fans. */
function reading(o: { cpu: number; load: number; ghz?: number; topGhz?: number; gpu?: number; gpuLoad?: number }): Snapshot {
  const now = (o.ghz ?? 4.6) * 1000, top = (o.topGhz ?? 5.6) * 1000;
  return {
    at: NOW, elevated: true, game: null,
    sensors: [
      sensor("cpu", "temperature", "CPU Package", o.cpu),
      sensor("cpu", "load", "CPU Total", o.load),
      ...Array.from({ length: 8 }, (_, i) => sensor("cpu", "clock", `CPU Core #${i + 1}`, now - i * 50, top - i * 50)),
      sensor("cpu", "clock", "Bus Speed", 100, 100),
      sensor("gpu", "temperature", "GPU Core", o.gpu ?? 70),
      sensor("gpu", "load", "GPU Core", o.gpuLoad ?? 30),
      sensor("cooler", "fan", "Fan #1", 4900, 5400),
      sensor("cooler", "fan", "Fan #2", 4850, 5400),
    ],
  };
}

const fs = (inv: Inventory, s: Snapshot) => findings({ inv, snap: s, facts: null, now: NOW });
const heat = (inv: Inventory, s: Snapshot) => fs(inv, s).filter((f) => f.category === "Temperatures");
/** Words a laptop owner can't act on: a desktop's cooler, pump and case. */
const DESKTOP_ONLY = /cooler's fan|pump|cooler that came loose|intake filters|case's filters|case airflow|case fan|riser|power cables/i;

describe("which processors are laptop chips", () => {
  it("knows Intel's and AMD's laptop chips by name, and not desktop chips", () => {
    for (const name of [
      "Intel(R) Core(TM) i9-14900HX", "13th Gen Intel(R) Core(TM) i7-13700H", "12th Gen Intel(R) Core(TM) i7-1255U", "Intel(R) Core(TM) i7-1165G7",
      "Intel(R) Core(TM) Ultra 7 155H", "Intel(R) Core(TM) Ultra 7 258V", "Intel(R) Core(TM) Ultra 9 275HX", "Intel(R) Core(TM) 7 150U",
      "AMD Ryzen 9 7945HX with Radeon Graphics", "AMD Ryzen 7 7840HS w/ Radeon 780M Graphics", "AMD Ryzen 5 7530U with Radeon Graphics",
      "AMD Ryzen 7 PRO 7840U w/ Radeon 780M Graphics", "AMD Ryzen AI 9 HX 370 w/ Radeon 890M",
    ]) {
      expect(mobileChip(name), name).toBe(true);
      expect(boostsToLimit(name), name).toBe(true);
    }
    for (const name of ["13th Gen Intel(R) Core(TM) i9-13900K", "Intel(R) Core(TM) i5-12400F", "Intel(R) Core(TM) Ultra 9 285K", "AMD Ryzen 9 7950X 16-Core Processor", "AMD Ryzen 7 5700G with Radeon Graphics", "AMD Ryzen 7 7800X3D 8-Core Processor"]) {
      expect(mobileChip(name), name).toBe(false);
    }
    // Any processor in a laptop, whatever its name.
    expect(boostsToLimit("Some Future Processor", "laptop")).toBe(true);
    expect(boostsToLimit("AMD Ryzen 7 7800X3D 8-Core Processor", "tower")).toBe(false);
  });
});

describe("a gaming laptop at its limit", () => {
  it("finds nothing wrong when it works at its limit under load and keeps its speed", () => {
    const inv = gamingLaptop();
    const s = reading({ cpu: 100, load: 92, ghz: 4.4 });
    expect(heat(inv, s)).toEqual([]);
    expect(score(true, fs(inv, s)).breakdown.find((b) => b.label === "Temperatures")).toMatchObject({ sev: "ok", value: 100, note: "Within normal range" });
    // Working at half load just under its limit isn't "warm" on a laptop either.
    expect(heat(inv, reading({ cpu: 95, load: 45 }))).toEqual([]);
  });

  it("explains throttling in plain words once it loses real speed at its limit", () => {
    const f = heat(gamingLaptop(), reading({ cpu: 100, load: 95, ghz: 1.8, topGhz: 5.6 }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "cpu-hot", severity: "warn", part: "cpu", title: "Processor is slowing down to stay cool" });
    expect(f[0].body).toBe("It's at its 100°C limit and has dropped to 1.8 GHz, from 5.6 GHz. This is called throttling: it slows itself down to stay safe, so apps and games run slower. Keep the vents clear and use it on a hard, flat surface. If it started lately, dust in the fan is the usual cause.");
    expect(f[0].evidence).toContain("Fastest core 1.8 GHz, up to 5.6 GHz earlier");
  });

  it("still calls it out at rest, with a laptop's causes", () => {
    const f = heat(gamingLaptop(), reading({ cpu: 100, load: 8, ghz: 4.8 }));
    expect(f[0]).toMatchObject({ id: "cpu-hot", severity: "bad", title: "Processor is at its 100°C limit while barely working" });
    expect(f[0].body).toMatch(/dust in the fan, vents blocked by a soft surface, or a fan that stopped/);
    expect(f[0].body).not.toMatch(DESKTOP_ONLY);
    const warm = heat(gamingLaptop(), reading({ cpu: 94, load: 10 }))[0];
    expect(warm.id).toBe("cpu-warm");
    expect(warm.body).toMatch(/Check that the vents are clear and the fan spins\.$/);
  });

  it("gives the graphics a laptop's advice at their limit", () => {
    const f = heat(gamingLaptop(), reading({ cpu: 80, load: 50, gpu: 89, gpuLoad: 99 })).find((x) => x.id === "gpu-hot")!;
    expect(f.body).toBe("It's at 89°C and will lower its speed to cool off, which is called throttling. Dust in the fans or blocked vents is the usual cause. Keep it on a hard, flat surface.");
  });

  it("keeps a desktop's own words", () => {
    const desk = structuredClone(fixtures.atlas.inv);
    const gpu = heat(desk, reading({ cpu: 60, load: 50, gpu: 89, gpuLoad: 99 })).find((x) => x.id === "gpu-hot")!;
    expect(gpu.body).toMatch(/Dust on the intake filters is the usual cause\.$/);
    desk.cpu.name = "AMD Ryzen 9 7950X 16-Core Processor";
    expect(heat(desk, reading({ cpu: 95, load: 8 }))[0].body).toMatch(/Check that the cooler's fan spins\.$/);
  });
});

describe("the too-hot alert on a laptop", () => {
  const run = (inv: Inventory, s: Snapshot) => {
    let state = emptyAlertState(), alerts: Alert[] = [];
    for (let t = NOW; t <= NOW + 3 * MIN; t += 10_000) ({ state, alerts } = stepAlerts(state, { inv, snap: { ...s, at: t }, history: [], now: t }));
    return alerts;
  };

  it("stays quiet while the processor works at its limit at full speed", () => {
    expect(run(gamingLaptop(), reading({ cpu: 100, load: 95 }))).toEqual([]);
  });

  it("alerts once it loses real speed there, and says what to do on a laptop", () => {
    const [a] = run(gamingLaptop(), reading({ cpu: 100, load: 95, ghz: 1.6, topGhz: 5.6 }));
    expect(a).toMatchObject({ id: "too-hot:cpu", title: "Processor is staying at its 100°C limit" });
    expect(a.detail).toBe("It's at 100°C, so it slows itself down to cool off, which is called throttling. It's down to 1.6 GHz, from 5.6 GHz. Keep the vents clear and use it on a hard, flat surface.");
  });

  it("points the graphics at the vents, not a case's filters", () => {
    const a = run(gamingLaptop(), reading({ cpu: 80, load: 50, gpu: 90, gpuLoad: 99 })).find((x) => x.id === "too-hot:gpu")!;
    expect(a.detail).toBe("It's at 90°C, so it slows itself down to cool off, which is called throttling. Dust in the fans or blocked vents is the usual cause.");
  });
});

describe("why a laptop is slow or loud", () => {
  const ask = (s: Snapshot) => {
    const { findings: _f, ...pc } = buildPC(gamingLaptop(), s, structuredClone(fixtures.pebble.facts), { name: "Legion" });
    return slowOrLoud({ pc, processes: [{ name: "Blender.exe", cpu: 88, memMb: 3000 }], now: NOW });
  };
  const words = (a: ReturnType<typeof slowOrLoud>) => [a.headline, ...a.causes.flatMap((c) => [c.title, c.why ?? "", c.step.kind === "issue" ? c.step.issue.body : ""])].join("\n");

  it("says the processor is working at its limit as built, after what keeps it busy", () => {
    const a = ask(reading({ cpu: 100, load: 95 }));
    expect(a.headline).toBe("The fans are loud. Here's why.");
    const lim = a.causes.find((c) => c.id === "cpu-limit")!;
    expect(lim.title).toBe("Processor is working at its 100°C limit");
    expect(lim.why).toBe("Laptop processors are built to run up to their limit under load. There they slow down a little to stay safe, which is called throttling, and the fans run fast. That's normal.");
    expect(lim.step).toMatchObject({ kind: "ask", label: "Ask about it" });
    expect(words(a)).not.toMatch(DESKTOP_ONLY);
  });

  it("leads with the throttling finding once it loses real speed", () => {
    const a = ask(reading({ cpu: 100, load: 95, ghz: 1.6, topGhz: 5.6 }));
    const lim = a.causes.find((c) => c.id === "cpu-limit")!;
    expect(lim.title).toBe("Processor is at its 100°C limit");
    expect(lim.step).toMatchObject({ kind: "issue", issue: { id: "cpu-hot", title: "Processor is slowing down to stay cool" } });
    expect(words(a)).not.toMatch(DESKTOP_ONLY);
  });

  it("names a laptop's causes when it's hot at rest", () => {
    const a = ask(reading({ cpu: 100, load: 6 }));
    expect(a.causes[0].id).toBe("cpu-hot-rest");
    expect(a.headline).toBe("The fans are loud. Here's the likely reason.");
    expect(a.causes[0].why).toMatch(/dust in the fan, vents blocked by a soft surface, or a fan that stopped/);
    expect(words(a)).not.toMatch(DESKTOP_ONLY);
  });

  it("points the graphics at the vents", () => {
    const a = ask(reading({ cpu: 80, load: 50, gpu: 89, gpuLoad: 99 }));
    expect(a.causes.find((c) => c.id === "gpu-limit")!.why).toBe("At its limit it gives up some speed to stay safe, which is called throttling, and its fans run flat out. Dust in the fans or blocked vents is the usual cause.");
    expect(words(a)).not.toMatch(DESKTOP_ONLY);
  });
});

describe("other laptop advice", () => {
  it("gives hot graphics memory and a hot drive a laptop's advice", () => {
    const inv = gamingLaptop();
    const s = reading({ cpu: 70, load: 50, gpu: 80, gpuLoad: 95 });
    s.sensors.push(sensor("gpu", "temperature", "GPU Memory Junction", 104), { ...sensor("storage", "temperature", "Temperature", 80), hwName: inv.disks[0].model });
    const all = fs(inv, s);
    expect(all.find((f) => f.id === "gpu-vram-hot")!.body).toBe("Its memory chips slow down at about 110°C. Clear vents and a hard, flat surface under the laptop help.");
    expect(all.find((f) => f.id === `disk-hot-${inv.disks[0].model}`)!.body).toBe("It slows itself down when it gets this hot. Keep the vents clear and use the laptop on a hard, flat surface.");
    expect(all.map((f) => f.body).join("\n")).not.toMatch(DESKTOP_ONLY);
  });

  it("sends a worn battery to the battery's own replacement, not the Upgrades page", () => {
    const inv = gamingLaptop();
    inv.battery = { designWh: 99, fullWh: 62, cycles: 640 };
    const f = fs(inv, reading({ cpu: 60, load: 20 })).find((x) => x.id === "battery")!;
    expect(f).toMatchObject({ part: "battery", go: "pc", tab: "upgrade", action: "See replacement" });
  });
});
