// What a recording holds, sensor by sensor, for the Logs screens: every sensor
// the background recorder kept, filed under its part like the live view, or the
// six main readings for a recording that has nothing more.

import type { Recording, RecordingInfo, SensorRef } from "./recordings";
import type { SensorType } from "./telemetry";

/** One sensor of a recording, filed under a part. */
export interface RecordedSensor extends SensorRef { part: string }

/** A part, with its sensors (as indexes into `sensors`) and the one that leads it: the line beside its name. */
export interface RecordedPart { id: string; name: string; sensors: number[]; lead: number }

/** One reading: a value per sensor, lined up with `sensors`. */
export interface RecordedPoint { t: number; v: (number | null)[] }

export interface Recorded { sensors: RecordedSensor[]; parts: RecordedPart[]; points: RecordedPoint[]; full: boolean }

const partNames: [string, string][] = [["cpu", "Processor"], ["gpu", "Graphics card"], ["ram", "Memory"], ["motherboard", "Motherboard"], ["fans", "Fans"]];

function partOf(s: SensorRef): string | null {
  if (s.hw === "gpu") return "gpu";
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

/** A recording's readings sensor by sensor. Sensors that never read anything are left out. */
export function recorded(rec: Pick<Recording, "samples" | "sensors">): Recorded {
  const full = !!rec.sensors?.length && rec.samples.some((s) => s.all);
  let sensors: RecordedSensor[];
  let points: RecordedPoint[];
  if (full) {
    const keep = rec.sensors!.map((s, i) => [s, i] as const).filter(([s, i]) => partOf(s) && rec.samples.some((x) => x.all?.[i] != null));
    sensors = keep.map(([s]) => ({ ...s, part: partOf(s)! }));
    points = rec.samples.map((x) => ({ t: x.t, v: keep.map(([, i]) => x.all?.[i] ?? null) }));
  } else {
    const keep = main.filter(([k]) => rec.samples.some((x) => x[k] != null));
    sensors = keep.map(([, s, part]) => ({ ...s, part }));
    points = rec.samples.map((x) => ({ t: x.t, v: keep.map(([k]) => x[k] ?? null) }));
  }
  const parts: RecordedPart[] = [];
  for (const [id, name] of partNames) {
    const idx = sensors.map((s, i) => (s.part === id ? i : -1)).filter((i) => i >= 0);
    if (idx.length) parts.push({ id, name, sensors: idx, lead: leadOf(id, idx, sensors) });
  }
  return { sensors, parts, points: points.sort((a, b) => a.t - b.t), full };
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
