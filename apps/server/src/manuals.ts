// Manuals on the server: checking what the app sends, which maker sites a
// manual may come from, downloading a maker's PDF safely, and the finder,
// which asks Claude (with web search) for the official manual's address.
//
// A found address is trusted only when it's https, on the maker's own domain
// (the table below) and starts with %PDF. The address is never one that came
// in a request: it comes from Claude through these checks, or from the
// database, and is checked again before every download.

import Anthropic from "@anthropic-ai/sdk";
import {
  MANUAL_MAX_BYTES, MANUAL_MAX_PAGES, MANUAL_PAGE_CHARS, manualKinds,
  type DiagramKind, type ManualDiagram, type ManualKind, type ManualPage, type ManualTarget,
} from "@rig/core";
import { MODEL, type Streamer } from "./chat";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// ----- Makers and their sites -----

/** Each maker's names, as people and Windows write them, and the domains its manuals live on (subdomains count). */
const makers: { names: string[]; domains: string[] }[] = [
  { names: ["asus", "asustek", "rog", "republicofgamers", "tuf"], domains: ["asus.com"] },
  { names: ["msi", "microstar"], domains: ["msi.com"] },
  { names: ["gigabyte", "aorus"], domains: ["gigabyte.com"] },
  { names: ["asrock"], domains: ["asrock.com"] },
  { names: ["nzxt"], domains: ["nzxt.com"] },
  { names: ["corsair"], domains: ["corsair.com"] },
  { names: ["lianli"], domains: ["lian-li.com"] },
  { names: ["fractal", "fractaldesign"], domains: ["fractal-design.com"] },
  { names: ["bequiet"], domains: ["bequiet.com"] },
  { names: ["coolermaster"], domains: ["coolermaster.com"] },
  { names: ["seasonic", "seasonicelectronics"], domains: ["seasonic.com"] },
  { names: ["evga"], domains: ["evga.com"] },
  { names: ["thermaltake"], domains: ["thermaltake.com"] },
  { names: ["noctua"], domains: ["noctua.at"] },
  { names: ["arctic"], domains: ["arctic.de"] },
  { names: ["deepcool"], domains: ["deepcool.com"] },
  { names: ["phanteks"], domains: ["phanteks.com"] },
  { names: ["dell", "alienware"], domains: ["dell.com"] },
  { names: ["hp", "hewlettpackard", "hpinc", "omen"], domains: ["hp.com"] },
  { names: ["lenovo"], domains: ["lenovo.com"] },
  { names: ["acer", "predator"], domains: ["acer.com"] },
  { names: ["razer"], domains: ["razer.com"] },
  { names: ["samsung"], domains: ["samsung.com"] },
  { names: ["lg"], domains: ["lg.com"] },
  { names: ["benq"], domains: ["benq.com"] },
  { names: ["nvidia"], domains: ["nvidia.com"] },
  { names: ["amd", "advancedmicrodevices"], domains: ["amd.com"] },
  { names: ["intel"], domains: ["intel.com"] },
  { names: ["zotac"], domains: ["zotac.com"] },
  { names: ["sapphire", "sapphiretechnology"], domains: ["sapphiretech.com"] },
  { names: ["xfx"], domains: ["xfxforce.com"] },
  { names: ["powercolor", "tul"], domains: ["powercolor.com"] },
  { names: ["pny"], domains: ["pny.com"] },
  { names: ["kingston", "hyperx"], domains: ["kingston.com"] },
  { names: ["gskill"], domains: ["gskill.com"] },
  { names: ["crucial", "micron"], domains: ["crucial.com"] },
  { names: ["westerndigital", "wd", "wdc"], domains: ["westerndigital.com", "wdc.com"] },
  { names: ["seagate"], domains: ["seagate.com"] },
  { names: ["microsoft", "surface"], domains: ["microsoft.com"] },
  { names: ["framework", "frameworkcomputer"], domains: ["frame.work"] },
];

/** Words in a company's name that say what kind of company it is, not which one. */
const companyWords = /\b(inc|incorporated|co|corp|corporation|company|ltd|limited|llc|gmbh|ag|sa|plc|computer|computers|technology|technologies|tech|international|electronics|group|holdings)\b\.?/g;

/** "ASUSTeK COMPUTER INC." -> "asustek", "be quiet!" -> "bequiet", "Micro-Star International Co., Ltd." -> "microstar". */
export function makerKey(maker: string): string {
  const plain = maker.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(companyWords, " ");
  const key = plain.replace(/[^\p{L}\p{N}]/gu, "");
  return key || maker.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** The domains a known maker's manuals live on, or null for a maker Rig doesn't know. */
export function makerDomains(maker: string): string[] | null {
  const key = makerKey(maker);
  return makers.find((m) => m.names.includes(key))?.domains ?? null;
}

/** Second-level names under a country code, so "foo.com.tw" counts as one site, not "com.tw". */
const countrySecondLevel = new Set(["co", "com", "net", "org", "ac", "gov", "edu", "ne", "or"]);

/** The part of a host name a company registers: "download.foo.com" -> "foo.com", "www.foo.com.tw" -> "foo.com.tw". */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  const n = labels.length;
  if (n >= 3 && labels[n - 1].length === 2 && countrySecondLevel.has(labels[n - 2])) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** Whether a host name is on the maker's own site. */
export function makerHost(maker: string, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes(".") || /^[\d.]+$/.test(h)) return false;
  const domains = makerDomains(maker);
  if (domains) return domains.some((d) => h === d || h.endsWith(`.${d}`));
  // A maker Rig doesn't know: the site's own name has to contain the maker's.
  const name = makerKey(maker);
  if (name.length < 3) return false;
  const site = registrableDomain(h).split(".")[0].replace(/[^a-z0-9]/g, "");
  return site.includes(name);
}

/** Why an address can't be used for this maker, or null when it can. */
export function addressProblem(maker: string, address: string): string | null {
  let u: URL;
  try { u = new URL(address); } catch { return "That isn't a web address."; }
  if (u.protocol !== "https:") return "The address has to start with https.";
  if (u.username || u.password || u.port) return "The address has a user name, password or port in it.";
  if (!makerHost(maker, u.hostname)) {
    const domains = makerDomains(maker);
    return `${u.hostname} isn't ${maker}'s own site${domains ? ` (${domains.join(" or ")})` : ""}.`;
  }
  return null;
}

// ----- Downloading a maker's PDF -----

const MAX_REDIRECTS = 4;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

export type PdfOpen =
  | { ok: true; url: string; host: string; bytes?: number; head: Uint8Array; rest: ReadableStreamDefaultReader<Uint8Array> }
  | { ok: false; reason: string; tooBig?: boolean };

/**
 * Opens a manual's PDF on the maker's site: checks the address (and each
 * redirect) against the maker, refuses one bigger than MANUAL_MAX_BYTES by
 * its content-length, and reads the first bytes to make sure it's a PDF.
 * The caller reads the rest from `rest`, or cancels it.
 */
export async function openPdf(fetchFn: Fetch, maker: string, address: string, signal?: AbortSignal): Promise<PdfOpen> {
  let url = address;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = addressProblem(maker, url);
    if (problem) return { ok: false, reason: problem };
    let res: Response;
    try {
      res = await fetchFn(url, { redirect: "manual", headers: { accept: "application/pdf" }, signal });
    } catch {
      return { ok: false, reason: `${new URL(url).hostname} didn't answer.` };
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url).href;
      continue;
    }
    if (!res.ok || !res.body) { await res.body?.cancel(); return { ok: false, reason: `${new URL(url).hostname} answered with error ${res.status}.` }; }
    const length = Number(res.headers.get("content-length"));
    const bytes = Number.isFinite(length) && length > 0 ? length : undefined;
    if (bytes && bytes > MANUAL_MAX_BYTES) { await res.body.cancel(); return { ok: false, reason: "The file is bigger than Rig downloads.", tooBig: true }; }

    const rest = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let have = 0;
    while (have < PDF_MAGIC.length) {
      const { value, done } = await rest.read();
      if (done) break;
      chunks.push(value);
      have += value.length;
    }
    const head = concat(chunks, have);
    if (!PDF_MAGIC.every((b, i) => head[i] === b)) { await rest.cancel(); return { ok: false, reason: "That address isn't a PDF file." }; }
    return { ok: true, url, host: new URL(url).hostname.toLowerCase(), bytes, head, rest };
  }
  return { ok: false, reason: "The address redirected too many times." };
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** The rest of an opened PDF as a stream, which stops with an error past MANUAL_MAX_BYTES. */
export function pdfStream(open: Extract<PdfOpen, { ok: true }>): ReadableStream<Uint8Array> {
  let sent = 0;
  let first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = first ? { value: open.head, done: false } : await open.rest.read();
      first = false;
      if (done) { controller.close(); return; }
      sent += value.length;
      if (sent > MANUAL_MAX_BYTES) {
        await open.rest.cancel();
        controller.error(new Error("The manual is bigger than Rig downloads."));
        return;
      }
      controller.enqueue(value);
    },
    async cancel() { await open.rest.cancel(); },
  });
}

// ----- What the app sends -----

const kinds = new Set<string>(manualKinds.map((k) => k.kind));

export const diagramLabels: Record<DiagramKind, string> = {
  "board-layout": "Board layout",
  "front-panel": "Front panel header",
  "fan-headers": "Fan headers",
  "memory-slots": "Memory slot order",
  "m2-slots": "M.2 slots",
  "rear-io": "Back panel ports",
  "power-connectors": "Power connectors",
  "rgb-headers": "RGB headers",
  "usb-headers": "USB headers",
  "dimensions": "Size and measurements",
  "installation": "Installation",
  "specs": "Specifications",
};

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A part to find or add a manual for, cleaned, or what's wrong with it. */
export function checkTarget(input: unknown): ManualTarget | string {
  const t = (input ?? {}) as Record<string, unknown>;
  if (typeof t.part !== "string" || !/^[\w.:-]{1,64}$/.test(t.part)) return "part must be the part's key, like \"motherboard\" or \"extra:case\".";
  if (typeof t.kind !== "string" || !kinds.has(t.kind)) return `kind must be one of: ${[...kinds].join(", ")}.`;
  const maker = clip(t.maker, 60);
  const model = clip(t.model, 120);
  if (!maker || !model) return "Rig needs the maker and the exact model.";
  if (t.source !== "detected" && t.source !== "added") return "source must be detected or added.";
  return { part: t.part, kind: t.kind as ManualKind, maker, model, source: t.source };
}

/** "kind|maker|model", the same for every way of writing the same maker and model. */
export function sourceKey(t: Pick<ManualTarget, "kind" | "maker" | "model">): string {
  const maker = makerKey(t.maker);
  const known = makers.find((m) => m.names.includes(maker));
  return `${t.kind}|${known ? known.names[0] : maker}|${t.model.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

/** The pages and diagrams of a PUT pages body, cut to size, or what's wrong with them. */
export function checkPages(input: unknown): { pages: ManualPage[]; diagrams: ManualDiagram[]; pageCount: number } | string {
  const b = (input ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.pages)) return "pages must be a list of { n, text }.";
  if (b.diagrams !== undefined && !Array.isArray(b.diagrams)) return "diagrams must be a list.";
  const byPage = new Map<number, string>();
  let pageCount = 0;
  for (const p of b.pages as unknown[]) {
    const { n, text } = (p ?? {}) as Record<string, unknown>;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 100_000 || typeof text !== "string") return "Each page needs a page number (n, from 1) and its text.";
    pageCount = Math.max(pageCount, n);
    if (n > MANUAL_MAX_PAGES) continue;
    // Postgres text can't hold a NUL; PDFs' text sometimes has them.
    const clean = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").trim().slice(0, MANUAL_PAGE_CHARS);
    if (clean) byPage.set(n, clean);
  }
  const pages = [...byPage].sort((a, b) => a[0] - b[0]).map(([n, text]) => ({ n, text }));
  const diagrams: ManualDiagram[] = [];
  const seen = new Set<string>();
  for (const d of ((b.diagrams ?? []) as unknown[]).slice(0, 300)) {
    const { page, kind, label } = (d ?? {}) as Record<string, unknown>;
    if (typeof kind !== "string" || !(kind in diagramLabels)) return `Each diagram's kind must be one of: ${Object.keys(diagramLabels).join(", ")}.`;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > pageCount) return `Each diagram needs a page number from 1 to ${pageCount}.`;
    const key = `${page}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagrams.push({ page, kind: kind as DiagramKind, label: clip(label, 80) || diagramLabels[kind as DiagramKind] });
  }
  diagrams.sort((a, b) => a.page - b.page);
  return { pages, diagrams, pageCount };
}

/** "ROG STRIX B650-A GAMING WIFI manual": short enough for a source chip. */
export function shortTitle(m: { model: string; title: string }): string {
  const base = m.model.length > 34 ? `${m.model.slice(0, 33).trimEnd()}…` : m.model;
  return `${base} manual`;
}

/** Cuts a ts_headline snippet to about 200 characters at a word, keeping « and » paired. */
export function trimSnippet(s: string, max = 220): string {
  const out = s.replace(/\s+/g, " ").trim();
  if (out.length <= max) return out;
  const space = out.lastIndexOf(" ", max);
  const cut = out.slice(0, space > max / 2 ? space : max);
  const open = cut.lastIndexOf("«") > cut.lastIndexOf("»");
  return `${cut}${open ? "»" : ""}…`;
}

/** About `max` characters of a page around the first word of the question it contains. */
export function excerpt(text: string, query: string, max = 1500): string {
  if (text.length <= max) return text;
  const lower = text.toLowerCase();
  const words = query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length > 2);
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), text.length - max));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + max)}${start + max < text.length ? "…" : ""}`;
}

// ----- The finder -----

/** Rig looks again for a manual it couldn't find after this long. */
export const MISS_DAYS = 7;
const MAX_ROUNDS = 5;

export interface Found { url: string; title: string; host: string; bytes?: number }

const FINDER = `You find manuals for Rig, a PC helper app. Find the official English user manual PDF for the exact model you're given, on the maker's own website.

- Prefer the full user manual over a quick start guide, a spec sheet or a brochure. For a motherboard or a laptop, that's the one with the board layout and the connectors.
- The model has to match exactly, including suffixes like WIFI, II, Plus or the revision. A manual that covers a family of models is fine if this model is listed.
- Give the direct address of the PDF file itself (it usually ends in .pdf), not a download or support page. It has to be https and on the maker's own domain. Don't guess or build addresses; use one you saw.
- Call report_manual exactly once: found true with the address and the manual's title, or found false if you can't find it. If Rig says an address doesn't work, you may try another one.`;

const reportTool: Anthropic.Beta.BetaToolUnion = {
  name: "report_manual",
  description: "Report the manual you found, or that you couldn't find one. Call it exactly once.",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "Whether you found the official manual PDF." },
      url: { type: "string", description: "The direct https address of the PDF on the maker's site." },
      title: { type: "string", description: "The manual's title, like \"ROG STRIX B650-A GAMING WIFI user manual\"." },
    },
    required: ["found"],
  },
};

const finderTools: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 10000 },
  reportTool,
];

/**
 * Asks Claude for the maker's manual, then checks the address it gives: on
 * the maker's site, and a PDF. Null when nothing valid was found. Throws only
 * when the API itself fails, so a miss isn't cached for an outage.
 */
export async function findManualAddress(client: Streamer, fetchFn: Fetch, t: ManualTarget, signal?: AbortSignal): Promise<Found | null> {
  const label = manualKinds.find((k) => k.kind === t.kind)?.label ?? t.kind;
  const domains = makerDomains(t.maker);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{
    role: "user",
    content: `Part: ${label}\nMaker: ${t.maker}\nModel: ${t.model}\n${domains ? `The maker's site: ${domains.join(" or ")} (subdomains count)` : "Use the maker's own site."}`,
  }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      system: FINDER,
      tools: finderTools,
      messages,
      // If the model declines, the API answers with a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }, { signal });
    for await (const _ of stream) { /* nothing streams to the person; wait for the whole message */ }
    let msg: Anthropic.Beta.BetaMessage;
    try { msg = await stream.finalMessage(); } catch (e) {
      if (e instanceof Anthropic.APIError) throw e;
      continue; // a tool input that couldn't be parsed, or a dropped connection: ask again
    }

    if (msg.stop_reason === "refusal") return null;
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || uses.length === 0) return null;

    messages.push({ role: "assistant", content: msg.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const fail = (content: string) => results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content });
      if (u.name !== "report_manual") { fail(`Unknown tool ${u.name}`); continue; }
      const input = (u.input ?? {}) as Record<string, unknown>;
      if (typeof input.found !== "boolean") { fail("found must be true or false."); continue; }
      if (!input.found) return null;
      if (typeof input.url !== "string" || input.url.length > 2048) { fail("url must be the PDF's address."); continue; }
      const open = await openPdf(fetchFn, t.maker, input.url.trim(), AbortSignal.timeout(20_000));
      if (!open.ok) { fail(`Rig can't use that address: ${open.reason} Find the PDF on ${t.maker}'s own site, or report found false.`); continue; }
      await open.rest.cancel();
      const title = clip(input.title, 160) || `${t.maker} ${t.model} user manual`;
      return { url: open.url, title, host: open.host, bytes: open.bytes };
    }
    messages.push({ role: "user", content: results });
  }
  return null;
}
