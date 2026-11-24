// Shorthands for the two changes asked for most: one registry value, and how a
// service starts. Each builds an ordinary command step, so it is checked, run,
// snapshotted and undone exactly like a command the model wrote. There is no
// undo script: the helper's snapshot of the registry key or the service puts
// it back.

import type { Command, Touch } from "./change";
import { plain, quote } from "./shorthands/text";

export * from "./shorthands/firewall";
export * from "./shorthands/policy";
export * from "./shorthands/device";
export * from "./shorthands/driver";
export * from "./shorthands/app";

export type RegistryType = "dword" | "qword" | "string" | "expandString" | "multiString";
/** How a service starts. `automaticDelayed` is automatic, a little after Windows has started. */
export type ServiceStart = "automatic" | "automaticDelayed" | "manual" | "disabled";

/** One registry value. `value` is a whole number for dword and qword (qword may also be a decimal string), text for string and expandString, a list of text for multiString. `name` "" is the key's default value. */
export interface RegistryShorthand { key: string; name: string; type: RegistryType; value: number | string | string[] }
export interface ServiceShorthand { name: string; startType: ServiceStart }

const PS_TYPES: Record<RegistryType, string> = { dword: "DWord", qword: "QWord", string: "String", expandString: "ExpandString", multiString: "MultiString" };
const PS_STARTS: Record<Exclude<ServiceStart, "automaticDelayed">, string> = { automatic: "Automatic", manual: "Manual", disabled: "Disabled" };
const START_WORDS: Record<ServiceStart, string> = { automatic: "start with Windows", automaticDelayed: "start a little after Windows", manual: "start only when needed", disabled: "never start (disabled)" };

const MAX_TEXT = 32_767;
const DWORD_MAX = 0xffffffffn;
const QWORD_MAX = 0xffffffffffffffffn;

/** HKCU\... or HKLM\..., or why the key can't be used. */
function keyOf(raw: unknown): { hive: "HKCU" | "HKLM"; rest: string } | string {
  const bad = "key must be a registry key starting HKCU\\ or HKLM\\, in plain letters, with no wildcards";
  if (typeof raw !== "string" || raw.length > 1024 || !plain(raw) || /[*?[\]]/.test(raw) || raw.includes("\\\\")) return bad;
  const m = /^(?:registry::)?(hkey_current_user|hkcu|hkey_local_machine|hklm)(?::\\|\\)(.+)$/i.exec(raw.trim());
  if (!m) return bad;
  const rest = m[2].replace(/\\+$/, "");
  if (!rest || rest.split("\\").some((p) => !p.trim() || p === "." || p === ".." || p.length > 255)) return bad;
  return { hive: /^(hkey_current_user|hkcu)$/i.test(m[1]) ? "HKCU" : "HKLM", rest };
}

/** The number as PowerShell 5.1 should read it: decimal while it fits a signed number of that size, else hex, which it reads as the same bits. */
function numberText(type: "dword" | "qword", v: unknown): string | null {
  let n: bigint;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) n = BigInt(v);
  else if (type === "qword" && typeof v === "string" && /^\d{1,20}$/.test(v)) n = BigInt(v);
  else return null;
  const max = type === "dword" ? DWORD_MAX : QWORD_MAX, signed = type === "dword" ? 0x7fffffffn : 0x7fffffffffffffffn;
  if (n > max) return null;
  return n <= signed ? n.toString() : `0x${n.toString(16).toUpperCase().padStart(type === "dword" ? 8 : 16, "0")}`;
}

const textOk = (s: unknown): s is string => typeof s === "string" && s.length <= MAX_TEXT && plain(s);

/** The value as PowerShell text, or why it can't be used. */
function valueText(type: unknown, v: unknown): string | { error: string } {
  switch (type) {
    case "dword": return numberText("dword", v) ?? { error: "a dword value must be a whole number from 0 to 4294967295" };
    case "qword": return numberText("qword", v) ?? { error: "a qword value must be a whole number from 0 to 18446744073709551615" };
    case "string": case "expandString": return textOk(v) ? quote(v) : { error: "a string value must be text in plain letters, with no line breaks" };
    case "multiString":
      return Array.isArray(v) && v.length > 0 && v.length <= 1000 && v.every((x) => textOk(x) && x.length > 0) && v.join("").length <= MAX_TEXT
        ? `@(${v.map(quote).join(", ")})`
        : { error: "a multiString value must be a list of text in plain letters, with no empty lines" };
    default: return { error: "type must be dword, qword, string, expandString or multiString" };
  }
}

function shown(type: RegistryType, v: RegistryShorthand["value"]): string {
  const text = Array.isArray(v) ? v.join(", ") : String(v);
  return type === "dword" || type === "qword" ? text : `"${text.length > 60 ? `${text.slice(0, 59)}…` : text}"`;
}

/** A command that sets one registry value, making its key if it isn't there. Checked like any command; refused here only when it can't be written safely. */
export function registryCommand(raw: unknown): Command | string {
  const r = (raw ?? {}) as Partial<RegistryShorthand>;
  const key = keyOf(r.key);
  if (typeof key === "string") return key;
  if (typeof r.name !== "string" || r.name.length > 255 || !plain(r.name) || /[*?[\]]/.test(r.name)) return "name must be the value's name in plain letters with no wildcards, or \"\" for the key's default value";
  const value = valueText(r.type, r.value);
  if (typeof value !== "string") return value.error;
  const type = r.type as RegistryType;
  const at = quote(`${key.hive}:\\${key.rest}`), name = quote(r.name || "(default)");
  const run = [
    `if (-not (Test-Path -LiteralPath ${at})) { New-Item -Path ${at} -Force | Out-Null }`,
    `Set-ItemProperty -LiteralPath ${at} -Name ${name} -Type ${PS_TYPES[type]} -Value ${value}`,
  ].join("\n");
  const touch: Touch = { kind: "registry", key: `${key.hive}\\${key.rest}`, value: r.name };
  return {
    does: `Sets ${r.name ? r.name : "the default value"} in ${key.hive}\\${key.rest} to ${shown(type, r.value!)}.`,
    read: `Get-ItemPropertyValue -LiteralPath ${at} -Name ${name}`,
    run,
    touches: [touch],
  };
}

/** A command that changes how a service starts. It doesn't start or stop it. */
export function serviceCommand(raw: unknown): Command | string {
  const s = (raw ?? {}) as Partial<ServiceShorthand>;
  if (typeof s.name !== "string" || !/^[A-Za-z0-9_.$-]{1,256}$/.test(s.name)) return "name must be the service's name (like Spooler), not its display name";
  const start = s.startType;
  if (start !== "automatic" && start !== "automaticDelayed" && start !== "manual" && start !== "disabled") return "startType must be automatic, automaticDelayed, manual or disabled";
  // Windows PowerShell's Set-Service can't make a service wait after startup; sc.exe can.
  const run = start === "automaticDelayed" ? `sc.exe config ${quote(s.name)} start= delayed-auto` : `Set-Service -Name ${quote(s.name)} -StartupType ${PS_STARTS[start]}`;
  return {
    does: `Makes the ${s.name} service ${START_WORDS[start]}. It doesn't start or stop it now.`,
    read: `Get-Service -Name ${quote(s.name)} | Select-Object -Property Name, DisplayName, Status, StartType`,
    run,
    touches: [{ kind: "service", name: s.name }],
  };
}
