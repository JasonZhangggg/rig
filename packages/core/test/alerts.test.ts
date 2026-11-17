import { describe, expect, it } from "vitest";
import {
  alertRules, alertsToNotify, alertTiming, coveredIssues, emptyAlertState, shownAlerts, sortAlerts, stepAlerts,
  LocalClient, MemoryStore, type Alert, type AlertState, type HistoryPoint, type Inventory, type Sensor, type Snapshot,
} from "../src";
import { SimulatedLink, fixtures } from "../src/demo";

const MIN = 60_000;
const DAY = 864e5;
const T0 = new Date("2026-11-17T20:00:00Z").getTime();

const atlas = (): Inventory => structuredClone(fixtures.atlas.inv);
const pebble = (): Inventory => structuredClone(fixtures.pebble.inv);

const sensor = (hw: Sensor["hw"], type: Sensor["type"], name: string, value: number | null, max: number | null = null): Sensor =>
  ({ id: `/${hw}/0/${type}/${name}`, hw, hwName: hw, type, name, value, min: null, max });

/** A desktop reading: processor and graphics card temperatures, and their fans. */
function snap(o: { cpu?: number; gpu?: number; cpuFan?: number; gpuFan?: number; fanMax?: number | null } = {}): Snapshot {
  return {
    at: 0, elevated: true, game: null,
    sensors: [
      sensor("cpu", "temperature", "Core (Tctl/Tdie)", o.cpu ?? 50),
      sensor("gpu", "temperature", "GPU Core", o.gpu ?? 45),
      sensor("board", "fan", "Fan #1", o.cpuFan ?? 900, o.fanMax === undefined ? 1400 : o.fanMax),
      sensor("gpu", "fan", "GPU Fan 1", o.gpuFan ?? 1500, o.fanMax === undefined ? 2600 : o.fanMax),
    ],
  };
}

/** Feeds readings through the tracker, one every `every` ms, and returns the alerts after each. */
function run(inv: Inventory, readings: { at: number; snap: Snapshot | null; history?: HistoryPoint[] }[], state: AlertState = emptyAlertState()) {
  const out: Alert[][] = [];
  for (const r of readings) {
    const step = stepAlerts(state, { inv, snap: r.snap, history: r.history ?? [], now: r.at });
    state = step.state;
    out.push(step.alerts);
  }
  return { out, state, last: out[out.length - 1] };
}

/** The same reading every ten seconds for `ms`, starting at `from`. */
const steady = (from: number, ms: number, s: Snapshot | null) =>
  Array.from({ length: Math.floor(ms / 10_000) + 1 }, (_, i) => ({ at: from + i * 10_000, snap: s }));

const ids = (alerts: Alert[]) => alerts.map((a) => a.id);

describe("a part at its safe limit", () => {
  it("ignores one spike", () => {
    const { out } = run(atlas(), [
      ...steady(T0, 60_000, snap({ gpu: 90 })),
      ...steady(T0 + 70_000, 5 * MIN, snap({ gpu: 70 })),
      ...steady(T0 + 7 * MIN, 60_000, snap({ gpu: 91 })),
    ]);
    expect(out.flat()).toEqual([]);
  });

  it("alerts once it has stayed there for two minutes, from when it got there", () => {
    const { out, last } = run(atlas(), steady(T0, 3 * MIN, snap({ gpu: 89 })));
    const first = out.findIndex((a) => a.length > 0);
    expect(first).toBe(12);
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ id: "too-hot:gpu", kind: "too-hot", part: "gpu", severity: "bad", since: new Date(T0).toISOString(), covers: ["gpu-hot", "gpu-warm"] });
    expect(last[0].title).toBe("Graphics card is staying at its 88°C limit");
    expect(last[0].detail).toMatch(/^It's at 89°C/);
  });

  it("uses the processor's own limit", () => {
    const { last } = run(atlas(), steady(T0, 3 * MIN, snap({ cpu: 90 })));
    expect(last[0].title).toBe("Processor is staying at its 89°C limit");
  });

  it("keeps waiting out the hold while it hovers just under the limit, and starts over after a real dip", () => {
    const hover = run(atlas(), [...steady(T0, 60_000, snap({ gpu: 89 })), ...steady(T0 + 70_000, 70_000, snap({ gpu: 86 }))]);
    expect(ids(hover.last)).toEqual(["too-hot:gpu"]);

    const dip = run(atlas(), [...steady(T0, 60_000, snap({ gpu: 89 })), { at: T0 + 65_000, snap: snap({ gpu: 80 }) }, ...steady(T0 + 70_000, 70_000, snap({ gpu: 89 }))]);
    expect(dip.last).toEqual([]);
  });

  it("stays through a short cool-off and ends after a longer one", () => {
    const hot = run(atlas(), steady(T0, 3 * MIN, snap({ gpu: 90 })));
    const t = T0 + 3 * MIN;
    const brief = run(atlas(), steady(t + 10_000, alertTiming.clearMs - 20_000, snap({ gpu: 60 })), hot.state);
    expect(brief.out.every((a) => a.length === 1)).toBe(true);
    const long = run(atlas(), steady(t + 10_000, alertTiming.clearMs + 10_000, snap({ gpu: 60 })), hot.state);
    expect(long.last).toEqual([]);
  });

  it("is the same alert when it comes back within the cooldown, and a new one after", () => {
    const hot = run(atlas(), steady(T0, 3 * MIN, snap({ gpu: 90 })));
    const since = hot.last[0].since;
    const cool = run(atlas(), steady(T0 + 3 * MIN + 10_000, 5 * MIN, snap({ gpu: 60 })), hot.state);
    expect(cool.last).toEqual([]);

    const soon = run(atlas(), steady(T0 + 10 * MIN, 3 * MIN, snap({ gpu: 90 })), cool.state);
    expect(soon.last[0].since).toBe(since);

    const later = run(atlas(), steady(T0 + 3 * MIN + alertTiming.cooldownMs + MIN, 3 * MIN, snap({ gpu: 90 })), cool.state);
    expect(later.last[0].since).toBe(new Date(T0 + 3 * MIN + alertTiming.cooldownMs + MIN).toISOString());
  });

  it("ends when the PC was off for a while, rather than carrying on from before", () => {
    const hot = run(atlas(), steady(T0, 3 * MIN, snap({ gpu: 90 })));
    const next = run(atlas(), [{ at: T0 + 5 * 3600_000, snap: snap({ gpu: 90 }) }], hot.state);
    expect(next.last).toEqual([]);
  });

  it("ends when the sensors stop answering", () => {
    const hot = run(atlas(), steady(T0, 3 * MIN, snap({ gpu: 90 })));
    const gone = run(atlas(), steady(T0 + 3 * MIN + 10_000, alertTiming.clearMs + 10_000, null), hot.state);
    expect(gone.last).toEqual([]);
  });
});

describe("a fan that stops", () => {
  it("alerts when the graphics card fan reads 0 rpm while the card is hot", () => {
    const { out, last } = run(atlas(), steady(T0, 60_000, snap({ gpu: 74, gpuFan: 0 })));
    expect(out.findIndex((a) => a.length > 0)).toBe(3);
    expect(last).toEqual([expect.objectContaining({ id: "fan-stopped:gpu", severity: "bad", title: "Graphics card fan has stopped" })]);
    expect(last[0].detail).toMatch(/^It reads 0 rpm while the card is at 74°C/);
  });

  it("leaves a card that rests its fan while cool alone", () => {
    expect(run(atlas(), steady(T0, 5 * MIN, snap({ gpu: 50, gpuFan: 0 }))).last).toEqual([]);
  });

  it("ignores a fan header that never spun", () => {
    expect(run(atlas(), steady(T0, 5 * MIN, snap({ cpu: 80, cpuFan: 0, fanMax: 0 }))).last).toEqual([]);
  });

  it("watches the processor's fan on a desktop and every fan on a laptop", () => {
    expect(ids(run(atlas(), steady(T0, 60_000, snap({ cpu: 75, cpuFan: 0 }))).last)).toEqual(["fan-stopped:cpu"]);
    const laptop: Snapshot = { at: 0, elevated: true, sensors: [
      sensor("cpu", "temperature", "CPU Package", 86),
      sensor("cooler", "fan", "Fan #1", 3800, 5200),
      sensor("cooler", "fan", "Fan #2", 0, 5100),
    ] };
    const { last } = run(pebble(), steady(T0, 60_000, laptop));
    expect(last).toEqual([expect.objectContaining({ id: "fan-stopped:cpu", title: "A laptop fan has stopped" })]);
  });

  it("ends once the fan spins again", () => {
    const stopped = run(atlas(), steady(T0, 60_000, snap({ gpu: 74, gpuFan: 0 })));
    const spinning = run(atlas(), steady(T0 + 70_000, alertTiming.clearMs + 10_000, snap({ gpu: 74, gpuFan: 1800 })), stopped.state);
    expect(spinning.last).toEqual([]);
  });
});

describe("drives", () => {
  const withVolume = (freeGb: number, sizeGb = 1000) => { const inv = atlas(); inv.volumes = [{ letter: "C:", sizeGb, freeGb }]; return inv; };

  it("alerts at once when a drive is nearly full, covering the matching issue", () => {
    const { last } = run(withVolume(80), [{ at: T0, snap: snap() }]);
    expect(last).toEqual([expect.objectContaining({ id: "drive-full:C:", part: "ssd", severity: "warn", title: "Drive C: is nearly full", covers: ["vol-C:"] })]);
    expect(last[0].detail).toBe("80 GB free of 1.0 TB. Windows slows down and updates can fail when a drive is this full.");
  });

  it("is serious when almost nothing is left, and quiet with room to spare", () => {
    expect(run(withVolume(20), [{ at: T0, snap: snap() }]).last[0].severity).toBe("bad");
    expect(run(withVolume(300), [{ at: T0, snap: snap() }]).last).toEqual([]);
  });

  it("stays on until there is clearly more room", () => {
    const full = run(withVolume(90), [{ at: T0, snap: snap() }]);
    const some = run(withVolume(110), steady(T0 + 10_000, alertTiming.clearMs + 10_000, snap()), full.state);
    expect(ids(some.last)).toEqual(["drive-full:C:"]);
    const more = run(withVolume(130), steady(T0 + 10_000, alertTiming.clearMs + 10_000, snap()), full.state);
    expect(more.last).toEqual([]);
  });

  it("alerts when a drive reports it's nearly worn out", () => {
    const inv = atlas();
    inv.disks = [{ model: "Old SSD", sizeGb: 500, media: "ssd", healthPercent: 15 }, { model: "Dead SSD", sizeGb: 500, media: "ssd", healthPercent: 4 }, { model: "Fine SSD", sizeGb: 500, media: "ssd", healthPercent: 60 }, { model: "Quiet HDD", sizeGb: 500, media: "hdd" }];
    const { last } = run(inv, [{ at: T0, snap: snap() }]);
    expect(last.map((a) => [a.id, a.severity])).toEqual([["drive-wearing:Dead SSD", "bad"], ["drive-wearing:Old SSD", "warn"]]);
    expect(last[1].covers).toEqual(["disk-Old SSD"]);
  });
});

describe("running hotter than usual", () => {
  const W = 10 * MIN;
  /** One evening of a game: two hours of windows at a GPU temperature, starting `daysAgo` days before T0. */
  const evening = (daysAgo: number, gpu: number, game = "Baldur's Gate 3", busy = true): HistoryPoint[] =>
    Array.from({ length: 12 }, (_, i) => ({ t: T0 - daysAgo * DAY + i * W, cpu: 60, gpu, busy, game }));
  const history = (recent: number, before: number, game = "Baldur's Gate 3") => [
    ...[25, 22, 18, 16].flatMap((d) => evening(d, before, game)),
    ...[6, 4, 2].flatMap((d) => evening(d, recent, game)),
  ];
  const check = (h: HistoryPoint[], state?: AlertState) => run(atlas(), [{ at: T0, snap: snap(), history: h }], state);

  it("compares a game against the same game a few weeks ago", () => {
    const { last } = check(history(78, 71));
    expect(last).toEqual([expect.objectContaining({ id: "hotter-than-usual:gpu", kind: "hotter-than-usual", part: "gpu", severity: "warn", title: "Graphics card runs hotter than it used to" })]);
    expect(last[0].detail).toBe("In Baldur's Gate 3 it's been at 78°C lately, up from its usual 71°C. Dust on the filters and fans is the usual cause.");
    expect(last[0].since).toBe(new Date(T0 - 6 * DAY).toISOString());
  });

  it("dates it from the evening it started running warm", () => {
    const h = [...[25, 22, 18, 16, 6].flatMap((d) => evening(d, 71)), ...[4, 2].flatMap((d) => evening(d, 79))];
    expect(check(h).last[0].since).toBe(new Date(T0 - 4 * DAY).toISOString());
  });

  it("stays quiet for a small rise, a heavier game, or too little history", () => {
    expect(check(history(74, 71)).last).toEqual([]);
    expect(check([...[25, 22, 18].flatMap((d) => evening(d, 66, "Counter-Strike 2")), ...[6, 4].flatMap((d) => evening(d, 80, "Cyberpunk 2077"))]).last).toEqual([]);
    expect(check(history(78, 71).filter((p) => p.t > T0 - 15 * DAY)).last).toEqual([]);
    expect(check(history(78, 71).map((p) => ({ ...p, busy: false }))).last).toEqual([]);
    expect(check([]).last).toEqual([]);
  });

  it("stays on until the rise has mostly gone", () => {
    const on = check(history(78, 71));
    expect(ids(check(history(75, 71), on.state).last)).toEqual(["hotter-than-usual:gpu"]);
    expect(check(history(73, 71), on.state).last.filter((a) => a.kind === "hotter-than-usual")).toHaveLength(1);
    const off = run(atlas(), steady(T0, alertTiming.clearMs + 10_000, snap()).map((r) => ({ ...r, history: history(73, 71) })), on.state);
    expect(off.last).toEqual([]);
  });
});

describe("showing and notifying", () => {
  const a = (id: string, severity: Alert["severity"], since: string, kind: Alert["kind"] = "too-hot"): Alert =>
    ({ id, kind, part: "gpu", severity, title: id, detail: "", since, covers: [`${id}-issue`] });

  it("lists the most severe first, then the newest", () => {
    const list = [a("w-old", "warn", "2026-11-10T00:00:00Z"), a("b", "bad", "2026-11-01T00:00:00Z"), a("w-new", "warn", "2026-11-16T00:00:00Z")];
    expect(ids(sortAlerts(list))).toEqual(["b", "w-new", "w-old"]);
  });

  it("leaves out the kinds a device turned off, and knows which issues the rest cover", () => {
    const list = [a("hot", "bad", "2026-11-01T00:00:00Z"), a("full", "warn", "2026-11-02T00:00:00Z", "drive-full")];
    expect(ids(shownAlerts(list, ["too-hot"]))).toEqual(["full"]);
    expect(shownAlerts(undefined)).toEqual([]);
    expect([...coveredIssues(list)]).toEqual(["hot-issue", "full-issue"]);
  });

  it("notifies once per problem, and not again for the same id within the cooldown", () => {
    const first = alertsToNotify([a("x", "bad", "2026-11-17T10:00:00Z")], {}, T0);
    expect(ids(first.notify)).toEqual(["x"]);
    expect(alertsToNotify([a("x", "bad", "2026-11-17T10:00:00Z")], first.log, T0 + 60_000).notify).toEqual([]);

    const again = alertsToNotify([a("x", "bad", "2026-11-17T20:30:00Z")], first.log, T0 + 3600_000);
    expect(again.notify).toEqual([]);
    expect(alertsToNotify([a("x", "bad", "2026-11-17T20:30:00Z")], again.log, T0 + 7 * 3600_000).notify).toEqual([]);

    const later = alertsToNotify([a("x", "bad", "2026-11-18T05:00:00Z")], again.log, T0 + 7 * 3600_000);
    expect(ids(later.notify)).toEqual(["x"]);
  });

  it("forgets old problems but not one that's still showing", () => {
    const { log } = alertsToNotify([a("x", "bad", "2026-11-01T00:00:00Z"), a("y", "warn", "2026-11-01T00:00:00Z")], {}, T0);
    const week = T0 + 8 * DAY;
    const next = alertsToNotify([a("y", "warn", "2026-11-01T00:00:00Z")], log, week);
    expect(next.notify).toEqual([]);
    expect(Object.keys(next.log)).toEqual(["y"]);
  });
});

describe("the rule table", () => {
  it("has one rule per kind, each described for Settings", () => {
    const kinds = alertRules.map((r) => r.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.sort()).toEqual(["drive-full", "drive-wearing", "fan-stopped", "hotter-than-usual", "too-hot"]);
    for (const r of alertRules) { expect(r.label).toMatch(/^[A-Z][^.]+$/); expect(r.description).toMatch(/\.$/); }
  });
});

describe("LocalClient alerts", () => {
  it("adds alerts to the live view and carries them over a restart", async () => {
    let t = T0;
    const inv = atlas();
    inv.volumes = [{ letter: "C:", label: "Windows", sizeGb: 1000, freeGb: 50 }];
    const store = new MemoryStore();
    const make = () => new LocalClient(new SimulatedLink(inv, fixtures.atlas.facts, { now: () => t }), store, null, { tickMs: 1e9, now: () => t });

    const first = make();
    const [pc] = await first.machines();
    first.stop();
    expect(ids(pc.alerts ?? [])).toEqual(["drive-full:C:"]);
    expect(await store.get("alerts")).toBeTruthy();

    t += 60_000;
    const second = make();
    const [again] = await second.machines();
    second.stop();
    expect(again.alerts?.[0].since).toBe(pc.alerts![0].since);
  });

  it("notices a drive filling up without a restart", async () => {
    let t = T0;
    const inv = atlas();
    const link = new SimulatedLink(inv, fixtures.atlas.facts, { now: () => t });
    let free = 700;
    const client = new LocalClient({ ...link, hello: () => link.hello(), facts: () => link.facts(), snapshot: () => link.snapshot(), apply: (c) => link.apply(c),
      inventory: async () => ({ ...inv, volumes: [{ letter: "C:", sizeGb: 1000, freeGb: free }] }) }, new MemoryStore(), null, { tickMs: 1e9, now: () => t });
    await client.start();
    expect(client.view().alerts).toBeUndefined();
    free = 40;
    t += 11 * MIN;
    await client.tick();
    expect(ids(client.view().alerts ?? [])).toEqual(["drive-full:C:"]);
    client.stop();
  });
});
