// Windows protections Rig may turn off for a while: the rows of
// rules/protections.json, which the helper builds in too. A `protection`
// step names a row and how long; the helper's own code lowers it only after
// Rig's background service has noted that it must come back on, and the
// service raises it when the time is up, also after a restart
// (helper/RigHelper/Protection.cs and Reverts.cs). `protectionKeep` is the
// person's second choice to keep one off. It is never Claude's to propose:
// only the Rig app's own button asks for it.

import table from "./rules/protections.json";
import type { CheckContext, NativeRule, Refusal } from "./change";

export interface ProtectionRow {
  id: string;
  /** Plain words, like "Windows Firewall on public networks". */
  name: string;
  /** What is open while it is off. */
  risk: string;
}

export const PROTECTIONS = table.rows as ProtectionRow[];
/** How long a protection may stay off, in minutes. */
export const REVERT_AFTER = table.revertAfter;
export const DEFAULT_REVERT_AFTER = table.defaultRevertAfter;
const words = table.words;

export const protectionRow = (id: unknown): ProtectionRow | undefined => PROTECTIONS.find((r) => r.id === id);

/** Turns one protection off for `revertAfter` minutes. */
export interface ProtectionOp {
  name: "protection";
  /** A row of rules/protections.json. */
  id: string;
  /** Minutes until Rig turns it back on: one of REVERT_AFTER. */
  revertAfter: number;
}

/** Calls off the revert of a protection that is off for now. Only the Rig app's Keep it off button makes one. */
export interface ProtectionKeepOp {
  name: "protectionKeep";
  id: string;
}

/** When a protection Rig turned off comes back on, as the helper's ledger has it. `kept`: the person chose to keep it off. */
export interface RevertNote { id: string; /** ISO time. */ dueAt: string; kept?: true }

/** "15 minutes", "1 hour", "4 hours". */
export const revertWords = (minutes: number) => (minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "1 hour" : `${minutes / 60} hours`);

const unknown = () => `${words.unknown}: ${PROTECTIONS.map((r) => `${r.id} (${r.name})`).join(", ")}.`;
const neverSays = (id: unknown) => table.never.find((n) => n.id === id)?.says ?? null;

export const protectionRule: NativeRule<ProtectionOp> = {
  canonical: (raw) => {
    const never = neverSays(raw.id);
    // Kept as an op so the check can say it is on the never list.
    if (never) return { name: "protection", id: String(raw.id), revertAfter: DEFAULT_REVERT_AFTER };
    const row = protectionRow(raw.id);
    if (!row) return unknown();
    const after = raw.revertAfter === undefined || raw.revertAfter === null ? DEFAULT_REVERT_AFTER : raw.revertAfter;
    if (typeof after !== "number" || !REVERT_AFTER.includes(after)) return `${words.revertAfter}.`;
    return { name: "protection", id: row.id, revertAfter: after };
  },
  tier: () => 3,
  admin: () => true,
  reasons: () => [`${words.tier}.`],
  never: (op) => neverSays(op.id),
  title: (op) => `Turned off ${protectionRow(op.id)?.name ?? "a protection"} for ${revertWords(op.revertAfter)}`,
  rows: (op, before, after) => [[protectionRow(op.id)?.name ?? op.id, before ?? "On", after ?? `Off for ${revertWords(op.revertAfter)}`]],
};

export const protectionKeepRule: NativeRule<ProtectionKeepOp> = {
  canonical: (raw) => (protectionRow(raw.id) ? { name: "protectionKeep", id: raw.id as string } : unknown()),
  tier: () => 3,
  admin: () => true,
  reasons: () => [`${words.keep}.`],
  refusal: (_op, ctx: CheckContext): { why: Refusal; refused: string } | undefined => (ctx.byPerson ? undefined : { why: "refused", refused: `${words.keepOnlyYou}.` }),
  title: (op) => `Kept ${protectionRow(op.id)?.name ?? "a protection"} off`,
  rows: (op) => [[protectionRow(op.id)?.name ?? op.id, "Off for now", "Off until you turn it back on"]],
};

/** How a revert ended, as the helper's log has it. */
export type RevertEnd = "raised" | "left" | "kept" | "unused";

/** What "protection.reverts" answers: what waits to come back on, and how the last ones ended. `readable` is false from a helper without admin rights. */
export interface RevertsReply {
  readable: boolean;
  waiting: { id: string; row: string; dueAt: string }[];
  ended: { id: string; row: string; how: RevertEnd; why?: string | null; at: string }[];
}

/** A protection that is off because of a change Rig made, for the Changes page. */
export interface OpenRevert {
  changeId: string;
  /** The helper's id for the change, which "Turn it back on now" undoes. */
  undoId: string;
  row: ProtectionRow;
  /** ISO time it comes back on by itself. */
  dueAt: string;
  /** The person chose to keep it off: it stays off until they turn it back on. */
  kept: boolean;
  /** Rig could ask its helper how things stand. False when the helper runs without admin rights. */
  checked: boolean;
}

export function openRevert(changeId: string, undoId: string, rowId: string, note: RevertNote, checked: boolean): OpenRevert[] {
  const row = protectionRow(rowId);
  return row ? [{ changeId, undoId, row, dueAt: note.dueAt, kept: note.kept === true, checked }] : [];
}

/** What the changes log says once a revert ended. */
export function revertResult(how: RevertEnd, why: string | null | undefined, at: string, name: string): string {
  const when = new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  switch (how) {
    case "raised": return why === "you" ? `You turned ${name} back on at ${when}.` : `Rig turned ${name} back on at ${when}${why === "stop" || why === "uninstall" ? ", because its background service was stopping" : why === "start" ? ", as soon as the PC was running again" : ""}.`;
    case "left": return `${name} was already back on at ${when}, so Rig left it alone.`;
    case "kept": return `You chose to keep ${name} off. It stays off until you turn it back on.`;
    case "unused": return `${name} was never turned off.`;
  }
}
