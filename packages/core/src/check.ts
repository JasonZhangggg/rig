// Reads a PowerShell script well enough to find every command it runs, then
// looks each one up in rules/commands.json. It is stricter than the rules on
// purpose: anything it can't place is refused. The helper runs the same rules
// with PowerShell's own parser and has the last word.

import rulesJson from "./rules/commands.json";
import type { Allowed, FoundCommand, Refused, Tier, Verdict } from "./change";

export type ScriptUse = "read" | "run" | "undo";

interface Match { starts?: string[]; has?: string[]; prefix?: string[]; contains?: string[] }
interface Outcome { says?: string; tier?: Tier; admin?: boolean; never?: string; refused?: string }
interface Form { starts?: string[]; params?: string[]; prefix?: string[]; free?: boolean }
interface Entry extends Outcome { name: string; exe?: boolean; literal?: boolean; blocks?: boolean; read?: Form[]; when?: (Match & Outcome)[] }
interface Rules {
  version: number;
  readParams: string[];
  roots: { known: string[]; unknown: string[] };
  adminText: string[];
  safeTypes: string[];
  safeMethods: string[];
  constructs: Record<string, string>;
  verbs: Record<string, Tier>;
  verbSays: string[];
  aliases: Record<string, string>;
  neverText: { says: string; applies: "any" | "change"; contains: string[] }[];
  commands: Entry[];
}

const R = rulesJson as unknown as Rules;
export const rulesVersion = R.version;
export const ruleWords = (construct: string) => R.constructs[construct];

interface Arg { kind: "switch" | "word" | "block" | "hidden"; text: string; bare?: boolean }
interface Call { name: string; args: Arg[] }
interface Find { what: string; detail: string }

class Unreadable extends Error {}

const FLOW = new Set(["if", "elseif", "else", "while", "for", "foreach", "do", "until", "try", "catch", "finally", "return", "throw", "break", "continue", "exit"]);
const BLOCKED = new Set(["function", "filter", "class", "enum", "switch", "trap", "param", "workflow", "configuration", "data", "dynamicparam", "begin", "process", "end", "using", "parallel", "sequence", "inlinescript"]);
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%="]);
const SCOPES = new Set(["env", "global", "script", "local", "private", "using"]);
const ENDS = "\n;|)}]";
// Characters PowerShell reads as quotes, dashes or spaces but that don't look like them, and control characters.
const DISGUISED = /[\u2018-\u201f\u2013-\u2015\u00a0\u0085\u1680\u2000-\u200f\u2028-\u202f\u205f\u2060\u3000\ufeff]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const NUMBER = /^(0x[\da-f]+|[\d.]+(e[+-]?\d+)?)(kb|mb|gb|tb|pb|l|d)?$/i;

function scan(src: string): { calls: Call[]; finds: Find[] } {
  const s = src.replace(/\r\n?/g, "\n"), n = s.length;
  let i = 0, depth = 0;
  const calls: Call[] = [], finds: Find[] = [];
  const bad = (detail: string): never => { throw new Unreadable(detail); };
  const find = (what: string, detail = "") => { finds.push({ what, detail }); };
  const hidden = (): Arg => ({ kind: "hidden", text: "" });
  const seen = (t: string) => {
    const low = t.toLowerCase();
    if (t.includes("\\\\") || t.startsWith("//")) find("unc", t);
    if (low.startsWith("alias:") || low.startsWith("function:")) find("provider-variable", t);
    return t;
  };
  const at = (re: RegExp) => { re.lastIndex = i; return re.exec(s); };

  function inline(): void {
    for (;;) {
      const c = s[i];
      if (c === " " || c === "\t") i++;
      else if (c === "`" && s[i + 1] === "\n") i += 2;
      else if (c === "#") while (i < n && s[i] !== "\n") i++;
      else if (c === "<" && s[i + 1] === "#") {
        const e = s.indexOf("#>", i);
        if (e < 0) bad("a comment that never ends");
        i = e + 2;
      } else return;
    }
  }
  function blank(): void {
    for (;;) {
      inline();
      if (s[i] === "\n" || s[i] === ";") i++;
      else return;
    }
  }

  function single(): string {
    let t = "";
    for (i++; ; ) {
      if (i >= n) bad("a quote that never closes");
      if (s[i] !== "'") t += s[i++];
      else if (s[i + 1] === "'") { t += "'"; i += 2; }
      else { i++; return t; }
    }
  }
  function double(): { text: string; dyn: boolean } {
    let text = "", dyn = false;
    for (i++; ; ) {
      if (i >= n) bad("a quote that never closes");
      const c = s[i];
      if (c === '"' && s[i + 1] !== '"') { i++; return { text, dyn }; }
      if (c === '"' || c === "`") { text += s[i + 1] ?? ""; i += 2; }
      else if (c === "$" && s[i + 1] === "(") { i += 2; nested(")"); dyn = true; }
      else { if (c === "$" && /[\w{]/.test(s[i + 1] ?? "")) dyn = true; text += c; i++; }
    }
  }
  function here(): Arg {
    const q = s[i + 1], start = s.indexOf("\n", i), end = start < 0 ? -1 : s.indexOf(`\n${q}@`, start);
    if (end < 0) bad("a block of text that never ends");
    const text = s.slice(start + 1, end);
    i = end + 3;
    if (q === '"' && text.includes("$(")) bad("commands inside a block of text");
    return { kind: q === '"' && text.includes("$") ? "hidden" : "word", text: seen(text) };
  }

  function word(): { text: string; plain: boolean; dyn: boolean } {
    const op = at(/[+\-*\/%]?=(?!=)/y);
    if (op) { i += op[0].length; return { text: op[0], plain: true, dyn: false }; }
    let text = "", plain = true, dyn = false;
    while (i < n) {
      const c = s[i];
      if (c === " " || c === "\t" || c === "\n" || "|;(){},<>&".includes(c)) break;
      if (c === "$" && /[\w({?$^]/.test(s[i + 1] ?? "")) break;
      if (c === "`") {
        if (s[i + 1] === "\n") break;
        plain = false; text += s[i + 1] ?? ""; i += 2;
      } else if (c === "'") { plain = false; text += single(); }
      else if (c === '"') { const q = double(); plain = false; dyn ||= q.dyn; text += q.text; }
      else { text += c; i++; }
    }
    return { text, plain, dyn };
  }

  function variable(name: string): void {
    const colon = name.indexOf(":");
    if (colon > 0 && !SCOPES.has(name.slice(0, colon).toLowerCase())) find("provider-variable", name);
  }

  function redirect(): Arg {
    const m = at(/[*\d]?>>?(&\d)?/y)!;
    i += m[0].length;
    if (!m[1]) {
      inline();
      const target = i < n && !ENDS.includes(s[i]) ? token() : null;
      if (!target) bad("a > with nothing after it");
      else if (target.text !== "$null") find("redirect", target.text);
    }
    return { kind: "word", text: ">" };
  }

  function postfix(): boolean {
    let any = false;
    for (;;) {
      const c = s[i], d = s[i + 1] ?? "";
      if (c === "[") { i++; nested("]"); }
      else if ((c === "." && d !== "." && d !== "" && !" \t\n;|)}".includes(d)) || (c === ":" && d === ":")) {
        i += c === "." ? 1 : 2;
        const name = at(/[A-Za-z_]\w*/y);
        if (name) {
          i += name[0].length;
          if (s[i] === "(") {
            if (c === ".") find("method", name[0].toLowerCase());
            i++; nested(")");
          }
        } else {
          find("dynamic-member");
          if (i < n && !" \t\n".includes(s[i]) && !ENDS.includes(s[i])) token();
        }
      } else return any;
      any = true;
    }
  }

  function token(): Arg | null {
    const c = s[i], d = s[i + 1] ?? "";
    let arg: Arg;
    if (c === ",") { i++; return null; }
    if (c === "<") bad("a < redirection");
    if (c === ">" || ((c === "*" || (c >= "0" && c <= "9")) && d === ">")) return redirect();
    if (c === "'") arg = { kind: "word", text: seen(single()) };
    else if (c === '"') { const q = double(); arg = { kind: q.dyn ? "hidden" : "word", text: seen(q.text) }; }
    else if (c === "@" && (d === "'" || d === '"')) arg = here();
    else if ((c === "@" || c === "$") && d === "(") { i += 2; nested(")"); arg = hidden(); }
    else if (c === "@" && d === "{") { i += 2; nested("}", true); arg = hidden(); }
    else if (c === "@" && /[\w$]/.test(d)) { find("splat"); i++; word(); arg = hidden(); }
    else if (c === "$" && d === "{") {
      const e = s.indexOf("}", i);
      if (e < 0) bad("a ${ that never closes");
      variable(s.slice(i + 2, e)); i = e + 1; arg = hidden();
    } else if (c === "$" && /[\w?$^]/.test(d)) {
      const name = at(/\$(?:[\w?]+(?::\w+)?|\$|\^)/y)![0].slice(1);
      i += name.length + 1;
      variable(name);
      arg = ["null", "true", "false"].includes(name.toLowerCase()) ? { kind: "word", text: `$${name.toLowerCase()}` } : hidden();
    } else if (c === "(") { i++; nested(")"); arg = hidden(); }
    else if (c === "{") { i++; nested("}"); arg = { kind: "block", text: "" }; }
    else if (c === "[") {
      let open = 0, j = i;
      for (; j < n && s[j] !== "\n"; j++) {
        if (s[j] === "[") open++;
        else if (s[j] === "]" && --open === 0) break;
      }
      if (s[j] !== "]") bad("a [ that never closes");
      find("type", s.slice(i + 1, j).replace(/[\s`]/g, "").toLowerCase());
      i = j + 1; arg = hidden();
    } else {
      const w = word();
      if (!w.text) bad(`a stray ${c}`);
      if (w.text === "--%") bad("the --% marker");
      const text = seen(w.text).toLowerCase();
      const switchLike = w.plain && /^(-[a-z]|--[a-z]|\/[a-z?])/.test(text);
      return { kind: w.dyn ? "hidden" : switchLike ? "switch" : "word", text, bare: w.plain };
    }
    return postfix() ? hidden() : arg;
  }

  function rest(call: Call | null): void {
    for (;;) {
      inline();
      if (i >= n || ENDS.includes(s[i])) return;
      if (s[i] === "&") bad("an & Rig can't place");
      const a = token();
      if (!a) continue;
      if (call) { call.args.push(a); continue; }
      if (!a.bare || a.kind !== "word") continue;
      if (ASSIGN.has(a.text) || a.text === "in" || FLOW.has(a.text)) return element(false);
      if (/^[a-z_]/.test(a.text)) find("stray", a.text);
    }
  }

  function element(hash: boolean, piped = false): void {
    inline();
    if (i >= n || ENDS.includes(s[i])) return;
    if (hash) {
      const key = at(/(?:[\w.-]+|'[^'\n]*'|"[^"\n$`]*")[ \t]*=(?!=)/y);
      if (key) { i += key[0].length; return element(false); }
    }
    let c = s[i];
    const d = s[i + 1] ?? "";
    let called = false;
    if ((c === "&" && d !== "&") || (c === "." && " \t'\"$({".includes(d))) {
      if (c === ".") find("dot-source");
      i++; inline(); c = s[i] ?? "";
      if (c === "{") return rest(null);
      if (c === "'" || c === '"') {
        const q = c === "'" ? { text: single(), dyn: false } : double();
        if (q.dyn || (i < n && !" \t".includes(s[i]) && !ENDS.includes(s[i]))) { find("dynamic"); return rest(null); }
        const call = { name: seen(q.text), args: [] };
        calls.push(call);
        return rest(call);
      }
      if (!c || "$([@".includes(c) || ENDS.includes(c)) { find("dynamic"); return rest(null); }
      called = true;
    }
    if (!called && "$[({@'\"-+!,<>*".includes(c)) return rest(null);
    const w = word();
    if (!w.text) bad(`a stray ${c}`);
    const low = w.text.toLowerCase();
    if (!called && w.plain) {
      if (NUMBER.test(low)) return rest(null);
      if (FLOW.has(low) && !(piped && low === "foreach")) return element(false);
      if (BLOCKED.has(low)) { find("keyword", low); return rest(null); }
    }
    if (!w.plain) find("obfuscated", w.text);
    if (w.dyn) find("dynamic");
    const call = { name: seen(w.text), args: [] };
    calls.push(call);
    rest(call);
  }

  function nested(close: string, hash = false): void {
    if (++depth > 40) bad("brackets nested too deep");
    for (;;) {
      blank();
      if (i >= n) {
        if (close) bad(`a missing ${close}`);
        break;
      }
      if (s[i] === close) { i++; break; }
      if (")}]".includes(s[i])) bad(`a stray ${s[i]}`);
      const start = i;
      element(hash);
      while (s[i] === "|") {
        if (s[i + 1] === "|") bad("||");
        i++; blank(); element(false, true);
      }
      if (i === start) bad(`a stray ${s[i]}`);
    }
    depth--;
  }

  nested("");
  return { calls, finds };
}

/** The form the never list and admin hints are matched against. The helper does the same; see `about` in the rules. */
function squash(text: string): string {
  return text.toLowerCase().replaceAll("hkey_local_machine", "hklm").replaceAll("hkey_current_user", "hkcu").replaceAll("/", "\\")
    .replace(/[`'"+:\s]/g, "").replace(/\\+/g, "\\");
}

/** The never-list words that fit this text, or null. Reads are only held to the entries about secrets. */
export function textOnNeverList(text: string, use: ScriptUse): string | null {
  const flat = squash(text);
  return R.neverText.find((e) => (e.applies === "any" || use !== "read") && e.contains.some((c) => flat.includes(squash(c))))?.says ?? null;
}

export function textNeedsAdmin(text: string): boolean {
  const flat = squash(text);
  return R.adminText.some((a) => flat.includes(squash(a)));
}

const texts = (args: Arg[]) => args.filter((a) => a.kind !== "block").map((a) => a.text);

function matches(m: Match, args: Arg[], strict: boolean): boolean {
  const t = texts(args), unseen = strict && args.some((a) => a.kind === "hidden");
  const shown = args.filter((a) => a.kind !== "block");
  if (m.starts && !m.starts.every((want, k) => t[k] === want || (strict && shown[k]?.kind === "hidden"))) return false;
  if (m.has && !unseen && !t.some((x) => m.has!.includes(x))) return false;
  if (m.prefix && !t.some((x) => m.prefix!.some((p) => x.startsWith(p)))) return false;
  if (m.contains && !unseen && !t.some((x) => m.contains!.some((p) => x.includes(p)))) return false;
  return true;
}

/** Null when the arguments fit the read form, else the argument that doesn't. */
function offForm(f: Form, args: Arg[]): string | null {
  const shown = args.filter((a) => a.kind !== "block"), starts = f.starts ?? [];
  for (let k = 0; k < starts.length; k++) if (shown[k]?.kind === "hidden" || shown[k]?.text !== starts[k]) return shown[k]?.text || "its arguments";
  if (f.free) return null;
  for (const a of shown.slice(starts.length)) {
    const dashed = a.kind === "switch" || ((a.text.startsWith("-") || a.text.startsWith("/")) && a.text.length > 1);
    if (!dashed) continue;
    const name = a.text.split(":")[0];
    if (!f.params?.includes(name) && !R.readParams.includes(name) && !f.prefix?.some((p) => a.text.startsWith(p))) return a.text;
  }
  return null;
}

interface Judged { found: FoundCommand; admin: boolean; stop?: { words: string; never: boolean } }

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
  const stop = (words: string, never = false): Judged => ({ found: { name, says: words, tier: 3 }, admin: false, stop: { words, never } });
  const construct = (key: string, detail = call.name) => stop(`${R.constructs[key]} (${detail}).`);
  const pass = (o: Outcome, tier: Tier): Judged => ({ found: { name, says: `${name}: ${o.says ?? entry?.says ?? ""}`, tier }, admin: use !== "read" && (o.admin ?? entry?.admin ?? false) });

  if (base.includes(".")) return construct("script-file");
  if (pathed && (raw.includes("..") || !R.roots.known.some((r) => raw.startsWith(r)))) return construct("path");
  if (!entry) {
    if (use === "read") return construct("not-read", name);
    if (pathed) return R.roots.unknown.some((r) => raw.startsWith(r)) ? { found: { name, says: `${name}: ${R.constructs["unknown-program"]}`, tier: 2 }, admin: true } : construct("unknown", name);
    const dash = base.indexOf("-"), tier = dash > 0 && !exe ? R.verbs[base.slice(0, dash)] : undefined;
    if (tier === undefined) return construct("unknown", name);
    return { found: { name, says: `${name}: ${R.verbSays[tier]}`, tier }, admin: tier >= 2 };
  }
  if (entry.blocks && call.args.some((a) => a.kind === "word" || a.kind === "hidden")) return construct("member-by-name", name);
  const rule = entry.when?.find((w) => matches(w, call.args, !!(w.never || w.refused)));
  const block = (o: Outcome) => (o.never ? stop(`Rig won't run ${name}: it ${o.never}.`, true) : o.refused ? stop(`Rig won't run ${name}: it ${o.refused}.`) : null);
  if (rule && (rule.never || rule.refused)) return block(rule)!;
  const off = entry.read ? entry.read.map((f) => offForm(f, call.args)) : ["anything"];
  const reads = off.includes(null);
  if (use === "read") {
    if (!reads) return block(entry) ?? construct("not-read", entry.read ? `${name} with ${off[off.length - 1]}` : name);
    if (entry.literal && call.args.some((a) => a.kind === "hidden")) return construct("not-literal", name);
    return pass({ says: entry.says }, 0);
  }
  if (rule) return pass(rule, rule.tier ?? 2);
  if (reads) return pass({ says: entry.says }, 0);
  return block(entry) ?? pass(entry, entry.tier ?? 2);
}

const ALWAYS = ["dynamic", "dot-source", "obfuscated", "splat", "keyword", "provider-variable", "dynamic-member", "stray", "unc"];

/** The verdict on one script. A read is tier 0 or refused; a change is tier 2 or 3 or refused. */
export function checkScript(script: string, use: ScriptUse): Verdict {
  const refuse = (refused: string, never = false, commands: FoundCommand[] = []): Refused => ({ status: "refused", refused, never, commands, rulesVersion });
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
  const never = textOnNeverList(script, use) ?? judged.find((j) => j.stop?.never)?.stop!.words;
  if (never) return refuse(never.endsWith(".") ? never : `${never}.`, true, commands);

  const reasons: string[] = [];
  for (const f of parsed.finds) {
    const fine = use !== "read" && ((f.what === "type" && R.safeTypes.includes(f.detail.replace(/^system\./, ""))) || (f.what === "method" && R.safeMethods.includes(f.detail)));
    if (fine) continue;
    if (f.what === "redirect" && use !== "read") { reasons.push(`${R.constructs.redirect}${f.detail ? ` (${f.detail})` : ""}.`); continue; }
    if (ALWAYS.includes(f.what) || f.what === "type" || f.what === "method" || f.what === "redirect") {
      const lead = use === "read" && !ALWAYS.includes(f.what) ? "Rig only looks with plain commands. " : "";
      return refuse(`${lead}${R.constructs[f.what]}${f.detail ? ` (${f.detail})` : ""}.`, false, commands);
    }
  }
  const stopped = judged.find((j) => j.stop);
  if (stopped) return refuse(stopped.stop!.words, false, commands);

  const top = Math.max(0, ...commands.map((c) => c.tier)) as Tier;
  const tier = use === "read" ? 0 : (Math.max(2, top) as Tier);
  for (const c of commands) if (c.tier === 3) reasons.push(`${c.says}. Rig can't promise to put this back.`);
  if (use !== "read" && !reasons.length) reasons.push("A general command, so it needs a second look before it runs.");
  const allowed: Allowed = { status: "allowed", tier, admin: use !== "read" && (judged.some((j) => j.admin) || textNeedsAdmin(script)), commands, reasons, rulesVersion };
  return allowed;
}
