// Custom logs: extra things Rig's background recorder writes down, set up by
// the person or proposed by Rig's chat. The recorder checks and runs them
// (helper/RigHelper/Probes.cs and ProbeEngine.cs); this file holds their
// shape, the same checks so the chat hears about a mistake at once, and turns
// what they wrote into recordings the Logs screen shows.
//
// A script is the one kind that runs code. The chat can only propose one:
// it runs once the person approves its exact text in Rig, and one that runs
// as admin also needs Windows' own permission prompt.

import type { RawEvent, Recording } from "./recordings";

export const probeKinds = ["sensor", "counter", "events", "wmi", "process", "file", "folder", "registry", "script"] as const;
export type ProbeKind = (typeof probeKinds)[number];
export const probeMetrics = ["cpuTemp", "gpuTemp", "cpuLoad", "memLoad"] as const;
export type ProbeMetric = (typeof probeMetrics)[number];
export type ProbeOp = ">" | ">=" | "<" | "<=";

export interface ProbeCondition {
  /** One of the recorder's own readings... */
  metric?: ProbeMetric;
  /** ...or another custom log's latest number, by id. */
  probe?: string;
  op: ProbeOp;
  value: number;
  /** How long it must hold before it counts. */
  forSec?: number;
}

export type ProbeSource =
  | { kind: "sensor"; match: string }
  | { kind: "counter"; path: string }
  | { kind: "events"; channel: string; query?: string }
  | { kind: "wmi"; namespace?: string; query: string }
  | { kind: "process"; name: string }
  | { kind: "file"; path: string; read?: "info" | "tail" }
  | { kind: "folder"; path: string }
  | { kind: "registry"; key: string; value?: string }
  | { kind: "script"; shell: "powershell" | "cmd"; text: string; admin: boolean; timeout?: number };

export interface ProbeSpec {
  id: string;
  /** What it's for, in plain words. Shown to the person. */
  label: string;
  /** Who asked for it: Rig's chat or the person. */
  by: "chat" | "you";
  createdAt: number;
  /** When it stops by itself. At most 30 days after it started; 24 hours for one read more often than every 5 seconds. */
  expiresAt: number;
  /** Seconds between readings; 0 to read only while the condition holds. Event log queries log each event instead. */
  every: number;
  /** Seconds between readings while the condition holds. */
  fast?: number;
  source: ProbeSource;
  when?: ProbeCondition;
  paused?: boolean;
  /** Scripts: the fingerprint of the approved text, and when it was approved. */
  hash?: string;
  approvedAt?: number;
}

/** What the recorder says about one custom log it's running. */
export interface ProbeStatus {
  id: string;
  label: string;
  kind: ProbeKind;
  by: "chat" | "you";
  owner?: string;
  createdAt: number;
  expiresAt: number;
  every: number;
  fast?: number;
  when?: ProbeCondition;
  state: "on" | "paused" | "error" | "waiting";
  error?: string;
  lastT?: number;
  admin?: boolean;
  shell?: string;
  hash?: string;
  approvedAt?: number;
}

export const PROBE_LIMITS = {
  maxProbes: 24, maxScripts: 8, maxDays: 30, defaultDays: 7, fastHours: 24,
  maxScriptChars: 8000, maxScriptTimeout: 120, defaultScriptTimeout: 30, minScriptEvery: 30,
};

const DAY = 864e5;
const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  // eslint-disable-next-line no-control-regex
  return s && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s) ? s : null;
};
const re = {
  id: /^[a-z0-9][a-z0-9-]{0,39}$/,
  counter: /^\\[^\\()]{1,200}(\([^()\\]{0,200}\))?\\[^\\]{1,200}$/,
  channel: /^[\w\-. /%]{1,200}$/,
  namespace: /^root(\\\w{1,64}){0,6}$/i,
  wql: /^\s*(select|associators\s+of|references\s+of)\s/i,
  process: /^[\w .\-()+]{1,100}$/,
  key: /^(HKLM|HKCU|HKU|HKCR|HKCC|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_USERS|HKEY_CLASSES_ROOT|HKEY_CURRENT_CONFIG)(\\[^\\]{1,255}){0,30}$/i,
};
const localPath = (p: string) => /^[a-z]:\\/i.test(p) && !/[*?"<>|]/.test(p);

function source(kind: ProbeKind, s: Record<string, unknown>): ProbeSource | string {
  switch (kind) {
    case "sensor": { const match = clip(s.match, 120); return match ? { kind, match } : 'match must name a sensor, like "GPU Hot Spot"'; }
    case "counter": { const path = clip(s.path, 600); return path && re.counter.test(path) ? { kind, path } : "path must be a counter path like \\Processor(_Total)\\% Processor Time"; }
    case "events": {
      const channel = clip(s.channel, 200);
      if (!channel || !re.channel.test(channel)) return "channel must be an event log name, like System or Microsoft-Windows-Kernel-Power/Thermal-Operational";
      return { kind, channel, query: clip(s.query, 4000) ?? "*" };
    }
    case "wmi": {
      const ns = clip(s.namespace, 200) ?? "root\\cimv2", query = clip(s.query, 2000);
      if (!re.namespace.test(ns)) return "namespace must be like root\\cimv2 or root\\wmi";
      return query && re.wql.test(query) ? { kind, namespace: ns, query } : "query must be a WQL SELECT, ASSOCIATORS OF or REFERENCES OF query";
    }
    case "process": { const name = clip(s.name, 100); return name && re.process.test(name) ? { kind, name } : "name must be a program's name, like game.exe"; }
    case "file": { const path = clip(s.path, 260); return path && localPath(path) ? { kind, path, read: s.read === "tail" ? "tail" : "info" } : "path must be a full path to a file on this PC, like C:\\Games\\log.txt"; }
    case "folder": { const path = clip(s.path, 260); return path && localPath(path) ? { kind, path } : "path must be a full path to a folder on this PC"; }
    case "registry": {
      const key = clip(s.key, 1000);
      if (!key || !re.key.test(key)) return "key must be a full registry key, like HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power";
      if (s.value == null) return { kind, key };
      // eslint-disable-next-line no-control-regex
      return typeof s.value === "string" && s.value.length <= 255 && !/[\u0000-\u001f]/.test(s.value) ? { kind, key, value: s.value } : "value must be a value's name";
    }
    case "script": {
      const shell = s.shell == null ? "powershell" : s.shell;
      if (shell !== "powershell" && shell !== "cmd") return "shell must be powershell or cmd";
      const text = typeof s.text === "string" && s.text.trim() && s.text.length <= PROBE_LIMITS.maxScriptChars ? s.text : null;
      if (!text) return `text must be the script, at most ${PROBE_LIMITS.maxScriptChars} characters`;
      const timeout = s.timeout == null ? PROBE_LIMITS.defaultScriptTimeout : Number(s.timeout);
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > PROBE_LIMITS.maxScriptTimeout) return `timeout must be 1 to ${PROBE_LIMITS.maxScriptTimeout} seconds`;
      return { kind, shell, text, admin: s.admin === true, timeout };
    }
  }
}

/** Checks a custom log that came from the chat or the app, with the same rules the recorder applies. Returns it cleaned, or what's wrong. */
export function checkProbe(input: unknown, fill: { id: string; by: "chat" | "you"; now: number }): ProbeSpec | string {
  const o = (input ?? {}) as Record<string, unknown>;
  const label = clip(o.label, 160);
  if (!label) return "label is required: one plain sentence on what this log is for";
  const src = (o.source ?? {}) as Record<string, unknown>;
  const kind = src.kind as ProbeKind;
  if (!probeKinds.includes(kind)) return `kind must be one of ${probeKinds.join(", ")}`;
  const s = source(kind, src);
  if (typeof s === "string") return s;
  const id = typeof o.id === "string" && re.id.test(o.id) ? o.id : fill.id;
  const createdAt = fill.now;
  const expiresAt = o.expiresAt == null ? createdAt + PROBE_LIMITS.defaultDays * DAY : Number(o.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= fill.now) return "it would end before it starts";
  if (expiresAt - createdAt > PROBE_LIMITS.maxDays * DAY) return `a custom log can last at most ${PROBE_LIMITS.maxDays} days`;

  const def = kind === "events" ? 0 : kind === "folder" ? 600 : kind === "script" ? 300 : ["wmi", "file", "registry"].includes(kind) ? 60 : 10;
  const min = kind === "folder" ? 60 : kind === "script" ? PROBE_LIMITS.minScriptEvery : 1;
  let every = o.every == null ? def : Number(o.every), fast = o.fast == null ? 0 : Number(o.fast);
  if (kind === "events") { every = 0; fast = 0; }
  else {
    if (!Number.isInteger(every) || (every !== 0 && (every < min || every > 86_400))) return `every must be 0 or ${min} to 86400 seconds`;
    if (!Number.isInteger(fast) || (fast !== 0 && (fast < min || fast > 3600))) return `fast must be ${min} to 3600 seconds`;
  }

  let when: ProbeCondition | undefined;
  if (o.when != null) {
    if (kind === "events") return "an event log query logs each matching event, so it takes no condition";
    const w = o.when as Record<string, unknown>;
    const metric = w.metric == null ? undefined : w.metric, other = w.probe == null ? undefined : w.probe;
    if ((metric == null) === (other == null)) return "a condition needs either metric or probe";
    if (metric != null && !probeMetrics.includes(metric as ProbeMetric)) return `metric must be one of ${probeMetrics.join(", ")}`;
    if (other != null && (typeof other !== "string" || !re.id.test(other) || other === id)) return "a condition's probe must be another custom log's id";
    if (!(w.op === ">" || w.op === ">=" || w.op === "<" || w.op === "<=")) return "op must be >, >=, < or <=";
    const value = Number(w.value);
    if (w.value == null || !Number.isFinite(value)) return "a condition needs a number to compare with";
    const forSec = w.forSec == null ? 0 : Number(w.forSec);
    if (!Number.isInteger(forSec) || forSec < 0 || forSec > 3600) return "forSec must be 0 to 3600";
    when = { ...(metric != null ? { metric: metric as ProbeMetric } : { probe: other as string }), op: w.op, value, ...(forSec ? { forSec } : {}) };
    if (every === 0 && fast === 0) return "give fast, how often to log while the condition holds";
  } else {
    fast = 0;
    if (every === 0 && kind !== "events") return "every can be 0 only with a condition";
  }
  const quickest = Math.min(...[every, fast].filter((x) => x > 0), Infinity);
  if (quickest < 5 && expiresAt - createdAt > PROBE_LIMITS.fastHours * 3_600_000) return "a log taken more often than every 5 seconds can last at most 24 hours";

  return { id, label, by: fill.by, createdAt, expiresAt, every, ...(fast ? { fast } : {}), source: s, ...(when ? { when } : {}) };
}

const metricWords: Record<ProbeMetric, string> = { cpuTemp: "the processor's temperature", gpuTemp: "the graphics card's temperature", cpuLoad: "processor load", memLoad: "memory use" };
const secs = (n: number) => (n % 3600 === 0 ? `${n / 3600} hour${n === 3600 ? "" : "s"}` : n % 60 === 0 ? `${n / 60} minute${n === 60 ? "" : "s"}` : `${n} second${n === 1 ? "" : "s"}`);

/** What a custom log reads, in a few words. */
export function probeWhat(s: ProbeSource): string {
  switch (s.kind) {
    case "sensor": return `the sensor "${s.match}"`;
    case "counter": return `the counter ${s.path}`;
    case "events": return `${s.channel} events${s.query && s.query !== "*" ? " matching a query" : ""}`;
    case "wmi": return "a WMI query";
    case "process": return s.name;
    case "file": return s.read === "tail" ? `the end of ${s.path}` : s.path;
    case "folder": return `the size of ${s.path}`;
    case "registry": return `${s.key}${s.value != null ? ` ${s.value || "(default)"}` : ""}`;
    case "script": return `a ${s.shell === "cmd" ? "cmd" : "PowerShell"} script${s.admin ? " run as admin" : ""}`;
  }
}

/** When it reads, in a few words: "every 10 seconds", "each event", "every second while the graphics card's temperature > 85". */
export function probeWhen(p: Pick<ProbeSpec, "every" | "fast" | "when"> & { source?: ProbeSource; kind?: ProbeKind }): string {
  if ((p.source?.kind ?? p.kind) === "events") return "each event as it happens";
  const c = p.when;
  const cond = c ? `${c.metric ? metricWords[c.metric] : `custom log ${c.probe}`} ${c.op} ${c.value}${c.forSec ? ` for ${secs(c.forSec)}` : ""}` : "";
  if (!c) return `every ${secs(p.every)}`;
  const fast = p.fast || p.every;
  return p.every ? `every ${secs(p.every)}, and every ${secs(fast)} while ${cond}` : `every ${secs(fast)} while ${cond}`;
}

/** A script's fingerprint, the same as the recorder's: SHA-256 of shell, who it runs as and its exact text. */
export async function scriptHash(s: { shell: string; admin: boolean; text: string }): Promise<string> {
  const bytes = new TextEncoder().encode(`${s.shell}\n${s.admin ? "admin" : "user"}\n${s.text}`);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The custom logs as the chat sees them. */
export function describeProbes(list: ProbeStatus[]): object[] {
  return list.slice(0, 24).map((p) => ({
    id: p.id, label: p.label, kind: p.kind, by: p.by, reads: probeWhen(p), state: p.state, error: p.error,
    ends: new Date(p.expiresAt).toISOString(), ...(p.kind === "script" ? { admin: !!p.admin } : {}),
  }));
}

// ----- What they wrote -----

export type Cell = string | number | boolean | null;

interface Entry {
  id: string;
  spec: ProbeSpec | null;
  rows: { t: number; v: unknown }[];
  events: RawEvent[];
  notes: { t: number; text: string }[];
  ended: { t: number; why: string } | null;
  first: number;
  last: number;
}

const MAX_ROWS = 5000;

/** What the recorder's custom logs wrote, line by line, for the last few days. */
export class CustomLog {
  entries = new Map<string, Entry>();

  private entry(id: string, t: number): Entry {
    let e = this.entries.get(id);
    if (!e) this.entries.set(id, e = { id, spec: null, rows: [], events: [], notes: [], ended: null, first: t, last: t });
    e.first = Math.min(e.first, t);
    e.last = Math.max(e.last, t);
    return e;
  }

  ingest(lines: unknown[]) {
    for (const raw of lines) {
      const r = raw as Record<string, unknown> | null;
      if (!r || typeof r !== "object" || typeof r.t !== "number" || typeof r.id !== "string") continue;
      const t = r.t;
      if (r.k === "probe") {
        const e = this.entry(r.id, t);
        if (r.what === "on" && r.spec && typeof r.spec === "object") { e.spec = r.spec as ProbeSpec; if (e.ended && e.ended.t <= t) e.ended = null; }
        // "stop" only means the recorder itself stopped; it carries on when the PC starts again.
        else if (r.what === "off" && (r.why === "removed" || r.why === "ended")) e.ended = { t, why: r.why };
      } else if (r.k === "p") {
        const e = this.entry(r.id, t);
        if ("v" in r) { e.rows.push({ t, v: r.v }); if (e.rows.length > MAX_ROWS) e.rows.splice(0, e.rows.length - MAX_ROWS); }
        if (r.e && typeof r.e === "object") {
          const x = r.e as Record<string, unknown>;
          e.events.push({ t, log: typeof x.log === "string" ? x.log as RawEvent["log"] : "System", source: String(x.source ?? ""), id: Number(x.id) || 0, level: (x.level as RawEvent["level"]) ?? "info", message: String(x.message ?? "") });
          if (e.events.length > MAX_ROWS) e.events.splice(0, e.events.length - MAX_ROWS);
        }
        if (typeof r.when === "boolean") e.notes.push({ t, text: r.when ? `The condition was met${typeof r.cv === "number" ? ` (${r.cv})` : ""}, so it logs more often.` : "The condition no longer holds." });
        if (typeof r.err === "string") e.notes.push({ t, text: r.err });
      }
    }
  }

  trim(fromMs: number) {
    for (const [id, e] of this.entries) {
      e.rows = e.rows.filter((x) => x.t >= fromMs);
      e.events = e.events.filter((x) => x.t >= fromMs);
      e.notes = e.notes.filter((x) => x.t >= fromMs);
      if (e.last < fromMs) this.entries.delete(id);
    }
  }
}

const cell = (v: unknown): Cell => (v == null ? null : typeof v === "number" || typeof v === "boolean" ? v : typeof v === "string" ? v : JSON.stringify(v));
const flat = (v: unknown): Record<string, Cell> =>
  v != null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, cell(x)])) : { value: cell(v) };

/** A custom log as a table: one column per field it wrote, newest rows last. */
export function customTable(e: Pick<Entry, "rows" | "events">, kind?: ProbeKind, max = 500): { columns: string[]; rows: { t: number; cells: Cell[] }[] } {
  if (kind === "events" || (!e.rows.length && e.events.length)) {
    return { columns: ["Level", "Source", "Event", "Message"], rows: e.events.slice(-max).map((x) => ({ t: x.t, cells: [x.level, x.source, x.id, x.message] })) };
  }
  const objects: { t: number; o: Record<string, Cell> }[] = [];
  for (const r of e.rows) {
    if (Array.isArray(r.v)) { if (!r.v.length) objects.push({ t: r.t, o: { rows: 0 } }); for (const x of r.v) objects.push({ t: r.t, o: flat(x) }); }
    else objects.push({ t: r.t, o: flat(r.v) });
  }
  const recent = objects.slice(-max);
  const columns: string[] = [];
  for (const { o } of recent) for (const k of Object.keys(o)) if (!columns.includes(k) && columns.length < 12) columns.push(k);
  return { columns, rows: recent.map(({ t, o }) => ({ t, cells: columns.map((c) => o[c] ?? null) })) };
}

export const customId = (probeId: string) => `bg-p-${probeId}`;

/** What a recording made from a custom log carries. */
export interface CustomInfo {
  spec: ProbeSpec;
  active: boolean;
  state: ProbeStatus["state"] | "ended";
  columns: string[];
  rows: { t: number; cells: Cell[] }[];
  notes: { t: number; text: string }[];
  total: number;
}

/** One recording per custom log, newest first. */
export function customRecordings(log: CustomLog, pcId: string, now: number, status?: ProbeStatus[]): Recording[] {
  const out: Recording[] = [];
  for (const e of log.entries.values()) {
    if (!e.spec) continue;
    const st = status?.find((s) => s.id === e.id);
    const active = !e.ended && e.spec.expiresAt > now && !!st;
    const table = customTable(e, e.spec.source.kind);
    const total = e.spec.source.kind === "events" ? e.events.length : e.rows.length;
    out.push({
      id: customId(e.id), reason: `Custom log: ${e.spec.label}`, question: "", minutes: Math.max(1, Math.round((e.spec.expiresAt - e.spec.createdAt) / 60_000)),
      capture: [], by: e.spec.by === "you" ? "you" : "rig", createdAt: new Date(e.spec.createdAt).toISOString(), pcId,
      // "done" even while it runs: a custom log runs for days, and isn't a recording to stop from the list.
      state: "done", intervalMs: (e.spec.fast || e.spec.every || 60) * 1000,
      startedAt: e.spec.createdAt, endsAt: e.spec.expiresAt, finishedAt: active ? undefined : e.ended?.t ?? Math.min(now, e.spec.expiresAt),
      sampleCount: total, eventCount: e.events.length, samples: [], events: [], background: true,
      headline: total ? `${total} ${total === 1 ? "entry" : "entries"}, the last at ${new Date(e.last).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Nothing logged yet.",
      ...(st?.error ? { error: st.error } : {}),
      custom: { spec: e.spec, active, state: st?.state ?? (active ? "on" : "ended"), ...table, notes: e.notes.slice(-50), total },
    });
  }
  return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}
