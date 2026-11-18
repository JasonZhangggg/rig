// The Rig API. One Worker serves the website's files and, under /api,
// accounts (Better Auth), the PCs on each account and chat.

import Anthropic from "@anthropic-ai/sdk";
import { Hono, type Context } from "hono";
import { getCookies } from "better-auth/cookies";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { checkRequest, cleanRecording, DELETE_WORD, exportFileName, rangeMs, suggestUpgrades, type ChatEvent, type DeleteAccountRequest, type ChatRequest, type HistoryPoint, type Identity, type MachineSync, type Range, type ServerConfig } from "@rig/core";
import { manualRoutes } from "./routes-manuals";
import { authOptions, desktopOrigins, makeAuth, type Auth } from "./auth";
import { answer, type ChatContext, type Streamer } from "./chat";
import { present, Store } from "./db";
import type { Env } from "./env";
import type { Fetch } from "./manuals";
import { connect, type Connection } from "./sql";

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
  // A manual's page text can be several megabytes; everything else is small.
  const tooBig = (c: C) => c.json({ message: "That upload is too big." }, 413);
  const smallBody = bodyLimit({ maxSize: 2 * 1024 * 1024, onError: tooBig });
  const pagesBody = bodyLimit({ maxSize: 8 * 1024 * 1024, onError: tooBig });
  app.use("/api/*", (c, next) => (c.req.method === "PUT" && /^\/api\/machines\/[^/]+\/manuals\/[^/]+\/pages$/.test(c.req.path) ? pagesBody : smallBody)(c, next));

  app.on(["GET", "POST"], "/api/auth/*", (c) => authFor(c).handler(c.req.raw));

  app.get("/api/config", (c) => c.json<ServerConfig>({
    google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    chat: !!c.env.ANTHROPIC_API_KEY,
  }));

  // Everything below needs an account.
  const signedIn = async (c: C, next: () => Promise<void>) => {
    const s = await authFor(c).api.getSession({ headers: c.req.raw.headers });
    if (!s) return c.json({ message: "Sign in first." }, 401);
    c.set("user", { id: s.user.id, name: s.user.name, email: s.user.email });
    c.set("store", new Store(dbFor(c)));
    await next();
  };
  for (const p of ["/api/me", "/api/me/*", "/api/machines", "/api/machines/*", "/api/chat"]) app.use(p, signedIn);

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
    const rows = await c.get("store").machines(c.get("user").id);
    return c.json(rows.map((m) => present(m, now().getTime())));
  });

  const machine = async (c: C) => {
    const id = c.req.param("id")!;
    return validId(id) ? c.get("store").machine(c.get("user").id, id) : null;
  };
  const notFound = (c: C) => c.json({ message: "That PC isn't on this account." }, 404);

  app.get("/api/machines/:id", async (c) => {
    const m = await machine(c);
    return m ? c.json(present(m, now().getTime())) : notFound(c);
  });

  app.patch("/api/machines/:id", async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const patch = cleanIdentity(body);
    if (!patch) return c.json({ message: "Name must be 1 to 40 characters, color a hex code and the clean date a date." }, 400);
    const ok = await c.get("store").rename(c.get("user").id, c.req.param("id"), patch, now());
    return ok ? c.body(null, 204) : notFound(c);
  });

  app.put("/api/machines/:id/sync", async (c) => {
    const id = c.req.param("id");
    const s = await c.req.json().catch(() => null) as MachineSync | null;
    if (!validId(id) || !isSync(s)) return c.json({ message: "That upload isn't in the shape Rig expects. Update the Rig app." }, 400);
    const reply = await c.get("store").sync(c.get("user").id, id, { ...s, view: { ...s.view, id }, identity: cleanIdentity((s.identity ?? {}) as Record<string, unknown>) ?? {} }, now());
    return c.json(reply);
  });

  app.get("/api/machines/:id/history", async (c) => {
    const range = (c.req.query("range") ?? "24h") as Range;
    if (!rangeMs[range]) return c.json({ message: "range must be 24h, 7d or 30d" }, 400);
    const m = await machine(c);
    if (!m) return notFound(c);
    return c.json(await c.get("store").history(c.get("user").id, m.id, now().getTime() - rangeMs[range]));
  });

  app.get("/api/machines/:id/changes", async (c) => { const m = await machine(c); return m ? c.json(m.changes) : notFound(c); });
  app.get("/api/machines/:id/games", async (c) => { const m = await machine(c); return m ? c.json(m.games) : notFound(c); });
  app.get("/api/machines/:id/upgrades", async (c) => {
    const m = await machine(c);
    return m ? c.json(m.inventory ? suggestUpgrades(m.inventory) : []) : notFound(c);
  });

  app.get("/api/machines/:id/events", async (c) => { const m = await machine(c); return m ? c.json(m.events) : notFound(c); });

  app.get("/api/machines/:id/recordings", async (c) => {
    const m = await machine(c);
    return m ? c.json(await c.get("store").recordings(c.get("user").id, m.id)) : notFound(c);
  });

  // Asked for on the website (or by the app for another PC): it waits for that PC's next sync.
  app.post("/api/machines/:id/recordings", async (c) => {
    const m = await machine(c);
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

  app.post("/api/chat", async (c) => {
    const body = await c.req.json().catch(() => null) as ChatRequest | null;
    const user = c.get("user");
    const store = c.get("store");
    // The database work happens before the answer streams, so the
    // connection can close while Claude is still writing.
    const problem = await (async () => {
      if (!body || typeof body.machineId !== "string" || !Array.isArray(body.messages)) return { message: "Rig couldn't read that question. Update the app and try again." };
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
        ...(row ? {
          startRecording: (req) => later((s) => s.requestRecording(user.id, row.id, req, now())),
          readRecording: (id) => later((s) => s.recording(user.id, row.id, id)),
          searchManuals: (query, part) => later((s) => s.searchManuals(user.id, row.id, query, { part, limit: 4 })),
        } : {}),
      };
      const limit = dailyLimit(c);
      if (!(await store.useChat(user.id, limit, now()))) return { message: `You've asked ${limit} questions today, which is the daily limit while Rig is free. It resets at midnight UTC.` };
      return { ctx };
    })();
    return streamSSE(c, async (stream) => {
      const send = (e: ChatEvent) => stream.writeSSE({ data: JSON.stringify(e) });
      if ("message" in problem) { await send({ type: "error", message: problem.message! }); await send({ type: "done" }); return; }
      await answer(claude(c.env), problem.ctx, body!.messages, send, c.req.raw.signal);
    });
  });

  app.all("/api/*", (c) => c.json({ message: "Not found" }, 404));
  // Anything else is the website's files.
  app.all("*", (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text("Not found", 404)));

  return app;
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
  return out;
}

function isSync(s: MachineSync | null): s is MachineSync {
  return !!s && typeof s === "object" && !!s.view && typeof s.view === "object" && !!s.inventory && !!s.facts
    && Array.isArray(s.history) && Array.isArray(s.changes) && Array.isArray(s.games)
    && s.history.every(isPoint);
}

const optional = (v: unknown, type: "number" | "string") => v == null || typeof v === type;

function isPoint(p: HistoryPoint | null): boolean {
  return !!p && typeof p.t === "number" && optional(p.fan, "number") && optional(p.game, "string");
}
