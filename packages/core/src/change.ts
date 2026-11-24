// A change Rig can make is a list of steps. A step is a fix from the catalog
// or a command: a PowerShell change request with a script that reads the
// current state, one that makes the change and, when there is one, one that
// puts it back. Rig works out the tier and whether it needs admin rights; the
// model never sets them. The server, the app and the helper all run the same
// check from the same rules file, and the helper's answer is the one shown.

import { actionInfo, validateCall, type ActionCall } from "./actions";
import { checkScript, rulesVersion, ruleWords, textNeedsAdmin, textOnNeverList } from "./check";
import type { DiffRow } from "./model";

/** 0 read, 1 reversible fix, 2 general or disruptive, 3 no undo or lowers a protection. Never is a refusal, not a tier. */
export type Tier = 0 | 1 | 2 | 3;

export type Step =
  | { kind: "fix"; call: ActionCall }
  | { kind: "command"; cmd: Command };

export interface Command {
  /** Claude's one sentence, shown labelled as Claude's. */
  does: string;
  /** PowerShell that prints the current state. Must check as tier 0; runs as the person, not elevated. */
  read: string;
  /** PowerShell that makes the change. */
  run: string;
  /** PowerShell that puts it back, when one exists. Checked like `run`. */
  undo?: string;
  /** What it expects to change. Drives the snapshot. */
  touches: Touch[];
}

/** Registry keys, files and services are snapshotted. The rest aren't, so they need an undo script or the step is tier 3. */
export type Touch =
  | { kind: "registry"; key: string; value?: string }
  | { kind: "file"; path: string }
  | { kind: "service"; name: string }
  | { kind: "task" | "firewall" | "other"; name: string };

/** One command Rig found in a script, in plain words for the card. */
export interface FoundCommand { name: string; says: string; tier: Tier }

export interface Refused {
  status: "refused";
  /** Plain words for the person: what was refused and why. */
  refused: string;
  /** On the never list, rather than something Rig couldn't classify. */
  never: boolean;
  commands: FoundCommand[];
  rulesVersion: number;
}

export interface Allowed {
  status: "allowed";
  tier: Tier;
  /** Runs elevated through the helper. */
  admin: boolean;
  commands: FoundCommand[];
  /** Why this tier. */
  reasons: string[];
  rulesVersion: number;
}

export type Verdict = Refused | Allowed;

export interface CheckContext {
  /** The conversation has read free text from outside (web, manuals, recordings, script output). */
  tainted: boolean;
}

const refuse = (refused: string, never = false, commands: FoundCommand[] = []): Refused => ({ status: "refused", refused, never, commands, rulesVersion });
const snapshotted = (t: Touch) => t.kind === "registry" || t.kind === "file" || t.kind === "service";

function touchText(t: unknown): string | null {
  if (!t || typeof t !== "object") return null;
  const x = t as Record<string, unknown>;
  const text = x.kind === "registry" ? x.key : x.kind === "file" ? x.path : x.name;
  if (typeof text !== "string" || !text.trim() || text.includes("\\\\")) return null;
  const low = text.toLowerCase();
  switch (x.kind) {
    case "registry": return low.startsWith("hklm\\") || low.startsWith("hkcu\\") ? `${text}\\${typeof x.value === "string" ? x.value : ""}` : null;
    case "file": return /^[a-z]:\\/.test(low) ? text : null;
    case "service": case "task": case "firewall": case "other": return text;
    default: return null;
  }
}

/** The verdict on one step. Refusals say in plain words what was refused. */
export function checkStep(step: Step, ctx: CheckContext = { tainted: false }): Verdict {
  if (step.kind === "fix") {
    const bad = validateCall(step.call);
    if (bad) return refuse(`This isn't one of Rig's fixes: ${bad}.`);
    return { status: "allowed", tier: actionInfo(step.call.kind).tier, admin: false, commands: [], reasons: ["One of Rig's own fixes, which stores its own undo."], rulesVersion };
  }
  const cmd = step.cmd;
  if (!cmd || typeof cmd.does !== "string" || !cmd.does.trim() || typeof cmd.read !== "string" || typeof cmd.run !== "string" || !Array.isArray(cmd.touches) || (cmd.undo !== undefined && typeof cmd.undo !== "string")) {
    return refuse("This change request is missing a part: it needs a sentence, a read script, a change script and a list of what it changes.");
  }
  const parts: [string, Verdict][] = [["The read script", checkScript(cmd.read, "read")], ["The change script", checkScript(cmd.run, "run")]];
  if (cmd.undo !== undefined) parts.push(["The undo script", checkScript(cmd.undo, "undo")]);
  const commands = parts.flatMap(([, v]) => v.commands);
  const stopped = parts.find(([, v]) => v.status === "refused" && v.never) ?? parts.find(([, v]) => v.status === "refused");
  if (stopped && stopped[1].status === "refused") return refuse(`${stopped[0]} was refused. ${stopped[1].refused}`, stopped[1].never, commands);

  const touches = cmd.touches.map(touchText);
  if (touches.includes(null)) return refuse(`${ruleWords("touch")}.`, false, commands);
  for (const t of touches as string[]) {
    const never = textOnNeverList(t, "run");
    if (never) return refuse(`${never}.`, true, commands);
  }

  const allowed = parts.map(([, v]) => v as Allowed);
  let tier = Math.max(...allowed.map((v) => v.tier)) as Tier;
  const reasons = allowed.flatMap((v) => v.reasons);
  if (cmd.undo === undefined && (cmd.touches.length === 0 || !cmd.touches.every(snapshotted))) {
    tier = 3;
    reasons.push(`${ruleWords("no-undo")}.`);
  }
  if (tier === 3 && ctx.tainted) return refuse(`${ruleWords("tainted")}.`, false, commands);
  const admin = allowed.some((v) => v.admin) || cmd.touches.some((t) => t.kind === "service") || (touches as string[]).some(textNeedsAdmin);
  return { status: "allowed", tier, admin, commands, reasons, rulesVersion };
}

/** A card takes the tier of its riskiest step. One refused step refuses the card. */
export function cardTier(steps: Step[], ctx: CheckContext = { tainted: false }): Tier | "refused" {
  let tier: Tier = 0;
  for (const s of steps) {
    const v = checkStep(s, ctx);
    if (v.status === "refused") return "refused";
    if (v.tier > tier) tier = v.tier;
  }
  return tier;
}

// The change log.

export interface VerifyResult {
  /** What `read` printed before and after. */
  before: string;
  after: string;
}

export type UndoRecord =
  | { kind: "fix"; call: ActionCall }
  | {
      kind: "command";
      /** The helper's id for the snapshot and undo script, kept in its admin-only folder. */
      id: string;
      /** The undo script that will run after the snapshot is restored. */
      script?: string;
      restorePoint?: { seq: number; name: string; at: string };
      /** Things that changed outside `touches`. They have no snapshot. */
      outside: string[];
      /** Hash of the state right after the change, so undo can tell whether something else changed it since. */
      fingerprint: string;
    };

export interface AppliedStep { step: Step; undo: UndoRecord; rows: DiffRow[]; verify?: VerifyResult }

// The helper's side: four calls over the pipe. The helper owns approval:
// preview stores the command and its verdict under a nonce that works once
// and expires, and apply takes only the nonce and checks again.

/** The current value of one touch as the helper read it. Null means it isn't there. */
export interface TouchValue { touch: Touch; value: string | null }

/** A fixed place the helper compares before and after every run (services, Run keys, Defender exclusions, accounts and the rest of the never list). */
export interface SentinelHit { sentinel: string; before: string; after: string }

export type PreviewReply =
  | { ok: false; verdict: Refused }
  | {
      ok: true;
      nonce: string;
      /** ISO time. */
      expiresAt: string;
      verdict: Allowed;
      /** What `read` printed now. */
      read: string;
      touches: TouchValue[];
    };

export type ApplyReply =
  /** The nonce is unknown, used or expired, the second check refused, the daily limit is reached, or the person said no at Windows' prompt. */
  | { ok: false; error: string; verdict?: Refused }
  | {
      ok: true;
      /** What `read` printed before and after. */
      before: string;
      after: string;
      touches: { touch: Touch; before: string | null; after: string | null }[];
      /** Never-list places that changed. Any hit means the helper rolled back. */
      sentinels: SentinelHit[];
      rolledBack: boolean;
      /** What `run` printed. Free text from the PC: it counts as outside content. */
      output: string;
      /** Set when the script failed. */
      error?: string;
      undo: UndoRecord;
    };

export type UndoReply =
  | { ok: false; error: string }
  | { ok: true; restored: Touch[]; ranScript: boolean; /** What undo couldn't put back, with the restore point to use if there is one. */ left: string[] };

export interface CommandRpc {
  "command.check": { params: { cmd: Command; tainted: boolean }; reply: { verdict: Verdict } };
  "command.preview": { params: { cmd: Command; tainted: boolean }; reply: PreviewReply };
  "command.apply": { params: { nonce: string }; reply: ApplyReply };
  "command.undo": { params: { id: string }; reply: UndoReply };
}

/** The part of the helper link that carries commands. */
export interface CommandLink {
  command<K extends keyof CommandRpc>(method: K, params: CommandRpc[K]["params"]): Promise<CommandRpc[K]["reply"]>;
}
