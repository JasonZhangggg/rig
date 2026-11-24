import type { Command, CommandUndo, FoundCommand, RestorePoint, Sentinel, Tier, Touch, UndoReply } from "@rig/core";

/** The word the person types on a red card before Apply works. */
export const CONFIRM_WORD = "confirm";

const kinds: Record<Touch["kind"], [one: string, many: string]> = {
  registry: ["a registry value", "registry values"], file: ["a file", "files"], service: ["a service", "services"],
  task: ["a scheduled task", "scheduled tasks"], firewall: ["a firewall rule", "firewall rules"], other: ["something else on this PC", "other things on this PC"],
};

export const touchKind = (t: Touch) => ({ registry: "Registry", file: "File", service: "Service", task: "Scheduled task", firewall: "Firewall rule", other: "Other" })[t.kind];
export const touchName = (t: Touch) => (t.kind === "registry" ? `${t.key}${t.value ? `\\${t.value}` : ""}` : t.kind === "file" ? t.path : t.name);
export const snapshotted = (t: Touch) => t.kind === "registry" || t.kind === "file" || t.kind === "service";

const list = (parts: string[]) => (parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** A heading in Rig's own words, from what the command touches: "Change a registry value". */
export function touchSummary(touches: Touch[]): string {
  const counts = new Map<Touch["kind"], number>();
  for (const t of touches) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
  if (!counts.size) return "Run a command";
  return `Change ${list([...counts].map(([k, n]) => (n === 1 ? kinds[k][0] : `${n} ${kinds[k][1]}`)))}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The card's heading, from the riskiest command the checker found in the change script: "Adds a firewall rule". */
export function headline(cmd: Command, commands: FoundCommand[]): string {
  const run = cmd.run.toLowerCase();
  const mine = commands.filter((c) => c.tier > 0 && run.includes(c.name.toLowerCase()));
  const top = mine.find((c) => c.tier === Math.max(...mine.map((x) => x.tier)));
  if (!top) return touchSummary(cmd.touches);
  const more = new Set(mine.map((c) => c.says)).size - 1;
  return `${cap(commandSays(top))}${more > 0 ? `, and ${more} more ${more === 1 ? "command" : "commands"}` : ""}`;
}

/** The checker's words for a command, without the name it repeats in front. */
export function commandSays(c: FoundCommand): string {
  const rest = c.says.startsWith(`${c.name}:`) ? c.says.slice(c.name.length + 1).trim() : c.says;
  return rest || (c.tier === 0 ? "only reads" : "changes something");
}
export const commandTag = (tier: Tier) => (tier === 0 ? "Reads" : tier === 3 ? "Can't promise an undo" : "Changes");

/** Each command once, the ones that change things first. */
export function uniqueCommands(commands: FoundCommand[]): FoundCommand[] {
  const seen = new Set<string>();
  return commands.filter((c) => { const k = `${c.name}|${c.says}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => Number(a.tier === 0) - Number(b.tier === 0));
}

export const value = (v: string | null) => (v === null || v === "" ? "Not there" : v);
export const lines = (text: string) => { const n = text.trim().split("\n").length; return n === 1 ? "1 line" : `${n} lines`; };

/** Whether Rig can put this back, and how, before it runs. `none` means there is no undo at all. */
export function undoPlan(cmd: Command): { kind: "saved" | "script" | "none"; line: string } {
  const saved = cmd.touches.filter(snapshotted);
  const rest = cmd.touches.filter((t) => !snapshotted(t));
  if (saved.length && !rest.length) {
    return { kind: "saved", line: `Can be undone. Rig saves ${saved.length === 1 ? "the current value" : `the ${saved.length} current values`} first${cmd.undo ? ", then runs the undo script" : ""}.` };
  }
  if (cmd.undo) {
    return { kind: "script", line: saved.length ? "Can be undone. Rig saves what it can first, and the undo script puts back the rest." : "Can be undone with the undo script below. Rig can't save a copy of this first, so undo relies on that script." };
  }
  const what = rest.length ? list(rest.map((t) => t.name)) : "what this changes";
  return { kind: "none", line: `No undo. Rig can't save a copy of ${what}, and there's no script to put it back.` };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const restoreLine = (r: RestorePoint) => `As a last resort, Windows has a restore point from ${when(r.at)} called "${r.name}".`;

/** What Undo can and can't put back, after the change ran. */
export function undoReach(cmd: Command, undo: CommandUndo): string {
  const saved = cmd.touches.filter(snapshotted).length;
  const can = saved
    ? `Undo puts back ${saved === 1 ? "the value" : `the ${saved} values`} Rig saved${undo.script ? ", then runs the undo script" : ""}.`
    : undo.script ? "Undo runs the undo script." : "Rig has nothing saved to undo this with.";
  const n = undo.outside.length;
  const cant = n ? ` It can't put back the ${n === 1 ? "other thing" : `${n} other things`} that changed.` : "";
  return `${can}${cant}${undo.restorePoint && (n || !saved) ? ` ${restoreLine(undo.restorePoint)}` : ""}`;
}

const sentinels: Record<Sentinel, string> = {
  services: "the list of Windows services or how they start", run: "the apps that start with Windows", ifeo: "which program Windows opens in place of another",
  winlogon: "what runs when you sign in", defenderExclusions: "the places Defender skips", localUsers: "the accounts on this PC", administrators: "who is an administrator on this PC",
  rdp: "Remote Desktop", winrm: "remote management", rootCertificates: "the certificates Windows trusts", hosts: "the hosts file", proxy: "the proxy settings",
  scheduledTasks: "the scheduled tasks", bcd: "how Windows starts up",
};
export const sentinelWords = (s: Sentinel) => sentinels[s];

/** What one undo came to, in a sentence. */
export function undoneLine(u: UndoReply): string {
  if (u.outcome === "undone") return u.left.length ? "Put back, except for what's listed below." : "Put back the way it was.";
  if (u.outcome === "unknown") return "Rig no longer has the saved copy for this change, so it can't undo it from here.";
  return `Undo didn't finish: ${u.error.replace(/\.$/, "")}.${u.restorePoint ? ` ${restoreLine(u.restorePoint)}` : ""}`;
}
