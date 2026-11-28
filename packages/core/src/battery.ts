// A laptop's battery as a person thinks about it: how long it will last, what
// drained it today, and the few reversible changes that would stretch it on
// this PC now. Pure functions over the live readings, the recorded history
// and the settings, so the desktop, the website and the demo say the same.

import type { ActionCall } from "./actions";
import { powerSettings } from "./actions";
import type { HistoryPoint } from "./model";
import type { Inventory, Snapshot, SystemFacts } from "./telemetry";

/** What the battery is doing, as LibreHardwareMonitor's battery sensors say. */
export interface BatteryNow {
  /** Charge left, percent. Null when the battery didn't report it. */
  level: number | null;
  /** discharging: on battery. charging: plugged in and filling. plugged: plugged in, neither (full, or held below full). Null when no rate came. */
  state: "discharging" | "charging" | "plugged" | null;
  /** Watts going out (discharging) or in (charging). */
  watts: number | null;
}

/** The battery's readings in a snapshot, or null when the PC reports no battery. */
export function readBattery(snap: Snapshot | null | undefined): BatteryNow | null {
  const mine = snap?.sensors.filter((s) => s.hw === "battery" && s.value != null) ?? [];
  if (!mine.length) return null;
  const level = mine.find((s) => s.type === "level" && /charge level/i.test(s.name))?.value ?? null;
  // LibreHardwareMonitor names the rate by what it's doing ("Discharge Rate", "Charge Rate"), or "Charge/Discharge Rate" with a sign.
  const rate = mine.find((s) => s.type === "power" && /rate/i.test(s.name));
  let state: BatteryNow["state"] = null;
  let watts: number | null = null;
  if (rate) {
    const v = rate.value!;
    if (/^discharg/i.test(rate.name)) [state, watts] = ["discharging", Math.abs(v)];
    else if (/^charge rate/i.test(rate.name)) [state, watts] = [Math.abs(v) < 0.05 ? "plugged" : "charging", Math.abs(v)];
    else if (v < -0.05) [state, watts] = ["discharging", -v];
    else if (v > 0.05) [state, watts] = ["charging", v];
    else [state, watts] = ["plugged", 0];
  }
  return { level: level == null ? null : Math.min(100, Math.max(0, level)), state, watts };
}

// ----- Time left -----

/** "3 h 10 min", "45 min": ten-minute steps over an hour, five under it. */
export function hoursMinutes(minutes: number): string {
  if (minutes < 10) return "under 10 min";
  if (minutes < 60) return `${Math.round(minutes / 5) * 5} min`;
  const m = Math.round(minutes / 10) * 10;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Past this, an estimate says more about a quiet moment than about the battery, so Rig says nothing. */
const MAX_HOURS = 24;
/** Under this a rate is too small to read a time from. */
const MIN_WATTS = 0.5;

export interface TimeLeft {
  /** The sentence: "About 3 h 10 min left at this rate", "Full in about 40 min", "Plugged in and full". */
  text: string;
  /** The figure on its own, for a tile: "3 h 10 min". Missing when there's no time to show. */
  figure?: string;
  /** What the figure is: "Left on battery" or "Until full". */
  label?: string;
  /** What the figure is worked out from, under it: "at this rate" or "at the last hour's rate". */
  basis?: string;
  /** A second line, when the last hour's average says something different: "At the last hour's average it would last about 4 h". */
  note?: string;
}

/** Minutes to fill from a level at a rate. Batteries slow down near full, so the last fifth is counted at half the rate. */
function minutesToFull(level: number, fullWh: number, watts: number): number {
  const wh = (pct: number) => (pct / 100) * fullWh;
  const fast = level < 80 ? wh(80 - level) / watts : 0;
  const slow = level < 80 ? wh(20) / (watts / 2) : wh(100 - level) / watts;
  return (fast + slow) * 60;
}

/**
 * How long the battery lasts at the rate it's going now, and at the average of the last hour on battery
 * (`recentWatts`, from recordedDrain). Null when the readings don't say: no level, no rate, no capacity.
 */
export function timeLeft(now: BatteryNow, fullWh: number | undefined, recentWatts?: number | null): TimeLeft | null {
  const { level, state, watts } = now;
  if (level == null || state == null) return null;
  if (state === "plugged") return { text: level >= 99 ? "Plugged in and full" : `Plugged in, holding at ${Math.round(level)}%` };
  if (!fullWh) return null;
  const left = (w: number) => ((level / 100) * fullWh / w) * 60;
  if (state === "charging") {
    if (watts == null || watts < MIN_WATTS) return null;
    const m = minutesToFull(level, fullWh, watts);
    return m / 60 > MAX_HOURS ? null : { text: `Full in about ${hoursMinutes(m)}`, figure: hoursMinutes(m), label: "Until full" };
  }
  const nowM = watts != null && watts >= MIN_WATTS ? left(watts) : null;
  const avgM = recentWatts != null && recentWatts >= MIN_WATTS ? left(recentWatts) : null;
  const ok = (m: number | null): m is number => m != null && m / 60 <= MAX_HOURS;
  if (ok(nowM)) {
    const differs = ok(avgM) && Math.abs(avgM - nowM) >= Math.max(15, nowM * 0.15) && hoursMinutes(avgM) !== hoursMinutes(nowM);
    return {
      text: `About ${hoursMinutes(nowM)} left at this rate`, figure: hoursMinutes(nowM), label: "Left on battery", basis: "at this rate",
      ...(differs ? { note: `At the last hour's average it would last about ${hoursMinutes(avgM)}` } : {}),
    };
  }
  if (ok(avgM)) return { text: `About ${hoursMinutes(avgM)} left at the last hour's rate`, figure: hoursMinutes(avgM), label: "Left on battery", basis: "at the last hour's rate" };
  return null;
}

// ----- What drained it -----

const MIN = 60_000;
/** Two history points this far apart or less belong to one stretch on battery. */
const JOIN_MS = 25 * MIN;

/** The latest stretch of history on battery: points in a row that drew from it, the last within JOIN_MS of `end`. */
function lastRun(history: readonly HistoryPoint[], end: number): { run: HistoryPoint[]; before?: HistoryPoint } {
  const pts = history.filter((p) => p.t <= end).sort((a, b) => a.t - b.t);
  let i = pts.length - 1;
  while (i >= 0 && pts[i].drain == null) i--;
  if (i < 0) return { run: [] };
  const run: HistoryPoint[] = [pts[i]];
  for (let j = i - 1; j >= 0 && pts[j].drain != null && run[0].t - pts[j].t <= JOIN_MS; j--) run.unshift(pts[j]);
  const prev = pts[pts.indexOf(run[0]) - 1];
  return { run, before: prev && run[0].t - prev.t <= JOIN_MS ? prev : undefined };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The average draw over the last hour on battery, when the PC is on battery now and the history has at least half an hour of it. */
export function recordedDrain(history: readonly HistoryPoint[], now: number): number | null {
  const { run } = lastRun(history, now);
  if (!run.length || now - run[run.length - 1].t > JOIN_MS) return null;
  const hour = run.filter((p) => now - p.t <= 60 * MIN).map((p) => p.drain!);
  return hour.length >= 3 ? Math.round(mean(hour) * 10) / 10 : null;
}

/** App names the way people say them. Anything else loses ".exe" and gets a capital. */
const appNames: Record<string, string> = {
  chrome: "Chrome", msedge: "Edge", firefox: "Firefox", brave: "Brave", opera: "Opera", "ms-teams": "Teams", teams: "Teams",
  excel: "Excel", winword: "Word", powerpnt: "PowerPoint", outlook: "Outlook", olk: "Outlook", onenote: "OneNote",
  code: "VS Code", zoom: "Zoom", slack: "Slack", discord: "Discord", spotify: "Spotify", onedrive: "OneDrive", msmpeng: "Windows Security",
};
export function appName(exe: string): string {
  const n = exe.replace(/\.exe$/i, "");
  return appNames[n.toLowerCase()] ?? n.charAt(0).toUpperCase() + n.slice(1);
}

const hourLabel = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric" });
/** "2–3 PM", "11 AM–12 PM", "14–15". */
function hourRange(from: number): string {
  const a = hourLabel(from), b = hourLabel(from + 60 * MIN);
  const sa = /\s?[AP]M$/i.exec(a)?.[0], sb = /\s?[AP]M$/i.exec(b)?.[0];
  return sa && sa === sb ? `${a.slice(0, -sa.length)}–${b}` : `${a}–${b}`;
}
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfHour = (t: number) => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);

/**
 * Today's time on battery in a sentence or two, from the recorded history: where the charge went from and to, and when it
 * fell fastest and what was busy then, but only the parts the history backs. `live` is the battery now, which gives the
 * latest level while it's still on battery. Null when there's nothing to tell: no time on battery today, or too little.
 */
export function drainStory(history: readonly HistoryPoint[], now: number, live?: BatteryNow | null): string | null {
  const { run, before } = lastRun(history, now);
  if (run.length < 3) return null;
  const last = run[run.length - 1];
  const ongoing = live?.state === "discharging" && now - last.t <= JOIN_MS;
  const endT = ongoing ? now : last.t + 10 * MIN;
  if (endT < startOfDay(now)) return null;
  const from = before?.batt ?? run.find((p) => p.batt != null)?.batt;
  const to = ongoing && live?.level != null ? live.level : [...run].reverse().find((p) => p.batt != null)?.batt;
  if (from == null || to == null || from - to < 5) return null;
  const startT = run[0].t;
  const minutes = (endT - startT) / MIN;
  if (minutes < 30) return null;
  const went = `${ongoing ? "Went" : "Earlier today it went"} from ${Math.round(from)}% to ${Math.round(to)}% in ${hoursMinutes(minutes)}${ongoing ? "" : " on battery"}.`;

  // The clock hour it fell fastest, when at least two hours have enough readings and one clearly drew more than the stretch did.
  const hours = new Map<number, HistoryPoint[]>();
  for (const p of run) { const h = startOfHour(p.t + 5 * MIN); hours.set(h, [...(hours.get(h) ?? []), p]); }
  const full = [...hours].filter(([, ps]) => ps.length >= 3);
  if (full.length < 2) return went;
  const avg = mean(run.map((p) => p.drain!));
  const [top, pts] = full.reduce((a, b) => (mean(b[1].map((p) => p.drain!)) > mean(a[1].map((p) => p.drain!)) ? b : a));
  if (mean(pts.map((p) => p.drain!)) < avg * 1.2) return went;
  // The apps busy in at least half of that hour's windows, most often first.
  const seen = new Map<string, number>();
  for (const p of pts) for (const a of new Set((p.apps ?? []).map(appName))) seen.set(a, (seen.get(a) ?? 0) + 1);
  const busy = [...seen].filter(([, n]) => n * 2 >= pts.length).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a);
  return `${went} The fastest drop was ${hourRange(top)}${busy.length ? `, while ${and(busy)} ${busy.length > 1 ? "were" : "was"} busy` : ""}.`;
}

// ----- Ways to stretch it -----

/** A power setting as the helper read it, plugged in and on battery, by its id in rules/fixes.json. */
export type PowerNow = Partial<Record<string, { ac: number; dc: number }>>;

/** The power settings the savers look at, which the facts don't hold: the desktop and the demo read them for laptops. */
export const SAVER_SETTINGS = ["displayOffAfter", "sleepAfter"] as const;

export interface BatterySaver {
  id: string;
  /** What it does, in plain words. */
  title: string;
  /** The one grey line: what it changes for you. */
  meta: string;
  /** The fix it reviews, from the catalog in actions.ts. */
  fix: ActionCall[];
}

const minutesText = (s: number) => (s === 0 ? "never" : s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? "" : "s"}` : `${Math.round(s / 60)} minutes`);

/** A power.setting call that changes only the battery side of one allowed setting. */
function onBattery(id: string, now: { ac: number; dc: number }, dc: number): ActionCall {
  const info = powerSettings.find((p) => p.id === id)!;
  return { kind: "power.setting", subgroup: info.subgroup, setting: info.setting, ac: now.ac, dc };
}

/**
 * Up to three reversible changes that would make the battery last longer on this PC now, from the fixes Rig already has,
 * best first. Each is only offered when it would change something: a setting already where it would go isn't listed.
 * Desktops get none.
 */
export function batterySavers(inv: Inventory, facts: SystemFacts | null, power: PowerNow = {}): BatterySaver[] {
  if (inv.machine.kind !== "laptop" || !facts) return [];
  const out: BatterySaver[] = [];
  const cap = facts.maxProcessorState;
  if (cap.dc === 100) {
    out.push({
      id: "boost", title: "Turn off processor boost on battery", meta: "Runs cooler and lasts longer, a little slower in heavy work.",
      fix: [{ kind: "power.maxProcessorState", ac: cap.ac, dc: 99 }],
    });
  }
  const active = facts.powerPlans.find((p) => p.active);
  const balanced = facts.powerPlans.find((p) => /balanced/i.test(p.name));
  if (active && balanced && active !== balanced && /high performance|ultimate/i.test(active.name)) {
    out.push({ id: "plan", title: "Switch to the Balanced plan", meta: `${active.name} keeps the processor fast even at rest. This applies plugged in too.`, fix: [{ kind: "power.plan", guid: balanced.guid }] });
  }
  const screen = power.displayOffAfter;
  if (screen && (screen.dc === 0 || screen.dc > 600)) {
    out.push({ id: "screen", title: "Turn the screen off after 5 minutes on battery", meta: `Now it stays on ${screen.dc === 0 ? "until you turn it off" : `for ${minutesText(screen.dc)}`} when you step away.`, fix: [onBattery("displayOffAfter", screen, 300)] });
  }
  const sleep = power.sleepAfter;
  if (sleep && (sleep.dc === 0 || sleep.dc > 1800)) {
    out.push({ id: "sleep", title: "Sleep after 15 minutes on battery", meta: `Now it ${sleep.dc === 0 ? "never sleeps" : `sleeps after ${minutesText(sleep.dc)}`} on battery when left alone.`, fix: [onBattery("sleepAfter", sleep, 900)] });
  }
  return out.slice(0, 3);
}

// ----- The view -----

/** The battery as the screens show it. On the PC view, for laptops with a battery. */
export interface BatteryView {
  /** Charge left, percent, rounded. */
  level?: number;
  state?: BatteryNow["state"];
  /** Watts out or in, to one decimal. */
  watts?: number;
  time?: TimeLeft;
  /** Today on battery, in a sentence or two. */
  story?: string;
  savers: BatterySaver[];
}

/** Everything the battery section shows, or undefined for a PC without a battery. */
export function batteryView(inv: Inventory, snap: Snapshot | null, facts: SystemFacts | null, more: { history?: readonly HistoryPoint[]; power?: PowerNow; now?: number } = {}): BatteryView | undefined {
  if (inv.machine.kind !== "laptop") return undefined;
  const live = readBattery(snap);
  if (!live && !inv.battery) return undefined;
  const now = more.now ?? snap?.at ?? Date.now();
  const history = more.history ?? [];
  const time = live ? timeLeft(live, inv.battery?.fullWh, live.state === "discharging" ? recordedDrain(history, now) : null) : null;
  const story = drainStory(history, now, live);
  return {
    ...(live?.level != null ? { level: Math.round(live.level) } : {}),
    ...(live?.state ? { state: live.state } : {}),
    ...(live?.watts != null ? { watts: Math.round(live.watts * 10) / 10 } : {}),
    ...(time ? { time } : {}),
    ...(story ? { story } : {}),
    savers: batterySavers(inv, facts, more.power),
  };
}
