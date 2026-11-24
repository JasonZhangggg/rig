// The firewall shorthand: add one rule, or turn an existing rule on or off.
// A new rule is named Rig-<id> so its undo can delete exactly that rule. The
// limits here (a program or a port for anything that lets connections in,
// never the remote-access ports, the kind of network first, no program in the
// Windows folder) are also rules in commands.json, so a hand-written command
// meets the same ones.

import type { Command } from "../change";
import { filePath, plain, quote } from "./text";

export type FirewallProfile = "private" | "domain" | "public";
export interface FirewallRuleShorthand {
  /** A short label, shown in Windows' firewall list with "(Rig)" after it. */
  name: string;
  direction: "inbound" | "outbound";
  action: "allow" | "block";
  protocol?: "tcp" | "udp";
  ports?: number[];
  /** A program's full path, ending .exe. */
  program?: string;
  /** Which kind of network the rule is for. Private when left out. */
  profile?: FirewallProfile;
}
/** Add a rule, or turn an existing rule (by its Name, not its display name) on or off. */
export type FirewallShorthand = { add: FirewallRuleShorthand } | { rule: string; enabled: boolean };

/** Ports Windows uses for remote access and file sharing. A rule that lets them in is on the never list. */
export const NEVER_PORTS = [22, 135, 139, 445, 3389, 5985, 5986];
const CASE: Record<string, string> = { inbound: "Inbound", outbound: "Outbound", allow: "Allow", block: "Block", tcp: "TCP", udp: "UDP", private: "Private", domain: "Domain", public: "Public" };
const NETWORKS: Record<FirewallProfile, string> = { private: "private networks (like your home's)", domain: "your work's network", public: "public networks (like a café's Wi-Fi)" };

/** Rig's name for a rule it adds: the same request gives the same name, so asking twice finds the first one. */
function ruleId(parts: unknown[]): string {
  let h = 0x811c9dc5;
  for (const c of JSON.stringify(parts)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `Rig-${h.toString(16).padStart(8, "0")}`;
}

const enumOf = <T extends string>(v: unknown, ok: readonly T[]): v is T => typeof v === "string" && (ok as readonly string[]).includes(v);

function addCommand(r: Partial<FirewallRuleShorthand>): Command | string {
  if (typeof r.name !== "string" || !/^[A-Za-z1-9][A-Za-z0-9 .()_']{0,59}$/.test(r.name) || /^(any|public)$/i.test(r.name.trim())) {
    return "name must be a short label in plain letters and digits, up to 60, like Minecraft server";
  }
  if (!enumOf(r.direction, ["inbound", "outbound"] as const)) return "direction must be inbound or outbound";
  if (!enumOf(r.action, ["allow", "block"] as const)) return "action must be allow or block";
  const profile = r.profile ?? "private";
  if (!enumOf(profile, ["private", "domain", "public"] as const)) return "profile must be private, domain or public";
  const ports = r.ports;
  if (ports !== undefined && (!Array.isArray(ports) || !ports.length || ports.length > 16 || !ports.every((p) => Number.isInteger(p) && p >= 1 && p <= 65535) || new Set(ports).size !== ports.length)) {
    return "ports must be a list of up to 16 different port numbers from 1 to 65535; Rig doesn't take ranges";
  }
  if (r.protocol !== undefined && !enumOf(r.protocol, ["tcp", "udp"] as const)) return "protocol must be tcp or udp";
  if (ports && !r.protocol) return "a rule with ports needs a protocol, tcp or udp";
  const program = r.program === undefined ? undefined : filePath(r.program, [".exe"]);
  if (program === null) return "program must be the program's full path, like C:\\Games\\Server\\server.exe, in plain letters with no wildcards";
  const letsIn = r.direction === "inbound" && r.action === "allow";
  if (letsIn && !ports && !program) return "a rule that lets connections in needs a program or ports, so it doesn't open the whole PC";
  if (letsIn && ports?.some((p) => NEVER_PORTS.includes(p))) return `Rig never opens the ports Windows uses for remote access or file sharing (${NEVER_PORTS.join(", ")})`;
  if (letsIn && program && /\\windows\\|\\svchost\.exe$/i.test(program)) return "Rig won't let connections in to a program in the Windows folder: Windows' own services, like Remote Desktop and file sharing, run from there. Name the program's ports instead";
  if (letsIn && program && /\d-/.test(program)) return "Rig can't check a program path with a dash right after a number; move the program or name its ports instead";

  const name = ruleId([r.name, r.direction, r.action, profile, r.protocol ?? null, ports ?? null, program ?? null]), at = quote(name);
  const display = `${r.name.trim()} (Rig)`;
  const args = [`-Profile ${CASE[profile]}`, `-Direction ${CASE[r.direction]}`, `-Action ${CASE[r.action]}`, `-Name ${at}`, `-DisplayName ${quote(display)}`];
  if (r.protocol) args.push(`-Protocol ${CASE[r.protocol]}`);
  if (ports) args.push(`${r.direction === "inbound" ? "-LocalPort" : "-RemotePort"} ${ports.join(", ")}`);
  if (program) args.push(`-Program ${quote(program)}`);

  const portText = ports ? `${CASE[r.protocol!]} port${ports.length > 1 ? "s" : ""} ${ports.join(", ")}` : "";
  const verb = r.action === "allow" ? ["lets", "connect"] : ["stops", "connecting"];
  const reach = r.direction === "inbound"
    ? `${verb[0]} other computers on ${NETWORKS[profile]} ${verb[1]} to ${[portText, program].filter(Boolean).join(" for ") || "this PC"}`
    : `${verb[0]} ${program ?? "this PC"} ${verb[1]} out${portText ? ` to ${portText}` : ""} on ${NETWORKS[profile]}`;
  const strongest = letsIn && profile === "public" ? " Anyone on the same public network could reach it, so this always gets Rig's strongest check." : "";
  return {
    does: `Adds a firewall rule, ${display}, that ${reach}. Undo deletes the rule.${strongest}`,
    read: [
      `$r = Get-NetFirewallRule -Name ${at} -ErrorAction SilentlyContinue`,
      "if ($r) { $r | Format-List -Property DisplayName, Enabled, Direction, Action, Profile; $r | Get-NetFirewallPortFilter | Format-List -Property Protocol, LocalPort, RemotePort; $r | Get-NetFirewallApplicationFilter | Format-List -Property Program }",
      "else { 'Rig has not added this rule.' }",
    ].join("\n"),
    run: [
      `if (Get-NetFirewallRule -Name ${at} -ErrorAction SilentlyContinue) { throw ${quote("Rig already added this rule, so there is nothing to change.")} }`,
      `New-NetFirewallRule ${args.join(" ")} | Out-Null`,
    ].join("\n"),
    undo: `Remove-NetFirewallRule -Name ${at}`,
    touches: [{ kind: "firewall", name }],
  };
}

function turnCommand(rule: unknown, enabled: unknown): Command | string {
  if (typeof rule !== "string" || !rule.trim() || rule.length > 256 || !plain(rule) || /[*?[\]`]/.test(rule) || rule !== rule.trim()) {
    return "rule must be the firewall rule's Name (from Get-NetFirewallRule), not its display name, in plain letters with no wildcards";
  }
  if (typeof enabled !== "boolean") return "enabled must be true or false";
  const at = quote(rule), on = enabled ? "on" : "off";
  return {
    does: `Turns ${on} the firewall rule ${rule}. Undo turns it ${enabled ? "off" : "on"} again.`,
    read: `Get-NetFirewallRule -Name ${at} | Format-List -Property Name, DisplayName, Enabled, Direction, Action, Profile`,
    run: [
      `if (Get-NetFirewallRule -Name ${at} -ErrorAction Stop | Where-Object -Property Enabled -EQ -Value ${quote(enabled ? "True" : "False")}) { throw ${quote(`This firewall rule is already ${on}.`)} }`,
      `${enabled ? "Enable" : "Disable"}-NetFirewallRule -Name ${at}`,
    ].join("\n"),
    undo: `${enabled ? "Disable" : "Enable"}-NetFirewallRule -Name ${at}`,
    touches: [{ kind: "firewall", name: rule }],
  };
}

/** A command that adds one firewall rule, or turns one on or off. It never turns the firewall itself off. */
export function firewallCommand(raw: unknown): Command | string {
  const f = (raw ?? {}) as Record<string, unknown>;
  const add = f.add !== undefined, turn = f.rule !== undefined || f.enabled !== undefined;
  if (add === turn) return "give either add (a new rule) or rule and enabled (turn an existing rule on or off)";
  return add ? addCommand((f.add ?? {}) as Partial<FirewallRuleShorthand>) : turnCommand(f.rule, f.enabled);
}
