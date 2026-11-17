// The games a PC ran, from recorded history: how long and how often each one
// played, and how warm the graphics card (or the processor) ran while it did.
// Pure, like the home charts, so the desktop, the website and the demo agree.

import { HOT_MARGIN, highest, median, ranHot, tempSubject, values, windowRuns, type InsightContext, type TempSubject } from "./insights";
import { HISTORY_WINDOW_MS, type HistoryPoint } from "./model";

const HOUR = 36e5;

/** A game's figures are compared with the others' only when both sides have at least this many windows (an hour). */
export const COMPARE_MIN_WINDOWS = 6;
/** A game runs hotter or cooler than the others when its typical temperature differs by at least this many °C. */
export const COMPARE_MIN_DIFF = 4;
/** Recent sessions run warmer than earlier ones when their typical temperatures differ by at least this many °C. */
export const WARMING_MIN_DIFF = 3;
/** The warming note compares the earliest and latest sessions, so it needs at least this many. */
export const WARMING_MIN_SESSIONS = 4;

/** One sitting: the game's windows joined across at most one window without it. */
export interface GameSession {
  /** First and last moment, milliseconds since epoch. */
  from: number;
  to: number;
  hours: number;
  /** The subject's median and highest reading in the session, in whole °C. */
  typical: number | null;
  peak: number | null;
  /** The processor or graphics card came within HOT_MARGIN °C of its safe limit. */
  hot: boolean;
  /** The session's history windows, oldest first, for its chart. */
  points: HistoryPoint[];
}

/** Something worth saying about a game, only when the history backs it up. */
export type GameNote =
  /** Its typical temperature against the other games' put together. */
  | { kind: "hotter" | "cooler"; by: number }
  /** Its hottest moment came within HOT_MARGIN °C of the safe limit. `under` is negative when it went over. */
  | { kind: "near-limit"; at: number; peak: number; under: number }
  /** The latest sessions ran warmer than the earliest ones. */
  | { kind: "warming"; by: number };

export interface GameStats {
  name: string;
  hours: number;
  /** Oldest first. */
  sessions: GameSession[];
  /** When the latest session ended, milliseconds since epoch. */
  lastPlayed: number;
  /** The subject's median and highest reading across every session, in whole °C. */
  typical: number | null;
  peak: number | null;
  /** When the peak was read: the start of its window. */
  peakAt: number | null;
  /** °C between the peak and the safe limit. Negative when the peak went over. */
  headroom: number | null;
  notes: GameNote[];
}

export interface GameLibrary {
  subject: TempSubject;
  /** The subject's safe limit, °C. */
  limit: number;
  /** Most played first. */
  games: GameStats[];
  /** Hours of every game together. */
  hours: number;
}

const playedAt = (p: HistoryPoint) => p.game ?? null;

/** Every game in the points, most played first. Pass the points of the range to describe; points after ctx.now are left out. */
export function gameLibrary(points: readonly HistoryPoint[], ctx: InsightContext): GameLibrary {
  const past = points.filter((p) => p.t <= ctx.now);
  const subject = tempSubject(past, ctx.kind);
  const limit = ctx.limits[subject];
  const read = (p: HistoryPoint) => p[subject];
  const names = [...new Set(past.map(playedAt).filter((g): g is string => !!g))];

  const games = names.map((name): GameStats => {
    const sessions = windowRuns(past, (p) => p.game === name).map((run): GameSession => {
      const from = run[0].t;
      const to = Math.min(run[run.length - 1].t + HISTORY_WINDOW_MS, ctx.now);
      return { from, to, hours: (to - from) / HOUR, typical: median(values(run, read)), peak: highest(values(run, read)), hot: ranHot(run, ctx.limits), points: run };
    });
    const mine = sessions.flatMap((s) => s.points);
    const peakPoint = mine.reduce<HistoryPoint | null>((b, p) => (read(p) != null && (!b || read(p)! > read(b)!) ? p : b), null);
    const peak = peakPoint ? Math.round(read(peakPoint)!) : null;
    return {
      name,
      hours: sessions.reduce((n, s) => n + s.hours, 0),
      sessions,
      lastPlayed: sessions[sessions.length - 1].to,
      typical: median(values(mine, read)),
      peak,
      peakAt: peakPoint?.t ?? null,
      headroom: peak == null ? null : limit - peak,
      notes: [],
    };
  });

  for (const g of games) g.notes = notesFor(g, games, read, limit);
  games.sort((a, b) => b.hours - a.hours || b.lastPlayed - a.lastPlayed);
  return { subject, limit, games, hours: games.reduce((n, g) => n + g.hours, 0) };
}

function notesFor(g: GameStats, all: GameStats[], read: (p: HistoryPoint) => number | null, limit: number): GameNote[] {
  const notes: GameNote[] = [];
  const mine = values(g.sessions.flatMap((s) => s.points), read);
  const others = values(all.filter((o) => o !== g).flatMap((o) => o.sessions.flatMap((s) => s.points)), read);
  if (mine.length >= COMPARE_MIN_WINDOWS && others.length >= COMPARE_MIN_WINDOWS) {
    const diff = median(mine)! - median(others)!;
    if (Math.abs(diff) >= COMPARE_MIN_DIFF) notes.push({ kind: diff > 0 ? "hotter" : "cooler", by: Math.abs(diff) });
  }
  if (g.peak != null && g.peakAt != null && g.peak >= limit - HOT_MARGIN) notes.push({ kind: "near-limit", at: g.peakAt, peak: g.peak, under: limit - g.peak });
  const typicals = g.sessions.map((s) => s.typical).filter((v): v is number => v != null);
  if (typicals.length >= WARMING_MIN_SESSIONS) {
    const half = Math.floor(typicals.length / 2);
    const diff = median(typicals.slice(-half))! - median(typicals.slice(0, half))!;
    if (diff >= WARMING_MIN_DIFF) notes.push({ kind: "warming", by: diff });
  }
  return notes;
}
