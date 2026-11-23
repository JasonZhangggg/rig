import { describe, expect, it } from "vitest";
import { boardUsage, buildPC, resolveBuild, type BoardFacts, type Inventory } from "../src";
import atlas from "../src/demo/fixtures/atlas.inventory.json";

const tomahawk = resolveBuild({ board: { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" } }).board;
const facts = (more: Partial<BoardFacts> = {}): BoardFacts => ({
  memory: [{ slot: "DIMM_A2", gb: 16, mts: 6000, maker: "Corsair" }, { slot: "DIMM_B2", gb: 16, mts: 6000, maker: "Corsair" }],
  memorySlots: 4,
  drives: [{ model: "Samsung SSD 990 PRO 2TB", media: "nvme", sizeGb: 2000 }],
  gpu: "NVIDIA GeForce RTX 4070 SUPER",
  fans: [{ id: "f1", name: "Fan #1" }, { id: "f2", name: "Fan #2" }, { id: "f3", name: "Fan #3" }],
  ...more,
});
const group = (gs: ReturnType<typeof boardUsage>, key: string) => gs.find((g) => g.key === key)!;
const states = (gs: ReturnType<typeof boardUsage>, key: string) => Object.fromEntries(group(gs, key).slots.map((s) => [s.name, s.state]));

describe("the motherboard's slot usage", () => {
  it("puts each memory stick in the slot Windows names", () => {
    const g = group(boardUsage(tomahawk, facts()), "memory");
    expect(states([g], "memory")).toEqual({ A1: "free", A2: "used", B1: "free", B2: "used" });
    expect(g.used).toBe(2);
    expect(g.total).toBe(4);
    expect(g.slots.find((s) => s.name === "A2")?.what).toBe("16 GB Corsair, 6000 MT/s");
    expect(g.note).toBe("2 sticks, 32 GB in all.");
  });

  it("says so when Windows doesn't name the memory slots", () => {
    const g = group(boardUsage(tomahawk, facts({ memory: [{ gb: 16 }, { gb: 16, slot: "Controller0-ChannelA" }] })), "memory");
    expect(states([g], "memory")).toEqual({ A1: "free", A2: "used", B1: "free", B2: "used" });
    expect(g.note).toMatch(/didn't say which slots/);
  });

  it("puts the graphics card in the top slot and leaves the others unknown", () => {
    const gs = boardUsage(tomahawk, facts());
    expect(states(gs, "pcie")).toEqual({ PCI_E1: "used", PCI_E2: "unknown", PCI_E3: "unknown" });
    expect(group(gs, "pcie").slots[0].what).toBe("RTX 4070 SUPER");
  });

  it("counts NVMe drives without claiming which M.2 slot holds them", () => {
    const g = group(boardUsage(tomahawk, facts()), "m2");
    expect(g.used).toBe(1);
    expect(g.total).toBe(3);
    expect(g.bySlot).toBe(false);
    expect(g.slots.every((s) => s.state === "unknown")).toBe(true);
    expect(g.note).toBe("Samsung SSD 990 PRO 2TB (2 TB). Windows doesn't say which slot.");
  });

  it("knows every M.2 slot is free with no NVMe drive", () => {
    const g = group(boardUsage(tomahawk, facts({ drives: [{ model: "Crucial MX500", media: "ssd", sizeGb: 1000 }] })), "m2");
    expect(g.slots.every((s) => s.state === "free")).toBe(true);
    expect(group(boardUsage(tomahawk, facts({ drives: [{ model: "Crucial MX500", media: "ssd", sizeGb: 1000 }] })), "sata").used).toBe(1);
  });

  it("counts four SATA ports on one SATA1-4 block", () => {
    expect(group(boardUsage(tomahawk, facts()), "sata").total).toBe(4);
  });

  it("counts spinning fans, and names the header only when the input's name says it", () => {
    const plain = group(boardUsage(tomahawk, facts(), { f1: 900, f2: 1200, f3: 0 }), "fan");
    expect(plain.used).toBe(2);
    expect(plain.total).toBe(6);
    expect(plain.bySlot).toBe(false);
    expect(plain.note).toBe("2 fans spinning on 3 fan inputs. The board doesn't say which header each input is.");
    const named = group(boardUsage(tomahawk, facts({ fans: [{ id: "c", name: "CPU Fan" }, { id: "s", name: "System Fan #2" }] }), { c: 1100, s: 0 }), "fan");
    expect(states([named], "fan")).toMatchObject({ CPU_FAN1: "used", SYS_FAN2: "free", SYS_FAN1: "unknown" });
  });

  it("knows a running PC has its main power plugged in, and nothing about the front panel", () => {
    const gs = boardUsage(tomahawk, facts());
    expect(states(gs, "power")).toEqual({ CPU_PWR1: "used", CPU_PWR2: "unknown", ATX_PWR1: "used" });
    expect(group(gs, "headers").slots.every((s) => s.state === "unknown")).toBe(true);
    expect(group(gs, "headers").slots.map((s) => s.name)).toContain("JFP1");
  });

  it("says when the slots are a typical board's", () => {
    const typical = resolveBuild({ board: { manufacturer: "ASUS", product: "PRIME B650-PLUS" } }).board;
    expect(group(boardUsage(typical, facts()), "memory").note).toMatch(/typical board's/);
  });

  it("reads what's plugged in from the PC's inventory", () => {
    const pc = buildPC(atlas as Inventory, null, null);
    expect(pc.board?.memory.map((m) => m.slot)).toEqual(["A2", "B2"]);
    expect(pc.board?.gpu).toBe("NVIDIA GeForce RTX 4070 SUPER");
    expect(pc.board?.drives[0].media).toBe("nvme");
  });
});
