import { secondLook, type Allowed, type Command, type CommandUndo, type FoundCommand, type RestorePoint, type Sentinel, type Touch, type UndoReply } from "@rig/core";

const kinds: Record<Touch["kind"], [one: string, many: string]> = {
  registry: ["a registry value", "registry values"], file: ["a file", "files"], service: ["a service", "services"],
  task: ["a scheduled task", "scheduled tasks"], firewall: ["a firewall rule", "firewall rules"], other: ["something else on this PC", "other things on this PC"],
};

const last = (path: string) => path.split("\\").filter(Boolean).pop() ?? path;

export const touchKind = (t: Touch) => ({ registry: "Registry", file: "File", service: "Service", task: "Scheduled task", firewall: "Firewall rule", other: "Other" })[t.kind];
export const touchName = (t: Touch) => (t.kind === "registry" ? `${t.key}${t.value ? `\\${t.value}` : ""}` : t.kind === "file" ? t.path : t.name);
/** A touch's own name, without the path in front. */
export const touchShort = (t: Touch) => (t.kind === "registry" ? t.value || last(t.key) : t.kind === "file" ? last(t.path) : t.name);
/** Where a touch lives, when its own name doesn't say: the key of a registry value, the folder of a file. */
export const touchWhere = (t: Touch) => (t.kind === "registry" ? (t.value ? t.key : t.key !== touchShort(t) ? t.key : undefined) : t.kind === "file" && t.path !== touchShort(t) ? t.path : undefined);
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

/** The commands that change something and that the change script names. The checker lists the read, change and undo scripts' commands together. */
export function runCommands(cmd: Command, commands: FoundCommand[]): FoundCommand[] {
  const run = cmd.run.toLowerCase();
  const seen = new Set<string>();
  return commands.filter((c) => {
    const k = `${c.name}|${c.says}`;
    if (c.tier === 0 || seen.has(k) || !run.includes(c.name.toLowerCase())) return false;
    seen.add(k);
    return true;
  });
}

/** The card's heading, from the riskiest command the checker found in the change script: "Adds a firewall rule". */
export function headline(cmd: Command, commands: FoundCommand[]): string {
  const mine = runCommands(cmd, commands);
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

export const value = (v: string | null) => (v === null || v === "" ? "Not there" : v);
export const lines = (text: string) => { const n = text.trim().split("\n").length; return n === 1 ? "1 line" : `${n} lines`; };

/** Whether Rig can put this back, and how, before it runs, from what each touch is. `none` means there is no undo at all. */
export function undoPlan(cmd: Command): { kind: "saved" | "script" | "none"; line: string } {
  const saved = cmd.touches.filter(snapshotted);
  const rest = cmd.touches.filter((t) => !snapshotted(t));
  if (saved.length && !rest.length) {
    return { kind: "saved", line: `Yes. Rig saves ${saved.length === 1 ? "the current value" : `the ${saved.length} current values`} first${cmd.undo ? " and keeps an undo script" : ""}.` };
  }
  if (cmd.undo) {
    return { kind: "script", line: saved.length ? "Yes. Rig saves what it can first, and the undo script puts back the rest." : "Yes, with its undo script. Rig can't save a copy first." };
  }
  const what = rest.length ? list(rest.map((t) => t.name)) : "what this changes";
  return { kind: "none", line: `No. Rig can't save a copy of ${what}, and there's no undo script.` };
}

export type RedKind = "none" | "unsure" | "lowers";

/** Why a tier 3 card is red: nothing can be put back, not all of it can, or it lowers a protection. */
export function redKind(cmd: Command, v: Allowed): RedKind {
  if (undoPlan(cmd).kind === "none") return "none";
  return v.commands.some((c) => c.tier === 3) ? "unsure" : "lowers";
}

const red: Record<RedKind, { head: string; chip: string; back: string; word: string }> = {
  none: { head: "This can't be undone.", chip: "Can't be undone", back: "No.", word: "permanent" },
  unsure: { head: "Rig can't promise to undo this.", chip: "Can't promise an undo", back: "Not for sure.", word: "permanent" },
  lowers: { head: "This lowers a protection on this PC.", chip: "Lowers a protection", back: "Yes. Until you undo it, the PC is less protected.", word: "lower" },
};
export const redWords = (k: RedKind) => red[k];

/** The checker's reasons a red card is red, without the plain second-look one. */
export const redReasons = (v: Allowed) => [...new Set(v.reasons)].filter((r) => r !== secondLook);

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const restoreLine = (r: RestorePoint) => `As a last resort, Windows has a restore point from ${when(r.at)} called "${r.name}".`;

/** What Undo can and can't put back, after the change ran. `can` is false when there's nothing to undo it with. */
export function undoReach(cmd: Command, undo: CommandUndo): { can: boolean; line: string } {
  const saved = cmd.touches.filter(snapshotted).length;
  const rest = cmd.touches.filter((t) => !snapshotted(t));
  const restore = undo.restorePoint ? ` ${restoreLine(undo.restorePoint)}` : "";
  if (!saved && !undo.script) return { can: false, line: `Rig can't undo this: it had no copy to save and no undo script.${restore}` };
  const can = saved ? `Undo puts back ${saved === 1 ? "the value" : `the ${saved} values`} Rig saved${undo.script ? ", then runs the undo script" : ""}.` : "Undo runs the undo script.";
  const cant = [...(undo.script ? [] : rest.map((t) => t.name)), ...(undo.outside.length ? ["what's under Also changed"] : [])];
  return { can: true, line: `${can}${cant.length ? ` It can't put back ${list(cant)}.${restore}` : ""}` };
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
