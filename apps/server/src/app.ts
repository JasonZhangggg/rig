// The Rig API. One Worker serves the website's files and, under /api,
// accounts (Better Auth), the PCs on each account and chat.

import Anthropic from "@anthropic-ai/sdk";
import { Hono, type Context } from "hono";
import { getCookies } from "better-auth/cookies";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { PROBE_LIMITS, checkRequest, cleanRecording, DELETE_WORD, probeKinds, type ProbeMetric, type ProbeStatus, exportFileName, rangeMs, screenLookReply, shopFor, suggestUpgrades, type ChatEvent, type DeleteAccountRequest, type PcReadResult, READ_LIMITS, type ChatRequest, type HistoryPoint, type Identity, type MachineSync, type Range, type ServerConfig, type GameRequirements, SYNC_SEND_ALL } from "@rig/core";
import { manualRoutes } from "./routes-manuals";
import { REQUIREMENTS_DAYS, REQUIREMENTS_MISS_DAYS, checkGame, findRequirements, gameKey } from "./requirements";
import { updateRoutes } from "./routes-updates";
import { authOptions, desktopOrigins, makeAuth, type Auth } from "./auth";
import { MAX_RESUMES, answer, type ChatContext, type Progress, type Streamer, type Turn } from "./chat";
import { open, sha256, sign } from "./seal";
import { present, Store, type MachinePart } from "./db";
import type { Env } from "./env";
import { bestBuyFeed, type RetailFeed } from "./retail";
import type { Fetch } from "./manuals";
import { connect, type Connection } from "./sql";
import { askAgainAt } from "./dailyReset";

type User = { id: string; name: string; email: string };
type Vars = { user: User; store: Store; conn?: Connection; auth?: Auth };
export type C = Context<{ Bindings: Env; Variables: Vars }>;
export type AppHono = Hono<{ Bindings: Env; Variables: Vars }>;

export interface AppDeps {
  /** The Claude client. Tests pass a stand-in. */
  claude?: (env: Env) => Streamer;
  /** Opens the database for one request. Tests pass an in-memory Postgres. */
  database?: (env: Env) => Connection;
  /** Fetches maker sites (manual PDFs). Tests pass a stand-in. */
  fetch?: Fetch;
  now?: () => Date;
  /** Waits between batches of shop lookups. Tests pass one that doesn't. */
  wait?: (ms: number) => Promise<void>;
}

const validId = (id: string) => /^[\w.-]{1,128}$/.test(id);

export function createApp(deps: AppDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const claude = deps.claude ?? ((env: Env) => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));
  const database = deps.database ?? connect;
  // Workers can't share a database connection between requests, so each
  // request opens its own (Hyperdrive keeps the real connections warm).
  const dbFor = (c: C) => {
    let conn = c.get("conn");
    if (!conn) { conn = database(c.env); c.set("conn", conn); }
    return conn.db;
  };
  const authFor = (c: C) => {
    let a = c.get("auth");
    if (!a) { a = makeAuth(c.env, dbFor(c)); c.set("auth", a); }
    return a;
  };

  const app: AppHono = new Hono<{ Bindings: Env; Variables: Vars }>();

  // The desktop app calls from its own origin with a bearer token. The website is same-origin.
  app.use("/api/*", cors({
    origin: (o) => (desktopOrigins.includes(o) ? o : null),
    allowHeaders: ["content-type", "authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["set-auth-token"],
    maxAge: 600,
  }));
  app.use("/api/*", async (c, next) => {
    await next();
    const conn = c.get("conn");
    if (!conn) return;
    let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try { ctx = c.executionCtx; } catch { /* no Workers context, as in tests */ }
    if (ctx) ctx.waitUntil(conn.close()); else await conn.close();
  });
  // A manual's page text can be several megabytes, and so can a chat that goes on after the PC's reads (the chat route lets
  // only those through past the small limit); everything else is small.
  const tooBig = (c: C) => c.json({ message: "That upload is too big." }, 413);
  const smallBody = bodyLimit({ maxSize: SMALL_BODY, onError: tooBig });
  const pagesBody = bodyLimit({ maxSize: 8 * 1024 * 1024, onError: tooBig });
  app.use("/api/*", (c, next) => ((c.req.method === "PUT" && /^\/api\/machines\/[^/]+\/manuals\/[^/]+\/pages$/.test(c.req.path)) || (c.req.method === "POST" && c.req.path === "/api/chat") ? pagesBody : smallBody)(c, next));

  app.on(["GET", "POST"], "/api/auth/*", (c) => authFor(c).handler(c.req.raw));

  app.get("/api/config", (c) => c.json<ServerConfig>({
    google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    chat: !!c.env.ANTHROPIC_API_KEY,
  }));

  updateRoutes(app);

  // Everything below needs an account.
  const signedIn = async (c: C, next: () => Promise<void>) => {
    const s = await authFor(c).api.getSession({ headers: c.req.raw.headers });
    if (!s) return c.json({ message: "Sign in first." }, 401);
    c.set("user", { id: s.user.id, name: s.user.name, email: s.user.email });
    c.set("store", new Store(dbFor(c)));
    await next();
  };
  for (const p of ["/api/me", "/api/me/*", "/api/machines", "/api/machines/*", "/api/games/*", "/api/chat"]) app.use(p, signedIn);

  app.get("/api/me", (c) => c.json(c.get("user")));

  app.get("/api/me/export", async (c) => {
    const out = await c.get("store").exportAccount(c.get("user").id, now());
    if (!out) return c.json({ message: "Sign in first." }, 401);
    c.header("content-disposition", `attachment; filename="${exportFileName(now())}"`);
    c.header("cache-control", "no-store");
    return c.json(out);
  });

  // Deleting the account takes every PC, all history and chat use with it. The app asks the person to type the word first.
  app.delete("/api/me", async (c) => {
    const body = await c.req.json().catch(() => null) as DeleteAccountRequest | null;
    if (body?.confirm !== DELETE_WORD) return c.json({ message: `Type ${DELETE_WORD} to confirm.` }, 400);
    await c.get("store").deleteAccount(c.get("user").id);
    const cookies = getCookies(authOptions(c.env, undefined));
    for (const { name, attributes: a } of [cookies.sessionToken, cookies.sessionData, cookies.dontRememberToken]) {
      deleteCookie(c, name, { path: a.path, domain: a.domain, secure: a.secure, httpOnly: a.httpOnly, sameSite: "Lax" });
    }
    return c.body(null, 204);
  });

  app.get("/api/machines", async (c) => {
    const rows = await c.get("store").machines(c.get("user").id, ["view", "identity"]);
    return c.json(rows.map((m) => present(m, now().getTime())));
  });

  /** The PC in the address, with only the parts of it the route uses; with none, just whether it's on this account. */
  const machine = async <P extends MachinePart = never>(c: C, parts: readonly P[] = []) => {
    const id = c.req.param("id")!;
    return validId(id) ? c.get("store").machine(c.get("user").id, id, parts) : null;
  };
  const notFound = (c: C) => c.json({ message: "That PC isn't on this account." }, 404);

  app.get("/api/machines/:id", async (c) => {
    const m = await machine(c, ["view", "identity"]);
    return m ? c.json(present(m, now().getTime())) : notFound(c);
  });

  app.patch("/api/machines/:id", async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const patch = cleanIdentity(body);
    if (!patch) return c.json({ message: "Name must be 1 to 40 characters, color a hex code, the clean date a date and picks Rig's own part ids." }, 400);
    const ok = await c.get("store").rename(c.get("user").id, c.req.param("id"), patch, now());
    return ok ? c.body(null, 204) : notFound(c);
  });

  app.put("/api/machines/:id/sync", async (c) => {
    const id = c.req.param("id");
    const s = await c.req.json().catch(() => null) as MachineSync | null;
    if (!validId(id) || !isSync(s)) return c.json({ message: "That upload isn't in the shape Rig expects. Update the Rig app." }, 400);
    const reply = await c.get("store").sync(c.get("user").id, id, { ...s, view: { ...s.view, id }, identity: cleanIdentity((s.identity ?? {}) as Record<string, unknown>) ?? {} }, now());
    // The app left out parts it sent before, but the account has no copy of this PC to keep them from: it sends them all again.
    if (!reply) return c.json({ message: "This PC isn't on the account yet. Send all of it." }, SYNC_SEND_ALL);
    return c.json(reply);
  });

  app.get("/api/machines/:id/history", async (c) => {
    const range = (c.req.query("range") ?? "24h") as Range;
    if (!rangeMs[range]) return c.json({ message: "range must be 24h, 7d or 30d" }, 400);
    const m = await machine(c);
    if (!m) return notFound(c);
    return c.json(await c.get("store").history(c.get("user").id, m.id, now().getTime() - rangeMs[range]));
  });

  app.get("/api/machines/:id/changes", async (c) => { const m = await machine(c, ["changes"]); return m ? c.json(m.changes) : notFound(c); });
  app.get("/api/machines/:id/games", async (c) => { const m = await machine(c, ["games"]); return m ? c.json(m.games) : notFound(c); });
  app.get("/api/machines/:id/upgrades", async (c) => {
    const m = await machine(c, ["inventory"]);
    return m ? c.json(m.inventory ? suggestUpgrades(m.inventory) : []) : notFound(c);
  });

  // One feed per Worker instance, so its cache is shared by every request it serves.
  let retail: { key: string; feed: RetailFeed } | null = null;
  const feedFor = (env: Env) => {
    const key = env.BESTBUY_API_KEY;
    if (!key) return null;
    if (retail?.key !== key) retail = { key, feed: bestBuyFeed(key, deps.fetch ?? ((input, init) => fetch(input, init)), deps.wait) };
    return retail.feed;
  };

  app.get("/api/machines/:id/shop", async (c) => {
    const m = await machine(c, ["inventory"]);
    if (!m) return notFound(c);
    if (!m.inventory) return c.json(null);
    const feed = feedFor(c.env);
    if (!feed) return c.json(shopFor(m.inventory));
    let got = feed.get(now());
    if (got.refresh) {
      let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
      try { ctx = c.executionCtx; } catch { /* no Workers context, as in tests */ }
      // On Workers the lookups finish after the answer; the next visit gets them.
      if (ctx) ctx.waitUntil(got.refresh); else { await got.refresh; got = feed.get(now()); }
    }
    return c.json(shopFor(m.inventory, { from: feed.from, hits: got.hits }));
  });

  app.get("/api/machines/:id/events", async (c) => { const m = await machine(c, ["events"]); return m ? c.json(m.events) : notFound(c); });

  app.get("/api/machines/:id/recordings", async (c) => {
    const m = await machine(c);
    return m ? c.json(await c.get("store").recordings(c.get("user").id, m.id)) : notFound(c);
  });

  // Asked for on the website (or by the app for another PC): it waits for that PC's next sync.
  app.post("/api/machines/:id/recordings", async (c) => {
    const m = await machine(c, ["view", "identity"]);
    if (!m) return notFound(c);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const req = checkRequest({ reason: body?.reason, minutes: body?.minutes, question: body?.question }, { id: newId(), by: "you", now: now() });
    if (typeof req === "string") return c.json({ message: req }, 400);
    const { info, created } = await c.get("store").requestRecording(c.get("user").id, m.id, req, now());
    return created ? c.json(info) : c.json({ message: `${present(m, now().getTime()).name} is already recording. Stop that one first, or wait for it to finish.` }, 409);
  });

  app.get("/api/machines/:id/recordings/:rid", async (c) => {
    const m = await machine(c);
    const r = m && validId(c.req.param("rid")) ? await c.get("store").recording(c.get("user").id, m.id, c.req.param("rid")) : null;
    return r ? c.json(r) : c.json({ message: "That recording isn't on this PC." }, 404);
  });

  // The desktop app's upload of a recording as it runs and when it finishes.
  app.put("/api/machines/:id/recordings/:rid", async (c) => {
    const m = await machine(c);
    if (!m) return notFound(c);
    const r = cleanRecording(await c.req.json().catch(() => null), m.id);
    if (!r || r.id !== c.req.param("rid")) return c.json({ message: "That recording isn't in the shape Rig expects. Update the Rig app." }, 400);
    await c.get("store").putRecording(c.get("user").id, m.id, r, now());
    return c.body(null, 204);
  });

  app.post("/api/machines/:id/recordings/:rid/stop", async (c) => {
    const m = await machine(c);
    const ok = m && validId(c.req.param("rid")) ? await c.get("store").stopRecording(c.get("user").id, m.id, c.req.param("rid"), now()) : false;
    return ok ? c.body(null, 204) : c.json({ message: "That recording isn't on this PC." }, 404);
  });

  manualRoutes(app, { validId, machine, notFound, now, claude, fetch: deps.fetch ?? ((input, init) => fetch(input, init)), dailyLimit });

  // A game's requirements, read from its store or publisher page. What was read is shared between accounts; only a
  // lookup that asks Claude counts against the day's questions.
  app.post("/api/games/requirements", async (c) => {
    const t = checkGame(await c.req.json().catch(() => null));
    if (typeof t === "string") return c.json({ message: t }, 400);
    const store = c.get("store");
    const key = gameKey(t.game);
    const cached = await store.gameRequirements(key);
    const age = (at: string | Date) => now().getTime() - new Date(at).getTime();
    if (cached && "found" in cached && age(cached.found.readAt) < REQUIREMENTS_DAYS * 864e5) return c.json({ requirements: cached.found });
    if (cached && "missedAt" in cached && age(cached.missedAt) < REQUIREMENTS_MISS_DAYS * 864e5) return c.json({ requirements: null });
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ message: "Rig can't look up games on this server yet." }, 503);
    const limit = dailyLimit(c);
    if (!(await store.useChat(c.get("user").id, limit, now()))) {
      return c.json({ message: `You've used today's ${limit} questions, and looking up a game counts as one. It resets at midnight UTC.` }, 429);
    }
    let found: GameRequirements | null;
    try {
      found = await findRequirements(claude(c.env), t.game, now(), c.req.raw.signal);
    } catch {
      return c.json({ message: "Rig couldn't look the game up just now. Try again in a minute." }, 502);
    }
    await store.saveGameRequirements(key, found, now());
    return c.json({ requirements: found });
  });

  app.post("/api/chat", async (c) => {
    const raw = await c.req.text();
    const body = (() => { try { return JSON.parse(raw) as ChatRequest; } catch { return null; } })();
    // Only a chat going on after the PC's reads may be bigger than other requests.
    if ((!body || body.resume === undefined) && new TextEncoder().encode(raw).byteLength > SMALL_BODY) return tooBig(c);
    const user = c.get("user");
    const store = c.get("store");
    // The database work happens before the answer streams, so the
    // connection can close while Claude is still writing.
    const problem = await (async () => {
      if (!body || typeof body.machineId !== "string" || !Array.isArray(body.messages) || !body.messages.every((m) => m && (m.from === "you" || m.from === "rig"))) {
        return { message: "Rig couldn't read that question. Update the app and try again." };
      }
      const chat = typeof body.chatId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(body.chatId) ? body.chatId : undefined;
      if (!c.env.ANTHROPIC_API_KEY) return { message: "Rig's chat isn't set up on the server yet." };
      const row = validId(body.machineId) ? await store.machine(user.id, body.machineId) : null;
      // The desktop sends its live readings. The website asks about the PC's last upload.
      const base: ChatContext | null = body.view
        ? { view: { ...body.view, online: true, lastSync: now().toISOString() }, facts: body.facts ?? row?.facts ?? null, inventory: row?.inventory ?? null, live: true }
        : row ? { view: present(row, now().getTime()), facts: row.facts, inventory: row.inventory } : null;
      if (!base) return { message: "Rig hasn't seen this PC yet. Open the Rig app on it while signed in, then ask again." };
      // Recording tools run while the answer streams, after this request's connection has closed, so each opens its own.
      const later = async <T>(f: (s: Store) => Promise<T>): Promise<T> => { const conn = database(c.env); try { return await f(new Store(conn.db)); } finally { await conn.close(); } };
      const ctx: ChatContext = {
        ...base, now: now(), timeZone: typeof body.tz === "string" && body.tz.length <= 64 ? body.tz : undefined,
        events: row?.events, recordings: row ? await store.recordings(user.id, row.id) : [],
        manuals: row ? await store.manuals(user.id, row.id) : [],
        ...(body.view && Array.isArray(body.probes) ? { probes: cleanProbes(body.probes) } : {}),
        ...(row ? {
          startRecording: (req) => later((s) => s.requestRecording(user.id, row.id, req, now())),
          readRecording: (id) => later((s) => s.recording(user.id, row.id, id)),
          searchManuals: (query, part) => later((s) => s.searchManuals(user.id, row.id, query, { part, limit: 4 })),
        } : {}),
        countShapes: (shapes) => later((s) => s.countShapes(shapes, now())),
      };
      const limit = dailyLimit(c);
      const overLimit = { message: `You've asked ${limit} questions today, which is the daily limit while Rig is free. You can ask again ${askAgainAt(now(), ctx.timeZone)}.` };
      // Only an app that can show and run command steps gets them, and only on the PC itself.
      if (ctx.live && body.steps === true) ctx.commandSteps = true;
      if (ctx.commandSteps && body.recipes === true) ctx.recipeSteps = true;
      // Signed notes: where an answer stopped for the PC's reads, and whether an answer read outside text.
      const secret = c.env.CHAT_STATE_SECRET;
      const pc = row?.id ?? body.machineId;
      if (secret) {
        ctx.seal = async (text, tainted, at) => sign(secret, { use: "seal", user: user.id, pc, chat: at.chat, turn: at.turn, tainted, text: await sha256(text) } satisfies SealNote);
        if (ctx.live && body.reads === true) {
          ctx.pause = (progress) => sign(secret, { use: "resume", user: user.id, pc, exp: now().getTime() + RESUME_MS, progress } satisfies ResumeNote);
        }
      }
      if (ctx.live && !ctx.pause) ctx.readsOff = !secret ? "Looking at the PC live isn't set up on Rig's server yet." : "The Rig app on this PC needs an update before Rig can look at its settings live.";

      if (body.resume !== undefined) {
        // Going on after the PC's reads. A note can be sent again, so each one counts like a question.
        const note = secret ? await open<ResumeNote>(secret, body.resume) : null;
        if (!note || note.use !== "resume" || note.user !== user.id || note.pc !== pc || typeof note.exp !== "number" || !note.progress) {
          return { message: "Rig couldn't check where this answer left off, so it stopped. Ask again." };
        }
        if (note.exp < now().getTime()) return { message: "Rig waited too long for the PC to answer, so it stopped. Ask again." };
        if (!(note.progress.resumes > 0 && note.progress.resumes <= MAX_RESUMES)) return { message: "Rig looked at the PC as often as one answer can, so it stopped. Ask again." };
        if (!(await store.useChat(user.id, limit, now()))) return overLimit;
        return { ctx, turn: { history: body.messages, resume: { progress: note.progress, results: cleanResults(body.results) } } as Turn };
      }
      const tainted = await historyTainted(secret, user.id, pc, chat, body.messages);
      if (!(await store.useChat(user.id, limit, now()))) return overLimit;
      return { ctx, turn: { history: body.messages, tainted, chat } as Turn };
    })();
    return streamSSE(c, async (stream) => {
      const send = (e: ChatEvent) => stream.writeSSE({ data: JSON.stringify(e) });
      if ("message" in problem) { await send({ type: "error", message: problem.message! }); await send({ type: "done" }); return; }
      await answer(claude(c.env), problem.ctx, problem.turn, send, c.req.raw.signal);
    });
  });

  app.all("/api/*", (c) => c.json({ message: "Not found" }, 404));
  // Anything else is the website's files. The site lives at one address; a page opened at
  // another (the old workers.dev one, or www) moves there, so sign-in cookies stay on one site.
  app.all("*", (c) => {
    const site = new URL(c.env.WEB_ORIGIN);
    const url = new URL(c.req.url);
    if (site.protocol === "https:" && url.host !== site.host) return c.redirect(`${site.origin}${url.pathname}${url.search}`, 301);
    return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text("Not found", 404);
  });

  return app;
}

/** How long the app on the PC has to send back its reads. */
const RESUME_MS = 5 * 60_000;

interface ResumeNote { use: "resume"; user: string; pc: string; exp: number; progress: Progress }
interface SealNote { use: "seal"; user: string; pc: string; chat: string; turn: number; tainted: boolean; text: string }

/** The largest request other than a chat going on after the PC's reads. */
const SMALL_BODY = 2 * 1024 * 1024;

/**
 * Whether an earlier answer in this chat read outside text. The server keeps no transcript, so each answer carries a seal it signed:
 * the answer's text, whether the chat was tainted by then, the chat's id and which question it answered. An answer of Rig's
 * without a valid seal for this account, this PC, this chat, that place and that exact text counts as tainted, so an app that
 * drops, swaps or moves seals can only make the chat stricter. With no chat id, every earlier answer counts as tainted.
 */
async function historyTainted(secret: string | undefined, user: string, pc: string, chat: string | undefined, history: ChatRequest["messages"]): Promise<boolean> {
  let turn = 0;
  for (const m of history) {
    if (m.from === "you") { turn++; continue; }
    if (typeof m.text !== "string" || !m.text.trim()) continue;
    const note = secret && chat ? await open<SealNote>(secret, m.seal) : null;
    if (!note || note.use !== "seal" || note.user !== user || note.pc !== pc || note.chat !== chat || note.turn !== turn
      || note.text !== await sha256(m.text) || note.tainted !== false) return true;
  }
  return false;
}

/** What the desktop says each read found: only the fields the chat uses, cut to size, and a look only as Rig parses one. */
function cleanResults(list: unknown): PcReadResult[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, READ_LIMITS.perRound).filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof r.id === "string").map((r) => {
    const id = (r.id as string).slice(0, 100);
    const look = r.look === undefined ? null : screenLookReply(r.look);
    return r.ok === true && typeof r.text === "string"
      ? { id, ok: true as const, text: r.text.slice(0, READ_LIMITS.resultChars), ...(look ? { look } : {}) }
      : { id, ok: false as const, error: typeof r.error === "string" ? r.error.slice(0, 500) : "The PC didn't say." };
  });
}

/** The custom logs the desktop says its recorder keeps: only what the chat needs, and no more than the recorder can hold. */
function cleanProbes(list: unknown[]): ProbeStatus[] {
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return list.slice(0, PROBE_LIMITS.maxProbes).filter((p): p is Record<string, unknown> => !!p && typeof p === "object").map((p) => {
    const w = p.when as Record<string, unknown> | undefined;
    return {
      id: str(p.id, 40), label: str(p.label, 160), kind: (probeKinds as readonly string[]).includes(p.kind as string) ? p.kind as ProbeStatus["kind"] : "sensor",
      by: p.by === "you" ? "you" : "chat", createdAt: num(p.createdAt), expiresAt: num(p.expiresAt), every: num(p.every), ...(p.fast ? { fast: num(p.fast) } : {}),
      ...(w && typeof w === "object" ? { when: { ...(typeof w.metric === "string" ? { metric: w.metric as ProbeMetric } : { probe: str(w.probe, 40) }), op: [">", ">=", "<", "<="].includes(w.op as string) ? w.op as ">" : ">", value: num(w.value), ...(w.forSec ? { forSec: num(w.forSec) } : {}) } } : {}),
      state: ["on", "paused", "error", "waiting"].includes(p.state as string) ? p.state as ProbeStatus["state"] : "on",
      ...(p.error ? { error: str(p.error, 200) } : {}), ...(p.kind === "script" ? { admin: p.admin === true } : {}),
    };
  });
}

const dailyLimit = (c: C) => Number(c.env.CHAT_DAILY_LIMIT ?? 40) || 40;

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function cleanIdentity(body: Record<string, unknown> | null): Identity | null {
  if (!body || typeof body !== "object") return null;
  const out: Identity = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 40) return null;
    out.name = body.name.trim();
  }
  if (body.accent !== undefined) {
    if (typeof body.accent !== "string" || !/^#[0-9a-f]{6}$/i.test(body.accent)) return null;
    out.accent = body.accent;
  }
  if (body.cleanedAt !== undefined) {
    if (typeof body.cleanedAt !== "string" || Number.isNaN(Date.parse(body.cleanedAt))) return null;
    out.cleanedAt = new Date(body.cleanedAt).toISOString();
  }
  // Picks are short ids from Rig's own lists ("rx6700xt-xfx-qick319", "unsure:RX 6700 XT"), one per kind of part.
  if (body.picks !== undefined) {
    const p = body.picks as Record<string, unknown> | null;
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const picks: NonNullable<Identity["picks"]> = {};
    for (const [k, v] of Object.entries(p)) {
      if (!["case", "cooler", "gpu"].includes(k) || (v != null && (typeof v !== "string" || !/^[\w:+ .-]{1,60}$/.test(v)))) return null;
      if (typeof v === "string") picks[k as keyof typeof picks] = v;
    }
    out.picks = picks;
  }
  return out;
}

function isSync(s: MachineSync | null): s is MachineSync {
  const part = (v: unknown, list: boolean) => v === undefined || (list ? Array.isArray(v) : !!v && typeof v === "object");
  return !!s && typeof s === "object" && !!s.view && typeof s.view === "object" && part(s.inventory, false) && part(s.facts, false)
    && Array.isArray(s.history) && part(s.changes, true) && part(s.games, true) && part(s.events, true)
    && s.history.every(isPoint);
}

const optional = (v: unknown, type: "number" | "string") => v == null || typeof v === type;

function isPoint(p: HistoryPoint | null): boolean {
  return !!p && typeof p.t === "number" && optional(p.fan, "number") && optional(p.game, "string")
    && ([p.cpuLoad, p.gpuLoad, p.mem, p.drive, p.board] as const).every((v) => optional(v, "number"));
}
