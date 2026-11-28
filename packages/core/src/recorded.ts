// What a recording holds, sensor by sensor, for the Logs screens: every sensor
// the background recorder kept, filed under its part like the live view, or the
// six main readings for a recording that has nothing more.

import type { HistoryPoint, Reading } from "./model";
import type { Recording, RecordingInfo, SensorRef } from "./recordings";
import type { HardwareKind, SensorType } from "./telemetry";
import { isSetting, sensorName } from "./sensors";
import { chipSensorName } from "./limits";

/** One sensor of a recording, filed under a part. */
export interface RecordedSensor extends SensorRef { part: string }

/** A part, with its sensors (as indexes into `sensors`) and the one that leads it: the line beside its name. */
export interface RecordedPart { id: string; name: string; sensors: number[]; lead: number }

/** One reading: a value per sensor, lined up with `sensors`. */
export interface RecordedPoint { t: number; v: (number | null)[] }

export interface Recorded { sensors: RecordedSensor[]; parts: RecordedPart[]; points: RecordedPoint[]; full: boolean }

const partNames: [string, string][] = [["cpu", "Processor"], ["gpu", "Graphics card"], ["ram", "Memory"], ["ssd", "Storage"], ["motherboard", "Motherboard"], ["fans", "Fans"], ["battery", "Battery"]];

/** `chip`: the name the graphics card's sensors carry. A second graphics chip's, a laptop's built-in graphics, are left out, as in the live view. */
function partOf(s: SensorRef, chip?: string | null): string | null {
  if (s.hw === "gpu") return chip === undefined || s.hwName === chip ? "gpu" : null;
  if (s.type === "fan" || s.type === "control" || s.hw === "cooler") return "fans";
  switch (s.hw) {
    case "cpu": return "cpu";
    case "board": return "motherboard";
    case "memory": return "ram";
    default: return null;
  }
}

/** The six readings every recording has, as sensors, for one that has nothing more. */
const main: [keyof Pick<Recording["samples"][number], "cpu" | "gpu" | "cpuLoad" | "gpuLoad" | "mem" | "fan">, SensorRef, string][] = [
  ["cpu", { id: "cpu", hw: "cpu", hwName: "", type: "temperature", name: "Temperature" }, "cpu"],
  ["cpuLoad", { id: "cpuLoad", hw: "cpu", hwName: "", type: "load", name: "Usage" }, "cpu"],
  ["gpu", { id: "gpu", hw: "gpu", hwName: "", type: "temperature", name: "Temperature" }, "gpu"],
  ["gpuLoad", { id: "gpuLoad", hw: "gpu", hwName: "", type: "load", name: "Usage" }, "gpu"],
  ["mem", { id: "mem", hw: "memory", hwName: "", type: "load", name: "In use" }, "ram"],
  ["fan", { id: "fan", hw: "board", hwName: "", type: "fan", name: "Fastest fan" }, "fans"],
];

/** The sensor that stands for a part: its main temperature, else its usage, else its first fan. */
function leadOf(part: string, idx: number[], sensors: RecordedSensor[]): number {
  const of = (type: SensorType, name?: RegExp) => idx.find((i) => sensors[i].type === type && (!name || name.test(sensors[i].name)));
  if (part === "ram") return of("load", /^memory$/i) ?? of("load") ?? idx[0];
  if (part === "fans") return of("fan") ?? idx[0];
  if (part === "gpu") return of("temperature", /core|^gpu$/i) ?? of("temperature") ?? idx[0];
  if (part === "cpu") return of("temperature", /tctl|package|^temperature$/i) ?? of("temperature") ?? idx[0];
  return of("temperature") ?? of("load") ?? idx[0];
}

/** Files sensors under their parts, each part led by its main reading. */
function withParts(sensors: RecordedSensor[], points: RecordedPoint[], full: boolean): Recorded {
  const parts: RecordedPart[] = [];
  for (const [id, name] of partNames) {
    const idx = sensors.map((s, i) => (s.part === id ? i : -1)).filter((i) => i >= 0);
    if (idx.length) parts.push({ id, name, sensors: idx, lead: leadOf(id, idx, sensors) });
  }
  return { sensors, parts, points: points.sort((a, b) => a.t - b.t), full };
}

/** One live reading of a PC: every sensor's value by id, at a moment. */
export interface LiveSample { t: number; vals: Record<string, number> }

const liveHw: Record<string, HardwareKind> = { cpu: "cpu", gpu: "gpu", ram: "memory", ssd: "storage", motherboard: "board", board: "board", fans: "board", battery: "battery" };

/**
 * The PC's live readings in the shape of a recording, so the live charts draw every sensor the way a day of the log
 * does. Sizes (data) are left out, as they don't move. Sensors come from the latest readings, in the order the PC lists them.
 */
export function liveRecorded(readings: readonly Reading[], samples: readonly LiveSample[]): Recorded {
  const keep = readings.filter((r) => r.type !== "data" && liveHw[r.part]);
  const sensors: RecordedSensor[] = keep.map((r) => ({ id: r.id, hw: liveHw[r.part], hwName: "", type: r.type, name: r.name, part: r.part === "board" ? "motherboard" : r.part }));
  const order = sensorOrder(keep);
  const points = samples.map((s) => {
    const made = liveRows.get(s);
    if (made?.order === order) return made.point;
    const point = { t: s.t, v: keep.map((r) => s.vals[r.id] ?? null) };
    liveRows.set(s, { order, point });
    return point;
  });
  return withParts(sensors, points, true);
}

/**
 * Each live reading lined up with the sensors, kept: the Logs page lines up the last hour's readings, about 1,800 of
 * them, on every new one, and only the newest has changed. A reading is lined up again when the sensors change.
 */
const liveRows = new WeakMap<LiveSample, { order: object; point: RecordedPoint }>();
let lastOrder = { ids: "", token: {} };
function sensorOrder(keep: readonly Reading[]): object {
  const ids = keep.map((r) => r.id).join("\n");
  if (ids !== lastOrder.ids) lastOrder = { ids, token: {} };
  return lastOrder.token;
}

/** A recording's readings sensor by sensor. Sensors that never read anything are left out. `chip`: the graphics card's name (PC.parts.gpu.name). */
export function recorded(rec: Pick<Recording, "samples" | "sensors">, chip?: string): Recorded {
  const full = !!rec.sensors?.length && rec.samples.some((s) => s.all);
  let sensors: RecordedSensor[];
  let points: RecordedPoint[];
  if (full) {
    const own = chip == null ? undefined : chipSensorName(rec.sensors, chip) ?? null;
    const keep = rec.sensors!.map((s, i) => [s, i] as const).filter(([s, i]) => partOf(s, own) && !isSetting(s) && rec.samples.some((x) => x.all?.[i] != null));
    sensors = keep.map(([s]) => ({ ...s, name: sensorName(s), part: partOf(s, own)! }));
    points = rec.samples.map((x) => ({ t: x.t, v: keep.map(([, i]) => x.all?.[i] ?? null) }));
  } else {
    const keep = main.filter(([k]) => rec.samples.some((x) => x[k] != null));
    sensors = keep.map(([, s, part]) => ({ ...s, part }));
    points = rec.samples.map((x) => ({ t: x.t, v: keep.map(([k]) => x[k] ?? null) }));
  }
  return withParts(sensors, points, full);
}

/**
 * Several recordings as one, in time order, for a chart that spans days. Each day lists its own sensors, so every
 * reading is lined up again with the sensors of all of them together, matched by id.
 */
export function joinRecordings(recs: readonly Pick<Recording, "samples" | "sensors">[]): Pick<Recording, "samples" | "sensors"> {
  const sensors: SensorRef[] = [];
  const at = new Map<string, number>();
  for (const r of recs) for (const s of r.sensors ?? []) if (!at.has(s.id)) { at.set(s.id, sensors.length); sensors.push(s); }
  const samples = recs.flatMap((r) => {
    const to = (r.sensors ?? []).map((s) => at.get(s.id)!);
    return r.samples.map((x) => {
      if (!x.all) return x;
      const all: (number | null)[] = new Array(sensors.length).fill(null);
      x.all.forEach((v, i) => { if (to[i] != null) all[to[i]] = v; });
      return { ...x, all };
    });
  }).sort((a, b) => a.t - b.t);
  return { samples, sensors: sensors.length ? sensors : undefined };
}

/** The readings a history point keeps, as sensors under their parts. */
const historyKeys: [Exclude<keyof HistoryPoint, "t" | "busy" | "game">, SensorRef, string][] = [
  ["cpu", { id: "cpu", hw: "cpu", hwName: "", type: "temperature", name: "Temperature" }, "cpu"],
  ["cpuLoad", { id: "cpuLoad", hw: "cpu", hwName: "", type: "load", name: "Usage" }, "cpu"],
  ["gpu", { id: "gpu", hw: "gpu", hwName: "", type: "temperature", name: "Temperature" }, "gpu"],
  ["gpuLoad", { id: "gpuLoad", hw: "gpu", hwName: "", type: "load", name: "Usage" }, "gpu"],
  ["mem", { id: "mem", hw: "memory", hwName: "", type: "load", name: "In use" }, "ram"],
  ["drive", { id: "drive", hw: "storage", hwName: "", type: "temperature", name: "Temperature" }, "ssd"],
  ["board", { id: "board", hw: "board", hwName: "", type: "temperature", name: "Temperature" }, "motherboard"],
  ["fan", { id: "fan", hw: "board", hwName: "", type: "fan", name: "Fastest fan" }, "fans"],
];

/** The PC's 10-minute history in the shape of a recording, so a month draws the same way as a day of the log. */
export function historyRecorded(points: readonly HistoryPoint[]): Recorded {
  const keep = historyKeys.filter(([k]) => points.some((p) => p[k] != null));
  const sensors: RecordedSensor[] = keep.map(([, s, part]) => ({ ...s, part }));
  return withParts(sensors, points.map((p) => ({ t: p.t, v: keep.map(([k]) => (p[k] as number | null | undefined) ?? null) })), false);
}

/** A sensor's highest reading between two times, and when. */
export function peakOf(r: Recorded, i: number, from = -Infinity, to = Infinity): { max: number; at: number } | null {
  let best: { max: number; at: number } | null = null;
  for (const p of r.points) {
    if (p.t < from || p.t > to) continue;
    const v = p.v[i];
    if (v != null && (!best || v > best.max)) best = { max: v, at: p.t };
  }
  return best;
}

/** What a log found, as a title: the first thing its headline names. "Nothing unusual" when it found nothing. */
export function logTitle(r: Pick<RecordingInfo, "headline" | "reason">): string {
  const h = (r.headline ?? "").replace(/,? and \d+ more things? to look at\.?$/i, "").replace(/\.$/, "").trim();
  if (!h || /^nothing unusual/i.test(h)) return r.reason.replace(/^Custom log: /, "");
  return h;
}
