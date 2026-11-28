// A game's minimum and recommended requirements, read from the game's own store page or its publisher's site. Claude
// looks with web search and fetch and reports the lines with one report_requirements call; Rig keeps a report only
// when its page is one Claude read in this lookup and every line, and every number, is on that page as written.
// Comparing them with a PC is Rig's own code (packages/core/src/canItRun.ts), never the model's.

import Anthropic from "@anthropic-ai/sdk";
import type { GameRequirements, SpecLevel } from "@rig/core";
import { MODEL, type Streamer } from "./chat";

/** Found requirements are read again after this long, since games change them. */
export const REQUIREMENTS_DAYS = 30;
/** Rig looks again for a game it couldn't find after this long. */
export const REQUIREMENTS_MISS_DAYS = 7;
const MAX_ROUNDS = 5;
const MAX_NAME = 100;

/** The name as typed, checked: plain text of a sensible length. */
export function checkGame(raw: unknown): string | { game: string } {
  const game = typeof raw === "object" && raw && typeof (raw as { game?: unknown }).game === "string" ? (raw as { game: string }).game.replace(/\s+/g, " ").trim() : "";
  if (game.length < 2 || game.length > MAX_NAME) return "Type the game's name.";
  if (/[\u0000-\u001f<>]/.test(game)) return "Type the game's name as plain text.";
  return { game };
}

/** The cache key: the name in lower case with only letters and digits, so "Counter-Strike 2" and "counter strike 2" share one. */
export const gameKey = (game: string) => game.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

const FINDER = `You find a PC game's system requirements for Rig, a PC helper app. Rig compares them with the person's PC in its own code, so copy them exactly.

- Read the requirements on the game's own store page (Steam, the Epic Games Store, GOG, the Microsoft Store, EA, Ubisoft or Battle.net) or the publisher's or developer's own site. Not on a site that rates PCs or copies requirements from elsewhere. Fetch the page with web_fetch: Rig checks every line against the page you fetched.
- If a store page only shows an age check or doesn't list the requirements, try the publisher's own page for the game, or the store's news post where the publisher announced them.
- Use the Windows requirements of the game itself (not a demo, an expansion or a bundle), for the newest version on PC.
- Copy each line word for word as the page shows it: os, cpu and gpu are the text after "OS:", "Processor:" and "Graphics:". Leave a line out when the page doesn't give it. Never fill one in or guess.
- memoryGb, vramGb and storageGb are the numbers the page gives in GB. vramGb only when the page asks for video memory separately. ssd only when the page asks for an SSD.
- Call report_requirements exactly once: found true with the game's name as the page gives it, the page's address and the minimum and recommended lines, or found false if you can't find them. If Rig says something doesn't match the page, fix it and report again.`;

const levelSchema = {
  type: "object",
  properties: {
    os: { type: "string" }, cpu: { type: "string" }, gpu: { type: "string" },
    memoryGb: { type: "number" }, vramGb: { type: "number" }, storageGb: { type: "number" }, ssd: { type: "boolean" },
  },
};

const reportTool: Anthropic.Beta.BetaToolUnion = {
  name: "report_requirements",
  description: "Report the game's requirements as the page you fetched lists them, or that you couldn't find them. Call it exactly once.",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean" },
      game: { type: "string", description: "The game's name as the page gives it." },
      url: { type: "string", description: "The https address of the page you fetched the requirements from." },
      minimum: { ...levelSchema, description: "The minimum requirements." },
      recommended: { ...levelSchema, description: "The recommended requirements, when the page lists them." },
    },
    required: ["found"],
  },
};

const finderTools: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 4 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, max_content_tokens: 20000 },
  reportTool,
];

/** Text as it compares with a page: lower case, without trademark marks, one space between words. */
const flat = (s: string) => s.toLowerCase().replace(/\((tm|r)\)|[®™*_`]/g, " ").replace(/\s+/g, " ").trim();

const sourceLabel = (host: string): string => {
  const h = host.replace(/^www\./, "");
  if (h === "store.steampowered.com") return "Steam store page";
  if (h.endsWith("epicgames.com")) return "Epic Games Store page";
  if (h === "gog.com" || h.endsWith(".gog.com")) return "GOG store page";
  if (h.endsWith("xbox.com") || h === "apps.microsoft.com") return "Microsoft Store page";
  return h;
};

/** Checks one level against the page's text. A string says what doesn't match. */
function checkLevel(raw: unknown, name: string, page: string): SpecLevel | string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object") return `${name} must be an object.`;
  const r = raw as Record<string, unknown>;
  const out: SpecLevel = {};
  for (const k of ["os", "cpu", "gpu"] as const) {
    const v = r[k];
    if (v == null || v === "") continue;
    if (typeof v !== "string" || v.length > 300) return `${name}.${k} must be the page's line, as text.`;
    if (!page.includes(flat(v))) return `${name}.${k} ("${v.slice(0, 80)}") isn't on the page as written. Copy the line word for word, or leave it out.`;
    out[k] = v.trim();
  }
  for (const k of ["memoryGb", "vramGb", "storageGb"] as const) {
    const v = r[k];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 2000) return `${name}.${k} must be a number of GB.`;
    const n = String(v).replace(/\.0+$/, "");
    if (!new RegExp(`(^|[^0-9.])${n.replace(".", "\\.")} ?gb`).test(page)) return `${name}.${k} (${v} GB) isn't on the page. Give the number the page gives, or leave it out.`;
    out[k] = v;
  }
  if (r.ssd === true) {
    if (!/\bssd\b|solid.state/.test(page)) return `${name}.ssd: the page doesn't ask for an SSD.`;
    out.ssd = true;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Asks Claude for the game's requirements and keeps them only when they're on a page it fetched. Null when nothing
 * valid was found. Throws only when the API itself fails, so a miss isn't cached for an outage.
 */
export async function findRequirements(client: Streamer, game: string, now: Date, signal?: AbortSignal): Promise<GameRequirements | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `Game: ${game}` }];
  // Every page fetched in this lookup, by address, as text to check lines against.
  const pages = new Map<string, string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      system: FINDER,
      tools: finderTools,
      messages,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }, { signal });
    for await (const _ of stream) { /* nothing streams to the person; wait for the whole message */ }
    let msg: Anthropic.Beta.BetaMessage;
    try { msg = await stream.finalMessage(); } catch (e) {
      if (e instanceof Anthropic.APIError) throw e;
      continue;
    }

    for (const b of msg.content) {
      if (b.type === "web_fetch_tool_result" && b.content.type === "web_fetch_result") {
        const doc = b.content.content as { source?: { type?: string; data?: string } };
        if (doc.source?.type === "text" && typeof doc.source.data === "string") pages.set(b.content.url, flat(doc.source.data));
      }
    }

    if (msg.stop_reason === "refusal") return null;
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || uses.length === 0) return null;

    messages.push({ role: "assistant", content: msg.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const fail = (content: string) => results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content });
      if (u.name !== "report_requirements") { fail(`Unknown tool ${u.name}`); continue; }
      const input = (u.input ?? {}) as Record<string, unknown>;
      if (typeof input.found !== "boolean") { fail("found must be true or false."); continue; }
      if (!input.found) return null;
      const url = typeof input.url === "string" ? input.url.trim() : "";
      const page = pages.get(url);
      if (!/^https:\/\//.test(url) || page === undefined) { fail("url must be the address of a page you fetched with web_fetch in this lookup. Fetch the page, then report again."); continue; }
      const minimum = checkLevel(input.minimum, "minimum", page);
      if (typeof minimum === "string") { fail(minimum); continue; }
      const recommended = checkLevel(input.recommended, "recommended", page);
      if (typeof recommended === "string") { fail(recommended); continue; }
      if (!minimum && !recommended) { fail("Give the minimum or the recommended lines from the page, or report found false."); continue; }
      const name = typeof input.game === "string" && input.game.trim() && input.game.length <= MAX_NAME ? input.game.trim() : game;
      return { game: name, ...(minimum ? { minimum } : {}), ...(recommended ? { recommended } : {}), source: { url, label: sourceLabel(new URL(url).hostname) }, readAt: now.toISOString() };
    }
    messages.push({ role: "user", content: results });
  }
  return null;
}
