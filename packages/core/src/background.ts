// Rig's background recorder, as the app sees it. The recorder is a Windows
// service (helper/RigHelper/RecorderService.cs) that keeps a log whether or
// not the app is open; the desktop shell reads its lines (apps/desktop/src-
// tauri/src/recorder.rs) and this file turns them into what the Logs screen
// already shows: Windows events, and recordings with readings and moments.
// It stays on this PC: nothing here is uploaded to the account.

import {
  RIG_EVENT, captureKinds, cleanEvents, cleanProcesses, sampleFrom, summarise,
  type Limits, type PCEvent, type RawEvent, type Recording, type RecordingSample,
} from "./recordings";
import type { HardwareKind, Sensor, SensorType, Snapshot } from "./telemetry";
import type { ProbeSpec, ProbeStatus } from "./probes";

/** Where the next read carries on: a log file and a byte offset in it. */
export interface RecorderCursor { file: string; offset: number }

export interface RecorderStatus {
  /** False where there's no recorder (not Windows). */
  supported: boolean;
  /** The service's state from Windows, or null when it isn't installed. */
  service?: "running" | "stopped" | "starting" | "stopping" | "unknown" | null;
  /** What the recorder itself last said: "running", "asleep" or "stopped". */
  state?: string | null;
  version?: string | null;
  startedAt?: number | null;
  /** When it last wrote, in milliseconds. */
  lastT?: number | null;
  /** Size of the whole log, and how many days it holds. */
  bytes?: number;
  days?: number;
  /** The oldest day kept, as YYYY-MM-DD. */
  oldest?: string | null;
  /** The custom logs it's running, for every Windows account on the PC. */
  probes?: { list: ProbeStatus[]; problems?: string[] } | null;
  /** The Windows account whose custom logs this app can read, so it shows only its own. */
  mine?: string | null;
}

/** Changes to the custom logs, made through Rig's helper for the Windows account the app runs as. */
export type ProbeEdit =
  | { op: "list" }
  | { op: "add"; probe: ProbeSpec }
  /** A script that runs as the person. The person's own press of Approve in Rig, never the chat. */
  | { op: "approve"; probe: ProbeSpec }
  | { op: "remove" | "pause" | "resume"; id: string };

/** The desktop shell's view of the recorder. */
export interface RecorderLink {
  status(): Promise<RecorderStatus>;
  read(fromMs: number, cursor: RecorderCursor | null): Promise<{ records: unknown[]; cursor: RecorderCursor | null; more: boolean }>;
  /** Turns it on or off. Windows asks for permission. */
  set(on: boolean): Promise<void>;
  /** Adds, changes or lists custom logs. Returns this account's list. */
  probes?(req: ProbeEdit): Promise<ProbeSpec[]>;
  /** Approves a script that runs as admin, behind Windows' own permission prompt. */
  approveAdmin?(probe: ProbeSpec): Promise<ProbeSpec[]>;
  /** What the custom logs wrote, read the same way as the main log. */
  readCustom?(fromMs: number, cursor: RecorderCursor | null): Promise<{ records: unknown[]; cursor: RecorderCursor | null; more: boolean }>;
}

/** How far back the app keeps the recorder's readings in memory. The log on disk keeps 30 days. */
export const BACKGROUND_DAYS = 7;
/** A closer look includes this much from before what started it. */
export const LEAD_MS = 5 * 60_000;
const DAY = 864e5;
const SOURCE = "Rig recorder";

export interface BackgroundSample extends RecordingSample {
  /** Written during a closer look, every few seconds. */
  detail?: boolean;
}

export interface Anomaly { t: number; why: string; text: string }

/** A finished day, kept thinned to what its recording shows. Its full readings are let go, but for those around a closer look. */
export interface SettledDay { day: number; first: number; last: number; samples: RecordingSample[]; intervalMs: number }

/** How long after a closer look starts its full readings are kept once its day is over. A closer look lasts minutes. */
export const LOOK_KEEP_MS = 2 * 3_600_000;

type Rec = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const dayClock = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** What the recorder's log holds for the last few days, decoded line by line as it's read. */
export class BackgroundLog {
  samples: BackgroundSample[] = [];
  /** Windows events and the recorder's own (sleep, wake, battery, stopping suddenly). */
  events: RawEvent[] = [];
  anomalies: Anomaly[] = [];
  /** Finished days, thinned, by the time their day starts. A week of full readings with their app lists would hold tens of MB. */
  settled = new Map<number, SettledDay>();
  /** Each finished day's recording, with what it was made from, so a new line today doesn't redo the week. */
  dayRecs = new Map<number, { key: string; rec: Recording }>();
  /** The sensor list the next readings refer to. */
  private header: Omit<Sensor, "value">[] | null = null;

  /** Adds lines from the log, in the order they were written. Lines it doesn't know are skipped. */
  ingest(lines: unknown[]) {
    for (const raw of lines) {
      const r = raw as Rec | null;
      if (!r || typeof r !== "object") continue;
      const t = num(r.t);
      if (t == null) continue;
      switch (r.k) {
        case "sensors": {
          const list = Array.isArray(r.list) ? r.list : [];
          this.header = list.filter((x): x is unknown[] => Array.isArray(x) && x.length >= 5)
            .map(([id, hw, hwName, type, name]) => ({ id: str(id), hw: str(hw) as HardwareKind, hwName: str(hwName), type: str(type) as SensorType, name: str(name) }));
          break;
        }
        case "s": {
          const v = Array.isArray(r.v) ? r.v : null;
          if (!this.header || !v || v.length !== this.header.length) break;
          const snap: Snapshot = { at: t, sensors: this.header.map((h, i) => ({ ...h, value: num(v[i]) })), game: null, elevated: true };
          const s: BackgroundSample = sampleFrom(snap, captureKinds, Array.isArray(r.top) ? cleanProcesses(r.top) : undefined);
          delete s.game;
          if (r.d) s.detail = true;
          this.samples.push(s);
          break;
        }
        case "e":
          this.events.push({ t, log: r.log === "Application" ? "Application" : "System", source: str(r.source), id: num(r.id) ?? 0, level: r.level as RawEvent["level"], message: str(r.message) });
          break;
        case "power": {
          const pct = num(r.pct);
          const charge = pct != null ? ` (${pct}% charged)` : "";
          const ev = (id: number, message: string) => this.events.push({ t, log: "System", source: SOURCE, id, level: "info", message });
          if (r.atStart) break;
          if (r.what === "sleep") ev(RIG_EVENT.sleep, "The PC went to sleep.");
          else if (r.what === "wake") ev(RIG_EVENT.wake, "The PC woke up.");
          else if (r.what === "ac") ev(RIG_EVENT.plugged, `Plugged in${charge}.`);
          else if (r.what === "battery") ev(RIG_EVENT.battery, `Unplugged, running on battery${charge}.`);
          break;
        }
        case "start": {
          // The recorder writes its state every minute and "stopped" when Windows shuts down. If the last state it
          // wrote was still running (or asleep), the PC stopped without warning: power loss, a freeze or a crash.
          const prev = r.prev as Rec | undefined;
          const at = num(prev?.t);
          if (!prev || prev.clean !== false || at == null) break;
          const asleep = prev.state === "asleep";
          this.events.push({
            t: at, log: "System", source: SOURCE, id: RIG_EVENT.unclean, level: "critical",
            message: asleep
              ? `The PC was asleep at ${dayClock(at)} and next started fresh at ${dayClock(t)}, so it lost power while asleep (a flat battery, or it was unplugged).`
              : `Rig's recorder last heard from the PC at ${dayClock(at)} and it next started at ${dayClock(t)} without shutting down: it lost power, froze or crashed then.`,
          });
          break;
        }
        case "anomaly":
          this.anomalies.push({ t, why: str(r.why), text: str(r.text) });
          break;
      }
    }
  }

  /** Drops what's older than a time. */
  trim(fromMs: number) {
    this.samples = this.samples.filter((s) => s.t >= fromMs);
    this.events = this.events.filter((e) => e.t >= fromMs);
    this.anomalies = this.anomalies.filter((a) => a.t >= fromMs);
    for (const [day, d] of this.settled) {
      if (d.last < fromMs) { this.settled.delete(day); this.dayRecs.delete(day); continue; }
      if (d.first >= fromMs) continue;
      const samples = d.samples.filter((x) => x.t >= fromMs);
      this.settled.set(day, { ...d, samples, first: samples[0]?.t ?? fromMs });
      this.dayRecs.delete(day);
    }
  }

  /**
   * Thins every day that ended before today and lets its full readings go, keeping only those a closer look shows: from a few
   * minutes before one starts to a couple of hours after. Readings that arrive late for a settled day still count towards it.
   */
  settle(now: number) {
    const today = startOfDay(now);
    const looks = this.anomalies.map((a) => [a.t - LEAD_MS, a.t + LOOK_KEEP_MS] as const);
    const near = (t: number) => looks.some(([a, b]) => t >= a && t <= b);
    const byDay = new Map<number, BackgroundSample[]>();
    for (const x of this.samples) {
      const day = startOfDay(x.t);
      if (day >= today) continue;
      const settled = this.settled.get(day);
      if (settled && x.t <= settled.last) continue;
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(x);
    }
    if (!byDay.size) return;
    for (const [day, list] of byDay) {
      const had = this.settled.get(day);
      const all = sorted(had ? [...had.samples as BackgroundSample[], ...list] : list);
      const thin = thinned(all, day, day + DAY);
      this.settled.set(day, { day, first: all[0].t, last: all[all.length - 1].t, samples: thin.samples, intervalMs: thin.intervalMs });
      this.dayRecs.delete(day);
    }
    this.samples = this.samples.filter((x) => startOfDay(x.t) >= today || near(x.t));
  }

  /** The recorder's events, cleaned and labelled: problems and power events kept apart so a busy week of sleep and wake can't push out a crash. */
  cleanEvents(): { problems: PCEvent[]; power: PCEvent[] } {
    return { problems: cleanEvents(this.events.filter((e) => e.level !== "info")), power: cleanEvents(this.events.filter((e) => e.level === "info"), 150) };
  }
}

const sorted = <T extends { t: number }>(xs: T[]) => [...xs].sort((a, b) => a.t - b.t);
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** One recording for each closer look, and one for each day, newest first. Settles the days that are over first (see BackgroundLog.settle). */
export function backgroundRecordings(log: BackgroundLog, pcId: string, limits: Limits, now: number): Recording[] {
  log.settle(now);
  const samples = sorted(log.samples);
  const events = cleanEvents(log.events.filter((e) => e.level !== "info"), 1000);
  const out: Recording[] = [];

  // Closer looks: from a few minutes before what started it to the last reading taken up close. Ones that overlap are one.
  let open: { from: number; to: number; texts: string[]; at: number } | null = null;
  const close = () => {
    if (!open) return;
    const { from, to, texts, at } = open;
    out.push(make(`bg-a-${at}`, texts[0] + (texts.length > 1 ? `, and ${texts.length - 1} more` : ""), from, to, samples.filter((s) => s.t >= from && s.t <= to), events, pcId, limits, at));
    open = null;
  };
  for (const a of sorted(log.anomalies)) {
    let to = a.t;
    for (const s of samples) { if (s.t < a.t) continue; if (!s.detail && s.t > a.t + 10_000) break; to = s.t; }
    to = Math.max(to, Math.min(now, a.t + 60_000));
    if (open && a.t <= open.to + 30_000) { open.to = Math.max(open.to, to); open.texts.push(a.text); continue; }
    close();
    open = { from: a.t - LEAD_MS, to, texts: [a.text], at: a.t };
  }
  close();

  // A day at a time, in the person's own days, with readings thinned to what a recording holds. Finished days were thinned once,
  // and their recordings are made again only when an event in them or the limits change.
  const label = (day: number) => `Background log for ${new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`;
  const limitsKey = JSON.stringify(limits);
  for (const [day, d] of log.settled) {
    if (!d.samples.length) continue;
    const inside = events.filter((e) => e.t >= d.first - 60_000 && e.t <= d.last + 60_000);
    const key = `${limitsKey}|${pcId}|${d.first}|${d.last}|${d.samples.length}|${inside.length}|${inside.map((e) => e.t).join()}`;
    let got = log.dayRecs.get(day);
    if (got?.key !== key) log.dayRecs.set(day, (got = { key, rec: make(`bg-d-${dayId(day)}`, label(day), d.first, d.last, d.samples, inside, pcId, limits, day, d.intervalMs, true) }));
    out.push(got.rec);
  }
  const byDay = new Map<number, BackgroundSample[]>();
  for (const s of samples) {
    const k = startOfDay(s.t);
    if (log.settled.has(k)) continue;
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(s);
  }
  for (const [day, list] of byDay) {
    const thin = thinned(list, day, day + DAY);
    out.push(make(`bg-d-${dayId(day)}`, label(day), list[0].t, list[list.length - 1].t, thin.samples, events, pcId, limits, day, thin.intervalMs, true));
  }
  return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

const dayId = (t: number) => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

/** At most 360 readings for a day: each stretch keeps its highest temperatures and loads, and the busiest apps from its busiest reading. */
export function thinned(list: BackgroundSample[], from: number, to: number, max = 360): { samples: RecordingSample[]; intervalMs: number } {
  const base = 30_000;
  if (list.length <= max) return { samples: list.map(strip), intervalMs: base };
  const width = Math.ceil((to - from) / max / 1000) * 1000;
  const buckets = new Map<number, BackgroundSample[]>();
  for (const s of list) { const k = Math.floor((s.t - from) / width); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(s); }
  const keys = ["cpu", "gpu", "cpuLoad", "gpuLoad", "mem", "fan"] as const;
  const samples = [...buckets.values()].map((b) => {
    const out: RecordingSample = { t: b[0].t };
    for (const k of keys) {
      const vs = b.map((s) => s[k]).filter((v): v is number => v != null);
      if (vs.length) out[k] = Math.max(...vs); else if (b.some((s) => s[k] === null)) out[k] = null;
    }
    const busiest = b.filter((s) => s.top).sort((x, y) => (y.cpuLoad ?? 0) - (x.cpuLoad ?? 0))[0];
    if (busiest?.top) out.top = busiest.top;
    return out;
  });
  return { samples, intervalMs: width };
}

function strip(s: BackgroundSample): RecordingSample { const { detail: _d, ...rest } = s; return rest; }

function make(id: string, reason: string, from: number, to: number, samples: RecordingSample[], events: PCEvent[], pcId: string, limits: Limits, created: number, intervalMs = 5000, daily = false): Recording {
  // Events a minute either side: Windows writes some a little after the fact.
  const inside = events.filter((e) => e.t >= from - 60_000 && e.t <= to + 60_000);
  const span = Math.max(0, to - from);
  const minutes = daily ? Math.max(60, Math.round(span / 3_600_000) * 60) : Math.max(1, Math.round(span / 60_000));
  const r: Recording = {
    id, reason, question: "", minutes, capture: captureKinds, by: "rig", createdAt: new Date(created).toISOString(),
    pcId, state: "done", intervalMs, startedAt: from, endsAt: to, finishedAt: to, sampleCount: samples.length, eventCount: inside.length,
    samples: samples.map(strip), events: inside, background: true,
  };
  r.headline = summarise(r, limits).headline;
  return r;
}

export const isBackground = (id: string) => id.startsWith("bg-");
