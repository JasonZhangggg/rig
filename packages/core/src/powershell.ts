// Reads a PowerShell script well enough to find every command it runs, with
// its arguments, and the constructs Rig can't follow (types, method calls,
// redirection, dynamic names). It knows nothing about the rules; check.ts
// judges what it finds.

/** `variable`: the variable this argument names, with any scope, even when it is indexed or a member of it is used. */
export interface Arg { kind: "switch" | "word" | "block" | "hidden"; text: string; bare?: boolean; variable?: string }
/** `piped`: the command gets its input from the one before it in a pipeline. */
export interface Call { name: string; args: Arg[]; piped: boolean }
export interface Find { what: string; detail: string }

export class Unreadable extends Error {}

const FLOW = new Set(["if", "elseif", "else", "while", "for", "foreach", "do", "until", "try", "catch", "finally", "return", "throw", "break", "continue", "exit"]);
const BLOCKED = new Set(["function", "filter", "class", "enum", "switch", "trap", "param", "workflow", "configuration", "data", "dynamicparam", "begin", "process", "end", "using", "parallel", "sequence", "inlinescript"]);
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%="]);
const SCOPES = new Set(["env", "global", "script", "local", "private", "using"]);
const ENDS = "\n;|)}]";
// Characters PowerShell reads as quotes, dashes or spaces but that don't look like them, and control characters.
export const DISGUISED = /[\u2018-\u201f\u2013-\u2015\u00a0\u0085\u1680\u2000-\u200f\u2028-\u202f\u205f\u2060\u3000\ufeff]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const UNARY = new Set(["-", "+", "!", "++", "--", "-not", "-bnot", "-split", "-join"]);
const OPERATORS = new Set([...UNARY, "*", "/", "%", "..", "-is", "-isnot", "-as", "-and", "-or", "-xor", "-band", "-bor", "-bxor", "-shl", "-shr", "-f",
  ...["eq", "ne", "gt", "ge", "lt", "le", "like", "notlike", "match", "notmatch", "contains", "notcontains", "in", "notin", "replace", "split", "join"].flatMap((o) => [`-${o}`, `-c${o}`, `-i${o}`])]);
const NUMBER = /^(0x[\da-f]+|[\d.]+(e[+-]?\d+)?)(kb|mb|gb|tb|pb|l|d)?$/i;

/** Throws Unreadable when the script doesn't parse. */
export function scan(src: string): { calls: Call[]; finds: Find[] } {
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

  function provider(name: string): void {
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
    let arg: Arg, variable: string | undefined;
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
      variable = s.slice(i + 2, e);
      provider(variable); i = e + 1; arg = hidden();
    } else if (c === "$" && /[\w?$^]/.test(d)) {
      variable = at(/\$(?:[\w?]+(?::\w+)?|\$|\^)/y)![0].slice(1);
      i += variable.length + 1;
      provider(variable);
      arg = ["null", "true", "false"].includes(variable.toLowerCase()) ? { kind: "word", text: `$${variable.toLowerCase()}` } : hidden();
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
    const out = postfix() ? hidden() : arg;
    if (variable) out.variable = variable;
    return out;
  }

  function rest(call: Call | null, operand = false): void {
    const vars: string[] = [];
    let first = !operand;
    for (;;) {
      inline();
      if (i >= n || ENDS.includes(s[i])) return;
      if (s[i] === "&") bad("an & Rig can't place");
      const a = token();
      if (!a) continue;
      if (call) { call.args.push(a); continue; }
      const lead = first;
      first = false;
      if (a.variable) vars.push(a.variable);
      if (!a.bare || a.kind === "block" || a.kind === "hidden") continue;
      if (ASSIGN.has(a.text)) { for (const v of vars) find("assigns", v); return element(false); }
      if (a.text === "in" || FLOW.has(a.text)) return element(false);
      const number = NUMBER.test(a.text.replace(/^[+-]/, ""));
      if (!number && !(lead ? UNARY : OPERATORS).has(a.text)) find("stray", a.text);
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
        const call = { name: seen(q.text), args: [], piped };
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
      if (NUMBER.test(low)) return rest(null, true);
      if (FLOW.has(low) && !(piped && low === "foreach")) return element(false);
      if (BLOCKED.has(low)) { find("keyword", low); return rest(null); }
    }
    if (!w.plain) find("obfuscated", w.text);
    if (w.dyn || s[i] === "$" || (s[i] === "<" && s[i + 1] === "#")) find("dynamic", w.text);
    const call = { name: seen(w.text), args: [], piped };
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
