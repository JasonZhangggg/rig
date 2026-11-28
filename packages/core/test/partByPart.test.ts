import { describe, expect, it } from "vitest";
import { USUAL_MIN_WINDOWS, partByPart, type HistoryPoint, type Part, type PC, type Reading } from "../src";

const NOW = Date.parse("2026-11-26T21:00:00Z");
const HOUR = 36e5;

const part = (name: string, type: string, more: Partial<Part> = {}): Part => ({ name, type, modelSource: "generic", specs: [], manual: [], ...more });
const reading = (part: string, type: Reading["type"], value: number | null): Reading => ({ id: `${part}/${type}/${value}`, part, name: type, type, value });

/** A tower at the desktop: 41° graphics card, 44° processor, memory a third full. */
function tower(over: { gpu?: number; cpu?: number; gpuLoad?: number; readings?: Reading[]; media?: "nvme" | "hdd" } = {}): PC {
  const { gpu = 41, cpu = 44, gpuLoad = 5 } = over;
  return {
    id: "atlas", name: "Atlas", kind: "tower", accent: "", nickname: "Desktop", os: "", health: 96, lastSync: "", online: true, summary: "",
    parts: {
      cpu: part("AMD Ryzen 7 7800X3D", "Processor and cooler", { temp: cpu, limit: 89, load: 8 }),
      gpu: part("NVIDIA GeForce RTX 4070 SUPER", "Graphics card", { temp: gpu, limit: 88, load: gpuLoad }),
      motherboard: part("MSI MAG B650", "Motherboard", { temp: 34 }),
      ram: part("2 × 16 GB", "Memory", { load: 31 }),
      ssd: part("Samsung SSD 990 PRO 2TB", "Storage", { temp: 40 }),
      fans: part("Case fans", "Cooling"),
      case: part("Your case", "Case"),
      psu: part("Power supply", "Power supply"),
    },
    readings: over.readings ?? [reading("ssd", "temperature", 40), reading("fans", "fan", 820), reading("fans", "fan", 760), reading("gpu", "fan", 0)],
    fans: [{ label: "Fan 1", rpm: 820, max: 2200 }],
    drives: [{ model: "Samsung SSD 990 PRO 2TB", media: over.media ?? "nvme", sizeGb: 2000, volumes: ["C:"], system: true, fills: [], health: { sev: "ok", text: "" }, unknown: [] }],
  };
}

/** Ten-minute windows from `from` hours ago for `hours` hours. */
function windows(from: number, hours: number, p: Partial<HistoryPoint>): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let t = NOW - from * HOUR; t < NOW - (from - hours) * HOUR; t += 10 * 60_000) out.push({ t, cpu: 45, gpu: 40, busy: false, mem: 30, drive: 41, board: 35, fan: 800, ...p });
  return out;
}

const play = (gpu: number, game = "Cyberpunk 2077"): Partial<HistoryPoint> => ({ busy: true, game, gpu, cpu: 62, mem: 45, drive: 52, board: 41, fan: 1900 });

/** A week: desktop time, two evenings of Baldur's Gate 3 at 74–78°, and one of Cyberpunk that touched 86°. */
const week = [
  ...windows(150, 10, {}),
  ...windows(100, 3, play(74, "Baldur's Gate 3")),
  ...windows(75, 3, play(78, "Baldur's Gate 3")),
  ...windows(26, 2, play(77)),
  ...windows(24, 0.5, play(86)),
  ...windows(20, 18, {}),
];

describe("partByPart", () => {
  it("gives each part a row, the parts games lean on first and the ones Rig can't read last", () => {
    const view = partByPart(tower(), week, NOW);
    expect(view.rows.map((r) => r.id)).toEqual(["gpu", "cpu", "ram", "ssd", "motherboard", "fans", "psu", "case"]);
    expect(view.rows.slice(-2).map((r) => [r.state, r.unit, r.now])).toEqual([["unread", null, null], ["unread", null, null]]);
    expect(view.usualWhen).toBe("playing");
    expect(view.busyNow).toBe(false);
  });

  it("reads each part now against the middle of its readings while games ran, and its highest this week", () => {
    const gpu = partByPart(tower(), week, NOW).rows[0];
    expect(gpu).toMatchObject({ unit: "temp", now: 41, usual: { lo: 74, hi: 78 }, limit: 88, state: "calm", ranHot: true });
    expect(gpu.high).toEqual({ value: 86, at: NOW - 24 * HOUR, game: "Cyberpunk 2077" });
    // The scale runs past where the card slows down, so the slow-down zone has room on the track.
    expect(gpu.scale.max).toBeGreaterThan(88);
    const cpu = partByPart(tower(), week, NOW).rows[1];
    expect(cpu).toMatchObject({ now: 44, usual: { lo: 62, hi: 62 }, ranHot: false });
  });

  it("follows memory in percent with no slow-down point, and the fastest fan in rpm, the card's own included", () => {
    const rows = Object.fromEntries(partByPart(tower({ readings: [reading("fans", "fan", 820), reading("gpu", "fan", 1100)] }), week, NOW).rows.map((r) => [r.id, r]));
    expect(rows.ram).toMatchObject({ unit: "percent", now: 31, limit: null, usual: { lo: 45, hi: 45 }, scale: { min: 0, max: 100 } });
    expect(rows.fans).toMatchObject({ unit: "rpm", now: 1100, limit: null, high: { value: 1900 } });
    expect(rows.fans.scale.max).toBeGreaterThanOrEqual(2200);
  });

  it("takes a drive's slow-down point from the kind of drive Windows runs from", () => {
    expect(partByPart(tower(), week, NOW).rows.find((r) => r.id === "ssd")!.limit).toBe(75);
    expect(partByPart(tower({ media: "hdd" }), week, NOW).rows.find((r) => r.id === "ssd")!.limit).toBe(55);
  });

  it("says when a part is above its usual, close to where it slows down, or past it", () => {
    const state = (gpu: number) => partByPart(tower({ gpu, gpuLoad: 99 }), week, NOW).rows[0].state;
    expect(state(80)).toBe("above");
    expect(state(83)).toBe("hot");
    expect(state(88)).toBe("slowing");
    expect(partByPart(tower({ gpu: 80, gpuLoad: 99 }), week, NOW).busyNow).toBe(true);
  });

  it("calls a laptop's processor at its limit under load working as built, not slowing down or running hot", () => {
    const pc = tower();
    const laptop = (temp: number, load: number, more: Partial<PC> = {}): PC => ({
      ...pc, kind: "laptop", ...more,
      parts: { cpu: part("AMD Ryzen 9 8945HS", "Processor", { temp, limit: 95, load }), ram: pc.parts!.ram },
    });
    const cpu = (p: PC, points: HistoryPoint[] = week) => partByPart(p, points, NOW).rows.find((r) => r.id === "cpu")!;
    expect(cpu(laptop(95, 80)).state).toBe("design");
    expect(cpu(laptop(91, 80)).state).toBe("design");
    // At its limit at rest is a cooling fault, and so is losing speed, which Things to look at calls out.
    expect(cpu(laptop(95, 10)).state).toBe("slowing");
    expect(cpu(laptop(95, 80, { issues: [{ id: "cpu-hot", severity: "warn", title: "Processor is slowing down to stay cool", body: "", action: "", go: "chat" }] })).state).toBe("slowing");
    // Its week at the limit in a game isn't running hot; at the limit while idle is.
    const busyPeak = [...windows(30, 10, {}), ...windows(10, 1, { busy: true, game: "Cyberpunk 2077", cpu: 95, cpuLoad: 85 })];
    expect(cpu(laptop(50, 10), busyPeak).ranHot).toBe(false);
    const idlePeak = [...windows(30, 10, {}), ...windows(10, 1, { busy: false, cpu: 95, cpuLoad: 8 })];
    expect(cpu(laptop(50, 10), idlePeak).ranHot).toBe(true);
    // A desktop chip that holds below its limit still slows down there.
    expect(partByPart(tower({ cpu: 89 }), week, NOW).rows.find((r) => r.id === "cpu")!.state).toBe("slowing");
  });

  it("counts now as the week's highest when nothing recorded was higher", () => {
    const gpu = partByPart(tower({ gpu: 90 }), week, NOW).rows[0];
    expect(gpu.high).toEqual({ value: 90, at: NOW, game: null });
    expect(gpu.ranHot).toBe(true);
  });

  it("takes the usual from every window when games ran for under an hour, and has none without history", () => {
    const short = [...windows(30, 10, {}), ...windows(10, (USUAL_MIN_WINDOWS - 1) / 6, play(80))];
    const view = partByPart(tower(), short, NOW);
    expect(view.usualWhen).toBe("any");
    expect(view.rows[0].usual).toEqual({ lo: 40, hi: 40 });
    const none = partByPart(tower(), [], NOW);
    expect(none.usualWhen).toBeNull();
    expect(none.rows[0]).toMatchObject({ usual: null, high: { value: 41, at: NOW }, ranHot: false, state: "calm" });
  });

  it("follows a laptop's battery by its charge, with how low it ran this week, and leaves out the parts Rig never reads", () => {
    const pc = tower();
    const laptop: PC = {
      ...pc, kind: "laptop",
      parts: { cpu: pc.parts!.cpu, board: part("ASUS UX3405MA", "Motherboard", { temp: 44 }), ram: pc.parts!.ram, battery: part("75 Wh battery", "Battery"), chassis: part("Zenbook 14", "Laptop") },
      battery: { level: 58, state: "discharging", watts: 10.9, savers: [] },
    };
    // Plugged in and full most of the week, run down to 31% one afternoon.
    const charged = [...windows(150, 10, { batt: 100 }), ...windows(50, 2, { batt: 31 }), ...windows(20, 18, { batt: 100 })];
    const view = partByPart(laptop, charged, NOW);
    expect(view.rows.map((r) => r.id)).toEqual(["cpu", "ram", "board", "battery"]);
    const battery = view.rows.find((r) => r.id === "battery")!;
    expect(battery).toMatchObject({ unit: "percent", now: 58, usual: { lo: 100, hi: 100 }, high: null, low: { value: 31, at: NOW - 50 * HOUR }, limit: null, state: "calm" });
    expect(battery.scale).toEqual({ min: 0, max: 100 });
    // Lower than usual is no worry for a battery, and above usual can't happen past full.
    expect(partByPart(laptop, windows(30, 20, { batt: 40 }), NOW).rows.find((r) => r.id === "battery")!.state).toBe("calm");
    // A battery Rig can't read now still has its row: it's a part Rig follows.
    const unread = partByPart({ ...laptop, battery: undefined }, [], NOW).rows.find((r) => r.id === "battery")!;
    expect(unread.state).toBe("unread");
    // A tower keeps its case and power supply rows, with nothing on them.
    expect(partByPart(tower(), week, NOW).rows.map((r) => r.id)).toContain("case");
  });

  it("says the usual comes from busy work, not games, when games weren't most of the busy windows", () => {
    const work = [...windows(100, 8, { busy: true, game: null, cpu: 70 }), ...windows(30, 2, play(80))];
    expect(partByPart(tower(), work, NOW).usualWhen).toBe("busy");
    expect(partByPart(tower(), week, NOW).usualWhen).toBe("playing");
  });

  it("leaves out points older than a week or after now", () => {
    const old = windows(9 * 24, 2, play(87));
    const later = [{ t: NOW + HOUR, cpu: 99, gpu: 99, busy: true }];
    expect(partByPart(tower(), [...old, ...week, ...later], NOW).rows[0].high!.value).toBe(86);
  });
});
