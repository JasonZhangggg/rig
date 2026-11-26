// The chat's log reads (read_pc kind log). Logs only say what happened, so any
// event log channel and every source in rules/logs.json can be read with no
// approval. What keeps a read small is its limits: a time window, a count, a
// cut on each message and on the whole answer. The helper reads the same table
// (helper/RigHelper/LogReads.cs) and checks each read again.

import { textOnNeverList } from "./check";
import rulesJson from "./rules/logs.json";

export type LogSource = "events" | "topic" | "channels" | "crashes" | "wer" | "reliability" | "file" | "vendor" | "esrt";
export const LOG_LEVELS = ["critical", "error", "warning", "info", "verbose"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogQuery { channel: string; providers?: string[]; ids?: number[]; levels?: number[] }
interface LogTopic { says: string; for: string[]; queries: LogQuery[]; also: string[] }
interface LogFile { says: string; path?: string; folder?: string; match?: string; format?: "setupapi" }
interface LogVendor { name: string; folders: string[] }
export type FactType = "stop" | "hex" | "int" | "version" | "kb" | "guid" | "id" | "name" | "file";
export interface LogFact { provider: string; ids: number[]; says: string; fields: Record<string, { from: string[]; type: FactType }> }

interface LogRules {
  version: number;
  limits: {
    defaultHours: number; defaultLongHours: number; maxHours: number; defaultMax: number; maxEvents: number; maxFiles: number; defaultLines: number; maxLines: number;
    messageChars: number; lineChars: number; textChars: number; scanBytes: number; examine: number; providers: number; ids: number; containsChars: number;
  };
  sources: Record<LogSource, { says: string; clean: boolean; textTaints?: boolean }>;
  topics: Record<string, LogTopic>;
  files: Record<string, LogFile>;
  vendors: Record<string, LogVendor>;
  vendorExtensions: string[];
  vendorDepth: number;
  facts: LogFact[];
  factTypes: Record<FactType, string>;
  bugchecks: Record<string, string>;
  esrtStatus: Record<string, string>;
  esrtType: Record<string, string>;
}

/** The one table of what log reads may look at, shared with the helper (rules/logs.json). */
export const LOG_RULES = rulesJson as unknown as LogRules;
export const LOG_SOURCES = Object.keys(LOG_RULES.sources) as LogSource[];
export const LOG_TOPICS = Object.keys(LOG_RULES.topics);
export const LOG_FILES = Object.keys(LOG_RULES.files);
export const LOG_VENDORS = Object.keys(LOG_RULES.vendors);

/** A log read, with only the fields its source takes. Times are ISO 8601 in UTC. */
export interface LogRead {
  kind: "log";
  source: LogSource;
  /** events: the channel, like System or Microsoft-Windows-Windows Defender/Operational. */
  channel?: string;
  /** topic: a key of LOG_RULES.topics. */
  topic?: string;
  providers?: string[];
  ids?: number[];
  levels?: LogLevel[];
  /** Only events, lines, sections or reports whose text holds this, ignoring case. */
  contains?: string;
  /** How far back from now, when from isn't given. */
  hours?: number;
  from?: string;
  to?: string;
  /** How many events, reports, dumps or files at most. */
  max?: number;
  /** file: a key of LOG_RULES.files. vendor: the full path of a file a vendor listing gave. */
  file?: string;
  /** vendor: a key of LOG_RULES.vendors. */
  vendor?: string;
  /** file and vendor: how many lines (or setupapi sections) from the end. */
  lines?: number;
  /** channels: a word in the channel's name. */
  find?: string;
  /** events, topic and reliability: each event's message too, which counts as outside text. Without it, each event's facts only. */
  text?: boolean;
}

const L = LOG_RULES.limits;
const low = (s: string) => s.toLowerCase();
/** Channel and provider names: what Windows allows in them, and never a quote, so a name can't add to a query. */
const CHANNEL = /^[A-Za-z0-9][A-Za-z0-9 ._()%/-]{0,199}$/;
const PROVIDER = /^[A-Za-z0-9.][A-Za-z0-9 ._()-]{0,99}$/;
const PLAIN = /^[^\u0000-\u001f\u007f<>"]+$/;
const LEVEL_NUMBER: Record<LogLevel, number> = { critical: 1, error: 2, warning: 3, info: 4, verbose: 5 };
export const levelNumber = (l: LogLevel) => LEVEL_NUMBER[l];

const int = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function time(v: unknown): string | null | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const sourceList = () => LOG_SOURCES.join(", ");

/**
 * Checks a log read the model asked for. Returns the read with only its source's fields, or why it can't be done, in
 * plain words. `now` is for checking how far back a window goes.
 */
export function checkLogRead(r: Record<string, unknown>, now = Date.now()): LogRead | string {
  const source = r.source as LogSource;
  if (!LOG_SOURCES.includes(source)) return `A log read needs a source: ${sourceList()}.`;
  const out: LogRead = { kind: "log", source };

  // The window: from and to, or hours back from now. Sources with no times (channels, esrt) ignore it.
  if (["events", "topic", "crashes", "wer", "reliability", "file", "vendor"].includes(source)) {
    const from = time(r.from), to = time(r.to);
    if (from === null || to === null) return "from and to must be times like 2026-11-25T18:00:00Z.";
    if (r.hours !== undefined && !(typeof r.hours === "number" && r.hours > 0 && r.hours <= L.maxHours)) return `hours must be more than 0 and at most ${L.maxHours} (${L.maxHours / 24} days).`;
    if (from && to && Date.parse(from) >= Date.parse(to)) return "from must be before to.";
    if (from && now - Date.parse(from) > L.maxHours * 3_600_000) return `Rig reads logs from at most ${L.maxHours / 24} days back.`;
    if (from) out.from = from;
    if (to) out.to = to;
    if (!from && r.hours !== undefined) out.hours = r.hours as number;
  }
  if (r.max !== undefined) {
    const cap = source === "vendor" ? L.maxFiles : L.maxEvents;
    if (!int(r.max, 1, cap)) return `max must be a whole number from 1 to ${cap}.`;
    out.max = r.max as number;
  }
  if (r.text !== undefined && r.text !== false) {
    if (r.text !== true) return "text must be true or false.";
    if (LOG_RULES.sources[source].textTaints) out.text = true;
  }
  if (r.contains !== undefined && r.contains !== "") {
    if (typeof r.contains !== "string" || r.contains.length > L.containsChars || !PLAIN.test(r.contains)) return `contains must be plain text of at most ${L.containsChars} characters.`;
    out.contains = r.contains;
  }

  switch (source) {
    case "events": {
      if (typeof r.channel !== "string" || !CHANNEL.test(r.channel.trim())) return "An events read needs channel: the event log's name, like System, Application or Microsoft-Windows-Windows Defender/Operational.";
      out.channel = r.channel.trim();
      if (r.providers !== undefined) {
        if (!Array.isArray(r.providers) || r.providers.length > L.providers || !r.providers.every((p) => typeof p === "string" && PROVIDER.test(p))) {
          return `providers must be up to ${L.providers} event source names, like Display or Microsoft-Windows-Kernel-Power.`;
        }
        if (r.providers.length) out.providers = r.providers as string[];
      }
      if (r.ids !== undefined) {
        if (!Array.isArray(r.ids) || r.ids.length > L.ids || !r.ids.every((i) => int(i, 0, 65535))) return `ids must be up to ${L.ids} event ids.`;
        if (r.ids.length) out.ids = r.ids as number[];
      }
      if (r.levels !== undefined) {
        if (!Array.isArray(r.levels) || !r.levels.every((l) => LOG_LEVELS.includes(l as LogLevel))) return `levels must be some of ${LOG_LEVELS.join(", ")}.`;
        if (r.levels.length) out.levels = [...new Set(r.levels as LogLevel[])];
      }
      return out;
    }
    case "topic": {
      if (typeof r.topic !== "string" || !LOG_RULES.topics[r.topic]) return `A topic read needs topic: one of ${LOG_TOPICS.join(", ")}.`;
      out.topic = r.topic;
      return out;
    }
    case "channels": {
      if (r.find !== undefined && r.find !== "") {
        if (typeof r.find !== "string" || r.find.length > 60 || !PLAIN.test(r.find)) return "find must be a word of a channel's name, like Defender or Kernel.";
        out.find = r.find;
      }
      return out;
    }
    case "file": {
      if (typeof r.file !== "string" || !LOG_RULES.files[r.file]) return `A file read needs file: one of ${LOG_FILES.join(", ")}.`;
      out.file = r.file;
      if (r.lines !== undefined) {
        if (!int(r.lines, 1, L.maxLines)) return `lines must be a whole number from 1 to ${L.maxLines}.`;
        out.lines = r.lines as number;
      }
      return out;
    }
    case "vendor": {
      if (typeof r.vendor !== "string" || !LOG_RULES.vendors[r.vendor]) return `A vendor read needs vendor: one of ${LOG_VENDORS.join(", ")}.`;
      out.vendor = r.vendor;
      if (r.file !== undefined && r.file !== "") {
        const f = typeof r.file === "string" ? vendorFile(r.file) : null;
        if (!f) return `file must be the full path of a ${LOG_RULES.vendorExtensions.join(" or ")} file from this vendor's listing, like C:\\ProgramData\\NVIDIA Corporation\\...\\install.log.`;
        const never = textOnNeverList(f, "read");
        if (never) return `${never}.`;
        out.file = f;
      }
      if (r.lines !== undefined) {
        if (!int(r.lines, 1, L.maxLines)) return `lines must be a whole number from 1 to ${L.maxLines}.`;
        out.lines = r.lines as number;
      }
      return out;
    }
    default:
      return out;
  }
}

/** A vendor file's path as written, when it could be one: a full local path, no .., and a log's extension. Where it is is checked on the PC. */
function vendorFile(raw: string): string | null {
  const p = raw.trim();
  if (p.length > 400 || !/^[A-Za-z]:\\[^\\]/.test(p) || /[\u0000-\u001f*?"<>|]/.test(p) || /(^|\\)\.\.?(\\|$)/.test(p) || p.includes("\\\\") || p.slice(2).includes(":")) return null;
  return LOG_RULES.vendorExtensions.some((e) => low(p).endsWith(e)) ? p : null;
}

/**
 * Whether a log read can bring back text someone else wrote. Events, topics and Reliability Monitor bring back each event's
 * facts only, unless the read asks for text; crash dumps, error reports and firmware status are facts only.
 */
export const logTaints = (r: LogRead) => {
  const s = LOG_RULES.sources[r.source];
  return !s.clean || (!!s.textTaints && r.text === true);
};

/** What a fact of each type may look like. The helper keeps only values that fit; cleanLogAnswer checks them again. */
export const FACT_PATTERNS: Record<FactType, RegExp> = {
  stop: /^0x[0-9A-F]{8}$/,
  hex: /^0x[0-9A-F]{8}(?:[0-9A-F]{8})?$/,
  int: /^-?[0-9]{1,19}$/,
  version: /^[0-9]{1,9}(?:\.[0-9]{1,9}){1,4}$/,
  kb: /^KB[0-9]{6,8}$/,
  guid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  id: /^[A-Za-z0-9._+#{}&\\:$@-]{1,160}$/,
  name: /^[\p{L}\p{N}][\p{L}\p{N} ._()+&#,/:!-]{0,63}$/u,
  file: /^[\p{L}\p{N}][\p{L}\p{N} ._()+&#,!-]{0,63}$/u,
};
const isFact = (v: unknown) => typeof v === "string" && (Object.values(FACT_PATTERNS).some((p) => p.test(v)) || BUGCHECK_NAMES.has(v));
const BUGCHECK_NAMES = new Set(Object.values(LOG_RULES.bugchecks));
const SAYS = new Set([...LOG_RULES.facts.map((f) => f.says), ...Object.values(LOG_RULES.topics).map((t) => t.says)]);
const ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?Z$/;

/** The fields each kind of row may keep in a clean answer, and what each must look like. Anything else is left out. */
const ROW_FIELDS: Record<string, (v: unknown) => boolean> = {
  t: (v) => typeof v === "string" && ISO.test(v),
  log: (v) => typeof v === "string" && CHANNEL.test(v),
  source: (v) => typeof v === "string" && PROVIDER.test(v),
  id: (v) => typeof v === "number" && Number.isInteger(v),
  level: (v) => LOG_LEVELS.includes(v as LogLevel),
  what: (v) => typeof v === "string" && SAYS.has(v),
  type: (v) => typeof v === "string" && FACT_PATTERNS.id.test(v),
  app: (v) => typeof v === "string" && FACT_PATTERNS.file.test(v),
  product: (v) => typeof v === "string" && FACT_PATTERNS.name.test(v),
};
const LEFT_OUT = "(left out)";

function cleanRow(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "facts" || k === "signature") {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const facts: Record<string, unknown> = {};
      for (const [fk, fv] of Object.entries(v)) {
        const key = FACT_PATTERNS.name.test(fk) ? fk : null;
        if (key) facts[key] = isFact(fv) ? fv : LEFT_OUT;
      }
      out[k] = facts;
    } else if (ROW_FIELDS[k]) out[k] = ROW_FIELDS[k](v) ? v : LEFT_OUT;
  }
  return out;
}

/** The lists in a log read's answer whose rows came from the PC. Their rows keep only checked fields; the rest of the answer is the helper's own. */
const ROW_LISTS = ["events", "reports", "records"];

/**
 * A clean log read's answer as the model may see it: each event, report or record keeps only fields that fit their
 * type, so no message or other text an app wrote gets through. Crash dumps and firmware status pass as they are.
 */
export function cleanLogAnswer(text: string): string {
  let a: unknown;
  try { a = JSON.parse(text); } catch { return JSON.stringify({ error: "Rig couldn't read this log's answer." }); }
  if (!a || typeof a !== "object" || Array.isArray(a)) return JSON.stringify({ error: "Rig couldn't read this log's answer." });
  const o = a as Record<string, unknown>;
  for (const list of ROW_LISTS) if (Array.isArray(o[list])) o[list] = (o[list] as unknown[]).map(cleanRow);
  return JSON.stringify(o);
}

/** A log read in a few plain words, like "the System event log" or "logs about firewall changes". */
export function logWhat(r: LogRead): string {
  switch (r.source) {
    case "events": return `the ${r.channel} event log`;
    case "topic": return `logs about ${LOG_RULES.topics[r.topic!]?.says ?? r.topic}`;
    case "channels": return r.find ? `event log channels named like ${r.find}` : "the event log channels";
    case "crashes": return "crash dumps and live kernel reports";
    case "wer": return "Windows Error Reporting's crash reports";
    case "reliability": return "Reliability Monitor";
    case "file": return `the ${r.file} log`;
    case "vendor": return r.file ? `${LOG_RULES.vendors[r.vendor!].name}'s log ${r.file}` : `${LOG_RULES.vendors[r.vendor!].name}'s log files`;
    case "esrt": return "firmware update status";
  }
}

/** For the chat's instructions: each topic, what it shows and which changes it goes with. */
export function topicsText(): string {
  return Object.entries(LOG_RULES.topics).map(([k, t]) => `- ${k}: ${t.says}. After ${t.for.join(", ")} steps.${t.also.length ? ` Also read ${t.also.join(", ")}.` : ""}`).join("\n");
}

/** For the chat's instructions: each named log file and what it holds. */
export function logFilesText(): string {
  return Object.entries(LOG_RULES.files).map(([k, f]) => `${k} (${f.says})`).join("; ");
}
