// Each part on its own line for Home's "Part by part" view: what it reads now, its usual range while you play (or work),
// the highest it reached this week (a battery's lowest) and where it starts to slow itself down. Pure, from the PC and its recorded history,
// so the desktop, the website and the demo agree.

import { DRIVE_WARM } from "./diagnose";
import { BUSY_LOAD, cpuLimitByDesign } from "./health";
import { HOT_MARGIN } from "./insights";
import type { HistoryKey, HistoryPoint, PC, ReadingUnit } from "./model";
import { livePoint } from "./view";

/** The parts in the order the view lists them: what games lean on first, the parts Rig can't read last. */
export const PART_ORDER = ["gpu", "cpu", "ram", "ssd", "motherboard", "board", "fans", "battery", "psu", "case", "chassis"];

/** Which history reading follows each part, and in what unit. A battery follows its charge, which history keeps apart from the charts' readings. */
const TRACKS: Record<string, { key: HistoryKey | "batt"; unit: ReadingUnit }> = {
  gpu: { key: "gpu", unit: "temp" },
  cpu: { key: "cpu", unit: "temp" },
  ram: { key: "mem", unit: "percent" },
  ssd: { key: "drive", unit: "temp" },
  motherboard: { key: "board", unit: "temp" },
  board: { key: "board", unit: "temp" },
  fans: { key: "fan", unit: "rpm" },
  battery: { key: "batt", unit: "percent" },
};

/** The usual band needs at least this many windows (an hour) behind it, so one evening doesn't set it. */
export const USUAL_MIN_WINDOWS = 6;

/** How a part is doing right now. */
export type PartState =
  /** At or past the point where it slows itself down. */
  | "slowing"
  /** Within HOT_MARGIN °C of that point. */
  | "hot"
  /**
   * At or near that point under load, as it's built to run: a laptop's processor, or a desktop chip made to boost to
   * its limit (limitByDesign), while Things to look at finds nothing wrong with it. Not a worry.
   */
  | "design"
  /** Above the top of its usual band, but nowhere near its limit. */
  | "above"
  | "calm"
  /** Rig has no reading for it. */
  | "unread";

export interface PartRow {
  /** The part, as a key of PC.parts. */
  id: string;
  /** Null when Rig has no reading for this part. */
  unit: ReadingUnit | null;
  now: number | null;
  /** The middle half of its readings while you play (or over the week, see PartsView.usualWhen). */
  usual: { lo: number; hi: number } | null;
  /** The highest reading this week, now included, with when it was and the game in front then. Null for a battery, whose highest says nothing. */
  high: { value: number; at: number; game: string | null } | null;
  /** The lowest reading this week, now included: how far a battery ran down. */
  low: { value: number; at: number } | null;
  /** Where it starts to slow itself down to stay safe, when it does. */
  limit: number | null;
  /** The ends of the part's own scale, so each track reads on its own terms. */
  scale: { min: number; max: number };
  state: PartState;
  /** Its highest this week came within HOT_MARGIN °C of the limit, other than under load on a processor built to run there. */
  ranHot: boolean;
}

export interface PartsView {
  rows: PartRow[];
  /**
   * What the usual bands come from: the windows a game or heavy load ran ("playing" when games were most of them, as
   * usualRange counts it, "busy" when work was), or every window when there were too few of those. Null without history.
   */
  usualWhen: "playing" | "busy" | "any" | null;
  /** Something heavy runs now: a processor or graphics card above 70%, as the history's busy flag counts it. Null when the loads aren't known. */
  busyNow: boolean | null;
}

/** The value at a share of the way through sorted readings, rounded. */
function quantile(sorted: number[], q: number) {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo));
}

function usualBand(points: readonly HistoryPoint[], key: HistoryKey | "batt") {
  const xs = points.map((p) => p[key]).filter((v): v is number => v != null).sort((a, b) => a - b);
  return xs.length >= USUAL_MIN_WINDOWS ? { lo: quantile(xs, 0.25), hi: quantile(xs, 0.75) } : null;
}

/** Where a drive slows itself down, from the kind of drive Windows runs from. */
function driveLimit(pc: PC) {
  const sys = pc.drives?.find((d) => d.system) ?? pc.drives?.[0];
  if (sys) return DRIVE_WARM[sys.media];
  const type = pc.parts?.ssd?.specs.find(([k]) => k === "Type")?.[1] ?? "";
  return /nvme/i.test(type) ? DRIVE_WARM.nvme : /sata/i.test(type) ? DRIVE_WARM.ssd : /hard/i.test(type) ? DRIVE_WARM.hdd : DRIVE_WARM.unknown;
}

const up = (v: number, step: number) => Math.ceil(v / step) * step;
const down = (v: number, step: number) => Math.floor(v / step) * step;

function scaleOf(unit: ReadingUnit, seen: number[], limit: number | null, fanMax: number): PartRow["scale"] {
  if (unit === "percent") return { min: 0, max: 100 };
  if (unit === "rpm") return { min: 0, max: up(Math.max(fanMax, ...seen, 1000), 500) };
  const top = Math.max(...seen, limit ?? 0);
  return { min: Math.min(20, down(Math.min(...seen), 10)), max: up(limit != null ? Math.max(limit + 10, top + 4) : top + 15, 5) };
}

/**
 * The view, from the PC as it reads now and the last week of its history. Pass the week's points; later ones are left out.
 * Parts Rig can't read (the case, the power supply) still get a row, with nothing measured on it, except on a laptop,
 * where a part Rig never follows (the laptop itself) is left out rather than shown as unread.
 */
export function partByPart(pc: PC, points: readonly HistoryPoint[], now = Date.now()): PartsView {
  const week = points.filter((p) => p.t <= now && p.t > now - 7 * 24 * 36e5);
  const playing = week.filter((p) => p.busy);
  const enough = playing.length >= USUAL_MIN_WINDOWS;
  const source = enough ? playing : week;
  const live = { ...livePoint(pc, now), batt: pc.battery?.level ?? null };
  // The same fans the history follows: every fan that spins, the graphics card's included.
  const spinning = (pc.readings ?? []).filter((r) => r.type === "fan" && r.value != null && r.value > 0).map((r) => r.value!);
  const fanNow = spinning.length ? Math.round(Math.max(...spinning)) : live.fan;
  const fanMax = Math.max(0, ...(pc.fans ?? []).map((f) => f.max));
  const parts = pc.parts ?? {};
  const ids = [...PART_ORDER.filter((id) => parts[id]), ...Object.keys(parts).filter((id) => !PART_ORDER.includes(id))]
    .filter((id) => pc.kind !== "laptop" || TRACKS[id]);

  const rows = ids.map((id): PartRow => {
    const track = TRACKS[id];
    const nowValue = track ? (track.key === "fan" ? fanNow : live[track.key]) ?? null : null;
    const recorded = track ? week.filter((p) => p[track.key] != null) : [];
    if (!track || (nowValue == null && !recorded.length)) {
      return { id, unit: null, now: null, usual: null, high: null, low: null, limit: null, scale: { min: 0, max: 1 }, state: "unread", ranHot: false };
    }
    const { key, unit } = track;
    const limit = id === "cpu" || id === "gpu" ? parts[id].limit ?? null : id === "ssd" ? driveLimit(pc) : null;
    const battery = key === "batt";
    const top = recorded.reduce<HistoryPoint | null>((b, p) => (!b || p[key]! > b[key]! ? p : b), null);
    const high = battery ? null : top && (nowValue == null || top[key]! >= nowValue)
      ? { value: top[key]!, at: top.t, game: top.game ?? null }
      : nowValue != null ? { value: nowValue, at: now, game: null } : null;
    const bottom = recorded.reduce<HistoryPoint | null>((b, p) => (!b || p[key]! < b[key]! ? p : b), null);
    const low = bottom && (nowValue == null || bottom[key]! <= nowValue)
      ? { value: bottom[key]!, at: bottom.t }
      : nowValue != null ? { value: nowValue, at: now } : null;
    // A battery's usual charge is over the whole week: what games or work leaned on says nothing about it.
    const usual = usualBand(battery ? week : source, key);
    const seen = [nowValue, high?.value, usual?.lo, usual?.hi].filter((v): v is number => v != null);
    // A processor built to run at its limit, at it under load, is working as built unless Things to look at says otherwise.
    const byDesign = (load: number | null | undefined) => id === "cpu" && cpuLimitByDesign(parts.cpu.name, pc.kind, load);
    const designNow = byDesign(live.cpuLoad) && !pc.issues?.some((i) => i.id === "cpu-hot");
    const highLoad = high && (high.at === now ? live.cpuLoad : top?.cpuLoad ?? (top?.busy ? BUSY_LOAD : null));
    const state: PartState = nowValue == null ? "unread"
      : limit != null && nowValue >= limit - HOT_MARGIN && designNow ? "design"
      : limit != null && nowValue >= limit ? "slowing"
      : limit != null && nowValue >= limit - HOT_MARGIN ? "hot"
      : usual && nowValue > usual.hi && !battery ? "above"
      : "calm";
    return {
      id, unit, now: nowValue, usual, high, low, limit, state,
      scale: scaleOf(unit, seen, limit, fanMax),
      ranHot: limit != null && high != null && high.value >= limit - HOT_MARGIN && !byDesign(highLoad),
    };
  });

  const loads = [live.cpuLoad, live.gpuLoad].filter((v): v is number => v != null);
  return {
    rows,
    usualWhen: !week.length ? null : !enough ? "any" : playing.filter((p) => p.game).length * 2 > playing.length ? "playing" : "busy",
    busyNow: loads.length ? loads.some((v) => v > 70) : null,
  };
}
