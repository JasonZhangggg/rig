import { describe, expect, it } from "vitest";
import { boardForm, boardKey, layoutFromReading, readingProblem, type LayoutReading } from "../src/boardLayout";
import { resolveBuild } from "../src/build";
import msi from "./fixtures/layout-msi-pro-b650-a.json";
import asrock from "./fixtures/layout-asrock-b650m-pro-rs.json";

// Two real readings of manual drawings (MSI PRO B650-A WIFI page 27, ASRock
// B650M Pro RS WiFi page 10), checked against positions traced by hand.
const msiLayout = { maker: "Micro-Star International Co., Ltd.", model: "PRO B650-A WIFI (MS-7D78)", page: 27, reading: msi as LayoutReading };
const asrockLayout = { maker: "ASRock", model: "B650M Pro RS WiFi", page: 10, reading: asrock as LayoutReading };
const centre = (i?: { u: number; v: number; w: number; h: number }) => i && [i.u + i.w / 2, i.v + i.h / 2];
const near = (got: number[] | undefined, want: number[], mm: number) => {
  expect(got).toBeDefined();
  expect(Math.hypot(got![0] - want[0], got![1] - want[1])).toBeLessThan(mm);
};

describe("a board layout read from its manual", () => {
  it("puts each header where the drawing has it, to within a few millimetres", () => {
    const b = layoutFromReading(msiLayout);
    expect(b).toMatchObject({ model: "MSI PRO B650-A WIFI (MS-7D78)", form: "atx", w: 244, h: 305 });
    const at = (name: string) => centre(b.items.find((i) => i.name === name));
    near(at("JFP1"), [234.5, 299.4], 3);
    near(at("CPU_FAN1"), [172.3, 20.3], 3);
    near(at("ATX_PWR1"), [236.9, 100.5], 3);

    const m = layoutFromReading(asrockLayout);
    expect(m).toMatchObject({ form: "matx", w: 244, h: 244 });
    near(centre(m.items.find((i) => i.name === "PANEL1")), [231.3, 236.5], 3);
    near(centre(m.items.find((i) => i.name === "A1")), [186.8, 77.7], 3);
  });

  it("names things plainly and gives headers their pins, along the header", () => {
    const b = layoutFromReading(msiLayout);
    const fp = b.items.find((i) => i.name === "JFP1")!;
    expect(fp).toMatchObject({ kind: "front-panel", label: "Front panel header", pins: { cols: 5, rows: 2 } });
    const atx = b.items.find((i) => i.name === "ATX_PWR1")!;
    expect(atx.label).toBe("24-pin power");
    expect(atx.h > atx.w ? atx.pins : undefined).toMatchObject({ cols: 2, rows: 12 });
    expect(b.items.filter((i) => i.kind === "dimm").map((i) => i.name)).toEqual(["A1", "A2", "B1", "B2"]);
    expect(b.items.find((i) => i.kind === "socket")?.label).toBe("Processor socket");
    expect(b.items.some((i) => i.kind === "io")).toBe(true);
    expect(new Set(b.items.map((i) => i.id)).size).toBe(b.items.length);
  });

  it("is what the 3D view draws for that board, with the sticks in the slots Windows names", () => {
    const board = layoutFromReading(msiLayout);
    const b = resolveBuild({ board: { manufacturer: "MSI", product: "PRO B650-A WIFI (MS-7D78)" }, boardLayout: board, memory: { modules: [{ slot: "DIMM_A2" }, { slot: "DIMM_B2" }] } });
    expect(b.board).toMatchObject({ source: "detected", layoutFrom: expect.stringMatching(/page 27 of the manual/) });
    expect(b.memory.slots).toEqual(["A2", "B2"]);
  });

  it("keeps one record per board model, however Windows writes it", () => {
    expect(boardKey("Micro-Star International Co., Ltd.", "PRO B650-A WIFI (MS-7D78)")).toBe(boardKey("MSI", "pro b650-a wifi"));
    expect(boardKey("ASUSTeK COMPUTER INC.", "TUF GAMING B650M-PLUS WIFI")).not.toBe(boardKey("ASUS", "TUF GAMING B650M-PLUS"));
  });

  it("refuses a reading that isn't a whole board, and sizes a square board by its name", () => {
    expect(readingProblem(msi)).toBeNull();
    expect(readingProblem({ board: [0, 0, 0, 0], items: [] })).toMatch(/outline/);
    expect(readingProblem({ ...msi, items: (msi.items as unknown[]).filter((i) => (i as string[])[1] !== "socket") })).toMatch(/socket/);
    expect(readingProblem({ board: [0, 0, 300, 900], items: msi.items })).toMatch(/shape/);
    expect(boardForm({ board: [0, 0, 400, 400] }, "B650I AORUS ULTRA")).toBe("itx");
    expect(boardForm({ board: [0, 0, 400, 400] }, "B650M AORUS ELITE AX")).toBe("matx");
    expect(boardForm({ board: [0, 0, 400, 400] }, "ROG STRIX B650-I GAMING")).toBe("itx");
    expect(boardForm({ board: [0, 0, 400, 400], form: "Mini-ITX" })).toBe("itx");
  });
});
