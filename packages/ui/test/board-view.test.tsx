// The motherboard on My PC: a close-up board you can move around and point at, and a Slots tab that says
// what's plugged in where, from what Windows reports.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import type { BoardHover } from "../src/boardScene";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

// The board view's calls, and its pointer, without WebGL.
const board = vi.hoisted(() => ({ calls: [] as [string, unknown][], point: null as ((h: BoardHover | null) => void) | null }));
vi.mock("../src/boardScene", async (real) => ({
  ...(await real<typeof import("../src/boardScene")>()),
  createBoardScene: (_el: HTMLElement, _shape: unknown, opts: { onHover?: (h: BoardHover | null) => void }) => {
    board.point = opts.onHover ?? null;
    const rec = (name: string) => (arg?: unknown) => { board.calls.push([name, arg]); };
    return {
      highlight: rec("highlight"), hover: rec("hover"), reset: rec("reset"), setUsage: rec("setUsage"), dispose: rec("dispose"), stats: () => ({ frames: 0 }),
      setCables: rec("setCables"), hoverCable: rec("hoverCable"), focusCable: rec("focusCable"),
    };
  },
}));

const { RigApp } = await import("../src/App");
const { pinGroups } = await import("../src/boardScene");
const { resolveBuild } = await import("@rig/core");

beforeEach(() => {
  location.hash = "";
  localStorage.clear();
  board.calls = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width: 1101px"), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openBoard() {
  location.hash = "pc";
  render(<RigApp client={new DemoClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Motherboard/ }));
  await screen.findByRole("tab", { name: "Slots" });
}
const group = (title: string) => screen.getByRole("heading", { name: title }).closest("li")!;

describe("The motherboard on My PC", () => {
  it("has no Heat toggle on My PC", async () => {
    location.hash = "pc";
    render(<RigApp client={new DemoClient()} />);
    await screen.findByRole("button", { name: /^Motherboard/ });
    expect(screen.queryByRole("button", { name: "Heat" })).toBeNull();
  });

  it("opens on the Slots tab, with each memory stick in its slot", async () => {
    await openBoard();
    expect(screen.getByRole("tab", { name: "Slots" }).getAttribute("aria-selected")).toBe("true");
    const memory = group("Memory");
    expect(within(memory).getByText("2 of 4 in use")).toBeTruthy();
    expect(within(memory).getByRole("button", { name: /^Memory slot A2 \(A2\): in use, 16 GB Corsair/ })).toBeTruthy();
    expect(within(memory).getByRole("button", { name: /^Memory slot A1 \(A1\): free/ })).toBeTruthy();
  });

  it("counts the M.2 drives without saying which slot, and says it can't see the front panel", async () => {
    await openBoard();
    expect(within(group("M.2 drives")).getByText("1 of 3 in use")).toBeTruthy();
    expect(within(group("M.2 drives")).getByRole("button", { name: /^M\.2 slot \(processor, fastest\) \(M2_1\): Rig can't tell which/ })).toBeTruthy();
    expect(within(group("Front panel, USB, audio and lighting")).getByText("Can't see")).toBeTruthy();
  });

  it("lights a row's slots on the board while it's pointed at, and zooms in on a click", async () => {
    await openBoard();
    const memory = group("Memory");
    fireEvent.pointerEnter(memory);
    expect(board.calls.at(-1)).toEqual(["hover", ["dimm-0", "dimm-1", "dimm-2", "dimm-3"]]);
    fireEvent.click(within(memory).getByRole("button", { name: /^Memory slot B2/ }));
    expect(board.calls.at(-1)).toEqual(["highlight", { id: "dimm-3" }]);
  });

  it("says what's in a slot when the board is pointed at, and lights its row", async () => {
    await openBoard();
    act(() => board.point!({ id: "dimm-1", x: 100, y: 100 }));
    const tip = document.querySelector(".board-tip")!;
    expect(tip.textContent).toContain("Memory slot A2");
    expect(tip.textContent).toContain("16 GB Corsair, 6000 MT/s");
    expect(group("Memory").classList.contains("is-lit")).toBe(true);
    act(() => board.point!(null));
    expect(document.querySelector(".board-tip")).toBeNull();
  });

  it("names the pin under the pointer on a header", async () => {
    await openBoard();
    const fp = resolveBuild({ board: { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" } }).board.items.find((i) => i.id === "fp")!;
    const reset = pinGroups(fp).find((g) => g.name === "Reset")!.pins[0].index;
    act(() => board.point!({ id: "fp", pin: reset, x: 100, y: 100 }));
    expect(document.querySelector(".board-tip-pin")?.textContent).toMatch(/^Pin \d+: Reset/);
  });

  it("marks the slots in use and the free ones on the board, and leaves unmarked what Rig can't place", async () => {
    await openBoard();
    const marks = board.calls.filter(([n]) => n === "setUsage").at(-1)?.[1] as Record<string, string>;
    expect(marks).toMatchObject({ "dimm-0": "free", "dimm-1": "used", "dimm-2": "free", "dimm-3": "used", pcie1: "used" });
    expect(marks["m2-1"]).toBeUndefined();
    expect(marks.fp).toBeUndefined();
    expect(document.querySelector(".board-key")?.textContent).toBe("In useFree");
  });

  it("puts Reset view back to the whole board", async () => {
    await openBoard();
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(board.calls.at(-1)?.[0]).toBe("reset");
  });

  it("has a Cables tab with each power cable in the order to plug them in, drawn on the board", async () => {
    await openBoard();
    fireEvent.click(screen.getByRole("tab", { name: "Cables" }));
    const rows = within(screen.getByRole("list", { name: "Power cables" })).getAllByRole("button");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "1. Processor power (CPU_PWR1): 8-pin CPU cable from the supply's CPU port. Show on the board",
      "2. Second processor power (CPU_PWR2): 4-pin CPU cable from the supply's CPU port. Show on the board",
      "3. Board power (ATX_PWR1): 24-pin cable from the supply's MB or ATX port. Show on the board",
      "4. Graphics card power: 16-pin cable from the supply's PCIe or VGA port. Show on the board",
    ]);
    expect(within(rows[1]).getByText("Optional")).toBeTruthy();
    expect(within(rows[3]).getByText("Usual spot")).toBeTruthy();
    expect(screen.getByText(/wired differently/)).toBeTruthy();
    const drawn = board.calls.filter(([n]) => n === "setCables").at(-1)?.[1] as { id: string; to: string | null; card?: unknown }[];
    expect(drawn.map((c) => [c.id, c.to])).toEqual([["eps", "eps"], ["eps2", "eps2"], ["atx24", "atx24"], ["gpu", null]]);
    // The card the demo's owner picked, MSI's Ventus 2X, at its own size.
    expect(drawn[3].card).toMatchObject({ length: 242, height: 125, thick: 43 });
  });

  it("lights a cable on the board while its row is pointed at, zooms to its plug on a click, and takes the cables off on leaving the tab", async () => {
    await openBoard();
    fireEvent.click(screen.getByRole("tab", { name: "Cables" }));
    const gpu = screen.getByRole("button", { name: /^4\. Graphics card power/ });
    fireEvent.pointerEnter(gpu);
    expect(board.calls.at(-1)).toEqual(["hoverCable", "gpu"]);
    fireEvent.click(gpu);
    expect(board.calls.at(-1)).toEqual(["focusCable", "gpu"]);
    fireEvent.click(screen.getByRole("tab", { name: "Slots" }));
    expect(board.calls.filter(([n]) => n === "setCables").at(-1)).toEqual(["setCables", null]);
  });
});
