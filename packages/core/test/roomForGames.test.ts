import { describe, expect, it } from "vitest";
import { gameTitle, moveOne, roomFor, roomWords, type DriveMap } from "../src";
import { DemoClient } from "../src/demo";

const drive = (over: Partial<DriveMap> & { games?: [string, number][] }): DriveMap => {
  const { games, ...rest } = over;
  return {
    model: "Samsung SSD 990 PRO 2TB", media: "nvme", sizeGb: 2000, volumes: ["C: Windows"], system: true, freeGb: 726,
    fills: [
      ...(games ? [{ kind: "games" as const, label: "Games", gb: games.reduce((n, [, g]) => n + g, 0), top: games.map(([name, gb]) => ({ name, gb })) }] : [{ kind: "files" as const, label: "Your files", gb: 300 }]),
      { kind: "free", label: "Free", gb: rest.freeGb ?? 726 },
    ],
    health: { sev: "ok", text: "Healthy" }, unknown: [],
    ...rest,
  };
};

const c = drive({ games: [["Baldur's Gate 3", 148], ["Counter-Strike 2", 61], ["Rocket League", 27]] });
const d = drive({ model: "ST4000DM004", media: "hdd", volumes: ["D: Games"], system: false, freeGb: 1914, games: [["Call of Duty", 238], ["Cyberpunk 2077", 78]] });

describe("room for games", () => {
  it("counts a drive's free space in installs of its biggest game", () => {
    expect(roomFor(c, [c, d])).toEqual({ freeGb: 726, ref: { name: "Baldur's Gate 3", gb: 148 }, big: true, count: 4, spareGb: 134 });
    expect(roomWords(roomFor(c, [c, d])!)).toEqual({
      headline: "Room for about 4 more big games",
      detail: "726 GB free: 4 installs the size of Baldur's Gate 3 (148 GB), with 134 GB to spare.",
    });
    expect(roomFor(d, [c, d])).toMatchObject({ ref: { name: "Call of Duty", gb: 238 }, count: 8 });
  });

  it("uses the PC's biggest game on a drive that holds none", () => {
    const backups = drive({ model: "WD Elements", media: "hdd", volumes: ["E:"], system: false, freeGb: 500 });
    expect(roomFor(backups, [c, d, backups])).toMatchObject({ ref: { name: "Call of Duty", gb: 238 }, count: 2 });
  });

  it("says nothing in games when Rig found no games at all", () => {
    const plain = drive({});
    expect(roomFor(plain, [plain])).toBeNull();
    expect(roomFor({ ...c, freeGb: undefined }, [c])).toBeNull();
  });

  it("says so when even one more won't fit", () => {
    const full = drive({ freeGb: 92, games: [["Baldur's Gate 3", 148]] });
    expect(roomWords(roomFor(full, [full])!)).toEqual({
      headline: "Not enough room for another big game",
      detail: "92 GB free, less than Baldur's Gate 3 takes (148 GB).",
    });
  });

  it("counts small games by name rather than calling them big", () => {
    const laptop = drive({ freeGb: 548, games: [["Minecraft", 12], ["Stardew Valley", 2]] });
    expect(roomWords(roomFor(laptop, [laptop])!).headline).toBe("Room for about 45 more games like Minecraft");
  });

  it("skips launcher leftovers and copes with folders that don't name their game", () => {
    expect(gameTitle("Steam library extras")).toBeUndefined();
    expect(gameTitle("Riot Games")).toBeUndefined();
    expect(gameTitle("Microsoft.624F8B84B80_8wekyb3d8bbwe")).toBeNull();
    expect(gameTitle("Forza Horizon 5 (D:)")).toBe("Forza Horizon 5");
    const odd = drive({ freeGb: 400, games: [["Steam library extras", 300], ["Microsoft.624F8B84B80_8wekyb3d8bbwe", 120], ["Hades", 15]] });
    // The biggest game with a name sets the count; the nameless one isn't offered to move.
    expect(roomFor(odd, [odd])).toMatchObject({ ref: { name: "Hades", gb: 15 }, count: 26 });
    const nameless = drive({ freeGb: 400, games: [["Microsoft.624F8B84B80_8wekyb3d8bbwe", 120]] });
    expect(roomWords(roomFor(nameless, [nameless])!)).toEqual({
      headline: "Room for about 3 more big games",
      detail: "400 GB free: 3 installs the size of your biggest game (120 GB), with 40 GB to spare.",
    });
  });

  it("offers the biggest game that fits on the roomier drive, and what that frees", () => {
    expect(moveOne(c, [c, d])).toEqual({ game: { name: "Baldur's Gate 3", gb: 148 }, to: "D:", gain: 1, speed: "slower" });
    // Nowhere roomier for D:.
    expect(moveOne(d, [c, d])).toBeNull();
    // Only what fits there.
    const tight = { ...d, freeGb: 1000 };
    const cBig = drive({ freeGb: 300, games: [["Call of Duty", 1100], ["Starfield", 140]] });
    expect(moveOne(cBig, [cBig, tight])).toMatchObject({ game: { name: "Starfield", gb: 140 }, to: "D:" });
    // A single drive has nowhere to move to.
    expect(moveOne(c, [c])).toBeNull();
  });

  it("counts the demo PC's drives in its own games", async () => {
    const drives = (await new DemoClient().machines()).find((m) => m.drives?.length === 2)!.drives!;
    expect(drives.map((x) => roomFor(x, drives) && roomWords(roomFor(x, drives)!).headline)).toEqual(["Room for about 4 more big games", "Room for about 8 more big games"]);
    expect(moveOne(drives[0], drives)).toMatchObject({ game: { name: "Baldur's Gate 3" }, to: "D:", gain: 1, speed: "slower" });
  });
});
