// The week told as a story: one sentence on what stood out, three figures
// against the week before, the week's temperatures with desktop and game time
// apart, and the moments worth a look, each with a line on what Rig saw.
// Pure, like the home charts, so the desktop, the website and the demo agree.
//
// Days are the viewer's local days, from the clock and time zone in the context.

import type { Change } from "./client";
import { describeChange } from "./changes";
import { gameLibrary } from "./games";
import { HOT_MARGIN, highest, median, tempSubject, values, type InsightContext, type TempSubject, type UtcOffset } from "./insights";
import { HISTORY_WINDOW_MS, type HistoryPoint } from "./model";
import { eventTitle, type PCEvent, type RecordingInfo } from "./recordings";

const MIN = 60_000;
const HOUR = 36e5;
const DAY = 24 * HOUR;

/** The resting temperature has to rise this many °C over the week before to make the headline. */
export const RESTING_RISE = 3;
/** A driver reset counts as one more before it when an earlier one is at most this long before it. */
const EARLIER_RESET_MS = 30 * DAY;

/** One reading on the week's chart: the subject's highest in a ten-minute window. */
export interface StoryPoint {
  t: number;
  /** °C. Null when the part didn't report one. */
  v: number | null;
  /** The game in front, or null at the desktop (busy or not). */
  game: string | null;
}

/** A figure for the week, with the same figure for the week before. */
export interface StoryFigure {
  now: number | null;
  before: number | null;
  /** It needs a look: the resting temperature rose, or the week's hottest came close to the limit. */
  look: boolean;
}

export type StoryMarkKind = "change" | "hot" | "driver" | "crash" | "shutdown" | "hardware" | "disk" | "install";

/** A moment the chart flags and the list under it explains. */
export interface StoryMark {
  t: number;
  kind: StoryMarkKind;
  /** It needs a look: drawn in rust. */
  look: boolean;
  /** A few words for the chart's flag. "{temp}" stands for `temp`, written in the viewer's unit. */
  label: string;
  /** °C, for the flag's label. */
  temp?: number;
  /** One line, temperatures written in °C (absolute) or bare ° (differences), ready for tempsInText. */
  title: string;
  /** The one grey line under it, written the same way. */
  detail: string;
  /** Windows logged it, so the Events list has it too. */
  logged: boolean;
  /** A change Rig made, for its row's link. */
  changeId?: string;
  /** A recording that covers the moment. */
  recordingId?: string;
}

export interface WeekStory {
  subject: TempSubject;
  /** The subject's safe limit and the line above which it's close to it, °C. */
  limit: number;
  hotLine: number;
  /** Local midnight that starts the week (six days before today), and now. */
  from: number;
  to: number;
  /** The seven local midnights, oldest first. */
  days: number[];
  headline: { lead: string; rest: string | null };
  figures: { resting: StoryFigure; played: StoryFigure; hottest: StoryFigure };
  /** The subject's resting temperature each day, °C, null on a day without quiet readings. */
  resting: (number | null)[];
  points: StoryPoint[];
  /** Oldest first. */
  marks: StoryMark[];
}

export interface StoryInput {
  /** At least the two weeks up to now, for the comparisons with the week before. */
  points: readonly HistoryPoint[];
  events?: readonly PCEvent[];
  changes?: readonly Change[];
  recordings?: readonly RecordingInfo[];
}

// ----- Local time -----

const wall = (t: number, offset: UtcOffset) => t + offset(t) * MIN;
const fromWall = (w: number, offset: UtcOffset) => w - offset(w - offset(w) * MIN) * MIN;
const dayIndex = (t: number, offset: UtcOffset) => Math.floor(wall(t, offset) / DAY);
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today", "yesterday" or "on Wednesday", in the viewer's days. */
function onDay(t: number, ctx: InsightContext): string {
  const ago = dayIndex(ctx.now, ctx.offset) - dayIndex(t, ctx.offset);
  return ago === 0 ? "today" : ago === 1 ? "yesterday" : `on ${weekdays[new Date(wall(t, ctx.offset)).getUTCDay()]}`;
}

/** "Nov 18", in the viewer's days. */
function shortDate(t: number, ctx: InsightContext): string {
  const d = new Date(wall(t, ctx.offset));
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "31 minutes" or "about 2 hours". */
const afterWords = (ms: number) => { const m = Math.round(ms / MIN); return m < 90 ? `${m} minute${m === 1 ? "" : "s"}` : `about ${Math.round(m / 30) / 2} hours`; };
const times = (n: number) => (n === 2 ? "twice" : `${n} times`);
const hoursWord = (h: number) => { const r = Math.round(h * 2) / 2; return r === 1 ? "1-hour" : `${r}-hour`; };
const partWord = (s: TempSubject) => (s === "gpu" ? "graphics card" : "processor");

// ----- The story -----

export function weekStory(input: StoryInput, ctx: InsightContext): WeekStory {
  const today = dayIndex(ctx.now, ctx.offset);
  const days = Array.from({ length: 7 }, (_, i) => fromWall((today - 6 + i) * DAY, ctx.offset));
  const from = days[0], to = ctx.now;
  const before = fromWall((today - 13) * DAY, ctx.offset);
  const past = input.points.filter((p) => p.t <= to).sort((a, b) => a.t - b.t);
  const week = past.filter((p) => p.t >= from);
  const lastWeek = past.filter((p) => p.t >= before && p.t < from);
  const subject = tempSubject(week.length ? week : past, ctx.kind);
  const read = (p: HistoryPoint) => p[subject];
  const limit = ctx.limits[subject];
  const hotLine = limit - HOT_MARGIN;
  const rest = (pts: readonly HistoryPoint[]) => median(values(pts.filter((p) => !p.busy), read));

  // Figures.
  const restNow = rest(week), restBefore = rest(lastWeek);
  const games = gameLibrary(week, ctx);
  const gamesBefore = lastWeek.length ? gameLibrary(lastWeek, { ...ctx, now: from - 1 }) : null;
  const hottest = highest(values(week, read)), hottestBefore = highest(values(lastWeek, read));
  const risen = restNow != null && restBefore != null && restNow - restBefore >= RESTING_RISE;
  const figures = {
    resting: { now: restNow, before: restBefore, look: risen },
    played: { now: week.length ? games.hours : null, before: gamesBefore ? gamesBefore.hours : null, look: false },
    hottest: { now: hottest, before: hottestBefore, look: hottest != null && hottest >= hotLine },
  };

  // Marks: hot sessions, then what Windows logged, then the changes Rig made.
  const marks: StoryMark[] = [];
  const hot = games.games.flatMap((g) => g.sessions.filter((s) => s.hot).map((s) => {
    const peakAt = s.points.reduce<HistoryPoint | null>((b, p) => (read(p) != null && (!b || read(p)! > read(b)!) ? p : b), null);
    return { game: g.name, from: s.from, to: s.to, hours: s.hours, peak: s.peak, t: peakAt?.t ?? s.from };
  })).sort((a, b) => a.t - b.t);

  const at = (t: number) => past.find((p) => p.t <= t && t < p.t + HISTORY_WINDOW_MS) ?? null;
  const limitWords = (v: number) => (v > limit ? `${v - limit}° over its ${limit}°C limit` : v === limit ? `right at its ${limit}°C limit` : `${limit - v}° under its ${limit}°C limit`);
  const recordingAt = (t: number) => input.recordings?.find((r) => !r.id.startsWith("bg-d-") && !r.custom && r.startedAt != null && r.startedAt <= t && t <= (r.finishedAt ?? r.endsAt ?? r.startedAt))?.id;
  const events = (input.events ?? []).filter((e) => e.t >= from && e.t <= to);
  const resets = (input.events ?? []).filter((e) => e.kind === "driver");
  const merged = new Set<PCEvent>();

  for (const s of hot) {
    const reset = events.find((e) => e.kind === "driver" && e.t >= s.from && e.t <= s.to && !merged.has(e));
    const peakWords = s.peak == null ? "" : limitWords(s.peak);
    if (reset) {
      merged.add(reset);
      const into = afterWords(reset.t - s.from);
      const earlier = resets.filter((e) => e.t < reset.t - HOUR && e.t >= reset.t - EARLIER_RESET_MS).sort((a, b) => b.t - a.t)[0];
      marks.push({
        t: reset.t, kind: "hot", look: true, logged: true, label: "{temp}, driver reset", temp: s.peak ?? undefined,
        title: `${s.game} took the ${partWord(subject)} to ${s.peak}°C, and the graphics driver reset`,
        detail: `${cap(peakWords)}. The reset came ${into} in${earlier ? `; it also reset on ${shortDate(earlier.t, ctx)}` : ""}.`,
        recordingId: recordingAt(reset.t),
      });
    } else {
      marks.push({
        t: s.t, kind: "hot", look: true, logged: false, label: `${s.game}, {temp}`, temp: s.peak ?? undefined,
        title: `${s.game} took the ${partWord(subject)} to ${s.peak}°C`,
        detail: `${cap(peakWords)}, in a ${hoursWord(s.hours)} session.`,
        recordingId: recordingAt(s.t),
      });
    }
  }

  for (const e of events) {
    if (merged.has(e)) continue;
    const p = at(e.t), v = p ? read(p) : null;
    const then = v == null ? "" : `The ${partWord(subject)} was at ${v}°C then, ${limitWords(v)}.`;
    const game = p?.game ?? null;
    const recordingId = recordingAt(e.t);
    if (e.kind === "driver") {
      const earlier = resets.filter((x) => x.t < e.t - HOUR && x.t >= e.t - EARLIER_RESET_MS).sort((a, b) => b.t - a.t)[0];
      marks.push({
        t: e.t, kind: "driver", look: true, logged: true, label: "Driver reset", title: "The graphics driver reset",
        detail: [game && v != null ? `During ${game}, with the ${partWord(subject)} at ${v}°C.` : then, earlier ? `It also reset on ${shortDate(earlier.t, ctx)}.` : ""].filter(Boolean).join(" "), recordingId,
      });
    } else if (e.kind === "crash") {
      const title = eventTitle(e).replace(/\.exe\b/i, "");
      marks.push({ t: e.t, kind: "crash", look: false, logged: true, label: title, title, detail: then || "Windows logged it.", recordingId });
    } else if (e.kind === "shutdown") {
      marks.push({ t: e.t, kind: "shutdown", look: true, logged: true, label: "Turned off", title: eventTitle(e), detail: then || "Windows logged it when it started again.", recordingId });
    } else if (e.kind === "hardware" || e.kind === "disk") {
      marks.push({ t: e.t, kind: e.kind, look: e.level !== "warning", logged: true, label: e.kind === "disk" ? "Drive problem" : "Hardware error", title: eventTitle(e), detail: then || "Windows logged it.", recordingId });
    } else if (e.kind === "change") {
      const c = describeChange(e);
      if (c?.graphics) marks.push({ t: e.t, kind: "install", look: false, logged: true, label: "New graphics driver", title: `Installed ${c.what}`, detail: then || "Windows logged it.", recordingId });
    }
  }

  for (const c of input.changes ?? []) {
    const t = Date.parse(c.at);
    if (c.status !== "applied" || !(t >= from && t <= to)) continue;
    const beforeIt = rest(past.filter((p) => p.t >= t - 3 * DAY && p.t < t)), since = rest(past.filter((p) => p.t >= t));
    const part = `The ${partWord(subject)}`;
    const detail = beforeIt == null || since == null ? c.why
      : since <= beforeIt - 2 ? `${part} has rested at ${since}°C since, down from ${beforeIt}°C.`
      : since >= beforeIt + 2 ? `${part} has rested at ${since}°C since, up from ${beforeIt}°C.`
      : `${part} has rested at about ${since}°C since, as before.`;
    marks.push({ t, kind: "change", look: false, logged: false, label: changeLabel(c), title: c.title, detail, changeId: c.id });
  }
  marks.sort((a, b) => a.t - b.t);

  // The headline: what stood out, most pressing first.
  const clauses: string[] = [];
  const byGame = new Map<string, typeof hot>();
  for (const s of hot) byGame.set(s.game, [...(byGame.get(s.game) ?? []), s]);
  for (const [game, list] of [...byGame].sort((a, b) => b[1].length - a[1].length)) clauses.push(`${game} ran hot ${list.length === 1 ? onDay(list[0].t, ctx) : times(list.length)}`);
  const count = (kind: PCEvent["kind"]) => events.filter((e) => e.kind === kind);
  const weekResets = count("driver");
  if (weekResets.length) {
    const alone = weekResets.every((e) => !merged.has(e));
    clauses.push(`the graphics driver reset${weekResets.length > 1 ? ` ${times(weekResets.length)}` : alone ? ` ${onDay(weekResets[0].t, ctx)}` : ""}`);
  }
  const offs = count("shutdown");
  if (offs.length) clauses.push(`the PC turned off suddenly ${offs.length > 1 ? times(offs.length) : onDay(offs[0].t, ctx)}`);
  if (count("hardware").some((e) => e.level !== "warning")) clauses.push("Windows logged a hardware error");
  if (risen) clauses.push(`the ${partWord(subject)} rested ${restNow! - restBefore!}° warmer than the week before`);

  const headline = !week.length ? { lead: "Nothing logged this week", rest: null }
    : !clauses.length ? { lead: games.hours > 0 ? "A normal week" : "A quiet week", rest: null }
    : clauses.length <= 2 ? { lead: "A normal week, except", rest: clauses.join(" and ") }
    : { lead: "Not quite a normal week:", rest: `${clauses.slice(0, 2).join(", ")}, and ${clauses.length - 2} more below` };

  return {
    subject, limit, hotLine, from, to, days, headline, figures, marks,
    resting: days.map((d, i) => rest(week.filter((p) => p.t >= d && p.t < (days[i + 1] ?? to + 1)))),
    points: week.map((p) => ({ t: p.t, v: read(p), game: p.game ?? null })),
  };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A change in a few words, from its first row: "NVIDIA Broadcast off". */
function changeLabel(c: Change): string {
  const row = c.diff[0];
  if (!row) return c.title.length > 24 ? `${c.title.slice(0, 22)}…` : c.title;
  const [name, , after] = row;
  const value = /^(on|off|enabled|disabled)$/i.test(after) ? after.toLowerCase() : after;
  const label = `${name} ${value}`;
  return label.length > 28 ? `${label.slice(0, 26)}…` : label;
}
