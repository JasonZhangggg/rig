// Protections Rig turns off for a while: the rows of rules/protections.json,
// which the helper embeds too. A `protection` step names a row and how long;
// the helper's own code turns it off behind Windows' prompt, and Rig's
// background service turns it back on when the time is up, even after a
// restart. Keeping one off past that is a second step, `keepOff`, which only
// the Rig app's own button makes: the chat can't propose it.

import type { CheckContext, NativeRule, Refusal } from "./change";
import type { DiffRow } from "./model";
import table from "./rules/protections.json";

export interface Protection { id: string; name: string; says: string }
export const PROTECTIONS: Protection[] = table.rows;
export const REVERT_AFTER: number[] = table.revertAfter;

/** Turns one protection off, and back on by itself after `revertAfter` minutes. */
export interface ProtectionOp {
  name: "protection";
  /** A row of PROTECTIONS. */
  id: string;
  /** Minutes, one of REVERT_AFTER. */
  revertAfter: number;
}

/** Stops Rig turning a protection back on by itself. Only the person's own choice in the Rig app makes one. */
export interface KeepOffOp {
  name: "keepOff";
  id: string;
}

export const protectionOf = (id: unknown): Protection | undefined => PROTECTIONS.find((p) => p.id === id);

/** "15 minutes", "1 hour", "4 hours". */
export const revertWords = (minutes: number) => (minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "1 hour" : `${minutes / 60} hours`);

const unknownRow = "This isn't a protection Rig turns off.";
const nameOf = (id: string) => protectionOf(id)!.name;

/** The state in the helper's one line, "Windows Firewall on public networks: Off, and it stays off". */
const stateOf = (line: string | undefined) => {
  const at = line?.indexOf(": ") ?? -1;
  return line && at > 0 ? line.slice(at + 2) : undefined;
};

const row = (id: string, before: string | undefined, after: string | undefined, to: string): DiffRow => [nameOf(id), stateOf(before) ?? "As it is now", stateOf(after) ?? to];

export const protectionRule: NativeRule<ProtectionOp> = {
  canonical: (raw) => {
    if (!protectionOf(raw.id)) return unknownRow;
    const minutes = raw.revertAfter ?? table.default;
    if (typeof minutes !== "number" || !REVERT_AFTER.includes(minutes)) return `Rig turns a protection off for ${REVERT_AFTER.map(revertWords).join(", ").replace(/, ([^,]*)$/, " or $1")}, nothing else.`;
    return { name: "protection", id: raw.id as string, revertAfter: minutes };
  },
  tier: () => 3,
  admin: true,
  reasons: (op) => [`It turns off a protection. Rig turns it back on by itself after ${revertWords(op.revertAfter)}.`],
  title: (op) => `Turned off ${nameOf(op.id)} for ${revertWords(op.revertAfter)}`,
  rows: (op, before, after) => [row(op.id, before, after, `Off for ${revertWords(op.revertAfter)}`)],
};

export const KEEP_OFF_CHAT = "Only you can choose to keep a protection off, from its change in the Rig app.";

export const keepOffRule: NativeRule<KeepOffOp> = {
  canonical: (raw) => (protectionOf(raw.id) ? { name: "keepOff", id: raw.id as string } : unknownRow),
  tier: () => 3,
  admin: true,
  reasons: () => ["It keeps a protection off. Rig won't turn it back on by itself any more."],
  title: (op) => `Kept ${nameOf(op.id)} off`,
  refusal: (_op, ctx: CheckContext): { why: Refusal; refused: string } | undefined => (ctx.own ? undefined : { why: "refused", refused: KEEP_OFF_CHAT }),
  rows: (op, before, after) => [row(op.id, before, after, "Off, and it stays off")],
};

/** What the helper answers about the rows: each one's state now, and what Rig's background service holds and last did. */
export interface ProtectionState {
  /** False when this helper can't read the service's list, which needs admin rights. `due` and `last` are then missing. */
  ledger: boolean;
  rows: {
    id: string;
    /** Null when it couldn't be read. */
    on: boolean | null;
    /** ISO time the service turns it back on, while it is set to. */
    due?: string;
    /** The last thing that ended a wait for this row. `was` is how the service found it: "off" and turned it back on, "on" already, or "stuck" off. */
    last?: { at: string; why: "due" | "start" | "stop" | "uninstall" | "kept" | "undone"; was?: "off" | "on" | "stuck" };
  }[];
}

/** How a protection came back on, for the changes log. */
export function backOnWords(last: ProtectionState["rows"][number]["last"] | undefined, since: string): string {
  if (!last || last.at < since || last.was === "stuck" || last.why === "kept") return "It's back on.";
  if (last.why === "undone") return "You turned it back on in Rig.";
  if (last.was === "on") return "It was already back on when its time was up, so Rig left it alone.";
  if (last.why === "start") return "Its time ran out while the PC was off, so Rig turned it back on when the PC started.";
  return last.why === "due" ? "Rig turned it back on when its time was up." : "Rig's background recorder was stopped, so it turned this back on first.";
}
