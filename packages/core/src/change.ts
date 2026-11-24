// A change Rig can make is a list of steps. A step is a fix from the catalog
// or a command: a PowerShell change request with a script that reads the
// current state, one that makes the change and, when there is one, one that
// puts it back. Rig works out the tier and whether it needs admin rights; the
// model never sets them. The server, the app and the helper all run the same
// check from the same rules file, and the helper's answer is the one shown.

import { actionInfo, titleFor, validateCall, type ActionCall } from "./actions";
import { checkScript, covers, inspectScript, placeOf, rulesVersion, ruleWords, textLowersProtection, textNeedsAdmin, textOnNeverList, type ScriptUse, type Write } from "./check";
import type { Change } from "./client";
import type { DiffRow } from "./model";

/** 0 read, 1 reversible fix, 2 general or disruptive, 3 no undo or lowers a protection. Never is a refusal, not a tier. */
export type Tier = 0 | 1 | 2 | 3;

export type Step =
  | { kind: "fix"; call: ActionCall }
  | { kind: "command"; cmd: Command };
export type FixStep = Extract<Step, { kind: "fix" }>;
export type CommandStep = Extract<Step, { kind: "command" }>;

export const fixSteps = (calls: ActionCall[]): FixStep[] => calls.map((call) => ({ kind: "fix", call }));

export interface Command {
  /** Claude's one sentence, shown labelled as Claude's. */
  does: string;
  /** PowerShell that prints the current state. Must check as tier 0; runs as the person, not elevated. */
  read: string;
  /** PowerShell that makes the change. */
  run: string;
  /** PowerShell that puts it back, when one exists. Checked like `run`. Null reads as absent. */
  undo?: string | null;
  /** What it expects to change. Drives the snapshot. */
  touches: Touch[];
}

/**
 * Registry keys, files and services are snapshotted. The rest aren't, so they need an undo script or the step is tier 3.
 * A registry key may come as HKCU\, HKCU:\, HKEY_CURRENT_USER\ (or the same for HKLM); Rig stores it as HKCU\ or HKLM\.
 */
export type Touch =
  | { kind: "registry"; key: string; value?: string }
  | { kind: "file"; path: string }
  | { kind: "service"; name: string }
  | { kind: "task" | "firewall" | "other"; name: string };

/** One command Rig found in a script, in plain words for the card, and which of the step's scripts it is in. */
export interface FoundCommand { name: string; says: string; tier: Tier; script: ScriptUse }

/** `never`: on the never list. `refused`: something Rig can't check. `notRead`: a read script that does more than look. `tainted`: tier 3 after the chat read outside text. */
export type Refusal = "never" | "refused" | "notRead" | "tainted";

export interface Refused {
  status: "refused";
  why: Refusal;
  /** Plain words for the person: what was refused and why. */
  refused: string;
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

const refuse = (refused: string, why: Refusal = "refused", commands: FoundCommand[] = []): Refused => ({ status: "refused", why, refused, commands, rulesVersion });
const snapshotted = (t: Touch) => t.kind === "registry" || t.kind === "file" || t.kind === "service";
const wild = (text: string) => /[*?[]/.test(text);

/** A touch as Rig stores it, or null when Rig can't use it. */
function touchOf(t: unknown): Touch | null {
  if (!t || typeof t !== "object") return null;
  const x = t as Record<string, unknown>;
  const text = x.kind === "registry" ? x.key : x.kind === "file" ? x.path : x.name;
  if (typeof text !== "string" || !text.trim() || text.includes("\\\\") || text.startsWith("//") || wild(text)) return null;
  switch (x.kind) {
    case "registry": {
      if (x.value !== undefined && (typeof x.value !== "string" || wild(x.value))) return null;
      const m = /^(?:registry::)?(hkey_current_user|hkcu|hkey_local_machine|hklm)(?::\\|:$|\\|$)(.*)$/i.exec(text);
      if (!m || !m[2].replace(/\\+$/, "")) return null;
      const key = `${/^(hkey_current_user|hkcu)$/i.test(m[1]) ? "HKCU" : "HKLM"}\\${m[2].replace(/\\+$/, "")}`;
      return typeof x.value === "string" ? { kind: "registry", key, value: x.value } : { kind: "registry", key };
    }
    case "file": return /^[a-z]:\\/i.test(text) && !/(^|\\)\.\.(\\|$)/.test(text) && !/[a-z0-9]~\d/i.test(text) ? { kind: "file", path: text } : null;
    case "service": case "task": case "firewall": case "other": return { kind: x.kind, name: text };
    default: return null;
  }
}

/** The command as the helper stores and checks it, or what is wrong with it. `undo: null` reads as absent, and registry keys are written HKCU\ or HKLM\. */
export function canonicalCommand(raw: unknown): Command | string {
  const cmd = raw as Partial<Command> | null;
  const undo = cmd?.undo ?? undefined;
  if (!cmd || typeof cmd !== "object" || typeof cmd.does !== "string" || !cmd.does.trim() || typeof cmd.read !== "string" || typeof cmd.run !== "string" || !Array.isArray(cmd.touches) || (undo !== undefined && typeof undo !== "string")) {
    return "This change request is missing a part: it needs a sentence, a read script, a change script and a list of what it changes.";
  }
  const touches = cmd.touches.map(touchOf);
  if (touches.includes(null)) return `${ruleWords("touch")}.`;
  return { does: cmd.does, read: cmd.read, run: cmd.run, ...(undo === undefined ? {} : { undo }), touches: touches as Touch[] };
}

const touchText = (t: Touch) => (t.kind === "registry" ? `${t.key}\\${t.value ?? ""}` : t.kind === "file" ? t.path : t.name);
/** Where a snapshotted touch is, compared the way writes are. */
const touchPlace = (t: Touch) => (t.kind === "registry" ? placeOf(t.key) : t.kind === "file" ? placeOf(t.path) : t.kind === "service" ? placeOf(t.name) : "");
const touchKind = (t: Touch): Write["kind"] => (t.kind === "service" ? "service" : "path");

/** The verdict on one step. Refusals say in plain words what was refused. */
export function checkStep(step: Step, ctx: CheckContext = { tainted: false }): Verdict {
  if (step.kind === "fix") {
    const bad = validateCall(step.call);
    if (bad) return refuse(`This isn't one of Rig's fixes: ${bad}.`);
    return { status: "allowed", tier: actionInfo(step.call.kind).tier, admin: false, commands: [], reasons: ["One of Rig's own fixes, which stores its own undo."], rulesVersion };
  }
  const cmd = canonicalCommand(step.cmd);
  if (typeof cmd === "string") return refuse(cmd);
  // What it says it touches is held to the never list first, so a script that hides the place can't get past it.
  for (const t of cmd.touches) {
    const never = textOnNeverList(touchText(t), "run");
    if (never) return refuse(`${never}.`, "never");
  }
  const run = inspectScript(cmd.run, "run");
  const parts: [string, Verdict][] = [["The read script", checkScript(cmd.read, "read")], ["The change script", run.verdict]];
  if (typeof cmd.undo === "string") parts.push(["The undo script", checkScript(cmd.undo, "undo")]);
  const commands = parts.flatMap(([, v]) => v.commands);
  const stopped = parts.find(([, v]) => v.status === "refused" && v.why === "never") ?? parts.find(([, v]) => v.status === "refused");
  if (stopped && stopped[1].status === "refused") return refuse(`${stopped[0]} was refused. ${stopped[1].refused}`, stopped[1].why, commands);

  const allowed = parts.map(([, v]) => v as Allowed);
  let tier = Math.max(...allowed.map((v) => v.tier)) as Tier;
  const reasons = allowed.flatMap((v) => v.reasons);
  const lowers = cmd.touches.map((t) => textLowersProtection(touchText(t))).find((x) => x);
  if (lowers) {
    tier = 3;
    reasons.push(`${lowers}.`);
  }
  // A write is covered when a snapshotted touch holds every place it writes; a touch is used when some write reaches it.
  const held = cmd.touches.filter(snapshotted);
  const covered = (w: Write) => w.kind !== "none" && w.places.length > 0 && w.places.every((p) => held.some((t) => touchKind(t) === w.kind && covers(touchPlace(t), p)));
  // The touch's own text is Claude's, so the reason counts the unused ones instead of naming them.
  const unused = held.filter((t) => !run.writes.some((w) => w.kind === touchKind(t) && w.places.some((p) => covers(touchPlace(t), p) || covers(p, touchPlace(t))))).length;
  if (unused) reasons.push(`${ruleWords("unused-touch")} ${unused === 1 ? "one of them" : `${unused} of them`}.`);
  if (typeof cmd.undo !== "string" && (cmd.touches.length === 0 || held.length < cmd.touches.length || !run.writes.every(covered))) {
    tier = 3;
    reasons.push(`${ruleWords("no-undo")}.`);
  }
  if (tier === 3 && ctx.tainted) return refuse(`${ruleWords("tainted")}.`, "tainted", commands);
  const admin = allowed.some((v) => v.admin) || cmd.touches.some((t) => t.kind === "service") || cmd.touches.map(touchText).some(textNeedsAdmin);
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

/** A short past-tense title for the changes log. */
export function stepsTitle(steps: Step[]): string {
  const calls = steps.flatMap((s) => (s.kind === "fix" ? [s.call] : []));
  if (calls.length === steps.length) return titleFor(calls);
  return steps.length === 1 && steps[0].kind === "command" ? steps[0].cmd.does.trim().replace(/\.$/, "") : `${steps.length} changes`;
}

// The change log.

export interface VerifyResult {
  /** What `read` printed before and after. */
  before: string;
  after: string;
}

export interface RestorePoint { seq: number; name: string; /** ISO time. */ at: string }

export interface FixUndo { kind: "fix"; call: ActionCall }
export interface CommandUndo {
  kind: "command";
  /** The helper's id for the snapshot and undo script, kept in its admin-only folder. */
  id: string;
  /** The undo script's text, to show. The helper runs its own stored copy after it restores the snapshot. */
  script?: string;
  restorePoint?: RestorePoint;
  /** Things that changed outside `touches`. They have no snapshot. */
  outside: string[];
  /** Hash of the state right after the change, so undo can tell whether something else changed it since. */
  fingerprint: string;
}
export type UndoRecord = FixUndo | CommandUndo;

export type AppliedStep =
  | { step: FixStep; undo: FixUndo; rows: DiffRow[] }
  | { step: CommandStep; undo: CommandUndo; rows: DiffRow[]; verify?: VerifyResult };

/** How a change's steps were stored before general commands. */
export interface AppliedCall { call: ActionCall; undo: ActionCall; row: DiffRow }

export const appliedStepOf = (a: AppliedCall): AppliedStep => ({ step: { kind: "fix", call: a.call }, undo: { kind: "fix", call: a.undo }, rows: [a.row] });

/** A change as stored, by this version or by one from before steps and tiers. */
export type StoredChange = Omit<Change, "applied" | "tier"> & { applied: (AppliedStep | AppliedCall)[]; tier?: Tier };

/** Reads a stored change. Changes from before tiers were all catalog fixes, which are tier 1. */
export function changeOf(c: StoredChange): Change {
  return { ...c, tier: c.tier ?? 1, applied: (c.applied ?? []).map((a) => ("step" in a ? a : appliedStepOf(a))) };
}

// The helper's side: four calls over the pipe. The helper owns approval:
// preview stores the command and its verdict under a nonce that works once
// and expires, and apply takes only the nonce and checks again.

/** The current value of one touch as the helper read it. Null means it isn't there. */
export interface TouchValue { touch: Touch; value: string | null }
export interface TouchChange { touch: Touch; before: string | null; after: string | null }

/** The fixed places the helper compares before and after every run. A hit is a never-list write. */
export type Sentinel =
  | "services" | "run" | "ifeo" | "winlogon" | "defenderExclusions" | "localUsers" | "administrators"
  | "rdp" | "winrm" | "rootCertificates" | "hosts" | "proxy" | "scheduledTasks" | "bcd";
export interface SentinelHit { sentinel: Sentinel; before: string; after: string }

export interface RunResult {
  /** What `read` printed before and after. */
  before: string;
  after: string;
  touches: TouchChange[];
  /** What `run` printed. Free text from the PC: it counts as outside content. */
  output: string;
  /** What else changed, when the helper could tell. */
  alsoChanged: string[];
}

export type PreviewReply =
  | { outcome: "refused"; verdict: Refused }
  | {
      outcome: "ready";
      nonce: string;
      /** ISO time. */
      expiresAt: string;
      verdict: Allowed;
      /** What `read` printed now. */
      read: string;
      touches: TouchValue[];
    };

export type ApplyReply =
  /** The nonce is unknown, used or too old. Preview again. */
  | { outcome: "expired" }
  /** The check at apply time no longer passes. Nothing ran. */
  | { outcome: "refused"; verdict: Refused }
  /** This PC has had its daily number of tier 2 and 3 changes. Nothing ran. */
  | { outcome: "limit"; /** ISO time when the next one is allowed. */ until: string }
  /** The person said no at Windows' permission prompt. Nothing ran. */
  | { outcome: "declined" }
  | { outcome: "applied"; result: RunResult; undo: CommandUndo }
  /** It ran, then the helper put everything back: a never-list write (`sentinels`) or a failure (`error`). Nothing to undo. */
  | { outcome: "rolledBack"; result: RunResult; sentinels: SentinelHit[]; error?: string };

export type UndoReply =
  | { outcome: "undone"; /** What `read` printed after. */ printed: string; /** What it couldn't put back. */ left: string[] }
  /** Something else changed these places since the change, so undo would overwrite that. Nothing ran; undo again with `force` to put them back anyway. */
  | { outcome: "drifted"; changed: string[] }
  | { outcome: "unknown" }
  | { outcome: "failed"; error: string; /** The last resort, named for the person. */ restorePoint?: RestorePoint };

/** What an approval behind Windows' prompt is of: every part of the command, each with its length in front. The helper works out the same fingerprint from the command it stored and approves only when the two match. */
export async function commandHash(cmd: Command): Promise<string> {
  const parts = ["rig-command-1", cmd.does, cmd.read, cmd.run, cmd.undo === undefined ? "-" : `+${cmd.undo}`];
  for (const t of cmd.touches) {
    parts.push(t.kind, t.kind === "registry" ? t.key : t.kind === "file" ? t.path : t.name, t.kind === "registry" && t.value !== undefined ? `+${t.value}` : "-");
  }
  const bytes = new TextEncoder().encode(parts.map((p) => `${p.length}:${p}`).join("\n"));
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * The helper checks everything again itself except taint: it can't see the chat, so a tainted chat's tier 3 card is
 * refused by the server before it is shown.
 */
export interface CommandRpc {
  "command.check": { params: { cmd: Command }; reply: { verdict: Verdict } };
  "command.preview": { params: { cmd: Command }; reply: PreviewReply };
  "command.apply": { params: { nonce: string }; reply: ApplyReply };
  "command.undo": { params: { id: string; /** Put it back even when something else changed it since. */ force?: boolean }; reply: UndoReply };
  /** A read on its own, for a live look: it must check as tier 0, and runs as the person. */
  "command.read": { params: { script: string }; reply: { verdict: Refused } | { printed: string } };
}

/** The part of the helper link that carries commands. */
export interface CommandLink {
  command<K extends keyof CommandRpc>(method: K, params: CommandRpc[K]["params"]): Promise<CommandRpc[K]["reply"]>;
}
