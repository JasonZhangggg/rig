// Safe temperature limits and which sensor stands for a part. Getting these
// right is most of what keeps Rig's temperature checks from crying wolf: a
// limit that's too low warns about a healthy PC, and the wrong sensor (an
// offset Tctl, a hot spot) reads 10 to 20 degrees off.

import type { PCKind, Sensor, Snapshot } from "./telemetry";

/** The first sensor of this hardware and type whose name matches a pattern, trying the patterns in order. */
export function pickSensor(s: Snapshot | null | undefined, hw: Sensor["hw"], type: Sensor["type"], prefer: readonly RegExp[], skip?: RegExp): Sensor | undefined {
  const list = s?.sensors.filter((x) => x.hw === hw && x.type === type && x.value != null && !(skip && skip.test(x.name))) ?? [];
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

export const gpuTemp = (s: Snapshot | null) =>
  pickSensor(s, "gpu", "temperature", [/^gpu core$/i, /^gpu$/i, /edge/i, /core/i], NOT_GPU);

/** The graphics card's hottest spot, where it reports one. */
export const gpuHotSpot = (s: Snapshot | null) =>
  s?.sensors.find((x) => x.hw === "gpu" && x.type === "temperature" && x.value != null && /hot ?spot|junction/i.test(x.name) && !/memory/i.test(x.name));

/** The graphics card's memory chips (GDDR6X reports this as Memory Junction). */
export const gpuMemTemp = (s: Snapshot | null) =>
  s?.sensors.find((x) => x.hw === "gpu" && x.type === "temperature" && x.value != null && /memory/i.test(x.name));

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
