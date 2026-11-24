// Graphics driver settings: the ones in rules/gpu.json, which the helper
// embeds too. A change is a native op the helper's worker makes as the
// person through NVIDIA's driver settings database, one setting to one value
// from the table, never a free id. AMD and Intel can only be read, and only
// where their drivers let Rig (for now they can't).

import table from "./rules/gpu.json";
import type { Tier } from "./change";

export type GpuVendor = "nvidia" | "amd" | "intel";
export const GPU_VENDORS: GpuVendor[] = ["nvidia", "amd", "intel"];

/** A DRS id or value as the table writes it: a whole number, or hex text like "0x60925292". */
type Raw = number | string;
export interface GpuValue { says: string; set: Record<string, Raw> }
export interface GpuSetting {
  name: string;
  says: string;
  tier: Tier;
  /** global: one setting for the whole PC, never one game's. */
  scope?: "global";
  /** A program picks up the change only when it starts again. */
  nextStart?: true;
  values: Record<string, GpuValue>;
  /** A whole number for one id instead of a named choice. `says` has {n} where the number goes. */
  range?: { id: string; min: number; max: number; says: string };
}

/** NVIDIA's settings Rig offers, by key. */
export const GPU_SETTINGS = (table.nvidia.settings as Record<string, GpuSetting>);

/** A graphics driver setting changed to one of the table's values, for one game or for the whole PC. */
export interface GpuOp {
  name: "gpu";
  vendor: "nvidia";
  /** The game's program file name, like game.exe, in lower case. Left out for the whole PC. */
  app?: string;
  /** A key of GPU_SETTINGS. */
  setting: string;
  /** A key of the setting's values, or a whole number in its range, written plainly. */
  value: string;
  /** Claude's one sentence, shown labelled as Claude's. */
  does: string;
}

const APP = /^[a-z0-9][a-z0-9 _.()+-]{0,99}\.exe$/;

/** A program file name as the table and NVIDIA's database match it, or null when it isn't one. */
export function gpuApp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const app = raw.toLowerCase();
  return APP.test(app) && !app.includes("..") ? app : null;
}

export const gpuSetting = (key: unknown): GpuSetting | undefined => (typeof key === "string" && Object.hasOwn(GPU_SETTINGS, key) ? GPU_SETTINGS[key] : undefined);

/** The plain words for one of a setting's values, or null when the value isn't one Rig offers. */
export function gpuValueSays(setting: GpuSetting, value: string): string | null {
  if (Object.hasOwn(setting.values, value)) return setting.values[value].says;
  const r = setting.range;
  if (!r || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const n = Number(value);
  return n >= r.min && n <= r.max ? r.says.replace("{n}", value) : null;
}

const vendorWords = "Rig can only change NVIDIA's graphics settings for now.";
const windowsWords = "That is one of Windows' own programs, not a game, so Rig doesn't change its graphics settings.";

/** The op as the helper stores and checks it, or what is wrong with it in plain words. Same rules as GpuStep.Check in the helper. */
export function canonicalGpu(raw: Record<string, unknown>): GpuOp | string {
  if (raw.vendor !== "nvidia") return GPU_VENDORS.includes(raw.vendor as GpuVendor) ? vendorWords : "vendor must be nvidia.";
  const setting = gpuSetting(raw.setting);
  if (!setting) return `Rig doesn't change that graphics setting. It changes: ${Object.keys(GPU_SETTINGS).join(", ")}.`;
  const value = typeof raw.value === "string" ? raw.value : typeof raw.value === "number" ? String(raw.value) : "";
  if (gpuValueSays(setting, value) === null) {
    const range = setting.range ? `, or a whole number from ${setting.range.min} to ${setting.range.max}` : "";
    return `${setting.name} takes one of: ${Object.keys(setting.values).join(", ")}${range}.`;
  }
  let app: string | undefined;
  if (raw.app !== undefined && raw.app !== null && raw.app !== "") {
    const a = gpuApp(raw.app);
    if (!a) return "app must be the game's program file name, like game.exe, with no folder.";
    if (setting.scope === "global") return `${setting.name} is one setting for the whole PC, not for one game. Leave app out.`;
    if (table.nvidia.windowsApps.includes(a)) return windowsWords;
    app = a;
  }
  if (typeof raw.does !== "string" || !raw.does.trim() || raw.does.length > 300) return "does must be one plain sentence.";
  return { name: "gpu", vendor: "nvidia", ...(app ? { app } : {}), setting: raw.setting as string, value, does: raw.does };
}

/** A short past-tense title for the changes log, like "Set Vertical sync to Off for game.exe". */
export function gpuTitle(op: GpuOp): string {
  const s = GPU_SETTINGS[op.setting];
  return `Set ${s.name} to ${gpuValueSays(s, op.value)} ${op.app ? `for ${op.app}` : "for every game"}`;
}
