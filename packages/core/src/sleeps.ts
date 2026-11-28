// How much battery a laptop used while it slept. A person shuts the lid at
// 80% and opens it the next morning at 40%: this works out each sleep from
// what Rig already records, says how much it used, and, when that was a lot,
// what Windows says woke it, with a plain next step. Pure functions, so the
// desktop, the website (through the uploaded view) and the demo say the same.
//
// Where the pieces come from (all read-only):
// - When it went to sleep and woke: the background recorder's own power lines (Windows tells the service as it
//   suspends and resumes), and Windows' Modern Standby events, Kernel-Power 506 and 507, for laptops that never
//   suspend in the old way (helper/RigHelper/RecorderService.cs).
// - The charge at each end: the recorder reads the battery as it writes each of those lines, and its readings and
//   Rig's own history fill in where a line has none.
// - What woke it: Windows' Power-Troubleshooter event 1, its WakeSourceText field (the same field rules/logs.json
//   gives the chat's log reads).

import type { HistoryPoint } from "./model";
import { HISTORY_WINDOW_MS } from "./model";

/** Windows went to sleep or woke. `pct`: the charge then, percent. `ac`: on the charger then. Either is missing when it wasn't read. */
export interface SleepMoment { t: number; what: "sleep" | "wake"; pct?: number | null; ac?: boolean | null }
/** What Windows says woke it: the device or timer as Power-Troubleshooter names it ("Device -Intel(R) Wi-Fi 6E AX211 160MHz"). */
export interface WakeSource { t: number; by: string }
/** One battery reading from the background recorder. `onBattery` is null when it didn't say which way the power went. */
export interface ChargeReading { t: number; pct: number; onBattery: boolean | null }

/** What the recorder keeps about sleep, for sleepsOf. History points add their own charge readings. */
export interface SleepLog { moments: SleepMoment[]; wokeBy: WakeSource[]; charge: ChargeReading[] }

export type WakeKind = "wifi" | "network" | "device" | "timer" | "you" | "other";

/** One sleep on battery, as the battery page shows it. Times in milliseconds. */
export interface SleepView {
  from: number;
  to: number;
  /** Charge when it went to sleep and when it woke, percent. */
  fromPct: number;
  toPct: number;
  /** Points of charge it used. */
  used: number;
  /** Hours asleep, to one decimal. */
  hours: number;
  /** Points of charge an hour, to one decimal. */
  perHour: number;
  /** It used much more than a sleep should (see HEAVY_PER_HOUR). */
  heavy: boolean;
  /** How many times it woke on its own and went back to sleep in between. */
  woke: number;
  /** What Windows says woke it most often while it was meant to be asleep, when it named something. */
  cause?: { kind: WakeKind; name: string; times: number };
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** The same moment from the service and from Windows' own event arrive within this of each other. */
const SAME_MS = 2 * MIN;
/**
 * An unattended wake (a network adapter, a timer) goes back to sleep after about two minutes, Windows' own unattended
 * sleep timeout. Awake for less than this between two sleeps, nobody opened the lid: the two are one night's sleep.
 */
const BRIEF_AWAKE_MS = 5 * MIN;
/** Shorter sleeps are left out: a percent or two either way says nothing about an hour's rate. */
const MIN_SLEEP_MS = HOUR;
/** A charge reading this far before going to sleep still says what it went to sleep with. */
const BEFORE_MS = 15 * MIN;
/**
 * Right as it wakes, Windows can still report the charge from before it slept, so a reading a little after waking says
 * more. One later than this has been used awake.
 */
const SETTLE_MS = 30_000;
const AFTER_MS = 10 * MIN;
/** What Windows says woke it belongs to a wake when it's logged this close after it (or a moment before). */
const SOURCE_AFTER_MS = 5 * MIN;

/**
 * More than this many points of charge an hour is a heavy sleep. A laptop properly asleep uses about 1% an hour or less
 * (Modern Standby aims for much less), and one awake doing nothing uses 5 to 10. Over 3 means it spent a good part of the
 * night awake, or something kept it busy. HEAVY_MIN_USED keeps a short sleep's rounding from tripping it.
 */
export const HEAVY_PER_HOUR = 3;
const HEAVY_MIN_USED = 6;
/** Things to look at says so only when it's clearly high: a sleep in the last few days that used this much at a heavy rate. */
const LOOK_MIN_USED = 15;
const LOOK_DAYS = 3;
/** The battery page lists this many sleeps, newest first, from the last week. */
const SHOWN = 5;
const WEEK = 7 * 24 * HOUR;

/** Moments in order, with the service's and Windows' word for the same one made into one. */
function merged(moments: readonly SleepMoment[]): SleepMoment[] {
  const out: SleepMoment[] = [];
  for (const m of [...moments].sort((a, b) => a.t - b.t)) {
    const same = out.find((o) => o.what === m.what && Math.abs(o.t - m.t) <= SAME_MS);
    if (!same) { out.push({ ...m }); continue; }
    same.pct ??= m.pct;
    same.ac ??= m.ac;
  }
  return out;
}

/** The charge readings from the recorder and Rig's history, oldest first. A history point's charge is from the end of its window. */
function readings(log: SleepLog | undefined, history: readonly HistoryPoint[]): ChargeReading[] {
  const fromHistory = history.filter((p) => p.batt != null).map((p) => ({ t: p.t + HISTORY_WINDOW_MS, pct: p.batt!, onBattery: p.drain !== undefined ? p.drain != null : null }));
  return [...(log?.charge ?? []), ...fromHistory].sort((a, b) => a.t - b.t);
}

/** "Device -Intel(R) Wi-Fi 6E AX211 160MHz" as a person would say it: "Intel Wi-Fi 6E AX211". */
export function wakeName(by: string): string {
  return by.replace(/^\s*device\s*-\s*/i, "").replace(/\((R|TM|C)\)/gi, "").replace(/\b\d+\s?MHz\b/i, "")
    .replace(/\s+(wireless lan card|network adapter|network connection|family controller|controller|adapter)\s*$/i, "")
    .replace(/\s+/g, " ").trim();
}

/** What kind of thing woke it, from the name Windows gives. */
export function wakeKind(by: string): WakeKind {
  if (/^\s*timer\b/i.test(by)) return "timer";
  if (/power button|\blid\b/i.test(by)) return "you";
  if (/wi-?fi|wireless|wlan|802\.11/i.test(by)) return "wifi";
  if (/ethernet|gbe|\blan\b|network|killer/i.test(by)) return "network";
  if (/usb|hid|keyboard|mouse|touchpad|bluetooth|pen\b/i.test(by)) return "device";
  return "other";
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Each sleep on battery that Rig can measure, newest first, from the last week. A sleep it woke from briefly on its own
 * (a network adapter, a timer) and went back to is one sleep, with the times it woke counted. A sleep on the charger, or
 * one whose charge at either end Rig didn't read, isn't listed: nothing is guessed. Desktops get none.
 */
export function sleepsOf(kind: string | undefined, log: SleepLog | undefined, history: readonly HistoryPoint[], now: number): SleepView[] {
  if (kind !== "laptop" || !log) return [];
  const moments = merged(log.moments.filter((m) => m.t <= now && m.t >= now - WEEK - 2 * 24 * HOUR));
  // Each sleep with the wake that ended it.
  const pairs: { sleep: SleepMoment; wake: SleepMoment }[] = [];
  let open: SleepMoment | null = null;
  for (const m of moments) {
    if (m.what === "sleep") open ??= m;
    else if (open) { pairs.push({ sleep: open, wake: m }); open = null; }
  }
  // Brief wakes in between join a night into one.
  const nights: { sleep: SleepMoment; wake: SleepMoment; between: SleepMoment[] }[] = [];
  for (const p of pairs) {
    const last = nights[nights.length - 1];
    if (last && p.sleep.t - last.wake.t <= BRIEF_AWAKE_MS) { last.between.push(last.wake); last.wake = p.wake; }
    else nights.push({ ...p, between: [] });
  }
  const charge = readings(log, history);
  const out: SleepView[] = [];
  for (const n of nights) {
    const from = n.sleep.t, to = n.wake.t;
    if (to - from < MIN_SLEEP_MS || to < now - WEEK) continue;
    const before = [...charge].reverse().find((c) => c.t <= from && c.t >= from - BEFORE_MS);
    const after = charge.find((c) => c.t >= to + SETTLE_MS && c.t <= to + AFTER_MS);
    const fromPct = n.sleep.pct ?? before?.pct;
    // A reading after waking that's already on the charger may have filled a little: the line's own reading is closer then.
    const toPct = after && after.onBattery !== false ? after.pct : n.wake.pct ?? after?.pct;
    if (fromPct == null || toPct == null) continue;
    // On battery the whole time: off the charger as it slept and as it woke, and it didn't fill while asleep.
    const offAtStart = n.sleep.ac != null ? !n.sleep.ac : before?.onBattery;
    const plugged = n.wake.ac === true || [...n.between].some((m) => m.ac === true) || toPct > fromPct + 1;
    if (offAtStart !== true || plugged) continue;
    const used = Math.max(0, Math.round(fromPct - toPct));
    const hours = (to - from) / HOUR;
    const perHour = round1(used / hours);
    const view: SleepView = { from, to, fromPct: Math.round(fromPct), toPct: Math.round(toPct), used, hours: round1(hours), perHour, heavy: used >= HEAVY_MIN_USED && perHour > HEAVY_PER_HOUR, woke: n.between.length };
    const cause = causeOf(n.between, log.wokeBy);
    if (cause) view.cause = cause;
    out.push(view);
  }
  return out.sort((a, b) => b.from - a.from).filter((s) => s.from >= now - WEEK).slice(0, SHOWN);
}

/** What woke it most often in the night's brief wakes, when Windows named it. A wake by the power button or the lid is the person, not a cause. */
function causeOf(wakes: readonly SleepMoment[], sources: readonly WakeSource[]): SleepView["cause"] | undefined {
  const counts = new Map<string, number>();
  for (const w of wakes) {
    const src = sources.find((s) => s.t >= w.t - MIN && s.t <= w.t + SOURCE_AFTER_MS);
    if (!src || wakeKind(src.by) === "you") continue;
    counts.set(src.by, (counts.get(src.by) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return top ? { kind: wakeKind(top[0]), name: wakeName(top[0]), times: top[1] } : undefined;
}

// ----- Words -----

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const weekday = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short" });
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** When a sleep was, the way a person says it: "Last night", "Tue night", "Today 1:10 PM". A night starts at 6 PM and runs to 5 AM. */
export function sleepWhen(s: Pick<SleepView, "from">, now: number): string {
  const h = new Date(s.from).getHours();
  if (h >= 18 || h < 5) {
    // The evening it began, so a sleep that started after midnight still belongs to the night before.
    const evening = dayStart(h < 5 ? s.from - 6 * HOUR : s.from);
    const days = Math.round((dayStart(now) - evening) / (24 * HOUR));
    return days <= 1 ? "Last night" : `${weekday(evening)} night`;
  }
  return `${dayStart(s.from) === dayStart(now) ? "Today" : weekday(s.from)} ${clock(s.from)}`;
}

/** The same inside a sentence: "last night", "today", "on Tue night". */
export function sleepWhenSaid(s: Pick<SleepView, "from">, now: number): string {
  const when = sleepWhen(s, now);
  return when === "Last night" ? "last night" : when.startsWith("Today") ? "today" : `on ${when}`;
}

/** Hours asleep, the short way: "9 h", "2 h 30 min". */
export function asleepFor(hours: number): string {
  const m = Math.round((hours * 60) / 10) * 10;
  const h = Math.floor(m / 60), rest = m % 60;
  return h === 0 ? `${rest} min` : rest ? `${h} h ${rest} min` : `${h} h`;
}

/** The row's title: "9 h asleep, used 38%". */
export const sleepTitle = (s: SleepView) => `${asleepFor(s.hours)} asleep, used ${s.used}%`;
/** Its grey line: "11:40 PM to 8:40 AM · 80% to 42%". */
export const sleepMeta = (s: SleepView) => `${clock(s.from)} to ${clock(s.to)} · ${s.fromPct}% to ${s.toPct}%`;

/** "about 4% an hour", "under 1% an hour". */
export const perHourText = (v: number) => (v < 1 ? "under 1% an hour" : `about ${Math.round(v)}% an hour`);

/** What woke it, in a sentence, and the next step, in another. `word` is "laptop". Null when Windows didn't name anything. */
export function sleepCause(s: SleepView, word = "laptop"): { what: string; next: string; ask: string } | null {
  const c = s.cause;
  const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
  if (!c) {
    if (!s.heavy) return null;
    return {
      what: s.woke ? `It woke ${times(s.woke)} on its own, and Windows didn't say what woke it.` : "Something kept it awake, and Windows didn't say what.",
      next: "Rig can look at what Windows logged that night.",
      ask: `My ${word} used ${s.used}% of its battery asleep (${sleepMeta(s)}). What kept it awake?`,
    };
  }
  switch (c.kind) {
    case "wifi":
    case "network": {
      const adapter = c.kind === "wifi" ? "Wi-Fi adapter" : "network adapter";
      return {
        what: `It woke ${times(c.times)} for its ${adapter}, ${c.name}.`,
        next: `Windows lets a ${adapter} wake the ${word} to stay connected. Turning that off for this adapter usually stops it.`,
        ask: `My ${word} woke ${times(c.times)} overnight for its ${adapter} (${c.name}) and used ${s.used}% of its battery asleep. How do I stop the adapter waking it?`,
      };
    }
    case "device":
      return {
        what: `It woke ${times(c.times)} for ${c.name}.`,
        next: `A mouse or other device plugged in or nearby can wake it. Unplug it before you close the lid, or Rig can help stop it waking the ${word}.`,
        ask: `My ${word} woke ${times(c.times)} overnight for ${c.name} and used ${s.used}% of its battery asleep. How do I stop that device waking it?`,
      };
    case "timer":
      return {
        what: `Windows woke it ${times(c.times)} to run scheduled tasks, like updates.`,
        next: `Rig can show which tasks those were and whether they need to wake the ${word}.`,
        ask: `Windows woke my ${word} ${times(c.times)} overnight for scheduled tasks and it used ${s.used}% of its battery asleep. Which tasks were they, and can I stop them waking it?`,
      };
    default:
      return {
        what: `It woke ${times(c.times)} for ${c.name}.`,
        next: `Rig can help stop that waking the ${word}.`,
        ask: `My ${word} woke ${times(c.times)} overnight for ${c.name} and used ${s.used}% of its battery asleep. How do I stop that?`,
      };
  }
}

/** A heavy sleep from the last few days that used a lot: the one Things to look at mentions. Null when none did. */
export function clearlyHeavy(sleeps: readonly SleepView[], now: number): SleepView | null {
  return sleeps.find((s) => s.heavy && s.used >= LOOK_MIN_USED && s.to >= now - LOOK_DAYS * 24 * HOUR) ?? null;
}
