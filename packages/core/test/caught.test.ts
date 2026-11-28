import { describe, expect, it } from "vitest";
import { caughtProblem, cleanEvents, summarise, gameNormal, type HistoryPoint, type RawEvent, type RecordingSample } from "../src";
import { DEMO_RECORDING_ID, DemoClient } from "../src/demo";

const MIN = 60_000;
const DAY = 864e5;
const T0 = new Date(2026, 10, 25, 20, 0).getTime();
const reset = (t: number): RawEvent => ({ t, log: "System", source: "Display", id: 4101, level: "warning", message: "Display driver nvlddmkm stopped responding and has successfully recovered." });
/** One sample every ten seconds for `minutes`, from a function of the minute. */
const run = (minutes: number, f: (m: number) => Partial<RecordingSample>): RecordingSample[] =>
  Array.from({ length: minutes * 6 + 1 }, (_, i) => ({ t: T0 + i * 10_000, game: "Cyberpunk 2077", cpu: 60, cpuLoad: 55, gpuLoad: 97, mem: 40, ...f(i / 6) }));
/** Cyberpunk windows from three weeks before T0, at 78 to 84°C. */
const usualHistory = (): HistoryPoint[] => Array.from({ length: 24 }, (_, i) => ({ t: T0 - 21 * DAY + i * 10 * MIN, cpu: 58, gpu: 78 + (i % 7), busy: true, game: "Cyberpunk 2077" }));
const recOf = (samples: RecordingSample[], events: RawEvent[]) => ({ samples, events: cleanEvents(events), intervalMs: 10_000, startedAt: T0 });
const limits = { cpu: 95, gpu: 88 };

describe("what a recording caught", () => {
  it("says the laptop turned off, not the PC, on a laptop", () => {
    const off: RawEvent = { t: T0 + 10 * MIN, log: "System", source: "Microsoft-Windows-Kernel-Power", id: 41, level: "critical", message: "The system has rebooted without cleanly shutting down first." };
    const rec = recOf(run(15, () => ({})), [off]);
    const sum = summarise(rec, limits);
    const laptop = caughtProblem(rec, sum, { limits, kind: "laptop" })!;
    expect(laptop.what).toBe("the laptop turned off");
    expect(laptop.summary).toMatch(/when the laptop turned off\./);
    expect(caughtProblem(rec, sum, { limits })!.what).toBe("the PC turned off");
  });

  it("tells the demo's black screen as heat, with the game's usual range, what it ruled out and when it happened before", async () => {
    const c = new DemoClient();
    const rec = (await c.recording("demo-atlas", DEMO_RECORDING_ID))!;
    const history = await c.history("demo-atlas", "30d");
    const events = await c.events("demo-atlas");
    const sum = summarise(rec, limits);
    const caught = caughtProblem(rec, sum, { limits, history, events })!;
    expect(caught.title).toBe("The black screen, caught");
    expect(caught.cause).toBe("heat");
    expect(caught.headline).toBe("Heat most likely set it off");
    expect(caught.usualAt?.game).toBe("Cyberpunk 2077");
    expect(caught.measure).toBe("usual");
    // Inside the stretch above the usual range, and above its top.
    expect(caught.during!.from).toBeLessThan(caught.event.t);
    expect(caught.at!).toBeGreaterThan(caught.usualAt!.hi);
    expect(caught.summary).toMatch(/^The graphics card had been above your normal for Cyberpunk 2077 for \d+ minutes and was at \d+°C when the graphics driver reset\./);
    expect(caught.checks.map((x) => [x.id, x.ok])).toEqual([["cpu", true], ["memory", true], ["apps", true], ["power", true]]);
    expect(caught.checks.find((x) => x.id === "apps")!.detail).toMatch(/^Only Cyberpunk 2077 was busy/);
    expect(caught.stall).not.toBeNull();
    expect(caught.stall!.to - caught.stall!.from).toBeLessThanOrEqual(30_000);
    // The reset a week earlier, logged when Rig wasn't recording.
    expect(caught.earlier).toHaveLength(1);
    expect(caught.earlier[0].t).toBeLessThan(rec.startedAt!);
  });

  it("says heat doesn't explain it when the part stayed inside its usual range", () => {
    const samples = run(30, () => ({ gpu: 81 }));
    const rec = recOf(samples, [reset(T0 + 20 * MIN)]);
    const caught = caughtProblem(rec, summarise(rec, limits), { limits, history: usualHistory() })!;
    expect(caught.cause).toBe("unclear");
    expect(caught.above).toEqual([]);
    expect(caught.headline).toBe("Nothing in the readings explains it");
    expect(caught.summary).toBe("The graphics card was at 81°C, inside your normal for Cyberpunk 2077, when the graphics driver reset. Nothing else Rig watched was out of the ordinary either.");
  });

  it("counts minutes above the usual range up to the event, and a reading that flickers over not at all", () => {
    const samples = run(30, (m) => ({ gpu: m < 12 ? (Math.round(m * 6) % 6 === 0 ? 85 : 80) : 86 }));
    const rec = recOf(samples, [reset(T0 + 20 * MIN)]);
    const caught = caughtProblem(rec, summarise(rec, limits), { limits, history: usualHistory() })!;
    expect(caught.usualAt).toMatchObject({ lo: 78, hi: 84 });
    expect(caught.above).toHaveLength(1);
    expect(Math.abs(caught.above[0].from - (T0 + 12 * MIN))).toBeLessThanOrEqual(30_000);
    expect(caught.summary).toMatch(/above your normal for Cyberpunk 2077 for 8 minutes and was at 86°C/);
  });

  it("falls back to the safe limit with no history, and names another busy app or a gap in the readings", () => {
    const samples = run(30, (m) => ({ gpu: 84, top: [{ name: "Cyberpunk2077.exe", cpu: 40, memMb: 9000, gpu: 95 }, { name: "obs64.exe", cpu: m > 10 ? 35 : 5, memMb: 800 }] }))
      .filter((s) => s.t < T0 + 22 * MIN || s.t > T0 + 26 * MIN);
    const rec = recOf(samples, [reset(T0 + 20 * MIN)]);
    const caught = caughtProblem(rec, summarise(rec, limits), { limits })!;
    expect(caught.measure).toBe("limit");
    expect(caught.cause).toBe("heat");
    expect(caught.summary).toMatch(/within 6° of its 88°C limit/);
    expect(caught.checks.find((x) => x.id === "apps")).toMatchObject({ ok: false, title: "Obs64 was busy too" });
    expect(caught.checks.find((x) => x.id === "power")).toMatchObject({ ok: false, title: "The readings stopped for a while" });
  });

  it("is null for a recording that caught nothing serious", () => {
    const rec = recOf(run(10, () => ({ gpu: 70 })), []);
    expect(caughtProblem(rec, summarise(rec, limits), { limits })).toBeNull();
  });

  it("takes the usual range from a few weeks before, or every earlier session when those are too few", () => {
    const old = usualHistory();
    const lately: HistoryPoint[] = Array.from({ length: 12 }, (_, i) => ({ t: T0 - 3 * DAY + i * 10 * MIN, cpu: 58, gpu: 89, busy: true, game: "Cyberpunk 2077" }));
    expect(gameNormal([...old, ...lately], "Cyberpunk 2077", "gpu", T0)).toMatchObject({ lo: 78, hi: 84, windows: 24 });
    expect(gameNormal(lately, "Cyberpunk 2077", "gpu", T0)).toMatchObject({ lo: 89, hi: 89, windows: 12 });
    expect(gameNormal(lately.slice(0, 3), "Cyberpunk 2077", "gpu", T0)).toBeNull();
  });
});
