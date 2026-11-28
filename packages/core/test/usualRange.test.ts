import { describe, expect, it } from "vitest";
import { headroom, standing, tempZones, usualRange, zoneOf, type HistoryPoint } from "../src";

const NOW = Date.parse("2026-11-26T20:00:00Z");
const MIN = 60_000, DAY = 864e5;

/** Ten-minute windows, `n` of them, ending `ago` ms before now, each with the given readings in turn. */
function windows(ago: number, gpus: number[], p: Partial<HistoryPoint> = {}): HistoryPoint[] {
  return gpus.map((gpu, i) => ({ t: NOW - ago - (gpus.length - i) * 10 * MIN, cpu: 50, gpu, busy: false, ...p }));
}
const playing = (game: string | null) => ({ busy: true, game });

describe("usualRange", () => {
  const rest = windows(2 * DAY, [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 60]);
  const games = windows(DAY, [70, 72, 74, 74, 75, 76, 77, 78, 79, 86], playing("Cyberpunk 2077"));

  it("gives the middle half of the week's busy and resting readings, leaving out the odd spike", () => {
    const r = usualRange([...rest, ...games], "gpu", NOW);
    expect(r.busy).toEqual({ low: 74, high: 78, count: 10 });
    expect(r.resting).toEqual({ low: 43, high: 48, count: 11 });
    expect(r.gaming).toBe(true);
    expect(r.peak).toEqual({ temp: 86, at: games[9].t, game: "Cyberpunk 2077" });
  });

  it("only reads the last week, and the part asked for", () => {
    const old = windows(8 * DAY, [95, 95, 95, 95, 95, 95], playing("Old game"));
    const r = usualRange([...old, ...games], "gpu", NOW);
    expect(r.peak?.temp).toBe(86);
    expect(r.busy?.count).toBe(10);
    expect(usualRange(games, "cpu", NOW).busy).toEqual({ low: 50, high: 50, count: 10 });
  });

  it("has no range from under an hour of readings, and calls heavy work without a game busy, not gaming", () => {
    const r = usualRange(windows(0, [70, 71, 72, 73, 74], playing(null)), "gpu", NOW);
    expect(r.busy).toBeNull();
    expect(r.gaming).toBe(false);
    expect(r.peak?.temp).toBe(74);
    const none = usualRange([], "gpu", NOW);
    expect(none).toEqual({ part: "gpu", busy: null, gaming: false, resting: null, peak: null });
  });

  it("skips windows where the part gave no reading", () => {
    const r = usualRange(windows(0, [70, 70, 70, 70, 70, 70], { busy: true, gpu: null }), "gpu", NOW);
    expect(r.busy).toBeNull();
    expect(r.peak).toBeNull();
  });
});

describe("zones", () => {
  it("splits cool to the limit into four plain stretches, near the limit being the last 6°", () => {
    expect(tempZones(88, 25)).toEqual([
      { id: "cool", from: 25, to: 50 }, { id: "normal", from: 50, to: 76 }, { id: "warm", from: 76, to: 82 }, { id: "near", from: 82, to: 88 },
    ]);
    expect(zoneOf(45, 88)).toBe("cool");
    expect(zoneOf(76, 88)).toBe("warm");
    expect(zoneOf(88, 88)).toBe("near");
    expect(zoneOf(89, 88)).toBe("over");
  });
});

describe("headroom", () => {
  const range = usualRange([...windows(DAY, [70, 72, 74, 74, 75, 76, 77, 78, 79, 86], playing("Cyberpunk 2077"))], "gpu", NOW);

  it("counts from the week's hottest when that's hotter than now, and says what a typical game leaves", () => {
    expect(headroom(45, 88, range)).toEqual({ degrees: 2, from: "week", temp: 86, at: range.peak!.at, game: "Cyberpunk 2077", typical: 10 });
  });

  it("counts from now when now is the hottest, and goes negative past the limit", () => {
    expect(headroom(90, 88, range)).toMatchObject({ degrees: -2, from: "now", temp: 90 });
    expect(headroom(60, 88, null)).toEqual({ degrees: 28, from: "now", temp: 60 });
    expect(headroom(undefined, 88, null)).toBeNull();
  });
});

describe("standing", () => {
  const range = usualRange([
    ...windows(2 * DAY, [40, 41, 42, 43, 44, 45, 46, 47, 48, 49]),
    ...windows(DAY, [70, 72, 74, 74, 75, 76, 77, 78, 79, 80], playing("Baldur's Gate 3")),
  ], "gpu", NOW);

  it("places a reading against the usual ranges, the limit first", () => {
    expect(standing(90, 88, range)).toBe("over");
    expect(standing(84, 88, range)).toBe("near");
    expect(standing(81, 88, range)).toBe("above");
    expect(standing(75, 88, range)).toBe("busy");
    expect(standing(60, 88, range)).toBe("between");
    expect(standing(45, 88, range)).toBe("resting");
    expect(standing(35, 88, range)).toBe("below");
    expect(standing(45, 88, null)).toBe("unknown");
  });
});
