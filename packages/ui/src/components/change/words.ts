import { checkScript, secondLook, writtenTouches, type Allowed, type Command, type HelperUndo, type FoundCommand, type RestorePoint, type Sentinel, type Touch, type UndoReply } from "@rig/core";
import { dateText } from "../../dateText";

const kinds: Record<Touch["kind"], [one: string, many: string]> = {
  registry: ["a registry value", "registry values"], file: ["a file", "files"], service: ["a service", "services"],
  task: ["a scheduled task", "scheduled tasks"], firewall: ["a firewall rule", "firewall rules"], device: ["a device", "devices"], other: ["something else on this PC", "other things on this PC"],
};

const last = (path: string) => path.split("\\").filter(Boolean).pop() ?? path;

export const touchKind = (t: Touch) => ({ registry: "Registry", file: "File", service: "Service", task: "Scheduled task", firewall: "Firewall rule", device: "Device", other: "Other" })[t.kind];
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

/** Model text shortened for the glance: whitespace folded, cut with an ellipsis. The full text goes in a title. */
export function clip(text: string, max = 48): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const INVISIBLE = /[\s\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
/** Claude's sentence, or null when it says nothing a person can see. */
export function saidText(does: unknown, max = 240): string | null {
  if (typeof does !== "string" || !does.replace(INVISIBLE, "")) return null;
  return clip(does, max);
}

const names = (script: string | null | undefined) => new Set(script ? checkScript(script, "run").commands.map((c) => c.name.toLowerCase()) : []);

/** The commands that change something and that the change script runs, matched by name against Rig's own parse of each script. A command Rig can't place in the read or undo script stays listed. */
export function runCommands(cmd: Command, commands: FoundCommand[]): FoundCommand[] {
  const run = names(cmd.run), other = new Set([...names(cmd.read), ...names(cmd.undo)]);
  const seen = new Set<string>();
  return commands.filter((c) => {
    const n = c.name.toLowerCase(), k = `${n}|${c.says}`;
    if (c.tier === 0 || seen.has(k) || (!run.has(n) && other.has(n))) return false;
    seen.add(k);
    return true;
  });
}

/** The commands the undo script runs that change something, in Rig's words. */
const undoCommands = (cmd: Command) => (cmd.undo ? checkScript(cmd.undo, "undo").commands.filter((c) => c.tier > 0) : []);

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

/** What a command writes to, by its name: which kinds of touch it can be tied to, and what it changes in plain words. */
const families: { name: RegExp; kinds: Touch["kind"][]; what: (admin: boolean) => string }[] = [
  { name: /^((set|new|remove|clear|rename|copy|move)-itemproperty|reg)$/, kinds: ["registry"], what: (a) => (a ? "a system setting" : "a setting for your account") },
  { name: /^((new|set|remove|clear|rename|copy|move)-item|(set|add|clear)-content|out-file)$/, kinds: ["registry", "file"], what: (a) => (a ? "system files or settings" : "your files or settings") },
  { name: /^([a-z]+-service|sc)$/, kinds: ["service"], what: () => "a Windows service" },
  { name: /^([a-z]+-scheduledtask|schtasks)$/, kinds: ["task"], what: () => "a scheduled task" },
  { name: /^[a-z]+-netfirewallrule$/, kinds: ["firewall"], what: () => "the firewall" },
];
const familyOf = (c: FoundCommand) => families.find((f) => f.name.test(c.name.toLowerCase()));

/** Tier 2's risk in a few words, from the commands Rig found: "Medium: it changes the firewall." */
export function riskLine(runs: FoundCommand[], admin: boolean): string {
  const what = [...new Set(runs.map((c) => { const f = familyOf(c); return f ? `changes ${f.what(admin)}` : commandSays(c); }))];
  return `Medium${what.length ? `: it ${list(what)}` : ""}.${admin ? " Needs admin, so Windows asks first." : ""}`;
}

/** Commands in the change script that Rig can't tie to anything on the list, so nothing it saves covers them. */
export function untied(cmd: Command, runs: FoundCommand[]): string[] {
  const kinds = new Set<Touch["kind"]>(cmd.touches.filter(snapshotted).map((t) => t.kind));
  return [...new Set(runs.filter((c) => !familyOf(c)?.kinds.some((k) => kinds.has(k))).map((c) => c.name))];
}

export interface UndoPlan {
  kind: "saved" | "script" | "none";
  line: string;
  /** Commands that may change things off the list. Only set when Rig saves something, since that's the promise they fall outside. */
  untied: string[];
}

/** Whether Rig can put this back, and how, before it runs. It promises only what's listed, since the list is Claude's. */
export function undoPlan(cmd: Command, runs: FoundCommand[]): UndoPlan {
  // A listed place the change script doesn't write to has nothing for Rig's copy to put back.
  const saved = writtenTouches(cmd);
  const rest = cmd.touches.filter((t) => !snapshotted(t));
  const off = saved.length ? untied(cmd, runs) : [];
  const values = saved.length === 1 ? "the listed value" : "the listed values";
  if (saved.length && !rest.length) return { kind: "saved", untied: off, line: `Rig saves ${values} first${cmd.undo ? " and keeps an undo script" : ""}.` };
  if (cmd.undo) {
    if (saved.length) return { kind: "script", untied: off, line: `Rig saves ${values} first, and runs the undo script for the rest.` };
    const says = [...new Set(undoCommands(cmd).map(commandSays))];
    return { kind: "script", untied: [], line: `Rig will run the undo script${says.length ? `, which ${list(says)}` : ""}. It can't save a copy first.` };
  }
  return { kind: "none", untied: [], line: "No. Rig can't save a copy, and there's no undo script." };
}

export type RedKind = "none" | "unsure" | "lowers";

/** Why a tier 3 card is red: nothing can be put back, not all of it can, or it lowers a protection. */
export function redKind(cmd: Command, v: Allowed): RedKind {
  if (undoPlan(cmd, []).kind === "none") return "none";
  return v.commands.some((c) => c.tier === 3) ? "unsure" : "lowers";
}

const red: Record<RedKind, { head: string; chip: string; word: string }> = {
  none: { head: "This can't be undone.", chip: "Can't be undone", word: "permanent" },
  unsure: { head: "Rig can't promise to undo this.", chip: "Can't promise an undo", word: "permanent" },
  lowers: { head: "This lowers a protection on this PC.", chip: "Lowers a protection", word: "lower" },
};
export const redWords = (k: RedKind) => red[k];
/** The red card's answer to "Can it be undone". */
export function redBack(k: RedKind, plan: UndoPlan): string {
  return k === "none" ? "No." : k === "unsure" ? "Not for sure." : `${plan.line} Until you undo it, the PC is less protected.`;
}

/** The checker's reasons a red card is red, without the plain second-look one. */
export const redReasons = (v: Allowed) => [...new Set(v.reasons)].filter((r) => r !== secondLook);

const when = (iso: string) => dateText(new Date(iso), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const restoreLine = (r: RestorePoint) => `As a last resort, Windows has a restore point from ${when(r.at)} called "${r.name}".`;

/** What Undo can and can't put back, after the change ran. `can` is false when there's nothing to undo it with. */
export function undoReach(cmd: Command, undo: HelperUndo, runs: FoundCommand[]): { can: boolean; line: string; untied: string[] } {
  const script = undo.kind === "command" ? undo.script : undefined;
  // Only what the change script writes can be put back from Rig's copy, like a driver's install, which writes none of
  // the files Rig keeps a copy of.
  const saved = writtenTouches(cmd).length;
  const rest = cmd.touches.filter((t) => !snapshotted(t)).length;
  const restore = undo.restorePoint ? ` ${restoreLine(undo.restorePoint)}` : "";
  if (!saved && !script) return { can: false, untied: [], line: `Rig can't undo this: it has no copy of what this changed, and no undo script.${restore}` };
  const can = saved ? `Undo puts back ${saved === 1 ? "the listed value" : "the listed values"} Rig saved${script ? ", then runs the undo script" : ""}.` : "Undo runs the undo script.";
  const cant = [...(rest && !script ? ["the listed things Rig had no copy of"] : []), ...(undo.outside.length ? ["what's under Also changed"] : [])];
  const off = saved ? untied(cmd, runs) : [];
  return { can: true, untied: off, line: `${can}${cant.length ? ` It can't put back ${list(cant)}.` : ""}${cant.length || off.length ? restore : ""}` };
}

/**
 * What Undo can put back after a native op ran. Its way back was approved with it, so there is always one. `own` is an
 * op's own undo words when it brings them, like firmware's; `back` is the op's words when undo isn't exact, like a screen
 * step's, which walks the same path again.
 */
export function nativeReach(undo: HelperUndo, own?: { undo: string; noUndo: boolean }, back?: string): { can: boolean; line: string; untied: string[] } {
  if (own) return { can: !own.noUndo, untied: [], line: own.undo.replace(/^(Yes|No)\. /, "") };
  const restore = undo.restorePoint ? ` ${restoreLine(undo.restorePoint)}` : "";
  return { can: true, untied: [], line: `${back ?? "Undo puts it back the way Rig read it before."}${undo.outside.length ? ` It can't put back what's under Also changed.${restore}` : ""}` };
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
  if (u.outcome === "drifted") return `Undo didn't run, so nothing was put back. Something else changed ${u.changed.length === 1 ? "this place" : "these places"} since, and undo would overwrite that.`;
  return `Undo didn't finish: ${u.error.replace(/\.$/, "")}.${u.restorePoint ? ` ${restoreLine(u.restorePoint)}` : ""}`;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
/** When the next bigger change is allowed, in the person's own time: "3:00 PM", or with the day when it isn't today. */
export function nextAllowed(until: string, now = new Date()): string {
  const t = new Date(until);
  return sameDay(t, now) ? dateText(t, { hour: "numeric", minute: "2-digit" }) : dateText(t, { weekday: "long", hour: "numeric", minute: "2-digit" });
}

/** The daily limit on bigger changes was reached, so nothing ran. */
export const limitLine = (until: string, pcName: string) =>
  `Nothing changed on ${pcName}. Rig makes only a few bigger changes a day on each PC, and ${pcName} has had today's. The next one can be made after ${nextAllowed(until)}.`;

/** Windows asked for permission and didn't get it, so nothing ran. */
export const declinedLine = (pcName: string) =>
  `Nothing changed on ${pcName}. Windows asked for permission first, and didn't get it, so Rig didn't run this. To go ahead, choose Apply again, then Yes when Windows asks.`;
