import { describe, expect, it } from "vitest";
import { resolveBuild } from "@rig/core";

const { pinGroups } = await import("../src/boardScene");

const board = resolveBuild({ board: { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" } }).board;
const item = (id: string) => board.items.find((i) => i.id === id)!;
const said = (id: string) => Object.fromEntries(pinGroups(item(id)).map((g) => [g.name, g.pins.map((p) => `${p.number}${p.sign}`).join(" ")]));

describe("the board view's pin map", () => {
  it("names the front panel pins as MSI's manual does", () => {
    expect(said("fp")).toEqual({ "HDD LED": "1+ 3−", "Power LED": "2+ 4−", Reset: "5 7", "Power switch": "6 8", Reserved: "9" });
  });

  it("lists fan header pins in order, each its own wire", () => {
    expect(said("cpu-fan")).toEqual({ Ground: "1", "+12V": "2", Speed: "3", PWM: "4" });
  });

  it("leaves out a header's missing pin", () => {
    expect(Object.values(said("jargb1")).join(" ")).toBe("1 2 4");
  });

  it("gives every kind of plug its own color", () => {
    const colors = pinGroups(item("fp")).map((g) => g.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("has no pin map for a header without named pins", () => {
    expect(pinGroups(item("jusb1"))).toEqual([]);
  });
});
