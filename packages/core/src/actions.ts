// Every change Rig can make, in one list. The model may only propose these,
// the server checks proposals against it, the desktop shows them and the
// helper carries them out. Each one is reversible: applying it returns the
// call that puts things back, which is what Undo runs.

import type { DiffRow } from "./model";
import type { SystemFacts } from "./telemetry";

export type ActionCall =
  | { kind: "power.plan"; guid: string }
  | { kind: "startup.app"; name: string; enabled: boolean }
  | { kind: "windows.gameMode"; enabled: boolean }
  | { kind: "windows.visualEffects"; mode: "auto" | "appearance" | "performance" }
  | { kind: "power.maxProcessorState"; ac: number; dc: number }
  | { kind: "display.refreshRate"; display: string; hz: number };

export type ActionKind = ActionCall["kind"];

export interface ActionInfo {
  kind: ActionKind;
  title: string;
  /** For the model: when this fix helps. */
  when: string;
  needsRestart: boolean;
  /** JSON schema of the call's fields, without `kind`. */
  schema: Record<string, unknown>;
}

export const catalog: ActionInfo[] = [
  {
    kind: "power.plan",
    title: "Switch power plan",
    when: "Heat or noise at idle on a high-performance plan, or low performance on a power saver plan.",
    needsRestart: false,
    schema: { type: "object", properties: { guid: { type: "string", description: "GUID of an existing power plan from the facts." } }, required: ["guid"] },
  },
  {
    kind: "startup.app",
    title: "Turn a startup app on or off",
    when: "Slow startup or background apps using memory and CPU.",
    needsRestart: false,
    schema: { type: "object", properties: { name: { type: "string", description: "Exact startup app name from the facts." }, enabled: { type: "boolean" } }, required: ["name", "enabled"] },
  },
  {
    kind: "windows.gameMode",
    title: "Game Mode",
    when: "Stutter while background work runs during games.",
    needsRestart: false,
    schema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] },
  },
  {
    kind: "windows.visualEffects",
    title: "Windows visual effects",
    when: "An older or slower PC feels sluggish in Windows itself.",
    needsRestart: false,
    schema: { type: "object", properties: { mode: { type: "string", enum: ["auto", "appearance", "performance"] } }, required: ["mode"] },
  },
  {
    kind: "power.maxProcessorState",
    title: "Processor speed cap",
    when: "A laptop runs hot or loud. A cap of 99% turns off boost and runs much cooler for a small speed cost.",
    needsRestart: false,
    schema: { type: "object", properties: { ac: { type: "integer", minimum: 50, maximum: 100 }, dc: { type: "integer", minimum: 50, maximum: 100 } }, required: ["ac", "dc"] },
  },
  {
    kind: "display.refreshRate",
    title: "Screen refresh rate",
    when: "The screen runs below its highest refresh rate, so games and scrolling look less smooth than they could.",
    needsRestart: false,
    schema: { type: "object", properties: { display: { type: "string", description: "Display name from the inventory." }, hz: { type: "integer", minimum: 24, maximum: 600 } }, required: ["display", "hz"] },
  },
];

export const actionInfo = (k: ActionKind) => catalog.find((a) => a.kind === k)!;

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
    default: return `Unknown change: ${String(call.kind)}`;
  }
}

/** One before and after row for a call, from the PC's current settings. */
export function describeCall(call: ActionCall, facts: SystemFacts | null, displays: { name: string; refreshHz: number }[] = []): DiffRow {
  switch (call.kind) {
    case "power.plan": {
      const now = facts?.powerPlans.find((p) => p.active)?.name ?? "Unknown";
      const next = facts?.powerPlans.find((p) => p.guid.toLowerCase() === call.guid.toLowerCase())?.name ?? call.guid;
      return ["Power plan", now, next];
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
  }
}
