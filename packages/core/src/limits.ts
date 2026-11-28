// Safe temperature limits and which sensor stands for a part. Getting these
// right is most of what keeps Rig's temperature checks from crying wolf: a
// limit that's too low warns about a healthy PC, and the wrong sensor (an
// offset Tctl, a hot spot) reads 10 to 20 degrees off.

import type { Inventory, PCKind, Sensor, Snapshot } from "./telemetry";

/**
 * The first sensor of this hardware and type whose name matches a pattern, trying the patterns in order. With `chip`,
 * only that chip's sensors count (see onChip).
 */
export function pickSensor(s: Snapshot | null | undefined, hw: Sensor["hw"], type: Sensor["type"], prefer: readonly RegExp[], skip?: RegExp, chip?: string): Sensor | undefined {
  const name = chipOf(s, chip);
  const list = s?.sensors.filter((x) => x.hw === hw && x.type === type && x.value != null && !(skip && skip.test(x.name)) && onChip(x, name)) ?? [];
  for (const re of prefer) {
    const hit = list.find((x) => re.test(x.name));
    if (hit) return hit;
  }
  return list[0];
}

/** Readings that are temperatures but not the part's own: Intel's distance to its limit, and per-core or per-chiplet figures. */
const NOT_CPU = /distance|tjmax/i;
/** Hot spot and memory temperatures run well above the core, and have limits of their own. */
const NOT_GPU = /hot ?spot|junction|memory|vram|mem\b|vr\b|vrm/i;

/**
 * The processor's temperature. Package first on Intel. On Ryzen, Tdie before
 * Tctl: older Ryzen X chips add 10 to 20 degrees to Tctl on purpose, and
 * LibreHardwareMonitor reports both separately there.
 */
export const cpuTemp = (s: Snapshot | null) =>
  pickSensor(s, "cpu", "temperature", [/^cpu package$|^package$/i, /^core \(tdie\)$/i, /^core \(tctl\/tdie\)$/i, /tdie/i, /tctl/i, /^core max$/i, /average/i], NOT_CPU);

// ----- Which graphics chip -----
// A laptop with two graphics chips reports both: the one built into the processor (Intel, or a Radeon on Ryzen) and
// the dedicated one (an NVIDIA RTX or a Radeon RX). LibreHardwareMonitor lists AMD's before NVIDIA's, so on a Ryzen
// laptop the first "gpu" sensor is the built-in chip's. Every graphics reading is matched to its chip by name.

/** A chip's name as Windows and LibreHardwareMonitor both write it, give or take the (R) and (TM) marks and the case. */
const chipKey = (name: string) => name.toLowerCase().replace(/\((r|tm)\)|®|™/g, " ").replace(/\s+/g, " ").trim();

/** The same graphics chip, though Windows says "AMD Radeon(TM) 780M Graphics" and the sensors "AMD Radeon 780M Graphics". */
export const sameChip = (a: string, b: string) => chipKey(a) === chipKey(b);

/** The name this chip's sensors carry, when any of them are there. Never another chip's. */
export function chipSensorName(sensors: readonly Pick<Sensor, "hw" | "hwName">[] | undefined, chip: string): string | undefined {
  return (sensors ?? []).find((x) => x.hw === "gpu" && sameChip(x.hwName, chip))?.hwName;
}

/** What `chip` matches sensors by: its sensors' name, null for none, undefined for any chip. */
const chipOf = (s: Snapshot | null | undefined, chip: string | undefined) => (chip == null ? undefined : chipSensorName(s?.sensors, chip) ?? null);

/** A sensor belongs to the chip. Without a chip, every sensor does: a snapshot read on its own, or a PC with one chip. */
const onChip = (x: Sensor, name: string | null | undefined) => name === undefined || x.hw !== "gpu" || x.hwName === name;

/**
 * The chip Rig shows as the graphics card: the dedicated one when there is one, else a desktop's built-in graphics.
 * Undefined on a laptop with only built-in graphics, which has no graphics card to show.
 */
export function graphicsCard(inv: Pick<Inventory, "gpus" | "machine">): Inventory["gpus"][number] | undefined {
  const gpu = inv.gpus.find((g) => !g.integrated) ?? inv.gpus[0];
  return gpu && (inv.machine.kind !== "laptop" || !gpu.integrated) ? gpu : undefined;
}

/**
 * The name to match the graphics card's readings by, the `chip` the readers below take. Only a PC with more than one
 * graphics chip needs one: with one, every graphics reading is the card's, however its sensors name it.
 */
export function cardChip(inv: Pick<Inventory, "gpus" | "machine">): string | undefined {
  return inv.gpus.length > 1 ? graphicsCard(inv)?.name : undefined;
}

/** The drive Rig shows as the PC's drive, on Home, its own page and in Logs: its first NVMe drive, or its first drive. */
export function mainDrive<D extends Inventory["disks"][number]>(inv: { disks: readonly D[] }): D | undefined {
  return inv.disks.find((d) => d.media === "nvme") ?? inv.disks[0];
}

/**
 * A drive's own temperature: the sensor the drive itself calls its temperature (an NVMe drive's composite, the one its
 * slow-down point is set against), else its first. Never the hottest of its sensors, which is often the controller's.
 */
export function driveTemp(s: Snapshot | null | undefined, model: string): Sensor | undefined {
  const key = model.trim().toLowerCase();
  const mine = (s?.sensors ?? []).filter((x) => x.hw === "storage" && x.type === "temperature" && x.value != null && x.hwName.trim().toLowerCase() === key);
  return mine.find((x) => /^(composite |)temperature$/i.test(x.name)) ?? mine[0];
}

/**
 * The one temperature Rig gives the PC's drive, everywhere it gives one: Home, the drive's own page, Logs and the
 * recorded history. `model` is mainDrive's; when its sensors go by another name, the first drive that reports one.
 */
export function mainDriveTemp(s: Snapshot | null | undefined, model: string | undefined): Sensor | undefined {
  const own = model ? driveTemp(s, model) : undefined;
  if (own) return own;
  const first = s?.sensors.find((x) => x.hw === "storage" && x.type === "temperature" && x.value != null);
  return first && driveTemp(s, first.hwName);
}

/** The graphics card's temperature. With `chip` (cardChip), that chip's own; nothing when it has none, never another chip's. */
export const gpuTemp = (s: Snapshot | null, chip?: string) =>
  pickSensor(s, "gpu", "temperature", [/^gpu core$/i, /^gpu$/i, /edge/i, /core/i], NOT_GPU, chip);

/** The graphics card's hottest spot, where it reports one. */
export const gpuHotSpot = (s: Snapshot | null, chip?: string) => {
  const name = chipOf(s, chip);
  return s?.sensors.find((x) => x.hw === "gpu" && x.type === "temperature" && x.value != null && onChip(x, name) && /hot ?spot|junction/i.test(x.name) && !/memory/i.test(x.name));
};

/** The graphics card's memory chips (GDDR6X reports this as Memory Junction). */
export const gpuMemTemp = (s: Snapshot | null, chip?: string) => {
  const name = chipOf(s, chip);
  return s?.sensors.find((x) => x.hw === "gpu" && x.type === "temperature" && x.value != null && onChip(x, name) && /memory/i.test(x.name));
};

/** One of the graphics card's readings: the first of that type with a reading whose name matches, on that chip when one is named. */
export function gpuSensor(s: Snapshot | null | undefined, type: Sensor["type"], name?: RegExp, chip?: string): Sensor | undefined {
  const own = chipOf(s, chip);
  return s?.sensors.find((x) => x.hw === "gpu" && x.type === type && x.value != null && onChip(x, own) && (!name || name.test(x.name)));
}

/** How hard the graphics card works, in percent: its core, or Windows' 3D engine where that's all it reports. */
export const gpuLoad = (s: Snapshot | null | undefined, chip?: string) => gpuSensor(s, "load", /core|d3d 3d/i, chip);

/**
 * The chip is switched off to save power: it's there, but it has no temperature to report. A laptop's dedicated
 * chip sleeps whenever nothing needs it, so on a laptop that's the usual state at rest, not a missing sensor.
 */
export function gpuAsleep(s: Snapshot | null | undefined, chip: string): boolean {
  const own = s?.sensors.filter((x) => x.hw === "gpu" && sameChip(x.hwName, chip)) ?? [];
  return own.some((x) => x.type === "temperature") && !own.some((x) => x.type === "temperature" && x.value != null);
}

/**
 * The processor's own limit, from Intel's "Distance to TjMax" readings: the
 * core temperature plus its distance to the limit. Null on AMD, which doesn't
 * report one, or when the readings don't add up to a believable limit.
 */
export function tjMax(s: Snapshot | null | undefined): number | null {
  const cpu = s?.sensors.filter((x) => x.hw === "cpu" && x.type === "temperature" && x.value != null) ?? [];
  const sums: number[] = [];
  for (const d of cpu) {
    const m = /^(.*?)\s*distance to tjmax$/i.exec(d.name);
    if (!m) continue;
    const core = cpu.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
    if (core) sums.push(Math.round(core.value! + d.value!));
  }
  if (!sums.length) return null;
  const counts = new Map<number, number>();
  for (const v of sums) counts.set(v, (counts.get(v) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  return best >= 80 && best <= 115 ? best : null;
}

/**
 * The highest temperature a processor is meant to reach, in °C. The chip's own
 * report wins (see tjMax); otherwise it comes from the name, using each
 * maker's published limit.
 */
export function cpuLimit(name: string, snap?: Snapshot | null): number {
  const own = tjMax(snap);
  if (own != null) return own;
  if (/AMD|Ryzen|Threadripper|EPYC/i.test(name)) {
    if (/X3D/i.test(name)) return /\b9\d{3}X3D/i.test(name) ? 95 : /\b5\d{3}X3D/i.test(name) ? 90 : 89;
    // Ryzen 5000 desktop chips with eight or more cores: 90°C. The 5600X and the 7000 and 9000 series: 95°C.
    if (/Ryzen \d+ 5[789]\d0X\b/i.test(name)) return 90;
    return 95;
  }
  if (/Core\(?T?M?\)? Ultra|Core Ultra/i.test(name)) {
    if (/\b1\d{2}[A-Z]*\b/.test(name.replace(/.*Ultra\s+\d+\s+/i, " "))) return 110; // Meteor Lake
    if (/\b2\d{2}V\b/i.test(name)) return 100; // Lunar Lake
    return 105; // Arrow Lake
  }
  return 100;
}

/** The graphics core's limit: AMD's edge reading and Intel Arc cards run to about 100°C, NVIDIA's cards start slowing near 88°C. */
export function gpuLimit(vendor: string): number {
  return vendor === "amd" ? 100 : vendor === "intel" ? 95 : 88;
}

/** The hot spot's limit: AMD and Intel cards slow down at 110°C, NVIDIA's at about 105°C. */
export function hotSpotLimit(vendor: string): number {
  return vendor === "nvidia" ? 105 : 110;
}

/**
 * Laptop processors: Intel's H, HX, HK, HS, U, P, V and G7-style chips (Core i, Core and
 * Core Ultra) and AMD's H, HS, HX and U chips and every Ryzen AI. A laptop's
 * cooling is sized so these reach their limit under a long load and hold it
 * there by giving up some speed.
 */
export function mobileChip(name: string): boolean {
  if (/\b(i[3579]-\d{4,5}|Core(\(TM\))? [3579] \d{3}|Ultra [3579] \d{3})(HX|HK|HS|H|U|P|V|G[1-7])\b/i.test(name)) return true;
  if (/Ryzen (\d+ )?(PRO )?\d{4}(HX|HS|H|U)(3D)?\b/i.test(name)) return true;
  if (/Ryzen AI\b/i.test(name)) return true;
  return false;
}

/**
 * Processors that are built to run up to their limit under a heavy load and
 * trade a little speed to stay there: every laptop's processor, Ryzen 7000 and
 * 9000 desktop chips (but not X3D, which hold lower) and Intel's unlocked 13th
 * and 14th gen and Core Ultra 200 desktop chips. Reaching the limit in a long
 * render is normal on these; reaching it at rest is not.
 */
export function boostsToLimit(name: string, kind?: PCKind): boolean {
  if (kind === "laptop" || mobileChip(name)) return true;
  if (/X3D/i.test(name)) return false;
  if (/Ryzen \d+ [79]\d{3}X?\b/i.test(name)) return true;
  if (/i[579]-1[34]\d{3}K/i.test(name)) return true;
  if (/Ultra \d+ 2\d{2}K/i.test(name)) return true;
  return false;
}

/**
 * Below this share of the fastest it has run since Rig started, a processor at
 * its limit is losing real speed to the heat. A laptop under a long load
 * settles well above it; one that's struggling for air drops below.
 */
export const THROTTLE_SHARE = 0.5;

/** The processor's fastest core now and the fastest any core has run since Rig started, in MHz. Null when the chip reports no core clocks. */
export function cpuSpeed(s: Snapshot | null | undefined): { now: number; top: number } | null {
  const clocks = s?.sensors.filter((x) => x.hw === "cpu" && x.type === "clock" && x.value != null && /core/i.test(x.name) && !/bus|ring|uncore|memory/i.test(x.name)) ?? [];
  if (!clocks.length) return null;
  const now = Math.max(...clocks.map((x) => x.value!));
  return { now, top: Math.max(now, ...clocks.map((x) => x.max ?? 0)) };
}

/** The processor's speeds when it has slowed to under THROTTLE_SHARE of its fastest: throttling hard enough to lose speed. */
export function throttlingHard(s: Snapshot | null | undefined): { now: number; top: number } | null {
  const sp = cpuSpeed(s);
  return sp && sp.now < sp.top * THROTTLE_SHARE ? sp : null;
}
