// Alerts: problems worth telling the person about while they aren't looking.
// Each rule reads the live readings and recent history and says what is wrong
// at this moment. trackAlerts turns those moments into alerts: one starts only
// once its problem has lasted the rule's hold time, stays through a brief
// recovery, and keeps its start time when the same problem comes back soon
// after, so one event is one alert. Pure, so the desktop, the demo and the
// tests agree.

import { cpuLimit, cpuTemp, gpuLimit, gpuTemp } from "./health";
import { HISTORY_WINDOW_MS, type Alert, type AlertKind, type HistoryPoint, type Severity } from "./model";
import { findSensor, type Inventory, type Sensor, type Snapshot } from "./telemetry";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface AlertInput {
  inv: Inventory;
  snap: Snapshot | null;
  /** Recorded history covering at least the last USUAL.baselineFrom days, in any order. */
  history: readonly HistoryPoint[];
  now: number;
  /** Ids of alerts that are showing or waiting out their hold, so a rule keeps them on until the reading has clearly recovered. */
  holding: ReadonlySet<string>;
}

/** What a rule finds: an alert without its kind and start time. A rule that can tell from history when the problem began gives since, in milliseconds. */
export type AlertFinding = Omit<Alert, "kind" | "since"> & { since?: number };

export interface AlertRule {
  kind: AlertKind;
  /** What the person turns on or off, in plain words. */
  label: string;
  description: string;
  /** How long a problem has to last before it becomes an alert, so one spike isn't one. */
  holdMs: number;
  check(input: AlertInput): AlertFinding[];
}

// ----- Rules -----

const round = Math.round;

/** At or above `on`, or above `off` while already holding: a problem starts at one line and ends below a lower one. */
const over = (v: number, on: number, off: number, holding: boolean) => v >= (holding ? off : on);

interface Watched { key: "cpu" | "gpu"; name: string; limit: number; temp: Sensor | undefined }

/** The parts with a known safe limit: the processor, and the graphics card when it isn't built into the processor. */
function watched(inv: Inventory, snap: Snapshot | null): Watched[] {
  const out: Watched[] = [{ key: "cpu", name: "Processor", limit: cpuLimit(inv.cpu.name), temp: cpuTemp(snap) }];
  const gpu = inv.gpus.find((g) => !g.integrated);
  if (gpu) out.push({ key: "gpu", name: "Graphics card", limit: gpuLimit(gpu.vendor), temp: gpuTemp(snap) });
  return out;
}

/** °C under the safe limit a part has to cool to before a too-hot alert ends. */
export const LIMIT_MARGIN = 3;

const tooHot: AlertRule = {
  kind: "too-hot",
  label: "A part stays at its safe limit",
  description: "The processor or graphics card stays at its highest safe temperature for a couple of minutes.",
  holdMs: 2 * MIN,
  check: ({ inv, snap, holding }) => watched(inv, snap).flatMap((p): AlertFinding[] => {
    const id = `too-hot:${p.key}`;
    const t = p.temp?.value;
    if (t == null || !over(t, p.limit, p.limit - LIMIT_MARGIN, holding.has(id))) return [];
    const cause = p.key === "gpu" ? "Dust on the intake filters is the usual cause." : "Check that the cooler's fan spins and the vents aren't blocked.";
    return [{
      id, part: p.key, severity: "bad",
      title: `${p.name} is staying at its ${p.limit}°C limit`,
      detail: `It's at ${round(t)}°C, so it slows itself down to cool off. ${cause}`,
      ask: `My ${p.name.toLowerCase()} has been at ${round(t)}°C for a while. What should I do?`,
      covers: [`${p.key}-hot`, `${p.key}-warm`],
    }];
  }),
};

/** A fan reading 0 rpm counts as stopped when its part is within this many °C of its limit, and at least FAN_HOT_MIN. Cards and laptops that rest their fans do it well below this. */
export const FAN_HOT_MARGIN = 20;
export const FAN_HOT_MIN = 65;

/** The fans that cool each watched part: the graphics card's own, and the processor's (the one the PC view shows, or every fan on a laptop). */
function fansFor(inv: Inventory, snap: Snapshot | null): Record<Watched["key"], Sensor[]> {
  const fans = snap?.sensors.filter((s) => s.type === "fan" && s.value != null) ?? [];
  const cpu = inv.machine.kind === "laptop"
    ? fans.filter((s) => s.hw !== "gpu")
    : [findSensor(snap, "board", "fan", /cpu|#1/i) ?? findSensor(snap, "cooler", "fan")].filter((s): s is Sensor => !!s);
  return { cpu, gpu: fans.filter((s) => s.hw === "gpu") };
}

const fanStopped: AlertRule = {
  kind: "fan-stopped",
  label: "A fan stops while its part is hot",
  description: "A fan that was spinning reads 0 rpm while the part it cools is hot.",
  holdMs: 30_000,
  check: ({ inv, snap, holding }) => {
    const laptop = inv.machine.kind === "laptop";
    const fans = fansFor(inv, snap);
    return watched(inv, snap).flatMap((p): AlertFinding[] => {
      const id = `fan-stopped:${p.key}`;
      const t = p.temp?.value;
      // Max is the fastest the helper has seen this fan spin since it started, so a header with nothing on it never counts.
      const stopped = fans[p.key].find((s) => s.value === 0 && (s.max ?? 0) > 0);
      const hot = Math.max(FAN_HOT_MIN, p.limit - FAN_HOT_MARGIN);
      if (t == null || !stopped || !over(t, hot, hot - LIMIT_MARGIN, holding.has(id))) return [];
      const fan = p.key === "gpu" ? "Graphics card fan" : laptop ? "A laptop fan" : "Processor fan";
      const what = p.key === "gpu" ? "card" : "processor";
      const advice = p.key === "gpu" ? "Check that nothing is caught in it and its cable is plugged in."
        : laptop ? "Keep the vents clear. If it stays stopped, the fan may need replacing."
        : "Check that the cooler's fan cable is plugged in and nothing is caught in it.";
      return [{
        id, part: p.key, severity: "bad",
        title: `${fan} has stopped`,
        detail: `It reads 0 rpm while the ${what} is at ${round(t)}°C. ${advice}`,
        ask: `My ${fan.replace(/^A /, "").toLowerCase()} reads 0 rpm while the ${what} is at ${round(t)}°C. What should I do?`,
      }];
    });
  },
};

/** A drive is nearly full below this share of free space, stays so until it's back above DRIVE_CLEAR, and is critical below DRIVE_CRITICAL. */
export const DRIVE_FULL = 0.1;
export const DRIVE_CLEAR = 0.12;
export const DRIVE_CRITICAL = 0.03;

const gbText = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${round(gb)} GB`);

const driveFull: AlertRule = {
  kind: "drive-full",
  label: "A drive is nearly full",
  description: "A drive has less than a tenth of its space free.",
  holdMs: 0,
  check: ({ inv, holding }) => inv.volumes.flatMap((v): AlertFinding[] => {
    if (v.sizeGb <= 0) return [];
    const id = `drive-full:${v.letter}`;
    const free = v.freeGb / v.sizeGb;
    if (free >= (holding.has(id) ? DRIVE_CLEAR : DRIVE_FULL)) return [];
    return [{
      id, part: "ssd", severity: free < DRIVE_CRITICAL ? "bad" : "warn",
      title: `Drive ${v.letter} is nearly full`,
      detail: `${gbText(v.freeGb)} free of ${gbText(v.sizeGb)}. Windows slows down and updates can fail when a drive is this full.`,
      ask: `Drive ${v.letter} only has ${round(v.freeGb)} GB free. What can I safely remove?`,
      covers: [`vol-${v.letter}`],
    }];
  }),
};

/** A drive is nearly worn out below this much of its life left, as the drive itself reports it, and critical below WEAR_CRITICAL. */
export const WEAR_LOW = 20;
export const WEAR_CRITICAL = 10;

const driveWearing: AlertRule = {
  kind: "drive-wearing",
  label: "A drive is wearing out",
  description: "A drive reports less than a fifth of its life left.",
  holdMs: 0,
  check: ({ inv, holding }) => inv.disks.flatMap((d): AlertFinding[] => {
    const id = `drive-wearing:${d.model}`;
    const h = d.healthPercent;
    if (h == null || h >= (holding.has(id) ? WEAR_LOW + 2 : WEAR_LOW)) return [];
    return [{
      id, part: "ssd", severity: h < WEAR_CRITICAL ? "bad" : "warn",
      title: `${d.model} is nearly worn out`,
      detail: `It reports ${h}% of its life left. Back up anything important now and plan to replace it.`,
      ask: `My ${d.model} reports ${h}% of its life left. How soon should I replace it?`,
      covers: [`disk-${d.model}`],
    }];
  }),
};

/**
 * How "hotter than usual" compares like with like: the same game, in the last
 * recentDays days against baselineTo to baselineFrom days ago, each with at
 * least minWindows history windows. It starts at `warmer` °C over the usual
 * and ends below `clear`.
 */
export const USUAL = { recentDays: 7, baselineTo: 14, baselineFrom: 30, minWindows: 6, warmer: 5, clear: 3 };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Windows joined into sessions across gaps of at most one quiet window, oldest first. */
function sessionsOf(points: HistoryPoint[]): HistoryPoint[][] {
  const out: HistoryPoint[][] = [];
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    const run = out[out.length - 1];
    const last = run?.[run.length - 1];
    if (last && p.t - last.t <= 2 * HISTORY_WINDOW_MS) run.push(p);
    else out.push([p]);
  }
  return out;
}

/** The start of the latest unbroken run of sessions that ran at or above `line`, or of the first such session when the latest one didn't. */
function warmSince(points: HistoryPoint[], read: (p: HistoryPoint) => number, line: number): number {
  const sessions = sessionsOf(points);
  const warm = sessions.map((s) => median(s.map(read)) >= line);
  let i = warm.length - 1;
  if (warm[i]) { while (i > 0 && warm[i - 1]) i--; return sessions[i][0].t; }
  const first = warm.indexOf(true);
  return sessions[first >= 0 ? first : 0][0].t;
}

const hotterThanUsual: AlertRule = {
  kind: "hotter-than-usual",
  label: "Running hotter than usual",
  description: "A part runs several degrees warmer in a game than it did in the same game a few weeks ago.",
  holdMs: 0,
  check: ({ inv, history, now, holding }) => watched(inv, null).flatMap((p): AlertFinding[] => {
    const id = `hotter-than-usual:${p.key}`;
    const need = holding.has(id) ? USUAL.clear : USUAL.warmer;
    const read = (x: HistoryPoint) => x[p.key]!;
    const games = new Map<string, { recent: HistoryPoint[]; before: HistoryPoint[] }>();
    for (const x of history) {
      if (!x.busy || !x.game || x[p.key] == null || x.t > now) continue;
      const age = now - x.t;
      const slot = age < USUAL.recentDays * DAY ? "recent" : age >= USUAL.baselineTo * DAY && age < USUAL.baselineFrom * DAY ? "before" : null;
      if (!slot) continue;
      const g = games.get(x.game) ?? { recent: [], before: [] };
      g[slot].push(x);
      games.set(x.game, g);
    }
    let best: { game: string; lately: number; usual: number; recent: HistoryPoint[] } | null = null;
    for (const [game, g] of games) {
      if (g.recent.length < USUAL.minWindows || g.before.length < USUAL.minWindows) continue;
      const lately = median(g.recent.map(read)), usual = median(g.before.map(read));
      if (lately - usual >= need && (!best || g.recent.length > best.recent.length)) best = { game, lately, usual, recent: g.recent };
    }
    if (!best) return [];
    const lately = round(best.lately), usual = round(best.usual);
    return [{
      id, part: p.key, severity: "warn",
      title: `${p.name} runs hotter than it used to`,
      detail: `In ${best.game} it's been at ${lately}°C lately, up from its usual ${usual}°C. Dust on the filters and fans is the usual cause.`,
      ask: `My ${p.name.toLowerCase()} runs at ${lately}°C in ${best.game}, up from ${usual}°C a few weeks ago. Why, and what should I do?`,
      since: warmSince(best.recent, read, best.usual + need),
    }];
  }),
};

/** Every alert Rig raises, in the order Settings lists them. */
export const alertRules: readonly AlertRule[] = [tooHot, fanStopped, hotterThanUsual, driveFull, driveWearing];

// ----- Tracking -----

export interface AlertTrack {
  /** When a rule last reported this problem. */
  last: number;
  /** Set while the problem waits out its rule's hold: when this stretch of it began. */
  pending?: number;
  /** Set while the alert shows. */
  alert?: Alert;
  /** When it last stopped showing, and the start time it had, so the same problem back within the cooldown carries on as the same alert. */
  ended?: number;
  endedSince?: string;
}

/** What trackAlerts remembers between readings. Plain JSON, so it can be kept on disk. */
export interface AlertState { tracks: Record<string, AlertTrack> }

export const emptyAlertState = (): AlertState => ({ tracks: {} });

export interface AlertTiming {
  /** A showing alert stays this long after its rule stops reporting it, so a brief dip doesn't end it. */
  clearMs: number;
  /** An alert that ended and comes back within this long is the same problem: it keeps its start time and isn't new. */
  cooldownMs: number;
}

export const alertTiming: AlertTiming = { clearMs: 2 * MIN, cooldownMs: 30 * MIN };

/** A finding with what tracking needs from its rule. */
export type RuleFinding = AlertFinding & Pick<AlertRule, "kind" | "holdMs">;

/** Ids that are showing or waiting out their hold. */
export function holdingIds(state: AlertState): Set<string> {
  return new Set(Object.entries(state.tracks).filter(([, t]) => t.alert || t.pending != null).map(([id]) => id));
}

/** Every rule's findings for one reading. */
export function runRules(input: AlertInput, rules: readonly AlertRule[] = alertRules): RuleFinding[] {
  return rules.flatMap((r) => r.check(input).map((f) => ({ ...f, kind: r.kind, holdMs: r.holdMs })));
}

const severityRank: Record<Severity, number> = { bad: 0, warn: 1, info: 2, ok: 3 };

/** Most severe first, then the newest. */
export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.since.localeCompare(a.since));
}

/** Moves the alerts on by one reading's findings. */
export function trackAlerts(state: AlertState, found: readonly RuleFinding[], now: number, timing: AlertTiming = alertTiming): { state: AlertState; alerts: Alert[] } {
  const tracks: Record<string, AlertTrack> = {};
  const reported = new Set(found.map((f) => f.id));

  for (const [id, t] of Object.entries(state.tracks)) {
    if (reported.has(id)) continue;
    if (t.alert && now - t.last < timing.clearMs) tracks[id] = t;
    else if (t.alert) tracks[id] = { last: t.last, ended: t.last, endedSince: t.alert.since };
    else if (t.ended != null && now - t.ended < timing.cooldownMs) tracks[id] = { last: t.last, ended: t.ended, endedSince: t.endedSince };
  }

  for (const { since, holdMs, kind, ...f } of found) {
    let old: AlertTrack | undefined = state.tracks[f.id];
    // Not seen for a while (the app was closed, or the helper stopped answering): it ended when it was last seen.
    if (old?.alert && now - old.last >= timing.clearMs) old = { last: old.last, ended: old.last, endedSince: old.alert.since };
    if (old?.alert) { tracks[f.id] = { last: now, alert: { ...f, kind, since: old.alert.since } }; continue; }
    const pending = old?.pending ?? now;
    const resumed = old?.ended != null && now - old.ended < timing.cooldownMs ? old.endedSince : undefined;
    if (now - pending >= holdMs) {
      tracks[f.id] = { last: now, alert: { ...f, kind, since: resumed ?? new Date(since ?? pending).toISOString() } };
    } else {
      tracks[f.id] = { last: now, pending, ...(resumed ? { ended: old!.ended, endedSince: resumed } : {}) };
    }
  }

  const next = { tracks };
  return { state: next, alerts: sortAlerts(Object.values(tracks).flatMap((t) => (t.alert ? [t.alert] : []))) };
}

/** One reading: runs the rules against what's held from before, then tracks the result. */
export function stepAlerts(state: AlertState, input: Omit<AlertInput, "holding">, rules: readonly AlertRule[] = alertRules, timing: AlertTiming = alertTiming) {
  return trackAlerts(state, runRules({ ...input, holding: holdingIds(state) }, rules), input.now, timing);
}

// ----- Showing and notifying -----

/** The alerts to show on a device that turned some kinds off, most severe first. */
export function shownAlerts(alerts: readonly Alert[] | undefined, off: readonly AlertKind[] = []): Alert[] {
  return sortAlerts((alerts ?? []).filter((a) => !off.includes(a.kind)));
}

/** Ids of the issues these alerts already cover. */
export function coveredIssues(alerts: readonly Alert[]): Set<string> {
  return new Set(alerts.flatMap((a) => a.covers ?? []));
}

/** Per alert id: the start time last notified about, and when. */
export type NotifyLog = Record<string, { since: string; at: number }>;

/** At most one notification per alert id this often, even for a new problem. */
export const NOTIFY_COOLDOWN_MS = 6 * HOUR;

/**
 * Which alerts deserve a notification: ones not notified about before, or
 * whose problem started again since, once the id's cooldown has passed. The
 * log comes back updated for every alert passed in, whether or not it gets a
 * notification, so a problem seen while the window was open isn't announced
 * later.
 */
export function alertsToNotify(alerts: readonly Alert[], log: NotifyLog, now: number, cooldownMs = NOTIFY_COOLDOWN_MS): { notify: Alert[]; log: NotifyLog } {
  const showing = new Set(alerts.map((a) => a.id));
  const next: NotifyLog = Object.fromEntries(Object.entries(log).filter(([id, e]) => showing.has(id) || now - e.at < 7 * DAY));
  const notify: Alert[] = [];
  for (const a of alerts) {
    const e = next[a.id];
    if (e?.since === a.since) continue;
    if (!e || now - e.at >= cooldownMs) { notify.push(a); next[a.id] = { since: a.since, at: now }; }
    else next[a.id] = { since: a.since, at: e.at };
  }
  return { notify, log: next };
}
