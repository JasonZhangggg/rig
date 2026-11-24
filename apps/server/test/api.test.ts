import { sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopClientId, type ChatEvent, type DataExport, type MachineSync, type Recording, type RecordingInfo, type SyncReply } from "@rig/core";
import { demoEvents, demoRecording, fixtures } from "@rig/core/demo";
import { Store } from "../src/db";
import type { Env } from "../src/env";
import { ORIGIN, fakeClaude, readEvents, setup, syncPayload } from "./helpers";

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

  it("limits sign-in tries per caller, not for everyone at once", async () => {
    const { call } = await setup();
    const tryFrom = (ip: string) => call("/api/auth/sign-in/email", {
      method: "POST", json: { email: "nobody@example.com", password: "wrong password" },
      headers: { origin: ORIGIN, "cf-connecting-ip": ip },
    });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await tryFrom("203.0.113.1")).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
    expect((await tryFrom("203.0.113.2")).status).toBe(401);
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
    const shop = await (await call(`/api/machines/${id}/shop`, { cookie })).json() as { demo: boolean; items: unknown[] } | null;
    expect(shop === null || (shop.demo === true && shop.items.length > 0)).toBe(true);

    const other = await signUp("eve@example.com");
    expect((await call(`/api/machines/${id}`, { cookie: other })).status).toBe(404);
    expect((await call(`/api/machines/${id}/shop`, { cookie: other })).status).toBe(404);
    expect(await (await call("/api/machines", { cookie: other })).json()).toEqual([]);
  });

  it("keeps fan speed, game and each part's readings per point, and still takes points from older apps", async () => {
    const { call, signUp } = await setup();
    const cookie = await signUp("kit@example.com");
    const t = Date.now();
    const s = await syncPayload({
      history: [
        { t: t - 1_200_000, cpu: 48, gpu: 40, busy: false },
        { t: t - 600_000, cpu: 66, gpu: 79, busy: true, fan: 2140, game: "Cyberpunk 2077", cpuLoad: 64, gpuLoad: 97, mem: 41.4, drive: 47, board: 39 },
        { t, cpu: 52, gpu: 44, busy: false, fan: null, game: null },
      ],
    });
    const id = s.inventory.machine.id;
    expect((await call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie })).status).toBe(200);

    const hist = await (await call(`/api/machines/${id}/history?range=24h`, { cookie })).json();
    const none = { cpuLoad: null, gpuLoad: null, mem: null, drive: null, board: null };
    expect(hist).toEqual([
      { t: t - 1_200_000, cpu: 48, gpu: 40, busy: false, fan: null, game: null, ...none },
      { t: t - 600_000, cpu: 66, gpu: 79, busy: true, fan: 2140, game: "Cyberpunk 2077", cpuLoad: 64, gpuLoad: 97, mem: 41, drive: 47, board: 39 },
      { t, cpu: 52, gpu: 44, busy: false, fan: null, game: null, ...none },
    ]);

    const resent = await syncPayload({ history: [{ t: t - 600_000, cpu: 66, gpu: 79, busy: true, fan: 2300, game: "Balatro" }] });
    await call(`/api/machines/${id}/sync`, { method: "PUT", json: resent, cookie });
    const again = await (await call(`/api/machines/${id}/history?range=24h`, { cookie })).json() as { fan: number; game: string }[];
    expect(again[1]).toMatchObject({ fan: 2300, game: "Balatro" });

    const bad = await syncPayload({ history: [{ t, cpu: 50, gpu: 40, busy: false, fan: "fast" as unknown as number }] });
    expect((await call(`/api/machines/${id}/sync`, { method: "PUT", json: bad, cookie })).status).toBe(400);
    const badMem = await syncPayload({ history: [{ t, cpu: 50, gpu: 40, busy: false, mem: "most" as unknown as number }] });
    expect((await call(`/api/machines/${id}/sync`, { method: "PUT", json: badMem, cookie })).status).toBe(400);
  });

  it("shows changes an older app uploaded as fix steps", async () => {
    const { call, signUp } = await setup();
    const cookie = await signUp("lee@example.com");
    const row = ["Game Mode", "Off", "On"];
    const old = { id: "c1", machineId: "x", at: "2026-11-01T10:00:00.000Z", title: "Turned Game Mode on", by: "you", status: "applied", why: "", result: "", diff: [row],
      applied: [{ call: { kind: "windows.gameMode", enabled: true }, undo: { kind: "windows.gameMode", enabled: false }, row }] };
    const s = { ...(await syncPayload()), changes: [old] } as unknown as MachineSync;
    const id = s.inventory.machine.id;
    expect((await call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie })).status).toBe(200);
    expect(await (await call(`/api/machines/${id}/changes`, { cookie })).json()).toEqual([{ ...old, tier: 1,
      applied: [{ step: { kind: "fix", call: { kind: "windows.gameMode", enabled: true } }, undo: { kind: "fix", call: { kind: "windows.gameMode", enabled: false } }, rows: [row] }] }]);
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

  it("keeps which graphics card the person picked, and refuses anything but Rig's own part ids", async () => {
    const { call, signUp } = await setup();
    const cookie = await signUp("kai@example.com");
    const s = await syncPayload();
    const id = s.inventory.machine.id;
    await call(`/api/machines/${id}/sync`, { method: "PUT", json: s, cookie });
    expect((await call(`/api/machines/${id}`, { method: "PATCH", json: { picks: { gpu: "<b>x</b>" } }, cookie })).status).toBe(400);
    expect((await call(`/api/machines/${id}`, { method: "PATCH", json: { picks: { psu: "x" } }, cookie })).status).toBe(400);
    expect((await call(`/api/machines/${id}`, { method: "PATCH", json: { picks: { gpu: "rx6700xt-xfx-qick319" } }, cookie })).status).toBe(204);
    expect((await (await call(`/api/machines/${id}`, { cookie })).json() as { picks: unknown }).picks).toEqual({ gpu: "rx6700xt-xfx-qick319" });
    expect((await call(`/api/machines/${id}`, { method: "PATCH", json: { picks: { gpu: "unsure:RX 6700 XT" } }, cookie })).status).toBe(204);
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
    expect(p.proposal.steps).toEqual([{ kind: "fix", call: { kind: "windows.gameMode", enabled: true } }]);
    expect(p.proposal.tier).toBe(1);
    // An older desktop app reads the same change from `calls`.
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

  it("proposes a registry value, tiered by whose settings it changes, and sends a never-list key back", async () => {
    const menu = { kind: "registry.set", key: "HKCU:\\Control Panel\\Desktop", name: "MenuShowDelay", type: "string", value: "100", extra: "dropped" };
    const { ask, seen } = await chatSetup([
      { tool: { name: "propose_change", input: { title: "Set up autostart", why: "y", calls: [{ kind: "registry.set", key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", name: "x", type: "string", value: "C:\\x.exe" }] } } },
      { text: "Menus open after a delay.", tool: { name: "propose_change", input: { title: "Faster menus", why: "Menus open at once.", calls: [menu] } } },
      { text: "Review the card." },
    ]);
    const events = await readEvents(await ask("Make menus faster"));
    expect(JSON.stringify(seen[1].messages)).toContain("Run keys");
    const p = events.find((e) => e.type === "proposal") as Extract<ChatEvent, { type: "proposal" }>;
    expect(p.proposal.steps).toEqual([{ kind: "fix", call: { kind: "registry.set", key: "HKCU:\\Control Panel\\Desktop", name: "MenuShowDelay", type: "string", value: "100" } }]);
    expect(p.proposal.tier).toBe(1);
    // The server can't see the registry; the app reads the value when the person reviews the card.
    expect(p.proposal.rows).toEqual([["HKCU\\Control Panel\\Desktop\\MenuShowDelay", "Not read yet", "\"100\""]]);

    const machine = await chatSetup([{ tool: { name: "propose_change", input: { title: "No Game DVR", why: "y", calls: [{ kind: "registry.set", key: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR", name: "AllowGameDVR", type: "dword", value: 0 }] } } }, { text: "Done." }]);
    const q = (await readEvents(await machine.ask("Turn off Game DVR for everyone"))).find((e) => e.type === "proposal") as Extract<ChatEvent, { type: "proposal" }>;
    expect(q.proposal.tier).toBe(2);
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

describe("custom logs", () => {
  async function pcSetup(rounds: Parameters<typeof fakeClaude>[0]) {
    const fake = fakeClaude(rounds);
    const t = await setup({}, fake.client);
    const cookie = await t.signUp("ada@example.com");
    const s = await syncPayload();
    const id = s.inventory.machine.id;
    await t.call(`/api/machines/${id}/sync`, { method: "PUT", json: { ...s, history: [] }, cookie });
    const ask = async (extra: Record<string, unknown>) =>
      readEvents(await t.call("/api/chat", { method: "POST", json: { machineId: id, messages: [{ from: "you", text: "It shuts off sometimes." }], ...extra }, cookie }));
    return { ...fake, s, ask };
  }
  const existing = { id: "c-old", label: "GPU heat", kind: "sensor", by: "chat", createdAt: 1, expiresAt: Date.now() + 864e5, every: 10, state: "on", owner: "S-1-5-21-1", secret: "x".repeat(9999) };

  it("sets up a checked custom log for the app on the PC and tells the model what it reads", async () => {
    const { s, ask, seen } = await pcSetup([
      { tool: { name: "add_custom_log", input: { label: "Disk wait", source: { kind: "counter", path: "cmd.exe /c del" } } } },
      { tool: { name: "add_custom_log", input: { label: "Hot spot while hot", source: { kind: "sensor", match: "GPU Hot Spot" }, every_seconds: 0, fast_seconds: 2, when: { metric: "gpuTemp", op: ">", value: 85 }, hours: 12 } } },
      { text: "Logging it." },
    ]);
    const events = await ask({ view: s.view, facts: s.facts, probes: [existing] });
    // The PC block lists what it already keeps, without anything the chat doesn't need.
    const block = JSON.stringify(seen[0].system);
    expect(block).toContain("customLogs");
    expect(block).toContain("GPU heat");
    expect(block).not.toContain("S-1-5-21-1");
    expect(block).not.toContain("xxxxxxxx");
    expect(JSON.stringify(seen[1].messages)).toMatch(/path must be a counter path/);
    const added = events.filter((e) => e.type === "probe");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ op: "add", probe: { label: "Hot spot while hot", by: "chat", every: 0, fast: 2, when: { metric: "gpuTemp", op: ">", value: 85 }, source: { kind: "sensor", match: "GPU Hot Spot" } } });
    const p = (added[0] as Extract<ChatEvent, { type: "probe"; op: "add" }>).probe;
    expect(p.expiresAt - p.createdAt).toBe(12 * 3_600_000);
    expect(JSON.stringify(seen[2].messages)).toMatch(/every 2 seconds while the graphics card's temperature > 85/);
  });

  it("only proposes a script, one per answer, and never approves it", async () => {
    const { s, ask, seen } = await pcSetup([
      { tool: { name: "propose_script", input: { label: "Who woke the PC", text: "powercfg /lastwake", admin: true, every_seconds: 600 } } },
      { tool: { name: "propose_script", input: { label: "Again", text: "Get-Date" } } },
      { text: "Approve it if you'd like." },
    ]);
    const events = await ask({ view: s.view, facts: s.facts, probes: [] });
    const scripts = events.filter((e) => e.type === "script") as Extract<ChatEvent, { type: "script" }>[];
    expect(scripts).toHaveLength(1);
    expect(scripts[0].probe).toMatchObject({ by: "chat", every: 600, source: { kind: "script", shell: "powershell", text: "powercfg /lastwake", admin: true, timeout: 30 } });
    expect(scripts[0].probe.hash).toBeUndefined();
    expect(events.some((e) => e.type === "probe")).toBe(false);
    expect(JSON.stringify(seen[1].messages)).toMatch(/Nothing runs until they approve it in Rig, and Windows asks them for permission/);
    expect(JSON.stringify(seen[2].messages)).toMatch(/One script per answer/);
  });

  it("turns one off, and refuses custom logs from the website or past the limit", async () => {
    const { s, ask, seen } = await pcSetup([
      { tool: { name: "remove_custom_log", input: { log_id: "c-old" } } }, { text: "Off." },
      { tool: { name: "add_custom_log", input: { label: "x", source: { kind: "process", name: "game.exe" } } } }, { text: "Can't." },
      { tool: { name: "add_custom_log", input: { label: "x", source: { kind: "process", name: "game.exe" } } } }, { text: "Full." },
    ]);
    const off = await ask({ view: s.view, facts: s.facts, probes: [existing] });
    expect(off.find((e) => e.type === "probe")).toEqual({ type: "probe", op: "remove", id: "c-old" });
    // From the website there's no recorder to ask.
    const web = await ask({});
    expect(web.some((e) => e.type === "probe")).toBe(false);
    expect(JSON.stringify(seen[3].messages)).toMatch(/set up from the Rig app on the PC/);
    const full = await ask({ view: s.view, facts: s.facts, probes: Array.from({ length: 30 }, (_, i) => ({ ...existing, id: `c-${i}` })) });
    expect(full.some((e) => e.type === "probe")).toBe(false);
    expect(JSON.stringify(seen[5].messages)).toMatch(/already keeps 24 custom logs/);
  });
});

describe("your data", () => {
  /** Two accounts, each with the same PC uploaded, history and chat use. */
  async function twoAccounts() {
    const t = await setup();
    const jo = await t.signUp("jo@example.com");
    const max = await t.signUp("max@example.com");
    const s = await syncPayload();
    const id = s.inventory.machine.id;
    const rec = demoRecording(fixtures.atlas.inv, Date.now());
    const manualIds: Record<string, string> = {};
    for (const [who, cookie] of [["jo", jo], ["max", max]] as const) {
      expect((await t.call(`/api/machines/${id}/sync`, { method: "PUT", json: { ...s, events: demoEvents("tower", Date.now()) }, cookie })).status).toBe(200);
      expect((await t.call(`/api/machines/${id}/recordings/${rec.id}`, { method: "PUT", json: rec, cookie })).status).toBe(204);
      const target = { part: "extra:case", kind: "case", maker: "Fractal Design", model: "North", source: "added" };
      const manual = await (await t.call(`/api/machines/${id}/manuals`, { method: "POST", json: { target, name: "north.pdf", bytes: 2_000_000 }, cookie })).json() as { id: string };
      manualIds[who] = manual.id;
      const pages = [{ n: 1, text: "Fractal Design North. Secret page text." }, { n: 2, text: "Front I/O: connect the USB-C header." }];
      expect((await t.call(`/api/machines/${id}/manuals/${manual.id}/pages`, { method: "PUT", json: { pages, diagrams: [{ page: 2, kind: "usb-headers" }] }, cookie })).status).toBe(200);
    }
    const uid = async (cookie: string) => ((await (await t.call("/api/me", { cookie })).json()) as { id: string }).id;
    const ids = { jo: await uid(jo), max: await uid(max) };
    const store = new Store(t.db);
    for (const u of [ids.jo, ids.jo, ids.max]) await store.useChat(u, 40);
    for (const u of [ids.jo, ids.max]) {
      await sql`insert into "deviceCode" ("id", "deviceCode", "userCode", "userId", "expiresAt", "status") values (${`dc-${u}`}, ${`code-${u}`}, ${`U-${u}`}, ${u}, now() + interval '5 minutes', 'approved')`.execute(t.db);
    }
    return { ...t, jo, max, id, ids, rec, manualIds };
  }

  /** How many rows each table holds for one account. */
  async function rows(db: Awaited<ReturnType<typeof setup>>["db"], userId: string) {
    const count = async (q: { executeTakeFirstOrThrow(): Promise<{ n: string | number | bigint }> }) => Number((await q.executeTakeFirstOrThrow()).n);
    return {
      user: await count(db.selectFrom("user").select((e) => e.fn.countAll().as("n")).where("id", "=", userId)),
      session: await count(db.selectFrom("session").select((e) => e.fn.countAll().as("n")).where("userId", "=", userId)),
      account: await count(db.selectFrom("account").select((e) => e.fn.countAll().as("n")).where("userId", "=", userId)),
      deviceCode: await count(db.selectFrom("deviceCode").select((e) => e.fn.countAll().as("n")).where("userId", "=", userId)),
      machine: await count(db.selectFrom("machine").select((e) => e.fn.countAll().as("n")).where("user_id", "=", userId)),
      history: await count(db.selectFrom("machine_history").select((e) => e.fn.countAll().as("n")).where("user_id", "=", userId)),
      chat: await count(db.selectFrom("chat_usage").select((e) => e.fn.countAll().as("n")).where("user_id", "=", userId)),
      recording: await count(db.selectFrom("recording").select((e) => e.fn.countAll().as("n")).where("user_id", "=", userId)),
      manual: await count(db.selectFrom("manuals").select((e) => e.fn.countAll().as("n")).where("user_id", "=", userId)),
      manualPage: await count(db.selectFrom("manual_pages").innerJoin("manuals", "manuals.id", "manual_pages.manual_id").select((e) => e.fn.countAll().as("n")).where("manuals.user_id", "=", userId)),
    };
  }

  it("downloads the account's PCs with all their history, events, recordings and manuals, and nobody else's", async () => {
    const { call, jo, id, ids, rec, manualIds } = await twoAccounts();
    expect((await call("/api/me/export")).status).toBe(401);

    const res = await call("/api/me/export", { cookie: jo });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="rig-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const out = await res.json() as DataExport;
    expect(out.format).toBe("rig-export/1");
    expect(out.account).toMatchObject({ id: ids.jo, email: "jo@example.com", name: "jo" });
    expect(out.account?.createdAt).toMatch(/^\d{4}-/);
    expect(out.machines).toHaveLength(1);
    expect(out.machines[0]).toMatchObject({ id, name: "Atlas" });
    expect(out.machines[0].inventory?.machine.id).toBe(id);
    expect(out.machines[0].history.map((p) => p.cpu)).toEqual([61, 70]);
    expect(out.machines[0].events.length).toBeGreaterThan(4);
    expect(out.machines[0].recordings.map((r) => [r.id, r.samples.length])).toEqual([[rec.id, rec.samples.length]]);
    expect(out.chatUsage).toEqual([{ day: new Date().toISOString().slice(0, 10), count: 2 }]);
    // Manuals: what each one is, not its page text.
    expect(out.machines[0].manuals).toEqual([expect.objectContaining({ id: manualIds.jo, title: "Fractal Design North manual", source: "added", pageCount: 2, indexed: true, diagrams: [{ page: 2, kind: "usb-headers", label: "USB headers" }] })]);
    expect(JSON.stringify(out)).not.toContain("Secret page text");
    expect(JSON.stringify(out)).not.toContain(manualIds.max);
    expect(JSON.stringify(out)).not.toContain("max@example.com");
  });

  it("deletes the account with its PCs, history, recordings, manuals, chat use and sign-ins, and leaves other accounts alone", async () => {
    const { call, db, signUp, jo, max, ids } = await twoAccounts();
    const maxBefore = await rows(db, ids.max);
    expect(await rows(db, ids.jo)).toMatchObject({ user: 1, session: 1, account: 1, deviceCode: 1, machine: 1, history: 2, chat: 1, recording: 1, manual: 1, manualPage: 2 });

    expect((await call("/api/me", { method: "DELETE", json: { confirm: "DELETE" } })).status).toBe(401);
    expect((await call("/api/me", { method: "DELETE", json: {}, cookie: jo })).status).toBe(400);
    expect((await call("/api/me", { method: "DELETE", json: { confirm: "delete" }, cookie: jo })).status).toBe(400);
    expect((await rows(db, ids.jo)).user).toBe(1);

    const res = await call("/api/me", { method: "DELETE", json: { confirm: "DELETE" }, cookie: jo });
    expect(res.status).toBe(204);
    const cleared = res.headers.getSetCookie();
    expect(cleared.some((c) => c.startsWith("better-auth.session_token=;") && /Max-Age=0/.test(c))).toBe(true);

    expect(await rows(db, ids.jo)).toEqual({ user: 0, session: 0, account: 0, deviceCode: 0, machine: 0, history: 0, chat: 0, recording: 0, manual: 0, manualPage: 0 });
    expect(await rows(db, ids.max)).toEqual(maxBefore);
    expect((await call("/api/me", { cookie: jo })).status).toBe(401);
    expect((await call("/api/machines", { cookie: max })).status).toBe(200);
    expect(await (await call("/api/machines", { cookie: max })).json()).toHaveLength(1);

    // The same email can make a new, empty account afterwards.
    const again = await signUp("jo@example.com");
    expect(await (await call("/api/machines", { cookie: again })).json()).toEqual([]);
  });

  it("rolls the whole deletion back if any part of it fails", async () => {
    const { db, ids } = await twoAccounts();
    await sql`create function stop_user_delete() returns trigger language plpgsql as $$ begin raise exception 'blocked'; end $$`.execute(db);
    await sql`create trigger stop_user_delete before delete on "user" for each row execute function stop_user_delete()`.execute(db);
    const before = await rows(db, ids.jo);
    await expect(new Store(db).deleteAccount(ids.jo)).rejects.toThrow(/blocked/);
    expect(await rows(db, ids.jo)).toEqual(before);
  });
});


describe("the site's address", () => {
  const site = { WEB_ORIGIN: "https://rigpc.app", ASSETS: { fetch: async () => new Response("the website") } as unknown as Fetcher };

  it("moves a page opened at the old address to the site, keeping where it was going", async () => {
    const { call } = await setup(site);
    const res = await call("https://rig.example.workers.dev/app/?user_code=ABCD1234");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://rigpc.app/app/?user_code=ABCD1234");
  });

  it("serves the website at its own address", async () => {
    const { call } = await setup(site);
    const res = await call("https://rigpc.app/app/");
    expect(await res.text()).toBe("the website");
  });

  it("still answers installed apps that call the old address", async () => {
    const { call } = await setup(site);
    const res = await call("https://rig.example.workers.dev/api/config");
    expect(res.status).toBe(200);
  });
});
