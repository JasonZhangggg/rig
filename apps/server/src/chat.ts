// Rig's chat. Claude reads the PC's latest readings and settings, looks up
// manuals and maker support pages on the web when a question is about a
// specific part, and may propose fixes, but only from Rig's fix catalog. A
// proposal is shown to the person as a card; nothing changes until they say
// yes in the app on that PC.

import Anthropic from "@anthropic-ai/sdk";
import {
  catalog, describeCall, titleFor, validateCall,
  type ActionCall, type ChatEvent, type ChatRequest, type Inventory, type PC, type Proposal, type Source, type SystemFacts,
} from "@rig/core";

export const MODEL = "claude-opus-5-5";
const MAX_ROUNDS = 6;
const MAX_TURNS = 20;
const MAX_CHARS = 4000;

/** What the chat knows about the PC being asked about. */
export interface ChatContext { view: PC; facts: SystemFacts | null; inventory: Inventory | null }

/** The one method of the SDK client the chat uses, so tests can stand in for it. */
export interface Streamer {
  beta: { messages: { stream: Anthropic.Beta.Messages["stream"] } };
}

const SYSTEM = `You are Rig, a friendly PC helper inside the Rig app. The person owns the PC described in the next block and is asking about it.

How to answer:
- Lead with the answer in plain words. Most answers are two to five short sentences. No headings or tables. Use a short paragraph per idea, separated by a blank line.
- Use the PC's own readings and settings first. Name real numbers ("the CPU is at 88°C, its limit is 100°C").
- When the question is about a specific part (a fan header, a BIOS setting, a driver, a warranty, an error code), search the maker's support pages or the part's manual, read the page, and base the answer on it. Prefer the maker's own site over forums.
- If you are unsure or the readings don't show something, say so instead of guessing.

Fixes:
- You can propose changes to this PC only with the propose_change tool, and only from its list. The person sees a card with the value now and after, and decides. Nothing changes until they approve in the app, and every change can be undone in Changes.
- Propose at most one card per answer, and only when it clearly helps with what they asked. Use the exact GUIDs, app names and display names from the PC block.
- Never say a change was made. Say what the card will do and that they can review it.
- For things outside the list (cleaning dust, BIOS settings, fan curves, drivers, reseating a part), give the steps with the show_steps tool, short and in order, and mention any risk.
- Don't help with anything that would harm the PC, void a warranty without saying so, or get around a game's anti-cheat.`;

const callSchema = {
  type: "object",
  description: "One change from the catalog: an object with `kind` plus that kind's fields.",
  properties: {
    kind: { type: "string", enum: catalog.map((a) => a.kind) },
    guid: { type: "string" }, name: { type: "string" }, enabled: { type: "boolean" },
    mode: { type: "string", enum: ["auto", "appearance", "performance"] },
    ac: { type: "integer" }, dc: { type: "integer" }, display: { type: "string" }, hz: { type: "integer" },
  },
  required: ["kind"],
};

const catalogText = catalog.map((a) => `- ${a.kind} (${a.title}): ${a.when} Fields: ${JSON.stringify((a.schema as { properties: object }).properties)}`).join("\n");

export const tools: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "propose_change",
    description: `Show the person a card proposing changes to their PC. They review and approve it in the Rig app; nothing changes before that. Only these kinds exist:\n${catalogText}`,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short card title, like \"Turn off 3 startup apps\"." },
        why: { type: "string", description: "One sentence on why this helps with what they asked." },
        calls: { type: "array", items: callSchema, minItems: 1, maxItems: 8 },
      },
      required: ["title", "why", "calls"],
    },
  },
  {
    name: "show_steps",
    description: "Show numbered steps for something the person does themselves (cleaning, BIOS, drivers, cables). Each step is one short sentence.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 } },
      required: ["steps"],
    },
  },
  { type: "web_search_20260209", name: "web_search", max_uses: 4 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, max_content_tokens: 20000 },
];

/** A compact description of the PC for the model. */
export function describePC({ view, facts, inventory }: ChatContext): string {
  const parts = Object.entries(view.parts ?? {}).map(([id, p]) => ({
    id, type: p.type, name: p.name, temp: p.temp, tempMax: p.tempMax, limit: p.limit, load: p.load, fan: p.fan, warn: p.warn,
    specs: p.specs, manual: p.manual, driver: p.driver,
  }));
  const data = {
    name: view.name, kind: view.kind, os: view.os, health: view.health, summary: view.summary, online: view.online, lastSync: view.lastSync,
    parts, issues: view.issues?.map(({ title, body, severity }) => ({ title, body, severity })), fans: view.fans, storage: view.storage,
    settings: facts && {
      powerPlans: facts.powerPlans, gameMode: facts.gameMode, visualEffects: facts.visualEffects,
      maxProcessorState: facts.maxProcessorState, startupApps: facts.startupApps,
    },
    hardware: inventory && {
      machine: inventory.machine, cpu: inventory.cpu, gpus: inventory.gpus, memory: inventory.memory,
      disks: inventory.disks, displays: inventory.displays, battery: inventory.battery, board: inventory.board,
    },
  };
  return `The PC (read by Rig, ${view.online ? "live" : `last seen ${view.lastSync}`}):\n${JSON.stringify(data)}`;
}

type ProposeInput = { title?: unknown; why?: unknown; calls?: unknown };

/** Checks a proposal against the catalog and against what's actually on this PC. */
export function checkProposal(input: ProposeInput, ctx: ChatContext): { calls: ActionCall[]; title: string; why: string } | string {
  if (!Array.isArray(input.calls) || input.calls.length === 0) return "calls must be a non-empty array";
  const calls: ActionCall[] = [];
  for (const raw of input.calls) {
    // Keep only the fields that belong to the kind.
    const info = catalog.find((a) => a.kind === (raw as { kind?: string })?.kind);
    if (!info) return `Unknown change: ${String((raw as { kind?: string })?.kind)}`;
    const keys = Object.keys((info.schema as { properties: object }).properties);
    const call = Object.fromEntries(Object.entries(raw as object).filter(([k]) => k === "kind" || keys.includes(k)));
    const err = validateCall(call);
    if (err) return `${info.kind}: ${err}`;
    calls.push(call as ActionCall);
  }
  const f = ctx.facts;
  const displays = ctx.inventory?.displays ?? [];
  for (const c of calls) {
    if (c.kind === "power.plan" && f && !f.powerPlans.some((p) => p.guid.toLowerCase() === c.guid.toLowerCase())) return `No power plan with GUID ${c.guid} on this PC`;
    if (c.kind === "startup.app" && f && !f.startupApps.some((a) => a.name === c.name)) return `No startup app named "${c.name}" on this PC`;
    if (c.kind === "display.refreshRate") {
      const d = displays.find((x) => x.name === c.display);
      if (!d) return `No display named "${c.display}" on this PC`;
      if (d.maxRefreshHz && c.hz > d.maxRefreshHz) return `${c.display} goes up to ${d.maxRefreshHz} Hz`;
    }
  }
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 80) : titleFor(calls);
  const why = typeof input.why === "string" ? input.why.trim().slice(0, 300) : "";
  return { calls, title, why };
}

/** Turns the app's chat history into API messages: alternating, starting and ending with the person. */
export function toMessages(history: ChatRequest["messages"]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history.slice(-MAX_TURNS)) {
    const text = (m.text ?? "").trim().slice(0, MAX_CHARS);
    if (!text) continue;
    const role = m.from === "you" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last?.role === role) last.content = `${last.content as string}\n\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  while (out.length && out[out.length - 1].role !== "user") out.pop();
  return out;
}

function sourceKind(url: string, title: string): Source["kind"] {
  if (/\.pdf($|\?)/i.test(url) || /manual|user guide|datasheet/i.test(title)) return "Manual";
  if (/support|driver|download|kb|faq/i.test(url)) return "Maker";
  return "Web";
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Runs one answer, streaming events to the app. Never throws: problems become an error event. */
export async function answer(client: Streamer, ctx: ChatContext, history: ChatRequest["messages"], emit: (e: ChatEvent) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
  const messages = toMessages(history);
  if (!messages.length) { await emit({ type: "error", message: "Ask a question first." }); await emit({ type: "done" }); return; }

  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: SYSTEM }, { type: "text", text: describePC(ctx) }];
  const sources = new Map<string, Source>();
  let proposed = false;
  let wrote = false;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        output_config: { effort: "medium" },
        system,
        tools,
        messages,
        // If the model declines, the API answers with a fallback model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }, { signal });

      for await (const ev of stream) {
        if (ev.type === "content_block_start" && ev.content_block.type === "text" && wrote) await emit({ type: "text", text: "\n\n" });
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          wrote = true;
          await emit({ type: "text", text: ev.delta.text });
        }
      }
      let msg: Anthropic.Beta.BetaMessage;
      try { msg = await stream.finalMessage(); } catch (e) {
        if (e instanceof Anthropic.APIError) throw e;
        continue; // a tool input that couldn't be parsed, or a dropped connection: ask again
      }

      for (const b of msg.content) {
        if (b.type === "text") for (const c of b.citations ?? []) {
          if (c.type === "web_search_result_location" && c.url && !sources.has(c.url)) sources.set(c.url, { label: c.title ?? new URL(c.url).hostname, kind: sourceKind(c.url, c.title ?? ""), url: c.url });
        }
        if (b.type === "web_fetch_tool_result" && b.content.type === "web_fetch_result") {
          const url = b.content.url;
          const title = (b.content.content as { title?: string | null }).title ?? new URL(url).hostname;
          if (!sources.has(url)) sources.set(url, { label: title, kind: sourceKind(url, title), url });
        }
      }

      if (msg.stop_reason === "refusal") {
        await emit({ type: "error", message: "Rig can't help with that one." });
        break;
      }
      if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || uses.length === 0) break;

      messages.push({ role: "assistant", content: msg.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const input = (u.input ?? {}) as Record<string, unknown>;
        if (u.name === "show_steps") {
          const steps = Array.isArray(input.steps) ? input.steps.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, 10) : [];
          if (!steps.length) { results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "steps must be a list of short sentences" }); continue; }
          await emit({ type: "steps", steps });
          results.push({ type: "tool_result", tool_use_id: u.id, content: "Shown to the person as a numbered list. Don't repeat the steps in text." });
        } else if (u.name === "propose_change") {
          if (proposed) { results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "Only one card per answer. Mention the other idea in words." }); continue; }
          const checked = checkProposal(input, ctx);
          if (typeof checked === "string") { results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: checked }); continue; }
          const rows = checked.calls.map((c) => describeCall(c, ctx.facts, ctx.inventory?.displays ?? []));
          const proposal: Proposal = { id: uid(), title: checked.title, why: checked.why, calls: checked.calls, rows, status: "waiting" };
          proposed = true;
          await emit({ type: "proposal", proposal });
          results.push({ type: "tool_result", tool_use_id: u.id, content: "Shown as a card with Review and Not now. Nothing has changed yet. Finish with at most one short sentence." });
        } else {
          results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: `Unknown tool ${u.name}` });
        }
      }
      messages.push({ role: "user", content: results });
    }

    const list = [{ label: `${ctx.view.name}'s readings`, kind: "Your PC" as const }, ...[...sources.values()].slice(0, 5)];
    await emit({ type: "sources", sources: list });
  } catch (e) {
    if (signal?.aborted) return;
    await emit({ type: "error", message: errorMessage(e) });
  }
  await emit({ type: "done" });
}

export function errorMessage(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return "Rig is busy right now. Try again in a minute.";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "Rig's chat isn't set up on the server yet.";
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return "Rig couldn't reach its answer service. Try again in a minute.";
  return "Rig couldn't answer that. Try again.";
}
