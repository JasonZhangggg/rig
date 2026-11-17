import { describe, expect, it } from "vitest";
import { fixedOffset, insightContext, fanTrend, weekEvenings, weekTemps, type HistoryPoint, type InsightContext, type UtcOffset } from "../src";

// New York in November: five hours behind UTC.
const ny = fixedOffset(-300);
/** A local wall-clock time in New York as milliseconds since epoch. */
const at = (local: string) => Date.parse(`${local}:00Z`) + 5 * 36e5;

const ctx = (over: Partial<InsightContext> = {}): InsightContext => ({
  now: at("2026-11-17T20:30"), offset: ny, kind: "tower", limits: { cpu: 95, gpu: 88 }, ...over,
});

/** Ten-minute history windows from one local time up to (not including) another. */
function windows(from: string, to: string, p: Partial<HistoryPoint> = {}): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let t = at(from); t < at(to); t += 10 * 60_000) out.push({ t, cpu: 44, gpu: 36, busy: false, ...p });
  return out;
}
const quietDay = (day: string) => windows(`${day}T08:00`, `${day}T18:00`);
const game = (name: string, gpu: number, cpu = 66) => ({ busy: true, game: name, gpu, cpu, fan: 2000 });

/** Wed 11 to Tue 17 November. The PC was off on Friday. Saturday's session runs past midnight. */
const week: HistoryPoint[] = [
  ...quietDay("2026-11-11"), ...windows("2026-11-11T19:00", "2026-11-11T22:00", game("Cyberpunk 2077", 85, 70)),
  ...quietDay("2026-11-12"), ...windows("2026-11-12T20:00", "2026-11-12T22:00", game("Counter-Strike 2", 72)),
  ...quietDay("2026-11-14"), ...windows("2026-11-14T21:00", "2026-11-15T01:30", game("Baldur's Gate 3", 76)),
  ...quietDay("2026-11-15"),
  ...quietDay("2026-11-16"), ...windows("2026-11-16T20:00", "2026-11-16T21:00", { busy: true, gpu: 55, cpu: 60 }),
  ...quietDay("2026-11-17"), ...windows("2026-11-17T19:00", "2026-11-17T20:30", game("Counter-Strike 2", 74)),
];

const days = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"].map((d) => at(`${d}T00:00`));

describe("weekTemps", () => {
  it("gives seven local days ending today, with the graphics card's gaming median and peak on a desktop", () => {
    const w = weekTemps(week, ctx());
    expect(w.subject).toBe("gpu");
    expect(w.days).toEqual([
      { day: days[0], idle: 44, typical: 85, peak: 85 },
      { day: days[1], idle: 44, typical: 72, peak: 72 },
      { day: days[2], idle: null, typical: null, peak: null },
      { day: days[3], idle: 44, typical: 76, peak: 76 },
      { day: days[4], idle: 44, typical: 76, peak: 76 },
      { day: days[5], idle: 44, typical: 55, peak: 55 },
      { day: days[6], idle: 44, typical: 74, peak: 74 },
    ]);
    expect(w.peak).toBe(85);
  });

  it("takes the middle reading for idle and typical, so one spike doesn't move them", () => {
    const pts = [
      ...windows("2026-11-17T08:00", "2026-11-17T08:50", { cpu: 40 }),
      ...windows("2026-11-17T08:50", "2026-11-17T09:00", { cpu: 90 }),
      ...windows("2026-11-17T19:00", "2026-11-17T19:40", { busy: true, gpu: 70 }),
      ...windows("2026-11-17T19:40", "2026-11-17T19:50", { busy: true, gpu: 87 }),
    ];
    expect(weekTemps(pts, ctx()).days[6]).toMatchObject({ idle: 40, typical: 70, peak: 87 });
  });

  it("shows only today for a PC Rig met an hour ago", () => {
    const w = weekTemps(windows("2026-11-17T19:30", "2026-11-17T20:30", { cpu: 50, gpu: 41 }), ctx());
    expect(w.days.slice(0, 6).every((d) => d.idle === null && d.typical === null && d.peak === null)).toBe(true);
    expect(w.days[6]).toEqual({ day: days[6], idle: 50, typical: null, peak: 41 });
  });

  it("describes the processor on a laptop without a graphics card reading", () => {
    const pts = [...windows("2026-11-17T08:00", "2026-11-17T09:00", { cpu: 52, gpu: null }), ...windows("2026-11-17T19:00", "2026-11-17T20:00", { busy: true, cpu: 81, gpu: null })];
    const w = weekTemps(pts, ctx({ kind: "laptop" }));
    expect(w.subject).toBe("cpu");
    expect(w.days[6]).toMatchObject({ idle: 52, typical: 81, peak: 81 });
  });

  it("describes the processor on a desktop that never reported a graphics card", () => {
    expect(weekTemps(windows("2026-11-17T08:00", "2026-11-17T09:00", { gpu: null }), ctx()).subject).toBe("cpu");
  });

  it("is empty for a PC with no history", () => {
    const w = weekTemps([], ctx());
    expect(w.days.map((d) => d.day)).toEqual(days);
    expect(w.days.every((d) => d.peak === null)).toBe(true);
    expect(w.peak).toBeNull();
  });

  it("keeps each day at local midnight across a daylight saving change", () => {
    // New York leaves daylight saving time at 2 AM on 1 November 2026 (06:00 UTC).
    const nyDst: UtcOffset = (t) => (t < Date.parse("2026-11-01T06:00:00Z") ? -240 : -300);
    const w = weekTemps([], { ...ctx(), now: Date.parse("2026-11-03T17:00:00Z"), offset: nyDst });
    expect(w.days.map((d) => new Date(d.day).toISOString())).toEqual([
      "2026-10-28T04:00:00.000Z", "2026-10-29T04:00:00.000Z", "2026-10-30T04:00:00.000Z", "2026-10-31T04:00:00.000Z",
      "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", "2026-11-03T05:00:00.000Z",
    ]);
  });
});

describe("weekEvenings", () => {
  it("finds each evening's sessions, named by game, marked hot or background", () => {
    const e = weekEvenings(week, ctx());
    expect(e.days.map((d) => d.day)).toEqual(days);
    expect(e.days.map((d) => d.sessions.map(({ start, hours, game, kind }) => ({ start, hours, game, kind })))).toEqual([
      [{ start: 1, hours: 3, game: "Cyberpunk 2077", kind: "hot" }],
      [{ start: 2, hours: 2, game: "Counter-Strike 2", kind: "played" }],
      [],
      [{ start: 3, hours: 4.5, game: "Baldur's Gate 3", kind: "played" }],
      [],
      [{ start: 2, hours: 1, game: null, kind: "background" }],
      [{ start: 1, hours: 1.5, game: "Counter-Strike 2", kind: "played" }],
    ]);
    expect(e.hours).toBe(3 + 2 + 4.5 + 1.5);
  });

  it("keeps a session past midnight with the evening it started in", () => {
    const [s] = weekEvenings(week, ctx()).days[3].sessions;
    expect(s.from).toBe(at("2026-11-14T21:00"));
    expect(s.to).toBe(at("2026-11-15T01:30"));
  });

  it("joins busy windows across one quiet window and splits them across two", () => {
    const pts = [
      ...windows("2026-11-16T19:00", "2026-11-16T20:00", game("Hades II", 70)),
      ...windows("2026-11-16T20:10", "2026-11-16T21:00", game("Hades II", 70)),
      ...windows("2026-11-16T21:20", "2026-11-16T22:00", game("Balatro", 60)),
    ];
    const sessions = weekEvenings(pts, ctx()).days[5].sessions;
    expect(sessions.map((s) => [s.start, s.hours, s.game])).toEqual([[1, 2, "Hades II"], [3 + 1 / 3, 2 / 3, "Balatro"]]);
  });

  it("counts an afternoon session from 6 PM", () => {
    const [s] = weekEvenings(windows("2026-11-16T16:00", "2026-11-16T19:00", game("Hades II", 70)), ctx()).days[5].sessions;
    expect(s).toMatchObject({ start: 0, hours: 1, from: at("2026-11-16T16:00") });
  });

  it("leaves out busy stretches that end before the evening", () => {
    expect(weekEvenings(windows("2026-11-16T13:00", "2026-11-16T15:00", game("Hades II", 70)), ctx()).days[5].sessions).toEqual([]);
  });

  it("marks a laptop session hot when the processor nears its limit", () => {
    const pts = windows("2026-11-16T19:00", "2026-11-16T20:00", { busy: true, cpu: 91, gpu: null });
    const [s] = weekEvenings(pts, ctx({ kind: "laptop" })).days[5].sessions;
    expect(s.kind).toBe("hot");
  });

  it("is empty for a PC with no history", () => {
    const e = weekEvenings([], ctx());
    expect(e.days.every((d) => d.sessions.length === 0)).toBe(true);
    expect(e.hours).toBe(0);
  });
});

describe("fanTrend", () => {
  it("gives the fastest fan per local six-hour slice against the fastest slice shown", () => {
    const pts = [
      ...windows("2026-11-16T22:00", "2026-11-16T23:00", { fan: 3000 }),
      ...windows("2026-11-17T03:00", "2026-11-17T04:00", { fan: 900 }),
      ...windows("2026-11-17T13:00", "2026-11-17T14:00", { fan: 1200 }),
      ...windows("2026-11-17T14:00", "2026-11-17T15:00", { fan: 1500 }),
      ...windows("2026-11-17T19:00", "2026-11-17T20:00", { fan: 2400 }),
    ];
    const f = fanTrend(pts, ctx(), 4);
    expect(f.scale).toBe(2400);
    expect(f.columns).toEqual([
      { from: at("2026-11-17T00:00"), rpm: 900, level: 0.375 },
      { from: at("2026-11-17T06:00"), rpm: null, level: null },
      { from: at("2026-11-17T12:00"), rpm: 1500, level: 0.625 },
      { from: at("2026-11-17T18:00"), rpm: 2400, level: 1 },
    ]);
  });

  it("covers the last four days by default and has no speeds without fan readings", () => {
    const f = fanTrend(week.map(({ fan: _fan, ...p }) => p), ctx());
    expect(f.columns).toHaveLength(16);
    expect(f.columns[0].from).toBe(at("2026-11-14T00:00"));
    expect(f.columns.every((c) => c.rpm === null && c.level === null)).toBe(true);
    expect(f.scale).toBeNull();
  });
});

describe("insightContext", () => {
  it("reads the PC's kind and safe limits", () => {
    const c = insightContext({ kind: "laptop", parts: { cpu: { name: "", type: "", modelSource: "generic", specs: [], manual: [], limit: 89 } } }, 0, ny);
    expect(c).toMatchObject({ kind: "laptop", now: 0, limits: { cpu: 89, gpu: 88 } });
  });
});
