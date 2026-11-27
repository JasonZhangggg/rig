// How soon a game's sessions get hot: each session as ten-minute squares, the
// minutes until it first came near the safe limit, and what changed between the
// first session and the latest. Pure, so the desktop, the website and the demo agree.

import type { GameSession } from "./games";
import { HOT_MARGIN, median, type TempSubject } from "./insights";
import { HISTORY_WINDOW_MS, type HistoryPoint } from "./model";

const MIN = 60_000;
/** Minutes one square covers: one history window. */
export const SQUARE_MIN = HISTORY_WINDOW_MS / MIN;
/** Heat arrives sooner (or later) only when the latest session and the first differ by at least this many minutes. */
export const ONSET_MIN_DIFF = 20;
/** Saying it's a trend needs at least this many sessions; fewer only describe the latest. */
export const TREND_MIN_SESSIONS = 3;
/** The part worked about as hard in both sessions when its average load differs by less than this many points. */
export const SAME_LOAD_DIFF = 10;

/** How warm a square ran, from coolest to hot. "hot" is within HOT_MARGIN °C of the safe limit, as "Ran hot" means elsewhere. */
export type HeatLevel = "cool" | "normal" | "warm" | "hot";

/** The lowest reading, in °C, of each level above "cool". */
export interface HeatBands { normal: number; warm: number; hot: number }

export const heatBands = (limit: number): HeatBands => ({ normal: limit - 26, warm: limit - 12, hot: limit - HOT_MARGIN });

export function heatLevel(v: number | null | undefined, b: HeatBands): HeatLevel | null {
  if (v == null) return null;
  return v >= b.hot ? "hot" : v >= b.warm ? "warm" : v >= b.normal ? "normal" : "cool";
}

/** Ten minutes of a session. `peak` is null when Rig has no reading for that window. */
export interface HeatSquare { at: number; peak: number | null; level: HeatLevel | null }

export interface SessionHeat {
  from: number;
  to: number;
  /** How long the session ran, in whole minutes. */
  minutes: number;
  /** Minutes from the start of the session to the start of the first hot square. Null when it never got hot. */
  hotAfter: number | null;
  peak: number | null;
  /** One per window from the first to the last, oldest first; a gap Rig didn't read is a square with no peak. */
  squares: HeatSquare[];
  /** How hard the part worked on average, in percent. Null when Rig didn't read it. */
  load: number | null;
}

/** What changed, in the order the page says it. */
export type HeatStory =
  /** No session came near the limit. */
  | { kind: "cool"; sessions: number }
  /** The latest session got hot at least ONSET_MIN_DIFF minutes sooner than the first, and the later half agrees. */
  | { kind: "sooner"; then: SessionHeat; now: SessionHeat }
  /** The latest session got hot later than the first, or not at all, and the later half agrees. */
  | { kind: "later"; then: SessionHeat; now: SessionHeat }
  /** Every session that got hot did so about as soon; `hotAfter` is their median. */
  | { kind: "same"; hotAfter: number; since: number }
  /** Too few sessions to call a trend, or no clear one: the latest session, and the spread when there's more than one. */
  | { kind: "latest"; now: SessionHeat; range: [number, number] | null };

export interface HeatTrend {
  bands: HeatBands;
  /** Oldest first, like the game's sessions. */
  sessions: SessionHeat[];
  story: HeatStory;
  /** The part worked about as hard in the first and latest sessions. Null when Rig didn't read the load in both. */
  sameLoad: boolean | null;
}

/** Minutes from the first window to the first one at or above `hot`, in whole windows. Null when none was. */
export function minutesUntilHot(points: readonly HistoryPoint[], read: (p: HistoryPoint) => number | null | undefined, hot: number): number | null {
  if (!points.length) return null;
  const start = points[0].t;
  const first = points.find((p) => (read(p) ?? -Infinity) >= hot);
  return first ? Math.round((first.t - start) / HISTORY_WINDOW_MS) * SQUARE_MIN : null;
}

export function sessionHeat(s: Pick<GameSession, "from" | "to" | "points">, subject: TempSubject, limit: number): SessionHeat {
  const bands = heatBands(limit);
  const read = (p: HistoryPoint) => p[subject];
  const byWindow = new Map(s.points.map((p) => [Math.round((p.t - s.from) / HISTORY_WINDOW_MS), p]));
  const count = s.points.length ? Math.round((s.points[s.points.length - 1].t - s.from) / HISTORY_WINDOW_MS) + 1 : 0;
  const squares = Array.from({ length: count }, (_, i): HeatSquare => {
    const v = byWindow.get(i) ? read(byWindow.get(i)!) : null;
    const peak = v == null ? null : Math.round(v);
    return { at: s.from + i * HISTORY_WINDOW_MS, peak, level: heatLevel(peak, bands) };
  });
  const peaks = squares.map((q) => q.peak).filter((v): v is number => v != null);
  const loads = s.points.map((p) => (subject === "gpu" ? p.gpuLoad : p.cpuLoad)).filter((v): v is number => v != null);
  return {
    from: s.from,
    to: s.to,
    minutes: Math.round((s.to - s.from) / MIN),
    hotAfter: minutesUntilHot(s.points, read, bands.hot),
    peak: peaks.length ? Math.max(...peaks) : null,
    squares,
    load: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null,
  };
}

/** The longest a session could have taken to get hot: when it did, or its whole length when it never did. */
const onset = (s: SessionHeat) => s.hotAfter ?? s.minutes;

/** Every session's squares and how soon each got hot, with what changed from the first session to the latest. */
export function heatTrend(sessions: readonly GameSession[], subject: TempSubject, limit: number): HeatTrend {
  const heat = sessions.map((s) => sessionHeat(s, subject, limit));
  const bands = heatBands(limit);
  const then = heat[0], now = heat[heat.length - 1];
  const sameLoad = then && now && then !== now && then.load != null && now.load != null ? Math.abs(now.load - then.load) < SAME_LOAD_DIFF : null;
  return { bands, sessions: heat, story: storyOf(heat), sameLoad };
}

function storyOf(heat: SessionHeat[]): HeatStory {
  const hot = heat.filter((s) => s.hotAfter != null);
  if (!hot.length) return { kind: "cool", sessions: heat.length };
  const then = heat[0], now = heat[heat.length - 1];
  const spread = hot.length > 1 ? [Math.min(...hot.map((s) => s.hotAfter!)), Math.max(...hot.map((s) => s.hotAfter!))] as [number, number] : null;
  if (heat.length < TREND_MIN_SESSIONS) return { kind: "latest", now, range: null };
  const half = Math.floor(heat.length / 2);
  const early = median(heat.slice(0, half).map(onset))!, late = median(heat.slice(-half).map(onset))!;
  if (now.hotAfter != null && now.hotAfter + ONSET_MIN_DIFF <= onset(then) && late < early) return { kind: "sooner", then, now };
  if (then.hotAfter != null && onset(now) >= then.hotAfter + ONSET_MIN_DIFF && late > early) return { kind: "later", then, now };
  if (spread && hot.length === heat.length && spread[1] - spread[0] < ONSET_MIN_DIFF) return { kind: "same", hotAfter: median(hot.map((s) => s.hotAfter!))!, since: then.from };
  return { kind: "latest", now, range: spread };
}
