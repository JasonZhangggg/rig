// The three figures under the History chart: how warm the main part runs
// when busy (and whether that changed across the range), the processor at
// rest, and the hottest moment. Pure, so the desktop, the website and the
// demo say the same thing about the same history.

import { mostCommon } from "./history";
import type { HistoryPoint } from "./model";

/** The part the busy and hottest figures describe. */
export type SummaryPart = "gpu" | "cpu";

/** A change across the range smaller than this many °C reads as steady. */
export const STEADY_MARGIN = 3;

/** Readings a session needs in each half of the range before its halves are compared. */
const MIN_READINGS = 3;

export interface BusySummary {
  /** The usual temperature while busy, in °C. */
  typical: number;
  /**
   * Later sessions minus earlier ones, in °C, comparing the same game (or the
   * same kind of heavy work) with itself. Null when there's nothing like for
   * like to compare, such as a single session.
   */
  change: number | null;
}

export interface HistorySummary {
  /** Null when nothing heavy ran in the range. */
  busy: BusySummary | null;
  /** The processor's usual temperature when nothing heavy ran, in °C. */
  idleCpu: number | null;
  /** The hottest reading of the part, and how far it was from the safe limit (negative when over). */
  peak: { t: number; temp: number; headroom: number } | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Session { start: number; key: string; temps: number[] }

/** Busy stretches, split where the PC went quiet or stopped recording. */
function sessions(points: readonly HistoryPoint[], part: SummaryPart): Session[] {
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

/** What the History screen says under its chart, for one part and its safe limit. */
export function historySummary(points: readonly HistoryPoint[], part: SummaryPart, limit: number): HistorySummary {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const busyTemps = sorted.filter((p) => p.busy && p[part] != null).map((p) => p[part]!);
  const idle = median(sorted.filter((p) => !p.busy && p.cpu != null).map((p) => p.cpu!));
  let peak: HistoryPoint | null = null;
  for (const p of sorted) if (p[part] != null && (!peak || p[part]! > peak[part]!)) peak = p;
  return {
    busy: busyTemps.length ? { typical: Math.round(median(busyTemps)!), change: change(sessions(sorted, part)) } : null,
    idleCpu: idle == null ? null : Math.round(idle),
    peak: peak ? { t: peak.t, temp: Math.round(peak[part]!), headroom: Math.round(limit - peak[part]!) } : null,
  };
}
