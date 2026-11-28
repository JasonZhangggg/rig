import { describe, expect, it } from "vitest";
import { buildPC, categoryState, demoCatalog, fitOf, gainOf, hardwareFacts, makerOf, makersIn, matchesQuery, priceOf, sameRetailPart, shopFor, suggestUpgrades, type Inventory, type Retail } from "../src";
import { fixtures } from "../src/demo";

const atlas = (): Inventory => structuredClone(fixtures.atlas.inv);
const pebble = (): Inventory => structuredClone(fixtures.pebble.inv);
const item = (id: string) => demoCatalog.find((i) => i.id === id)!;

describe("hardware facts", () => {
  it("reads the socket, memory type and free slots from what Windows reports", () => {
    const f = hardwareFacts(atlas());
    expect(f.cpu.socket).toBe("AM5");
    expect(f.memory).toMatchObject({ ddr: 5, slotsTotal: 4, used: 2, stickGb: 16, totalGb: 32 });
    expect(f.board.m2Slots).toBe(3);
    expect(f.draw.total).toBe(120 + 220 + 75);
  });

  it("knows a thin laptop's memory is on the board", () => {
    const f = hardwareFacts(pebble());
    expect(f.laptop).toBe(true);
    expect(f.memory.soldered).toBe(true);
    expect(f.cpu.short).toBe("Core Ultra 7 155H");
  });
});

describe("what fits", () => {
  const f = hardwareFacts(atlas());

  it("memory: the same kit fits the free slots, the wrong type doesn't", () => {
    expect(fitOf(item("m-vengeance-32"), f)).toMatchObject({ verdict: "fits", why: "Same kit as yours, into the 2 free slots." });
    expect(fitOf(item("m-vengeance-32"), f).also[0]).toMatch(/Four sticks of DDR5/);
    expect(fitOf(item("m-flare-32"), f).verdict).toBe("check");
    expect(fitOf(item("m-fury-ddr4"), f)).toMatchObject({ verdict: "no", why: "DDR4 doesn't fit Atlas's DDR5 board." });
    expect(fitOf(item("m-crucial-sodimm"), f).verdict).toBe("no");
    expect(gainOf(item("m-vengeance-32"), f)).toBe("64 GB in all, up from 32 GB");
  });

  it("processor: same socket fits when the BIOS is new enough", () => {
    expect(fitOf(item("c-9800x3d"), f)).toMatchObject({ verdict: "fits", why: "Same AM5 socket, and your BIOS from Mar 2026 already supports it." });
    expect(fitOf(item("c-14700k"), f)).toMatchObject({ verdict: "no", why: "Needs an LGA1700 board. Atlas has AM5." });
    const old = atlas();
    old.board.biosDate = "Jan 2024";
    expect(fitOf(item("c-9800x3d"), hardwareFacts(old)).verdict).toBe("check");
  });

  it("graphics card: checked against the power supply once Rig knows it", () => {
    const card = item("g-5080");
    expect(fitOf(card, f).verdict).toBe("check");
    expect(fitOf(card, f).why).toMatch(/Needs about 555 W/);
    expect(fitOf(card, f, 850).verdict).toBe("fits");
    expect(fitOf(card, f, 650).verdict).toBe("check");
    expect(fitOf(card, f, 500).verdict).toBe("no");
  });

  it("storage: a free M.2 slot fits, a laptop swaps", () => {
    expect(fitOf(item("s-990pro-2"), f)).toMatchObject({ verdict: "fits", why: "Goes in one of the 2 free M.2 slots." });
    const p = hardwareFacts(pebble());
    expect(fitOf(item("s-990pro-2"), p).verdict).toBe("check");
    expect(fitOf(item("s-870evo-2"), p).verdict).toBe("no");
  });

  it("a laptop closes what can't change", () => {
    const p = hardwareFacts(pebble());
    expect(categoryState("memory", p).open).toBe(false);
    expect(categoryState("gpu", p).open).toBe(false);
    expect(categoryState("storage", p)).toMatchObject({ open: true, room: "One M.2 slot, so a swap" });
  });
});

describe("demo prices", () => {
  it("are marked demo, steady between loads and lowest first", () => {
    const s = shopFor(atlas());
    expect(s.demo).toBe(true);
    expect(shopFor(atlas()).items[0].offers).toEqual(s.items[0].offers);
    for (const i of s.items) {
      expect(i.history).toHaveLength(12);
      expect(i.offers[0].price).toBe(i.history[11]);
      expect(i.offers.map((o) => o.price)).toEqual([...i.offers.map((o) => o.price)].sort((a, b) => a - b));
    }
  });
});

describe("what a part adds", () => {
  it("says a same-size laptop drive changes nothing", () => {
    expect(gainOf(item("s-t500-1"), hardwareFacts(pebble()))).toBe("1 TB, same as now");
    expect(gainOf(item("s-990pro-2"), hardwareFacts(pebble()))).toBe("2 TB in all, up from 1 TB");
  });
});

describe("search", () => {
  const find = (q: string) => demoCatalog.filter((i) => matchesQuery(i, q)).map((i) => i.id);

  it("matches every word against the name, maker, kind and specs", () => {
    expect(find("corsair 64")).toEqual(["m-vengeance-64"]);
    expect(find("ddr4")).toEqual(["m-fury-ddr4"]);
    expect(find("memory")).toEqual(expect.arrayContaining(demoCatalog.filter((i) => i.category === "memory").map((i) => i.id)));
    expect(find("cmk32gx5m2b6000c30")).toEqual(["m-vengeance-32"]);
  });

  it("ignores spacing the way people type sizes", () => {
    expect(find("2x48gb")).toEqual(["m-trident-96"]);
    expect(find("9800x3d")).toEqual(["c-9800x3d"]);
    expect(find("rtx 5070")).toHaveLength(2);
  });

  it("finds nothing for a part Rig doesn't list, and everything for an empty search", () => {
    expect(find("optane")).toEqual([]);
    expect(find("  ")).toHaveLength(demoCatalog.length);
  });

  it("names makers from the product name, with the brands that don't split on a space", () => {
    expect(makerOf("be quiet! Pure Power 12 M 750 W")).toBe("be quiet!");
    expect(makerOf("WD_Black SN850X 2 TB")).toBe("WD");
    expect(makerOf("G.Skill Flare X5")).toBe("G.Skill");
    const mem = makersIn(demoCatalog.filter((i) => i.category === "memory"));
    expect(mem[0]).toEqual({ maker: "Corsair", count: 2 });
    expect(mem.map((m) => m.maker)).toEqual(["Corsair", "G.Skill", "Crucial", "Kingston"]);
  });

  it("the demo catalog carries no photos", () => {
    expect(demoCatalog.every((i) => i.image === undefined)).toBe(true);
  });
});

describe("matching a shop's listing to a part", () => {
  it("needs the same model, size and memory type", () => {
    expect(sameRetailPart(item("m-vengeance-32"), "CORSAIR - VENGEANCE 32GB (2PK x 16GB) 6000MHz DDR5 C30 DIMM", "CORSAIR")).toBe(true);
    expect(sameRetailPart(item("m-vengeance-32"), "CORSAIR - VENGEANCE 64GB (2PK x 32GB) 6000MHz DDR5 C30 DIMM", "CORSAIR")).toBe(false);
    expect(sameRetailPart(item("m-vengeance-32"), "CORSAIR - VENGEANCE LPX 32GB (2PK x 16GB) 3200MHz DDR4 DIMM", "CORSAIR")).toBe(false);
    expect(sameRetailPart(item("s-990pro-2"), "Samsung - 990 PRO 2TB Internal SSD PCIe Gen 4x4 NVMe", "Samsung")).toBe(true);
    expect(sameRetailPart(item("s-990pro-2"), "Samsung - 990 EVO Plus 2TB Internal SSD", "Samsung")).toBe(false);
  });

  it("never takes a variant for the plain model, or another maker's part", () => {
    expect(sameRetailPart(item("g-5070"), "NVIDIA - GeForce RTX 5070 Ti 16GB GDDR7 Graphics Card", "NVIDIA")).toBe(false);
    expect(sameRetailPart(item("g-5070ti"), "NVIDIA - GeForce RTX 5070 Ti 16GB GDDR7 Graphics Card", "NVIDIA")).toBe(true);
    expect(sameRetailPart(item("p-rm850x"), "Corsair - RM850x 850W ATX Power Supply", "CORSAIR")).toBe(true);
    expect(sameRetailPart(item("p-rm850x"), "Thermaltake - RM850x clone 850W", "Thermaltake")).toBe(false);
  });

  it("uses the real price where there is one and stays demo while any price is made up", () => {
    const retail: Retail = { shop: "Best Buy", price: 107.99, inStock: true, url: "https://www.bestbuy.com/site/1.p", checkedAt: "2026-11-19T12:00:00Z" };
    const shop = shopFor(atlas(), { from: "Best Buy", hits: new Map([["m-vengeance-32", retail]]) });
    expect(shop.retailFrom).toBe("Best Buy");
    expect(shop.demo).toBe(true);
    const kit = shop.items.find((i) => i.id === "m-vengeance-32")!;
    expect(priceOf(kit)).toBe(107.99);
    expect(priceOf(shop.items.find((i) => i.id === "m-flare-32")!)).toBe(item("m-flare-32").offers[0].price);
    const all = shopFor(atlas(), { from: "Best Buy", hits: new Map(demoCatalog.map((i) => [i.id, retail])) });
    expect(all.demo).toBe(false);
  });
});

describe("a laptop's own parts", () => {
  type Module = Inventory["memory"]["modules"][number];
  const laptop = (modules: Module[], slotsTotal?: number): Inventory => {
    const inv = pebble();
    inv.memory = { totalMb: modules.reduce((n, m) => n + m.capacityMb, 0), slotsTotal, modules };
    return inv;
  };
  // LPDDR5 (SMBIOS type 35) that Windows lists as eight 2 GB modules, one a channel, and calls SO-DIMMs.
  const lpddr = (slotsTotal?: number) => laptop(Array.from({ length: 8 }, (_, i) => ({ capacityMb: 2048, speedMhz: 7467, slot: `Channel${"ABCDEFGH"[i]}`, formFactor: 12, smbiosType: 35 })), slotsTotal);
  const memoryItems = demoCatalog.filter((i) => i.category === "memory");

  it("shows soldered LPDDR memory as one figure, wherever Windows counts several modules", () => {
    for (const inv of [lpddr(), lpddr(16)]) {
      const f = hardwareFacts(inv);
      expect(categoryState("memory", f)).toMatchObject({ open: false, have: "16 GB, built into the board" });
      const ram = buildPC(inv, null, null).parts?.ram;
      expect(ram?.name).toBe("16 GB");
      expect(ram?.soldered).toBe(true);
      expect(ram?.specs.map(([k]) => k)).not.toContain("Slots used");
    }
  });

  it("offers no memory sticks for soldered memory", () => {
    for (const inv of [lpddr(), lpddr(16)]) {
      const f = hardwareFacts(inv);
      for (const i of memoryItems) expect(fitOf(i, f)).toMatchObject({ verdict: "no", why: "Pebble's memory is built into the board, like most thin laptops." });
      expect(suggestUpgrades(inv).filter((u) => u.part === "Memory" && u.fit !== "no")).toEqual([]);
    }
  });

  it("knows chips on the board from their form, even when Windows doesn't name the memory type", () => {
    const inv = laptop([0, 1].map(() => ({ capacityMb: 8192, speedMhz: 6400, formFactor: 21 })));
    expect(categoryState("memory", hardwareFacts(inv)).have).toBe("16 GB, built into the board");
  });

  it("treats a laptop's one reported SO-DIMM stick as a stick", () => {
    const inv = laptop([{ capacityMb: 16384, speedMhz: 5600, formFactor: 12, smbiosType: 34 }]);
    const f = hardwareFacts(inv);
    expect(categoryState("memory", f)).toMatchObject({ open: true, have: "1 × 16 GB DDR5 at 5600 MT/s" });
    expect(fitOf(item("m-crucial-sodimm"), f).verdict).not.toBe("no");
    expect(buildPC(inv, null, null).parts?.ram?.soldered).toBeUndefined();
  });

  it("still takes one module and no slot count as likely soldered when Windows doesn't say its form or type", () => {
    const inv = laptop([{ capacityMb: 16384, speedMhz: 7467 }]);
    expect(hardwareFacts(inv).memory.soldered).toBe(true);
    expect(suggestUpgrades(inv).find((u) => u.part === "Memory")?.title).toBe("Memory may be soldered");
  });

  it("says a gaming laptop's graphics chip is soldered, not built into its processor", () => {
    const inv = pebble();
    inv.cpu.name = "Intel Core i7-14650HX";
    inv.gpus = [
      { name: "Intel UHD Graphics", vendor: "intel", integrated: true },
      { name: "NVIDIA GeForce RTX 4060 Laptop GPU", vendor: "nvidia", vramMb: 8188, integrated: false },
    ];
    const f = hardwareFacts(inv);
    expect(categoryState("gpu", f)).toMatchObject({ open: false, have: "RTX 4060 Laptop GPU, soldered" });
    for (const i of demoCatalog.filter((x) => x.category === "gpu")) {
      expect(fitOf(i, f)).toMatchObject({ verdict: "no", why: "Pebble's RTX 4060 Laptop GPU is soldered to the board." });
    }
  });

  it("says a thin laptop's graphics are built into its processor", () => {
    const f = hardwareFacts(pebble());
    expect(categoryState("gpu", f)).toMatchObject({ open: false, have: "Built into the processor" });
    expect(fitOf(item("g-5070"), f).why).toBe("Pebble's graphics are built into its processor.");
  });
});
