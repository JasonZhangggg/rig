// A change Rig can make is a list of steps. A step is a fix from the catalog,
// a command, or a native op. A command is a PowerShell change request with a
// script that reads the current state, one that makes the change and, when
// there is one, one that puts it back. A native op is a change PowerShell
// can't make, which the helper's own code makes as the person. Rig works out
// the tier and whether it needs admin rights; the model never sets them. The
// server, the app and the helper all run the same check, and the helper's
// answer is the one shown. Commands and native ops go through the same
// approval in the helper: preview, a nonce, apply, undo.

import { actionInfo, titleFor, validateCall, type ActionCall } from "./actions";
import { checkScript, covers, inspectScript, placeOf, rulesVersion, ruleWords, screenMaxText, textLowersProtection, textNeedsAdmin, textOnNeverList, type ScriptUse, type Write } from "./check";
import type { Change } from "./client";
import type { DiffRow } from "./model";

/** 0 read, 1 reversible fix, 2 general or disruptive, 3 no undo or lowers a protection. Never is a refusal, not a tier. */
export type Tier = 0 | 1 | 2 | 3;

export type Step =
  | { kind: "fix"; call: ActionCall }
  | { kind: "command"; cmd: Command }
  | { kind: "native"; op: NativeOp };
export type FixStep = Extract<Step, { kind: "fix" }>;
export type CommandStep = Extract<Step, { kind: "command" }>;
export type NativeStep = Extract<Step, { kind: "native" }>;
/** The steps the helper previews, approves and undoes by nonce. Fixes go through the catalog's own call. */
export type HelperStep = CommandStep | NativeStep;

/**
 * A change the helper's own code makes, as the person and never elevated. A new op is one member here, one entry in
 * `nativeOps`, and one class in the helper (NativeSteps.cs).
 */
export type NativeOp = SelftestOp | ScreenOp;

/**
 * Sets one control in an app's window, for a setting that only exists behind the app's buttons. The model sends only
 * these three things: which look, the new value and its sentence. The walk to the control, the app and the value it has
 * now are what the helper kept from the look, so nothing the model sends can point Rig at another control.
 */
export interface ScreenOp {
  name: "screen";
  /** The id `screen.look` gave. */
  lookId: string;
  /** The new value: one of the look's options, or a number in its range. */
  to: string;
  /** Claude's one sentence, shown labelled as Claude's. */
  does: string;
}

/**
 * What the helper read when it walked to a control and changed nothing. `path`, `value` and `options` are the app's
 * own words, cut to one short line of plain characters: show them labelled as the app's, never as Rig's.
 */
export interface ScreenLook {
  lookId: string;
  /** The walk, one name per hop, ending at the control. */
  path: string[];
  /** What the control reads now. */
  value: string;
  /** The values the control offers. A slider has a range instead. */
  options?: string[];
  range?: { min: number; max: number };
  /**
   * Whether what came back counts as Rig's own reading and not text from outside: the app is installed for the whole
   * PC, validly signed, not a host for web content, and only names and values of its controls were read.
   */
  clean: boolean;
}

export type LookReply = ScreenLook | { /** Why Rig won't or can't look, in plain words. */ refused: string };

/** The helper's self-test op: sets a value under HKCU\Software\RigSelftest. The helper knows it only inside --selftest. */
export interface SelftestOp {
  name: "selftest";
  value: string;
  /** Also writes a Run value, which the helper must catch and put back. */
  run?: true;
}

/** What Rig's own code says about one kind of native op. Nothing here comes from the model. */
export interface NativeRule<O extends NativeOp> {
  /** The op as the helper stores and fingerprints it, with anything Rig doesn't know dropped, or what is wrong with it in plain words. */
  canonical(raw: Record<string, unknown>): O | string;
  tier(op: O): Tier;
  /** Why this tier. */
  reasons(op: O): string[];
  /** A short past-tense title for the changes log. */
  title(op: O): string;
  /** What the op needs from outside itself. `refused`: why it can't be offered. `clean`: its tier 3 card may be shown in a chat that has read outside text. */
  check?(op: O, ctx: CheckContext): { refused?: string; clean?: boolean };
}

const shortLine = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && /^[\x20-\x7e]*$/.test(v);
const numberText = /^-?\d{1,9}(\.\d{1,6})?$/;

/** Whether a look offers this value. */
export function lookOffers(look: ScreenLook, to: string): boolean {
  if (look.options) return look.options.includes(to);
  return !!look.range && numberText.test(to) && Number(to) >= look.range.min && Number(to) <= look.range.max;
}

export const nativeOps: { [N in NativeOp["name"]]: NativeRule<Extract<NativeOp, { name: N }>> } = {
  selftest: {
    canonical: (raw) =>
      typeof raw.value !== "string" || raw.value.length === 0 || raw.value.length > 64 ? "The self-test op needs a short value." : { name: "selftest", value: raw.value, ...(raw.run === true ? { run: true as const } : {}) },
    tier: () => 2,
    reasons: () => ["Rig's own self-test change."],
    title: () => "Ran Rig's self-test change",
  },
  screen: {
    canonical: (raw) =>
      typeof raw.lookId !== "string" || !/^[0-9a-f]{32}$/.test(raw.lookId) || !shortLine(raw.to, screenMaxText) || !shortLine(raw.does, 300)
        ? "A change in an app's window needs the look it came from, the new value and one sentence."
        : { name: "screen", lookId: raw.lookId, to: raw.to, does: raw.does },
    // Always the strongest card: Rig can't know what the app writes, and undo by repeating the walk is best effort.
    tier: () => 3,
    reasons: () => [`${ruleWords("screen-tier")}.`],
    title: (op) => op.does.trim().replace(/\.$/, ""),
    check: (op, ctx) => {
      const look = ctx.looks?.find((l) => l.lookId === op.lookId);
      if (!look) return { refused: `${ruleWords("screen-look")}.` };
      if (!lookOffers(look, op.to)) return { refused: `${ruleWords("screen-option")}.` };
      if (look.value === op.to) return { refused: `${ruleWords("screen-same")}.` };
      return { clean: look.clean };
    },
  },
};

const nativeRule = (name: unknown): NativeRule<NativeOp> | undefined =>
  typeof name === "string" && Object.hasOwn(nativeOps, name) ? (nativeOps[name as NativeOp["name"]] as NativeRule<NativeOp>) : undefined;

/** The native op as the helper stores and checks it, or what is wrong with it. */
export function canonicalNative(raw: unknown): NativeOp | string {
  const rule = raw && typeof raw === "object" ? nativeRule((raw as { name?: unknown }).name) : undefined;
  return rule ? rule.canonical(raw as Record<string, unknown>) : "This isn't a kind of change Rig makes.";
}

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
  /** The looks at app windows made for this conversation on this PC. A screen step is refused without its look. */
  looks?: ScreenLook[];
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
  switch (step.kind) {
    case "fix": {
      const bad = validateCall(step.call);
      if (bad) return refuse(`This isn't one of Rig's fixes: ${bad}.`);
      return { status: "allowed", tier: actionInfo(step.call.kind).tier, admin: false, commands: [], reasons: ["One of Rig's own fixes, which stores its own undo."], rulesVersion };
    }
    case "command": return checkCommand(step.cmd, ctx);
    case "native": {
      const op = canonicalNative(step.op);
      if (typeof op === "string") return refuse(op);
      const rule = nativeRule(op.name)!;
      const tier = rule.tier(op);
      const found = rule.check?.(op, ctx) ?? {};
      if (found.refused) return refuse(found.refused);
      // A clean look's words are the app's own controls, read by Rig, so the card may still be shown.
      if (tier === 3 && ctx.tainted && !found.clean) return refuse(`${ruleWords("tainted")}.`, "tainted");
      // The helper's worker makes it with the person's own rights, so it never needs admin rights.
      return { status: "allowed", tier, admin: false, commands: [], reasons: rule.reasons(op), rulesVersion };
    }
  }
}

function checkCommand(raw: Command, ctx: CheckContext): Verdict {
  const cmd = canonicalCommand(raw);
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
  if (steps.length !== 1) return `${steps.length} changes`;
  const [step] = steps;
  switch (step.kind) {
    case "fix": return titleFor([step.call]);
    case "command": return step.cmd.does.trim().replace(/\.$/, "");
    case "native": {
      const op = canonicalNative(step.op);
      return typeof op === "string" ? "1 change" : nativeRule(op.name)!.title(op);
    }
  }
}

/** The step as the helper stores and checks it, or what is wrong with it. */
export function canonicalStep(step: HelperStep): HelperStep | string {
  switch (step.kind) {
    case "command": {
      const cmd = canonicalCommand(step.cmd);
      return typeof cmd === "string" ? cmd : { kind: "command", cmd };
    }
    case "native": {
      const op = canonicalNative(step.op);
      return typeof op === "string" ? op : { kind: "native", op };
    }
  }
}

// The change log.

export interface VerifyResult {
  /** What `read` printed before and after. */
  before: string;
  after: string;
}

export interface RestorePoint { seq: number; name: string; /** ISO time. */ at: string }

export interface FixUndo { kind: "fix"; call: ActionCall }
/** What the helper keeps for a step it applied, in its admin-only folder. */
interface KeptUndo {
  /** The helper's id for the step, its snapshot and what puts it back. */
  id: string;
  restorePoint?: RestorePoint;
  /** Things that changed outside `touches`. They have no snapshot. */
  outside: string[];
  /** Hash of the state right after the change, so undo can tell whether something else changed it since. */
  fingerprint: string;
}
export interface CommandUndo extends KeptUndo {
  kind: "command";
  /** The undo script's text, to show. The helper runs its own stored copy after it restores the snapshot. */
  script?: string;
}
/** The op's own way back was approved with the step; the helper keeps what it needs for it. */
export interface NativeUndo extends KeptUndo { kind: "native" }
export type HelperUndo = CommandUndo | NativeUndo;
export type UndoRecord = FixUndo | HelperUndo;

export type AppliedStep =
  /** `unverified`: what the helper saw when it read the fix back and the change wasn't there, in plain words. */
  | { step: FixStep; undo: FixUndo; rows: DiffRow[]; unverified?: string }
  | { step: CommandStep; undo: CommandUndo; rows: DiffRow[]; verify?: VerifyResult }
  | { step: NativeStep; undo: NativeUndo; rows: DiffRow[]; verify?: VerifyResult };

/** A helper step as the changes log keeps it once applied: the undo record is filed under the step's own kind. */
export function appliedHelperStep(step: HelperStep, undo: HelperUndo, rows: DiffRow[], verify: VerifyResult): AppliedStep {
  switch (step.kind) {
    case "command": return { step, undo: { ...undo, kind: "command" }, rows, verify };
    case "native": return { step, undo: { ...undo, kind: "native" }, rows, verify };
  }
}

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
// preview stores the step and its verdict under a nonce that works once
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
  /** What `read` printed before and after; for a native op, the state it changes as the helper's worker read it. */
  before: string;
  after: string;
  touches: TouchChange[];
  /** What `run` printed. Free text from the PC: it counts as outside content. */
  output: string;
  /** What else changed, when the helper could tell. */
  alsoChanged: string[];
}

/** A run's touches as rows for the changes log: what, before, after. */
export const runRows = (r: RunResult): DiffRow[] =>
  r.touches.map((t) => [t.touch.kind === "registry" ? `${t.touch.key}${t.touch.value ? `\\${t.touch.value}` : ""}` : t.touch.kind === "file" ? t.touch.path : t.touch.name, t.before ?? "Not there", t.after ?? "Not there"]);

export type PreviewReply =
  | { outcome: "refused"; verdict: Refused }
  | {
      outcome: "ready";
      nonce: string;
      /** ISO time. */
      expiresAt: string;
      verdict: Allowed;
      /** What `read` printed now; for a native op, the state it changes as the helper's worker read it. */
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
  | { outcome: "applied"; result: RunResult; undo: HelperUndo }
  /** It ran, then the helper put everything back: a never-list write (`sentinels`) or a failure (`error`). Nothing to undo. */
  | { outcome: "rolledBack"; result: RunResult; sentinels: SentinelHit[]; error?: string; left?: string[] };

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
  return sha256(parts.map((p) => `${p.length}:${p}`).join("\n"));
}

async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * A value written so that no two values share a text: every string and list with its length in front, object keys in
 * order. Only whole numbers, because the app and the helper don't write fractions the same way; an op that needs one
 * carries it as text.
 */
function encoded(v: unknown): string {
  if (v === null) return "z";
  if (typeof v === "string") return `s${v.length}:${v}`;
  if (typeof v === "boolean") return v ? "t" : "f";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("A step can only hold whole numbers.");
    return `n${v};`;
  }
  if (Array.isArray(v)) return `a${v.length}[${v.map(encoded).join("")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `o${keys.length}{${keys.map((k) => encoded(k) + encoded((v as Record<string, unknown>)[k])).join("")}}`;
  }
  throw new Error("A step can only hold text, whole numbers, true or false, lists and objects.");
}

/**
 * What an approval is of: the whole step. The helper works out the same fingerprint from the step it stored and runs or
 * approves it only when the two match. A command keeps the fingerprint it had before native ops ("rig-command-1"), so a
 * Rig app from before them and this helper still agree on it; every other step is "rig-step-1".
 */
export async function stepHash(step: Step): Promise<string> {
  switch (step.kind) {
    case "command": return commandHash(step.cmd);
    case "fix": case "native": return sha256(`rig-step-1\n${encoded(step)}`);
  }
}

/**
 * The helper checks everything again itself except taint: it can't see the chat, so a tainted chat's tier 3 card is
 * refused by the server before it is shown. A helper from before native ops answers the same four calls under
 * "command." with `{ cmd }` in place of `{ step }`; this helper still answers those too.
 */
export interface StepRpc {
  "step.check": { params: { step: HelperStep }; reply: { verdict: Verdict } };
  "step.preview": { params: { step: HelperStep }; reply: PreviewReply };
  "step.apply": { params: { nonce: string }; reply: ApplyReply };
  "step.undo": { params: { id: string; /** Put it back even when something else changed it since. */ force?: boolean }; reply: UndoReply };
  /** A read on its own, for a live look: it must check as tier 0, and runs as the person. */
  "command.read": { params: { script: string }; reply: { verdict: Refused } | { printed: string } };
  /**
   * Walks to a control in an app's window and reads it, changing nothing. `app` is one of Rig's own names for an app,
   * `ms-settings:` and a page, or the .exe (full path or file name) of a program that is already open; `goal` is the names of
   * the controls to walk through, the last being the one to read. The helper keeps the walk under `lookId`.
   */
  "screen.look": { params: { app: string; goal: string[] }; reply: LookReply };
}

/** The part of the helper link that carries steps. */
export interface StepLink {
  step<K extends keyof StepRpc>(method: K, params: StepRpc[K]["params"]): Promise<StepRpc[K]["reply"]>;
}
