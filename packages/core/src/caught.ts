// What a recording caught: when Windows logged a driver reset, a crash, a
// sudden switch-off or a hardware error while Rig recorded, the recording's
// page leads with that moment and the most likely cause, worked out here from
// the recording's own readings, the game's usual temperatures from history,
// and the Windows events. Only what the readings show; a cause is "most likely".

import { USUAL } from "./alerts";
import type { HistoryPoint } from "./model";
import { PINNED_PERCENT, RECORD_HOT_MARGIN, eventTitle, type EventKind, type Limits, type PCEvent, type Recording, type RecordingSample, type RecordingSummary } from "./recordings";

const MIN = 60_000;
const DAY = 864e5;

/** The kinds of Windows event a recording's page leads with. */
export const CAUGHT_KINDS: readonly EventKind[] = ["driver", "crash", "shutdown", "hardware"];
/** Another app counts as busy from this share of the processor. */
export const CAUGHT_BUSY_PERCENT = 20;
/** A stretch above the usual range has to last this long to count, so a reading that flickers over doesn't. */
export const ABOVE_MIN_MS = MIN;
/** Stretches above the usual range this close together are one stretch. */
const ABOVE_JOIN_MS = 2 * MIN;
/** Readings are compared after averaging over this long. */
const SMOOTH_MS = 60_000;

/** A game's usual temperature range for one part, from its earlier sessions in history. */
export interface UsualRange {
  game: string;
  /** °C: most of its readings sat between these. */
  lo: number;
  hi: number;
  /** How many history windows it rests on, and the first and last of them. */
  windows: number;
  from: number;
  to: number;
}

/** A stretch of the recording when the part read above its usual range, or near its limit where there's no usual range. */
export interface AboveStretch { from: number; to: number; peak: number; peakAt: number }

/** One thing the recording rules in or out, as a row. */
export interface CaughtCheck { id: "cpu" | "memory" | "apps" | "power"; ok: boolean; title: string; detail: string }

export interface Caught {
  /** The event the page is about: the first serious one in the recording. */
  event: PCEvent;
  /** The part whose temperature the story follows: the graphics card when the recording has it. */
  part: "gpu" | "cpu";
  /** The game in front just before the event. */
  game: string | null;
  /** The part's reading just before the event, °C. */
  at: number | null;
  /** The usual range of every game in the recording that has one. */
  usual: UsualRange[];
  /** The usual range for the game in front at the event. */
  usualAt: UsualRange | null;
  /** What "above" means: the usual range, or near the part's safe limit when there's none. */
  measure: "usual" | "limit";
  above: AboveStretch[];
  /** The stretch above that held the event. */
  during: AboveStretch | null;
  /** The graphics card stopped working right after: its load sat near zero from `from` until it picked up again. */
  stall: { from: number; to: number; load: number } | null;
  cause: "heat" | "unclear";
  /** The page's title, from the kind of event: "The black screen, caught". */
  title: string;
  /** The short name of the moment, for the chart's legend: "Black screen". */
  moment: string;
  /** What happened, as a phrase: "the graphics driver reset". */
  what: string;
  headline: string;
  /** One or two sentences with the figures. Temperatures in °C, for the viewer's unit to rewrite. */
  summary: string;
  checks: CaughtCheck[];
  /** The same kind of event, logged before the recording started, newest first: it happened when Rig wasn't recording. */
  earlier: PCEvent[];
}

const partName = { gpu: "graphics card", cpu: "processor" } as const;
const mins = (ms: number) => { const m = Math.max(1, Math.round(ms / MIN)); return m === 1 ? "1 minute" : `${m} minutes`; };
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
const app = (name: string) => { const n = name.replace(/\.exe$/i, ""); return n[0].toUpperCase() + n.slice(1); };
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A game's usual range for a part: the middle 80% of its history windows from 14 to 30 days before `before`, the same
 * stretch "hotter than usual" compares against. With too few of those, every earlier window of the game a day or more
 * before. Null when there still aren't enough.
 */
export function usualRange(history: readonly HistoryPoint[], game: string, part: "gpu" | "cpu", before: number): UsualRange | null {
  const mine = history.filter((p) => p.game === game && p[part] != null && p.t < before - DAY);
  const baseline = mine.filter((p) => before - p.t >= USUAL.baselineTo * DAY && before - p.t < USUAL.baselineFrom * DAY);
  const use = baseline.length >= USUAL.minWindows ? baseline : mine;
  if (use.length < USUAL.minWindows) return null;
  const vals = use.map((p) => p[part]!).sort((a, b) => a - b);
  const ts = use.map((p) => p.t);
  return { game, lo: Math.round(percentile(vals, 0.1)), hi: Math.round(percentile(vals, 0.9)), windows: use.length, from: Math.min(...ts), to: Math.max(...ts) };
}

/** Each reading as the average of the readings within half a minute of it, so a single reading that flickers over doesn't count. */
export function smoothed(samples: readonly RecordingSample[], part: "gpu" | "cpu"): Map<number, number> {
  const have = samples.filter((s) => s[part] != null);
  const out = new Map<number, number>();
  let lo = 0, hi = 0, sum = 0;
  for (const s of have) {
    while (hi < have.length && have[hi].t <= s.t + SMOOTH_MS / 2) sum += have[hi++][part]!;
    while (have[lo].t < s.t - SMOOTH_MS / 2) sum -= have[lo++][part]!;
    out.set(s.t, sum / (hi - lo));
  }
  return out;
}

/** Stretches where `over` holds for the smoothed reading, joined across short dips, and dropped when shorter than a minute. */
function aboveStretches(samples: readonly RecordingSample[], part: "gpu" | "cpu", smooth: Map<number, number>, over: (s: RecordingSample, v: number) => boolean, intervalMs: number): AboveStretch[] {
  const runs: RecordingSample[][] = [];
  for (const s of samples) {
    const v = smooth.get(s.t);
    if (v == null || s[part] == null || !over(s, v)) continue;
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (last && s.t - last.t <= Math.max(ABOVE_JOIN_MS, intervalMs * 3)) run.push(s);
    else runs.push([s]);
  }
  return runs.filter((r) => r[r.length - 1].t - r[0].t >= ABOVE_MIN_MS).map((r) => {
    const top = r.reduce((a, b) => (b[part]! > a[part]! ? b : a));
    return { from: r[0].t, to: r[r.length - 1].t, peak: top[part]!, peakAt: top.t };
  });
}

const words: Record<string, { title: string; moment: string; what: (e: PCEvent) => string }> = {
  driver: { title: "The black screen, caught", moment: "Black screen", what: () => "the graphics driver reset" },
  crash: { title: "The crash, caught", moment: "Crash", what: (e) => { const t = eventTitle(e); return t[0].toLowerCase() + t.slice(1); } },
  shutdown: { title: "The sudden switch-off, caught", moment: "Switched off", what: () => "the PC turned off" },
  hardware: { title: "The hardware error, caught", moment: "Hardware error", what: () => "Windows logged a hardware error" },
};

/**
 * What a finished recording caught, or null when it caught nothing serious: then its page keeps the usual layout.
 * `history` gives each game's usual range; `events` is the PC's event log, for the times it happened before.
 */
export function caughtProblem(rec: Pick<Recording, "samples" | "events" | "intervalMs" | "startedAt">, sum: RecordingSummary, opts: { limits?: Limits; history?: readonly HistoryPoint[]; events?: readonly PCEvent[] } = {}): Caught | null {
  const samples = [...rec.samples].sort((a, b) => a.t - b.t);
  const event = [...rec.events].filter((e) => CAUGHT_KINDS.includes(e.kind)).sort((a, b) => a.t - b.t)[0];
  if (!event || samples.length < 2) return null;
  const part: "gpu" | "cpu" = samples.some((s) => s.gpu != null) ? "gpu" : "cpu";
  const limit = opts.limits?.[part];
  const start = rec.startedAt ?? samples[0].t;

  const before = samples.filter((s) => s.t <= event.t && s[part] != null).at(-1) ?? null;
  const game = before?.game ?? null;
  const games = [...new Set(samples.map((s) => s.game).filter((g): g is string => !!g))];
  const usual = opts.history ? games.map((g) => usualRange(opts.history!, g, part, start)).filter((u): u is UsualRange => !!u) : [];
  const usualAt = usual.find((u) => u.game === game) ?? null;
  const measure = usualAt ? "usual" : "limit";
  const rangeOf = (s: RecordingSample) => usual.find((u) => u.game === s.game);
  // Above the usual range means the smoothed reading rounds to more than its top.
  const over = measure === "usual" ? (s: RecordingSample, v: number) => { const u = rangeOf(s); return !!u && Math.round(v) > u.hi; } : (_s: RecordingSample, v: number) => limit != null && Math.round(v) >= limit - RECORD_HOT_MARGIN;
  const smooth = smoothed(samples, part);
  const above = aboveStretches(samples, part, smooth, over, rec.intervalMs);
  const during = above.find((a) => event.t >= a.from - rec.intervalMs && event.t <= a.to + rec.intervalMs * 2) ?? null;
  // The reading just before, smoothed like the stretches, so it agrees with them.
  const at = before ? Math.round(smooth.get(before.t) ?? before[part]!) : null;

  // A graphics card that stops working right after the event: its load near zero until it picks up again.
  let stall: Caught["stall"] = null;
  const after = samples.filter((s) => s.t > event.t && s.gpuLoad != null);
  if (after.length && (before?.gpuLoad ?? 0) >= 50 && after[0].gpuLoad! <= CAUGHT_BUSY_PERCENT && after[0].t - event.t <= rec.intervalMs * 2) {
    const back = after.find((s) => s.gpuLoad! >= 50);
    if (back) stall = { from: event.t, to: back.t, load: Math.min(...after.filter((s) => s.t < back.t).map((s) => s.gpuLoad!)) };
  }

  const kind = words[event.kind] ?? words.hardware;
  const what = kind.what(event);
  const checks = checksOf(rec, samples, sum, { part, game, limits: opts.limits ?? {}, event });
  const cause = during ? "heat" : "unclear";
  const name = partName[part];
  const summary = cause === "heat"
    ? (measure === "usual"
      ? `The ${name} had been above your normal for ${game} ${event.t - during!.from >= MIN ? `for ${mins(event.t - during!.from)}` : "for under a minute"} and was at ${at}°C when ${what}.`
      : `The ${name} had been within ${RECORD_HOT_MARGIN}° of its ${limit}°C limit ${event.t - during!.from >= MIN ? `for ${mins(event.t - during!.from)}` : "for under a minute"} and was at ${at}°C when ${what}.`)
    + (checks.every((c) => c.ok) ? "" : ` ${checks.filter((c) => !c.ok).map((c) => c.title).join(". ")}.`)
    : [
      at != null ? `The ${name} was at ${at}°C${usualAt ? `, inside your normal for ${game},` : ""} when ${what}.` : `Rig has no ${name} reading from just before ${what}.`,
      checks.every((c) => c.ok) ? "Nothing else Rig watched was out of the ordinary either." : `${checks.filter((c) => !c.ok).map((c) => c.title).join(". ")}.`,
    ].join(" ");
  const headline = cause === "heat" ? "Heat most likely set it off" : checks.every((c) => c.ok) ? "Nothing in the readings explains it" : "Heat doesn't explain it";
  const earlier = (opts.events ?? []).filter((e) => e.kind === event.kind && eventTitle(e) === eventTitle(event) && e.t < start).sort((a, b) => b.t - a.t);
  return { event, part, game, at, usual, usualAt, measure, above, during, stall, cause, title: kind.title, moment: kind.moment, what, headline, summary, checks, earlier };
}

/** The rows that rule things in or out: the processor (when the story follows the graphics card), memory, other apps and power. */
function checksOf(rec: Pick<Recording, "events" | "intervalMs">, samples: readonly RecordingSample[], sum: RecordingSummary, o: { part: "gpu" | "cpu"; game: string | null; limits: Limits; event: PCEvent }): CaughtCheck[] {
  const out: CaughtCheck[] = [];
  const cpu = sum.stats.cpu;
  if (o.part === "gpu" && cpu) {
    const limit = o.limits.cpu;
    const pinned = sum.moments.find((m) => m.kind === "pinned" && /processor/i.test(m.title));
    if (limit != null && cpu.max >= limit - RECORD_HOT_MARGIN) out.push({ id: "cpu", ok: false, title: "The processor ran hot too", detail: `Up to ${cpu.max}°C, against its ${limit}°C limit` });
    else if (pinned) out.push({ id: "cpu", ok: false, title: pinned.title, detail: pinned.detail });
    else out.push({ id: "cpu", ok: true, title: "Not the processor", detail: limit != null ? `${cpu.max}°C at most, ${limit - cpu.max}° under its limit` : `${cpu.max}°C at most` });
  }

  const mem = sum.stats.mem;
  if (mem) out.push(mem.max >= PINNED_PERCENT ? { id: "memory", ok: false, title: "Memory was nearly full", detail: `Up to ${mem.max}% in use` } : { id: "memory", ok: true, title: "Not memory", detail: `${mem.max}% in use at most, plenty to spare` });

  if (sum.offenders.length) {
    const own = o.game ? sum.offenders.find((x) => squash(app(x.name)) === squash(o.game!)) ?? sum.offenders.find((x) => (x.gpuMax ?? 0) >= 30) : undefined;
    const others = sum.offenders.filter((x) => x !== own).sort((a, b) => b.cpuMax - a.cpuMax);
    const next = others[0];
    if (next && next.cpuMax >= CAUGHT_BUSY_PERCENT) out.push({ id: "apps", ok: false, title: `${app(next.name)} was busy too`, detail: `Up to ${next.cpuMax}% of the processor` });
    else if (o.game) out.push({ id: "apps", ok: true, title: "Not another app", detail: `Only ${o.game} was busy${next ? `. ${app(next.name)} used ${next.cpuMax}% at most` : ""}` });
    else out.push({ id: "apps", ok: true, title: "Not a busy app", detail: next ? `The busiest, ${app(next.name)}, used ${next.cpuMax}% at most` : "Nothing was busy" });
  }

  if (o.event.kind !== "shutdown") {
    const power = rec.events.find((e) => e !== o.event && (e.kind === "shutdown" || e.kind === "power"));
    let gap = 0;
    for (let i = 1; i < samples.length; i++) gap = Math.max(gap, samples[i].t - samples[i - 1].t);
    if (power) out.push({ id: "power", ok: false, title: "Windows logged a power change", detail: eventTitle(power) });
    else if (gap > rec.intervalMs * 3) out.push({ id: "power", ok: false, title: "The readings stopped for a while", detail: `No readings for ${mins(gap)}, so the PC may have restarted` });
    else out.push({ id: "power", ok: true, title: "The power held", detail: "The PC stayed on, and Windows logged no power problem" });
  }
  return out;
}
