// The policy shorthand: one value under Software\Policies, written as the
// registry shorthand writes any value, so the snapshot is its undo. It is not
// local Group Policy and runs no gpupdate. A PC that a work or school manages
// gets its policies from them, so the script stops there before writing.

import type { Command } from "../change";
import { registryCommand, type RegistryShorthand, type RegistryType } from "../shorthand";
import { quote } from "./text";

export interface PolicyShorthand {
  /** machine: HKLM, everyone on this PC. user: HKCU, this Windows account. */
  scope: "machine" | "user";
  /** The key under Software\Policies, like Microsoft\Windows\GameDVR. */
  key: string;
  name: string;
  type: RegistryType;
  value: RegistryShorthand["value"];
}

const MANAGED = "This PC is managed by a work or school (it is joined to a domain or enrolled in device management), so Rig won't change its policies. Ask whoever manages it.";

/** Stops the run on a PC joined to a domain or enrolled in device management, before anything is written. */
export const managedGuard = [
  `if (Get-CimInstance -ClassName Win32_ComputerSystem -Filter 'PartOfDomain = TRUE') { throw ${quote(MANAGED)} }`,
  `if (Get-ChildItem -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Enrollments' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object -Property EnrollmentState -EQ -Value 1 | Where-Object -Property ProviderID -Match -Value '.') { throw ${quote(MANAGED)} }`,
].join("\n");

/** A command that sets one policy value, unless a work or school manages this PC. */
export function policyCommand(raw: unknown): Command | string {
  const p = (raw ?? {}) as Partial<PolicyShorthand>;
  if (p.scope !== "machine" && p.scope !== "user") return "scope must be machine (everyone on this PC) or user (this Windows account)";
  if (typeof p.key !== "string" || /^(registry::)?(hk|hkey_)/i.test(p.key.trim())) return "key must be the part under Software\\Policies, like Microsoft\\Windows\\GameDVR; scope picks HKLM or HKCU";
  const rest = p.key.trim().replace(/^\\+/, "").replace(/^software\\+policies(\\+|$)/i, "");
  if (!rest) return "key must name a key under Software\\Policies, like Microsoft\\Windows\\GameDVR";
  const hive = p.scope === "machine" ? "HKLM" : "HKCU";
  const reg = registryCommand({ key: `${hive}\\Software\\Policies\\${rest}`, name: p.name, type: p.type, value: p.value });
  if (typeof reg === "string") return reg;
  const who = p.scope === "machine" ? "everyone who uses this PC" : "your Windows account";
  return {
    ...reg,
    does: `${reg.does.replace(/^Sets /, "Sets the policy ")} It applies to ${who}, and some policies only take effect after a restart.`,
    run: `${managedGuard}\n${reg.run}`,
  };
}
