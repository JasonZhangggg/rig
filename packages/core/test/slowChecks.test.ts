import { describe, expect, it } from "vitest";
import { classifyEvent, findings, stepAlerts, emptyAlertState, type HistoryPoint, type Inventory, type PCEvent, type RawEvent, type Snapshot } from "../src";
import { fixtures } from "../src/demo";

const NOW = Date.UTC(2026, 10, 20, 20, 0);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const atlas = (): Inventory => structuredClone(fixtures.atlas.inv);
const ev = (ago: number, source: string, id: number, message = "", level: RawEvent["level"] = "error"): PCEvent =>
  ({ t: NOW - ago, log: "System", source, id, level, message, kind: classifyEvent({ source, id }) });
const blueScreen = (ago: number) => [
  ev(ago, "Microsoft-Windows-WER-SystemErrorReporting", 1001, "The computer has rebooted from a bugcheck. The bugcheck was: 0x00000124 (0x0000000000000000, 0xffffb38e12f1a028)."),
  ev(ago + 30_000, "Microsoft-Windows-Kernel-Power", 41, "The system has rebooted without cleanly shutting down first.", "critical"),
];

/** An array that counts how often it's read, to see whether a check went through it again. */
function counted<T>(xs: T[]) {
  const n = { reads: 0 };
  const proxy = new Proxy(xs, { get(target, key, recv) { const v = Reflect.get(target, key, recv); if (typeof v === "function") n.reads++; return v; } });
  return { list: proxy, n };
}

describe("the checks over weeks of events and history", () => {
  it("read the events once a minute, not on every reading", () => {
    const inv = atlas();
    const { list, n } = counted([...blueScreen(2 * DAY), ...blueScreen(5 * DAY)]);
    const first = findings({ inv, snap: null, facts: null, now: NOW, events: list });
    const read = n.reads;
    expect(read).toBeGreaterThan(0);
    const again = findings({ inv, snap: null, facts: null, now: NOW + 2000, events: list });
    expect(n.reads).toBe(read);
    expect(again.map((f) => f.id)).toEqual(first.map((f) => f.id));
    expect(again.find((f) => f.id === "crashes")?.title).toBe("Windows crashed twice in two weeks");
    findings({ inv, snap: null, facts: null, now: NOW + 61_000, events: list });
    expect(n.reads).toBeGreaterThan(read);
  });

  it("see new events and a new history point straight away", () => {
    const inv = atlas();
    const crashes = (events: PCEvent[], now: number) => findings({ inv, snap: null, facts: null, now, events }).find((f) => f.id === "crashes")?.title;
    expect(crashes(blueScreen(2 * DAY), NOW)).not.toBe("Windows crashed twice in two weeks");
    expect(crashes([...blueScreen(2 * DAY), ...blueScreen(5 * DAY)], NOW + 2000)).toBe("Windows crashed twice in two weeks");

    // The history grows in place, one point every ten minutes.
    const quiet: HistoryPoint[] = Array.from({ length: 11 }, (_, i) => ({ t: NOW - (11 - i) * HOUR, cpu: 74, gpu: 45, busy: false, cpuLoad: 4 }));
    expect(findings({ inv, snap: null, facts: null, now: NOW, history: quiet }).map((f) => f.id)).not.toContain("cpu-hot-idle");
    quiet.push({ t: NOW, cpu: 74, gpu: 45, busy: false, cpuLoad: 4 });
    expect(findings({ inv, snap: null, facts: null, now: NOW + 2000, history: quiet }).map((f) => f.id)).toContain("cpu-hot-idle");
  });
});

describe("running hotter than usual", () => {
  const W = 10 * MIN;
  const evening = (daysAgo: number, gpu: number): HistoryPoint[] =>
    Array.from({ length: 12 }, (_, i) => ({ t: NOW - daysAgo * DAY + i * W, cpu: 60, gpu, busy: true, game: "Baldur's Gate 3" }));
  const snap: Snapshot = { at: NOW, elevated: true, sensors: [] };

  it("reads the month of history once a minute, and again as soon as it gains a point", () => {
    const inv = atlas();
    const base = [25, 22, 18, 16].flatMap((d) => evening(d, 71));
    const { list, n } = counted(base);
    let state = emptyAlertState();
    const step = (now: number) => { const s = stepAlerts(state, { inv, snap, history: list, now }); state = s.state; return s.alerts.filter((a) => a.kind === "hotter-than-usual"); };
    expect(step(NOW)).toEqual([]);
    const read = n.reads;
    expect(step(NOW + 2000)).toEqual([]);
    expect(n.reads).toBe(read);
    // Two hot evenings land in the history: the alert shows on the next reading.
    for (const p of [...evening(2, 80), ...evening(1, 80)]) base.push(p);
    expect(step(NOW + 4000).map((a) => a.id)).toEqual(["hotter-than-usual:gpu"]);
  });
});
