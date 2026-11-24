// Reads a PowerShell script well enough to find every command it runs, with
// its arguments, and the constructs Rig can't follow (types, method calls,
// redirection, dynamic names). It knows nothing about the rules; check.ts
// judges what it finds.

/**
 * `variable`: the variable this argument names, with any scope, even when it is indexed or a member of it is used.
 * `param`: set when the argument is a PowerShell parameter (`-Name`, or `-Name:` with its value joined on); the name, folded.
 * `member`: a member of it was used (`.Name`, `::Name`). `redirect`: the `>` that stands where a redirection was.
 */
export interface Arg { kind: "switch" | "word" | "block" | "hidden"; text: string; bare?: boolean; variable?: string; param?: string; member?: boolean; redirect?: boolean }
/** `piped`: the command gets its input from the one before it in a pipeline. */
export interface Call { name: string; args: Arg[]; piped: boolean }
/** `hidden`: for a redirect, the target is worked out while the script runs. */
export interface Find { what: string; detail: string; hidden?: boolean }

/** ASCII-only lower case, as the helper does it. Letters outside ASCII that fold into ASCII are refused before this runs. */
export const fold = (text: string) => text.replace(/[A-Z]+/g, (m) => m.toLowerCase());

export class Unreadable extends Error {}

const FLOW = new Set(["if", "elseif", "else", "while", "for", "foreach", "do", "until", "try", "catch", "finally", "return", "throw", "break", "continue", "exit"]);
const BLOCKED = new Set(["function", "filter", "class", "enum", "switch", "trap", "param", "workflow", "configuration", "data", "dynamicparam", "begin", "process", "end", "using", "parallel", "sequence", "inlinescript"]);
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%="]);
const SCOPES = new Set(["env", "global", "script", "local", "private", "using"]);
const ENDS = "\n;|)}]";
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
  const find = (what: string, detail = "", hide?: boolean) => { finds.push(hide ? { what, detail, hidden: true } : { what, detail }); };
  const hidden = (): Arg => ({ kind: "hidden", text: "" });
  const seen = (t: string) => {
    const low = fold(t), slashed = low.replaceAll("/", "\\");
    // A web address's scheme (two letters or more, not file:) may be followed by //; any other \\ or // reaches for another computer.
    if (slashed.replace(/[a-z][a-z0-9+.-]+:\\\\/g, (m) => (m.startsWith("file:") ? m : "")).includes("\\\\")) find("unc", t);
    if (/(^|\\)(alias|function|variable):/.test(low)) find("provider", t);
    if (/[a-z0-9]~\d/.test(low)) find("short-name", t);
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

  function word(): { text: string; plain: boolean; dyn: boolean; param?: string } {
    const op = at(/[+\-*\/%]?=(?!=)/y);
    if (op) { i += op[0].length; return { text: op[0], plain: true, dyn: false }; }
    let text = "", plain = true, dyn = false, param: string | undefined;
    // A parameter is - and a name, then a colon or the end of the word; a value may follow the colon.
    const p = at(/-[A-Za-z_][\w-]*(:?)/y);
    if (p && (p[1] || i + p[0].length >= n || " \t\n;|)}".includes(s[i + p[0].length]))) {
      param = fold(p[0].replace(/:$/, ""));
      text = p[0]; i += p[0].length;
    }
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
    return { text, plain, dyn, param };
  }

  function provider(name: string): void {
    const colon = name.indexOf(":");
    if (colon > 0 && !SCOPES.has(fold(name.slice(0, colon)))) find("provider-variable", name);
  }

  function redirect(): Arg {
    const m = at(/[*\d]?>>?(&\d)?/y)!;
    i += m[0].length;
    if (!m[1]) {
      inline();
      const target = i < n && !ENDS.includes(s[i]) ? token() : null;
      if (!target) bad("a > with nothing after it");
      else if (target.text !== "$null") find("redirect", target.text, target.kind === "hidden");
    }
    return { kind: "word", text: ">", redirect: true };
  }

  /** One `.Name` or `::Name` after something, with its call when there is one. */
  function member(statik: boolean, type?: string): void {
    const name = at(/[A-Za-z_]\w*/y);
    if (!name) {
      find("dynamic-member");
      if (i < n && !" \t\n".includes(s[i]) && !ENDS.includes(s[i])) token();
      return;
    }
    i += name[0].length;
    const low = fold(name[0]);
    if (type !== undefined) find("static", `${type}${statik ? "::" : "."}${low}`);
    else if (statik) find("static-variable", low);
    if (s[i] === "(") {
      if (type === undefined) find("method", low);
      i++; nested(")");
    }
  }

  function postfix(): { any: boolean; member: boolean } {
    let any = false, used = false;
    for (;;) {
      const c = s[i], d = s[i + 1] ?? "";
      if (c === "[") { i++; nested("]"); }
      else if ((c === "." && d !== "." && d !== "" && !" \t\n;|)}".includes(d)) || (c === ":" && d === ":")) {
        i += c === "." ? 1 : 2;
        member(c === ":");
        used = true;
      } else return { any, member: used };
      any = true;
    }
  }

  function token(): Arg | null {
    const c = s[i], d = s[i + 1] ?? "";
    let arg: Arg, variable: string | undefined, statik = false;
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
      find("variable", fold(variable));
    } else if (c === "$" && /[\w?$^]/.test(d)) {
      variable = at(/\$(?:[\w?]+(?::\w+)?|\$|\^)/y)![0].slice(1);
      i += variable.length + 1;
      provider(variable);
      find("variable", fold(variable));
      arg = ["null", "true", "false"].includes(fold(variable)) ? { kind: "word", text: `$${fold(variable)}` } : hidden();
    } else if (c === "(") { i++; nested(")"); arg = hidden(); }
    else if (c === "{") { i++; nested("}"); arg = { kind: "block", text: "" }; }
    else if (c === "[") {
      let open = 0, j = i;
      for (; j < n && s[j] !== "\n"; j++) {
        if (s[j] === "[") open++;
        else if (s[j] === "]" && --open === 0) break;
      }
      if (s[j] !== "]") bad("a [ that never closes");
      const type = fold(s.slice(i + 1, j).replace(/[\s`]/g, "")).replace(/^system\./, "");
      i = j + 1; arg = hidden();
      // A member of a type literal ([math]::Round, [int].Assembly) is a static use, judged by its own list.
      const sep = s[i] === ":" && s[i + 1] === ":" ? 2 : s[i] === "." && /[A-Za-z_]/.test(s[i + 1] ?? "") ? 1 : 0;
      if (sep) { i += sep; member(sep === 2, type); statik = true; }
      else find("type", type);
    } else {
      const w = word();
      if (!w.text) bad(`a stray ${c}`);
      if (w.text === "--%") bad("the --% marker");
      const text = fold(seen(w.text));
      const switchLike = w.plain && /^(-[a-z]|--[a-z]|\/[a-z?])/.test(text);
      const out: Arg = { kind: w.dyn ? "hidden" : switchLike ? "switch" : "word", text, bare: w.plain };
      if (w.param) out.param = w.param;
      return out;
    }
    const post = postfix();
    const out = post.any || statik ? hidden() : arg;
    if (variable) out.variable = variable;
    if (post.member || statik) out.member = true;
    return out;
  }

  function rest(call: Call | null, operand = false): void {
    const vars: string[] = [];
    let first = !operand, members = 0, prev: Arg | null = null;
    for (;;) {
      inline();
      if (i >= n || ENDS.includes(s[i])) return;
      if (s[i] === "&") bad("an & Rig can't place");
      const a = token();
      if (!a) continue;
      if (call) { call.args.push(a); continue; }
      const lead = first, before = prev;
      first = false; prev = a;
      if (a.variable) vars.push(a.variable);
      // Setting a member (`$x.Prop = 1`, `$x.Count++`, `++$x.Count`) changes the object, so it is never a read.
      if (a.member) {
        members++;
        if (before?.bare && (before.text === "++" || before.text === "--")) find("member-assign", a.variable ? `$${a.variable}` : "");
      }
      if (!a.bare || a.kind === "block" || a.kind === "hidden") continue;
      if ((a.text === "++" || a.text === "--") && before?.member) find("member-assign", before.variable ? `$${before.variable}` : "");
      if (ASSIGN.has(a.text)) {
        if (members) find("member-assign");
        for (const v of vars) find("assigns", v);
        return element(false);
      }
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
    const low = fold(w.text);
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
