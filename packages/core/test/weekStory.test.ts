import { describe, expect, it } from "vitest";
import { cleanEvents, fixedOffset, weekStory, type Change, type HistoryPoint, type InsightContext, type RawEvent, type RecordingInfo } from "../src";

// New York in November: five hours behind UTC.
const ny = fixedOffset(-300);
/** A local wall-clock time in New York as milliseconds since epoch. */
const at = (local: string) => Date.parse(`${local}:00Z`) + 5 * 36e5;

// Thursday 26 November, late evening. The week is Fri 20 to Thu 26; the week before, Fri 13 to Thu 19.
const ctx: InsightContext = { now: at("2026-11-26T23:00"), offset: ny, kind: "tower", limits: { cpu: 95, gpu: 88 } };

function windows(from: string, to: string, p: Partial<HistoryPoint> = {}): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let t = at(from); t < at(to); t += 10 * 60_000) out.push({ t, cpu: 44, gpu: 40, busy: false, ...p });
  return out;
}
const play = (name: string, gpu: number) => ({ busy: true, game: name, gpu, cpu: 66 });
const dates = (from: number, n: number) => Array.from({ length: n }, (_, i) => `2026-11-${String(from + i).padStart(2, "0")}`);
/** Quiet days with an evening of Counter-Strike each, at the given resting temperature. */
const calm = (days: string[], rest: number) => days.flatMap((d) => [
  ...windows(`${d}T08:00`, `${d}T18:00`, { gpu: rest }),
  ...windows(`${d}T19:00`, `${d}T21:00`, play("Counter-Strike 2", 72)),
]);

const lastWeek = calm(dates(13, 7), 40);
const thisWeek = calm(dates(20, 7), 40);

const event = (local: string, e: Omit<RawEvent, "t" | "log">): RawEvent => ({ t: at(local), log: "System", ...e });
const reset = (local: string) => event(local, { source: "Display", id: 4101, level: "warning", message: "Display driver nvlddmkm stopped responding and has successfully recovered." });
const discord = (local: string): RawEvent => ({ ...event(local, { source: "Application Error", id: 1000, level: "error", message: "Faulting application name: Discord.exe, version: 1.0" }), log: "Application" });

describe("weekStory", () => {
  it("calls an ordinary week normal, with its figures against the week before", () => {
    const s = weekStory({ points: [...lastWeek, ...thisWeek] }, ctx);
    expect(s.headline).toEqual({ lead: "A normal week", rest: null });
    expect(s.subject).toBe("gpu");
    expect(s.days).toHaveLength(7);
    expect(s.days[0]).toBe(at("2026-11-20T00:00"));
    expect(s.figures).toEqual({
      resting: { now: 40, before: 40, look: false },
      played: { now: 14, before: 14, look: false },
      hottest: { now: 72, before: 72, look: false },
    });
    expect(s.marks).toEqual([]);
    expect(s.hotLine).toBe(82);
    // Desktop and game time stay apart on the chart.
    expect(s.points.some((p) => p.game === "Counter-Strike 2")).toBe(true);
    expect(s.points.some((p) => p.game === null)).toBe(true);
  });

  it("says which game ran hot and when, and flags the moment it peaked", () => {
    const points = [...lastWeek, ...thisWeek, ...windows("2026-11-25T20:00", "2026-11-25T22:00", play("Cyberpunk 2077", 84)), ...windows("2026-11-25T21:00", "2026-11-25T21:10", play("Cyberpunk 2077", 87))];
    const s = weekStory({ points }, ctx);
    expect(s.headline).toEqual({ lead: "A normal week, except", rest: "Cyberpunk 2077 ran hot yesterday" });
    expect(s.figures.hottest).toEqual({ now: 87, before: 72, look: true });
    const [m] = s.marks;
    expect(m).toMatchObject({ kind: "hot", look: true, label: "Cyberpunk 2077, {temp}", temp: 87, title: "Cyberpunk 2077 took the graphics card to 87°C", detail: "1° under its 88°C limit, in a 2-hour session." });
    expect(m.t).toBe(at("2026-11-25T21:00"));
  });

  it("counts a game that ran hot more than once, naming the day only once", () => {
    const hot = (d: string) => windows(`${d}T20:00`, `${d}T21:00`, play("Cyberpunk 2077", 85));
    const s = weekStory({ points: [...lastWeek, ...thisWeek, ...hot("2026-11-21"), ...hot("2026-11-23")] }, ctx);
    expect(s.headline.rest).toBe("Cyberpunk 2077 ran hot twice");
    expect(s.marks.map((m) => m.kind)).toEqual(["hot", "hot"]);
    const once = weekStory({ points: [...lastWeek, ...thisWeek, ...hot("2026-11-23")] }, ctx);
    expect(once.headline.rest).toBe("Cyberpunk 2077 ran hot on Monday");
  });

  it("joins a driver reset to the hot session it happened in, and recalls the one before it", () => {
    const points = [...lastWeek, ...thisWeek, ...windows("2026-11-25T20:10", "2026-11-25T21:00", play("Cyberpunk 2077", 90))];
    const events = cleanEvents([reset("2026-11-25T20:41"), reset("2026-11-18T20:55")]);
    const recordings = [{ id: "rec-1", startedAt: at("2026-11-25T20:10"), finishedAt: at("2026-11-25T20:55") } as RecordingInfo];
    const s = weekStory({ points, events, recordings }, ctx);
    expect(s.headline.rest).toBe("Cyberpunk 2077 ran hot yesterday and the graphics driver reset");
    expect(s.marks).toHaveLength(1);
    expect(s.marks[0]).toMatchObject({
      kind: "hot", label: "{temp}, driver reset", temp: 90, recordingId: "rec-1",
      title: "Cyberpunk 2077 took the graphics card to 90°C, and the graphics driver reset",
      detail: "2° over its 88°C limit. The reset came 31 minutes in; it also reset on Nov 18.",
    });
  });

  it("lists an app crash with the temperature at the time, without putting it in the headline", () => {
    const s = weekStory({ points: [...lastWeek, ...thisWeek], events: cleanEvents([discord("2026-11-24T11:12")]) }, ctx);
    expect(s.headline).toEqual({ lead: "A normal week", rest: null });
    expect(s.marks).toEqual([expect.objectContaining({ kind: "crash", look: false, label: "Discord crashed", title: "Discord crashed", detail: "The graphics card was at 40°C then, 48° under its 88°C limit." })]);
  });

  it("names a change in a few words and says how the card has rested since, without claiming it was the cause", () => {
    const points = [...lastWeek, ...calm(dates(20, 2), 44), ...calm(dates(22, 5), 38)];
    const change = {
      id: "c1", machineId: "pc", at: new Date(at("2026-11-21T15:10")).toISOString(), title: "Turned off NVIDIA Broadcast at startup", by: "rig", status: "applied",
      why: "It started with Windows but you never use it.", result: "", diff: [["NVIDIA Broadcast", "Starts with Windows", "Off"]], tier: 1, applied: [],
    } as Change;
    const s = weekStory({ points, changes: [change, { ...change, id: "c2", status: "undone" }] }, ctx);
    expect(s.marks).toEqual([expect.objectContaining({ kind: "change", changeId: "c1", label: "NVIDIA Broadcast off", title: "Turned off NVIDIA Broadcast at startup", detail: "The graphics card has rested at 38°C since, down from 44°C." })]);
    expect(s.resting).toEqual([44, 44, 38, 38, 38, 38, 38]);
    expect(s.figures.resting).toEqual({ now: 38, before: 40, look: false });
  });

  it("puts a resting temperature that crept up in the headline, and keeps the rest for below", () => {
    const points = [...lastWeek, ...calm(dates(20, 7), 45), ...windows("2026-11-22T20:00", "2026-11-22T21:00", play("Cyberpunk 2077", 86))];
    const events = cleanEvents([reset("2026-11-24T21:00"), event("2026-11-23T07:55", { source: "Microsoft-Windows-Kernel-Power", id: 41, level: "critical", message: "The system has rebooted without cleanly shutting down first." })]);
    const s = weekStory({ points, events }, ctx);
    expect(s.figures.resting).toEqual({ now: 45, before: 40, look: true });
    expect(s.headline).toEqual({
      lead: "Not quite a normal week:",
      rest: "Cyberpunk 2077 ran hot on Sunday, the graphics driver reset on Tuesday, and 2 more below",
    });
    expect(s.marks.map((m) => m.kind)).toEqual(["hot", "shutdown", "driver"]);
  });

  it("says the laptop turned off, not the PC, on a laptop", () => {
    const events = cleanEvents([event("2026-11-23T07:55", { source: "Microsoft-Windows-Kernel-Power", id: 41, level: "critical", message: "The system has rebooted without cleanly shutting down first." })]);
    const points = [...lastWeek, ...thisWeek];
    expect(weekStory({ points, events }, { ...ctx, kind: "laptop" }).headline.rest).toMatch(/the laptop turned off suddenly/i);
    expect(weekStory({ points, events }, ctx).headline.rest).toMatch(/the PC turned off suddenly/i);
  });

  it("says when nothing was logged, and reads a laptop's processor", () => {
    expect(weekStory({ points: lastWeek }, ctx).headline).toEqual({ lead: "Nothing logged this week", rest: null });
    const laptop = weekStory({ points: windows("2026-11-26T08:00", "2026-11-26T10:00", { gpu: null }) }, { ...ctx, kind: "laptop" });
    expect(laptop.subject).toBe("cpu");
    expect(laptop.headline).toEqual({ lead: "A quiet week", rest: null });
    expect(laptop.figures.played).toEqual({ now: 0, before: null, look: false });
  });
});
