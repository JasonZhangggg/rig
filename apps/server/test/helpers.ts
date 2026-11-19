// Shared by the server tests: an app on an in-memory Postgres, accounts, a PC upload and a pretend Claude.
import { expect } from "vitest";
import { buildPC, type ChatEvent, type MachineSync } from "@rig/core";
import { SimulatedLink, fixtures } from "@rig/core/demo";
import { createApp } from "../src/app";
import type { Streamer } from "../src/chat";
import type { Env } from "../src/env";
import type { Fetch } from "../src/manuals";
import type { AuthTables, RigTables } from "../src/sql";
import { testDb } from "./pglite";

export const ORIGIN = "http://localhost:8787";

/** A pretend Claude: each round answers with the next scripted message. */
export function fakeClaude(rounds: { text?: string; tool?: { name: string; input: unknown }; stop?: string }[]) {
  const seen: { messages: unknown[]; tools: unknown[]; system?: unknown; params: Record<string, unknown> }[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        stream(params: { messages: unknown[]; tools: unknown[]; system?: unknown }) {
          seen.push({ messages: structuredClone(params.messages), tools: params.tools, system: params.system, params });
          const r = rounds[Math.min(i++, rounds.length - 1)];
          const content: unknown[] = [];
          const events: unknown[] = [];
          if (r.text) {
            content.push({ type: "text", text: r.text, citations: null });
            events.push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
            events.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: r.text } });
          }
          if (r.tool) content.push({ type: "tool_use", id: `tu_${i}`, name: r.tool.name, input: r.tool.input });
          const message = { content, stop_reason: r.stop ?? (r.tool ? "tool_use" : "end_turn") };
          return {
            async *[Symbol.asyncIterator]() { yield* events; },
            finalMessage: async () => message,
          };
        },
      },
    },
  };
  return { client: client as unknown as Streamer, seen };
}

export async function setup(env: Partial<Env> = {}, claude?: Streamer, fetch?: Fetch, wait?: (ms: number) => Promise<void>) {
  const db = await testDb<RigTables & AuthTables>();
  const e: Env = { WEB_ORIGIN: ORIGIN, BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890", ANTHROPIC_API_KEY: "test", ...env };
  const app = createApp({ claude: () => claude!, database: () => ({ db, close: async () => {} }), fetch, wait });
  const call = (path: string, init: RequestInit & { json?: unknown; cookie?: string; token?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    if (init.cookie) { headers.set("cookie", init.cookie); headers.set("origin", ORIGIN); }
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    return app.request(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body }, e);
  };
  const signUp = async (email: string) => {
    const res = await call("/api/auth/sign-up/email", { method: "POST", json: { email, password: "correct horse battery", name: email.split("@")[0] }, headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    return cookie;
  };
  return { call, signUp, env: e, db };
}

export async function syncPayload(over: Partial<MachineSync> = {}): Promise<MachineSync> {
  const link = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => Date.now() });
  const [inventory, facts, snap] = await Promise.all([link.inventory(), link.facts(), link.snapshot()]);
  const { findings: _f, ...view } = buildPC(inventory, snap, facts);
  return {
    at: new Date().toISOString(), view, inventory, facts, changes: [], games: [], identity: {},
    history: [{ t: Date.now() - 600_000, cpu: 61, gpu: 55, busy: false }, { t: Date.now(), cpu: 70, gpu: 64, busy: true }],
    ...over,
  };
}

export async function readEvents(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  return text.split("\n\n").map((f) => f.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("")).filter(Boolean).map((d) => JSON.parse(d));
}

