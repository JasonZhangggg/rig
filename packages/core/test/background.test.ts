import { describe, expect, it } from "vitest";
import {
  BackgroundLog, LocalClient, MemoryStore, RIG_EVENT, backgroundRecordings, eventTitle, isBackground, thinned, toInfo,
  type MachineSync, type RecorderCursor, type RecorderLink,
} from "../src";
import { SimulatedLink, fixtures } from "../src/demo";
import type { CloudClient } from "../src/cloud";

const T0 = new Date(2026, 10, 18, 9, 0).getTime();
const SEC = 1000, MIN = 60_000;

/** The sensor list the recorder writes, and a reading for it: CPU and GPU temperatures, CPU load and memory. */
const header = (t: number) => ({ k: "sensors", t, list: [
  ["/amdcpu/0/temperature/2", "cpu", "AMD Ryzen 7 7800X3D", "temperature", "Core (Tctl/Tdie)"],
  ["/gpu-nvidia/0/temperature/0", "gpu", "NVIDIA GeForce RTX 4070", "temperature", "GPU Core"],
  ["/amdcpu/0/load/0", "cpu", "AMD Ryzen 7 7800X3D", "load", "CPU Total"],
  ["/ram/load/0", "memory", "Generic Memory", "load", "Memory"],
] });
const s = (t: number, cpu: number, gpu: number, extra: Record<string, unknown> = {}) => ({ k: "s", t, v: [cpu, gpu, 30, 50], ...extra });

describe("Background log", () => {
  it("decodes readings against the latest sensor list, and skips lines it can't place", () => {
    const log = new BackgroundLog();
    log.ingest([
      s(T0 - MIN, 40, 40), // before any sensor list: dropped
      header(T0), s(T0, 41.5, 52, { top: [{ name: "game.exe", cpu: 40, memMb: 6000, gpu: 90 }] }),
      { k: "s", t: T0 + 30 * SEC, v: [1, 2] }, // wrong length
      { k: "mystery", t: T0 }, "junk", null, { k: "s" },
      s(T0 + MIN, 43, 55, { d: 1 }),
    ]);
    expect(log.samples).toHaveLength(2);
    expect(log.samples[0]).toMatchObject({ t: T0, cpu: 42, gpu: 52, cpuLoad: 30, mem: 50, top: [{ name: "game.exe", gpu: 90 }] });
    expect(log.samples[0].detail).toBeUndefined();
    expect(log.samples[1].detail).toBe(true);
  });

  it("turns power, sleep and a sudden stop into events, and keeps them apart from problems", () => {
    const log = new BackgroundLog();
    log.ingest([
      { k: "power", t: T0, what: "battery", pct: 80, atStart: true }, // where things stood at start: not an event
      { k: "power", t: T0 + MIN, what: "ac", pct: 54 },
      { k: "power", t: T0 + 2 * MIN, what: "sleep" },
      { k: "power", t: T0 + 3 * MIN, what: "wake" },
      { k: "start", t: T0 + 20 * MIN, prev: { t: T0 + 10 * MIN, state: "running", clean: false } },
      { k: "start", t: T0 + 30 * MIN, prev: { t: T0 + 25 * MIN, state: "stopped", clean: true } },
      { k: "e", t: T0 + 4 * MIN, log: "System", source: "Microsoft-Windows-Kernel-General", id: 12, level: "info", message: "The operating system started" },
      { k: "e", t: T0 + 5 * MIN, log: "Application", source: "Application Error", id: 1000, level: "error", message: "Faulting application name: game.exe, version 1.0" },
    ]);
    const { problems, power } = log.cleanEvents();
    expect(problems.map((e) => [e.kind, eventTitle(e)])).toEqual([["shutdown", "The PC stopped suddenly"], ["crash", "game.exe crashed"]]);
    expect(problems[0].t).toBe(T0 + 10 * MIN);
    expect(problems[0].message).toMatch(/lost power, froze or crashed/);
    expect(power.map(eventTitle)).toEqual(["Windows started", "The PC woke up", "The PC went to sleep", "Plugged in"]);
    expect(power.every((e) => e.kind === "power" && e.level === "info")).toBe(true);
  });

  it("names who restarted the PC", () => {
    const log = new BackgroundLog();
    log.ingest([{ k: "e", t: T0, log: "System", source: "User32", id: 1074, level: "info",
      message: "The process C:\\Windows\\System32\\svchost.exe (PC) has initiated the restart of computer PC on behalf of user NT AUTHORITY\\SYSTEM for the following reason: Operating System: Service pack (Planned)" }]);
    expect(eventTitle(log.cleanEvents().power[0])).toBe("svchost.exe restarted the PC");
  });

  it("makes a recording for each closer look, from a few minutes before it, and one per day", () => {
    const log = new BackgroundLog();
    const lines: unknown[] = [header(T0)];
    for (let t = T0; t < T0 + 20 * MIN; t += 30 * SEC) lines.push(s(t, 50, 60));
    // At 9:20 the graphics card heats up: a marker, then a reading every five seconds for three minutes.
    const hot = T0 + 20 * MIN;
    lines.push({ k: "anomaly", t: hot, why: "gpu-hot", text: "The graphics card reached 91°C" });
    for (let t = hot; t <= hot + 3 * MIN; t += 5 * SEC) lines.push(s(t, 70, 91, { d: 1 }));
    for (let t = hot + 3 * MIN + 30 * SEC; t < T0 + 40 * MIN; t += 30 * SEC) lines.push(s(t, 50, 60));
    lines.push({ k: "e", t: hot + MIN, log: "System", source: "Display", id: 4101, level: "warning", message: "Display driver nvlddmkm stopped responding and has successfully recovered." });
    log.ingest(lines);

    const recs = backgroundRecordings(log, "pc-1", { gpu: 90 }, T0 + 40 * MIN);
    expect(recs.map((r) => r.id)).toEqual([`bg-a-${hot}`, expect.stringMatching(/^bg-d-20261118$/)]);
    const [look, day] = recs;
    expect(look).toMatchObject({ reason: "The graphics card reached 91°C", state: "done", by: "rig", background: true, startedAt: hot - 5 * MIN, finishedAt: hot + 3 * MIN });
    expect(look.samples[0].t).toBe(hot - 5 * MIN);
    expect(look.events.map((e) => e.kind)).toEqual(["driver"]);
    expect(look.headline).toMatch(/graphics card ran hot|driver/i);
    expect(day.reason).toMatch(/^Background log for /);
    expect(day.minutes).toBe(60);
    expect(recs.every((r) => isBackground(r.id))).toBe(true);
  });

  it("keeps finished days thinned, and only the full readings a closer look shows", () => {
    const DAY = 864e5;
    const top = [{ name: "game.exe", cpu: 40, gpu: 90, memMb: 4000 }];
    const week = (log: BackgroundLog) => {
      const lines: unknown[] = [header(T0 - 6 * DAY)];
      for (let t = T0 - 6 * DAY; t < T0; t += 30 * SEC) lines.push(s(t, 50, t === T0 - 3 * DAY ? 95 : 60, { top }));
      // A closer look two days ago: a marker and readings every five seconds for a minute.
      const look = T0 - 2 * DAY + 5 * MIN;
      lines.push({ k: "anomaly", t: look, why: "gpu-hot", text: "The graphics card reached 91°C" });
      for (let t = look; t <= look + MIN; t += 5 * SEC) lines.push(s(t, 70, 91, { d: 1 }));
      log.ingest(lines.sort((a, b) => (a as { t: number }).t - (b as { t: number }).t));
      return look;
    };
    const kept = new BackgroundLog();
    const look = week(kept);
    const now = T0;
    const recs = backgroundRecordings(kept, "pc-1", { gpu: 90 }, now);

    // The same week made from every reading, the way it was before days were settled.
    const full = new BackgroundLog();
    week(full);
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const byDay = (r: typeof recs) => r.filter((x) => x.id.startsWith("bg-d-") && (x.startedAt ?? 0) < today.getTime());
    const fullRecs = backgroundRecordings(Object.assign(full, { settle: () => {} }), "pc-1", { gpu: 90 }, now);
    expect(byDay(recs).map((r) => [r.id, r.samples.length, r.headline])).toEqual(byDay(fullRecs).map((r) => [r.id, r.samples.length, r.headline]));
    expect(Math.max(...byDay(recs).flatMap((r) => r.samples.map((x) => x.gpu ?? 0)))).toBe(95);
    expect(recs.find((r) => r.id === `bg-a-${look}`)?.samples[0].t).toBe(look - 5 * MIN);

    // Full readings left: today's and the ones around the closer look, not the week's 17,000.
    expect(full.samples.length).toBeGreaterThan(17_000);
    expect(kept.samples.length).toBeLessThan(1500);
    expect(kept.samples.every((x) => x.t >= today.getTime() || Math.abs(x.t - look) <= 3 * 3_600_000)).toBe(true);

    // A new reading today makes only today's recording again: the finished days are the same objects.
    kept.ingest([s(now + 30 * SEC, 50, 60)]);
    const next = backgroundRecordings(kept, "pc-1", { gpu: 90 }, now + MIN);
    for (const r of byDay(recs)) expect(next.find((x) => x.id === r.id)).toBe(r);
  });

  it("keeps every sensor the recorder wrote, not just the six the charts used to show", () => {
    const log = new BackgroundLog();
    const fan = ["/lpc/nct6799d/fan/1", "board", "MSI MAG B650 TOMAHAWK WIFI", "fan", "CPU Fan"];
    log.ingest([
      header(T0), s(T0, 41.26, 52),
      // A fan shows up later (the recorder writes a new list): earlier readings simply don't have it.
      { k: "sensors", t: T0 + MIN, list: [...header(T0).list, fan] },
      { k: "s", t: T0 + MIN, v: [44, 60, 35, 51, 1240] },
    ]);
    const recs = backgroundRecordings(log, "pc-1", { gpu: 90 }, T0 + 2 * MIN);
    const day = recs.find((r) => r.id.startsWith("bg-d-"))!;
    expect(day.sensors?.map((x) => x.name)).toEqual(["Core (Tctl/Tdie)", "GPU Core", "CPU Total", "Memory", "CPU Fan"]);
    expect(day.samples.map((x) => x.all)).toEqual([[41.3, 52, 30, 50], [44, 60, 35, 51, 1240]]);
    // The list of recordings stays light: the sensors come with a recording's readings only.
    expect("sensors" in toInfo(day)).toBe(false);
  });

  it("keeps each sensor's highest reading when it thins a day", () => {
    const day = new Date(2026, 10, 18).getTime();
    const list = Array.from({ length: 2880 }, (_, i) => ({ t: day + i * 30 * SEC, cpu: 50, all: [50, i === 1001 ? 1900 : 900] }));
    const { samples } = thinned(list, day, day + 864e5);
    expect(samples).toHaveLength(360);
    expect(Math.max(...samples.map((x) => x.all![1]!))).toBe(1900);
    expect(samples.every((x) => x.all![0] === 50)).toBe(true);
  });

  it("thins a whole day to what a recording holds, keeping the peaks", () => {
    const day = new Date(2026, 10, 18).getTime();
    const list = Array.from({ length: 2880 }, (_, i) => ({ t: day + i * 30 * SEC, cpu: i === 1000 ? 99 : 50, gpu: null }));
    const { samples, intervalMs } = thinned(list, day, day + 864e5);
    expect(samples).toHaveLength(360);
    expect(intervalMs).toBe(240 * SEC);
    expect(Math.max(...samples.map((x) => x.cpu ?? 0))).toBe(99);
    expect(samples[0].gpu).toBeNull();
  });
});

describe("LocalClient with the background recorder", () => {
  function setup() {
    let t = T0 + 40 * MIN;
    const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => t });
    const lines: unknown[] = [header(T0)];
    for (let x = T0; x < T0 + 10 * MIN; x += 30 * SEC) lines.push(s(x, 50, 60));
    lines.push({ k: "power", t: T0 + MIN, what: "sleep" }, { k: "anomaly", t: T0 + 5 * MIN, why: "cpu-hot", text: "The processor reached 96°C" });
    const reads: (RecorderCursor | null)[] = [];
    // Serves the lines two pages at a time, then whatever was added since.
    const recorder: RecorderLink = {
      status: async () => ({ supported: true, service: "running" }),
      read: async (_from, cursor) => {
        reads.push(cursor);
        const at = cursor?.offset ?? 0;
        const next = Math.min(lines.length, at + Math.ceil(lines.length / 2) + 1);
        return { records: lines.slice(at, next), cursor: { file: "2026-11-18.jsonl", offset: next }, more: next < lines.length };
      },
      set: async () => {},
    };
    const synced: MachineSync[] = [];
    const cloud = { signedIn: async () => true, sync: async (_id: string, p: MachineSync) => { synced.push(p); return {}; }, putRecording: async () => {} } as unknown as CloudClient;
    const client = new LocalClient({ ...sim, hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c), events: async () => [] },
      new MemoryStore(), cloud, { tickMs: 1e9, syncEveryMs: 1e9, now: () => t, recorder, backgroundEveryMs: MIN });
    return { client, lines, reads, synced, advance: (ms: number) => { t += ms; } };
  }

  it("shows the recorder's recordings and events next to its own, and reads only what's new", async () => {
    const { client, lines, reads, advance } = setup();
    await client.start();
    const events = await client.events(client.id);
    expect(events.map((e) => e.source)).toContain("Rig recorder");

    let list: string[] = [];
    const stop = client.watchRecordings(client.id, (l) => { list = l.map((r) => r.id); });
    await new Promise((r) => setTimeout(r, 0));
    expect(list).toEqual([`bg-a-${T0 + 5 * MIN}`, "bg-d-20261118"]);
    const one = await client.recording(client.id, list[0]);
    expect(one?.background).toBe(true);
    expect(one?.samples.length).toBeGreaterThan(5);

    // Two pages on the first read; after that only from where it stopped.
    expect(reads.slice(0, 2)).toEqual([null, expect.objectContaining({ offset: expect.any(Number) })]);
    const before = reads.length;
    lines.push({ k: "anomaly", t: T0 + 30 * MIN, why: "mem-full", text: "Memory was 97% full" });
    await client.events(client.id); // within the minute: no new read
    expect(reads.length).toBe(before);
    advance(MIN);
    await client.events(client.id);
    expect(reads[reads.length - 1]).toEqual({ file: "2026-11-18.jsonl", offset: lines.length - 1 });
    expect(list[0]).toBe(`bg-a-${T0 + 30 * MIN}`);
    stop();
    client.stop();
  });

  it("never sends the recorder's log to the account", async () => {
    const { client, synced } = setup();
    await client.start();
    await client.events(client.id);
    await client.sync();
    client.stop();
    expect(synced.length).toBeGreaterThan(0);
    expect(synced.every((p) => (p.events ?? []).every((e) => e.source !== "Rig recorder"))).toBe(true);
  });

  it("works the same without a recorder", async () => {
    const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts);
    const client = new LocalClient(sim, new MemoryStore(), null, { tickMs: 1e9 });
    await client.start();
    let list: unknown[] | null = null;
    client.watchRecordings(client.id, (l) => { list = l; });
    await new Promise((r) => setTimeout(r, 0));
    client.stop();
    expect(list).toEqual([]);
    expect(RIG_EVENT.unclean).toBe(10);
  });
});
