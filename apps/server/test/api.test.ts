import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPC, desktopClientId, type ChatEvent, type MachineSync, type Recording, type RecordingInfo, type SyncReply } from "@rig/core";
import { SimulatedLink, demoEvents, demoRecording, fixtures } from "@rig/core/demo";
import { createApp } from "../src/app";
import type { Streamer } from "../src/chat";
import type { Env } from "../src/env";
import type { RigTables } from "../src/sql";
import { testDb } from "./pglite";

const ORIGIN = "http://localhost:8787";

/** A pretend Claude: each round answers with the next scripted message. */
function fakeClaude(rounds: { text?: string; tool?: { name: string; input: unknown }; stop?: string }[]) {
  const seen: { messages: unknown[]; tools: unknown[]; system?: unknown }[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        stream(params: { messages: unknown[]; tools: unknown[]; system?: unknown }) {
          seen.push({ messages: structuredClone(params.messages), tools: params.tools, system: params.system });
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

async function setup(env: Partial<Env> = {}, claude?: Streamer) {
  const db = await testDb<RigTables>();
  const e: Env = { WEB_ORIGIN: ORIGIN, BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-1234567890", ANTHROPIC_API_KEY: "test", ...env };
  const app = createApp({ claude: () => claude!, database: () => ({ db, close: async () => {} }) });
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
  return { call, signUp, env: e };
}

async function syncPayload(over: Partial<MachineSync> = {}): Promise<MachineSync> {
  const link = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => Date.now() });
  const [inventory, facts, snap] = await Promise.all([link.inventory(), link.facts(), link.snapshot()]);
  const { findings: _f, ...view } = buildPC(inventory, snap, facts);
  return {
    at: new Date().toISOString(), view, inventory, facts, changes: [], games: [], identity: {},
    history: [{ t: Date.now() - 600_000, cpu: 61, gpu: 55, busy: false }, { t: Date.now(), cpu: 70, gpu: 64, busy: true }],
    ...over,
  };
}

async function readEvents(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  return text.split("\n\n").map((f) => f.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("")).filter(Boolean).map((d) => JSON.parse(d));
}

afterEach(() => { vi.useRealTimers(); });

describe("accounts", () => {
  it("signs up on the website and reads the account", async () => {
    const { call, signUp } = await setup();
    const cookie = await signUp("jo@example.com");
    const me = await call("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "jo@example.com", name: "jo" });
    expect((await call("/api/me")).status).toBe(401);
  });

  it("signs the desktop app in with a code approved on the website", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { call, signUp } = await setup();
    const cookie = await signUp("sam@example.com");

    expect((await call("/api/auth/device/code", { method: "POST", json: { client_id: "someone-else" } })).status).toBe(400);
    const start = await (await call("/api/auth/device/code", { method: "POST", json: { client_id: desktopClientId } })).json() as Record<string, string>;
    expect(start.verification_uri_complete).toBe(`${ORIGIN}/app/?user_code=${start.user_code}`);

    const poll = () => call("/api/auth/device/token", { method: "POST", json: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code, client_id: desktopClientId } });
    expect((await (await poll()).json() as { error: string }).error).toBe("authorization_pending");

    expect((await call(`/api/auth/device?user_code=${start.user_code}`, { cookie })).status).toBe(200);
    const ok = await call("/api/auth/device/approve", { method: "POST", json: { userCode: start.user_code }, cookie });
    expect(ok.status).toBe(200);

    vi.setSystemTime(Date.now() + 6000);
    const done = await poll();
    const body = await done.json() as { access_token: string; token_type: string };
    expect(done.status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    const me = await (await call("/api/me", { token: body.access_token })).json() as { email: string };
    expect(me.email).toBe("sam@example.com");
  });

  it("lets the desktop app call from its own origin", async () => {
    const { call } = await setup();
    const res = await call("/api/me", { method: "OPTIONS", headers: { origin: "http://tauri.localhost", "access-control-request-method": "GET" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
    const other = await call("/api/me", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("PCs", () => {
  it("shows an uploaded PC on the website, with history, and keeps it private", async () => {
    const { call, signUp } = await setup();
    const cookie = await signUp("ana@example.com");
    const s = await syncPayload();
    const id = s.inventory.machine.id;

    expect((await call(`/api/machines/${id}/sync`, { method: "PUT", json: { nope: 1 }, cookie })).status).toBe(400);
    expect((await call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie })).status).toBe(200);

    const list = await (await call("/api/machines", { cookie })).json() as { id: string; online: boolean; name: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, online: true });

    const hist = await (await call(`/api/machines/${id}/history?range=24h`, { cookie })).json() as unknown[];
    expect(hist).toHaveLength(2);
    expect((await call(`/api/machines/${id}/history?range=1y`, { cookie })).status).toBe(400);
    const ups = await (await call(`/api/machines/${id}/upgrades`, { cookie })).json() as unknown[];
    expect(Array.isArray(ups)).toBe(true);

    const other = await signUp("eve@example.com");
    expect((await call(`/api/machines/${id}`, { cookie: other })).status).toBe(404);
    expect(await (await call("/api/machines", { cookie: other })).json()).toEqual([]);
  });

  it("keeps fan speed and game per point, and still takes points from older apps", async () => {
    const { call, signUp } = await setup();
    const cookie = await signUp("kit@example.com");
    const t = Date.now();
    const s = await syncPayload({
      history: [
        { t: t - 1_200_000, cpu: 48, gpu: 40, busy: false },
        { t: t - 600_000, cpu: 66, gpu: 79, busy: true, fan: 2140, game: "Cyberpunk 2077" },
        { t, cpu: 52, gpu: 44, busy: false, fan: null, game: null },
      ],
    });
    const id = s.inventory.machine.id;
    expect((await call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie })).status).toBe(200);

    const hist = await (await call(`/api/machines/${id}/history?range=24h`, { cookie })).json();
    expect(hist).toEqual([
      { t: t - 1_200_000, cpu: 48, gpu: 40, busy: false, fan: null, game: null },
      { t: t - 600_000, cpu: 66, gpu: 79, busy: true, fan: 2140, game: "Cyberpunk 2077" },
      { t, cpu: 52, gpu: 44, busy: false, fan: null, game: null },
    ]);

    const resent = await syncPayload({ history: [{ t: t - 600_000, cpu: 66, gpu: 79, busy: true, fan: 2300, game: "Balatro" }] });
    await call(`/api/machines/${id}/sync`, { method: "PUT", json: resent, cookie });
    const again = await (await call(`/api/machines/${id}/history?range=24h`, { cookie })).json() as { fan: number; game: string }[];
    expect(again[1]).toMatchObject({ fan: 2300, game: "Balatro" });

    const bad = await syncPayload({ history: [{ t, cpu: 50, gpu: 40, busy: false, fan: "fast" as unknown as number }] });
    expect((await call(`/api/machines/${id}/sync`, { method: "PUT", json: bad, cookie })).status).toBe(400);
  });

  it("keeps the newest name, whether it was changed on the website or the PC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { call, signUp } = await setup();
    const cookie = await signUp("lee@example.com");
    const s = await syncPayload({ identity: { name: "Desk" }, identityAt: new Date(Date.now() - 60_000).toISOString() });
    const id = s.inventory.machine.id;
    await call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie });

    expect((await call(`/api/machines/${id}`, { method: "PATCH", json: { name: "" }, cookie })).status).toBe(400);
    expect((await call(`/api/machines/${id}`, { method: "PATCH", json: { name: "Big Box", accent: "#ea5a72" }, cookie })).status).toBe(204);

    // The PC still has its older name: the website's wins and comes back in the reply.
    const reply = await (await call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie })).json() as { identity: { name: string } };
    expect(reply.identity.name).toBe("Big Box");
    expect((await (await call(`/api/machines/${id}`, { cookie })).json() as { name: string }).name).toBe("Big Box");

    // Renamed on the PC afterwards: the PC's wins.
    vi.setSystemTime(Date.now() + 60_000);
    const newer = { ...s, identity: { name: "Studio" }, identityAt: new Date().toISOString() };
    const r2 = await (await call(`/api/machines/${id}/sync`, { method: "PUT", json: newer, cookie })).json() as { identity: { name: string } };
    expect(r2.identity.name).toBe("Studio");
  });

  it("marks a PC offline when it hasn't synced for a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { call, signUp } = await setup();
    const cookie = await signUp("kim@example.com");
    const s = await syncPayload();
    await call(`/api/machines/${s.inventory.machine.id}/sync`, { method: "PUT", json: s, cookie });
    vi.setSystemTime(Date.now() + 30 * 60_000);
    const [pc] = await (await call("/api/machines", { cookie })).json() as { online: boolean }[];
    expect(pc.online).toBe(false);
  });
});

describe("chat", () => {
  async function chatSetup(rounds: Parameters<typeof fakeClaude>[0], env: Partial<Env> = {}) {
    const fake = fakeClaude(rounds);
    const t = await setup(env, fake.client);
    const cookie = await t.signUp("max@example.com");
    const s = await syncPayload();
    await t.call(`/api/machines/${s.inventory.machine.id}/sync`, { method: "PUT", json: s, cookie });
    const ask = (q: string) => t.call("/api/chat", { method: "POST", json: { machineId: s.inventory.machine.id, messages: [{ from: "you", text: q }] }, cookie });
    return { ...t, ...fake, cookie, s, ask };
  }

  it("streams an answer with a checked fix proposal", async () => {
    const { s, ask, seen } = await chatSetup([
      { text: "Game Mode is off.", tool: { name: "propose_change", input: { title: "Turn on Game Mode", why: "Fewer stutters.", calls: [{ kind: "windows.gameMode", enabled: true, extra: "dropped" }] } } },
      { text: "Review the card to turn it on." },
    ]);
    const events = await readEvents(await ask("Why does my game stutter?"));
    const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe("Game Mode is off.\n\nReview the card to turn it on.");
    const p = events.find((e) => e.type === "proposal") as Extract<ChatEvent, { type: "proposal" }>;
    expect(p.proposal.calls).toEqual([{ kind: "windows.gameMode", enabled: true }]);
    expect(p.proposal.rows[0]).toEqual(["Game Mode", s.facts.gameMode ? "On" : "Off", "On"]);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "sources")).toBe(true);
    // The model was told what the PC is and got the result of its tool call.
    expect(JSON.stringify(seen[1].messages)).toContain("Nothing has changed yet");
  });

  it("sends a proposal for something not on this PC back to the model", async () => {
    const { ask, seen } = await chatSetup([
      { tool: { name: "propose_change", input: { title: "x", why: "y", calls: [{ kind: "startup.app", name: "Not A Real App", enabled: false }] } } },
      { tool: { name: "propose_change", input: { title: "x", why: "y", calls: [{ kind: "format.disk" }] } } },
      { text: "Okay." },
    ]);
    const events = await readEvents(await ask("Speed up startup"));
    expect(events.some((e) => e.type === "proposal")).toBe(false);
    expect(JSON.stringify(seen[1].messages)).toContain("No startup app named");
    expect(JSON.stringify(seen[2].messages)).toContain("Unknown change");
  });

  it("shows steps for things the person does themselves", async () => {
    const { ask } = await chatSetup([{ tool: { name: "show_steps", input: { steps: ["Shut down.", "Blow out the dust."] } } }, { text: "That's it." }]);
    const events = await readEvents(await ask("How do I clean it?"));
    expect(events.find((e) => e.type === "steps")).toEqual({ type: "steps", steps: ["Shut down.", "Blow out the dust."] });
  });

  it("says when chat isn't set up, and holds to the daily allowance", async () => {
    const off = await chatSetup([{ text: "hi" }], { ANTHROPIC_API_KEY: undefined });
    expect((await readEvents(await off.ask("hi")))[0]).toMatchObject({ type: "error", message: expect.stringContaining("isn't set up") });

    const on = await chatSetup([{ text: "hi" }], { CHAT_DAILY_LIMIT: "2" });
    await readEvents(await on.ask("1"));
    await readEvents(await on.ask("2"));
    const third = await readEvents(await on.ask("3"));
    expect(third[0]).toMatchObject({ type: "error", message: expect.stringContaining("daily limit") });
  });

  it("refuses a PC that isn't on the account", async () => {
    const { call, cookie } = await chatSetup([{ text: "hi" }]);
    const res = await call("/api/chat", { method: "POST", json: { machineId: "someone-elses-pc", messages: [{ from: "you", text: "hi" }] }, cookie });
    expect((await readEvents(res))[0]).toMatchObject({ type: "error", message: expect.stringContaining("hasn't seen this PC") });
  });
});

describe("recordings and Windows events", () => {
  const NOW = new Date(2026, 10, 17, 21, 0).getTime();
  const demo = () => demoRecording(fixtures.atlas.inv, NOW);

  async function pcSetup(rounds: Parameters<typeof fakeClaude>[0] = [{ text: "ok" }]) {
    const fake = fakeClaude(rounds);
    const t = await setup({}, fake.client);
    const cookie = await t.signUp("ada@example.com");
    const s = await syncPayload();
    const id = s.inventory.machine.id;
    const sync = async (extra: Partial<MachineSync> = {}) => (await t.call(`/api/machines/${id}/sync`, { method: "PUT", json: { ...s, history: [], ...extra }, cookie })).json() as Promise<SyncReply>;
    await sync();
    const base = `/api/machines/${id}/recordings`;
    const list = async () => (await t.call(base, { cookie })).json() as Promise<RecordingInfo[]>;
    return { ...t, ...fake, cookie, s, id, sync, base, list };
  }

  it("holds a request made on the web until the PC picks it up, then follows it to the end", async () => {
    const { call, cookie, base, sync, list } = await pcSetup();
    const made = await call(base, { method: "POST", json: { reason: "Catch the black screen", minutes: 45 }, cookie });
    expect(made.status).toBe(200);
    const info = await made.json() as RecordingInfo;
    expect(info).toMatchObject({ state: "pending", by: "you", minutes: 45, sampleCount: 0 });
    expect((await call(base, { method: "POST", json: { reason: "Another", minutes: 5 }, cookie })).status).toBe(409);
    expect((await call(base, { method: "POST", json: { reason: "", minutes: 5 }, cookie })).status).toBe(400);

    const reply = await sync();
    expect(reply.recordings!.start.map((r) => r.id)).toEqual([info.id]);
    expect(reply.recordings!.stop).toEqual([]);

    const running: Recording = { ...demo(), ...reply.recordings!.start[0], state: "recording", startedAt: Date.now(), endsAt: Date.now() + 45 * 60_000, finishedAt: undefined, headline: undefined };
    expect((await call(`${base}/${info.id}`, { method: "PUT", json: running, cookie })).status).toBe(204);
    expect((await sync()).recordings).toEqual({ start: [], stop: [] });
    expect((await list())[0]).toMatchObject({ id: info.id, state: "recording", sampleCount: running.samples.length });

    expect((await call(`${base}/${info.id}/stop`, { method: "POST", json: {}, cookie })).status).toBe(204);
    expect((await sync()).recordings!.stop).toEqual([info.id]);

    await call(`${base}/${info.id}`, { method: "PUT", json: { ...running, state: "cancelled", finishedAt: NOW, headline: "The graphics driver stopped and recovered." }, cookie });
    expect((await sync()).recordings).toEqual({ start: [], stop: [] });
    const full = await (await call(`${base}/${info.id}`, { cookie })).json() as Recording;
    expect(full).toMatchObject({ state: "cancelled", headline: "The graphics driver stopped and recovered.", reason: "Catch the black screen" });
    expect(full.samples.length).toBe(running.samples.length);
    expect(full.events[0]).toMatchObject({ kind: "driver", source: "Display", id: 4101 });
  });

  it("cancels a request that was stopped before the PC saw it", async () => {
    const { call, cookie, base, sync, list } = await pcSetup();
    const info = await (await call(base, { method: "POST", json: { reason: "Catch it", minutes: 10 }, cookie })).json() as RecordingInfo;
    await call(`${base}/${info.id}/stop`, { method: "POST", json: {}, cookie });
    expect((await list())[0].state).toBe("cancelled");
    expect((await sync()).recordings!.start).toEqual([]);
  });

  it("keeps recordings and events private to the account", async () => {
    const { call, signUp, cookie, base, id, sync } = await pcSetup();
    await call(`${base}/${demo().id}`, { method: "PUT", json: demo(), cookie });
    await sync({ events: demoEvents("tower", NOW) as never });
    const mine = await (await call(`/api/machines/${id}/events`, { cookie })).json() as { kind: string }[];
    expect(mine.length).toBeGreaterThan(4);
    expect(mine.every((e) => e.kind)).toBe(true);

    const other = await signUp("eve@example.com");
    expect((await call(base, { cookie: other })).status).toBe(404);
    expect((await call(`${base}/${demo().id}`, { cookie: other })).status).toBe(404);
    expect((await call(`/api/machines/${id}/events`, { cookie: other })).status).toBe(404);
    expect((await call(`${base}/${demo().id}/stop`, { method: "POST", json: {}, cookie: other })).status).toBe(404);
    expect((await call(base, { method: "POST", json: { reason: "Snoop", minutes: 5 }, cookie: other })).status).toBe(404);
    expect((await call(`${base}/${demo().id}`, { method: "PUT", json: demo(), cookie: other })).status).toBe(404);
    expect((await call(base)).status).toBe(401);
  });

  it("cuts uploads to size, refuses junk and keeps the newest twenty", async () => {
    const { call, cookie, base, list } = await pcSetup();
    const r = demo();
    const big = { ...r, samples: Array.from({ length: 900 }, (_, i) => ({ ...r.samples[0], t: r.startedAt! + i * 1000 })), events: Array.from({ length: 500 }, (_, i) => ({ ...r.events[0], t: r.startedAt! + i * 61_000 })) };
    expect((await call(`${base}/${r.id}`, { method: "PUT", json: big, cookie })).status).toBe(204);
    const got = await (await call(`${base}/${r.id}`, { cookie })).json() as Recording;
    expect(got.samples.length).toBe(360);
    expect(got.events.length).toBe(200);
    expect((await call(`${base}/${r.id}`, { method: "PUT", json: { ...r, state: "weird" }, cookie })).status).toBe(400);
    expect((await call(`${base}/other-id`, { method: "PUT", json: r, cookie })).status).toBe(400);

    for (let i = 0; i < 24; i++) {
      const id = `rec-${String(i).padStart(4, "0")}`;
      await call(`${base}/${id}`, { method: "PUT", json: { ...r, id, samples: r.samples.slice(0, 3), createdAt: new Date(Date.now() - (30 - i) * 60_000).toISOString() }, cookie });
    }
    const kept = await list();
    expect(kept).toHaveLength(20);
    expect(kept[0].id).toBe("rec-0023");
    expect(kept.some((x) => x.id === "rec-0000")).toBe(false);
  });

  it("lets the chat start a recording when it lacks data, queued for the PC on the web", async () => {
    const { call, cookie, id, seen, list, sync } = await pcSetup([
      { text: "I can't see that from here.", tool: { name: "start_recording", input: { reason: "Watch temperatures and Windows events to catch the black screen.", duration_minutes: 30 } } },
      { text: "Check back in half an hour." },
    ]);
    const res = await call("/api/chat", { method: "POST", json: { machineId: id, tz: "America/New_York", messages: [{ from: "you", text: "My screen goes black in games. Why?" }] }, cookie });
    const events = await readEvents(res);
    const rec = events.find((e) => e.type === "recording") as Extract<ChatEvent, { type: "recording" }>;
    expect(rec).toMatchObject({ queued: true, request: { by: "rig", minutes: 30, question: "My screen goes black in games. Why?" } });
    expect(rec.request.capture).toEqual(["temps", "loads", "fans", "processes", "events"]);
    expect((await list())[0]).toMatchObject({ id: rec.request.id, state: "pending" });
    expect((await sync()).recordings!.start[0].id).toBe(rec.request.id);
    const told = JSON.stringify(seen[1].messages);
    expect(told).toMatch(/Queued for 30 minutes/);
    expect(told).toMatch(/ends around \w{3}, \w{3} \d+, \d+:\d\d [AP]M/);
    expect(seen[0].tools.map((t) => (t as { name: string }).name)).toEqual(expect.arrayContaining(["start_recording", "read_recording"]));
  });

  it("starts right away for the app on the PC, and refuses a second one or a silly length", async () => {
    const { call, cookie, id, s, seen } = await pcSetup([
      { tool: { name: "start_recording", input: { reason: "Catch the stutter", duration_minutes: 100000 } } },
      { tool: { name: "start_recording", input: { reason: "Catch the stutter", duration_minutes: 20 } } },
      { text: "Recording." },
      { tool: { name: "start_recording", input: { reason: "Again", duration_minutes: 20 } } },
      { text: "Already on it." },
    ]);
    const ask = () => call("/api/chat", { method: "POST", json: { machineId: id, view: s.view, facts: s.facts, messages: [{ from: "you", text: "Why does it stutter?" }] }, cookie });
    const first = await readEvents(await ask());
    expect(first.find((e) => e.type === "recording")).toMatchObject({ queued: false });
    expect(JSON.stringify(seen[1].messages)).toMatch(/minutes must be from 1 to 180/);
    expect(JSON.stringify(seen[2].messages)).toMatch(/Recording now for 20 minutes\. It ends at/);
    const second = await readEvents(await ask());
    expect(second.some((e) => e.type === "recording")).toBe(false);
    expect(JSON.stringify(seen[4].messages)).toMatch(/already waiting for the PC/);
  });

  it("reads a finished recording back to the model as moments, not raw samples", async () => {
    const { call, cookie, id, base, seen } = await pcSetup([{ tool: { name: "read_recording", input: {} } }, { text: "The graphics driver reset while the card was hot." }]);
    await call(`${base}/${demo().id}`, { method: "PUT", json: demo(), cookie });
    const res = await call("/api/chat", { method: "POST", json: { machineId: id, tz: "Europe/Berlin", messages: [{ from: "you", text: "The recording finished. What did it find?" }] }, cookie });
    const events = await readEvents(res);
    // The model is told which recordings exist and what time it is for the person.
    expect(JSON.stringify(seen[0].system)).toContain(`\\"recordings\\":[{\\"id\\":\\"${demo().id}\\",\\"state\\":\\"done\\"`);
    expect(JSON.stringify(seen[0].system)).toContain('\\"now\\":');
    const result = JSON.stringify(seen[1].messages.at(-1));
    expect(result).toContain("The graphics driver stopped and recovered");
    expect(result).toContain("Graphics card ran hot");
    expect(result).toContain("Cyberpunk2077.exe");
    expect(result.length).toBeLessThan(6000);
    const sources = events.find((e) => e.type === "sources") as Extract<ChatEvent, { type: "sources" }>;
    expect(sources.sources.map((x) => x.label)).toContain("Recording, 45 minutes");
  });
});
