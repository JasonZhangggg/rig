// The sensors of one part, read the way a hardware monitor lays them out:
// the processor's cores side by side, and the handful of readings worth a
// glance for each part. Built on PC.readings, which carries the names
// LibreHardwareMonitor gives its sensors.

import type { Reading } from "./model";
import type { SensorType } from "./telemetry";

/** One core of the processor: how busy it is (and each of its threads), its clock, temperature and power, where the chip reports them. */
export interface Core {
  /** "P-core 3", "E-core 1" or "Core 3". */
  label: string;
  load: Reading | null;
  threads: Reading[];
  clock: Reading | null;
  temp: Reading | null;
  power: Reading | null;
}

/** "P-Core #3" → ["P-", 3]; the prefix keeps Intel's performance and efficient cores apart, as each is counted from 1. */
const coreKey = (name: string) => {
  const m = name.match(/(?:^|\s)([PE]-)?Core #(\d+)/i);
  return m ? { key: `${(m[1] ?? "").toUpperCase()}${m[2]}`, kind: (m[1] ?? "").toUpperCase(), n: Number(m[2]) } : null;
};

/**
 * The processor's cores, in order. Load comes from "CPU Core #n" (or its threads, "CPU Core #n Thread #k",
 * averaged when the core itself isn't reported), clock and temperature from "Core #n", power from "Core #n (SMU)".
 * Empty when the processor reports nothing per core.
 */
export function coresOf(readings: readonly Reading[]): Core[] {
  const cores = new Map<string, Core & { kind: string; n: number }>();
  const at = (name: string) => {
    const k = coreKey(name);
    if (!k) return null;
    let c = cores.get(k.key);
    if (!c) cores.set(k.key, c = { kind: k.kind, n: k.n, label: `${k.kind ? `${k.kind}core` : "Core"} ${k.n}`, load: null, threads: [], clock: null, temp: null, power: null });
    return c;
  };
  for (const r of readings) {
    if (r.part !== "cpu" || /max|average|bus/i.test(r.name)) continue;
    const c = at(r.name);
    if (!c) continue;
    if (r.type === "load") (/thread #\d+/i.test(r.name) ? c.threads.push(r) : (c.load = r));
    else if (r.type === "clock" && !/effective/i.test(r.name)) c.clock ??= r;
    else if (r.type === "temperature") c.temp ??= r;
    else if (r.type === "power") c.power ??= r;
  }
  const order = (c: { kind: string }) => (c.kind === "P-" ? 0 : c.kind === "E-" ? 1 : 0);
  return [...cores.values()].filter((c) => c.load || c.threads.length || c.clock || c.temp)
    .sort((a, b) => order(a) - order(b) || a.n - b.n)
    .map(({ kind: _k, n: _n, ...c }) => c);
}

/** How busy a core is now: its own reading, else the average of its threads. */
export function coreLoad(c: Core): number | null {
  if (c.load?.value != null) return c.load.value;
  const xs = c.threads.map((t) => t.value).filter((v): v is number => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** A reading worth a glance: a sensor as it reads, or the highest of several (the hottest core). */
export interface KeyReading { label: string; type: SensorType; value: number; max?: number | null; note?: string }

type Rule = [label: string, type: SensorType, name: RegExp, how?: "max" | "first"];

/** For each part, the readings a hardware monitor's user looks at first, in order. A rule with "max" takes the highest of every match. */
const rules: Record<string, Rule[]> = {
  cpu: [
    ["Package", "temperature", /package|tctl|tdie/i],
    ["Hottest core", "temperature", /^(?:[PE]-)?core #\d+$/i, "max"],
    ["Fastest core", "clock", /^(?:[PE]-)?core #\d+$/i, "max"],
    ["Power", "power", /package/i],
    ["Core voltage", "voltage", /^cpu core$|^core \(svi|vcore/i],
  ],
  gpu: [
    ["Core", "temperature", /^gpu core$|^gpu$|edge/i],
    ["Hot spot", "temperature", /hot ?spot|^gpu junction$/i],
    ["Video memory", "temperature", /memory junction|^gpu memory$|vram/i],
    ["Core clock", "clock", /^gpu core$|^gpu$/i],
    ["Power", "power", /package|board|^gpu power$/i],
    ["Fan", "fan", /fan/i, "max"],
    ["Video memory used", "data", /memory used/i],
  ],
  ram: [
    ["In use", "data", /^memory used$/i],
    ["Available", "data", /^memory available$/i],
  ],
  ssd: [
    ["Temperature", "temperature", /./, "max"],
    ["Life used", "level", /percentage used/i],
    ["Reading", "throughput", /read rate/i],
    ["Writing", "throughput", /write rate/i],
    ["Space used", "load", /used space/i],
  ],
  motherboard: [
    ["Processor socket", "temperature", /^cpu$|cpu socket/i],
    ["Power delivery", "temperature", /vrm|mos/i],
    ["Chipset", "temperature", /pch|chipset/i],
    ["12 V rail", "voltage", /^\+?12v?$|\+12/i],
    ["Core voltage", "voltage", /vcore|cpu core/i],
  ],
  fans: [["Fastest", "fan", /./, "max"]],
};
rules.board = rules.motherboard;

/** The few readings to show at the top of a part's page, from what the part actually reports. */
export function keyReadings(part: string, readings: readonly Reading[]): KeyReading[] {
  const mine = readings.filter((r) => r.part === part && r.value != null);
  return (rules[part] ?? []).flatMap(([label, type, name, how]): KeyReading[] => {
    const hits = mine.filter((r) => r.type === type && name.test(r.name));
    if (!hits.length) return [];
    const top = how === "max" ? hits.reduce((a, r) => (r.value! > a.value! ? r : a)) : hits[0];
    return [{ label, type, value: top.value!, max: top.max, note: how === "max" && hits.length > 1 ? top.name : undefined }];
  });
}

/** The kinds of sensor in the order a hardware monitor groups them, each with its heading. */
export const sensorGroups: readonly (readonly [SensorType, string])[] = [
  ["temperature", "Temperatures"], ["load", "Usage"], ["clock", "Speeds"], ["fan", "Fans"], ["power", "Power"],
  ["voltage", "Voltages"], ["current", "Current"], ["throughput", "Transfer"], ["data", "Data"], ["level", "Levels"], ["control", "Fan control"],
];

/** The kinds of sensor a part reports, in sensorGroups order, with how many of each. */
export function sensorKinds(readings: readonly Reading[]): { type: SensorType; title: string; count: number }[] {
  return sensorGroups.map(([type, title]) => ({ type, title, count: readings.filter((r) => r.type === type).length })).filter((g) => g.count > 0);
}

/** Words a search can use for a part or a kind of sensor, besides the sensor's own name. */
const partWords: Record<string, string> = {
  cpu: "processor cpu", gpu: "graphics card gpu video", ram: "memory ram", ssd: "storage drive disk ssd nvme",
  motherboard: "motherboard board mainboard", board: "motherboard board", fans: "fans cooling", battery: "battery",
};
const kindWords: Record<SensorType, string> = {
  temperature: "temperatures temps heat", load: "usage load use busy utilization", clock: "speeds clocks frequency",
  fan: "fans rpm", power: "power watts", voltage: "voltages volts", current: "current amps", throughput: "transfer rates speeds",
  data: "data size", level: "levels life wear health", control: "fan control duty",
};

const isNum = (w: string) => /^\d+$/.test(w);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The readings a search like "core 3", "hot spot" or "gpu usage" finds: every word starts a word of the sensor's name,
 * its part or its kind. A number has to match whole, right after the word before it, so "core 3" finds Core #3 and its
 * threads but not Core #13, nor Core #1's third thread.
 */
export function findReadings(readings: readonly Reading[], query: string): Reading[] {
  const q = words(query);
  if (!q.length) return [];
  const ok = (w: string, t: string | undefined) => t != null && (isNum(w) ? t === w : t.startsWith(w));
  return readings.filter((r) => {
    const name = words(r.name);
    const about = [...words(partWords[r.part] ?? r.part), ...words(kindWords[r.type] ?? r.type)];
    return q.every((w, i) => isNum(w) && i > 0
      ? name.some((t, j) => ok(w, t) && ok(q[i - 1], name[j - 1]))
      : name.some((t) => ok(w, t)) || about.some((t) => ok(w, t)));
  });
}
