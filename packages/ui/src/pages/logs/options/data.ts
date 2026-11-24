// Preview data for the Logs page options: one day of what Rig's background recorder keeps on the demo PC (Atlas).
// The recorder writes every temperature, load, fan, power and fan-control sensor every 30 seconds, and every
// 5 seconds for a few minutes around anything unusual. Made up, but shaped like a real Sunday: work in the
// afternoon, Counter-Strike 2 twice, the graphics card reaching 89°C and a Discord crash late at night.

export type Unit = "temp" | "percent" | "rpm" | "watt" | "mb";

export interface SensorDef { id: string; part: PartId; name: string; unit: Unit; lead?: boolean }
export type PartId = "cpu" | "gpu" | "ram" | "board" | "fans";

export const parts: { id: PartId; name: string; model: string }[] = [
  { id: "cpu", name: "Processor", model: "AMD Ryzen 7 7800X3D" },
  { id: "gpu", name: "Graphics card", model: "NVIDIA GeForce RTX 4070 SUPER" },
  { id: "ram", name: "Memory", model: "Corsair 32 GB DDR5-6000" },
  { id: "board", name: "Motherboard", model: "MSI MAG B650 TOMAHAWK WIFI" },
  { id: "fans", name: "Fans", model: "Case and cooler fans" },
];

export const sensors: SensorDef[] = [
  { id: "cpu.temp", part: "cpu", name: "CPU (Tctl/Tdie)", unit: "temp", lead: true },
  { id: "cpu.ccd", part: "cpu", name: "CCD1 (Tdie)", unit: "temp" },
  { id: "cpu.load", part: "cpu", name: "Total usage", unit: "percent", lead: true },
  { id: "cpu.coremax", part: "cpu", name: "Busiest core", unit: "percent" },
  { id: "cpu.power", part: "cpu", name: "Package power", unit: "watt", lead: true },
  { id: "gpu.temp", part: "gpu", name: "GPU core", unit: "temp", lead: true },
  { id: "gpu.hot", part: "gpu", name: "Hot spot", unit: "temp" },
  { id: "gpu.mem", part: "gpu", name: "Memory junction", unit: "temp" },
  { id: "gpu.load", part: "gpu", name: "Core usage", unit: "percent", lead: true },
  { id: "gpu.vram", part: "gpu", name: "Video memory used", unit: "percent" },
  { id: "gpu.power", part: "gpu", name: "Board power", unit: "watt", lead: true },
  { id: "gpu.fan", part: "gpu", name: "GPU fans", unit: "rpm" },
  { id: "gpu.fanpct", part: "gpu", name: "GPU fan speed", unit: "percent" },
  { id: "ram.load", part: "ram", name: "Memory in use", unit: "percent", lead: true },
  { id: "ram.a2", part: "ram", name: "DIMM A2", unit: "temp" },
  { id: "ram.b2", part: "ram", name: "DIMM B2", unit: "temp" },
  { id: "board.sys", part: "board", name: "System", unit: "temp", lead: true },
  { id: "board.vrm", part: "board", name: "VRM MOS", unit: "temp" },
  { id: "board.chip", part: "board", name: "Chipset", unit: "temp" },
  { id: "fans.cpu", part: "fans", name: "CPU fan", unit: "rpm", lead: true },
  { id: "fans.sys1", part: "fans", name: "System fan 1", unit: "rpm" },
  { id: "fans.sys2", part: "fans", name: "System fan 2", unit: "rpm" },
  { id: "fans.sys3", part: "fans", name: "System fan 3", unit: "rpm" },
];

export const byId = Object.fromEntries(sensors.map((s) => [s.id, s])) as Record<string, SensorDef>;

/** Safe limits, from the part makers. */
export const limits: Record<string, number> = { "cpu.temp": 89, "gpu.temp": 90, "gpu.hot": 100 };
/** What the recorder watches for: two readings in a row at or over these start a closer look. */
export const watch: Record<string, number> = { "cpu.temp": 95, "gpu.temp": 88 };

const H = 36e5, M = 60_000;
/** Sunday, Nov 22, 2026, midnight. */
export const DAY0 = new Date(2026, 10, 22).getTime();
export const DAY1 = DAY0 + 24 * H;
const at = (h: number, m = 0, s = 0) => DAY0 + h * H + m * M + s * 1000;

export interface Span { from: number; to: number; title: string; kind: "game" | "look" | "work" | "idle" | "recording" }
export interface Moment { t: number; title: string; detail: string; look: boolean; kind: "event" | "look" }

export const games: Span[] = [
  { from: at(14, 2), to: at(16, 4), title: "Counter-Strike 2", kind: "game" },
  { from: at(19, 31), to: at(22, 3), title: "Counter-Strike 2", kind: "game" },
];
export const looks: Span[] = [
  { from: at(21, 36, 45), to: at(21, 48), title: "Graphics card reached 88°C", kind: "look" },
  { from: at(23, 7), to: at(23, 15), title: "Discord crashed", kind: "look" },
];
export const moments: Moment[] = [
  { t: at(21, 41, 45), title: "Graphics card reached 88°C", detail: "During Counter-Strike 2. Rig took a closer look.", look: true, kind: "look" },
  { t: at(23, 12, 5), title: "Discord.exe crashed", detail: "Crash, logged by Application Error. Nothing else was busy.", look: true, kind: "event" },
  { t: at(9, 14), title: "Windows Update installed a driver", detail: "Realtek audio, logged by Windows Update.", look: false, kind: "event" },
];

export interface Point { t: number; detail?: boolean; v: Record<string, number> }

// A small seeded random, so every screenshot is the same.
function rand(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }

/** How busy the PC is at t, 0 to 1, and what kind of busy. */
function activity(t: number): { a: number; game: boolean } {
  const g = games.find((s) => t >= s.from && t <= s.to);
  if (g) return { a: 0.85, game: true };
  const h = (t - DAY0) / H;
  if (h < 8.5) return { a: 0.02, game: false };
  if (h < 12.5) return { a: 0.18, game: false };
  if (h < 14) return { a: 0.08, game: false };
  if (h < 17.5) return { a: 0.3, game: false };
  if (h < 19.5) return { a: 0.12, game: false };
  return { a: 0.14, game: false };
}

/** The day's readings: every 30 seconds, every 5 inside a closer look. */
export const day: Point[] = (() => {
  const r = rand(7);
  const out: Point[] = [];
  const times: { t: number; detail: boolean }[] = [];
  for (let t = DAY0; t < DAY1; t += 30_000) if (!looks.some((l) => t > l.from && t < l.to)) times.push({ t, detail: false });
  for (const l of looks) for (let t = l.from; t <= l.to; t += 5000) times.push({ t, detail: true });
  times.sort((a, b) => a.t - b.t);
  // Temperatures follow load with a lag, so carry a smoothed heat level.
  let heat = 0.02, gheat = 0;
  let prevT = DAY0;
  for (const { t, detail } of times) {
    const { a, game } = activity(t);
    const n = () => r() - 0.5;
    const dt = Math.max(5000, t - prevT); prevT = t;
    const k = 1 - Math.exp(-dt / (3 * M));
    const spike = !game && a > 0.2 && r() < 0.08 ? 0.5 : 0; // a build or an export now and then
    const load = Math.min(1, a + spike + n() * 0.12);
    heat += (load - heat) * k;
    // In the late game the round gets heavier: the graphics card climbs to 89°C around 9:43.
    const late = t > at(21, 20) && t < at(21, 50) ? Math.max(0, 1 - Math.abs(t - at(21, 43, 30)) / (10 * M)) : 0;
    const gload = game ? Math.min(99, 84 + n() * 6 + late * 12) : Math.max(0, a * 18 + n() * 4);
    gheat += (gload / 100 - gheat) * k;
    const crash = t >= at(23, 12, 5) && t < at(23, 12, 40);
    const v: Record<string, number> = {};
    v["cpu.load"] = clamp(load * (game ? 52 : 70) + 3 + n() * 3, 1, 100);
    v["cpu.coremax"] = clamp(v["cpu.load"] * 1.9 + 6 + n() * 8, 2, 100);
    v["cpu.temp"] = 41 + heat * (game ? 38 : 30) + n() * 1.6;
    v["cpu.ccd"] = v["cpu.temp"] - 3 - r() * 1.5;
    v["cpu.power"] = 24 + load * (game ? 58 : 66) + n() * 4;
    v["gpu.load"] = crash ? 0 : clamp(gload, 0, 99);
    v["gpu.temp"] = 36 + gheat * 41 + late * 15 + n() * 0.6;
    v["gpu.hot"] = v["gpu.temp"] + 3 + gheat * 4 + n();
    v["gpu.mem"] = v["gpu.temp"] + 6 + gheat * 4 + n() * 0.8;
    v["gpu.vram"] = game ? 58 + n() * 4 : 14 + a * 20 + n() * 2;
    v["gpu.power"] = 11 + (v["gpu.load"] / 100) * 196 + late * 12 + n() * 5;
    const gfan = gheat < 0.28 ? 0 : 30 + (gheat - 0.28) * 70 + late * 14;
    v["gpu.fanpct"] = clamp(gfan, 0, 100);
    v["gpu.fan"] = gfan === 0 ? 0 : 900 + gfan * 14 + n() * 30;
    v["ram.load"] = game ? 61 + n() * 3 : 24 + a * 40 + n() * 2;
    v["ram.a2"] = 37 + heat * 12 + n() * 0.6;
    v["ram.b2"] = v["ram.a2"] - 1.2;
    v["board.sys"] = 30 + heat * 6 + gheat * 4 + n() * 0.4;
    v["board.vrm"] = 39 + heat * 18 + n() * 0.8;
    v["board.chip"] = 47 + heat * 6 + gheat * 3 + n() * 0.5;
    v["fans.cpu"] = 640 + heat * 820 + n() * 25;
    for (const [i, f] of ["fans.sys1", "fans.sys2", "fans.sys3"].entries()) v[f] = 780 + (heat + gheat) * 220 - i * 30 + n() * 15;
    for (const k2 of Object.keys(v)) v[k2] = Math.round(v[k2] * 10) / 10;
    out.push({ t, detail, v });
  }
  return out;
})();

// The first moment sits where the hot spot actually peaked.
// The closer look starts at the second reading in a row at or over 88°C, as the recorder's watch does.
moments[0].t = day.find((p, i) => i > 0 && p.t > at(21, 30) && p.v["gpu.temp"] >= 88 && day[i - 1].v["gpu.temp"] >= 88)?.t ?? moments[0].t;

/** A custom log Rig's chat set up after Discord crashed: Discord's memory and processor use every 10 seconds while it runs. */
export const discordLog = {
  label: "Discord's memory and processor use",
  by: "chat" as const,
  started: at(-2, 50),
  ends: DAY0 + 14 * 24 * H,
  every: 10,
  points: ((): Point[] => {
    const r = rand(11);
    const out: Point[] = [];
    for (let t = at(17, 0); t <= at(23, 59); t += 10_000) {
      if (t > at(23, 12, 5) && t < at(23, 13, 30)) continue; // not running
      const fresh = t >= at(23, 13, 30);
      const grow = fresh ? (t - at(23, 13, 30)) / (6 * H) : (t - at(17, 0)) / (at(23, 12) - at(17, 0));
      const mem = fresh ? 310 + grow * 120 + (r() - 0.5) * 10 : 360 + grow * grow * 1580 + (r() - 0.5) * 18;
      const cpu = Math.max(0.2, 1.4 + (r() - 0.5) * 1.6 + (games.some((g) => t >= g.from && t <= g.to) ? 2.5 : 0));
      out.push({ t, v: { mem: Math.round(mem), cpu: Math.round(cpu * 10) / 10 } });
    }
    return out;
  })(),
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export interface Stat { min: number; avg: number; max: number; maxAt: number; now: number }

/** Lowest, average and highest of one sensor between two times. */
export function stat(id: string, from = DAY0, to = DAY1, points = day): Stat {
  let min = Infinity, max = -Infinity, sum = 0, n = 0, maxAt = from, now = 0;
  for (const p of points) {
    if (p.t < from || p.t > to) continue;
    const v = p.v[id];
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) { max = v; maxAt = p.t; }
    sum += v; n++; now = v;
  }
  return { min, avg: n ? sum / n : 0, max, maxAt, now };
}

/** The reading nearest to t. */
export function nearest(t: number, points: readonly Point[] = day): Point {
  let best = points[0];
  for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}

export function fmt(unit: Unit, v: number | null | undefined, temp: (c: number) => string): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (unit === "temp") return temp(v);
  if (unit === "percent") return `${Math.round(v)}%`;
  if (unit === "watt") return `${Math.round(v)} W`;
  if (unit === "mb") return v >= 1000 ? `${(v / 1000).toFixed(1)} GB` : `${Math.round(v)} MB`;
  return Math.round(v).toLocaleString("en-US") + " rpm";
}

export const clock = (t: number, seconds = false) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
export const span = (from: number, to: number) => {
  const m = Math.round((to - from) / M);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
};

/** The recorder's status line. */
export const recorder = { days: 30, size: "41 MB", every: "30 seconds", close: "5 seconds" };
