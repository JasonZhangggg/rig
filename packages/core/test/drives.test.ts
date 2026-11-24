import { describe, expect, it } from "vitest";
import { LocalClient, MemoryStore, buildPC, driveMaps, type Disk, type HelperLink, type StorageScan, type Volume } from "../src";
import { DemoClient, SimulatedLink, fixtures } from "../src/demo";

const nvme = (over: Partial<Disk> = {}): Disk => ({ model: "Samsung SSD 990 PRO 2TB", sizeGb: 2000, media: "nvme", healthPercent: 98, writtenTb: 14.2, status: "healthy", number: 0, powerOnHours: 3120, ...over });
const hdd = (over: Partial<Disk> = {}): Disk => ({ model: "ST4000DM004", sizeGb: 4000, media: "hdd", status: "healthy", number: 1, ...over });
const vol = (letter: string, sizeGb: number, freeGb: number, disk?: number, label?: string): Volume => ({ letter, sizeGb, freeGb, ...(disk != null ? { disk } : {}), ...(label ? { label } : {}) });
const scan = (volumes: StorageScan["volumes"], over: Partial<StorageScan> = {}): StorageScan => ({ at: Date.UTC(2026, 10, 23, 12), running: false, volumes, ...over });

describe("the storage map", () => {
  it("puts each volume on its own drive, Windows' drive first", () => {
    const maps = driveMaps({ disks: [hdd(), nvme()], volumes: [vol("D:", 3726, 1914, 1, "Games"), vol("C:", 1862, 726, 0, "Windows")] }, null);
    expect(maps.map((m) => [m.model, m.volumes, m.system])).toEqual([
      ["Samsung SSD 990 PRO 2TB", ["C: Windows"], true],
      ["ST4000DM004", ["D: Games"], false],
    ]);
    expect(maps[1]).toMatchObject({ usedGb: 1812, freeGb: 1914 });
  });

  it("shows used and free until the folders are measured", () => {
    const [m] = driveMaps({ disks: [nvme()], volumes: [vol("C:", 1000, 400, 0)] }, null);
    expect(m.fills).toEqual([{ kind: "other", label: "Used", gb: 600 }, { kind: "free", label: "Free", gb: 400 }]);
    expect(m.scannedAt).toBeUndefined();
  });

  it("splits a measured drive by what fills it, biggest first, with what Rig couldn't sort as Other", () => {
    const s = scan([{ letter: "C:", fills: [
      { kind: "windows", gb: 40 }, { kind: "games", gb: 300, top: [{ name: "Baldur's Gate 3", gb: 148 }, { name: "Tiny game", gb: 0.4 }] },
      { kind: "files", gb: 120 }, { kind: "system", gb: 0.3 },
    ] }]);
    const [m] = driveMaps({ disks: [nvme()], volumes: [vol("C:", 1000, 400, 0)] }, s);
    expect(m.fills.map((f) => [f.label, f.gb])).toEqual([["Games", 300], ["Your files", 120], ["Windows", 40], ["Other", 140], ["Free", 400]]);
    // Things under a gigabyte aren't named.
    expect(m.fills[0].top).toEqual([{ name: "Baldur's Gate 3", gb: 148 }]);
    expect(m.scannedAt).toBe("2026-11-23T12:00:00.000Z");
  });

  it("never counts more than the drive has used, when Windows' shared files are counted twice", () => {
    const s = scan([{ letter: "C:", fills: [{ kind: "windows", gb: 300 }, { kind: "apps", gb: 300 }] }]);
    const [m] = driveMaps({ disks: [nvme()], volumes: [vol("C:", 1000, 600, 0)] }, s);
    expect(m.fills.map((f) => [f.label, f.gb])).toEqual([["Windows", 200], ["Apps", 200], ["Free", 600]]);
  });

  it("adds up two volumes on one drive, naming which volume each big thing is on", () => {
    const s = scan([
      { letter: "C:", fills: [{ kind: "games", gb: 50, top: [{ name: "Minecraft", gb: 50 }] }] },
      { letter: "E:", fills: [{ kind: "games", gb: 80, top: [{ name: "Forza Horizon 5", gb: 80 }] }] },
    ]);
    const [m] = driveMaps({ disks: [nvme()], volumes: [vol("C:", 100, 50, 0), vol("E:", 200, 120, 0)] }, s);
    expect(m.fills[0]).toEqual({ kind: "games", label: "Games", gb: 130, top: [{ name: "Forza Horizon 5 (E:)", gb: 80 }, { name: "Minecraft (C:)", gb: 50 }] });
  });

  it("says a measurement is running", () => {
    const [m] = driveMaps({ disks: [nvme()], volumes: [vol("C:", 1000, 400, 0)] }, scan([], { at: undefined, running: true }));
    expect(m.scanning).toBe(true);
    expect(m.fills[0].label).toBe("Used");
  });

  it("puts every volume on the only drive when the helper doesn't say which drive they're on", () => {
    const [m, ...rest] = driveMaps({ disks: [nvme({ number: undefined })], volumes: [vol("C:", 1000, 400), vol("D:", 500, 100)] }, null);
    expect(rest).toEqual([]);
    expect(m.volumes).toEqual(["C:", "D:"]);
  });

  it("keeps volumes it can't place on a drive apart, and says so", () => {
    const maps = driveMaps({ disks: [nvme({ number: undefined }), hdd({ number: undefined })], volumes: [vol("C:", 1000, 400)] }, null);
    expect(maps.map((m) => m.model)).toEqual(["Other drives", "Samsung SSD 990 PRO 2TB", "ST4000DM004"]);
    expect(maps[0].unknown).toEqual(["Which drive these volumes are on"]);
    expect(maps[1].fills).toEqual([]);
  });

  it("gives one health verdict, worst first", () => {
    const verdict = (d: Partial<Disk>) => driveMaps({ disks: [nvme(d)], volumes: [] }, null)[0].health;
    expect(verdict({})).toEqual({ sev: "ok", text: "Healthy" });
    expect(verdict({ status: "unhealthy", healthPercent: 5 })).toEqual({ sev: "bad", text: "Windows says it's failing" });
    expect(verdict({ status: "warning" })).toEqual({ sev: "warn", text: "Windows sees a problem" });
    expect(verdict({ healthPercent: 8 })).toEqual({ sev: "bad", text: "Nearly worn out" });
    expect(verdict({ healthPercent: 15 })).toEqual({ sev: "warn", text: "Wearing out" });
    expect(verdict({ errors: 3 })).toEqual({ sev: "warn", text: "3 errors it couldn't fix" });
    expect(verdict({ status: undefined, healthPercent: undefined })).toEqual({ sev: "info", text: "No health reading" });
  });

  it("lists what Windows doesn't say about a drive instead of guessing", () => {
    const [, h] = driveMaps({ disks: [nvme(), hdd({ powerOnHours: undefined })], volumes: [] }, null);
    expect(h.unknown).toEqual(["Wear: hard drives don't count it", "Hours powered on: not reported"]);
    const [old] = driveMaps({ disks: [{ model: "Old SSD", sizeGb: 500, media: "ssd" }], volumes: [] }, null);
    expect(old.unknown).toEqual(["Life left: this drive doesn't report it", "Data written: not reported", "Hours powered on: not reported", "Windows' health check: no answer"]);
  });

  it("rides on the PC view, so the website shows the same map", () => {
    const s = scan([{ letter: "C:", fills: [{ kind: "games", gb: 200 }] }]);
    const pc = buildPC(fixtures.atlas.inv, null, null, {}, {}, { scan: s });
    expect(pc.drives?.map((d) => d.model)).toEqual(["Samsung SSD 990 PRO 2TB", "ST4000DM004-2U9104"]);
    expect(pc.drives?.[0].fills.map((f) => f.label)).toEqual(["Games", "Other", "Free"]);
    // D: wasn't in that scan, so it shows used and free.
    expect(pc.drives?.[1].fills.map((f) => f.label)).toEqual(["Used", "Free"]);
  });
});

describe("measuring drives on this PC", () => {
  function setup(storage: HelperLink["storage"]) {
    let t = new Date("2026-11-17T20:00:00").getTime();
    const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => t });
    const link: HelperLink = { hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c), storage };
    const client = new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => t });
    return { client, advance: (ms: number) => { t += ms; } };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("asks the helper for its last scan, and again often while one runs", async () => {
    const asked: boolean[] = [];
    let running = true;
    const { client, advance } = setup(async (fresh) => { asked.push(!!fresh); return scan(running ? [] : [{ letter: "C:", fills: [{ kind: "games", gb: 400 }] }], { running }); });
    await client.start();
    await flush();
    expect((await client.machines())[0].drives?.[0].scanning).toBe(true);
    advance(5_000); await client.tick(); await flush();
    expect(asked).toEqual([false]);
    running = false;
    advance(15_000); await client.tick(); await flush();
    const [pc] = await client.machines();
    expect(asked).toEqual([false, false]);
    expect(pc.drives?.[0].scanning).toBeUndefined();
    expect(pc.drives?.[0].fills[0].label).toBe("Games");
    // Once done, it waits half an hour before asking again.
    advance(60_000); await client.tick(); await flush();
    expect(asked).toHaveLength(2);
    await client.measureDrives!(fixtures.atlas.inv.machine.id);
    client.stop();
    expect(asked).toEqual([false, false, true]);
  });

  it("offers no measuring with a helper that can't scan", async () => {
    const { client } = setup(undefined);
    client.stop();
    expect(client.measureDrives).toBeUndefined();
  });

  it("measures the demo drives again", async () => {
    const demo = new DemoClient();
    const seen: (boolean | undefined)[] = [];
    const stop = demo.watch("demo-pebble", (pc) => seen.push(pc.drives?.[0].scanning));
    const done = demo.measureDrives("demo-pebble");
    expect(seen.at(-1)).toBe(true);
    await done;
    stop();
    expect(seen.at(-1)).toBeUndefined();
  }, 10_000);
});
