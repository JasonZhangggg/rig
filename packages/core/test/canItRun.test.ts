import { describe, expect, it } from "vitest";
import { canItRun, hardwareFacts, placeCpu, placeGpu, type GameRequirements, type HardwareFacts, type Inventory, type RunPart } from "../src";
import { DemoClient, demoRequirementsFor, fixtures } from "../src/demo";

const atlas = (edit?: (i: Inventory) => void): HardwareFacts => { const i = structuredClone(fixtures.atlas.inv); edit?.(i); return hardwareFacts(i); };
const pebble = (): HardwareFacts => hardwareFacts(structuredClone(fixtures.pebble.inv));
const sample = (name: string) => demoRequirementsFor(name)!;
const source = { url: "https://store.example.com/game", label: "Store page" };
const game = (r: Partial<GameRequirements>): GameRequirements => ({ game: "Test Game", source, readAt: "2026-11-28T00:00:00Z", ...r });
const level = (a: ReturnType<typeof canItRun>, part: RunPart) => a.parts.find((p) => p.part === part)?.level;

describe("placing parts", () => {
  it("puts processors in coarse tiers, newer and bigger higher", () => {
    expect(placeCpu("AMD Ryzen 7 7800X3D")).toBeGreaterThan(placeCpu("AMD Ryzen 5 3600")!);
    expect(placeCpu("Intel(R) Core(TM) i7-10750H CPU @ 2.60GHz")).toBeGreaterThan(placeCpu("Intel Core i7-4790K")!);
    expect(placeCpu("Intel Core i5-1135G7")).toBeLessThan(placeCpu("Intel Core i5-11600K")!);
    expect(placeCpu("Intel Core Ultra 9 285K")).toBe(placeCpu("Intel Core i9-13900K"));
    expect(placeCpu("AMD Ryzen 7 7840HS")).toBe(placeCpu("AMD Ryzen 5 7600X"));
  });

  it("puts graphics in coarse tiers, and a laptop's card a tier lower", () => {
    expect(placeGpu("NVIDIA GeForce RTX 4070 SUPER")).toBeGreaterThan(placeGpu("NVIDIA GeForce GTX 1060 6GB")!);
    expect(placeGpu("AMD Radeon RX 580 2048SP")).toBe(placeGpu("NVIDIA GeForce GTX 970"));
    expect(placeGpu("NVIDIA GeForce RTX 4060 Laptop GPU")).toBe(placeGpu("NVIDIA GeForce RTX 4060")! - 1);
    expect(placeGpu("AMD Radeon(TM) 780M")).toBe(placeGpu("Intel Arc A380"));
    expect(placeGpu("Intel(R) Iris(R) Xe Graphics")).toBeLessThan(placeGpu("Intel Arc Graphics")!);
  });

  it("says when it can't place a part instead of guessing", () => {
    expect(placeCpu("Quad-core Intel or AMD, 2.5 GHz or faster")).toBeNull();
    expect(placeGpu("Matrox G200eW3")).toBeNull();
    expect(placeGpu("Video card must be 1 GB or more and should be a DirectX 11-compatible")).toBeNull();
  });
});

describe("can it run", () => {
  it("runs well when every part meets the recommended", () => {
    const a = canItRun(atlas(), sample("Forza Horizon 5"));
    expect(a.verdict).toBe("well");
    expect(a.headline).toBe("Atlas runs Forza Horizon 5 well");
    expect(a.holder).toBeUndefined();
    expect(a.parts.map((p) => [p.label, p.yours, p.level])).toEqual([
      ["Processor", "Ryzen 7 7800X3D", "recommended"],
      ["Graphics card", "RTX 4070 SUPER", "recommended"],
      ["Memory", "32 GB", "recommended"],
      ["Free space", "1,914 GB free on D:", "recommended"],
      ["Windows", "Windows 11 Pro", "recommended"],
    ]);
  });

  it("runs at low settings when a part meets only the minimum, and names it", () => {
    const a = canItRun(pebble(), sample("Forza Horizon 5"));
    expect(a.verdict).toBe("low");
    expect(a.headline).toBe("Pebble runs Forza Horizon 5 at low settings");
    expect(a.sub).toBe("Its graphics are below what the game recommends.");
    expect(a.holder).toBe("gpu");
    // A laptop's graphics are part of the processor, so there's nothing to point at in Upgrades.
    expect(a.upgrade).toBeUndefined();
  });

  it("is below the minimum when a part is short of it, and names that part first", () => {
    const a = canItRun(pebble(), sample("Microsoft Flight Simulator 2024"));
    expect(a.verdict).toBe("below");
    expect(a.headline).toBe("Pebble is below Microsoft Flight Simulator 2024's minimum");
    expect(a.sub).toBe("Its graphics are below the minimum the game asks for.");
    expect(level(a, "memory")).toBe("minimum");
  });

  it("points to Upgrades for the part holding a desktop back", () => {
    const a = canItRun(atlas((i) => { i.gpus[0].name = "NVIDIA GeForce GTX 1050 Ti"; i.gpus[0].vramMb = 4096; }), sample("Forza Horizon 5"));
    expect(a.verdict).toBe("below");
    expect(a.holder).toBe("gpu");
    expect(a.upgrade).toBe("gpu");
    const mem = canItRun(atlas((i) => { i.memory.totalMb = 16384; i.memory.modules = i.memory.modules.slice(0, 1); }), sample("Microsoft Flight Simulator 2024"));
    expect([mem.verdict, mem.holder, mem.upgrade]).toEqual(["low", "memory", "memory"]);
  });

  it("only meets the minimum when the page lists no recommended", () => {
    const a = canItRun(atlas(), sample("Counter-Strike 2"));
    expect(a.verdict).toBe("meets");
    expect(a.headline).toBe("Atlas meets Counter-Strike 2's minimum");
    expect(a.sub).toBe("The page lists only a minimum, so Rig can't say how high the settings can go.");
    // The page names no card, only 1 GB of video memory, which a 12 GB card has.
    expect(level(a, "gpu")).toBe("minimum");
  });

  it("leaves out a part it couldn't place, and says so", () => {
    const a = canItRun(pebble(), sample("Counter-Strike 2"));
    expect(a.verdict).toBe("meets");
    expect(a.sub).toContain("Rig couldn't compare the graphics, so this is from the other parts.");
    expect(a.parts.find((p) => p.part === "gpu")).toMatchObject({ level: "unknown", why: "Rig couldn't place the graphics the page asks for." });

    const odd = canItRun(atlas((i) => { i.gpus[0].name = "Matrox G200eW3"; }), sample("Forza Horizon 5"));
    expect(odd.verdict).toBe("well");
    expect(odd.sub).toBe("Rig couldn't compare the graphics card, so this is from the other parts.");
    expect(odd.parts.find((p) => p.part === "gpu")).toMatchObject({ yours: "Matrox G200eW3", level: "unknown", why: "Rig couldn't place your graphics card against the game's." });
  });

  it("can't compare when the page names nothing Rig can place", () => {
    const a = canItRun(atlas(), game({ minimum: { cpu: "Quad-core, 2.5 GHz", gpu: "DirectX 12 compatible" } }));
    expect(a.verdict).toBe("unknown");
    expect(a.headline).toBe("Rig couldn't compare Atlas with Test Game");
  });

  it("says when the page had no requirements at all", () => {
    const a = canItRun(atlas(), game({}));
    expect(a.verdict).toBe("unknown");
    expect(a.headline).toBe("Rig couldn't find Test Game's requirements on the page");
    expect(a.parts).toEqual([]);
  });

  it("takes a line the recommended leaves out to be the minimum's", () => {
    const a = canItRun(atlas(), game({ minimum: { gpu: "GTX 970", storageGb: 60 }, recommended: { gpu: "RTX 2070" } }));
    expect(a.verdict).toBe("well");
    expect(a.parts.find((p) => p.part === "storage")).toMatchObject({ level: "recommended", recommended: "60 GB" });
  });

  it("holds the PC against the alternative from its own maker", () => {
    // An Intel laptop against "Radeon RX 6600 or Arc A380": the Arc is the one to compare with.
    const a = canItRun(pebble(), game({ minimum: { gpu: "AMD Radeon RX 6600 or Intel Arc A380" } }));
    expect(level(a, "gpu")).toBe("minimum");
  });

  it("checks free space, and an SSD where the page asks for one", () => {
    const full = canItRun(atlas((i) => { for (const v of i.volumes) v.freeGb = 40; }), sample("Forza Horizon 5"));
    expect([full.verdict, full.holder, full.sub]).toEqual(["below", "storage", "No drive has 110 GB free."]);
    const hdd = canItRun(atlas((i) => { for (const d of i.disks) d.media = "hdd"; }), game({ minimum: { storageGb: 50, ssd: true } }));
    expect(hdd.parts[0]).toMatchObject({ part: "storage", level: "below", minimum: "50 GB on an SSD" });
  });

  it("checks the Windows version, and the build where the page gives one", () => {
    const ten = (build: string) => atlas((i) => { i.machine.os = { name: "Windows 10 Home", version: "22H2", build }; });
    expect(level(canItRun(ten("19045.5011"), game({ minimum: { os: "Windows 11 64-bit" } })), "os")).toBe("below");
    expect(level(canItRun(ten("19045.5011"), game({ minimum: { os: "Windows 10/11 64-bit" } })), "os")).toBe("minimum");
    expect(level(canItRun(ten("17763.1"), sample("Forza Horizon 5")), "os")).toBe("below");
    expect(level(canItRun(atlas(), sample("Forza Horizon 5")), "os")).toBe("recommended");
  });

  it("counts video memory the page asks for", () => {
    const a = canItRun(atlas(), game({ minimum: { gpu: "GTX 1060", vramGb: 6 }, recommended: { gpu: "RTX 3060", vramGb: 16 } }));
    expect([a.verdict, a.holder]).toEqual(["low", "gpu"]);
  });

  it("works with facts from a server older than the check", () => {
    const old = atlas();
    delete old.os; delete old.volumes; delete old.igpu;
    const a = canItRun(old, sample("Forza Horizon 5"));
    expect(a.verdict).toBe("well");
    expect(a.parts.find((p) => p.part === "storage")).toMatchObject({ yours: "Not known", level: "unknown", why: "Rig hasn't read your drives yet." });
    expect(a.parts.find((p) => p.part === "os")).toMatchObject({ level: "unknown" });
  });
});

describe("the demo's requirements", () => {
  it("finds a sample by the game's name or a nickname", async () => {
    const demo = new DemoClient();
    expect((await demo.gameRequirements("fh5"))?.game).toBe("Forza Horizon 5");
    expect((await demo.gameRequirements("counter-strike 2"))?.demo).toBe(true);
    await expect(demo.gameRequirements("Some Other Game")).rejects.toThrow("The demo has requirements for Forza Horizon 5, Microsoft Flight Simulator 2024 and Counter-Strike 2. Try one of those.");
  });
});
