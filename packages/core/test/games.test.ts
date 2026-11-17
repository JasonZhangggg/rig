import { describe, expect, it } from "vitest";
import { fixedOffset, gameLibrary, type HistoryPoint, type InsightContext } from "../src";

// New York in November: five hours behind UTC.
/** A local wall-clock time in New York as milliseconds since epoch. */
const at = (local: string) => Date.parse(`${local}:00Z`) + 5 * 36e5;

const ctx = (over: Partial<InsightContext> = {}): InsightContext => ({
  now: at("2026-11-17T20:30"), offset: fixedOffset(-300), kind: "tower", limits: { cpu: 95, gpu: 88 }, ...over,
});

function windows(from: string, to: string, p: Partial<HistoryPoint> = {}): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let t = at(from); t < at(to); t += 10 * 60_000) out.push({ t, cpu: 44, gpu: 36, busy: false, ...p });
  return out;
}
const game = (name: string, gpu: number, cpu = 66) => ({ busy: true, game: name, gpu, cpu });

/** Wed 11 to Tue 17 November: Cyberpunk runs close to the limit, Counter-Strike twice, Baldur's Gate past midnight. */
const week: HistoryPoint[] = [
  ...windows("2026-11-11T08:00", "2026-11-11T18:00"),
  ...windows("2026-11-11T19:00", "2026-11-11T22:00", game("Cyberpunk 2077", 85, 70)),
  ...windows("2026-11-12T20:00", "2026-11-12T22:00", game("Counter-Strike 2", 72)),
  ...windows("2026-11-14T21:00", "2026-11-15T01:30", game("Baldur's Gate 3", 76)),
  ...windows("2026-11-16T20:00", "2026-11-16T21:00", { busy: true, gpu: 55, cpu: 60 }),
  ...windows("2026-11-17T19:00", "2026-11-17T20:30", game("Counter-Strike 2", 74)),
];

describe("gameLibrary", () => {
  it("lists each game most played first, with its sessions and graphics card temperatures", () => {
    const lib = gameLibrary(week, ctx());
    expect(lib.subject).toBe("gpu");
    expect(lib.limit).toBe(88);
    expect(lib.hours).toBe(4.5 + 3.5 + 3);
    expect(lib.games.map(({ name, hours, lastPlayed, typical, peak, headroom }) => ({ name, hours, lastPlayed, typical, peak, headroom }))).toEqual([
      { name: "Baldur's Gate 3", hours: 4.5, lastPlayed: at("2026-11-15T01:30"), typical: 76, peak: 76, headroom: 12 },
      { name: "Counter-Strike 2", hours: 3.5, lastPlayed: at("2026-11-17T20:30"), typical: 72, peak: 74, headroom: 14 },
      { name: "Cyberpunk 2077", hours: 3, lastPlayed: at("2026-11-11T22:00"), typical: 85, peak: 85, headroom: 3 },
    ]);
    const cs = lib.games[1];
    expect(cs.sessions.map(({ from, to, hours, typical, peak, hot }) => ({ from, to, hours, typical, peak, hot }))).toEqual([
      { from: at("2026-11-12T20:00"), to: at("2026-11-12T22:00"), hours: 2, typical: 72, peak: 72, hot: false },
      { from: at("2026-11-17T19:00"), to: at("2026-11-17T20:30"), hours: 1.5, typical: 74, peak: 74, hot: false },
    ]);
    expect(cs.sessions[0].points).toHaveLength(12);
    expect(lib.games[2].sessions[0].hot).toBe(true);
  });

  it("leaves busy windows without a game out", () => {
    expect(gameLibrary(windows("2026-11-16T20:00", "2026-11-16T21:00", { busy: true, gpu: 55 }), ctx()).games).toEqual([]);
  });

  it("says how a game compares with the others only when the gap is real", () => {
    const notes = Object.fromEntries(gameLibrary(week, ctx()).games.map((g) => [g.name, g.notes]));
    expect(notes["Cyberpunk 2077"]).toEqual([
      { kind: "hotter", by: 9 },
      { kind: "near-limit", at: at("2026-11-11T19:00"), peak: 85, under: 3 },
    ]);
    expect(notes["Counter-Strike 2"]).toEqual([{ kind: "cooler", by: 4 }]);
    expect(notes["Baldur's Gate 3"]).toEqual([]);
  });

  it("makes no comparison without enough of the other games to compare with", () => {
    const pts = [
      ...windows("2026-11-16T19:00", "2026-11-16T21:00", game("Hades II", 80)),
      ...windows("2026-11-16T21:00", "2026-11-16T21:30", game("Balatro", 50)),
    ];
    expect(gameLibrary(pts, ctx()).games.flatMap((g) => g.notes)).toEqual([]);
  });

  it("says when a game went over the safe limit", () => {
    const pts = [...windows("2026-11-16T19:00", "2026-11-16T19:30", game("Hades II", 80)), ...windows("2026-11-16T19:30", "2026-11-16T19:40", game("Hades II", 90))];
    expect(gameLibrary(pts, ctx()).games[0].notes).toEqual([{ kind: "near-limit", at: at("2026-11-16T19:30"), peak: 90, under: -2 }]);
    expect(gameLibrary(pts, ctx()).games[0].headroom).toBe(-2);
  });

  it("notices when the latest sessions run warmer than the earliest", () => {
    const pts = [
      ...windows("2026-11-11T19:00", "2026-11-11T20:00", game("Hades II", 70)),
      ...windows("2026-11-12T19:00", "2026-11-12T20:00", game("Hades II", 71)),
      ...windows("2026-11-15T19:00", "2026-11-15T20:00", game("Hades II", 75)),
      ...windows("2026-11-16T19:00", "2026-11-16T20:00", game("Hades II", 76)),
    ];
    const [g] = gameLibrary(pts, ctx()).games;
    expect(g.sessions).toHaveLength(4);
    expect(g.notes).toEqual([{ kind: "warming", by: 5 }]);
  });

  it("joins a game's windows across one window without it and splits them across two", () => {
    const pts = [
      ...windows("2026-11-16T19:00", "2026-11-16T20:00", game("Hades II", 70)),
      ...windows("2026-11-16T20:10", "2026-11-16T21:00", game("Hades II", 70)),
      ...windows("2026-11-16T21:20", "2026-11-16T22:00", game("Hades II", 70)),
    ];
    expect(gameLibrary(pts, ctx()).games[0].sessions.map((s) => s.hours)).toEqual([2, 2 / 3]);
  });

  it("describes the processor on a laptop", () => {
    const lib = gameLibrary(windows("2026-11-16T19:00", "2026-11-16T20:00", { busy: true, game: "Minecraft", cpu: 82, gpu: null }), ctx({ kind: "laptop" }));
    expect(lib.subject).toBe("cpu");
    expect(lib.limit).toBe(95);
    expect(lib.games[0]).toMatchObject({ typical: 82, peak: 82, headroom: 13 });
  });

  it("stops at now", () => {
    const lib = gameLibrary(windows("2026-11-17T20:00", "2026-11-17T21:30", game("Hades II", 70)), ctx());
    expect(lib.games[0].hours).toBe(0.5);
    expect(lib.games[0].lastPlayed).toBe(at("2026-11-17T20:30"));
  });

  it("is empty without history", () => {
    expect(gameLibrary([], ctx())).toEqual({ subject: "cpu", limit: 95, games: [], hours: 0 });
  });
});
