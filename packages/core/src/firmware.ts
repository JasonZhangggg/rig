// Firmware (BIOS) settings: the few in rules/firmware.json, which the helper
// embeds too. A change is a native op the helper makes with admin rights,
// through the maker's own management class (Dell, HP, Lenovo), one setting
// to one value from the table, never a free attribute name. It applies at the
// next restart, and Rig reads it back from Windows after that restart. Where a
// PC has no maker class, Rig gives the steps and the app offers to restart
// into firmware setup (restartToFirmware), which takes nothing from the model.

import table from "./rules/firmware.json";
import type { DiffRow } from "./model";

export type FirmwareMaker = keyof typeof table.makers;
export const FIRMWARE_MAKERS = Object.keys(table.makers) as FirmwareMaker[];
export const FIRMWARE_MAKER_NAMES = Object.fromEntries(Object.entries(table.makers).map(([k, v]) => [k, v.name])) as Record<FirmwareMaker, string>;

export interface FirmwareMakerRow {
  attribute: string;
  values: Record<string, string>;
  /** False: the maker lets Windows change it only with a firmware password, which Rig never uses. */
  fromWindows?: false;
  why?: string;
  /** The firmware asks the person to confirm at the next start. */
  asks?: string;
}

export interface FirmwareSetting {
  name: string;
  says: string;
  values: Record<string, string>;
  allow: string[];
  refuse?: Record<string, string>;
  /** BitLocker and device encryption measure it. */
  sealed?: true;
  /** Rig won't set the old value back. */
  undo?: false;
  windows?: "tpm" | "secureBoot" | "virtualization";
  makers: Partial<Record<FirmwareMaker, FirmwareMakerRow>>;
}

export const FIRMWARE_SETTINGS = table.settings as Record<string, FirmwareSetting>;
export const FIRMWARE_NEVER = table.never as { says: string; words: string[] }[];

/** One firmware setting from Rig's list set to one of its values. Which maker's attribute it is, the helper works out. */
export interface FirmwareOp {
  name: "firmware";
  /** A key of FIRMWARE_SETTINGS. */
  setting: string;
  /** A key of the setting's values. */
  value: string;
  /** Claude's one sentence, shown labelled as Claude's. */
  does: string;
}

/** Restarts this PC in a minute into its firmware setup. It takes nothing from the model: the app draws its button. */
export interface RestartFirmwareOp { name: "restartToFirmware" }

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The never words a setting's name falls under, or null. */
export function firmwareNever(setting: string): string | null {
  const f = fold(setting);
  return FIRMWARE_NEVER.find((n) => n.words.some((w) => f.includes(fold(w))))?.says ?? null;
}

export const firmwareSetting = (key: unknown): FirmwareSetting | undefined =>
  typeof key === "string" && Object.hasOwn(FIRMWARE_SETTINGS, key) ? FIRMWARE_SETTINGS[key] : undefined;

const list = () => Object.keys(FIRMWARE_SETTINGS).join(", ");

/** The op as the helper stores and checks it, or what is wrong with it in plain words. Same rules as FirmwareStep.Check in the helper. */
export function canonicalFirmware(raw: Record<string, unknown>): FirmwareOp | string {
  if (typeof raw.setting !== "string" || !raw.setting.trim() || raw.setting.length > 64) return `setting must be one of: ${list()}.`;
  if (typeof raw.does !== "string" || !raw.does.trim() || raw.does.length > 300) return "does must be one plain sentence.";
  const value = typeof raw.value === "string" ? raw.value : "";
  const s = firmwareSetting(raw.setting);
  // A setting on the never list is kept as it was asked for, so the refusal can say it is never made.
  if (!s) return firmwareNever(raw.setting) ? { name: "firmware", setting: raw.setting, value: value.slice(0, 32), does: raw.does } : `Rig doesn't change that firmware setting. It changes: ${list()}.`;
  if (!Object.hasOwn(s.values, value)) return `${s.name} takes one of: ${s.allow.join(", ")}.`;
  return { name: "firmware", setting: raw.setting, value, does: raw.does };
}

/** Why this op is never made, or null. */
export function firmwareRefused(op: FirmwareOp): string | null {
  const s = firmwareSetting(op.setting);
  if (!s) return firmwareNever(op.setting) ?? "Rig doesn't change that firmware setting";
  return s.allow.includes(op.value) ? null : s.refuse?.[op.value] ?? `Rig doesn't set ${s.name} to ${s.values[op.value]}`;
}

export function firmwareTitle(op: FirmwareOp): string {
  const s = firmwareSetting(op.setting);
  return s ? `Set ${s.name} to ${s.values[op.value]}` : "Changed a firmware setting";
}

export function firmwareReasons(op: FirmwareOp): string[] {
  const s = firmwareSetting(op.setting);
  const out = ["A firmware (BIOS) setting from Rig's own list. It applies at the next restart, and Rig checks it after that restart."];
  if (s?.undo === false) out.push(`Rig won't turn ${s.name} off again for you. You can in firmware setup.`);
  return out;
}

/** The setting's value in the helper's line, "Virtualization (Intel VT-x or AMD-V): On", or null. */
export function firmwareNow(line: string | undefined): string | null {
  const first = line?.split("\n")[0]?.trim();
  const m = first ? /: ([^:]+)$/.exec(first) : null;
  return m ? m[1] : null;
}

/** Whether the helper's read says BitLocker or device encryption protects the system drive. */
export const firmwareSealed = (line: string | undefined) => /^Drive encryption on drive [A-Z]: (on|not known)$/m.test(line ?? "");

export function firmwareRows(op: FirmwareOp, before?: string, after?: string): DiffRow[] {
  const s = firmwareSetting(op.setting);
  if (!s) return [];
  return [[s.name, firmwareNow(before) ?? "As it is now", firmwareNow(after) ?? s.values[op.value]]];
}

export const RESTART_WORDS = {
  tier: "Restarts this PC in one minute and opens its firmware setup. Save your work first; Cancel stops it.",
  title: "Restarted into firmware setup",
  row: ["Next restart", "Starts Windows", "Opens firmware setup"] as DiffRow,
};
