// Looks up every command a script runs in rules/commands.json and works out
// the script's tier, or refuses it. It is stricter than the rules on purpose:
// anything it can't place is refused. The helper runs the same rules with
// PowerShell's own parser and has the last word, so every test here is one
// the rules file's `about` describes.

import rulesJson from "./rules/commands.json";
import { fold, scan, Unreadable, type Arg, type Call, type Find } from "./powershell";
import type { Allowed, FoundCommand, Refusal, Refused, Tier, Verdict } from "./change";

export type ScriptUse = "read" | "run" | "undo";

interface Match { starts?: string[]; has?: string[]; prefix?: string[]; contains?: string[]; piped?: boolean; after?: string[]; params?: string[] }
interface Outcome { says?: string; tier?: Tier; admin?: boolean; never?: string; refused?: string }
interface Form { starts?: string[]; has?: string[]; params?: string[]; prefix?: string[]; free?: boolean }
interface Targets { kind: "path" | "service"; values?: string[]; names?: string[]; renames?: string[]; leaves?: boolean; at?: number[]; write?: boolean; places?: boolean; content?: boolean }
interface Entry extends Outcome { name: string; exe?: boolean; literal?: boolean; blocks?: boolean; read?: Form[]; when?: (Match & Outcome)[]; targets?: Targets }
interface TextRule { says: string; contains: string[] }
interface ReadRoot { root: string; ends?: string[] }
interface Rules {
  version: number;
  maxLength: number;
  disguised: string[];
  exeSuffixes: string[];
  always: string[];
  readParams: string[];
  roots: { known: string[]; unknown: string[] };
  paths: { literal: string[]; literalPrefix: string; values: string[]; constants: string[]; wildcards: string[]; programs: string[]; readKinds: string[]; readRoots: ReadRoot[]; system: string };
  remote: { params: string[]; refused: string };
  writerVerbs: string[];
  adminText: string[];
  safeTypes: string[];
  safeMethods: string[];
  safeStatics: string[];
  engine: string[];
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

/** Characters PowerShell reads as quotes, dashes or spaces but that don't look like them, letters that fold into ASCII, and control characters. */
const DISGUISED = new RegExp(`[${R.disguised.map((r) => r.split("-").map((h) => `\\u${h.padStart(4, "0")}`).join("-")).join("")}]`);

/** The form text rules are matched against. The helper does the same; see `about` in the rules. */
function squash(text: string): string {
  return fold(text).replaceAll("hkey_local_machine", "hklm").replaceAll("hkey_current_user", "hkcu").replaceAll("/", "\\")
    .replace(/[`'"+: \t\r\n]/g, "").replace(/\\+/g, "\\");
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

/** What a path names, the way the rules compare places. */
export type PlaceKind = "registry" | "file" | "drive" | "relative" | "name";

/** A path as Rig compares it: folded, / as \, one \ at a time, no \ at the end, and the registry hives as hkcu\, hklm\, hkcr\, hku\ and hkcc\. */
export function placeOf(text: string): string {
  return fold(text).replaceAll("/", "\\").replace(/\\+/g, "\\")
    .replace(/^(microsoft\.powershell\.core\\)?(registry|filesystem)::/, "")
    .replace(/^hkey_current_user(?=\\|$)/, "hkcu").replace(/^hkey_local_machine(?=\\|$)/, "hklm").replace(/^hkey_classes_root(?=\\|$)/, "hkcr")
    .replace(/^hkey_users(?=\\|$)/, "hku").replace(/^hkey_current_config(?=\\|$)/, "hkcc")
    .replace(/^(hkcu|hklm|hkcr|hku|hkcc):\\?/, "$1\\")
    .replace(/^(?![a-z]:\\$)(.+)\\$/, "$1");
}

export function kindOf(place: string): PlaceKind {
  if (/^(hkcu|hklm|hkcr|hku|hkcc)(\\|$)/.test(place)) return "registry";
  if (/^[a-z]:\\/.test(place)) return "file";
  if (/^[a-z][\w.-]+:/.test(place)) return "drive";
  return /[\\:]/.test(place) ? "relative" : "name";
}

/** The touch covers the place when they are the same or the place is inside it. */
export const covers = (touch: string, place: string) => place === touch || place.startsWith(`${touch}\\`);
const dots = (place: string) => /(^|\\)\.\.(\\|$)/.test(place);

/** A variable or drive path that decides which program or parameters a command really gets. */
function pinned(name: string): boolean {
  const low = fold(name).replace(/^\$/, "").replace(/^(global|script|local|private):/, "").replace(/^variable:\\?/, "").replace(/^env:\\?/, "env:");
  return R.pinned.includes(low);
}

const shownOf = (args: Arg[]) => args.filter((a) => a.kind !== "block" && !a.redirect);
const isParam = (a: Arg) => a.kind === "switch" || !!a.param;
/** A parameter's name: the part before any colon. */
const headOf = (a: Arg) => a.param ?? fold(a.text).split(":")[0];
/** The value joined to a parameter after its colon, or null when there is no colon. */
const inlineOf = (a: Arg) => (a.text.length > headOf(a).length ? a.text.slice(headOf(a).length + 1) : null);
/** Matches a listed parameter the way PowerShell does, in either direction: `-co` and `-computername` both fit `-comp`. */
const abbreviates = (head: string, listed: string) => head.length > 1 && (listed.startsWith(head) || head.startsWith(listed));

/** The arguments right after a listed parameter, or joined to it after a colon. */
function valuesAfter(shown: Arg[], params: string[]): Arg[] {
  const out: Arg[] = [];
  shown.forEach((a, k) => {
    if (!isParam(a) || !params.some((p) => abbreviates(headOf(a), p))) return;
    const inline = inlineOf(a);
    if (inline) out.push({ kind: "word", text: inline });
    else if (shown[k + 1]) out.push(shown[k + 1]);
  });
  return out;
}

function matches(m: Match, call: Call, strict: boolean, exe: boolean): boolean {
  const shown = m.after ? valuesAfter(shownOf(call.args), m.after) : shownOf(call.args);
  const t = shown.map((a) => fold(a.text)), unseen = strict && shown.some((a) => a.kind === "hidden");
  const list = (xs?: string[]) => xs?.map(fold);
  const starts = list(m.starts), has = list(m.has), prefix = list(m.prefix), contains = list(m.contains);
  if (m.piped && !call.piped) return false;
  if (m.after && !shown.length) return false;
  if (starts && !starts.every((want, k) => t[k] === want || (strict && shown[k]?.kind === "hidden"))) return false;
  if (has && !unseen && !t.some((x) => has.includes(x))) return false;
  // A program gets its arguments as text, so a hidden one may be anything; a cmdlet's hidden argument can only be a value.
  const prefixUnseen = unseen && (exe || !!m.after);
  const fitsPrefix = (x: string, a: Arg) => prefix!.some((p) => x.startsWith(p) || (/^[-/]/.test(x) && abbreviates(headOf(a), p)));
  if (prefix && !prefixUnseen && !shown.some((a, k) => fitsPrefix(t[k], a))) return false;
  if (contains && !unseen && !t.some((x) => contains.some((p) => x.includes(p)))) return false;
  if (m.params && !fitsParams(m.params, call.args, starts?.length ?? 0)) return false;
  return true;
}

/** A positive grammar for a rule that allows: nothing hidden, and every switch after `starts` is listed, written in full. */
function fitsParams(params: string[], args: Arg[], skip: number): boolean {
  const shown = shownOf(args), listed = params.map(fold);
  if (shown.some((a) => a.kind === "hidden")) return false;
  return shown.slice(skip).every((a) => {
    const x = fold(a.text);
    return !((x.startsWith("-") || x.startsWith("/")) && x.length > 1) || listed.includes(x.split(":")[0]);
  });
}

/** Null when the arguments fit the read form, else the argument that doesn't. */
function offForm(f: Form, args: Arg[]): string | null {
  const shown = shownOf(args), t = shown.map((a) => fold(a.text)), starts = (f.starts ?? []).map(fold);
  for (let k = 0; k < starts.length; k++) if (shown[k]?.kind === "hidden" || t[k] !== starts[k]) return shown[k]?.text || "its arguments";
  if (f.has && !f.has.some((h) => t.includes(h))) return `no ${f.has[0]}`;
  if (f.free) return shown.some((a) => a.kind === "hidden") ? "an argument it can't see" : null;
  const params = f.params ?? [], prefix = f.prefix ?? [];
  for (const x of t.slice(starts.length)) {
    if (!((x.startsWith("-") || x.startsWith("/")) && x.length > 1)) continue;
    const head = x.split(":")[0];
    if (!params.includes(head) && !R.readParams.includes(head) && !prefix.some((p) => x.startsWith(p))) return x;
  }
  return null;
}

/** One argument a file, registry or service command acts on. */
export interface Target { text: string; place: string; kind: PlaceKind; hidden: boolean; literal: boolean }

const literalParam = (head: string) => R.paths.literal.includes(head) || (head.length > 1 && R.paths.literalPrefix.startsWith(head));

/** A plain name a command gives what it makes or renames, which Rig joins to the place it is in. */
interface Named { text: string; rename: boolean }

/** The arguments a command acts on: every argument that isn't a parameter or the value of one listed in `values`, or those at `at`; and the plain names it skipped. */
function targetsOf(call: Call, t: Targets): { targets: Target[]; named: Named[] } {
  const shown = shownOf(call.args).filter((a) => a.kind === "hidden" || !R.paths.constants.includes(fold(a.text)));
  const make = (a: Arg, literal: boolean): Target => {
    const hidden = a.kind === "hidden", place = hidden ? "" : placeOf(a.text);
    return { text: a.text, place, kind: hidden ? "name" : kindOf(place), hidden, literal };
  };
  if (t.at) return { targets: t.at.flatMap((k) => (shown[k] ? [make(shown[k], false)] : [])), named: [] };
  const values = t.values ?? [], names = t.names ?? [], renames = t.renames ?? [], out: Target[] = [], named: Named[] = [];
  const plainName = (x: Target) => !x.hidden && x.kind === "name" && !R.paths.wildcards.some((w) => x.text.includes(w)) && !(t.places && R.paths.programs.some((p) => x.place.endsWith(p)));
  for (let k = 0; k < shown.length; k++) {
    const a = shown[k];
    if (!isParam(a)) { out.push(make(a, false)); continue; }
    const head = headOf(a);
    const role = literalParam(head) ? "literal" : values.includes(head) || R.paths.values.includes(head) ? "value" : names.includes(head) || renames.includes(head) ? "name" : "path";
    const inline = inlineOf(a);
    const add = (x: Target) => {
      if (role === "literal" || (role === "name" && !plainName(x))) out.push(x);
      else if (role === "name") named.push({ text: x.place, rename: renames.includes(head) });
    };
    if (inline) { if (role === "path") out.push(make({ kind: "word", text: inline }, false)); else add(make({ kind: "word", text: inline }, role === "literal")); continue; }
    if (role === "path" || !shown[k + 1] || isParam(shown[k + 1])) continue;
    k++;
    add(make(shown[k], role === "literal"));
  }
  return { targets: out, named };
}

/** Matches a place against a read root, where * stands for one folder name. */
function underRoot(place: string, r: ReadRoot): boolean {
  const parts = r.root.split("\\").filter(Boolean), have = place.split("\\");
  if (have.length <= parts.length || !parts.every((p, k) => p === "*" || p === have[k])) return false;
  return !r.ends || r.ends.some((e) => place.endsWith(e));
}

/** What one change in a script acts on. `none`: something Rig can't name, so no touch can cover it. */
export interface Write { kind: "path" | "service" | "none"; places: string[] }

/** `joined`: the places a command's plain names make, held to the text rules like the script itself. */
interface Judged { found: FoundCommand; admin: boolean; write?: Write; joined?: string[]; stop?: { words: string; why: Refusal } }
const NONE: Write = { kind: "none", places: [] };

/** Refuses what the targets of a file, registry or service command can't be, and says what it writes to. */
function checkTargets(t: Targets, entry: Entry, call: Call, use: ScriptUse, name: string): { stop: [string, string, Refusal] } | { write: Write; joined: string[] } {
  const { targets, named } = targetsOf(call, t), shown = targets.filter((x) => !x.hidden);
  const at = (x: Target) => `${name} ${x.text}`;
  if (t.kind === "service") return { write: targets.some((x) => x.hidden) ? NONE : { kind: "service", places: shown.map((x) => x.place) }, joined: [] };
  const wild = shown.find((x) => !x.literal && R.paths.wildcards.some((w) => x.text.includes(w)));
  if (wild) return { stop: ["wildcard", at(wild), "refused"] };
  const up = shown.find((x) => dots(x.place));
  if (up) return { stop: ["dots", at(up), "refused"] };
  if (use === "read") {
    if (entry.literal && call.piped) return { stop: ["piped-read", name, "notRead"] };
    const odd = shown.find((x) => !R.paths.readKinds.includes(x.kind));
    if (odd) return { stop: ["read-kind", at(odd), "notRead"] };
  } else if (t.write) {
    if (targets.some((x) => x.hidden)) return { stop: ["not-literal-change", name, "refused"] };
    const loose = shown.find((x) => x.kind === "relative" || x.kind === "name");
    if (loose) return { stop: ["relative", at(loose), "refused"] };
    if (!shown.some((x) => x.kind === "registry" || x.kind === "file" || x.kind === "drive")) return { stop: ["full-path", name, "refused"] };
  }
  if (t.content) {
    const outside = shown.find((x) => x.kind !== "file" || !R.paths.readRoots.some((r) => underRoot(x.place, r)));
    if (outside || !shown.length) return { stop: ["read-place", outside ? at(outside) : name, use === "read" ? "notRead" : "refused"] };
  }
  if (t.places && use !== "read") {
    const prog = shown.find((x) => R.paths.programs.some((p) => x.place.endsWith(p)));
    if (prog) return { stop: ["program-file", at(prog), "refused"] };
  }
  const places = shown.filter((x) => x.kind === "registry" || x.kind === "file").map((x) => x.place);
  // A plain name is made inside each place, or, for a rename, beside it; a copy or move can land inside the other place under its own last name.
  const leaf = (p: string) => p.slice(p.lastIndexOf("\\") + 1);
  const joined = [...named.flatMap((n) => places.map((p) => `${n.rename && p.includes("\\") ? p.slice(0, p.lastIndexOf("\\")) : p}\\${n.text}`)),
    ...(t.leaves ? places.flatMap((p) => places.filter((q) => q !== p).map((q) => `${p}\\${leaf(q)}`)) : [])];
  if (shown.some((x) => x.kind === "drive")) return { write: NONE, joined };
  return { write: { kind: "path", places: [...places, ...joined] }, joined };
}

/** Refuses what a cmdlet Rig doesn't know by name can't be given in a change: anything hidden, a place with `..`, a wildcard in a full path, and for a writer a program file. */
function checkUnlisted(call: Call, verb: string, name: string): [string, string] | null {
  const shown = shownOf(call.args);
  if (shown.some((a) => a.kind === "hidden")) return ["not-literal-change", name];
  const values = shown.flatMap((a) => (!isParam(a) ? [a.text] : inlineOf(a) ? [inlineOf(a)!] : []));
  const at = (v: string) => `${name} ${v}`;
  const up = values.find((v) => dots(placeOf(v)));
  if (up) return ["dots", at(up)];
  const full = (v: string) => ["file", "registry"].includes(kindOf(placeOf(v)));
  const wild = values.find((v) => full(v) && R.paths.wildcards.some((w) => v.includes(w)));
  if (wild) return ["wildcard", at(wild)];
  const prog = R.writerVerbs.includes(verb) ? values.find((v) => full(v) && R.paths.programs.some((p) => placeOf(v).endsWith(p))) : undefined;
  return prog ? ["program-file", at(prog)] : null;
}

function judge(call: Call, use: ScriptUse): Judged {
  const raw = fold(call.name);
  const pathed = raw.includes("\\") || raw.includes("/");
  let base = raw.slice(Math.max(raw.lastIndexOf("\\"), raw.lastIndexOf("/")) + 1);
  const typed = call.name.slice(call.name.length - base.length);
  const exe = R.exeSuffixes.some((x) => base.endsWith(x));
  if (exe) base = base.slice(0, -4);
  if (!pathed && !exe) base = R.aliases[base] ?? base;
  const entry = R.commands.find((e) => fold(e.name) === base && (e.exe || !(pathed || exe)));
  const name = entry?.name ?? (base === fold(typed) ? typed : base);
  const found = (says: string, tier: Tier): FoundCommand => ({ name, says, tier, script: use });
  const stop = (words: string, why: Refusal = "refused"): Judged => ({ found: found(words, 3), admin: false, stop: { words, why } });
  const construct = (key: string, detail = call.name, why: Refusal = "refused") => stop(`${R.constructs[key]} (${detail}).`, why);
  const pass = (o: Outcome, tier: Tier, write: Write = NONE): Judged =>
    ({ found: found(`${name}: ${o.says ?? entry?.says ?? ""}`, tier), admin: use !== "read" && (o.admin ?? entry?.admin ?? false), ...(tier > 0 ? { write } : {}) });

  const remote = !pathed && !exe && !entry?.exe && shownOf(call.args).some((a) => isParam(a) && R.remote.params.some((p) => abbreviates(headOf(a), p)))
    ? stop(`Rig won't run ${name}: it ${R.remote.refused}.`) : null;

  if (base.includes(".")) return construct("script-file");
  if (pathed && (raw.includes("..") || !R.roots.known.some((r) => raw.startsWith(r)))) return construct("path");
  if (!entry) {
    if (remote) return remote;
    if (use === "read") return construct("not-read", name, "notRead");
    if (pathed) return R.roots.unknown.some((r) => raw.startsWith(r)) ? pass({ says: R.constructs["unknown-program"], admin: true }, 2) : construct("unknown", name);
    const dash = base.indexOf("-"), tier = dash > 0 && !exe ? R.verbs[base.slice(0, dash)] : undefined;
    if (tier === undefined) return construct("unknown", name);
    const odd = checkUnlisted(call, base.slice(0, dash), name);
    if (odd) return construct(...odd);
    return { found: found(`${name}: ${R.verbSays[tier]}`, tier), admin: tier >= 2, ...(tier > 0 ? { write: NONE } : {}) };
  }
  if (entry.blocks && call.args.some((a) => a.kind === "word" || a.kind === "hidden")) return construct("member-by-name", name);
  const rule = entry.when?.find((w) => matches(w, call, !!(w.never || w.refused || w.tier === 3), !!entry.exe));
  const block = (o: Outcome) => (o.never ? stop(`Rig won't run ${name}: it ${o.never}.`, "never") : o.refused ? stop(`Rig won't run ${name}: it ${o.refused}.`) : null);
  if (rule && (rule.never || rule.refused)) return block(rule)!;
  if (remote) return remote;

  let write = NONE, joined: string[] = [];
  if (entry.targets) {
    const t = checkTargets(entry.targets, entry, call, use, name);
    if ("stop" in t) return construct(...t.stop);
    ({ write, joined } = t);
  }
  const done = (j: Judged): Judged => (joined.length ? { ...j, joined } : j);

  const off = entry.read ? entry.read.map((f) => offForm(f, call.args)) : ["anything"];
  const reads = off.includes(null);
  if (use === "read") {
    if (!reads) return block(entry) ?? construct("not-read", entry.read ? `${name} with ${off[off.length - 1]}` : name, "notRead");
    if (entry.literal && call.args.some((a) => a.kind === "hidden")) return construct("not-literal", name, "notRead");
    return pass({ says: entry.says }, 0);
  }
  if (rule) return done(pass(rule, rule.tier ?? 2, write));
  if (reads) return done(pass({ says: entry.says }, 0));
  return block(entry) ?? done(pass(entry, entry.tier ?? 2, write));
}

/** Why a script with this find is refused, or null when it may stay. `reason` is what a change may do but must say. */
function judgeFind(f: Find, use: ScriptUse): { refuse?: string; why?: Refusal; reason?: string } | null {
  const words = (key = f.what, detail = f.detail) => `${R.constructs[key] ?? R.constructs.unreadable}${detail ? ` (${detail})` : ""}.`;
  if (f.what === "assigns") return null;
  if (f.what === "variable") return R.engine.includes(f.detail.replace(/^(global|script|local|private):/, "")) ? { refuse: words("engine", `$${f.detail}`), why: "refused" } : null;
  if (f.what === "static") return R.safeStatics.includes(f.detail) ? null : { refuse: words(), why: "refused" };
  if (R.always.includes(f.what)) return { refuse: words(), why: "refused" };
  if (use !== "read") {
    if (f.what === "type" && R.safeTypes.includes(f.detail)) return null;
    if (f.what === "method" && R.safeMethods.includes(f.detail)) return null;
    if (f.what === "member-assign") return { reason: words() };
    if (f.what === "redirect") {
      const place = placeOf(f.detail), at = `> ${f.detail}`;
      if (f.hidden) return { refuse: words("not-literal-change", ">"), why: "refused" };
      if (R.paths.wildcards.some((w) => f.detail.includes(w))) return { refuse: words("wildcard", at), why: "refused" };
      if (dots(place)) return { refuse: words("dots", at), why: "refused" };
      if (R.paths.programs.some((p) => place.endsWith(p))) return { refuse: words("program-file", at), why: "refused" };
      if (kindOf(place) !== "file") return { refuse: words("relative", at), why: "refused" };
      return { reason: words() };
    }
  }
  return { refuse: `Rig only looks with plain commands. ${words()}`, why: "notRead" };
}

/** The reason a general command gets when nothing about it is riskier than that. */
export const secondLook = "A general command, so it needs a second look before it runs.";

/** A program the script itself may have put in place, so not the program Rig looked up. */
function wroteProgram(calls: Call[], judged: Judged[], finds: Find[]): string | null {
  const redirected = finds.filter((f) => f.what === "redirect").map((f) => placeOf(f.detail));
  const changers = calls.flatMap((call, k) => (judged[k].found.tier > 0 ? [{ call, j: judged[k] }] : []));
  for (const call of calls) {
    // What the other changing commands write: their path-like arguments, and any redirect.
    const others = changers.filter(({ call: d }) => d !== call);
    const written = [...redirected, ...others.flatMap(({ call: d }) => shownOf(d.args).filter((a) => a.kind !== "hidden" && /[\\/]/.test(a.text)).map((a) => placeOf(a.text)))];
    const raw = fold(call.name);
    const base = raw.slice(Math.max(raw.lastIndexOf("\\"), raw.lastIndexOf("/")) + 1).replace(/\.(exe|com)$/, "");
    if (/[\\/]/.test(raw)) {
      const prog = placeOf(raw), folder = prog.slice(0, prog.lastIndexOf("\\"));
      // A change with no known target and a hidden argument could have written anywhere, this program included.
      const blind = others.some(({ call: d, j }) => j.write?.kind === "none" && d.args.some((a) => a.kind === "hidden"));
      if (blind || written.some((w) => w === prog || covers(w, folder) || covers(folder, w))) return call.name;
    } else if (R.commands.some((e) => e.exe && fold(e.name) === base)) {
      // A bare program name runs from the system folder or the PATH, so writing a file of that name, or into the system folder, counts.
      if (written.includes(R.paths.system) || R.exeSuffixes.some((x) => written.some((w) => w.endsWith(`\\${base}${x}`)))) return call.name;
    }
  }
  return null;
}

/** The verdict on one script, with what each change in it writes to. */
export function inspectScript(script: string, use: ScriptUse): { verdict: Verdict; writes: Write[] } {
  const refuse = (refused: string, why: Refusal = "refused", commands: FoundCommand[] = []): { verdict: Refused; writes: Write[] } =>
    ({ verdict: { status: "refused", refused, why, commands, rulesVersion }, writes: [] });
  if (typeof script !== "string" || !script.trim()) return refuse(`${R.constructs.empty}.`);
  if (script.length > R.maxLength) return refuse(`${R.constructs["too-long"]}.`);
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
  const joined = judged.flatMap((j) => j.joined ?? []);
  const never = [script, ...joined].map((x) => textOnNeverList(x, use)).find((x) => x) ?? judged.find((j) => j.stop?.why === "never")?.stop!.words;
  if (never) return refuse(never.endsWith(".") ? never : `${never}.`, "never", commands);

  const assigned = parsed.finds.filter((f) => f.what === "assigns").map((f) => f.detail);
  const named = parsed.calls.flatMap((c) => c.args.filter((a) => a.kind === "word").map((a) => a.text));
  const reset = [...assigned, ...named].find(pinned);
  if (reset) return refuse(`${R.constructs.pinned} (${reset}).`, "refused", commands);

  const reasons: string[] = [];
  for (const f of parsed.finds) {
    const j = judgeFind(f, use);
    if (j?.refuse) return refuse(j.refuse, j.why, commands);
    if (j?.reason && !reasons.includes(j.reason)) reasons.push(j.reason);
  }
  const stopped = judged.find((j) => j.stop);
  if (stopped) return refuse(stopped.stop!.words, stopped.stop!.why, commands);
  const wrote = use === "read" ? null : wroteProgram(parsed.calls, judged, parsed.finds);
  if (wrote) return refuse(`${R.constructs["wrote-program"]} (${wrote}).`, "refused", commands);

  const top = Math.max(0, ...commands.map((c) => c.tier)) as Tier;
  const lowers = use === "read" ? null : [script, ...joined].map(textLowersProtection).find((x) => x) ?? null;
  const tier = use === "read" ? 0 : lowers ? 3 : (Math.max(2, top) as Tier);
  for (const c of commands) if (c.tier === 3) reasons.push(`${c.says}. Rig can't promise to put this back.`);
  if (lowers) reasons.push(`${lowers}.`);
  if (use !== "read" && !reasons.length) reasons.push(secondLook);
  const writes = use === "read" ? [] : [...judged.flatMap((j) => (j.write ? [j.write] : [])),
    ...parsed.finds.filter((f) => f.what === "redirect").map((f): Write => ({ kind: "path", places: [placeOf(f.detail)] }))];
  const allowed: Allowed = { status: "allowed", tier, admin: use !== "read" && (judged.some((j) => j.admin) || [script, ...joined].some(textNeedsAdmin)), commands, reasons, rulesVersion };
  return { verdict: allowed, writes };
}

/** The verdict on one script. A read is tier 0 or refused; a change is tier 2 or 3 or refused. */
export function checkScript(script: string, use: ScriptUse): Verdict {
  return inspectScript(script, use).verdict;
}
