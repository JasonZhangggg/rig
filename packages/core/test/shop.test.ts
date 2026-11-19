import { describe, expect, it } from "vitest";
import { categoryState, demoCatalog, fitOf, gainOf, hardwareFacts, shopFor, type Inventory } from "../src";
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
