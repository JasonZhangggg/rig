// What Ask can look at on the PC while it answers. On the desktop the server
// ends a round with the reads it wants, the Rig app runs them through the
// helper and sends the results back. Nothing here changes anything: a script
// read has to check as tier 0, and registry and CIM reads are built from
// fixed parts, never free WQL.

import { checkScript, textOnNeverList } from "./check";
import { gpuApp, gpuSetting, GPU_VENDORS, type GpuVendor } from "./gpu";
import rulesJson from "./rules/reads.json";

export interface CimFilter { property: string; value: string | number | boolean }

export type PcReadSpec =
  /** One registry key's values, or one value. HKLM\... or HKCU\... */
  | { kind: "registry"; key: string; value?: string }
  /** Instances of a CIM class, like Win32_VideoController. The filter is property = literal pairs, joined with AND. */
  | { kind: "cim"; class: string; namespace?: string; properties?: string[]; filter?: CimFilter[] }
  /** One PowerShell command line, like `Get-Service -Name wuauserv`. Must check as a read. */
  | { kind: "cmdlet"; command: string }
  /** A short PowerShell script that only looks. Must check as a read. */
  | { kind: "script"; script: string }
  /** Graphics driver settings from Rig's table (rules/gpu.json): one game's (by its exe name) or the whole PC's. */
  | { kind: "gpu"; vendor: GpuVendor; app?: string; settings?: string[] };

/** A read the server asks the PC for. `id` ties the answer to the model's tool call. */
export type PcRead = PcReadSpec & { id: string };

export type PcReadResult = { id: string; ok: true; text: string } | { id: string; ok: false; error: string };

export const READ_LIMITS = {
  /** Reads in one round. */
  perRound: 6,
  /** Characters of one result kept on the PC and sent back. */
  resultChars: 20_000,
  /** Characters of one result the model sees. */
  modelChars: 8_000,
  properties: 16,
  filters: 4,
} as const;

interface CimClass { clean?: boolean; text?: string[]; deny?: string[] }
interface ReadRules {
  version: number;
  cim: Record<string, Record<string, CimClass>>;
  secretProperty: string[];
  registryClean: { key: string; values?: string[] }[];
  registryNever: { says: string; keys: string[] }[];
  secretValue: string[];
  keyValue: string[];
  keyMinBytes: number;
  keyMinChars: number;
}

/** The one table of what reads may look at, shared with the helper (rules/reads.json). */
export const READ_RULES = rulesJson as ReadRules;

const low = (s: string) => s.toLowerCase();
const CIM = new Map(Object.entries(READ_RULES.cim).map(([ns, classes]) => [low(ns), new Map(Object.entries(classes).map(([c, e]) => [low(c), e]))]));
const DEFAULT_NS = "root\\cimv2";

/** A CIM class Rig reads, or null when it isn't on the list. */
function cimClass(ns: string | undefined, cls: string): CimClass | null {
  return CIM.get(low(ns ?? DEFAULT_NS))?.get(low(cls)) ?? null;
}

const has = (list: string[] | undefined, name: string) => !!list?.some((x) => low(x) === low(name));
const secretProperty = (name: string) => READ_RULES.secretProperty.some((s) => low(name).includes(s));
/** A registry value whose name says it holds a secret. Values named like a key are judged by their data, on the PC. */
export const secretValue = (name: string) => READ_RULES.secretValue.some((s) => low(name).includes(s));

const parts = (key: string) => low(key).split("\\").filter(Boolean);
const rooted = (k: string) => /^(hklm|hkcu)$/i.test(k.split("\\")[0]);

/** Whether `key` starts with `prefix`, whole parts at a time. */
function under(key: string, prefix: string): boolean {
  const k = parts(key), p = parts(prefix);
  return p.length <= k.length && p.every((x, i) => k[i] === x);
}

/** The words of the never-list entry a registry key falls under, or null. */
export function registryNever(key: string): string | null {
  const k = parts(key);
  for (const rule of READ_RULES.registryNever) {
    for (const entry of rule.keys) {
      const p = parts(entry);
      if (rooted(entry) ? under(key, entry) : k.some((_, i) => p.every((x, j) => k[i + j] === x))) return rule.says;
    }
  }
  return null;
}

/**
 * Whether a read brings back text someone else could have written. Only the listed CIM classes (and, for those with free-text
 * properties, reads that name only their other properties) and the listed registry keys count as clean; everything else
 * read, including every command and script, counts as outside text.
 */
export function readTaints(r: PcReadSpec): boolean {
  switch (r.kind) {
    case "registry":
      return !READ_RULES.registryClean.some((c) => under(r.key, c.key) && (!c.values || (r.value !== undefined && has(c.values, r.value))));
    case "cim": {
      const e = cimClass(r.namespace, r.class);
      if (!e?.clean) return true;
      if (!e.text?.length) return false;
      return !r.properties?.length || r.properties.some((p) => has(e.text, p));
    }
    // Values come from Rig's own table, and the helper names only NVIDIA's own profiles.
    case "gpu":
      return false;
    default:
      return true;
  }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NAMESPACE = /^root(\\[A-Za-z0-9_]{1,64}){0,4}$/i;

function hiveKey(key: string): string | null {
  const k = key.trim().replace(/^HKEY_LOCAL_MACHINE(?=\\|$)/i, "HKLM").replace(/^HKEY_CURRENT_USER(?=\\|$)/i, "HKCU").replace(/^(HKLM|HKCU):/i, "$1");
  if (!/^(HKLM|HKCU)\\[^\\]/i.test(k) || k.includes("\\\\") || k.length > 300 || /[\u0000-\u001f]/.test(k)) return null;
  return k.replace(/\\$/, "");
}

/** Checks a read the model asked for. Returns the read with only its own fields, or why it can't be done, in plain words. */
export function checkRead(raw: unknown): PcReadSpec | string {
  if (!raw || typeof raw !== "object") return "A read needs a kind: registry, cim, cmdlet, script or gpu.";
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "registry": {
      const key = typeof r.key === "string" ? hiveKey(r.key) : null;
      if (!key) return "A registry read needs a full key that starts with HKLM\\ or HKCU\\, like HKCU\\Control Panel\\Desktop.";
      if (r.value !== undefined && (typeof r.value !== "string" || r.value.length > 200)) return "value must be the name of one value in that key.";
      const value = r.value as string | undefined;
      const never = registryNever(key) ?? textOnNeverList(`${key}\\${value ?? ""}`, "read");
      if (never) return `${never}.`;
      if (value !== undefined && secretValue(value)) return "Rig never reads a value whose name says it holds a password, key or token.";
      return value === undefined ? { kind: "registry", key } : { kind: "registry", key, value };
    }
    case "cim": {
      const cls = r.class;
      if (typeof cls !== "string" || !NAME.test(cls)) return "A CIM read needs a class name like Win32_VideoController.";
      const ns = r.namespace === undefined ? undefined : r.namespace;
      if (ns !== undefined && (typeof ns !== "string" || !NAMESPACE.test(ns))) return "namespace must look like root\\cimv2.";
      const props = r.properties === undefined ? undefined : r.properties;
      if (props !== undefined && (!Array.isArray(props) || props.length > READ_LIMITS.properties || !props.every((p) => typeof p === "string" && NAME.test(p)))) {
        return `properties must be up to ${READ_LIMITS.properties} property names.`;
      }
      const filter = r.filter === undefined ? undefined : r.filter;
      if (filter !== undefined) {
        if (!Array.isArray(filter) || filter.length > READ_LIMITS.filters) return `filter must be up to ${READ_LIMITS.filters} property = value pairs.`;
        for (const f of filter) {
          const ok = f && typeof f === "object" && typeof f.property === "string" && NAME.test(f.property)
            && (typeof f.value === "boolean" || (typeof f.value === "number" && Number.isFinite(f.value)) || (typeof f.value === "string" && f.value.length <= 200 && !/[\u0000-\u001f]/.test(f.value)));
          if (!ok) return "Each filter is a property name and a plain value (text, a number or true/false).";
        }
      }
      const entry = cimClass(ns, cls);
      if (!entry) return `Rig doesn't read ${cls}${ns ? ` in ${ns}` : ""}. It reads hardware, Windows, power, display, TPM, services, devices and drivers, network and firewall classes, like Win32_VideoController or MSFT_NetAdapter in root\\StandardCimv2.`;
      const named = [...(props ?? []), ...((filter ?? []) as CimFilter[]).map((f) => f.property)] as string[];
      const off = named.find((p) => has(entry.deny, p) || secretProperty(p));
      if (off) return `Rig never reads ${cls}.${off}.`;
      const never = textOnNeverList(`${ns ?? ""}\\${cls}\\${(props ?? []).join(",")}`, "read");
      if (never) return `${never}.`;
      return {
        kind: "cim", class: cls, ...(ns ? { namespace: ns } : {}), ...(props?.length ? { properties: props as string[] } : {}),
        ...(filter?.length ? { filter: (filter as CimFilter[]).map((f) => ({ property: f.property, value: f.value })) } : {}),
      };
    }
    case "cmdlet":
    case "script": {
      const text = r.kind === "cmdlet" ? r.command : r.script;
      if (typeof text !== "string" || !text.trim()) return r.kind === "cmdlet" ? "A cmdlet read needs the command line to run." : "A script read needs the script.";
      if (r.kind === "cmdlet" && /[\r\n;]/.test(text.trim())) return "A cmdlet read is one command line. Use a script read for more.";
      const v = checkScript(text, "read");
      if (v.status === "refused") return v.refused;
      if (v.tier !== 0) return "Rig only runs reads that look and change nothing.";
      return r.kind === "cmdlet" ? { kind: "cmdlet", command: text.trim() } : { kind: "script", script: text };
    }
    case "gpu": {
      if (!GPU_VENDORS.includes(r.vendor as GpuVendor)) return "A gpu read needs vendor: nvidia, amd or intel.";
      const app = r.app === undefined || r.app === "" ? undefined : gpuApp(r.app);
      if (app === null) return "app must be the game's program file name, like game.exe, with no folder.";
      const settings = r.settings === undefined ? undefined : r.settings;
      if (settings !== undefined && (!Array.isArray(settings) || settings.length > READ_LIMITS.properties || !settings.every((k) => gpuSetting(k)))) {
        return "settings must be keys from Rig's list of graphics settings, like vsync or lowLatency. Leave it out for all of them.";
      }
      return { kind: "gpu", vendor: r.vendor as GpuVendor, ...(app ? { app } : {}), ...(settings?.length ? { settings: settings as string[] } : {}) };
    }
    default:
      return "A read needs a kind: registry, cim, cmdlet, script or gpu.";
  }
}

/** A read in a few plain words, like "registry HKCU\Control Panel\Desktop". */
export function readWhat(r: PcReadSpec): string {
  switch (r.kind) {
    case "registry": return `registry ${r.key}${r.value !== undefined ? ` value ${r.value || "(default)"}` : ""}`;
    case "cim": return `CIM ${r.class}${r.filter?.length ? ` where ${r.filter.map((f) => `${f.property} = ${JSON.stringify(f.value)}`).join(" and ")}` : ""}`;
    case "cmdlet": return `command ${r.command.slice(0, 120)}`;
    case "script": return "a read-only script";
    case "gpu": return `${r.vendor} graphics settings${r.app ? ` for ${r.app}` : ""}`;
  }
}
