// Looks up every command a script runs in rules/commands.json and works out
// the script's tier, or refuses it. It is stricter than the rules on purpose:
// anything it can't place is refused. The helper runs the same rules with
// PowerShell's own parser and has the last word.

import rulesJson from "./rules/commands.json";
import { DISGUISED, scan, Unreadable, type Arg, type Call } from "./powershell";
import type { Allowed, FoundCommand, Refusal, Refused, Tier, Verdict } from "./change";

export type ScriptUse = "read" | "run" | "undo";

interface Match { starts?: string[]; has?: string[]; prefix?: string[]; contains?: string[]; piped?: boolean }
interface Outcome { says?: string; tier?: Tier; admin?: boolean; never?: string; refused?: string }
interface Form { starts?: string[]; has?: string[]; params?: string[]; prefix?: string[]; free?: boolean }
interface Entry extends Outcome { name: string; exe?: boolean; literal?: boolean; blocks?: boolean; read?: Form[]; when?: (Match & Outcome)[] }
interface TextRule { says: string; contains: string[] }
interface Rules {
  version: number;
  readParams: string[];
  roots: { known: string[]; unknown: string[] };
  adminText: string[];
  safeTypes: string[];
  safeMethods: string[];
  pinned: string[];
  constructs: Record<string, string>;
  verbs: Record<string, Tier>;
  verbSays: string[];
  aliases: Record<string, string>;
  neverText: (TextRule & { applies: "any" | "change" })[];
  protectText: TextRule[];
  commands: Entry[];
}

const R = rulesJson as unknown as Rules;
export const rulesVersion = R.version;
export const ruleWords = (construct: string) => R.constructs[construct];

/** The form text rules are matched against. The helper does the same; see `about` in the rules. */
function squash(text: string): string {
  return text.toLowerCase().replaceAll("hkey_local_machine", "hklm").replaceAll("hkey_current_user", "hkcu").replaceAll("/", "\\")
    .replace(/[`'"+:\s]/g, "").replace(/\\+/g, "\\");
}
const fits = (rule: TextRule, flat: string) => rule.contains.some((c) => flat.includes(squash(c)));

/** The never-list words that fit this text, or null. Reads are only held to the entries about secrets. */
export function textOnNeverList(text: string, use: ScriptUse): string | null {
  const flat = squash(text);
  return R.neverText.find((e) => (e.applies === "any" || use !== "read") && fits(e, flat))?.says ?? null;
}

/** What a change to this text would lower, such as UAC or Defender, or null. Such a change is tier 3. */
export function textLowersProtection(text: string): string | null {
  const flat = squash(text);
  return R.protectText.find((e) => fits(e, flat))?.says ?? null;
}

export function textNeedsAdmin(text: string): boolean {
  const flat = squash(text);
  return R.adminText.some((a) => flat.includes(squash(a)));
}

/** A variable or drive path that decides which program or parameters a command really gets. */
function pinned(name: string): boolean {
  const low = name.toLowerCase().replace(/^\$/, "").replace(/^(global|script|local|private):/, "").replace(/^variable:\\?/, "").replace(/^env:\\?/, "env:");
  return R.pinned.includes(low);
}

const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
const shownOf = (args: Arg[]) => args.filter((a) => a.kind !== "block");

function matches(m: Match, call: Call, strict: boolean): boolean {
  const shown = shownOf(call.args), t = lower(shown.map((a) => a.text)), unseen = strict && shown.some((a) => a.kind === "hidden");
  if (m.piped && !call.piped) return false;
  if (m.starts && !lower(m.starts).every((want, k) => t[k] === want || (strict && shown[k]?.kind === "hidden"))) return false;
  if (m.has && !unseen && !t.some((x) => lower(m.has!).includes(x))) return false;
  if (m.prefix && !t.some((x) => lower(m.prefix!).some((p) => x.startsWith(p)))) return false;
  if (m.contains && !unseen && !t.some((x) => lower(m.contains!).some((p) => x.includes(p)))) return false;
  return true;
}

/** Null when the arguments fit the read form, else the argument that doesn't. */
function offForm(f: Form, args: Arg[]): string | null {
  const shown = shownOf(args), t = lower(shown.map((a) => a.text)), starts = lower(f.starts ?? []);
  for (let k = 0; k < starts.length; k++) if (shown[k]?.kind === "hidden" || t[k] !== starts[k]) return shown[k]?.text || "its arguments";
  if (f.has && !lower(f.has).some((h) => t.includes(h))) return `no ${f.has[0]}`;
  if (f.free) return null;
  const params = lower(f.params ?? []), prefix = lower(f.prefix ?? []);
  for (const x of t.slice(starts.length)) {
    if (!((x.startsWith("-") || x.startsWith("/")) && x.length > 1)) continue;
    const head = x.split(":")[0];
    if (!params.includes(head) && !R.readParams.includes(head) && !prefix.some((p) => x.startsWith(p))) return x;
  }
  return null;
}

interface Judged { found: FoundCommand; admin: boolean; stop?: { words: string; why: Refusal } }

function judge(call: Call, use: ScriptUse): Judged {
  const raw = call.name.toLowerCase();
  const pathed = raw.includes("\\") || raw.includes("/");
  let base = raw.slice(Math.max(raw.lastIndexOf("\\"), raw.lastIndexOf("/")) + 1);
  const typed = call.name.slice(call.name.length - base.length);
  const exe = base.endsWith(".exe") || base.endsWith(".com");
  if (exe) base = base.slice(0, -4);
  if (!pathed && !exe) base = R.aliases[base] ?? base;
  const entry = R.commands.find((e) => e.name.toLowerCase() === base && (e.exe || !(pathed || exe)));
  const name = entry?.name ?? (base === typed.toLowerCase() ? typed : base);
  const stop = (words: string, why: Refusal = "refused"): Judged => ({ found: { name, says: words, tier: 3 }, admin: false, stop: { words, why } });
  const construct = (key: string, detail = call.name, why: Refusal = "refused") => stop(`${R.constructs[key]} (${detail}).`, why);
  const pass = (o: Outcome, tier: Tier): Judged => ({ found: { name, says: `${name}: ${o.says ?? entry?.says ?? ""}`, tier }, admin: use !== "read" && (o.admin ?? entry?.admin ?? false) });

  if (base.includes(".")) return construct("script-file");
  if (pathed && (raw.includes("..") || !R.roots.known.some((r) => raw.startsWith(r)))) return construct("path");
  if (!entry) {
    if (use === "read") return construct("not-read", name, "notRead");
    if (pathed) return R.roots.unknown.some((r) => raw.startsWith(r)) ? { found: { name, says: `${name}: ${R.constructs["unknown-program"]}`, tier: 2 }, admin: true } : construct("unknown", name);
    const dash = base.indexOf("-"), tier = dash > 0 && !exe ? R.verbs[base.slice(0, dash)] : undefined;
    if (tier === undefined) return construct("unknown", name);
    return { found: { name, says: `${name}: ${R.verbSays[tier]}`, tier }, admin: tier >= 2 };
  }
  if (entry.blocks && call.args.some((a) => a.kind === "word" || a.kind === "hidden")) return construct("member-by-name", name);
  const rule = entry.when?.find((w) => matches(w, call, !!(w.never || w.refused || w.tier === 3)));
  const block = (o: Outcome) => (o.never ? stop(`Rig won't run ${name}: it ${o.never}.`, "never") : o.refused ? stop(`Rig won't run ${name}: it ${o.refused}.`) : null);
  if (rule && (rule.never || rule.refused)) return block(rule)!;
  const off = entry.read ? entry.read.map((f) => offForm(f, call.args)) : ["anything"];
  const reads = off.includes(null);
  if (use === "read") {
    if (!reads) return block(entry) ?? construct("not-read", entry.read ? `${name} with ${off[off.length - 1]}` : name, "notRead");
    if (entry.literal && call.args.some((a) => a.kind === "hidden")) return construct("not-literal", name, "notRead");
    return pass({ says: entry.says }, 0);
  }
  if (rule) return pass(rule, rule.tier ?? 2);
  if (reads) return pass({ says: entry.says }, 0);
  return block(entry) ?? pass(entry, entry.tier ?? 2);
}

const ALWAYS = ["dynamic", "dot-source", "obfuscated", "splat", "keyword", "provider-variable", "dynamic-member", "stray", "unc"];

/** The verdict on one script. A read is tier 0 or refused; a change is tier 2 or 3 or refused. */
export function checkScript(script: string, use: ScriptUse): Verdict {
  const refuse = (refused: string, why: Refusal = "refused", commands: FoundCommand[] = []): Refused => ({ status: "refused", refused, why, commands, rulesVersion });
  if (typeof script !== "string" || !script.trim()) return refuse(`${R.constructs.empty}.`);
  if (script.length > 20_000) return refuse(`${R.constructs["too-long"]}.`);
  if (DISGUISED.test(script)) return refuse(`${R.constructs.characters}.`);
  let parsed: ReturnType<typeof scan>;
  try {
    parsed = scan(script);
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e;
    return refuse(`${R.constructs.unreadable}: it has ${e.message}.`);
  }
  const judged = parsed.calls.map((c) => judge(c, use));
  const commands = judged.map((j) => j.found);
  const never = textOnNeverList(script, use) ?? judged.find((j) => j.stop?.why === "never")?.stop!.words;
  if (never) return refuse(never.endsWith(".") ? never : `${never}.`, "never", commands);

  const assigned = parsed.finds.filter((f) => f.what === "assigns").map((f) => f.detail);
  const named = parsed.calls.flatMap((c) => c.args.filter((a) => a.kind === "word").map((a) => a.text));
  const reset = [...assigned, ...named].find(pinned);
  if (reset) return refuse(`${R.constructs.pinned} (${reset}).`, "refused", commands);

  const reasons: string[] = [];
  for (const f of parsed.finds) {
    if (f.what === "assigns") continue;
    const fine = use !== "read" && ((f.what === "type" && R.safeTypes.includes(f.detail.replace(/^system\./, ""))) || (f.what === "method" && R.safeMethods.includes(f.detail)));
    if (fine) continue;
    if (f.what === "redirect" && use !== "read") { reasons.push(`${R.constructs.redirect}${f.detail ? ` (${f.detail})` : ""}.`); continue; }
    if (ALWAYS.includes(f.what) || f.what === "type" || f.what === "method" || f.what === "redirect") {
      const looking = use === "read" && !ALWAYS.includes(f.what);
      return refuse(`${looking ? "Rig only looks with plain commands. " : ""}${R.constructs[f.what]}${f.detail ? ` (${f.detail})` : ""}.`, looking ? "notRead" : "refused", commands);
    }
  }
  const stopped = judged.find((j) => j.stop);
  if (stopped) return refuse(stopped.stop!.words, stopped.stop!.why, commands);

  const top = Math.max(0, ...commands.map((c) => c.tier)) as Tier;
  const lowers = use === "read" ? null : textLowersProtection(script);
  const tier = use === "read" ? 0 : lowers ? 3 : (Math.max(2, top) as Tier);
  for (const c of commands) if (c.tier === 3) reasons.push(`${c.says}. Rig can't promise to put this back.`);
  if (lowers) reasons.push(`${lowers}.`);
  if (use !== "read" && !reasons.length) reasons.push("A general command, so it needs a second look before it runs.");
  const allowed: Allowed = { status: "allowed", tier, admin: use !== "read" && (judged.some((j) => j.admin) || textNeedsAdmin(script)), commands, reasons, rulesVersion };
  return allowed;
}
