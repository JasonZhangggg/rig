// The sections of a manual to jump to: each once, the ones a part needs first, the rest grouped.
import { describe, expect, it } from "vitest";
import type { ManualDiagram } from "@rig/core";
import { groupedJumps, jumpPages, keyJumps, manualJumps } from "../src/manuals/words";

// What Rig found in a real 101-page ASRock board manual: some sections on two pages, two install steps.
const asrock: ManualDiagram[] = [
  { page: 7, kind: "specs", label: "Specifications" },
  { page: 8, kind: "rear-io", label: "Rear ports" },
  { page: 12, kind: "board-layout", label: "Board layout" },
  { page: 12, kind: "fan-headers", label: "Fan headers" },
  { page: 12, kind: "rgb-headers", label: "RGB headers" },
  { page: 12, kind: "usb-headers", label: "USB headers" },
  { page: 13, kind: "rear-io", label: "Rear ports" },
  { page: 15, kind: "installation", label: "Installing the CPU" },
  { page: 18, kind: "installation", label: "Installing the CPU Fan and Heatsink" },
  { page: 19, kind: "memory-slots", label: "Memory slot order" },
  { page: 23, kind: "front-panel", label: "Front panel header" },
  { page: 24, kind: "usb-headers", label: "USB headers" },
  { page: 26, kind: "power-connectors", label: "Power connectors" },
  { page: 28, kind: "rgb-headers", label: "RGB headers" },
];

describe("manual sections", () => {
  it("lists each section once, with every page it's on", () => {
    const jumps = manualJumps(asrock);
    expect(jumps.map((j) => `${j.label} ${jumpPages(j)}`)).toEqual([
      "Specifications p. 7", "Rear ports p. 8, 13", "Board layout p. 12", "Fan headers p. 12", "RGB headers p. 12, 28",
      "USB headers p. 12, 24", "Installing the CPU p. 15", "Installing the CPU Fan and Heatsink p. 18",
      "Memory slot order p. 19", "Front panel header p. 23", "Power connectors p. 26",
    ]);
  });

  it("puts the sections most people need first, or the ones the part needs", () => {
    const jumps = manualJumps(asrock);
    expect(keyJumps(jumps).map((j) => j.label)).toEqual(["Board layout", "Front panel header", "Fan headers", "Memory slot order"]);
    expect(keyJumps(jumps, ["power-connectors"]).map((j) => j.label)[0]).toBe("Power connectors");
  });

  it("groups every section by what it's for", () => {
    expect(groupedJumps(manualJumps(asrock)).map(([g, list]) => [g, list.map((j) => j.label)])).toEqual([
      ["Plugging things in", ["Front panel header", "Fan headers", "Power connectors", "USB headers", "RGB headers"]],
      ["Fitting parts", ["Memory slot order", "Installing the CPU", "Installing the CPU Fan and Heatsink"]],
      ["About the board", ["Board layout", "Rear ports", "Specifications"]],
    ]);
  });
});
