// Every change Rig can make, in one list. The model may only propose these,
// the server checks proposals against it, the desktop shows them and the
// helper carries them out. Each one is reversible: applying it returns the
// call that puts things back, which is what Undo runs.

import { textLowersProtection, textOnNeverList } from "./check";
import type { DiffRow } from "./model";
import commandRules from "./rules/commands.json";
import fixRules from "./rules/fixes.json";
import type { SystemFacts } from "./telemetry";

export type RegistryType = "dword" | "qword" | "string" | "expandString" | "multiString";
/** How a service starts. `automaticDelayed` is automatic, a little after Windows has started. */
export type ServiceStart = "automatic" | "automaticDelayed" | "manual" | "disabled";

export type ActionCall =
  | { kind: "power.plan"; guid: string }
  | { kind: "startup.app"; name: string; enabled: boolean }
  | { kind: "windows.gameMode"; enabled: boolean }
  | { kind: "windows.visualEffects"; mode: "auto" | "appearance" | "performance" }
  | { kind: "power.maxProcessorState"; ac: number; dc: number }
  | { kind: "display.refreshRate"; display: string; hz: number }
  /** One registry value. `value` is a whole number for dword and qword (qword may also be a decimal string), text for string and expandString, a list of text for multiString. `name` "" is the key's default value. */
  | { kind: "registry.set"; key: string; name: string; type: RegistryType; value: number | string | string[] }
  /** How a service starts. It doesn't start or stop the service. */
  | { kind: "service.startType"; name: string; start: ServiceStart }
  /** One power setting on the active plan, by GUID or powercfg alias, for plugged in (ac) and battery (dc). */
  | { kind: "power.setting"; subgroup: string; setting: string; ac: number; dc: number };

export type ActionKind = ActionCall["kind"];

/** A registry value exactly as Windows stores it: its type number (REG_DWORD is 4) and its bytes, in base64. */
export interface RegistryRaw { type: number; data: string }

/**
 * Only the helper makes this, as the undo of a registry write: it puts the value back exactly, whatever its type, or
 * removes it when it wasn't there (`was` null), along with the keys the write made (`made`, the highest one) when they are empty.
 */
export interface RegistryRestore { kind: "registry.restore"; key: string; name: string; was: RegistryRaw | null; made?: string }

/** What Undo runs: a catalog call, or a restore only the helper writes. The model can never propose a restore. */
export type UndoCall = ActionCall | RegistryRestore;

/** What the helper found after a fix: whether reading it back showed the change, and if not, what it saw. */
export type FixVerify = { ok: true } | { ok: false; problem: string };

/** The helper's answer to one fix. */
export interface FixApplied { undo: UndoCall; verify?: FixVerify }

/** What a newer fix's target holds now, read by the helper for the preview. The older fixes read from the facts. */
export type FixNow =
  | { kind: "registry.set"; was: RegistryRaw | null }
  /** `display` is the service's name as Windows shows it. */
  | { kind: "service.startType"; start: ServiceStart; display?: string }
  | { kind: "power.setting"; ac: number; dc: number };

export interface ActionInfo {
  kind: ActionKind;
  title: string;
  /** For the model: when this fix helps. */
  when: string;
  needsRestart: boolean;
  /** How risky it is, on the scale in change.ts. Every fix here puts itself back; 2 for changes that need admin rights. A call's own tier is `callTier`. */
  tier: 1 | 2;
  /** JSON schema of the call's fields, without `kind`. */
  schema: Record<string, unknown>;
}

// ----- The power settings power.setting may change (rules/fixes.json) -----

export interface PowerSettingInfo {
  id: string;
  title: string;
  subgroup: string;
  subgroupAlias?: string;
  setting: string;
  settingAlias?: string;
  /** A name for each index, for on-off and pick-one settings. */
  choices?: string[];
  unit?: "seconds" | "percent";
  /** What Rig proposes. */
  range: [number, number];
  /** A value that isn't 0 must be at least this. */
  atLeast?: number;
  /** Windows' own range, which the helper accepts so undo can put back whatever was there. */
  windows: [number, number];
}

export const powerSettings = fixRules.power as PowerSettingInfo[];

const sameId = (a: string, guid: string, alias?: string) => a.toLowerCase() === guid || (!!alias && a.toUpperCase() === alias);

/** The allowed power setting a subgroup and setting name, by GUID or powercfg alias, or undefined. */
export function powerSettingOf(subgroup: string, setting: string): PowerSettingInfo | undefined {
  return powerSettings.find((p) => sameId(subgroup, p.subgroup, p.subgroupAlias) && sameId(setting, p.setting, p.settingAlias));
}

const powerList = powerSettings.map((p) => {
  const values = p.choices ? p.choices.map((c, i) => `${i} ${c.replace(/ \(.*\)$/, "")}`).join(", ") : p.unit === "seconds" ? `seconds, 0 is never, else ${p.atLeast ?? p.range[0]} to ${p.range[1]}` : `percent ${p.range[0]} to ${p.range[1]}`;
  return `${p.title}: subgroup ${p.subgroupAlias ?? p.subgroup}, setting ${p.settingAlias ?? p.setting} (${values})`;
}).join("; ");

// ----- The catalog -----

const prefer = "Prefer it over a general command when it fits.";

export const catalog: ActionInfo[] = [
  {
    kind: "power.plan",
    title: "Switch power plan",
    when: "Heat or noise at idle on a high-performance plan, or low performance on a power saver plan.",
    needsRestart: false,
    tier: 1,
    schema: { type: "object", properties: { guid: { type: "string", description: "GUID of an existing power plan from the facts." } }, required: ["guid"] },
  },
  {
    kind: "startup.app",
    title: "Turn a startup app on or off",
    when: "Slow startup or background apps using memory and CPU.",
    needsRestart: false,
    tier: 1,
    schema: { type: "object", properties: { name: { type: "string", description: "Exact startup app name from the facts." }, enabled: { type: "boolean" } }, required: ["name", "enabled"] },
  },
  {
    kind: "windows.gameMode",
    title: "Game Mode",
    when: "Stutter while background work runs during games.",
    needsRestart: false,
    tier: 1,
    schema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] },
  },
  {
    kind: "windows.visualEffects",
    title: "Windows visual effects",
    when: "An older or slower PC feels sluggish in Windows itself.",
    needsRestart: false,
    tier: 1,
    schema: { type: "object", properties: { mode: { type: "string", enum: ["auto", "appearance", "performance"] } }, required: ["mode"] },
  },
  {
    kind: "power.maxProcessorState",
    title: "Processor speed cap",
    when: "A laptop runs hot or loud. A cap of 99% turns off boost and runs much cooler for a small speed cost.",
    needsRestart: false,
    tier: 1,
    schema: { type: "object", properties: { ac: { type: "integer", minimum: 50, maximum: 100 }, dc: { type: "integer", minimum: 50, maximum: 100 } }, required: ["ac", "dc"] },
  },
  {
    kind: "display.refreshRate",
    title: "Screen refresh rate",
    when: "The screen runs below its highest refresh rate, so games and scrolling look less smooth than they could.",
    needsRestart: false,
    tier: 1,
    schema: { type: "object", properties: { display: { type: "string", description: "Display name from the inventory." }, hz: { type: "integer", minimum: 24, maximum: 600 } }, required: ["display", "hz"] },
  },
  {
    kind: "registry.set",
    title: "Set a registry value",
    when: `Any Windows setting that is one registry value: Rig reads the value now, shows it beside the new one, and undo puts back the old value and its type, or removes it if it wasn't there. HKCU (this person's settings) is tier 1, HKLM (the whole PC) tier 2. Rig refuses its never list and anything that lowers a protection. ${prefer}`,
    needsRestart: false,
    tier: 2,
    schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Full key, starting HKCU\\ or HKLM\\, like HKCU\\Control Panel\\Desktop." },
        name: { type: "string", description: "The value's name; \"\" for the key's default value." },
        type: { type: "string", enum: ["dword", "qword", "string", "expandString", "multiString"] },
        value: { description: "A whole number for dword (0 to 4294967295) and qword, text for string and expandString, a list of text for multiString." },
      },
      required: ["key", "name", "type", "value"],
    },
  },
  {
    kind: "service.startType",
    title: "Change how a service starts",
    when: `A service that starts with Windows but isn't needed, or one that's disabled but needed. Changes only how it starts, not whether it runs now; undo puts back how it started. Tier 2. Rig refuses Windows' security services and anything on its never list. ${prefer}`,
    needsRestart: false,
    tier: 2,
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The service's name (like Spooler), not its display name." },
        start: { type: "string", enum: ["automatic", "automaticDelayed", "manual", "disabled"] },
      },
      required: ["name", "start"],
    },
  },
  {
    kind: "power.setting",
    title: "Change a power setting",
    when: `One setting on the active power plan, for plugged in (ac) and battery (dc); undo puts back the old values. Only these: ${powerList}. ${prefer}`,
    needsRestart: false,
    tier: 1,
    schema: {
      type: "object",
      properties: {
        subgroup: { type: "string", description: "The subgroup's GUID or powercfg alias." },
        setting: { type: "string", description: "The setting's GUID or powercfg alias." },
        ac: { type: "integer", description: "Plugged in." },
        dc: { type: "integer", description: "On battery." },
      },
      required: ["subgroup", "setting", "ac", "dc"],
    },
  },
];

export const actionInfo = (k: ActionKind) => catalog.find((a) => a.kind === k)!;

/** A call's own tier: a registry value for the whole PC (HKLM) is 2, one of this person's (HKCU) is 1; otherwise the catalog's. */
export function callTier(call: ActionCall): 1 | 2 {
  if (call.kind === "registry.set") return registryKeyOf(call.key)?.startsWith("HKLM\\") ? 2 : 1;
  return actionInfo(call.kind).tier;
}

// ----- Checks -----

/** The rules' way of comparing text: fold, short hive names, \ only, no quotes, colons, plus signs or spaces, one \ at a time. Same as check.ts. */
function squash(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase()).replaceAll("hkey_local_machine", "hklm").replaceAll("hkey_current_user", "hkcu").replaceAll("/", "\\")
    .replace(/[`'"+: \t\r\n]/g, "").replace(/\\+/g, "\\");
}
const registryNever = { says: fixRules.registryNever.says, contains: fixRules.registryNever.contains.map(squash) };

/** A registry key as Rig stores it, HKCU\... or HKLM\..., or null when a typed fix can't use it. */
export function registryKeyOf(key: string): string | null {
  if (typeof key !== "string" || /[*?\u0000-\u001f]/.test(key) || key.includes("\\\\") || key.length > 1024) return null;
  const m = /^(?:registry::)?(hkey_current_user|hkcu|hkey_local_machine|hklm)(?::\\|\\)(.+)$/i.exec(key.trim());
  if (!m) return null;
  const rest = m[2].replace(/\\+$/, "");
  if (!rest || rest.split("\\").some((p) => !p.trim() || p === "." || p === ".." || p.length > 255)) return null;
  return `${/^(hkey_current_user|hkcu)$/i.test(m[1]) ? "HKCU" : "HKLM"}\\${rest}`;
}

/** Why a typed registry write to this key and value is refused, or null. The never list, the protection rows and `registryNever`. */
export function registryRefusal(key: string, name: string): string | null {
  const text = `${key}\\${name}`;
  const never = textOnNeverList(text, "run") ?? textLowersProtection(text);
  if (never) return `${never}.`;
  const flat = squash(text);
  return registryNever.contains.some((c) => flat.includes(c)) ? `${registryNever.says}.` : null;
}

interface ServiceRule { name: string; when?: { has?: string[]; tier?: number }[] }
/** The services Set-Service and Stop-Service treat as Windows' own protections, by name and display name. */
const securityServices = new Set((commandRules.commands as ServiceRule[])
  .filter((c) => c.name === "Set-Service" || c.name === "Stop-Service")
  .flatMap((c) => (c.when ?? []).filter((w) => w.tier === 3 && w.has).flatMap((w) => w.has!)));
export const serviceKey = (name: string) => `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${name}`;

/** Why changing how this service starts is refused, or null. */
export function serviceRefusal(name: string): string | null {
  if (securityServices.has(name.toLowerCase())) return "It's one of Windows' own protections (Defender, the firewall, Security Center, the event log or Windows Update), so Rig doesn't change how it starts.";
  const text = `${serviceKey(name)}\\`;
  const never = textOnNeverList(text, "run") ?? textLowersProtection(text);
  return never ? `${never}.` : null;
}

const MAX_TEXT = 32_767;
const noNul = (s: unknown): s is string => typeof s === "string" && !s.includes("\u0000");
const QWORD_MAX = 18446744073709551615n;

function registryValueError(type: unknown, v: unknown): string | null {
  switch (type) {
    case "dword": return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff ? null : "a dword value must be a whole number from 0 to 4294967295";
    case "qword": {
      const ok = (Number.isSafeInteger(v) && (v as number) >= 0) || (typeof v === "string" && /^\d{1,20}$/.test(v) && BigInt(v) <= QWORD_MAX);
      return ok ? null : "a qword value must be a whole number from 0 to 18446744073709551615";
    }
    case "string": case "expandString": return noNul(v) && v.length <= MAX_TEXT ? null : "a string value must be text";
    case "multiString":
      return Array.isArray(v) && v.length <= 1000 && v.every((x) => noNul(x) && x.length > 0) && v.join("").length <= MAX_TEXT ? null : "a multiString value must be a list of text, with no empty lines";
    default: return "type must be dword, qword, string, expandString or multiString";
  }
}

function powerValueError(info: PowerSettingInfo, v: unknown): boolean {
  if (!Number.isInteger(v)) return true;
  const n = v as number;
  if (n < info.range[0] || n > info.range[1]) return true;
  return !!info.atLeast && n !== 0 && n < info.atLeast;
}

const onOff = (v: boolean) => (v ? "On" : "Off");
const effects = { auto: "Let Windows choose", appearance: "Best appearance", performance: "Best performance", custom: "Custom" };

/** Checks a call that came from outside (the model, the server, the web). Returns an error message or null. */
export function validateCall(c: unknown): string | null {
  if (!c || typeof c !== "object") return "Not an object";
  const call = c as Record<string, unknown>;
  const pct = (v: unknown) => Number.isInteger(v) && (v as number) >= 50 && (v as number) <= 100;
  switch (call.kind) {
    case "power.plan": return typeof call.guid === "string" && /^[0-9a-f-]{36}$/i.test(call.guid) ? null : "guid must be a power plan GUID";
    case "startup.app": return typeof call.name === "string" && call.name.length > 0 && typeof call.enabled === "boolean" ? null : "name and enabled are required";
    case "windows.gameMode": return typeof call.enabled === "boolean" ? null : "enabled is required";
    case "windows.visualEffects": return ["auto", "appearance", "performance"].includes(call.mode as string) ? null : "mode must be auto, appearance or performance";
    case "power.maxProcessorState": return pct(call.ac) && pct(call.dc) ? null : "ac and dc must be whole percents from 50 to 100";
    case "display.refreshRate": return typeof call.display === "string" && Number.isInteger(call.hz) && (call.hz as number) >= 24 && (call.hz as number) <= 600 ? null : "display and hz are required";
    case "registry.set": {
      const key = typeof call.key === "string" ? registryKeyOf(call.key) : null;
      if (!key) return "key must be a registry key starting HKCU\\ or HKLM\\, with no wildcards";
      if (!noNul(call.name) || call.name.length > 16_383 || /[\u0000-\u001f]/.test(call.name)) return "name must be the value's name, or \"\" for the default value";
      return registryValueError(call.type, call.value) ?? registryRefusal(key, call.name);
    }
    case "service.startType": {
      if (typeof call.name !== "string" || !/^[A-Za-z0-9_.$ -]{1,256}$/.test(call.name) || !call.name.trim()) return "name must be a service's name";
      if (!["automatic", "automaticDelayed", "manual", "disabled"].includes(call.start as string)) return "start must be automatic, automaticDelayed, manual or disabled";
      return serviceRefusal(call.name.trim());
    }
    case "power.setting": {
      const info = typeof call.subgroup === "string" && typeof call.setting === "string" ? powerSettingOf(call.subgroup, call.setting) : undefined;
      if (!info) return `subgroup and setting must be one of Rig's power settings: ${powerList}`;
      return powerValueError(info, call.ac) || powerValueError(info, call.dc) ? `ac and dc must be ${info.unit === "seconds" ? `seconds, 0 for never or ${info.atLeast ?? info.range[0]} to ${info.range[1]}` : `whole numbers from ${info.range[0]} to ${info.range[1]}`}` : null;
    }
    default: return `Unknown change: ${String(call.kind)}`;
  }
}

// ----- Rows -----

/** Shown before Rig has read a newer fix's target; the helper's apply returns the old value and the row is filled from it. */
export const NOT_READ = "Not read yet";
const NOT_SET = "Not set";

const REG_TYPES: Record<RegistryType, number> = { string: 1, expandString: 2, dword: 4, qword: 11, multiString: 7 };

function bytesOf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const utf16 = (b: Uint8Array) => new TextDecoder("utf-16le").decode(b.length % 2 ? b.slice(0, -1) : b);
const quote = (s: string) => `"${s.length > 80 ? `${s.slice(0, 79)}…` : s}"`;
const list = (xs: string[]) => (xs.length ? xs.map(quote).join(", ") : "An empty list");

/** A registry value as Windows stores it, in plain words. */
export function registryRawText(raw: RegistryRaw | null): string {
  if (!raw) return NOT_SET;
  const b = bytesOf(raw.data);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  switch (raw.type) {
    case 4: return b.length === 4 ? String(view.getUint32(0, true)) : `${b.length} bytes`;
    case 11: return b.length === 8 ? view.getBigUint64(0, true).toString() : `${b.length} bytes`;
    case 1: case 2: return quote(utf16(b).replace(/\u0000+$/, ""));
    case 7: return list(utf16(b).split("\u0000").filter((x) => x.length > 0));
    default: {
      const hex = [...b.slice(0, 16)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
      return b.length === 0 ? "Empty" : `${hex}${b.length > 16 ? " …" : ""} (${b.length} bytes)`;
    }
  }
}

/** A typed value as Windows stores it, the way the helper writes it: little-endian numbers, UTF-16 text ending in a NUL, a list ending in two. */
export function registryRawOf(type: RegistryType, value: number | string | string[]): RegistryRaw {
  let bytes: Uint8Array;
  if (type === "dword" || type === "qword") {
    bytes = new Uint8Array(type === "dword" ? 4 : 8);
    const view = new DataView(bytes.buffer);
    if (type === "dword") view.setUint32(0, Number(value), true);
    else view.setBigUint64(0, BigInt(value as number | string), true);
  } else {
    const text = type === "multiString" ? `${(value as string[]).join("\u0000")}\u0000\u0000` : `${String(value)}\u0000`;
    bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) { bytes[2 * i] = text.charCodeAt(i) & 0xff; bytes[2 * i + 1] = text.charCodeAt(i) >> 8; }
  }
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return { type: REG_TYPES[type], data: btoa(bin) };
}

function registryValueText(type: RegistryType, v: number | string | string[]): string {
  return type === "multiString" ? list(v as string[]) : type === "string" || type === "expandString" ? quote(String(v)) : String(v);
}
const typeWords: Record<number, string> = { 1: "text", 2: "text with variables", 4: "number", 11: "large number", 7: "list", 3: "bytes" };

const startWords: Record<ServiceStart, string> = { automatic: "Starts with Windows", automaticDelayed: "Starts a little after Windows", manual: "Starts when needed", disabled: "Off (disabled)" };

function duration(s: number): string {
  if (s === 0) return "Never";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = [h && `${h} hour${h === 1 ? "" : "s"}`, m && `${m} minute${m === 1 ? "" : "s"}`, sec && `${sec} second${sec === 1 ? "" : "s"}`].filter(Boolean);
  return parts.join(" ");
}
function powerValue(info: PowerSettingInfo, v: number): string {
  if (info.choices) return info.choices[v]?.replace(/ \(.*\)$/, "") ?? String(v);
  return info.unit === "seconds" ? duration(v) : `${v}%`;
}
const pair = (info: PowerSettingInfo, ac: number, dc: number) => (ac === dc ? `${powerValue(info, ac)} / same` : `${powerValue(info, ac)} / ${powerValue(info, dc)}`);

/** What a newer fix's undo says was there before, for the row: the helper read it just before the change. */
export function nowFromUndo(undo: UndoCall): FixNow | undefined {
  switch (undo.kind) {
    case "registry.restore": return { kind: "registry.set", was: undo.was };
    case "service.startType": return { kind: "service.startType", start: undo.start };
    case "power.setting": return { kind: "power.setting", ac: undo.ac, dc: undo.dc };
    default: return undefined;
  }
}

/** Whether the row for this call needs the helper to read the PC first (the facts don't hold it). */
export const needsRead = (call: ActionCall) => call.kind === "registry.set" || call.kind === "service.startType" || call.kind === "power.setting";

/** One before and after row for a call, from the PC's current settings, or for the newer fixes what the helper read (`now`). */
export function describeCall(call: ActionCall, facts: SystemFacts | null, displays: { name: string; refreshHz: number }[] = [], now?: FixNow): DiffRow {
  switch (call.kind) {
    case "power.plan": {
      const was = facts?.powerPlans.find((p) => p.active)?.name ?? "Unknown";
      const next = facts?.powerPlans.find((p) => p.guid.toLowerCase() === call.guid.toLowerCase())?.name ?? call.guid;
      return ["Power plan", was, next];
    }
    case "startup.app": {
      const app = facts?.startupApps.find((a) => a.name === call.name);
      return [call.name, app ? (app.enabled ? "Starts with Windows" : "Off") : "Unknown", call.enabled ? "Starts with Windows" : "Off"];
    }
    case "windows.gameMode": return ["Game Mode", facts ? onOff(facts.gameMode) : "Unknown", onOff(call.enabled)];
    case "windows.visualEffects": return ["Visual effects", facts ? effects[facts.visualEffects] : "Unknown", effects[call.mode]];
    case "power.maxProcessorState": {
      const f = facts?.maxProcessorState;
      return ["Processor speed cap (plugged in / battery)", f ? `${f.ac}% / ${f.dc}%` : "Unknown", `${call.ac}% / ${call.dc}%`];
    }
    case "display.refreshRate": {
      const d = displays.find((x) => x.name === call.display);
      return [`${call.display} refresh rate`, d ? `${d.refreshHz} Hz` : "Unknown", `${call.hz} Hz`];
    }
    case "registry.set": {
      const key = registryKeyOf(call.key) ?? call.key;
      const was = now?.kind === "registry.set" ? now.was : undefined;
      const next = registryValueText(call.type, call.value);
      // Say the type when the value was there as another one, so "1" as text and "1" as a number don't read the same.
      const retyped = was && was.type !== REG_TYPES[call.type];
      return [`${key}\\${call.name || "(Default)"}`, was === undefined ? NOT_READ : `${registryRawText(was)}${retyped ? ` (${typeWords[was.type] ?? `type ${was.type}`})` : ""}`, `${next}${retyped ? ` (${typeWords[REG_TYPES[call.type]]})` : ""}`];
    }
    case "service.startType": {
      const n = now?.kind === "service.startType" ? now : undefined;
      return [`${n?.display ?? call.name} service`, n ? startWords[n.start] : NOT_READ, startWords[call.start]];
    }
    case "power.setting": {
      const info = powerSettingOf(call.subgroup, call.setting);
      if (!info) return [`Power setting ${call.setting}`, NOT_READ, `${call.ac} / ${call.dc}`];
      const n = now?.kind === "power.setting" ? now : info.id === "processorMax" && facts ? facts.maxProcessorState : undefined;
      return [`${info.title} (plugged in / battery)`, n ? pair(info, n.ac, n.dc) : NOT_READ, pair(info, call.ac, call.dc)];
    }
  }
}

/** A short past-tense title for the changes log. */
export function titleFor(calls: ActionCall[]): string {
  if (calls.length > 1 && calls.every((c) => c.kind === "startup.app" && !c.enabled)) return `Turned off ${calls.length} startup apps`;
  if (calls.length > 1) return `${calls.length} changes`;
  const c = calls[0];
  switch (c.kind) {
    case "power.plan": return "Changed the power plan";
    case "startup.app": return `Turned ${c.enabled ? "on" : "off"} ${c.name} at startup`;
    case "windows.gameMode": return `Turned Game Mode ${c.enabled ? "on" : "off"}`;
    case "windows.visualEffects": return "Changed Windows visual effects";
    case "power.maxProcessorState": return c.ac < 100 || c.dc < 100 ? "Capped processor boost" : "Removed the processor cap";
    case "display.refreshRate": return `Set ${c.display} to ${c.hz} Hz`;
    case "registry.set": return `Set ${c.name || "the default value"} in the registry`;
    case "service.startType": return c.start === "disabled" ? `Turned off the ${c.name} service` : `Changed how the ${c.name} service starts`;
    case "power.setting": return `Changed ${powerSettingOf(c.subgroup, c.setting)?.title.toLowerCase() ?? "a power setting"}`;
  }
}
