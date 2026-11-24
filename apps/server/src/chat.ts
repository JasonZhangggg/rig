// Rig's chat. Claude reads the PC's latest readings and settings, searches
// the part's manual when Rig has read it (and maker support pages on the web
// otherwise) when a question is about a specific part, and may propose fixes, but only from Rig's fix catalog. A
// proposal is shown to the person as a card; nothing changes until they say
// yes in the app on that PC.

import Anthropic from "@anthropic-ai/sdk";
import {
  PROBE_LIMITS, RECORD_DEFAULT_MINUTES, RECORD_MAX_MINUTES, RECORD_MIN_MINUTES, captureKinds, captures, catalog, checkProbe, checkRequest, describeCall,
  describeProbes, describeRecording, isActive, limitsOf, manualLink, probeKinds, probeMetrics, probeWhat, probeWhen, summarise, titleFor, toRequest, validateCall,
  cardTier, fixSteps, type ActionCall, type FixStep, type Tier, type Manual, type ChatEvent, type ChatRequest, type Inventory, type PC, type PCEvent, type Proposal, type Recording, type RecordingInfo,
  type ProbeStatus, type Reading, type RecordingRequest, type Source, type SystemFacts,
} from "@rig/core";
import type { PageMatch } from "./db";
import { excerpt, shortTitle } from "./manuals";

export const MODEL = "claude-opus-5-5";
const MAX_ROUNDS = 6;
const MAX_TURNS = 20;
const MAX_CHARS = 4000;

/** What the chat knows about the PC being asked about. */
export interface ChatContext {
  view: PC;
  facts: SystemFacts | null;
  inventory: Inventory | null;
  /** Windows events the PC's app last read, newest first. */
  events?: PCEvent[];
  /** The PC's recordings, newest first, without their data. */
  recordings?: RecordingInfo[];
  /** The person's time zone, so "check back at" is a time on their clock. */
  timeZone?: string;
  now?: Date;
  /** The question came from the Rig app on this PC, so a recording starts right away instead of at its next sync. */
  live?: boolean;
  /** The custom logs the PC's background recorder is keeping. Missing when the question didn't come from a PC that can keep them. */
  probes?: ProbeStatus[];
  /** Files a recording for the PC. Returns the one already waiting or running when there is one. Missing when Rig hasn't seen this PC. */
  startRecording?: (req: RecordingRequest) => Promise<{ info: RecordingInfo; created: boolean }>;
  readRecording?: (id: string) => Promise<Recording | null>;
  /** The PC's manuals, without their text. */
  manuals?: Manual[];
  /** Full-text search over the PC's read manuals, best pages first. `part` is a part key or kind. */
  searchManuals?: (query: string, part?: string) => Promise<PageMatch[]>;
}

/** The one method of the SDK client the chat uses, so tests can stand in for it. */
export interface Streamer {
  beta: { messages: { stream: Anthropic.Beta.Messages["stream"] } };
}

const SYSTEM = `You are Rig, a friendly PC helper inside the Rig app. The person owns the PC described in the next block and is asking about it.

How to answer:
- Lead with the answer in plain words. Most answers are two to five short sentences. No headings or tables. Use a short paragraph per idea, separated by a blank line.
- Use the PC's own readings and settings first. Name real numbers ("the CPU is at 88°C, its limit is 100°C").
- When the question is about a specific part (a fan header, a BIOS setting, a driver, a warranty, an error code), use the part's manual when Rig has read it (see Manuals); otherwise search the maker's support pages, read the page, and base the answer on it. Prefer the maker's own site over forums.
- If you are unsure or the readings don't show something, say so instead of guessing.

Diagnosing:
- Each issue in the PC block comes with its evidence and how sure Rig is (sure, likely or possible). Build on it, and say how sure you are in plain words. Don't turn a "possible" into a fact.
- Each part's limit in the block is that chip's own. Ryzen 7000 and 9000 chips (not X3D) and Intel's unlocked 13th and 14th gen and Core Ultra 200 chips run right up to their limit under a heavy load by design. That's only a problem at rest, or when the PC also slows down or crashes.
- Tie events to readings before naming a cause. A shutdown with no blue screen while the PC was busy but cool points at the power supply; one near a limit points at heat. A blue screen's stop code narrows it: 0x124 is a hardware error (processor, memory or an overclock), 0x1A, 0x50 and 0x3B often memory, 0x116 and 0x117 the graphics card or its driver, 0x133 and 0x9F a driver, 0x7A and 0xF4 storage.
- Updates and installs in the events (kind change) show what changed. When trouble started right after one, say so and suggest undoing it as a test. When many apps crash in the same file, that file (a graphics driver, an overlay, Windows itself) is the lead, not the apps.
- One event is not a pattern. When the readings and events don't settle it, say what each likely cause would look like and record instead of guessing.
- Rule out the cheap causes before calling a part faulty: a memory overclock (XMP or EXPO), an old BIOS or driver, dust, a loose cable.

Fixes:
- You can propose changes to this PC only with the propose_change tool, and only from its list. The person sees a card with the value now and after, and decides. Nothing changes until they approve in the app, and every change can be undone in Changes.
- Propose at most one card per answer, and only when it clearly helps with what they asked. Use the exact GUIDs, app names and display names from the PC block.
- Never say a change was made. Say what the card will do and that they can review it.
- For things outside the list (cleaning dust, BIOS settings, fan curves, drivers, reseating a part), give the steps with the show_steps tool, short and in order, and mention any risk.
- Don't help with anything that would harm the PC, void a warranty without saying so, or get around a game's anti-cheat.

Manuals:
- The PC block lists the manuals Rig has for this PC: the part each is for, its title, page count, whether it has been read (indexed) and the pages with useful diagrams.
- When a question is about a part whose manual has been read, call search_manuals first, with the words the manual would use (a header name like F_PANEL or CPU_FAN, a setting, a connector), and base the answer on the pages it returns. Say which page the answer is on, like "page 23 of your board manual", and point to a diagram page when one fits ("the board layout on page 12").
- If the pages don't answer it, say so and then search the web as usual.
- When the part has no manual yet, or it hasn't been read, answer from the maker's site as usual and mention once that they can add the manual on the part's Manual tab in My PC so Rig can quote it.

Recordings:
- The PC block holds the latest readings, recent Windows events and the list of recordings. That is often not enough for problems that happen at a moment or over time: crashes, black screens, freezes, stutter, random restarts, noise or heat that comes and goes. When you'd otherwise be guessing, call start_recording instead of guessing. Don't record when the block already answers the question, and don't start one while another is waiting or running.
- A recording only collects readings on the PC for a while. It changes nothing, so it needs no approval, and the person can stop it any time in Logs. Pick the shortest time likely to catch the problem: 15 to 30 minutes for something frequent, 60 to 120 for something rare.
- After start_recording, say in plain words what you're recording and why, that nothing on the PC changes, that they should use the PC as usual and try to make the problem happen, and the exact time to check back from the tool result. Say what you already suspect, if anything, in one sentence.
- When a recording has finished and the person asks what it found, or comes back to that problem, call read_recording and diagnose from it. Name the moments that matter with their times and readings, say what they point to and how sure you are, then what to do next (a propose_change card or show_steps when one fits). If it caught nothing, say so plainly and suggest what to try next.

Custom logs:
- When the PC block has customLogs, the PC's background recorder can keep a log of something specific for days, even while Rig is closed: any sensor, any performance counter, any Windows event log channel or XPath query, a read-only WMI query, a program's CPU and memory use, a file, a folder's size or a registry value, read on a schedule or only while a condition holds. Use add_custom_log for a problem that comes and goes over days, or that a recording's readings don't cover. It only reads, so it needs no approval; the person sees it in Logs and can turn it off in Settings.
- Read no more often than the problem needs, and for no longer: a few days is usually enough. Use a condition (like "every 2 seconds while the graphics card is above 85°C") instead of reading fast all the time.
- When nothing else can read what's needed, propose_script proposes a PowerShell or cmd script. Show what it does in plain words. It runs only after the person reads it and chooses Approve in Rig; one that runs as admin also needs Windows' own permission prompt. Never say a script is running or approved. Keep scripts short and read-only, and ask for admin only when the script can't work without it.
- Use remove_custom_log when a log has done its job or the person asks. Tell the person what you set up, what it reads and when it ends, in a sentence or two.`;

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
  {
    name: "start_recording",
    description: `Start a recording on the person's PC: for a set time the Rig app there keeps closer readings so you can diagnose a problem you can't see in the latest readings. It only reads; nothing on the PC changes. The person sees a card with a Stop button. What it can capture:\n${captureKinds.map((k) => `- ${k}: ${captures[k].label}`).join("\n")}`,
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One plain sentence for the person on what this recording is looking for, like \"Watch temperatures and Windows events while you play, to catch the black screen.\"" },
        duration_minutes: { type: "integer", minimum: RECORD_MIN_MINUTES, maximum: RECORD_MAX_MINUTES, description: `How long to record. Default ${RECORD_DEFAULT_MINUTES}.` },
        capture: { type: "array", items: { type: "string", enum: captureKinds }, description: "What to capture. Leave out to capture everything, which is usually right." },
      },
      required: ["reason", "duration_minutes"],
    },
  },
  {
    name: "read_recording",
    description: "Read what a recording caught: lowest, average and highest readings, the moments that matter in order (heat near a limit, a part flat out, crashes, driver resets, hardware errors, shutdowns, disk problems, each with the readings around it) and the busiest apps. Works on a finished recording, and on one still running for what it has so far.",
    input_schema: {
      type: "object",
      properties: { recording_id: { type: "string", description: "The recording's id from the PC block. Leave out for the latest one with data." } },
    },
  },
  {
    name: "add_custom_log",
    description: "Have the PC's background recorder keep a custom log of something specific, for up to 30 days, even while Rig is closed. It only reads. Shown to the person in Logs, labelled as asked for by Rig's chat. Only when the PC block has customLogs.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "One plain sentence for the person on what it's for, like \"GPU hot spot while you play, to catch the shutdowns.\"" },
        source: {
          type: "object",
          description: "What to read. kind and the fields for it: sensor {match: a sensor's name or id, like \"GPU Hot Spot\"}; counter {path, like \\PhysicalDisk(_Total)\\Avg. Disk sec/Transfer}; events {channel, query: an XPath query like *[System[(Level<=3)]]}; wmi {namespace, query: a WQL SELECT}; process {name, like game.exe}; file {path, read: info or tail}; folder {path}; registry {key, value}.",
          properties: {
            kind: { type: "string", enum: probeKinds.filter((k) => k !== "script") },
            match: { type: "string" }, path: { type: "string" }, channel: { type: "string" }, query: { type: "string" }, namespace: { type: "string" },
            name: { type: "string" }, read: { type: "string", enum: ["info", "tail"] }, key: { type: "string" }, value: { type: "string" },
          },
          required: ["kind"],
        },
        every_seconds: { type: "integer", minimum: 0, maximum: 86400, description: "Seconds between readings. 0 with a condition reads only while it holds. Event logs log each event and ignore this." },
        fast_seconds: { type: "integer", minimum: 1, maximum: 3600, description: "Seconds between readings while the condition holds." },
        when: {
          type: "object",
          description: "Read faster, or only, while this holds: either metric or another custom log's id, compared with a number.",
          properties: {
            metric: { type: "string", enum: probeMetrics }, probe: { type: "string" },
            op: { type: "string", enum: [">", ">=", "<", "<="] }, value: { type: "number" }, for_seconds: { type: "integer", minimum: 0, maximum: 3600 },
          },
          required: ["op", "value"],
        },
        hours: { type: "number", minimum: 1, maximum: PROBE_LIMITS.maxDays * 24, description: `How long to keep logging. Default ${PROBE_LIMITS.defaultDays * 24}. At most 24 for a log read more often than every 5 seconds.` },
      },
      required: ["label", "source"],
    },
  },
  {
    name: "remove_custom_log",
    description: "Turn off a custom log on the PC. What it wrote stays in Logs until the recorder's usual clean-up.",
    input_schema: { type: "object", properties: { log_id: { type: "string", description: "The custom log's id from the PC block." } }, required: ["log_id"] },
  },
  {
    name: "propose_script",
    description: `Propose a script for the background recorder to run on a schedule and log what it prints, when no custom log kind can read what's needed. The person sees the exact text and decides; nothing runs until they choose Approve in Rig, and a script that runs as admin also needs Windows' permission prompt. A script runs as the person's Windows account unless admin is true. At most ${PROBE_LIMITS.maxScriptChars} characters, every ${PROBE_LIMITS.minScriptEvery} seconds or more, at most ${PROBE_LIMITS.maxScriptTimeout} seconds a run.`,
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "One plain sentence on what it's for." },
        shell: { type: "string", enum: ["powershell", "cmd"] },
        text: { type: "string", description: "The whole script. Keep it short and read-only; it should print what to log." },
        admin: { type: "boolean", description: "Run as admin. Only when the script can't work without it." },
        every_seconds: { type: "integer", minimum: 0, maximum: 86400, description: "Seconds between runs. Default 300. 0 with a condition runs only while it holds." },
        fast_seconds: { type: "integer", minimum: PROBE_LIMITS.minScriptEvery, maximum: 3600 },
        timeout_seconds: { type: "integer", minimum: 1, maximum: PROBE_LIMITS.maxScriptTimeout },
        when: { type: "object", properties: { metric: { type: "string", enum: probeMetrics }, probe: { type: "string" }, op: { type: "string", enum: [">", ">=", "<", "<="] }, value: { type: "number" }, for_seconds: { type: "integer" } }, required: ["op", "value"] },
        hours: { type: "number", minimum: 1, maximum: PROBE_LIMITS.maxDays * 24 },
      },
      required: ["label", "text"],
    },
  },
  {
    name: "search_manuals",
    description: "Search the manuals Rig has read for this PC. Returns the best pages (at most 4), each with the manual's title, the page number and the page's text. Use the manual's own words: header and connector names (F_PANEL, CPU_FAN, JRGB1, M2_1), setting names, or a short plain question.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for." },
        part: { type: "string", description: "Only this part's manual: the part key or kind from the manuals list, like \"motherboard\". Leave out to search them all." },
      },
      required: ["query"],
    },
  },
  { type: "web_search_20260209", name: "web_search", max_uses: 4 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, max_content_tokens: 20000 },
];

const UNIT: Partial<Record<Reading["type"], string>> = { temperature: "°C", load: "%", fan: " RPM", power: " W", clock: " MHz", voltage: " V", level: "%", current: " A" };
const FIRST: Reading["type"][] = ["temperature", "fan", "voltage", "load", "power", "clock"];
const MAX_READINGS = 80;

/**
 * Every sensor as one short line, like "gpu: GPU Hot Spot 78°C (max 91)", most useful kinds first.
 * The parts list shows one temperature per part; a diagnosis often needs the rest (hot spot, rails, each fan).
 */
export function compactReadings(readings: readonly Reading[] | undefined): string[] | undefined {
  if (!readings?.length) return undefined;
  const rank = (r: Reading) => { const i = FIRST.indexOf(r.type); return i < 0 ? FIRST.length : i; };
  // Voltages keep two decimals: a 12 V rail at 11.4 is the point, not a rounding detail.
  const round = (v: number, type: Reading["type"]) => (type === "voltage" || Math.abs(v) < 10 ? Math.round(v * 100) / 100 : Math.round(v));
  return readings
    .filter((r) => r.value != null && UNIT[r.type] != null)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_READINGS)
    .map((r) => {
      const unit = UNIT[r.type]!;
      const max = r.max != null && r.max !== r.value ? ` (max ${round(r.max, r.type)})` : "";
      return `${r.part}: ${r.name} ${round(r.value!, r.type)}${unit}${max}`;
    });
}

/** A compact description of the PC for the model. */
export function describePC(ctx: ChatContext): string {
  const { view, facts, inventory } = ctx;
  const at = (t: number | undefined) => (t == null ? undefined : localTime(new Date(t), ctx.timeZone));
  const parts = Object.entries(view.parts ?? {}).map(([id, p]) => ({
    id, type: p.type, name: p.name, temp: p.temp, tempMax: p.tempMax, limit: p.limit, load: p.load, fan: p.fan, warn: p.warn,
    specs: p.specs, manual: p.manual, driver: p.driver,
  }));
  const data = {
    name: view.name, kind: view.kind, os: view.os, health: view.health, summary: view.summary, online: view.online, lastSync: view.lastSync,
    parts, issues: view.issues?.map(({ title, body, severity, evidence, confidence }) => ({ title, body, severity, evidence, confidence })),
    alerts: view.alerts?.map((a) => a.title), readings: compactReadings(view.readings), fans: view.fans, storage: view.storage,
    settings: facts && {
      powerPlans: facts.powerPlans, gameMode: facts.gameMode, visualEffects: facts.visualEffects,
      maxProcessorState: facts.maxProcessorState, startupApps: facts.startupApps,
    },
    hardware: inventory && {
      machine: inventory.machine, cpu: inventory.cpu, gpus: inventory.gpus, memory: inventory.memory,
      disks: inventory.disks, displays: inventory.displays, battery: inventory.battery, board: inventory.board,
    },
    now: localTime(ctx.now ?? new Date(), ctx.timeZone),
    windowsEvents: ctx.events?.slice(0, 20).map((e) => ({ at: at(e.t), kind: e.kind, source: e.source, id: e.id, level: e.level, message: e.message.slice(0, 160) })),
    manuals: ctx.manuals?.map((m) => ({ id: m.id, part: m.part, kind: m.kind, title: m.title, pageCount: m.pageCount, indexed: m.indexed, diagrams: m.diagrams.map((d) => `${d.label}, page ${d.page}`) })),
    recordings: ctx.recordings?.slice(0, 6).map((r) => ({ id: r.id, state: r.state, reason: r.reason, question: r.question || undefined, minutes: r.minutes, started: at(r.startedAt), ends: at(r.endsAt), found: r.headline, problem: r.error })),
    customLogs: ctx.probes && describeProbes(ctx.probes).map((p) => ({ ...p, ends: at(Date.parse((p as { ends: string }).ends)) })),
  };
  return `The PC (read by Rig, ${view.online ? "live" : `last seen ${view.lastSync}`}):\n${JSON.stringify(data)}`;
}

/** A time on the person's clock, like "Wed, Nov 11, 8:41 PM". Falls back to UTC when the zone is unknown. */
export function localTime(d: Date, timeZone?: string): string {
  const opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const;
  try { if (timeZone) return d.toLocaleString("en-US", { ...opts, timeZone }); } catch { /* not a zone this runtime knows */ }
  return `${d.toLocaleString("en-US", { ...opts, timeZone: "UTC" })} UTC`;
}

type ProposeInput = { title?: unknown; why?: unknown; calls?: unknown };

/** Checks a proposal against the catalog and against what's actually on this PC. */
export function checkProposal(input: ProposeInput, ctx: ChatContext): { steps: FixStep[]; tier: Tier; title: string; why: string } | string {
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
  const steps = fixSteps(calls);
  const tier = cardTier(steps);
  if (tier === "refused") return "One of these changes isn't allowed";
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 80) : titleFor(calls);
  const why = typeof input.why === "string" ? input.why.trim().slice(0, 300) : "";
  return { steps, tier, title, why };
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
  let recorded = false;
  let wrote = false;
  const added = { logs: 0, scripts: 0 };
  const now = ctx.now ?? new Date();
  const question = [...history].reverse().find((m) => m.from === "you")?.text ?? "";

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
          const rows = checked.steps.map((s) => describeCall(s.call, ctx.facts, ctx.inventory?.displays ?? []));
          const proposal: Proposal = { id: uid(), title: checked.title, why: checked.why, steps: checked.steps, tier: checked.tier, rows, status: "waiting" };
          proposed = true;
          await emit({ type: "proposal", proposal });
          results.push({ type: "tool_result", tool_use_id: u.id, content: "Shown as a card with Review and Not now. Nothing has changed yet. Finish with at most one short sentence." });
        } else if (u.name === "start_recording") {
          const fail = (content: string) => results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content });
          if (recorded) { fail("One recording per answer."); continue; }
          if (!ctx.startRecording) { fail("Rig hasn't seen this PC on the account yet, so it can't record there. Tell the person to open the Rig app on it while signed in."); continue; }
          const req = checkRequest({ reason: input.reason, minutes: input.duration_minutes, capture: input.capture, question }, { id: uid(), by: "rig", now });
          if (typeof req === "string") { fail(req); continue; }
          const { info, created } = await ctx.startRecording(req);
          if (!created) { fail(`A recording is already ${info.state === "pending" ? "waiting for the PC to pick it up" : `running${info.endsAt ? ` until ${localTime(new Date(info.endsAt), ctx.timeZone)}` : ""}`} (id ${info.id}: ${info.reason}). Don't start another; tell the person to check back when it finishes, or read what it has so far with read_recording.`); continue; }
          recorded = true;
          const queued = !ctx.live;
          await emit({ type: "recording", request: toRequest(info), queued });
          const ends = localTime(new Date(now.getTime() + req.minutes * 60_000), ctx.timeZone);
          results.push({
            type: "tool_result", tool_use_id: u.id,
            content: queued
              ? `Queued for ${req.minutes} minutes. ${ctx.view.name} ${ctx.view.online ? "starts it the next time its Rig app checks in, within about five minutes, so it ends around" : "is offline right now; it starts when the Rig app on it is next open and signed in. If it were on now, it would end around"} ${ends}. A card with the live state and a Stop button is shown. Tell the person what you're recording, that nothing changes on the PC, and when to check back.`
              : `Recording now for ${req.minutes} minutes. It ends at ${ends}. A card with a Stop button is shown. Tell the person what you're recording, that nothing changes on the PC, and to check back at that exact time.`,
          });
        } else if (u.name === "read_recording") {
          const list = ctx.recordings ?? [];
          const wanted = typeof input.recording_id === "string" ? list.find((r) => r.id === input.recording_id) : list.find((r) => r.sampleCount > 0 || r.eventCount > 0) ?? list[0];
          const rec = wanted && ctx.readRecording ? await ctx.readRecording(wanted.id) : null;
          if (!rec) { results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: list.length ? `No recording with that id. Ids: ${list.map((r) => r.id).join(", ")}` : "There are no recordings on this PC yet." }); continue; }
          if (rec.state === "pending") { results.push({ type: "tool_result", tool_use_id: u.id, content: `Recording ${rec.id} hasn't started yet: it's waiting for the Rig app on the PC to pick it up.` }); continue; }
          const limits = limitsOf(ctx.view);
          const partial = isActive(rec) ? `Still recording${rec.endsAt ? ` until ${localTime(new Date(rec.endsAt), ctx.timeZone)}` : ""}; this is what the server has so far.\n` : "";
          sources.set(`recording:${rec.id}`, { label: `Recording, ${rec.minutes} minutes`, kind: "Your PC" });
          results.push({ type: "tool_result", tool_use_id: u.id, content: partial + describeRecording(rec, summarise(rec, limits), { timeZone: ctx.timeZone, limits }) });
        } else if (u.name === "add_custom_log" || u.name === "propose_script" || u.name === "remove_custom_log") {
          const content = await customLog(u.name, input, ctx, now, added, emit);
          results.push({ type: "tool_result", tool_use_id: u.id, content, ...(content.startsWith("Error: ") ? { is_error: true } : {}) });
        } else if (u.name === "search_manuals") {
          const query = typeof input.query === "string" ? input.query.trim().slice(0, 200) : "";
          if (!query) { results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "query is required" }); continue; }
          const read = (ctx.manuals ?? []).filter((m) => m.indexed);
          if (!read.length || !ctx.searchManuals) { results.push({ type: "tool_result", tool_use_id: u.id, content: "Rig hasn't read any manuals for this PC yet. Answer from the maker's site, and mention they can add the manual on the part's Manual tab in My PC." }); continue; }
          const part = typeof input.part === "string" && read.some((m) => m.part === input.part || m.kind === input.part) ? input.part : undefined;
          const pages = await ctx.searchManuals(query, part);
          if (!pages.length) { results.push({ type: "tool_result", tool_use_id: u.id, content: `Nothing in ${part ? "that manual" : "the manuals"} matched "${query}". Try other words the manual might use, or answer from the maker's site.` }); continue; }
          for (const p of pages) {
            const url = manualLink(p.manualId, p.page);
            if (!sources.has(url)) sources.set(url, { label: `${shortTitle(p)}, page ${p.page}`, kind: "Manual", url });
          }
          results.push({ type: "tool_result", tool_use_id: u.id, content: pages.map((p) => `${p.title}, page ${p.page} (part: ${p.part}):\n${excerpt(p.text, query)}`).join("\n\n---\n\n") });
        } else {
          results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: `Unknown tool ${u.name}` });
        }
      }
      messages.push({ role: "user", content: results });
    }

    // Manual pages first: they're the person's own documents.
    const found = [...sources.values()].sort((a, b) => Number(b.kind === "Manual" && !!b.url?.startsWith("rig:")) - Number(a.kind === "Manual" && !!a.url?.startsWith("rig:")));
    const list = [{ label: `${ctx.view.name}'s readings`, kind: "Your PC" as const }, ...found.slice(0, 5)];
    await emit({ type: "sources", sources: list });
  } catch (e) {
    if (signal?.aborted) return;
    await emit({ type: "error", message: errorMessage(e) });
  }
  await emit({ type: "done" });
}

/** The custom log tools. The PC makes the change (or, for a script, shows it for approval) when the event reaches it. */
export async function customLog(
  name: "add_custom_log" | "propose_script" | "remove_custom_log", input: Record<string, unknown>, ctx: ChatContext, now: Date,
  added: { logs: number; scripts: number }, emit: (e: ChatEvent) => void | Promise<void>,
): Promise<string> {
  if (!ctx.live || !ctx.probes) return "Error: Custom logs are set up from the Rig app on the PC, with its background recorder on. Tell the person to ask there, and to turn on \"Keep a log while Rig is closed\" in Settings if it's off.";
  if (name === "remove_custom_log") {
    const id = typeof input.log_id === "string" ? input.log_id : "";
    const p = ctx.probes.find((x) => x.id === id);
    if (!p) return `Error: No custom log with that id. Ids: ${ctx.probes.map((x) => x.id).join(", ") || "none"}`;
    await emit({ type: "probe", op: "remove", id });
    return `Sent to the PC: "${p.label}" turns off. What it wrote stays in Logs.`;
  }
  const script = name === "propose_script";
  const scripts = ctx.probes.filter((p) => p.kind === "script").length + added.scripts;
  if (ctx.probes.length + added.logs + added.scripts >= PROBE_LIMITS.maxProbes) return `Error: The PC already keeps ${PROBE_LIMITS.maxProbes} custom logs, the most it can. Remove one first.`;
  if (script && scripts >= PROBE_LIMITS.maxScripts) return `Error: The PC already has ${PROBE_LIMITS.maxScripts} scripts, the most it can. Remove one first.`;
  if (script && added.scripts) return "Error: One script per answer.";
  const w = input.when as Record<string, unknown> | undefined;
  const hours = input.hours == null ? PROBE_LIMITS.defaultDays * 24 : Number(input.hours);
  const raw = {
    label: input.label,
    source: script
      ? { kind: "script", shell: input.shell ?? "powershell", text: input.text, admin: input.admin === true, timeout: input.timeout_seconds }
      : input.source,
    every: input.every_seconds, fast: input.fast_seconds,
    when: w && { metric: w.metric, probe: w.probe, op: w.op, value: w.value, forSec: w.for_seconds },
    expiresAt: Number.isFinite(hours) ? now.getTime() + Math.round(hours * 3_600_000) : NaN,
  };
  const probe = checkProbe(raw, { id: `c-${uid().slice(0, 10).toLowerCase().replace(/[^a-z0-9]/g, "0")}`, by: "chat", now: now.getTime() });
  if (typeof probe === "string") return `Error: ${probe}`;
  const ends = localTime(new Date(probe.expiresAt), ctx.timeZone);
  if (script) {
    added.scripts++;
    await emit({ type: "script", probe });
    return `Shown to the person as a card with the exact script and Approve and Not now. Nothing runs until they approve it in Rig${probe.source.kind === "script" && probe.source.admin ? ", and Windows asks them for permission because it runs as admin" : ""}. If approved it runs ${probeWhen(probe)} until ${ends}. Say what it does in a sentence and that it runs only if they approve it.`;
  }
  added.logs++;
  await emit({ type: "probe", op: "add", probe });
  return `Sent to the PC: logging ${probeWhat(probe.source)} ${probeWhen(probe)} until ${ends} (id ${probe.id}). If the PC can't, the person sees why next to this answer. Tell them in a sentence what it reads, until when, and that it's in Logs.`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return "Rig is busy right now. Try again in a minute.";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "Rig's chat isn't set up on the server yet.";
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return "Rig couldn't reach its answer service. Try again in a minute.";
  return "Rig couldn't answer that. Try again.";
}
