// A laptop's battery: how long it lasts, what drained it today, and the
// reversible changes that would stretch it, as the battery page shows them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  batterySavers, batteryView, buildPC, drainStory, HistoryWindow, LocalClient, MemoryStore, readBattery, timeLeft,
  type HistoryPoint, type Sensor, type Snapshot, type SystemFacts,
} from "../src";
import { DemoClient, SimulatedLink, fixtures } from "../src/demo";

const MIN = 60_000;
const pebble = fixtures.pebble.inv;
const atlas = fixtures.atlas.inv;

const sensor = (type: Sensor["type"], name: string, value: number): Sensor => ({ id: `/battery/0/${type}/${name}`, hw: "battery", hwName: "ASUS Battery", type, name, value });
const snap = (sensors: Sensor[], at = Date.now()): Snapshot => ({ at, sensors, elevated: true });
const onBattery = (level: number, watts: number, at?: number) => snap([sensor("level", "Charge Level", level), sensor("power", "Discharge Rate", watts)], at);

describe("reading the battery", () => {
  it("knows which way the power goes from LibreHardwareMonitor's names, or from the sign", () => {
    expect(readBattery(onBattery(58, 11))).toEqual({ level: 58, state: "discharging", watts: 11 });
    expect(readBattery(snap([sensor("level", "Charge Level", 40), sensor("power", "Charge Rate", 45)]))).toEqual({ level: 40, state: "charging", watts: 45 });
    expect(readBattery(snap([sensor("level", "Charge Level", 70), sensor("power", "Charge/Discharge Rate", -9.5)]))).toMatchObject({ state: "discharging", watts: 9.5 });
    expect(readBattery(snap([sensor("level", "Charge Level", 100), sensor("power", "Charge/Discharge Rate", 0)]))).toMatchObject({ state: "plugged", watts: 0 });
    expect(readBattery(snap([sensor("level", "Charge Level", 64)]))).toEqual({ level: 64, state: null, watts: null });
    expect(readBattery(snap([]))).toBeNull();
  });
});

describe("time left", () => {
  it("says how long it lasts at the rate it's going, and the last hour's average when that's quite different", () => {
    expect(timeLeft({ level: 58, state: "discharging", watts: 11 }, 66.8)).toEqual({ text: "About 3 h 30 min left at this rate", figure: "3 h 30 min", label: "Left on battery", basis: "at this rate" });
    expect(timeLeft({ level: 58, state: "discharging", watts: 11 }, 66.8, 16)?.note).toBe("At the last hour's average it would last about 2 h 30 min");
    // Close to the rate now: nothing more to say.
    expect(timeLeft({ level: 58, state: "discharging", watts: 11 }, 66.8, 11.5)?.note).toBeUndefined();
    expect(timeLeft({ level: 8, state: "discharging", watts: 12 }, 66.8)?.text).toBe("About 25 min left at this rate");
  });

  it("says when it will be full while charging, counting the slower last fifth", () => {
    expect(timeLeft({ level: 40, state: "charging", watts: 45 }, 66.8)).toEqual({ text: "Full in about 1 h 10 min", figure: "1 h 10 min", label: "Until full" });
    expect(timeLeft({ level: 90, state: "charging", watts: 20 }, 66.8)?.text).toBe("Full in about 20 min");
    expect(timeLeft({ level: 100, state: "plugged", watts: 0 }, 66.8)?.text).toBe("Plugged in and full");
    expect(timeLeft({ level: 80, state: "plugged", watts: 0 }, 66.8)?.text).toBe("Plugged in, holding at 80%");
  });

  it("says nothing rather than guess when a rate or the capacity is missing", () => {
    expect(timeLeft({ level: 58, state: null, watts: null }, 66.8)).toBeNull();
    expect(timeLeft({ level: 58, state: "discharging", watts: 11 }, undefined)).toBeNull();
    expect(timeLeft({ level: 58, state: "charging", watts: 0 }, 66.8)).toBeNull();
    // Nearly nothing drawn: a day and more says more about a quiet moment than the battery.
    expect(timeLeft({ level: 90, state: "discharging", watts: 0.6 }, 66.8)).toBeNull();
    // No rate now, but the last hour has one.
    expect(timeLeft({ level: 58, state: "discharging", watts: null }, 66.8, 11)?.text).toBe("About 3 h 30 min left at the last hour's rate");
  });
});

/** Ten-minute windows from a local time: plugged in and full, then on battery at the given watts, each with its busy apps. */
function day(start: string, plugged: number, drains: number[], apps: (i: number) => string[] = () => []): HistoryPoint[] {
  const t0 = new Date(start).getTime();
  const out: HistoryPoint[] = [];
  for (let i = 0; i < plugged; i++) out.push({ t: t0 + i * 10 * MIN, cpu: 50, gpu: null, busy: false, batt: 100, drain: null });
  let level = 100;
  drains.forEach((w, i) => {
    level -= (w / 6 / 66.8) * 100;
    const a = apps(i);
    out.push({ t: t0 + (plugged + i) * 10 * MIN, cpu: 55, gpu: null, busy: false, batt: Math.round(level), drain: w, ...(a.length ? { apps: a } : {}) });
  });
  return out;
}

describe("what drained it today", () => {
  // Plugged in until 11 AM, then an hour of light work, an hour-long call 12 to 1, and steady work since.
  const light = Array(6).fill(8), call = Array(6).fill(18), work = Array(5).fill(11);
  const history = day("2026-11-28T10:00:00", 6, [...light, ...call, ...work], (i) => (i >= 6 && i < 12 ? ["ms-teams.exe", "chrome.exe"] : i >= 12 ? ["chrome.exe", "EXCEL.EXE"] : []));
  const now = new Date("2026-11-28T13:50:00").getTime();

  it("tells where the charge went and when it fell fastest, with what was busy then", () => {
    expect(drainStory(history, now, { level: 47, state: "discharging", watts: 11 }))
      .toBe("Went from 100% to 47% in 2 h 50 min. The fastest drop was 12–1 PM, while Teams and Chrome were busy.");
  });

  it("leaves out what the history doesn't back: no apps, or no hour that stands out", () => {
    const noApps = history.map(({ apps: _a, ...p }) => p);
    expect(drainStory(noApps, now, { level: 47, state: "discharging", watts: 11 })).toBe("Went from 100% to 47% in 2 h 50 min. The fastest drop was 12–1 PM.");
    const even = day("2026-11-28T10:00:00", 6, Array(17).fill(11));
    expect(drainStory(even, now, { level: 47, state: "discharging", watts: 11 })).toMatch(/^Went from 100% to \d+% in 2 h 50 min\.$/);
  });

  it("tells an earlier stretch once it's back on the charger, but not yesterday's", () => {
    const back = [...history, { t: history[history.length - 1].t + 10 * MIN, cpu: 40, gpu: null, busy: false, batt: 47, drain: null }];
    expect(drainStory(back, now + 20 * MIN, { level: 60, state: "charging", watts: 45 })).toMatch(/^Earlier today it went from 100% to 47% in 2 h 50 min on battery\. The fastest drop was 12–1 PM/);
    expect(drainStory(history, now + 864e5, { level: 100, state: "plugged", watts: 0 })).toBeNull();
  });

  it("says nothing with too little time on battery", () => {
    expect(drainStory(day("2026-11-28T13:00:00", 3, [9, 9]), now, { level: 96, state: "discharging", watts: 9 })).toBeNull();
    expect(drainStory([], now, { level: 96, state: "discharging", watts: 9 })).toBeNull();
  });
});

describe("ways to stretch it", () => {
  const facts = fixtures.pebble.facts as SystemFacts;
  const power = { displayOffAfter: { ac: 600, dc: 900 }, sleepAfter: { ac: 1800, dc: 0 } };

  it("offers only what would change something on this PC, on battery only where the fix allows it", () => {
    const savers = batterySavers(pebble, facts, power);
    expect(savers.map((s) => s.title)).toEqual(["Turn off processor boost on battery", "Turn the screen off after 5 minutes on battery", "Sleep after 15 minutes on battery"]);
    expect(savers[0].fix).toEqual([{ kind: "power.maxProcessorState", ac: 100, dc: 99 }]);
    // Plugged in keeps what it has.
    expect(savers[1].fix).toEqual([{ kind: "power.setting", subgroup: "7516b95f-f776-4464-8c53-06167f40cc99", setting: "3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e", ac: 600, dc: 300 }]);
    expect(savers[2].meta).toBe("Now it never sleeps on battery when left alone.");

    const tuned = batterySavers(pebble, { ...facts, maxProcessorState: { ac: 100, dc: 99 } }, { displayOffAfter: { ac: 600, dc: 300 }, sleepAfter: { ac: 1800, dc: 900 } });
    expect(tuned).toEqual([]);
    // Settings it couldn't read aren't guessed at.
    expect(batterySavers(pebble, facts).map((s) => s.id)).toEqual(["boost"]);
  });

  it("suggests the Balanced plan over High performance, and at most three", () => {
    const plans = [{ guid: "381b4222-f694-41f0-9685-ff5bb260df2e", name: "Balanced", active: false }, { guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", name: "High performance", active: true }];
    const savers = batterySavers(pebble, { ...facts, powerPlans: plans }, power);
    expect(savers.map((s) => s.id)).toEqual(["boost", "plan", "screen"]);
    expect(savers[1]).toMatchObject({ title: "Switch to the Balanced plan", fix: [{ kind: "power.plan", guid: plans[0].guid }] });
  });

  it("has nothing for a desktop", () => {
    expect(batterySavers(atlas, fixtures.atlas.facts as SystemFacts, power)).toEqual([]);
    expect(batteryView(atlas, onBattery(58, 11), fixtures.atlas.facts as SystemFacts)).toBeUndefined();
    expect(buildPC(atlas, onBattery(58, 11), fixtures.atlas.facts as SystemFacts).battery).toBeUndefined();
  });
});

describe("the battery in history and on the PC view", () => {
  // The demo laptop follows its usual week unless it's on battery; at 10 AM on a Thursday it's at work, on battery since a little before 8.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 10, 26, 10, 0)); });
  afterEach(() => vi.useRealTimers());

  it("keeps the level, the draw and the busy apps while on battery, and nothing for a desktop", () => {
    const w = new HistoryWindow(0);
    w.add(onBattery(60, 10, 0));
    w.add(onBattery(59, 12.5, 30_000));
    w.addApps([{ name: "chrome.exe", cpu: 9, memMb: 2000 }, { name: "dwm.exe", cpu: 8, memMb: 100 }, { name: "Spotify.exe", cpu: 1, memMb: 300 }]);
    w.addApps([{ name: "chrome.exe", cpu: 7, memMb: 2000 }, { name: "ms-teams.exe", cpu: 12, memMb: 1300 }]);
    expect(w.point()).toMatchObject({ batt: 59, drain: 11.3, apps: ["chrome.exe", "ms-teams.exe"] });

    const plugged = new HistoryWindow(0);
    plugged.add(snap([sensor("level", "Charge Level", 100), sensor("power", "Charge/Discharge Rate", 0)]));
    plugged.addApps([{ name: "chrome.exe", cpu: 30, memMb: 2000 }]);
    expect(plugged.point()).toMatchObject({ batt: 100, drain: null });
    expect(plugged.point().apps).toBeUndefined();

    const tower = new HistoryWindow(0);
    tower.add(snap([]));
    expect(Object.keys(tower.point())).not.toContain("batt");
  });

  it("shows the demo laptop on battery with a story and savers, and nothing on the demo desktop", async () => {
    const demo = new DemoClient();
    const [a, p] = await demo.machines();
    expect(a.battery).toBeUndefined();
    expect(p.battery).toMatchObject({ level: 58, state: "discharging", time: { label: "Left on battery" } });
    expect(p.battery!.watts).toBeGreaterThan(9);
    expect(p.battery!.watts).toBeLessThan(14);
    expect(p.battery!.time!.text).toMatch(/^About \d+ h( \d+ min)? left at this rate$/);
    expect(p.battery!.story).toMatch(/^Went from 100% to 58% in 2 h [12]0 min\. The fastest drop was .+, while (Teams and Chrome|Chrome and Teams) were busy\.$/);
    expect(p.battery!.savers.map((s) => s.id)).toEqual(["boost", "screen", "sleep"]);
  });

  it("goes through the review and undo like any fix, and a saver that's done leaves the list", async () => {
    const demo = new DemoClient();
    DemoClient.pace = 0;
    const pc = () => demo.machines().then((l) => l.find((x) => x.id === "demo-pebble")!);
    const screen = (await pc()).battery!.savers.find((s) => s.id === "screen")!;
    expect(await demo.preview("demo-pebble", [{ kind: "fix", call: screen.fix[0] }])).toEqual([["Turn off the screen after (plugged in / battery)", "10 minutes / 15 minutes", "10 minutes / 5 minutes"]]);
    const change = await demo.apply("demo-pebble", [{ kind: "fix", call: screen.fix[0] }], { by: "you", why: screen.title });
    expect((await pc()).battery!.savers.map((s) => s.id)).toEqual(["boost", "sleep"]);
    await demo.undo("demo-pebble", change.id);
    expect((await pc()).battery!.savers.map((s) => s.id)).toEqual(["boost", "screen", "sleep"]);
  });

  it("on the desktop app, reads a laptop's power settings for the savers and reads them again after a change", async () => {
    let t = Date.now();
    const link = new SimulatedLink(pebble, fixtures.pebble.facts, { now: () => t });
    const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => (t += 1000) });
    await client.start();
    const view = () => client.view().battery!;
    expect(view()).toMatchObject({ state: "discharging", level: expect.any(Number) });
    expect(view().savers.map((s) => s.id)).toEqual(["boost", "screen", "sleep"]);
    const sleep = view().savers.find((s) => s.id === "sleep")!;
    await client.apply(client.id, [{ kind: "fix", call: sleep.fix[0] }], { by: "you" });
    expect(view().savers.map((s) => s.id)).toEqual(["boost", "screen"]);
    client.stop();
  });
});
