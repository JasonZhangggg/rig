// Free up space: what's safe to clear, what each frees, and how, from fixed sizes, a fixed scan and a fixed history.
import { describe, expect, it } from "vitest";
import { checkStep, cleanSizes, findings, freeSpaceWords, freeUpSpace, helperStep, playedFrom, type CleanupRead, type DriveMap, type HistoryPoint } from "../src";
import { DemoClient, fixtures } from "../src/demo";

const DAY = 864e5;
const NOW = Date.UTC(2026, 10, 28, 12);

const drive = (over: Partial<DriveMap> & { games?: [string, number][] }): DriveMap => {
  const { games, ...rest } = over;
  return {
    model: "Samsung SSD 990 PRO 2TB", media: "nvme", sizeGb: 2000, volumes: ["C: Windows"], system: true, freeGb: 60,
    fills: [
      ...(games ? [{ kind: "games" as const, label: "Games", gb: games.reduce((n, [, g]) => n + g, 0), top: games.map(([name, gb]) => ({ name, gb })) }] : []),
      { kind: "free", label: "Free", gb: rest.freeGb ?? 60 },
    ],
    health: { sev: "ok", text: "Healthy" }, unknown: [],
    ...rest,
  };
};
const c = drive({ games: [["Baldur's Gate 3", 148], ["Counter-Strike 2", 61], ["Steam library extras", 9]] });
const d = drive({ model: "ST4000DM004", media: "hdd", volumes: ["D: Games"], system: false, freeGb: 1900, games: [["Red Dead Redemption 2", 121], ["Cyberpunk 2077", 78]] });

const read = (over: Partial<CleanupRead> = {}): CleanupRead => ({
  sizes: {
    at: NOW, storageSense: false,
    spots: [
      { kind: "windowsOld", gb: 18, drive: "C:" }, { kind: "userTemp", gb: 4.4, drive: "C:" }, { kind: "windowsTemp", gb: 1.6, drive: "C:" },
      { kind: "updateCache", gb: 4.1, drive: "C:" }, { kind: "recycleBin", gb: 2.2, drive: "C:" }, { kind: "recycleBin", gb: 0.8, drive: "D:" },
      { kind: "thumbnails", gb: 0.04, drive: "C:" }, { kind: "oldDownloads", gb: 14.2, drive: "C:", files: 212 },
    ],
  },
  played: [{ name: "Baldur's Gate 3", lastPlayed: NOW - 2 * DAY }, { name: "Cyberpunk 2077", lastPlayed: NOW - 150 * DAY }],
  historyFrom: NOW - 90 * DAY,
  ...over,
});

describe("free up space", () => {
  it("lists the safe ones biggest first, then what to look at first, and adds up what the safe ones free", () => {
    const plan = freeUpSpace(read(), [c, d], NOW);
    expect(plan.items.map((i) => [i.title, i.gb, i.safety])).toEqual([
      ["Previous version of Windows", 18, "safe"],
      ["Temporary files", 6, "safe"],
      ["Windows Update files", 4.1, "safe"],
      ["Recycle Bin", 3, "safe"],
      ["Red Dead Redemption 2", 121, "look"],
      ["Cyberpunk 2077", 78, "look"],
      ["Counter-Strike 2", 61, "look"],
      ["Old downloads", 14.2, "look"],
    ]);
    expect(plan.safeGb).toBe(31.1);
    expect(freeSpaceWords(plan)).toEqual({ headline: "You could free about 31 GB", detail: "From files Windows makes again or no longer needs. Games you haven't played and old downloads hold 274 GB more." });
  });

  it("joins the two temp folders and each drive's Recycle Bin into one row, and leaves out what's too small to matter", () => {
    const plan = freeUpSpace(read(), [c, d], NOW);
    expect(plan.items.find((i) => i.id === "recycleBin")).toMatchObject({ gb: 3, where: "C: and D:" });
    expect(plan.items.find((i) => i.id === "temp")).toMatchObject({ gb: 6, where: "C:" });
    expect(plan.items.some((i) => i.id === "thumbnails")).toBe(false);
    expect(plan.items.find((i) => i.id === "oldDownloads")?.what).toBe("212 files in Downloads from more than 3 months ago.");
  });

  it("calls a game unplayed only when it last played 90 days ago, or the history reaches back that far without it", () => {
    const games = (r: CleanupRead) => freeUpSpace(r, [c, d], NOW).items.filter((i) => i.id.startsWith("game:")).map((i) => `${i.title}: ${i.what} on ${i.where}`);
    expect(games(read())).toEqual([
      "Red Dead Redemption 2: Not played in the last 3 months on D:",
      "Cyberpunk 2077: Last played 5 months ago on D:",
      "Counter-Strike 2: Not played in the last 3 months on C:",
    ]);
    // A month of history can't say a game went unplayed for three; one it saw long ago still counts.
    expect(games(read({ historyFrom: NOW - 30 * DAY }))).toEqual(["Cyberpunk 2077: Last played 5 months ago on D:"]);
    expect(games(read({ historyFrom: null, played: [] }))).toEqual([]);
  });

  it("never deletes a game itself: it's steps in the launcher it came from", () => {
    const rdr = freeUpSpace(read(), [c, d], NOW).items.find((i) => i.title === "Red Dead Redemption 2")!;
    expect(rdr.how.kind).toBe("steps");
    expect(rdr.how.steps.join(" ")).toMatch(/launcher.*Uninstall/);
    expect(rdr.note).toMatch(/rather than deleting its folder/);
  });

  it("offers Storage Sense, Rig's own reversible recipe, only while it's off or unknown", () => {
    const plan = freeUpSpace(read(), [c, d], NOW);
    expect(plan.storageSense).toEqual({ step: { kind: "recipe", id: "storageSense", params: { state: "on" } }, covers: ["Temporary files", "Recycle Bin"] });
    const step = helperStep(plan.storageSense!.step);
    expect(typeof step).not.toBe("string");
    // Checked like any change: a registry value in the person's own settings, snapshotted and put back on undo.
    expect(checkStep(plan.storageSense!.step)).toMatchObject({ status: "allowed", tier: 2, admin: false });
    expect(freeUpSpace(read({ sizes: { ...read().sizes, storageSense: true } }), [c, d], NOW).storageSense).toBeNull();
    expect(freeUpSpace(read({ sizes: { ...read().sizes, storageSense: null } }), [c, d], NOW).storageSense).not.toBeNull();
  });

  it("says when there's little to clear", () => {
    const plan = freeUpSpace(read({ sizes: { at: NOW, spots: [{ kind: "userTemp", gb: 0.3, drive: "C:" }] }, played: [], historyFrom: null }), [], NOW);
    expect(freeSpaceWords(plan)).toEqual({ headline: "Not much to clear", detail: "Windows' own leftovers take less than 1 GB." });
  });

  it("drops anything in the helper's answer Rig doesn't know", () => {
    expect(cleanSizes({ at: 5, spots: [
      { kind: "userTemp", gb: 1.5, drive: "c:", files: 3 }, { kind: "system32", gb: 9 }, { kind: "thumbnails", gb: "lots" },
      { kind: "recycleBin", gb: 1, drive: "\\\\server\\share" }, { kind: "crashDumps", gb: -1 }, { kind: "windowsOld", gb: 2, partial: true, path: "C:\\Windows.old" },
    ], storageSense: "yes" })).toEqual({ at: 5, storageSense: null, spots: [{ kind: "userTemp", gb: 1.5, drive: "C:", files: 3 }, { kind: "recycleBin", gb: 1 }, { kind: "windowsOld", gb: 2, partial: true }] });
    expect(cleanSizes(null).spots).toEqual([]);
  });

  it("reads when each game last played, and how far back the history goes", () => {
    const pt = (t: number, game?: string | null) => ({ t, game }) as HistoryPoint;
    expect(playedFrom([pt(NOW - 80 * DAY, "Cyberpunk 2077"), pt(NOW - 3 * DAY, "Cyberpunk 2077"), pt(NOW - 90 * DAY), pt(NOW, null)]))
      .toEqual({ played: [{ name: "Cyberpunk 2077", lastPlayed: NOW - 3 * DAY }], historyFrom: NOW - 90 * DAY });
  });

  it("opens the storage map, not the chat, when a drive is nearly full", () => {
    const inv = structuredClone(fixtures.atlas.inv);
    inv.volumes[0].freeGb = 90;
    const full = findings({ inv, snap: null, facts: null }).find((f) => f.id === "vol-C:")!;
    expect(full).toMatchObject({ title: "Drive C: is nearly full", go: "pc", part: "ssd", tab: "drives", action: "See what to clear" });
  });
});

describe("the demo's safe-to-clear places", () => {
  it("has about 38 GB on Atlas, two games not played in months, and Storage Sense off", async () => {
    const demo = new DemoClient();
    const pc = (await demo.machines()).find((p) => p.id === "demo-atlas")!;
    const plan = freeUpSpace(await demo.cleanupSizes!(pc.id), pc.drives ?? [], Date.now());
    expect(freeSpaceWords(plan).headline).toBe("You could free about 38 GB");
    expect(plan.items.find((i) => i.id === "windowsOld")?.gb).toBe(18);
    expect(plan.items.filter((i) => i.id.startsWith("game:")).map((i) => i.title)).toEqual(["Microsoft Flight Simulator", "Red Dead Redemption 2"]);
    expect(plan.storageSense).not.toBeNull();
  });
});
