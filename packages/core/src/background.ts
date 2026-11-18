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
}

/** The desktop shell's view of the recorder. */
export interface RecorderLink {
  status(): Promise<RecorderStatus>;
  read(fromMs: number, cursor: RecorderCursor | null): Promise<{ records: unknown[]; cursor: RecorderCursor | null; more: boolean }>;
  /** Turns it on or off. Windows asks for permission. */
  set(on: boolean): Promise<void>;
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
  }

  /** The recorder's events, cleaned and labelled: problems and power events kept apart so a busy week of sleep and wake can't push out a crash. */
  cleanEvents(): { problems: PCEvent[]; power: PCEvent[] } {
    return { problems: cleanEvents(this.events.filter((e) => e.level !== "info")), power: cleanEvents(this.events.filter((e) => e.level === "info"), 150) };
  }
}

const sorted = <T extends { t: number }>(xs: T[]) => [...xs].sort((a, b) => a.t - b.t);

/** One recording for each closer look, and one for each day, newest first. */
export function backgroundRecordings(log: BackgroundLog, pcId: string, limits: Limits, now: number): Recording[] {
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

  // A day at a time, in the person's own days, with readings thinned to what a recording holds.
  const byDay = new Map<number, BackgroundSample[]>();
  for (const s of samples) {
    const d = new Date(s.t); d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(s);
  }
  for (const [day, list] of byDay) {
    const label = new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    const thin = thinned(list, day, day + DAY);
    out.push(make(`bg-d-${dayId(day)}`, `Background log for ${label}`, list[0].t, list[list.length - 1].t, thin.samples, events, pcId, limits, day, thin.intervalMs, true));
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
