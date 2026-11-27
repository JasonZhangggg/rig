// Where a part's temperature usually sits, from its recorded history, and how
// a reading stands against that and against the part's safe limit. The part
// page draws this as one ribbon from cool to the limit. Pure functions, so the
// desktop, the website and the demo agree.

import { HOT_MARGIN } from "./insights";
import type { HistoryPoint } from "./model";

/** The parts with a temperature limit whose history Rig keeps. */
export type RangePart = "cpu" | "gpu";

/** The range a part usually sits in: the middle of its readings, without the odd spike or dip. */
export interface Band {
  /** Whole °C. */
  low: number;
  high: number;
  /** How many ten-minute windows it comes from. */
  count: number;
}

export interface UsualRange {
  part: RangePart;
  /** While a game or heavy load ran. Null without an hour of it. */
  busy: Band | null;
  /** Most of the busy time was a game, so the busy range can be called "while you play". */
  gaming: boolean;
  /** While nothing heavy ran. Null without an hour of it. */
  resting: Band | null;
  /** The hottest window, when it was and the game in it. Null without readings. */
  peak: { temp: number; at: number; game: string | null } | null;
}

const DAY = 864e5;
/** An hour of ten-minute windows: less than that is a moment, not a usual range. */
export const MIN_WINDOWS = 6;
/** The share of readings cut from each end, so a usual range isn't stretched by a spike or a cold start. */
const TRIM = 0.2;

/** The value below which a share of the sorted readings fall, interpolated between neighbours. */
function quantile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function band(xs: number[]): Band | null {
  if (xs.length < MIN_WINDOWS) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { low: Math.round(quantile(s, TRIM)), high: Math.round(quantile(s, 1 - TRIM)), count: xs.length };
}

/**
 * Where the part's temperature usually sits over the last `days` days, apart
 * for busy and resting time. History keeps each window's highest reading, so
 * these lean to the warm side of the moment-to-moment temperature.
 */
export function usualRange(points: readonly HistoryPoint[], part: RangePart, now = Date.now(), days = 7): UsualRange {
  const span = points.filter((p) => p.t > now - days * DAY && p.t <= now && p[part] != null);
  const busy = span.filter((p) => p.busy);
  let peak: UsualRange["peak"] = null;
  for (const p of span) if (!peak || p[part]! > peak.temp) peak = { temp: Math.round(p[part]!), at: p.t, game: p.game ?? null };
  return {
    part,
    busy: band(busy.map((p) => p[part]!)),
    gaming: busy.length > 0 && busy.filter((p) => p.game).length * 2 > busy.length,
    resting: band(span.filter((p) => !p.busy).map((p) => p[part]!)),
    peak,
  };
}

// ----- Zones -----

export type ZoneId = "cool" | "normal" | "warm" | "near";

/** A stretch of temperature with a plain word for it, in °C. The last zone ends at the limit. */
export interface TempZone { id: ZoneId; from: number; to: number }

/**
 * Cool, normal, warm and near the limit, for a part with this limit. Near the
 * limit is the HOT_MARGIN Rig's other checks call running hot; warm is the
 * stretch before it; cool ends at 50°C, or lower for a part with a low limit.
 */
export function tempZones(limit: number, from = 0): TempZone[] {
  const near = limit - HOT_MARGIN, warm = limit - 2 * HOT_MARGIN, cool = Math.min(50, warm - 10);
  return [
    { id: "cool", from, to: cool },
    { id: "normal", from: cool, to: warm },
    { id: "warm", from: warm, to: near },
    { id: "near", from: near, to: limit },
  ];
}

/** The zone a temperature falls in, or "over" past the limit. */
export function zoneOf(temp: number, limit: number): ZoneId | "over" {
  if (temp > limit) return "over";
  const z = tempZones(limit, -Infinity);
  return z.find((x) => temp < x.to)?.id ?? "near";
}

// ----- Headroom -----

/**
 * How much room is left before the limit. Measured from the hottest the part
 * got in the week when that's hotter than now, since that's the room it really
 * had when it worked hardest; otherwise from now. Negative when over.
 */
export interface Headroom {
  degrees: number;
  /** "week": from the week's hottest window. "now": from the reading now. */
  from: "week" | "now";
  /** The temperature it's measured from, °C. */
  temp: number;
  /** When the week's hottest was, for "week". */
  at?: number;
  game?: string | null;
  /** The room left at the top of its usual busy range: what a typical game leaves. */
  typical?: number;
}

export function headroom(now: number | undefined, limit: number, range: UsualRange | null): Headroom | null {
  const peak = range?.peak;
  const typical = range?.busy ? { typical: Math.round(limit - range.busy.high) } : {};
  if (peak && (now == null || peak.temp > now)) return { degrees: Math.round(limit - peak.temp), from: "week", temp: peak.temp, at: peak.at, game: peak.game, ...typical };
  if (now == null) return null;
  return { degrees: Math.round(limit - now), from: "now", temp: Math.round(now), ...typical };
}

// ----- Now against usual -----

/**
 * How a reading compares with where the part usually sits.
 * over / near: past the limit, or within HOT_MARGIN of it, whatever's usual.
 * busy: inside its usual busy range. above: warmer than that.
 * resting: inside its usual resting range. below: cooler than that.
 * between: above resting, short of busy.
 * unknown: there's no usual range to compare with yet.
 */
export type Standing = "over" | "near" | "busy" | "above" | "resting" | "below" | "between" | "unknown";

/** Readings this close to a band's edge still count as inside it: a degree or two is noise. */
const SLACK = 2;

export function standing(temp: number, limit: number, range: UsualRange | null): Standing {
  const z = zoneOf(temp, limit);
  if (z === "over" || z === "near") return z;
  const b = range?.busy, r = range?.resting;
  if (b && temp > b.high + SLACK) return "above";
  if (b && temp >= b.low - SLACK) return "busy";
  if (r && temp >= r.low - SLACK && temp <= r.high + SLACK) return "resting";
  if (r && temp < r.low - SLACK) return "below";
  if (r && b) return "between";
  return "unknown";
}
