import { describe, expect, it, vi } from "vitest";
import {
  LocalClient, MAX_SAMPLES, MemoryStore, Recorder, checkRequest, classifyEvent, cleanEvents, cleanRecording, describeRecording, intervalFor, newRecording, summarise,
  type PCEvent, type RawEvent, type Recording, type RecordingRequest, type RecordingSample,
} from "../src";
import { DemoClient, SimulatedLink, demoRecording, fixtures, simulate } from "../src/demo";
import type { CloudClient } from "../src/cloud";

const T0 = new Date(2026, 10, 11, 20, 0).getTime();
const MIN = 60_000;
const ev = (over: Partial<RawEvent>): RawEvent => ({ t: T0, log: "System", source: "Display", id: 4101, level: "warning", message: "Display driver nvlddmkm stopped responding and has successfully recovered.", ...over });
const rec = (samples: RecordingSample[], events: RawEvent[] = []) => ({ samples, events: cleanEvents(events), intervalMs: 10_000 });
/** One sample every ten seconds for `minutes`, from a function of the minute. */
const run = (minutes: number, f: (m: number) => Partial<RecordingSample>): RecordingSample[] =>
  Array.from({ length: minutes * 6 + 1 }, (_, i) => ({ t: T0 + i * 10_000, ...f(i / 6) }));

describe("Windows events", () => {
  it("knows what the events that matter mean", () => {
    const kind = (source: string, id: number) => classifyEvent({ source, id });
    expect(kind("Microsoft-Windows-Kernel-Power", 41)).toBe("shutdown");
    expect(kind("Microsoft-Windows-Kernel-Power", 109)).toBe("other");
    expect(kind("EventLog", 6008)).toBe("shutdown");
    expect(kind("BugCheck", 1001)).toBe("crash");
    expect(kind("Microsoft-Windows-WER-SystemErrorReporting", 1001)).toBe("crash");
    expect(kind("Application Error", 1000)).toBe("crash");
    expect(kind("Display", 4101)).toBe("driver");
    expect(kind("nvlddmkm", 153)).toBe("driver");
    expect(kind("Microsoft-Windows-WHEA-Logger", 18)).toBe("hardware");
    expect(kind("disk", 7)).toBe("disk");
    expect(kind("Ntfs", 55)).toBe("disk");
    expect(kind("Service Control Manager", 7031)).toBe("other");
  });

  it("cleans what the helper sends: newest first, repeats folded, bounded, junk dropped", () => {
    const list = cleanEvents([
      ev({ t: T0 }), ev({ t: T0 + 5000 }), ev({ t: T0 + 5 * MIN, message: "x".repeat(900) }),
      { t: "soon", source: "Display", id: 1 }, null, ev({ t: T0 + MIN, level: "nonsense" as never }),
    ]);
    expect(list.map((e) => e.t)).toEqual([T0 + 5 * MIN, T0 + MIN, T0 + 5000]);
    expect(list[0].message.length).toBe(300);
    expect(list[1].level).toBe("error");
    expect(list.every((e) => e.kind === "driver")).toBe(true);
    expect(cleanEvents(Array.from({ length: 500 }, (_, i) => ev({ t: T0 + i * MIN }))).length).toBe(200);
    expect(cleanEvents("nope")).toEqual([]);
  });
});

describe("recording requests", () => {
  const fill = { id: "abcd1234", by: "rig" as const, now: new Date(T0) };
  it("holds the model's request to sane bounds", () => {
    expect(checkRequest({ reason: "", minutes: 10 }, fill)).toMatch(/reason/);
    expect(checkRequest({ reason: "Catch the crash", minutes: 0 }, fill)).toMatch(/minutes/);
    expect(checkRequest({ reason: "Catch the crash", minutes: 5000 }, fill)).toMatch(/minutes/);
    expect(checkRequest({ reason: "Catch the crash", capture: ["keystrokes"] }, fill)).toMatch(/capture/);
    expect(checkRequest({ reason: "  Catch the\ncrash ", minutes: 20.4, capture: ["temps", "events", "temps"] }, fill))
      .toEqual({ id: "abcd1234", reason: "Catch the crash", question: "", minutes: 20, capture: ["temps", "events"], by: "rig", createdAt: new Date(T0).toISOString() });
    expect((checkRequest({ reason: "Catch it" }, fill) as RecordingRequest).capture).toEqual(["temps", "loads", "fans", "processes", "events"]);
  });

  it("never plans more samples than a recording may hold", () => {
    for (const m of [1, 30, 45, 180]) expect((m * MIN) / intervalFor(m)).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(intervalFor(1)).toBe(5000);
  });

  it("cuts an uploaded recording down to size and refuses what isn't one", () => {
    const req = checkRequest({ reason: "Catch it", minutes: 30 }, fill) as RecordingRequest;
    const big = { ...newRecording(req, "pc"), state: "done", samples: run(120, () => ({ gpu: 60, top: Array.from({ length: 30 }, (_, i) => ({ name: `app${i}`, cpu: i, memMb: 10 })) })), events: Array.from({ length: 400 }, (_, i) => ev({ t: T0 + i * MIN })) };
    const clean = cleanRecording(big, "pc-from-url")!;
    expect(clean.pcId).toBe("pc-from-url");
    expect(clean.samples.length).toBe(MAX_SAMPLES);
    expect(clean.samples[0].top!.length).toBe(4);
    expect(clean.events.length).toBe(200);
    expect(clean.sampleCount).toBe(MAX_SAMPLES);
    expect(cleanRecording({ ...big, state: "exploded" }, "pc")).toBeNull();
    expect(cleanRecording({ ...big, id: "../etc" }, "pc")).toBeNull();
  });
});

describe("what a recording shows", () => {
  const limits = { cpu: 89, gpu: 88 };

  it("finds nothing in a calm recording", () => {
    const s = summarise(rec(run(10, () => ({ cpu: 45, gpu: 50, cpuLoad: 12, gpuLoad: 8, mem: 40 }))), limits);
    expect(s.moments).toEqual([]);
    expect(s.headline).toBe("Nothing unusual happened while Rig recorded.");
    expect(s.stats.gpu).toEqual({ min: 50, avg: 50, max: 50, maxAt: T0 });
    expect(s.minutes).toBe(10);
  });

  it("reports heat only when it lasts", () => {
    const blip = summarise(rec(run(10, (m) => ({ gpu: m >= 4 && m < 5 ? 86 : 70 }))), limits);
    expect(blip.moments).toEqual([]);
    const hot = summarise(rec(run(20, (m) => ({ gpu: m >= 5 ? 84 + Math.floor(m / 10) : 70, game: "Cyberpunk 2077" }))), limits);
    expect(hot.moments).toHaveLength(1);
    expect(hot.moments[0]).toMatchObject({ kind: "heat", severity: "warn", t: T0 + 5 * MIN, until: T0 + 20 * MIN, title: "Graphics card ran hot for 15 minutes" });
    expect(hot.moments[0].detail).toContain("between 84°C and 86°C");
    expect(hot.moments[0].detail).toContain("Cyberpunk 2077");
    expect(summarise(rec(run(20, () => ({ gpu: 90 }))), limits).moments[0].severity).toBe("bad");
    expect(summarise(rec(run(20, () => ({ gpu: 90 }))), {}).moments).toEqual([]);
  });

  it("ties a driver reset to the heat and load around it", () => {
    const samples = run(30, (m) => ({ gpu: m < 10 ? 72 : 85, gpuLoad: m >= 20 && m < 20.4 ? 4 : 98, cpu: 60, cpuLoad: 40, game: "Cyberpunk 2077" }));
    const s = summarise(rec(samples, [ev({ t: T0 + 20 * MIN + 2000 })]), limits);
    expect(s.moments.map((m) => m.kind)).toEqual(["heat", "drop", "event"]);
    const reset = s.moments[2];
    expect(reset).toMatchObject({ severity: "bad", title: "The graphics driver stopped and recovered" });
    expect(reset.detail).toContain("while the graphics card was running hot");
    expect(reset.detail).toContain("85°C, close to its 88°C limit");
    expect(reset.detail).toContain("Cyberpunk 2077 was in front");
    expect(reset.detail).toContain("Display 4101");
    expect(s.moments[1].title).toBe("Graphics card load fell from 98% to 4%");
    expect(s.headline).toBe("The graphics driver stopped and recovered, and 1 more thing to look at.");
    expect(s.games).toEqual(["Cyberpunk 2077"]);
  });

  it("says when an event has no readings near it, and skips noise", () => {
    const samples = [...run(5, () => ({ cpu: 50 })), ...run(5, () => ({ cpu: 50 })).map((x) => ({ ...x, t: x.t + 20 * MIN }))];
    const s = summarise(rec(samples, [
      ev({ t: T0 + 12 * MIN, source: "Microsoft-Windows-Kernel-Power", id: 41, level: "critical", message: "The system has rebooted without cleanly shutting down first." }),
      ev({ t: T0 + 2 * MIN, source: "Service Control Manager", id: 7031, level: "error", message: "A service stopped." }),
    ]), limits);
    expect(s.moments).toHaveLength(1);
    expect(s.moments[0].title).toBe("The PC turned off without shutting down");
    expect(s.moments[0].detail).toContain("likely off or restarting");
  });

  it("names the app behind a pinned processor and ranks the busiest apps", () => {
    const top = (m: number) => [{ name: "TiWorker.exe", cpu: m >= 2 && m < 5 ? 82 : 2, memMb: 900 }, { name: "chrome.exe", cpu: 6, memMb: 2400 }];
    const s = summarise(rec(run(8, (m) => ({ cpuLoad: m >= 2 && m < 5 ? 97 : 15, top: top(m) }))), limits);
    expect(s.moments).toHaveLength(1);
    expect(s.moments[0]).toMatchObject({ kind: "pinned", title: "The processor was flat out for 3 minutes" });
    expect(s.moments[0].detail).toContain("TiWorker.exe");
    expect(s.offenders.map((o) => o.name)).toEqual(["TiWorker.exe", "chrome.exe"]);
    expect(s.offenders[0]).toMatchObject({ cpuMax: 82, memMaxMb: 900 });
    expect(s.offenders[1].cpuAvg).toBe(6);
  });

  it("writes a compact brief for the chat with times in the person's zone", () => {
    const r = demoRecording(fixtures.atlas.inv, new Date(2026, 10, 17, 21, 0).getTime());
    const text = describeRecording(r, summarise(r, limits), { timeZone: "UTC", limits });
    expect(text).toContain("Recording demo-reset (done)");
    expect(text).toContain("The graphics driver stopped and recovered");
    expect(text).toContain("Graphics card ran hot");
    expect(text).toContain("Cyberpunk2077.exe");
    expect(text).toContain("Safe limits: processor 89°C, graphics card 88°C");
    expect(text.length).toBeLessThan(4000);
  });
});

describe("the recorder", () => {
  function setup(events: RawEvent[] = []) {
    let now = T0;
    const store = new MemoryStore();
    const finished: Recording[] = [];
    const make = () => new Recorder({
      pcId: () => "pc", store, now: () => now, limits: () => ({ gpu: 88 }),
      source: { events: async (since) => events.filter((e) => e.t >= since), processes: async () => [{ name: "game.exe", cpu: 40, memMb: 5000 }] },
      onFinish: (r) => finished.push(r),
    });
    const snap = () => simulate(fixtures.atlas.inv, now, { game: "Cyberpunk 2077", dust: 1 });
    /** Lets time pass, reading sensors every two seconds like the app does. */
    const pass = async (r: Recorder, ms: number) => { for (const end = now + ms; now < end;) { now += 2000; await r.tick(snap()); } };
    const req = (id: string, minutes = 2) => checkRequest({ reason: "Catch the black screen", minutes }, { id, by: "rig", now: new Date(now) }) as RecordingRequest;
    return { make, pass, req, store, finished, at: () => now, jump: (ms: number) => { now += ms; } };
  }

  it("samples on its interval, finishes on time and collects the events in between", async () => {
    const t = setup([ev({ t: T0 - MIN }), ev({ t: T0 + MIN }), ev({ t: T0 + 30 * MIN })]);
    const r = t.make();
    const info = await r.start(t.req("rec00001"));
    expect(info).toMatchObject({ state: "recording", startedAt: T0, endsAt: T0 + 2 * MIN, intervalMs: 5000 });
    await t.pass(r, MIN);
    expect(r.active()!.sampleCount).toBeGreaterThan(8);
    await t.pass(r, 90_000);
    expect(r.active()).toBeNull();
    const done = (await r.get("rec00001"))!;
    expect(done.state).toBe("done");
    expect(done.samples.length).toBeLessThanOrEqual(25);
    expect(done.samples[0]).toMatchObject({ game: "Cyberpunk 2077", top: [{ name: "game.exe", cpu: 40, memMb: 5000 }] });
    expect(done.samples[0].gpu).toBeGreaterThan(80);
    expect(done.events.map((e) => e.t)).toEqual([T0 + MIN]);
    expect(done.headline).toMatch(/graphics driver/i);
    expect(t.finished.map((x) => x.id)).toEqual(["rec00001"]);
    expect(r.list()[0]).toMatchObject({ id: "rec00001", state: "done", eventCount: 1 });
  });

  it("records one at a time, and starting the same request twice is harmless", async () => {
    const t = setup();
    const r = t.make();
    await r.start(t.req("rec00001"));
    await expect(r.start(t.req("rec00002"))).rejects.toThrow(/already recording/);
    expect((await r.start(t.req("rec00001"))).id).toBe("rec00001");
    expect(r.list()).toHaveLength(1);
  });

  it("keeps what it has when stopped early", async () => {
    const t = setup();
    const r = t.make();
    await r.start(t.req("rec00001", 30));
    await t.pass(r, MIN);
    await r.stop("rec00001");
    const got = (await r.get("rec00001"))!;
    expect(got.state).toBe("cancelled");
    expect(got.samples.length).toBeGreaterThan(5);
    expect(got.finishedAt).toBe(t.at());
  });

  it("survives the app closing: carries on if there's time left, wraps up if not", async () => {
    const t = setup([ev({ t: T0 + 3 * MIN, source: "Microsoft-Windows-Kernel-Power", id: 41, level: "critical", message: "Rebooted." })]);
    const first = t.make();
    await first.start(t.req("rec00001", 10));
    await t.pass(first, 2 * MIN);

    t.jump(2 * MIN);
    const second = t.make();
    await second.load();
    expect(second.active()).toMatchObject({ id: "rec00001", state: "recording" });
    await t.pass(second, MIN);

    t.jump(20 * MIN);
    const third = t.make();
    await third.load();
    expect(third.active()).toBeNull();
    const done = (await third.get("rec00001"))!;
    expect(done.state).toBe("done");
    expect(done.finishedAt).toBe(T0 + 10 * MIN);
    expect(done.events).toHaveLength(1);
    expect(summarise(done, {}).moments[0].detail).toContain("likely off or restarting");
    expect(t.finished).toHaveLength(1);
  });

  it("fails plainly when nothing could be read", async () => {
    const t = setup();
    const r = t.make();
    await r.start(t.req("rec00001", 1));
    t.jump(2 * MIN);
    await r.tick(null);
    expect((await r.get("rec00001"))).toMatchObject({ state: "failed", error: "No readings came in while it ran." });
  });
});

describe("demo logs", () => {
  it("shows a finished recording on Atlas with the reset, the heat and the conversation that asked for it", async () => {
    const demo = new DemoClient();
    const list = await new Promise<{ id: string; state: string; headline?: string }[]>((res) => { const stop = demo.watchRecordings("demo-atlas", (l) => { stop(); res(l); }); });
    const mine = list.filter((x) => !x.id.startsWith("bg-"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ state: "done", headline: expect.stringMatching(/graphics driver stopped/i) });
    const r = (await demo.recording("demo-atlas", mine[0].id))!;
    const s = summarise(r, { cpu: 89, gpu: 88 });
    expect(s.moments.map((m) => m.kind)).toEqual(["heat", "event", "drop"]);
    const kinds = new Set((await demo.events("demo-atlas")).map((e: PCEvent) => e.kind));
    expect([...kinds].sort()).toEqual(["crash", "disk", "driver", "hardware", "other", "shutdown"]);
    expect(await demo.events("demo-pebble")).toEqual([]);
    expect(demo.conversation("demo-atlas")[1].recording!.id).toBe(mine[0].id);
  });

  it("gives Atlas a week of background log, with every sensor and a closer look at the driver reset", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 24, 9, 0));
    const demo = new DemoClient();
    const list = await new Promise<{ id: string; reason: string }[]>((res) => { const stop = demo.watchRecordings("demo-atlas", (l) => { stop(); res(l); }); });
    expect(list.filter((x) => x.id.startsWith("bg-d-"))).toHaveLength(7);
    const look = list.find((x) => x.reason === "Windows logged Display event 4101")!;
    const crash = list.find((x) => x.reason === "Windows logged Application Error event 1000");
    expect(crash).toBeTruthy();
    const r = (await demo.recording("demo-atlas", look.id))!;
    expect(r.sensors!.map((s) => s.name)).toEqual(expect.arrayContaining(["GPU Hot Spot", "GPU Memory Junction", "GPU Package", "GPU Fan 2"]));
    expect(r.sensors!.some((s) => s.hw === "storage")).toBe(false);
    // Every 5 seconds around the reset, and every sensor in each reading.
    expect(r.samples[1].t - r.samples[0].t).toBe(5000);
    expect(r.samples.every((s) => s.all?.length === r.sensors!.length)).toBe(true);
    expect(r.events.map((e) => e.kind)).toContain("driver");
    expect(list.some((x) => x.reason.startsWith("Custom log: Discord"))).toBe(true);
    const pebble = await new Promise<{ id: string }[]>((res) => { const stop = demo.watchRecordings("demo-pebble", (l) => { stop(); res(l); }); });
    expect(pebble).toEqual([]);
    vi.useRealTimers();
  });

  it("lets the pretend helper answer the new read-only calls", async () => {
    const link = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts);
    expect((await link.processes()).length).toBeGreaterThan(2);
    expect((await link.events(0)).length).toBeGreaterThan(4);
  });
});

describe("the desktop client and recordings", () => {
  function desktop() {
    let now = T0;
    const uploads: Recording[] = [];
    const notes: { title: string; body: string }[] = [];
    let reply: { identity: object; recordings?: { start: RecordingRequest[]; stop: string[] } } = { identity: {} };
    const chatEvents: unknown[] = [];
    const cloud = {
      signedIn: async () => true, machines: async () => [], account: async () => null,
      sync: async () => reply,
      putRecording: async (_id: string, r: Recording) => { uploads.push(structuredClone(r)); },
      chat: async (_id: string, _h: unknown, onEvent: (e: unknown) => void) => { for (const e of chatEvents) onEvent(e); },
    } as unknown as CloudClient;
    const client = new LocalClient(new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => now }), new MemoryStore(), cloud,
      { tickMs: 1e9, syncEveryMs: 1e9, now: () => now, notify: (n) => notes.push(n) });
    const pass = async (ms: number) => { for (const end = now + ms; now < end;) { now += 2000; await client.tick(); } };
    const req = (id: string): RecordingRequest => checkRequest({ reason: "Catch the stutter", minutes: 1 }, { id, by: "rig", now: new Date(now) }) as RecordingRequest;
    return { client, uploads, notes, pass, req, chatEvents, setReply: (r: typeof reply) => { reply = r; } };
  }

  it("starts right away when the chat asks, uploads the result and notifies", async () => {
    const t = desktop();
    await t.client.start();
    const seen: unknown[] = [];
    let lists = 0;
    const stop = t.client.watchRecordings(t.client.id, () => { lists++; });
    t.chatEvents.push({ type: "recording", request: t.req("chat0001"), queued: true }, { type: "done" });
    await t.client.chat(t.client.id, [{ id: "1", from: "you", text: "Why does it stutter?" }], (e) => seen.push(e));
    expect(seen[0]).toMatchObject({ type: "recording", queued: false });
    await vi.waitFor(() => expect(t.uploads.at(-1)).toMatchObject({ id: "chat0001", state: "recording" }));
    await t.pass(70_000);
    await vi.waitFor(() => expect(t.uploads.at(-1)).toMatchObject({ id: "chat0001", state: "done" }));
    expect(t.uploads.at(-1)!.samples.length).toBeGreaterThan(8);
    expect(t.uploads.at(-1)!.samples[0].top!.length).toBeGreaterThan(0);
    expect(t.notes).toEqual([{ title: "Rig finished recording", body: "Open Logs in Rig to see what it found." }]);
    expect(lists).toBeGreaterThan(3);
    expect((await t.client.recording(t.client.id, "chat0001"))!.state).toBe("done");
    stop();
  });

  it("picks up a recording asked for on the web at the next sync, and stops one when told", async () => {
    const t = desktop();
    await t.client.start();
    t.setReply({ identity: {}, recordings: { start: [t.req("web00001")], stop: [] } });
    await t.client.sync();
    expect(t.uploads.at(-1)).toMatchObject({ id: "web00001", state: "recording" });
    await t.pass(20_000);
    t.setReply({ identity: {}, recordings: { start: [], stop: ["web00001"] } });
    await t.client.sync();
    expect(t.uploads.at(-1)).toMatchObject({ id: "web00001", state: "cancelled" });
    expect(t.uploads.at(-1)!.samples.length).toBeGreaterThan(2);
  });

  it("reads this PC's Windows events and sends them with the sync", async () => {
    const t = desktop();
    await t.client.start();
    const events = await t.client.events(t.client.id);
    expect(events.length).toBeGreaterThan(4);
    expect(events[0].t).toBeGreaterThan(events.at(-1)!.t);
    const mine = await t.client.startRecording(t.client.id, { reason: "Checking", minutes: 5 });
    expect(mine).toMatchObject({ by: "you", state: "recording", minutes: 5 });
    await t.client.stopRecording(t.client.id, mine.id);
    expect((await t.client.recording(t.client.id, mine.id))!.state).toBe("cancelled");
  });
});
