// Turns recorded history into what the home screen's charts show: the week's
// temperatures per day, the week's evening sessions, and fan speed every six
// hours. Pure functions, so the desktop, the website and the demo agree.
//
// Days are the viewer's local days. The caller passes the clock and the time
// zone, so the same history reads the same way in tests and in any zone.

import { cpuLimit, gpuLimit } from "./health";
import { mostCommon } from "./history";
import { HISTORY_WINDOW_MS, type HistoryPoint, type PC } from "./model";
import type { PCKind } from "./telemetry";

/** Minutes ahead of UTC at a given moment (60 for Paris in winter, -300 for New York). A function, so days stay whole across daylight saving changes. */
export type UtcOffset = (t: number) => number;

/** The time zone of whoever runs the code: the browser or the desktop app. */
export const viewerOffset: UtcOffset = (t) => -new Date(t).getTimezoneOffset();
export const fixedOffset = (minutes: number): UtcOffset => () => minutes;

export interface InsightContext {
  /** Milliseconds since epoch. The last day shown is the local day holding this moment. */
  now: number;
  offset: UtcOffset;
  kind: PCKind;
  /** Safe limits in °C, which decide when a session ran hot. */
  limits: { cpu: number; gpu: number };
}

/** A session ran hot when a part came within this many °C of its safe limit. */
export const HOT_MARGIN = 6;

/** What the context needs from a PC: its kind and its parts' safe limits. A PC fits as it is. */
export type InsightSubject = Pick<PC, "kind"> & { parts?: { cpu?: { limit?: number }; gpu?: { limit?: number } } };

export function insightContext(pc: InsightSubject, now = Date.now(), offset = viewerOffset): InsightContext {
  return {
    now, offset, kind: pc.kind,
    limits: { cpu: pc.parts?.cpu?.limit ?? cpuLimit(""), gpu: pc.parts?.gpu?.limit ?? gpuLimit("") },
  };
}

// ----- Local time -----

const HOUR = 36e5;
const DAY = 24 * HOUR;

/** The local wall clock as milliseconds, so local days and hours are plain division. */
const wall = (t: number, offset: UtcOffset) => t + offset(t) * 60_000;
const fromWall = (w: number, offset: UtcOffset) => w - offset(w - offset(w) * 60_000) * 60_000;
const dayIndex = (t: number, offset: UtcOffset) => Math.floor(wall(t, offset) / DAY);

/** The seven local day indexes ending with today, oldest first. */
const week = (ctx: InsightContext) => {
  const today = dayIndex(ctx.now, ctx.offset);
  return Array.from({ length: 7 }, (_, i) => today - 6 + i);
};

const inRange = (points: readonly HistoryPoint[], from: number, to: number) => points.filter((p) => p.t >= from && p.t < to);

/** The readings `pick` finds, without the gaps. */
export const values = (points: readonly HistoryPoint[], pick: (p: HistoryPoint) => number | null | undefined) =>
  points.map(pick).filter((v): v is number => v != null);

/** The middle reading, rounded to a whole °C, so one spike doesn't move it. Null without readings. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

export const highest = (xs: number[]) => (xs.length ? Math.round(Math.max(...xs)) : null);

// ----- Temperatures -----

/**
 * The part the typical and peak figures describe. The graphics card on a
 * desktop that reported one this week; the processor on a laptop, or on a
 * desktop without graphics card readings.
 */
export type TempSubject = "gpu" | "cpu";

/** One local day, in whole °C. A figure is null when the day has no reading it can come from. */
export interface DayTemps {
  /** Local midnight that starts the day, milliseconds since epoch. Format it with Intl in the viewer's zone. */
  day: number;
  /** The processor's median while nothing heavy ran. */
  idle: number | null;
  /** The subject's median while a game or heavy load ran. */
  typical: number | null;
  /** The subject's highest reading of the day. */
  peak: number | null;
}

export interface WeekTemps {
  subject: TempSubject;
  /** Seven local days, oldest first, the last one today. Days without history have every figure null. */
  days: DayTemps[];
  /** The highest peak of the seven days. */
  peak: number | null;
}

/** The graphics card on a desktop whose points report one, otherwise the processor. */
export const tempSubject = (points: readonly HistoryPoint[], kind: PCKind): TempSubject =>
  kind === "tower" && points.some((p) => p.gpu != null) ? "gpu" : "cpu";

export function weekTemps(points: readonly HistoryPoint[], ctx: InsightContext): WeekTemps {
  const days = week(ctx);
  const span = inRange(points, fromWall(days[0] * DAY, ctx.offset), ctx.now + 1);
  const subject = tempSubject(span, ctx.kind);
  const read = (p: HistoryPoint) => p[subject];
  const out = days.map((d): DayTemps => {
    const day = fromWall(d * DAY, ctx.offset);
    const pts = span.filter((p) => dayIndex(p.t, ctx.offset) === d);
    return {
      day,
      idle: median(values(pts.filter((p) => !p.busy), (p) => p.cpu)),
      typical: median(values(pts.filter((p) => p.busy), read)),
      peak: highest(values(pts, read)),
    };
  });
  return { subject, days: out, peak: highest(out.map((d) => d.peak).filter((v): v is number => v != null)) };
}

// ----- Evenings -----

/**
 * hot: the processor or graphics card came within HOT_MARGIN °C of its safe limit.
 * played: a game ran and nothing came near its limit.
 * background: the PC was busy without a game (an update, an export, a download) and stayed cool.
 */
export type SessionKind = "played" | "hot" | "background";

/**
 * A stretch of busy history windows in one evening. Windows join when the
 * gap between them is at most one quiet window. An evening runs from 6 PM to
 * 6 AM the next morning, so a session past midnight stays with the evening
 * it started in, and one already running at 6 PM counts from 6 PM.
 */
export interface EveningSession {
  /** The busy stretch's first and last moment, milliseconds since epoch, before clipping to the evening. */
  from: number;
  to: number;
  /** Hours after 6 PM that the session reached the evening: 0 when it was already running at 6 PM. Past 6 when it started after midnight. */
  start: number;
  /** Hours of the session inside the evening. */
  hours: number;
  /** The game that ran in the most windows, or null when none did. */
  game: string | null;
  kind: SessionKind;
}

export interface EveningDay {
  /** Local midnight that starts the day whose evening this is. */
  day: number;
  /** Oldest first. Empty when the PC was quiet or off that evening. */
  sessions: EveningSession[];
}

export interface WeekEvenings {
  /** Seven local days, oldest first, the last one today. */
  days: EveningDay[];
  /** Hours of played and hot sessions. Background tasks are left out. */
  hours: number;
}

const EVENING_FROM = 18;
const EVENING_TO = 24 + 6;

/** The windows `keep` picks, oldest first, grouped into stretches: each window joins the last when at most one other window lies between them. */
export function windowRuns(points: readonly HistoryPoint[], keep: (p: HistoryPoint) => boolean): HistoryPoint[][] {
  const runs: HistoryPoint[][] = [];
  let run: HistoryPoint[] = [];
  for (const p of points.filter(keep).sort((a, b) => a.t - b.t)) {
    const last = run[run.length - 1];
    if (last && p.t - (last.t + HISTORY_WINDOW_MS) > HISTORY_WINDOW_MS) { runs.push(run); run = []; }
    run.push(p);
  }
  if (run.length) runs.push(run);
  return runs;
}

/** The processor or graphics card came within HOT_MARGIN °C of its safe limit in any of the windows. */
export const ranHot = (points: readonly HistoryPoint[], limits: InsightContext["limits"]) =>
  points.some((p) => (p.gpu ?? -Infinity) >= limits.gpu - HOT_MARGIN || (p.cpu ?? -Infinity) >= limits.cpu - HOT_MARGIN);

function sessionKind(points: readonly HistoryPoint[], game: string | null, limits: InsightContext["limits"]): SessionKind {
  return ranHot(points, limits) ? "hot" : game ? "played" : "background";
}

export function weekEvenings(points: readonly HistoryPoint[], ctx: InsightContext): WeekEvenings {
  const runs = windowRuns(points, (p) => p.busy && p.t <= ctx.now);
  const days = week(ctx).map((d): EveningDay => {
    const open = fromWall(d * DAY + EVENING_FROM * HOUR, ctx.offset);
    const close = fromWall(d * DAY + EVENING_TO * HOUR, ctx.offset);
    const sessions = runs.flatMap((run): EveningSession[] => {
      const from = run[0].t;
      const to = Math.min(run[run.length - 1].t + HISTORY_WINDOW_MS, ctx.now);
      const a = Math.max(from, open), b = Math.min(to, close);
      if (b <= a) return [];
      const inside = run.filter((p) => p.t + HISTORY_WINDOW_MS > a && p.t < b);
      const game = mostCommon(inside.map((p) => p.game));
      return [{ from, to, start: (a - open) / HOUR, hours: (b - a) / HOUR, game, kind: sessionKind(inside, game, ctx.limits) }];
    });
    return { day: fromWall(d * DAY, ctx.offset), sessions };
  });
  const hours = days.flatMap((d) => d.sessions).filter((s) => s.kind !== "background").reduce((n, s) => n + s.hours, 0);
  return { days, hours };
}

// ----- Fans -----

/** One six-hour slice, starting at local midnight, 6 AM, noon or 6 PM. */
export interface FanColumn {
  /** Start of the slice, milliseconds since epoch. */
  from: number;
  /** The fastest fan speed any window in the slice recorded, in rpm. Null when none recorded one. */
  rpm: number | null;
  /** rpm against FanTrend.scale, from 0 to 1. Null with rpm. */
  level: number | null;
}

export interface FanTrend {
  /** Oldest first. The last column is the slice holding now, still filling. */
  columns: FanColumn[];
  /** The rpm a level of 1 stands for: the fastest column shown. Null when no column has a speed. */
  scale: number | null;
}

const SLICE = 6 * HOUR;

/** Fan speed per six-hour slice, the newest last. 16 columns cover the last four days. */
export function fanTrend(points: readonly HistoryPoint[], ctx: InsightContext, columns = 16): FanTrend {
  const last = Math.floor(wall(ctx.now, ctx.offset) / SLICE);
  const slices = Array.from({ length: columns }, (_, i) => last - columns + 1 + i);
  const rpms = slices.map((s) => highest(values(inRange(points, fromWall(s * SLICE, ctx.offset), fromWall((s + 1) * SLICE, ctx.offset)), (p) => p.fan)));
  const scale = highest(rpms.filter((v): v is number => v != null));
  return {
    scale,
    columns: slices.map((s, i) => ({
      from: fromWall(s * SLICE, ctx.offset),
      rpm: rpms[i],
      level: rpms[i] == null || !scale ? null : rpms[i]! / scale,
    })),
  };
}
