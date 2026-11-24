// What Ask can look at on the PC while it answers. On the desktop the server
// ends a round with the reads it wants, the Rig app runs them through the
// helper and sends the results back. Nothing here changes anything: a script
// read has to check as tier 0, and registry and CIM reads are built from
// fixed parts, never free WQL.

import { checkScript, textOnNeverList } from "./check";

export interface CimFilter { property: string; value: string | number | boolean }

export type PcReadSpec =
  /** One registry key's values, or one value. HKLM\... or HKCU\... */
  | { kind: "registry"; key: string; value?: string }
  /** Instances of a CIM class, like Win32_VideoController. The filter is property = literal pairs, joined with AND. */
  | { kind: "cim"; class: string; namespace?: string; properties?: string[]; filter?: CimFilter[] }
  /** One PowerShell command line, like `Get-Service -Name wuauserv`. Must check as a read. */
  | { kind: "cmdlet"; command: string }
  /** A short PowerShell script that only looks. Must check as a read. */
  | { kind: "script"; script: string };

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

/** CIM classes whose values are text other programs wrote, like event messages. Reading them counts as outside text. */
const FREE_TEXT_CLASSES = new Set(["win32_ntlogevent", "win32_reliabilityrecords"]);

/**
 * Whether a read brings back free text someone else could have written (script and command output,
 * event messages, file contents). Registry and CIM values are structured, so they don't count.
 */
export function readTaints(r: PcReadSpec): boolean {
  return r.kind === "cmdlet" || r.kind === "script" || (r.kind === "cim" && FREE_TEXT_CLASSES.has(r.class.toLowerCase()));
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
  if (!raw || typeof raw !== "object") return "A read needs a kind: registry, cim, cmdlet or script.";
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "registry": {
      const key = typeof r.key === "string" ? hiveKey(r.key) : null;
      if (!key) return "A registry read needs a full key that starts with HKLM\\ or HKCU\\, like HKCU\\Control Panel\\Desktop.";
      if (r.value !== undefined && (typeof r.value !== "string" || r.value.length > 200)) return "value must be the name of one value in that key.";
      const value = r.value as string | undefined;
      const never = textOnNeverList(`${key}\\${value ?? ""}`, "read");
      if (never) return `${never}.`;
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
    default:
      return "A read needs a kind: registry, cim, cmdlet or script.";
  }
}

/** A read in a few plain words, like "registry HKCU\Control Panel\Desktop". */
export function readWhat(r: PcReadSpec): string {
  switch (r.kind) {
    case "registry": return `registry ${r.key}${r.value !== undefined ? ` value ${r.value || "(default)"}` : ""}`;
    case "cim": return `CIM ${r.class}${r.filter?.length ? ` where ${r.filter.map((f) => `${f.property} = ${JSON.stringify(f.value)}`).join(" and ")}` : ""}`;
    case "cmdlet": return `command ${r.command.slice(0, 120)}`;
    case "script": return "a read-only script";
  }
}
