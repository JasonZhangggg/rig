import { describe, expect, it } from "vitest";
import { resolveBuild, slotName } from "../src/build";

const tomahawk = { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" };
const vengeance = (slot: string) => ({ partNumber: "CMK32GX5M2B6000C30", slot });

describe("the 3D view's shape of a PC", () => {
  it("draws the detected board's own layout and the memory as tall as the kit, in the slots it's in", () => {
    const b = resolveBuild({ board: tomahawk, memory: { modules: [vengeance("DIMM_A2"), vengeance("DIMM_B2")] }, gpu: { name: "NVIDIA GeForce RTX 4070 SUPER" } });
    expect(b.board.source).toBe("detected");
    expect(b.board.items.find((i) => i.name === "JFP1")?.pins?.names?.[0]).toBe("HDD LED +");
    expect(b.memory).toMatchObject({ model: "Corsair Vengeance DDR5", height: 35, slots: ["A2", "B2"] });
    // Windows names the chip but not the card, so the card is a typical 4070 SUPER
    expect(b.gpu).toMatchObject({ source: "estimated", length: 270 });
  });

  it("uses the one card Rig knows from that maker, and asks when the maker makes several", () => {
    const msi = resolveBuild({ gpu: { name: "NVIDIA GeForce RTX 4070 SUPER", subsysVendor: "1462" } });
    expect(msi.gpu).toMatchObject({ source: "catalog", model: "MSI RTX 4070 SUPER Ventus 2X OC", length: 242 });
    const asus = resolveBuild({ gpu: { name: "NVIDIA GeForce RTX 4070 SUPER", subsysVendor: "1043" } });
    expect(asus.gpu?.source).toBe("estimated");
    const picked = resolveBuild({ gpu: { name: "NVIDIA GeForce RTX 4070 SUPER", subsysVendor: "1043" }, picks: { gpu: "asus-strix-4070s-oc" } });
    expect(picked.gpu).toMatchObject({ source: "picked", length: 339 });
  });

  it("draws the case and cooler the person picked, and counts how much of the PC is real", () => {
    const b = resolveBuild({ board: tomahawk, memory: { modules: [vengeance("DIMM_A2")] }, gpu: { name: "RTX 4070 SUPER", subsysVendor: "1462" }, picks: { case: "fractal-north", cooler: "noctua-nh-d15" } });
    expect(b.case).toMatchObject({ model: "Fractal Design North", w: 215, h: 469, d: 447 });
    expect(b.cooler.height).toBe(165);
    expect(b.known).toBe(1);
    expect(resolveBuild({}).known).toBe(0);
  });

  it("leaves the graphics card out when the PC has none, and sizes an unknown board by its name", () => {
    expect(resolveBuild({ gpu: null }).gpu).toBeUndefined();
    expect(resolveBuild({ board: { manufacturer: "ASUS", product: "ROG STRIX B650-I GAMING WIFI" } }).board.form).toBe("itx");
    expect(resolveBuild({ board: { manufacturer: "MSI", product: "MAG B650M MORTAR WIFI" } }).board.form).toBe("matx");
    expect(resolveBuild({ board: { manufacturer: "Gigabyte", product: "B650 AORUS ELITE AX" } }).board.form).toBe("atx");
  });

  it("reads the common slot names, and puts sticks in the recommended slots otherwise", () => {
    expect(["DIMM_A2", "A2", "DIMM B1", "DIMM-B2"].map(slotName)).toEqual(["A2", "A2", "B1", "B2"]);
    const b = resolveBuild({ memory: { modules: [{ slot: "Controller0-ChannelA-DIMM1" }, { slot: "Controller1-ChannelA-DIMM1" }] } });
    expect(b.memory.slots).toEqual(["A2", "B2"]);
  });
});
