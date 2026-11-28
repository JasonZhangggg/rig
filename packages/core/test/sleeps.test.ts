// How much battery a laptop used asleep: worked out from the background recorder's sleep and wake lines, its battery
// readings and Rig's history, with what Windows says woke it. Nothing is guessed, and desktops get none.

import { describe, expect, it } from "vitest";
import {
  BackgroundLog, batteryView, buildPC, sleepCause, sleepMeta, sleepsOf, sleepTitle, sleepWhen, wakeKind, wakeName,
  type HistoryPoint, type SleepLog, type Snapshot, type SystemFacts,
} from "../src";
import { fixtures } from "../src/demo";

const MIN = 60_000;
const pebble = fixtures.pebble.inv;
const atlas = fixtures.atlas.inv;
const facts = fixtures.pebble.facts as SystemFacts;
const at = (s: string) => new Date(s).getTime();
const now = at("2026-11-28T09:30:00");
const snap: Snapshot = { at: now, sensors: [], elevated: true };

/** The recorder's lines for a reading of the battery: its sensor list, then one value for each. */
const battLines = (t: number, pct: number, watts: number) => [
  { k: "sensors", t, list: [["/battery/0/level/0", "battery", "Battery", "level", "Charge Level"], ["/battery/0/power/0", "battery", "Battery", "power", "Discharge Rate"]] },
  { k: "s", t, v: [pct, watts] },
];
const power = (t: number, what: string, more: Record<string, unknown> = {}) => ({ k: "power", t, what, ...more });

/** Shut at 11:40 PM at 80% on battery, opened at 8:40 AM. Windows reports the old charge right as it wakes; a minute later it's 42%. */
function night(): unknown[] {
  return [
    ...battLines(at("2026-11-27T23:30:00"), 81, 6),
    power(at("2026-11-27T23:40:00"), "sleep", { pct: 80, ac: false }),
    power(at("2026-11-28T08:40:00"), "wake", { pct: 80, ac: false }),
    ...battLines(at("2026-11-28T08:41:00"), 42, 7),
  ];
}

const logOf = (lines: unknown[]) => { const log = new BackgroundLog(); log.ingest(lines); return log; };

describe("working out each sleep", () => {
  it("reads a night's sleep and how much it used from the recorder's lines, trusting a reading after waking over the stale one", () => {
    const log = logOf(night());
    const [s, ...rest] = sleepsOf("laptop", log.sleep, [], now);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ fromPct: 80, toPct: 42, used: 38, hours: 9, heavy: true, woke: 0 });
    expect(sleepWhen(s, now)).toBe("Last night");
    expect(sleepTitle(s)).toBe("9 h asleep, used 38%");
    expect(sleepMeta(s)).toMatch(/^11:40\sPM to 8:40\sAM · 80% to 42%$/);
    // The Logs row says the charge it went to sleep with, and not the stale one on waking.
    const rows = log.cleanEvents().power.map((e) => e.message);
    expect(rows).toContain("Went to sleep (80% charged).");
    expect(rows).toContain("Woke up.");
  });

  it("joins brief wakes into one night, counts them, and names what Windows says woke it", () => {
    const shut = at("2026-11-27T23:40:00"), lines: unknown[] = [power(shut, "sleep", { pct: 80, ac: false })];
    // Woke on its own every 40 minutes for the Wi-Fi adapter, back to sleep two minutes later.
    for (let i = 1; i <= 12; i++) {
      const w = shut + i * 40 * MIN;
      lines.push(power(w, "wake", { ac: false }), power(w + 15_000, "wokeBy", { by: "Device -Intel(R) Wi-Fi 6E AX211 160MHz" }), power(w + 2 * MIN, "sleep", { ac: false }));
    }
    lines.push(power(at("2026-11-28T08:40:00"), "wake", { pct: 42, ac: false }));
    const log = logOf(lines);
    const [s] = sleepsOf("laptop", log.sleep, [], now);
    expect(s).toMatchObject({ used: 38, woke: 12, heavy: true, cause: { kind: "wifi", name: "Intel Wi-Fi 6E AX211", times: 12 } });
    expect(sleepCause(s)).toEqual({
      what: "It woke 12 times for its Wi-Fi adapter, Intel Wi-Fi 6E AX211.",
      next: "Windows lets a Wi-Fi adapter wake the laptop to stay connected. Turning that off for this adapter usually stops it.",
      ask: expect.stringContaining("How do I stop the adapter waking it?"),
    });
    // The Logs page's wake rows say what woke it too.
    expect(log.cleanEvents().power.some((e) => e.message === "Woke up. What woke it: Intel Wi-Fi 6E AX211.")).toBe(true);
  });

  it("takes the service's sleep and Windows' Modern Standby event for the same moment as one", () => {
    const log = logOf([
      power(at("2026-11-27T23:40:00"), "sleep", { win: 506, pct: 80, ac: false }),
      power(at("2026-11-27T23:40:30"), "sleep", { pct: 80, ac: false }),
      power(at("2026-11-28T07:40:00"), "wake", { win: 507, pct: 75, ac: false }),
      power(at("2026-11-28T07:41:00"), "wake", { ac: false }),
    ]);
    expect(log.cleanEvents().power).toHaveLength(2);
    expect(sleepsOf("laptop", log.sleep, [], now)).toMatchObject([{ fromPct: 80, toPct: 75, used: 5, heavy: false }]);
  });

  it("leaves out a sleep on the charger", () => {
    const plugged = logOf([power(at("2026-11-27T23:40:00"), "sleep", { pct: 80, ac: true }), power(at("2026-11-28T08:40:00"), "wake", { pct: 80, ac: true })]);
    expect(sleepsOf("laptop", plugged.sleep, [], now)).toEqual([]);
    // Plugged in while asleep: it filled, so it wasn't on battery the whole time.
    const filled = logOf([power(at("2026-11-27T23:40:00"), "sleep", { pct: 40, ac: false }), power(at("2026-11-28T08:40:00"), "wake", { pct: 90, ac: true })]);
    expect(sleepsOf("laptop", filled.sleep, [], now)).toEqual([]);
  });

  it("guesses nothing for a sleep without charge readings, and fills one in from Rig's history when it has it", () => {
    const bare = logOf([power(at("2026-11-27T23:40:00"), "sleep"), power(at("2026-11-28T08:40:00"), "wake")]);
    expect(sleepsOf("laptop", bare.sleep, [], now)).toEqual([]);
    expect(batteryView(pebble, snap, facts, { sleep: bare.sleep, now })?.sleeps).toBeUndefined();
    // History windows on battery just before it slept and just after it woke (each point's charge is from its window's end).
    const history: HistoryPoint[] = [
      { t: at("2026-11-27T23:25:00"), cpu: 40, gpu: null, busy: false, batt: 70, drain: 6 },
      { t: at("2026-11-28T08:35:00"), cpu: 40, gpu: null, busy: false, batt: 64, drain: 7 },
    ];
    expect(sleepsOf("laptop", bare.sleep, history, now)).toMatchObject([{ fromPct: 70, toPct: 64, used: 6, heavy: false }]);
  });

  it("gives a desktop none, and says nothing about its sleeps anywhere", () => {
    const log = logOf(night());
    expect(sleepsOf("tower", log.sleep, [], now)).toEqual([]);
    const pc = buildPC(atlas, snap, fixtures.atlas.facts as SystemFacts, {}, {}, { sleep: log.sleep, now });
    expect(pc.battery).toBeUndefined();
    expect(pc.issues!.some((i) => /asleep/i.test(i.title))).toBe(false);
  });
});

describe("what the laptop says about a heavy sleep", () => {
  const heavy = (): SleepLog => logOf(night()).sleep;
  const power3h = { displayOffAfter: { ac: 600, dc: 300 }, sleepAfter: { ac: 1800, dc: 900 }, hibernateAfter: { ac: 0, dc: 0 } };

  it("puts it in Things to look at, opening the battery's own page", () => {
    const pc = buildPC(pebble, snap, facts, {}, {}, { sleep: heavy(), now, power: power3h });
    const issue = pc.issues!.find((i) => i.id === "sleep-drain");
    expect(issue).toMatchObject({ title: "Used 38% of the battery asleep last night", severity: "warn", go: "pc", part: "battery", tab: "life" });
    expect(issue?.body).toBe("That's about 4% an hour, where under 1% is usual asleep. Something kept it awake, and Windows didn't say what.");
    expect(pc.breakdown?.find((b) => b.label === "Battery")?.note).toBe("Used 38% of the battery asleep last night");
  });

  it("offers hibernating after a few hours on battery, through the usual review, only after a heavy sleep", () => {
    const pc = buildPC(pebble, snap, { ...facts, maxProcessorState: { ac: 100, dc: 99 } }, {}, {}, { sleep: heavy(), now, power: power3h });
    expect(pc.battery?.savers[0]).toMatchObject({
      id: "hibernate", title: "Hibernate after 3 hours asleep on battery",
      fix: [{ kind: "power.setting", subgroup: "238c9fa8-0aad-41ed-83f4-97be242c8f20", setting: "9d7815a6-7ee4-497e-8888-515a05f02364", ac: 0, dc: 10800 }],
    });
    const calm = logOf([power(at("2026-11-27T23:40:00"), "sleep", { pct: 80, ac: false }), power(at("2026-11-28T08:40:00"), "wake", { pct: 75, ac: false })]).sleep;
    const fine = buildPC(pebble, snap, facts, {}, {}, { sleep: calm, now, power: power3h });
    expect(fine.battery?.sleeps).toMatchObject([{ used: 5, heavy: false }]);
    expect(fine.battery?.savers.some((s) => s.id === "hibernate")).toBe(false);
    expect(fine.issues!.some((i) => i.id === "sleep-drain")).toBe(false);
  });

  it("keeps an older heavy night off Things to look at, while Battery life still lists it", () => {
    const later = now + 4 * 864e5;
    const pc = buildPC(pebble, { ...snap, at: later }, facts, {}, {}, { sleep: heavy(), now: later });
    expect(pc.battery?.sleeps?.[0]).toMatchObject({ used: 38, heavy: true });
    expect(pc.issues!.some((i) => i.id === "sleep-drain")).toBe(false);
  });
});

describe("what woke it, in plain words", () => {
  it("names the device the way a person says it, and knows a timer and the power button from a device", () => {
    expect(wakeName("Device -MediaTek Wi-Fi 7 MT7925 Wireless LAN Card")).toBe("MediaTek Wi-Fi 7 MT7925");
    expect(wakeKind("Device -Realtek PCIe GbE Family Controller")).toBe("network");
    expect(wakeKind("Device -USB Root Hub (USB 3.0)")).toBe("device");
    expect(wakeKind("Timer")).toBe("timer");
    expect(wakeKind("Power Button")).toBe("you");
  });
});
