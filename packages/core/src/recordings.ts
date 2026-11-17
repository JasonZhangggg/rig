// Recordings and Windows events. When Rig's chat is asked about a problem it
// can't see in the latest readings (a crash, a black screen, a stutter), it
// starts a recording: for a while the app on that PC keeps closer readings,
// the busiest apps and the Windows events that land in between. This file is
// the contract for that (helper, desktop, server and chat all share it) and
// the pure code that turns a recording into the few moments that matter.

import { cpuTemp, gpuTemp } from "./health";
import { findSensor, type Snapshot } from "./telemetry";

// ----- Windows events -----

export type EventKind = "crash" | "driver" | "hardware" | "shutdown" | "disk" | "other";
export type EventLevel = "critical" | "error" | "warning";

/** One Windows event log entry as the helper reads it. */
export interface RawEvent {
  /** Milliseconds since epoch. */
  t: number;
  log: "System" | "Application";
  source: string;
  id: number;
  level: EventLevel;
  /** One line, cut short by the helper. */
  message: string;
}

/** An event with what it means for the person. */
export interface PCEvent extends RawEvent { kind: EventKind }

interface EventRule { kind: EventKind; source: RegExp; ids?: number[] }

/** What each kind of event is called on screen, in the order the filters show them. */
export const eventKinds: { kind: EventKind; label: string; one: string }[] = [
  { kind: "crash", label: "Crashes", one: "Crash" },
  { kind: "driver", label: "Driver resets", one: "Driver reset" },
  { kind: "hardware", label: "Hardware errors", one: "Hardware error" },
  { kind: "shutdown", label: "Shutdowns", one: "Unexpected shutdown" },
  { kind: "disk", label: "Disk", one: "Disk problem" },
  { kind: "other", label: "Other", one: "Windows error" },
];

/** Which Windows events mean what. The first rule that matches wins; add a row to teach Rig a new one. */
const eventRules: EventRule[] = [
  { kind: "shutdown", source: /^(microsoft-windows-)?kernel-power$/i, ids: [41] },
  { kind: "shutdown", source: /^eventlog$/i, ids: [6008] },
  { kind: "crash", source: /bugcheck|wer-systemerrorreporting/i },
  { kind: "crash", source: /^application (error|hang)$/i },
  { kind: "crash", source: /^\.net runtime$/i, ids: [1026] },
  { kind: "driver", source: /^display$/i, ids: [4101] },
  { kind: "driver", source: /^(nvlddmkm|amdkmdag|amdwddmg|atikmdag|igfx\w*|dxgkrnl)$/i },
  { kind: "hardware", source: /whea/i },
  { kind: "disk", source: /^(disk|ntfs|volmgr|stornvme|storahci|nvme|volsnap|microsoft-windows-ntfs)$/i },
];

export function classifyEvent(e: Pick<RawEvent, "source" | "id">): EventKind {
  return eventRules.find((r) => r.source.test(e.source) && (!r.ids || r.ids.includes(e.id)))?.kind ?? "other";
}

export const MAX_EVENTS = 200;
const MESSAGE_MAX = 300;

/** Checks and labels events from the helper (or an upload): newest first, bounded, one row per repeat within a minute. */
export function cleanEvents(raw: unknown, max = MAX_EVENTS): PCEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: PCEvent[] = [];
  const seen = new Set<string>();
  const levels: EventLevel[] = ["critical", "error", "warning"];
  for (const e of [...raw].sort((a, b) => (b?.t ?? 0) - (a?.t ?? 0)) as Partial<RawEvent>[]) {
    if (!e || typeof e.t !== "number" || !Number.isFinite(e.t) || typeof e.source !== "string" || typeof e.id !== "number") continue;
    const key = `${e.source}|${e.id}|${Math.floor(e.t / 60_000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = e.source.slice(0, 80);
    out.push({
      t: Math.round(e.t), log: e.log === "Application" ? "Application" : "System", source, id: Math.round(e.id),
      level: levels.includes(e.level as EventLevel) ? e.level as EventLevel : "error",
      message: String(e.message ?? "").replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX),
      kind: classifyEvent({ source, id: e.id }),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** A short plain-words title for an event. */
export function eventTitle(e: PCEvent): string {
  const app = /^(?:faulting application name|the program):?\s+([^\s,]+)/i.exec(e.message)?.[1];
  switch (e.kind) {
    case "crash": return /bugcheck|systemerrorreporting/i.test(e.source) ? "Windows crashed (blue screen)" : app ? `${app} ${/hang/i.test(e.source) ? "stopped responding" : "crashed"}` : "An app crashed";
    case "driver": return "The graphics driver stopped and recovered";
    case "hardware": return e.level === "warning" ? "A hardware error was corrected" : "Hardware reported an error";
    case "shutdown": return "The PC turned off without shutting down";
    case "disk": return "A drive reported a problem";
    default: return `${e.source} reported ${e.level === "warning" ? "a warning" : "an error"}`;
  }
}

// ----- Recordings -----

export interface ProcessUse {
  name: string;
  /** Share of the whole processor, 0 to 100. */
  cpu: number;
  memMb: number;
  /** Share of the graphics card, when Windows reports it. */
  gpu?: number;
}

/** One reading during a recording. A field is missing when that capture is off, null when the PC didn't report it. */
export interface RecordingSample {
  t: number;
  cpu?: number | null;
  gpu?: number | null;
  cpuLoad?: number | null;
  gpuLoad?: number | null;
  /** Memory in use, percent. */
  mem?: number | null;
  /** Fastest fan, rpm. */
  fan?: number | null;
  game?: string | null;
  top?: ProcessUse[];
}

/** What a recording can capture. `sample` reads it from a sensor snapshot; `helper` names the helper call it needs instead. */
export const captures = {
  temps: { label: "Temperatures", sample: (s: Snapshot): Partial<RecordingSample> => ({ cpu: round(cpuTemp(s)?.value), gpu: round(gpuTemp(s)?.value) }) },
  loads: {
    label: "How hard parts work",
    sample: (s: Snapshot): Partial<RecordingSample> => ({
      cpuLoad: round(findSensor(s, "cpu", "load", /total/i)?.value), gpuLoad: round(findSensor(s, "gpu", "load", /core|d3d 3d/i)?.value),
      mem: round(findSensor(s, "memory", "load", /^memory$/i)?.value),
    }),
  },
  fans: { label: "Fan speeds", sample: (s: Snapshot): Partial<RecordingSample> => ({ fan: round(s.sensors.reduce<number | null>((m, x) => (x.type === "fan" && x.value != null && x.value > (m ?? 0) ? x.value : m), null)) }) },
  processes: { label: "Busiest apps", helper: "processes" as const },
  events: { label: "Windows crash and error events", helper: "events" as const },
} satisfies Record<string, { label: string; sample?: (s: Snapshot) => Partial<RecordingSample>; helper?: "processes" | "events" }>;

export type CaptureKind = keyof typeof captures;
export const captureKinds = Object.keys(captures) as CaptureKind[];

function round(v: number | null | undefined): number | null { return v == null ? null : Math.round(v); }

export const RECORD_MIN_MINUTES = 1;
export const RECORD_MAX_MINUTES = 180;
export const RECORD_DEFAULT_MINUTES = 30;
/** A recording never holds more samples than this, however long it runs. */
export const MAX_SAMPLES = 360;
export const TOP_PROCESSES = 4;
const MIN_INTERVAL_MS = 5000;

export type RecordingState = "pending" | "recording" | "done" | "cancelled" | "failed";

/** A request to record, from the chat or the person. */
export interface RecordingRequest {
  id: string;
  /** Why it was started, in plain words. Shown to the person. */
  reason: string;
  /** What the person asked, so the diagnosis answers it. */
  question: string;
  minutes: number;
  capture: CaptureKind[];
  by: "you" | "rig";
  /** ISO time it was asked for. */
  createdAt: string;
}

/** A recording without its data: what lists and cards show. */
export interface RecordingInfo extends RecordingRequest {
  pcId: string;
  state: RecordingState;
  intervalMs: number;
  /** Milliseconds since epoch. Unset while it waits for the PC to pick it up. */
  startedAt?: number;
  endsAt?: number;
  finishedAt?: number;
  /** Why it failed, in plain words. */
  error?: string;
  sampleCount: number;
  eventCount: number;
  /** One line on what it found, once finished. */
  headline?: string;
}

export interface Recording extends RecordingInfo {
  samples: RecordingSample[];
  events: PCEvent[];
}

export const isActive = (r: Pick<RecordingInfo, "state">) => r.state === "pending" || r.state === "recording";

export function intervalFor(minutes: number): number {
  return Math.max(MIN_INTERVAL_MS, Math.ceil((minutes * 60_000) / MAX_SAMPLES / 1000) * 1000);
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const idOk = (v: unknown): v is string => typeof v === "string" && /^[\w-]{4,64}$/.test(v);

/** Checks a request that came from outside (the model, the web). Returns the cleaned request or an error message. */
export function checkRequest(input: unknown, fill: { id: string; by: "you" | "rig"; now: Date }): RecordingRequest | string {
  const r = (input ?? {}) as Record<string, unknown>;
  const reason = clip(r.reason, 200);
  if (!reason) return "reason is required: one plain sentence on what the recording is for";
  const minutes = r.minutes == null ? RECORD_DEFAULT_MINUTES : Number(r.minutes);
  if (!Number.isFinite(minutes) || minutes < RECORD_MIN_MINUTES || minutes > RECORD_MAX_MINUTES) return `minutes must be from ${RECORD_MIN_MINUTES} to ${RECORD_MAX_MINUTES}`;
  const asked = Array.isArray(r.capture) ? r.capture.filter((c): c is CaptureKind => captureKinds.includes(c as CaptureKind)) : [];
  if (Array.isArray(r.capture) && r.capture.length && !asked.length) return `capture must be from: ${captureKinds.join(", ")}`;
  return {
    id: idOk(r.id) ? r.id : fill.id, reason, question: clip(r.question, 400), minutes: Math.round(minutes),
    capture: asked.length ? [...new Set(asked)] : captureKinds, by: fill.by, createdAt: fill.now.toISOString(),
  };
}

export function newRecording(req: RecordingRequest, pcId: string): Recording {
  return { ...req, pcId, state: "pending", intervalMs: intervalFor(req.minutes), sampleCount: 0, eventCount: 0, samples: [], events: [] };
}

/** Just the request a recording was started from. */
export function toRequest({ id, reason, question, minutes, capture, by, createdAt }: RecordingRequest): RecordingRequest {
  return { id, reason, question, minutes, capture, by, createdAt };
}

export function toInfo(r: Recording): RecordingInfo {
  const { samples, events, ...info } = r;
  return { ...info, sampleCount: samples.length, eventCount: events.length };
}

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : v === null ? null : undefined);

function cleanSample(raw: unknown): RecordingSample | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s.t !== "number" || !Number.isFinite(s.t)) return null;
  const out: RecordingSample = { t: Math.round(s.t) };
  for (const k of ["cpu", "gpu", "cpuLoad", "gpuLoad", "mem", "fan"] as const) { const v = numOrNull(s[k]); if (v !== undefined) out[k] = v; }
  if (typeof s.game === "string") out.game = s.game.slice(0, 120); else if (s.game === null) out.game = null;
  if (Array.isArray(s.top)) out.top = cleanProcesses(s.top);
  return out;
}

/** The busiest few by processor share, always with the one holding the most memory, so a memory hog that sits idle still shows. */
export function cleanProcesses(raw: unknown, max = TOP_PROCESSES): ProcessUse[] {
  if (!Array.isArray(raw)) return [];
  const all = (raw as Partial<ProcessUse>[])
    .filter((p) => p && typeof p.name === "string" && p.name && typeof p.cpu === "number" && typeof p.memMb === "number")
    .map((p) => ({ name: p.name!.slice(0, 60), cpu: Math.round(p.cpu! * 10) / 10, memMb: Math.round(p.memMb!), ...(typeof p.gpu === "number" ? { gpu: Math.round(p.gpu) } : {}) }))
    .sort((a, b) => b.cpu - a.cpu || b.memMb - a.memMb);
  if (all.length <= max) return all;
  const biggest = all.reduce((a, b) => (b.memMb > a.memMb ? b : a));
  const top = all.slice(0, max);
  return top.includes(biggest) ? top : [...top.slice(0, max - 1), biggest];
}

const states: RecordingState[] = ["pending", "recording", "done", "cancelled", "failed"];
const time = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);

/** Checks a recording that came from outside (an upload) and holds it to Rig's size limits. Null when it isn't one. */
export function cleanRecording(raw: unknown, pcId: string): Recording | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || !idOk(r.id) || !states.includes(r.state as RecordingState)) return null;
  const req = checkRequest(r, { id: r.id, by: r.by === "you" ? "you" : "rig", now: new Date(typeof r.createdAt === "string" && !Number.isNaN(Date.parse(r.createdAt)) ? r.createdAt : 0) });
  if (typeof req === "string") return null;
  const samples = (Array.isArray(r.samples) ? r.samples : []).slice(-MAX_SAMPLES).map(cleanSample).filter((s): s is RecordingSample => !!s);
  const events = cleanEvents(r.events);
  const interval = time(r.intervalMs);
  return {
    ...req, pcId, state: r.state as RecordingState, intervalMs: interval && interval >= 1000 ? interval : intervalFor(req.minutes),
    startedAt: time(r.startedAt), endsAt: time(r.endsAt), finishedAt: time(r.finishedAt),
    error: clip(r.error, 200) || undefined, headline: clip(r.headline, 200) || undefined,
    sampleCount: samples.length, eventCount: events.length, samples, events,
  };
}

/** One sample from a sensor snapshot, with only what the recording captures. */
export function sampleFrom(snap: Snapshot, capture: readonly CaptureKind[], top?: ProcessUse[]): RecordingSample {
  const out: RecordingSample = { t: snap.at, game: snap.game ?? null };
  for (const k of capture) { const c = captures[k]; if ("sample" in c) Object.assign(out, c.sample(snap)); }
  if (top && capture.includes("processes")) out.top = cleanProcesses(top);
  return out;
}

// ----- What a recording shows -----

/** A part counts as running hot within this many degrees of its safe limit. */
export const RECORD_HOT_MARGIN = 6;
/** Heat has to last this long to be worth a mention. */
export const SUSTAINED_MS = 2 * 60_000;
/** The processor or memory has to stay this full, this long. */
export const PINNED_PERCENT = 90;
export const PINNED_MS = 60_000;

export interface Limits { cpu?: number; gpu?: number }
type Metric = "cpu" | "gpu" | "cpuLoad" | "gpuLoad" | "mem" | "fan";
export interface MetricStat { min: number; avg: number; max: number; maxAt: number }

/** Something in a recording worth looking at, with when it happened. */
export interface Moment {
  t: number;
  until?: number;
  kind: "event" | "heat" | "pinned" | "drop";
  severity: "bad" | "warn" | "info";
  title: string;
  detail: string;
}

export interface Offender { name: string; cpuAvg: number; cpuMax: number; memMaxMb: number; gpuMax?: number; seen: number }

export interface RecordingSummary {
  minutes: number;
  samples: number;
  stats: Partial<Record<Metric, MetricStat>>;
  games: string[];
  moments: Moment[];
  offenders: Offender[];
  headline: string;
}

const metrics: Metric[] = ["cpu", "gpu", "cpuLoad", "gpuLoad", "mem", "fan"];
const partNames = { cpu: "processor", gpu: "graphics card" } as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const mins = (ms: number) => { const m = Math.max(1, Math.round(ms / 60_000)); return m === 1 ? "1 minute" : `${m} minutes`; };

/** Stretches where `test` holds for consecutive samples (a gap of more than three intervals ends one). */
function stretches(samples: readonly RecordingSample[], intervalMs: number, test: (s: RecordingSample) => boolean): RecordingSample[][] {
  const out: RecordingSample[][] = [];
  let run: RecordingSample[] = [];
  for (const s of samples) {
    const last = run[run.length - 1];
    if (test(s) && (!last || s.t - last.t <= intervalMs * 3)) run.push(s);
    else { if (run.length) out.push(run); run = test(s) ? [s] : []; }
  }
  if (run.length) out.push(run);
  return out;
}

function nearest(samples: readonly RecordingSample[], t: number, withinMs: number): RecordingSample | null {
  let best: RecordingSample | null = null;
  for (const s of samples) if (Math.abs(s.t - t) <= withinMs && (!best || Math.abs(s.t - t) < Math.abs(best.t - t))) best = s;
  return best;
}

/** What the PC was doing around a moment, as one sentence. Empty when there are no readings near it. */
function around(s: RecordingSample | null, limits: Limits): string {
  if (!s) return "";
  const bits: string[] = [];
  for (const part of ["gpu", "cpu"] as const) {
    const t = s[part], load = s[`${part}Load`], limit = limits[part];
    if (t == null && load == null) continue;
    const hot = t != null && limit != null && t >= limit - RECORD_HOT_MARGIN;
    bits.push(`the ${partNames[part]} was ${[t != null ? `at ${t}°C${hot ? `, close to its ${limit}°C limit` : ""}` : "", load != null ? `${t != null ? "and " : "at "}${load}% load` : ""].filter(Boolean).join(" ")}`);
  }
  if (s.mem != null && s.mem >= PINNED_PERCENT) bits.push(`memory was ${s.mem}% full`);
  const top = s.top?.[0];
  return [bits.length ? `${cap(bits.join("; "))}.` : "", s.game ? `${s.game} was in front.` : top && top.cpu >= 20 ? `${top.name} was the busiest app (${Math.round(top.cpu)}% of the processor).` : ""].filter(Boolean).join(" ");
}

/** Turns a recording into its numbers and the moments that matter. Pure: the chat and the Logs screen both read this. */
export function summarise(r: Pick<Recording, "samples" | "events" | "intervalMs">, limits: Limits = {}): RecordingSummary {
  const samples = [...r.samples].sort((a, b) => a.t - b.t);
  const stats: RecordingSummary["stats"] = {};
  for (const m of metrics) {
    const have = samples.filter((s) => s[m] != null);
    if (!have.length) continue;
    const top = have.reduce((a, b) => (b[m]! > a[m]! ? b : a));
    stats[m] = { min: Math.min(...have.map((s) => s[m]!)), avg: Math.round(have.reduce((a, s) => a + s[m]!, 0) / have.length), max: top[m]!, maxAt: top.t };
  }

  const moments: Moment[] = [];
  const hotRuns: { part: "cpu" | "gpu"; from: number; to: number }[] = [];
  for (const part of ["gpu", "cpu"] as const) {
    const limit = limits[part];
    if (limit == null) continue;
    for (const run of stretches(samples, r.intervalMs, (s) => s[part] != null && s[part]! >= limit - RECORD_HOT_MARGIN)) {
      const from = run[0].t, to = run[run.length - 1].t;
      if (to - from < SUSTAINED_MS) continue;
      const lo = Math.min(...run.map((s) => s[part]!)), hi = Math.max(...run.map((s) => s[part]!));
      hotRuns.push({ part, from, to });
      moments.push({
        t: from, until: to, kind: "heat", severity: hi >= limit ? "bad" : "warn",
        title: `${cap(partNames[part])} ran hot for ${mins(to - from)}`,
        detail: `It stayed between ${lo}°C and ${hi}°C. Its safe limit is ${limit}°C.${run[0].game ? ` ${run[0].game} was in front.` : ""}`,
      });
    }
  }

  for (const [key, name] of [["cpuLoad", "The processor"], ["mem", "Memory"]] as const) {
    for (const run of stretches(samples, r.intervalMs, (s) => (s[key] ?? 0) >= PINNED_PERCENT)) {
      const from = run[0].t, to = run[run.length - 1].t;
      if (to - from < PINNED_MS) continue;
      const busiest = offendersOf(run, key === "mem" ? "mem" : "cpu")[0];
      moments.push({
        t: from, until: to, kind: "pinned", severity: "warn",
        title: `${name} was ${key === "mem" ? "nearly full" : "flat out"} for ${mins(to - from)}`,
        detail: busiest ? (key === "mem" ? `${busiest.name} held the most, up to ${gb(busiest.memMaxMb)}.` : `${busiest.name} used the most, about ${busiest.cpuAvg}% of the processor.`) : "Rig didn't catch which app was behind it.",
      });
    }
  }

  // A graphics card that goes from working hard to nothing in one step, mid-game, is what a driver reset or a crash looks like.
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.gpuLoad != null && b.gpuLoad != null && a.gpuLoad >= 80 && b.gpuLoad <= 20 && b.t - a.t <= r.intervalMs * 3 && i < samples.length - 1) {
      moments.push({ t: b.t, kind: "drop", severity: "info", title: `Graphics card load fell from ${a.gpuLoad}% to ${b.gpuLoad}%`, detail: a.game ? `${a.game} was in front just before.` : "Nothing was in front just before." });
    }
  }

  for (const e of r.events) {
    if (e.kind === "other" && e.level !== "critical") continue;
    const s = nearest(samples, e.t, r.intervalMs * 2);
    const hot = hotRuns.find((h) => e.t >= h.from - r.intervalMs && e.t <= h.to + r.intervalMs * 2);
    const context = s ? around(s, limits) : samples.length ? "No readings right around it, so the PC was likely off or restarting." : "";
    moments.push({
      t: e.t, kind: "event", severity: e.kind === "other" ? "info" : e.level === "warning" && e.kind !== "driver" ? "warn" : "bad",
      title: eventTitle(e),
      detail: [hot ? `It happened while the ${partNames[hot.part]} was running hot.` : "", context, `Windows logged: ${e.source} ${e.id}${e.message ? `, "${e.message.slice(0, 140)}"` : ""}.`].filter(Boolean).join(" "),
    });
  }
  moments.sort((a, b) => a.t - b.t);

  const span = samples.length ? samples[samples.length - 1].t - samples[0].t : 0;
  const offenders = offendersOf(samples, "cpu").slice(0, 5);
  const games = [...new Set(samples.map((s) => s.game).filter((g): g is string => !!g))];
  return { minutes: Math.round(span / 60_000), samples: samples.length, stats, games, moments, offenders, headline: headlineOf(moments, samples.length) };
}

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

function offendersOf(samples: readonly RecordingSample[], by: "cpu" | "mem"): Offender[] {
  const withTop = samples.filter((s) => s.top);
  const map = new Map<string, { cpu: number[]; mem: number; gpu?: number }>();
  for (const s of withTop) for (const p of s.top!) {
    const o = map.get(p.name) ?? { cpu: [], mem: 0 };
    o.cpu.push(p.cpu); o.mem = Math.max(o.mem, p.memMb);
    if (p.gpu != null) o.gpu = Math.max(o.gpu ?? 0, p.gpu);
    map.set(p.name, o);
  }
  const list = [...map].map(([name, o]): Offender => ({
    name, cpuAvg: Math.round(o.cpu.reduce((a, b) => a + b, 0) / withTop.length), cpuMax: Math.round(Math.max(...o.cpu)), memMaxMb: o.mem, seen: o.cpu.length,
    ...(o.gpu != null ? { gpuMax: o.gpu } : {}),
  }));
  return list.sort((a, b) => (by === "cpu" ? b.cpuAvg - a.cpuAvg || b.cpuMax - a.cpuMax : b.memMaxMb - a.memMaxMb));
}

function headlineOf(moments: Moment[], samples: number): string {
  if (!samples && !moments.length) return "Nothing was recorded.";
  const lead = moments.find((m) => m.severity === "bad") ?? moments.find((m) => m.severity === "warn");
  if (!lead) return "Nothing unusual happened while Rig recorded.";
  const others = moments.filter((m) => m !== lead && m.severity !== "info").length;
  return `${lead.title}${others ? `, and ${others} more thing${others === 1 ? "" : "s"} to look at` : ""}.`;
}

/** The summary as compact text for the chat model. Times are in the person's time zone. */
export function describeRecording(r: Recording, s: RecordingSummary, opts: { timeZone?: string; limits?: Limits } = {}): string {
  const at = (t: number) => {
    try { return new Date(t).toLocaleString("en-US", { timeZone: opts.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }); }
    catch { return new Date(t).toISOString(); }
  };
  const units: Record<Metric, [string, string]> = { cpu: ["Processor temperature", "°C"], gpu: ["Graphics card temperature", "°C"], cpuLoad: ["Processor load", "%"], gpuLoad: ["Graphics card load", "%"], mem: ["Memory in use", "%"], fan: ["Fastest fan", " rpm"] };
  const lines = [
    `Recording ${r.id} (${r.state}${r.state === "cancelled" ? ", stopped early" : ""}). Started for: ${r.reason}${r.question ? ` The person asked: "${r.question}"` : ""}`,
    r.startedAt ? `Ran ${at(r.startedAt)} to ${at(r.finishedAt ?? r.endsAt ?? r.startedAt)}: ${s.samples} readings, one every ${Math.round(r.intervalMs / 1000)} s. Captured: ${r.capture.join(", ")}.` : "It never started.",
    r.error ? `Problem: ${r.error}` : "",
    opts.limits?.cpu || opts.limits?.gpu ? `Safe limits: ${[opts.limits.cpu ? `processor ${opts.limits.cpu}°C` : "", opts.limits.gpu ? `graphics card ${opts.limits.gpu}°C` : ""].filter(Boolean).join(", ")}.` : "",
    s.games.length ? `In front: ${s.games.join(", ")}.` : "",
    "Readings (lowest / average / highest, when highest):",
    ...metrics.filter((m) => s.stats[m]).map((m) => { const x = s.stats[m]!; return `- ${units[m][0]}: ${x.min} / ${x.avg} / ${x.max}${units[m][1]} (${at(x.maxAt)})`; }),
    s.moments.length ? "Moments, in order:" : "Moments: none. No heat near a limit, nothing pinned, no crash, driver, hardware, shutdown or disk events.",
    ...s.moments.slice(0, 25).map((m) => `- ${at(m.t)}${m.until ? ` to ${at(m.until)}` : ""} [${m.severity}] ${m.title}. ${m.detail}`),
    s.offenders.length ? "Busiest apps (average share of the processor / highest / most memory):" : "",
    ...s.offenders.map((o) => `- ${o.name}: ${o.cpuAvg}% / ${o.cpuMax}% / ${gb(o.memMaxMb)}${o.gpuMax != null ? `, graphics card up to ${o.gpuMax}%` : ""}`),
  ];
  return lines.filter(Boolean).join("\n");
}

/** Limits for a PC's main parts, from its view. */
export function limitsOf(pc: { parts?: Record<string, { limit?: number }> }): Limits {
  return { cpu: pc.parts?.cpu?.limit, gpu: pc.parts?.gpu?.limit };
}
