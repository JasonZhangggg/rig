import { afterEach, describe, expect, it, vi } from "vitest";
import { fixedOffset, gameLibrary, heatBands, heatLevel, heatTrend, minutesUntilHot, sessionHeat, type GameSession, type HistoryPoint } from "../src";
import { DemoClient } from "../src/demo";

const W = 10 * 60_000;
const WEEK = 7 * 864e5;
const start = Date.parse("2026-10-28T18:30:00Z");

/** A session of ten-minute windows with these graphics card peaks, `weeks` after the first. Null leaves a window unread. */
function session(gpus: (number | null)[], weeks = 0, load = 95): GameSession {
  const from = start + weeks * WEEK;
  const points: HistoryPoint[] = gpus.map((gpu, i) => ({ t: from + i * W, cpu: 60, gpu, busy: true, game: "Cyberpunk 2077", gpuLoad: load }));
  return { from, to: from + gpus.length * W, hours: (gpus.length * W) / 36e5, typical: null, peak: null, hot: false, points };
}
/** A session that warms by `step` °C a window from 70, to at most `top`. */
const warming = (windows: number, top: number, weeks: number, step = 2, load?: number) =>
  session(Array.from({ length: windows }, (_, i) => Math.min(top, 70 + i * step)), weeks, load);

describe("minutesUntilHot", () => {
  it("counts whole ten-minute squares to the first one at or past hot", () => {
    const s = session([70, 76, 81, 82, 90]);
    expect(minutesUntilHot(s.points, (p) => p.gpu, 82)).toBe(30);
    expect(minutesUntilHot(s.points, (p) => p.gpu, 70)).toBe(0);
    expect(minutesUntilHot(s.points, (p) => p.gpu, 95)).toBeNull();
    expect(minutesUntilHot([], (p) => p.gpu, 82)).toBeNull();
  });
});

describe("sessionHeat", () => {
  it("colors each square against the safe limit, hot from six degrees under it", () => {
    expect(heatBands(88)).toEqual({ normal: 62, warm: 76, hot: 82 });
    expect([50, 62, 75, 76, 81, 82, 95, null].map((v) => heatLevel(v, heatBands(88)))).toEqual(["cool", "normal", "normal", "warm", "warm", "hot", "hot", null]);
  });

  it("keeps a square for a window Rig didn't read, so the rows stay on one time scale", () => {
    const s = session([70, 80, 84]);
    s.points.splice(1, 1);
    const h = sessionHeat(s, "gpu", 88);
    expect(h.squares.map((q) => q.peak)).toEqual([70, null, 84]);
    expect(h.squares.map((q) => q.level)).toEqual(["normal", null, "hot"]);
    expect(h.hotAfter).toBe(20);
    expect(h.peak).toBe(84);
    expect(h.minutes).toBe(30);
  });
});

describe("heatTrend", () => {
  it("says the card gets hot sooner when the latest session got there well before the first", () => {
    const t = heatTrend([warming(24, 82, 0, 0.5), warming(24, 86, 1, 1), warming(24, 88, 2, 2), warming(24, 90, 3, 3)], "gpu", 88);
    expect(t.story.kind).toBe("sooner");
    if (t.story.kind !== "sooner") return;
    expect(t.story.then.hotAfter).toBeNull();
    expect(t.story.then.from).toBe(start);
    expect(t.story.now.hotAfter).toBe(40);
    expect(t.sameLoad).toBe(true);
  });

  it("counts a first session that never got hot as at least as long as it ran", () => {
    const t = heatTrend([warming(24, 80, 0), warming(24, 84, 1), warming(24, 90, 2)], "gpu", 88);
    expect(t.story.kind).toBe("sooner");
    if (t.story.kind === "sooner") expect([t.story.then.hotAfter, t.story.now.hotAfter]).toEqual([null, 60]);
  });

  it("notices when the card worked harder in the latest session", () => {
    const t = heatTrend([warming(24, 80, 0, 2, 60), warming(24, 84, 1, 2, 80), warming(24, 90, 2, 2, 97)], "gpu", 88);
    expect(t.sameLoad).toBe(false);
  });

  it("says heat comes later after it got better, and stays quiet about a trend in two sessions", () => {
    expect(heatTrend([warming(24, 90, 0, 3), warming(24, 86, 1), warming(24, 80, 2)], "gpu", 88).story.kind).toBe("later");
    const two = heatTrend([warming(24, 80, 0), warming(24, 90, 1, 3)], "gpu", 88);
    expect(two.story).toMatchObject({ kind: "latest", range: null });
    expect(two.sameLoad).toBe(true);
  });

  it("says it's about the same when every session got hot within twenty minutes of the others", () => {
    const t = heatTrend([warming(18, 88, 0, 2), warming(18, 88, 1, 2.5), warming(18, 88, 2, 2)], "gpu", 88);
    expect(t.story).toEqual({ kind: "same", hotAfter: 60, since: start });
  });

  it("says the card stayed cool when no session came near the limit", () => {
    expect(heatTrend([warming(12, 75, 0), warming(12, 78, 1)], "gpu", 88).story).toEqual({ kind: "cool", sessions: 2 });
  });

  afterEach(() => { vi.useRealTimers(); });

  it("finds heat arriving sooner in the demo, where dust builds up over the month", async () => {
    // The demo's game sessions follow the clock, and late in the day (UTC) the newest one tells a different story, so this runs at a fixed midday.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    const client = new DemoClient();
    const now = Date.now();
    const points = await client.history("demo-atlas", "30d");
    const lib = gameLibrary(points, { now, offset: fixedOffset(0), kind: "tower", limits: { cpu: 95, gpu: 88 } });
    const cyberpunk = lib.games.find((g) => g.name === "Cyberpunk 2077")!;
    const t = heatTrend(cyberpunk.sessions, lib.subject, lib.limit);
    expect(t.story.kind).toBe("sooner");
    if (t.story.kind !== "sooner") return;
    expect(t.story.now.hotAfter!).toBeLessThan(t.story.then.hotAfter ?? t.story.then.minutes);
    expect(t.sameLoad).toBe(true);
    // The first square of a session is the card still warming up, not hot.
    expect(t.sessions.every((s) => s.squares[0].level !== "hot")).toBe(true);
    expect(heatTrend(lib.games.find((g) => g.name === "Baldur's Gate 3")!.sessions, lib.subject, lib.limit).story.kind).toBe("cool");
  });
});
