// The Rig API. One Worker serves the website's files and, under /api,
// accounts (Better Auth), the PCs on each account and chat.

import Anthropic from "@anthropic-ai/sdk";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { suggestUpgrades, type ChatEvent, type ChatRequest, type HistoryPoint, type Identity, type MachineSync, type Range, type ServerConfig } from "@rig/core";
import { desktopOrigins, makeAuth, type Auth } from "./auth";
import { answer, type ChatContext, type Streamer } from "./chat";
import { present, Store } from "./db";
import type { Env } from "./env";
import { connect, type Connection } from "./sql";

type User = { id: string; name: string; email: string };
type Vars = { user: User; store: Store; conn?: Connection; auth?: Auth };
type C = Context<{ Bindings: Env; Variables: Vars }>;

export interface AppDeps {
  /** The Claude client. Tests pass a stand-in. */
  claude?: (env: Env) => Streamer;
  /** Opens the database for one request. Tests pass an in-memory Postgres. */
  database?: (env: Env) => Connection;
  now?: () => Date;
}

const rangeMs: Record<Range, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };
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

  const app = new Hono<{ Bindings: Env; Variables: Vars }>();

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
  app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ message: "That upload is too big." }, 413) }));

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
  for (const p of ["/api/me", "/api/machines", "/api/machines/*", "/api/chat"]) app.use(p, signedIn);

  app.get("/api/me", (c) => c.json(c.get("user")));

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
      const ctx: ChatContext | null = body.view
        ? { view: { ...body.view, online: true, lastSync: now().toISOString() }, facts: body.facts ?? row?.facts ?? null, inventory: row?.inventory ?? null }
        : row ? { view: present(row, now().getTime()), facts: row.facts, inventory: row.inventory } : null;
      if (!ctx) return { message: "Rig hasn't seen this PC yet. Open the Rig app on it while signed in, then ask again." };
      const limit = Number(c.env.CHAT_DAILY_LIMIT ?? 40) || 40;
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
