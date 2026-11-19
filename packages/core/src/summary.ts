// The three figures over a part's chart in Logs: its highest moment, what it
// reads when busy (and whether that changed across the range), and what it
// reads at rest. Pure, so the desktop, the website and the demo say the same
// thing about the same history.

import { mostCommon } from "./history";
import type { HistoryKey, HistoryPoint } from "./model";

/** A change across the range smaller than this many °C reads as steady. */
export const STEADY_MARGIN = 3;

/** Readings a session needs in each half of the range before its halves are compared. */
const MIN_READINGS = 3;

export interface BusySummary {
  /** The usual reading while busy. */
  typical: number;
  /**
   * Later sessions minus earlier ones, comparing the same game (or the
   * same kind of heavy work) with itself. Null when there's nothing like for
   * like to compare, such as a single session.
   */
  change: number | null;
}

export interface HistorySummary {
  /** Null when nothing heavy ran in the range. */
  busy: BusySummary | null;
  /** The usual reading when nothing heavy ran. */
  idle: number | null;
  /** The highest reading, and how far it was under the safe limit (negative when over; null with no limit). */
  peak: { t: number; value: number; headroom: number | null } | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Session { start: number; key: string; temps: number[] }

/** Busy stretches, split where the PC went quiet or stopped recording. */
function sessions(points: readonly HistoryPoint[], part: HistoryKey): Session[] {
  const gaps = points.slice(1).map((p, i) => p.t - points[i].t);
  const step = median(gaps) ?? 0;
  const out: Session[] = [];
  let run: HistoryPoint[] = [];
  const close = () => {
    const temps = run.map((p) => p[part]).filter((v): v is number => v != null);
    if (temps.length) out.push({ start: run[0].t, key: mostCommon(run.map((p) => p.game)) ?? "", temps });
    run = [];
  };
  points.forEach((p, i) => {
    if (run.length && (!p.busy || p.t - points[i - 1].t > step * 2.5)) close();
    if (p.busy) run.push(p);
  });
  close();
  return out;
}

/**
 * How much warmer the later sessions ran than the earlier ones. Each game is
 * only compared with itself, so a heavy game early on and a light one later
 * don't read as the PC running cooler.
 */
function change(list: Session[]): number | null {
  if (list.length < 2) return null;
  const mid = (list[0].start + list[list.length - 1].start) / 2;
  const halves = new Map<string, { early: number[]; late: number[] }>();
  for (const s of list) {
    const h = halves.get(s.key) ?? { early: [], late: [] };
    (s.start <= mid ? h.early : h.late).push(...s.temps);
    halves.set(s.key, h);
  }
  let sum = 0, weight = 0;
  for (const { early, late } of halves.values()) {
    if (early.length < MIN_READINGS || late.length < MIN_READINGS) continue;
    const w = Math.min(early.length, late.length);
    sum += (median(late)! - median(early)!) * w;
    weight += w;
  }
  return weight ? Math.round(sum / weight) : null;
}

/** What Logs says over one reading's chart, against the part's safe limit when it has one. */
export function historySummary(points: readonly HistoryPoint[], key: HistoryKey, limit?: number): HistorySummary {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const busy = sorted.filter((p) => p.busy && p[key] != null).map((p) => p[key]!);
  const idle = median(sorted.filter((p) => !p.busy && p[key] != null).map((p) => p[key]!));
  let peak: HistoryPoint | null = null;
  for (const p of sorted) if (p[key] != null && (!peak || p[key]! > peak[key]!)) peak = p;
  return {
    busy: busy.length ? { typical: Math.round(median(busy)!), change: change(sessions(sorted, key)) } : null,
    idle: idle == null ? null : Math.round(idle),
    peak: peak ? { t: peak.t, value: Math.round(peak[key]!), headroom: limit == null ? null : Math.round(limit - peak[key]!) } : null,
  };
}
