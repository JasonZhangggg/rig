// Every change Rig can make, in one list. The model may only propose these,
// the server checks proposals against it, the desktop shows them and the
// helper carries them out. Each one is reversible: applying it returns the
// call that puts things back, which is what Undo runs.

import type { DiffRow } from "./model";
import fixRules from "./rules/fixes.json";
import type { SystemFacts } from "./telemetry";

export type ActionCall =
  | { kind: "power.plan"; guid: string }
  | { kind: "startup.app"; name: string; enabled: boolean }
  | { kind: "windows.gameMode"; enabled: boolean }
  | { kind: "windows.visualEffects"; mode: "auto" | "appearance" | "performance" }
  | { kind: "power.maxProcessorState"; ac: number; dc: number }
  | { kind: "display.refreshRate"; display: string; hz: number }
  /** One power setting on the active plan, by GUID or powercfg alias, for plugged in (ac) and battery (dc). */
  | { kind: "power.setting"; subgroup: string; setting: string; ac: number; dc: number };

export type ActionKind = ActionCall["kind"];

/** What the helper found after a fix: whether reading it back showed the change, and if not, what it saw. */
export type FixVerify = { ok: true } | { ok: false; problem: string };

/** The helper's answer to one fix. */
export interface FixApplied { undo: ActionCall; verify?: FixVerify }

/** What a power setting holds now, read by the helper for the preview. The other fixes read from the facts. */
export type FixNow = { kind: "power.setting"; ac: number; dc: number };

export interface ActionInfo {
  kind: ActionKind;
  title: string;
  /** For the model: when this fix helps. */
  when: string;
  needsRestart: boolean;
  /** How risky it is, on the scale in change.ts. Every fix here is small and puts itself back, so 1. */
  tier: 1;
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
  /** What Rig sets, here and in the helper. Undo puts back the old value, or the nearest one in this range. */
  range: [number, number];
  /** A value that isn't 0 must be at least this. */
  atLeast?: number;
  /** Windows' own range. */
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

// ----- Checks -----

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
    case "power.setting": {
      const info = typeof call.subgroup === "string" && typeof call.setting === "string" ? powerSettingOf(call.subgroup, call.setting) : undefined;
      if (!info) return `subgroup and setting must be one of Rig's power settings: ${powerList}`;
      return powerValueError(info, call.ac) || powerValueError(info, call.dc) ? `ac and dc must be ${info.unit === "seconds" ? `seconds, 0 for never or ${info.atLeast ?? info.range[0]} to ${info.range[1]}` : `whole numbers from ${info.range[0]} to ${info.range[1]}`}` : null;
    }
    default: return `Unknown change: ${String(call.kind)}`;
  }
}

// ----- Rows -----

/** Shown before Rig has read a power setting; the helper's apply returns the old value and the row is filled from it. */
export const NOT_READ = "Not read yet";

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

/** What a power setting's undo says was there before, for the row: the helper read it just before the change. */
export function nowFromUndo(undo: ActionCall): FixNow | undefined {
  return undo.kind === "power.setting" ? { kind: "power.setting", ac: undo.ac, dc: undo.dc } : undefined;
}

/** Whether the row for this call needs the helper to read the PC first (the facts don't hold it). */
export const needsRead = (call: ActionCall) => call.kind === "power.setting";

/** One before and after row for a call, from the PC's current settings, or for a power setting what the helper read (`now`). */
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
    case "power.setting": {
      const info = powerSettingOf(call.subgroup, call.setting);
      if (!info) return [`Power setting ${call.setting}`, NOT_READ, `${call.ac} / ${call.dc}`];
      const n = now ?? (info.id === "processorMax" && facts ? facts.maxProcessorState : undefined);
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
    case "power.setting": return `Changed ${powerSettingOf(c.subgroup, c.setting)?.title.toLowerCase() ?? "a power setting"}`;
  }
}
