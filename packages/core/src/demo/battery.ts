// Pebble's battery for the demo: unplugged a couple of hours before the demo
// opened, so it's on battery at about 58% and drawing about 11 W, with a
// video call in the middle that drained it fastest. Before that it sat on the
// charger, full; when it gets low it goes back on the charger and fills.

import type { Inventory } from "../telemetry";
import type { ProcessUse } from "../recordings";
import { activityAt, type Activity } from "./schedule";

const MIN = 60_000;

/** What it did after coming off the charger, minute by minute: light work, then a video call, then steady work. */
const stretches: { minutes: number; what: "light" | "call" | "work" }[] = [{ minutes: 60, what: "light" }, { minutes: 60, what: "call" }, { minutes: Infinity, what: "work" }];
const activity: Record<"light" | "call" | "work", Activity> = {
  light: { cpu: 0.15, gpu: 0.03, game: null },
  call: { cpu: 0.6, gpu: 0.15, game: null },
  work: { cpu: 0.3, gpu: 0.05, game: null },
};
/** The screen and the rest of the laptop at rest, then what the processor adds, in watts. */
const watts = (a: Activity) => 4.6 + a.cpu * 22;
/** Where it was when the demo opened. */
const OPENED_AT = 58;
/** It goes back on the charger here, and charges at this rate until 80%, then slower. */
const PLUG_AT = 12;
const CHARGE_W = 45;

export interface DemoBattery {
  level: number;
  state: "discharging" | "charging" | "plugged";
  /** Watts out or in, before the readings' wobble. */
  watts: number;
  /** What it's doing while on battery, which the readings follow instead of the weekly schedule. */
  activity?: Activity;
  what?: "light" | "call" | "work";
}

function whatAt(m: number) {
  let at = 0;
  for (const s of stretches) { if (m < at + s.minutes) return s.what; at += s.minutes; }
  return "work";
}

/**
 * A minute-by-minute table of the battery from when it came off the charger, for one laptop, worked out the first time
 * it's asked for. Its day is laid out around that moment, when the demo opened, so it's on battery whenever someone looks.
 */
interface Day { unplugged: number; minutes: DemoBattery[] }
const days = new WeakMap<Inventory, Day>();

/** What it does at a minute after coming off the charger: a game or a heavy task from its usual week wins over the plan above. */
function doing(inv: Inventory, t: number, i: number): { a: Activity; what?: DemoBattery["what"] } {
  const usual = activityAt(inv.machine.kind, t);
  if (usual.game || usual.cpu > 0.35) return { a: usual };
  const what = whatAt(i);
  return { a: activity[what], what };
}

/** The table from a moment it came off the charger. */
function table(inv: Inventory, fullWh: number, unplugged: number): DemoBattery[] {
  const minutes: DemoBattery[] = [];
  let level = 100, state: DemoBattery["state"] = "discharging";
  for (let i = 0; i < 24 * 60; i++) {
    if (state === "discharging") {
      const { a, what } = doing(inv, unplugged + i * MIN, i), w = watts(a);
      minutes.push({ level, state, watts: w, activity: a, ...(what ? { what } : {}) });
      level -= (w / 60 / fullWh) * 100;
      if (level <= PLUG_AT) state = "charging";
    } else if (state === "charging") {
      const w = level < 80 ? CHARGE_W : CHARGE_W * (1 - (level - 80) / 25);
      minutes.push({ level, state, watts: w });
      level = Math.min(100, level + (w / 60 / fullWh) * 100);
      if (level >= 100) state = "plugged";
    } else minutes.push({ level: 100, state, watts: 0 });
  }
  return minutes;
}

function dayOf(inv: Inventory): Day | null {
  const fullWh = inv.battery?.fullWh;
  if (inv.machine.kind !== "laptop" || !fullWh) return null;
  let d = days.get(inv);
  if (d) return d;
  // Find when it came off the charger, so that it's at OPENED_AT now. What it did depends on the hour, so this settles in a few rounds.
  const now = Date.now();
  let unplugged = now - 133 * MIN, minutes = table(inv, fullWh, unplugged);
  for (let round = 0; round < 4; round++) {
    const at = minutes.findIndex((x) => x.level <= OPENED_AT);
    const next = now - Math.max(0, at) * MIN;
    if (next === unplugged) break;
    unplugged = next;
    minutes = table(inv, fullWh, unplugged);
  }
  d = { unplugged, minutes };
  days.set(inv, d);
  return d;
}

/** The demo laptop's battery at a moment, or null for a desktop or a laptop without a battery. */
export function demoBattery(inv: Inventory, t: number): DemoBattery | null {
  const d = dayOf(inv);
  if (!d) return null;
  const i = Math.floor((t - d.unplugged) / MIN);
  if (i < 0 || i >= d.minutes.length) return { level: 100, state: "plugged", watts: 0 };
  const at = d.minutes[i];
  // Between minutes the level moves on smoothly.
  const next = d.minutes[i + 1] ?? at;
  const f = (t - d.unplugged) / MIN - i;
  return { ...at, level: at.level + (next.level - at.level) * f };
}

/** The busiest apps on the demo laptop while it's on battery: the browser through it all, Teams on the call, Excel after. */
export function demoBatteryApps(what: DemoBattery["what"], t: number): ProcessUse[] | null {
  if (!what) return null;
  const wob = (seed: number, amp: number) => Math.sin(t / 9000 + seed) * amp;
  if (what === "call") return [
    { name: "ms-teams.exe", cpu: 14 + wob(1, 2), memMb: 1500, gpu: 12 },
    { name: "chrome.exe", cpu: 10 + wob(2, 2), memMb: 2300 },
    { name: "dwm.exe", cpu: 2 + wob(3, 0.5), memMb: 150, gpu: 6 },
  ];
  if (what === "work") return [
    { name: "chrome.exe", cpu: 6.5 + wob(4, 1.5), memMb: 2200 },
    { name: "EXCEL.EXE", cpu: 5.5 + wob(5, 1.5), memMb: 780 },
    { name: "ms-teams.exe", cpu: 2.5 + wob(6, 0.8), memMb: 1300 },
  ];
  return [
    { name: "chrome.exe", cpu: 3.5 + wob(7, 1), memMb: 2000 },
    { name: "ms-teams.exe", cpu: 1.5 + wob(8, 0.5), memMb: 1200 },
    { name: "OneDrive.exe", cpu: 0.6, memMb: 180 },
  ];
}
