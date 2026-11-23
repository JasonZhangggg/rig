import { describe, expect, it } from "vitest";
import { cableGuide, gpuPlug, layoutFromReading, resolveBuild } from "../src";

const tomahawk = resolveBuild({ board: { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" } }).board;
const typical = resolveBuild({}).board;

describe("the cable guide", () => {
  it("plugs the processor power in first, then the board, then the graphics card", () => {
    const g = cableGuide(tomahawk, "NVIDIA GeForce RTX 4070 SUPER");
    expect(g.cables.map((c) => [c.step, c.title, c.plug, c.code])).toEqual([
      [1, "Processor power", "8-pin CPU", "CPU_PWR1"],
      [2, "Second processor power", "4-pin CPU", "CPU_PWR2"],
      [3, "Board power", "24-pin", "ATX_PWR1"],
      [4, "Graphics card power", "16-pin or 8-pin", undefined],
    ]);
    expect(g.cables[0].how).toMatch(/^First, while there's room/);
    expect(g.cables[1].optional).toBe(true);
    expect(g.cables.map((c) => c.port)).toEqual(["CPU", "CPU", "MB or ATX", "PCIe or VGA"]);
  });

  it("knows where a known board's plugs are, but never the card's", () => {
    const g = cableGuide(tomahawk, "NVIDIA GeForce RTX 4090");
    expect(g.cables.filter((c) => c.known).map((c) => c.id)).toEqual(["eps", "eps2", "atx24"]);
    expect(g.from).toMatch(/where your board has them/);
  });

  it("says every plug is where most boards have it on a board Rig doesn't know", () => {
    const g = cableGuide(typical, "NVIDIA GeForce RTX 4090");
    expect(g.cables.every((c) => !c.known)).toBe(true);
    expect(g.cables.map((c) => c.id)).toEqual(["eps", "atx24", "gpu"]);
    expect(g.from).toMatch(/where most boards and cards have it/);
  });

  it("has no card cable with only the processor's own graphics", () => {
    expect(cableGuide(tomahawk, null).cables.map((c) => c.id)).toEqual(["eps", "eps2", "atx24"]);
  });

  it("finds the plugs on a layout read from a manual", () => {
    const read = layoutFromReading({
      maker: "MSI", model: "PRO B650-A WIFI", page: 27,
      reading: {
        board: [0, 0, 244, 305],
        items: [
          ["CPU", "socket", 90, 50, 130, 90], ["DIMMA1", "dimm", 160, 14, 166, 147], ["ATX_PWR1", "atx24", 234, 92, 242, 144],
          ["CPU_PWR1", "eps", 26, 1, 45, 10], ["CPU_PWR2", "eps", 48, 1, 58, 10], ["PCI_E1", "pcie", 42, 158, 131, 165],
          ["JFP1", "fp", 214, 294, 227, 299], ["SYS_FAN1", "fan", 2, 162, 5, 172],
        ],
      },
    });
    const g = cableGuide({ ...read, source: "detected" }, "AMD Radeon RX 7800 XT");
    expect(g.cables.map((c) => [c.title, c.code, c.known])).toEqual([
      ["Processor power", "CPU_PWR1", true], ["Second processor power", "CPU_PWR2", true], ["Board power", "ATX_PWR1", true], ["Graphics card power", undefined, false],
    ]);
  });

  it("warns that CPU and card cables aren't the same, and to keep a modular supply's own cables", () => {
    const notes = cableGuide(tomahawk).notes.join(" ");
    expect(notes).toMatch(/wired differently/);
    expect(notes).toMatch(/only the cables that came with it/);
  });
});

describe("the graphics card's plug", () => {
  it("is what most cards of the chip take, never surer than that", () => {
    expect(gpuPlug("NVIDIA GeForce RTX 4090")).toMatchObject({ plug: "16-pin", words: "Most RTX 4090 cards take one 16-pin plug (12V-2x6)." });
    expect(gpuPlug("NVIDIA GeForce RTX 5080").plug).toBe("16-pin");
    expect(gpuPlug("NVIDIA GeForce RTX 4070 Ti SUPER").plug).toBe("16-pin");
    expect(gpuPlug("NVIDIA GeForce RTX 4070 SUPER").plug).toBe("16-pin or 8-pin");
    expect(gpuPlug("NVIDIA GeForce RTX 4060").words).toBe("Most RTX 4060 cards take one 8-pin PCIe plug.");
    expect(gpuPlug("NVIDIA GeForce RTX 3080").words).toBe("Most RTX 3080 cards take two or three 8-pin PCIe plugs.");
    expect(gpuPlug("AMD Radeon RX 7900 XTX").words).toBe("Most RX 7900 XTX cards take two or three 8-pin PCIe plugs.");
    expect(gpuPlug("Intel(R) Arc(TM) A770 Graphics").plug).toBe("8-pin PCIe");
  });

  it("says to look at the card when Rig can't tell the chip", () => {
    expect(gpuPlug("Graphics card")).toMatchObject({ plug: "16-pin or 8-pin", words: expect.stringMatching(/Look at the card's top edge/) });
  });
});
