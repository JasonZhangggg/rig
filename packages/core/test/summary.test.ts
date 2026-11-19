import { describe, expect, it } from "vitest";
import { historySummary, type HistoryPoint } from "../src";

const HOUR = 36e5;
const start = Date.UTC(2026, 10, 11, 8);

/** Ten-minute windows from one hour offset to another, counted from the start. */
function windows(from: number, to: number, p: Partial<HistoryPoint> = {}): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let t = start + from * HOUR; t < start + to * HOUR; t += 10 * 60_000) out.push({ t, cpu: 44, gpu: 36, busy: false, ...p });
  return out;
}
const play = (game: string, gpu: number) => ({ busy: true, game, gpu, cpu: 60 });

describe("historySummary", () => {
  it("doesn't call the PC cooler because a heavy game came early and a light one late", () => {
    // The week shown in the bug: a hot Cyberpunk evening first, lighter games after.
    const week = [
      ...windows(0, 10), ...windows(10, 13, play("Cyberpunk 2077", 86)),
      ...windows(13, 40), ...windows(40, 43, play("Counter-Strike 2", 72)),
      ...windows(43, 100), ...windows(100, 103, play("Counter-Strike 2", 73)),
      ...windows(103, 140), ...windows(140, 144, play("Baldur's Gate 3", 76)),
    ];
    const s = historySummary(week, "gpu", 88);
    expect(s.busy!.change).toBe(1);
    expect(s.busy!.typical).toBeGreaterThan(70);
  });

  it("reports a game running warmer than it did earlier in the range", () => {
    const pts = [
      ...windows(0, 3, play("Cyberpunk 2077", 74)), ...windows(3, 30),
      ...windows(30, 33, play("Cyberpunk 2077", 75)), ...windows(33, 60),
      ...windows(60, 63, play("Cyberpunk 2077", 82)), ...windows(63, 90),
      ...windows(90, 93, play("Cyberpunk 2077", 83)),
    ];
    expect(historySummary(pts, "gpu", 88).busy).toEqual({ typical: 79, change: 8 });
  });

  it("has nothing to compare with a single session", () => {
    const day = [...windows(0, 10), ...windows(10, 14, play("Cyberpunk 2077", 80)), ...windows(14, 16)];
    expect(historySummary(day, "gpu", 88).busy).toEqual({ typical: 80, change: null });
  });

  it("splits sessions where the PC was off, even with no quiet reading between them", () => {
    const pts = [...windows(0, 2, play("Counter-Strike 2", 70)), ...windows(30, 32, play("Counter-Strike 2", 76))];
    expect(historySummary(pts, "gpu", 88).busy!.change).toBe(6);
  });

  it("gives the processor at rest and no busy figure when nothing heavy ran", () => {
    const s = historySummary(windows(0, 8, { cpu: 41 }), "cpu", 95);
    expect(s.busy).toBeNull();
    expect(s.idle).toBe(41);
  });

  it("says how far the hottest moment was from the limit, negative when over it", () => {
    const pts = [...windows(0, 2), { t: start + 3 * HOUR, cpu: 60, gpu: 89, busy: true }, ...windows(4, 5)];
    expect(historySummary(pts, "gpu", 88).peak).toEqual({ t: start + 3 * HOUR, value: 89, headroom: -1 });
    expect(historySummary(pts, "cpu", 95).peak).toEqual({ t: start + 3 * HOUR, value: 60, headroom: 35 });
  });

  it("is empty for no history", () => {
    expect(historySummary([], "gpu", 88)).toEqual({ busy: null, idle: null, peak: null });
  });
});
