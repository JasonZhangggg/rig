// The Home dashboard: a saved layout read defensively and carried over from the first version, a grid that never
// keeps a gap, widgets moved and resized from the keyboard, hidden and added back, undone, restyled, reset, and kept.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import { KINDS, KIND_ORDER, LAYOUT_VERSION, STEP, addCell, cellsFor, chosenOf, clampCell, compactUp, defaultDashboard, dragFlow, holes, limits, orderOf, parseDashboard, presetCells, resizeFlow, settle, stepTarget, stickyCell, type Cell, type Kind, type SizeName } from "../src/pages/overview/layout";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const KEY = "rig.dashboard.v1:demo";
const at = (cells: Cell[], i: string) => cells.find((c) => c.i === i)!;
// Empty cells with a tile somewhere below them; a ragged bottom edge doesn't count.
const gaps = (cells: Cell[], cols = 12) => { let n = 0; for (let x = 0; x < cols; x++) { const col = cells.filter((c) => c.x <= x && x < c.x + c.w); n += Math.max(0, ...col.map((c) => c.y + c.h)) - col.reduce((s, c) => s + c.h, 0); } return n; };
const overlapping = (cells: Cell[]) => cells.some((a) => cells.some((b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));

describe("the saved layout", () => {
  it("falls back to the default dashboard when nothing usable is stored", () => {
    const fallback = defaultDashboard();
    expect(parseDashboard(null)).toEqual(fallback);
    expect(parseDashboard("not json")).toEqual(fallback);
    expect(parseDashboard(JSON.stringify({ v: LAYOUT_VERSION + 1, widgets: [] }))).toEqual(fallback);
  });

  it("starts with the PC biggest at the top left, Health and Things to look at beside it, and no gaps", () => {
    const d = defaultDashboard();
    const lg = d.layouts.lg!;
    expect(orderOf(lg)).toEqual(["pc", "health", "todo", "temps", "fans", "evenings", "storage", "asks"]);
    expect(at(lg, "pc")).toEqual({ i: "pc", x: 0, y: 0, w: 8, h: 8 });
    expect(at(lg, "health")).toMatchObject({ x: 8, y: 0 });
    expect(holes(lg, 12)).toBe(0);
    expect(holes(cellsFor(d, "md"), 8)).toBe(0);
  });

  it("drops unknown widgets, appends ones added since, and keeps stored cells inside the grid and their limits", () => {
    const stored = {
      v: LAYOUT_VERSION, density: "huge", spacing: "tight",
      widgets: [
        { kind: "fans", tone: "dark", style: "rings", opts: { span: "7", live: "yes", off: ["Fan 2", 3] } },
        { kind: "weather" },
        { kind: "pc", tone: "purple", style: "chips" },
        { kind: "fans", style: "bars" },
      ],
      layouts: { lg: [
        { i: "fans", x: 20, y: 0, w: 5, h: 5 },
        { i: "pc", x: 0, y: 0, w: 2, h: 2 },
        { i: "weather", x: 0, y: 0, w: 4, h: 4 },
        { i: "health", x: 0, y: 1, w: "wide", h: 2 },
        { i: "todo", x: 0, y: 0, w: 99, h: 4 },
      ] },
    };
    const d = parseDashboard(JSON.stringify(stored));
    expect(d.widgets.map((w) => w.kind)).toEqual(["fans", "pc", ...KIND_ORDER.filter((k) => k !== "fans" && k !== "pc")]);
    const [fans, pc] = d.widgets;
    expect(fans).toMatchObject({ tone: "dark", style: "rings", opts: { span: "7", live: true, off: ["Fan 2"] } });
    expect(pc).toMatchObject({ tone: "light", style: "chips" });
    expect(d.density).toBe("comfortable");
    expect(d.spacing).toBe("tight");
    const lg = d.layouts.lg!;
    expect(lg.map((c) => c.i).sort()).toEqual(["asks", "evenings", "fans", "health", "pc", "storage", "temps", "todo"]);
    expect(at(lg, "pc")).toMatchObject({ x: 0, y: 0, h: 5 });
    expect(at(lg, "pc").w).toBeGreaterThanOrEqual(5);
    expect(at(lg, "fans")).toMatchObject({ x: at(lg, "pc").w, y: 0 });
    expect(chosenOf(at(lg, "fans"))).toEqual({ w: 5, h: 5 });
    expect(at(lg, "todo").w).toBe(12);
    expect(overlapping(lg)).toBe(false);
    expect(compactUp(lg, 12)).toEqual(lg);
  });

  it("lays out a first version layout in its order and at its sizes", () => {
    const v1 = { v: 1, widgets: [
      { id: "fans", kind: "fans", size: "l" }, { id: "pc", kind: "pc", size: "m" }, { id: "health", kind: "health", size: "m", hidden: true },
      { id: "todo", kind: "todo", size: "tall" }, { id: "temps", kind: "temps", size: "m" }, { id: "live", kind: "live", size: "wide", hidden: false },
    ] };
    const d = parseDashboard(JSON.stringify(v1));
    const lg = d.layouts.lg!;
    const order = orderOf(lg);
    expect(order[0]).toBe("fans");
    expect(order.indexOf("pc")).toBeLessThan(order.indexOf("temps"));
    expect(at(lg, "fans")).toMatchObject({ x: 0, y: 0, w: 7, h: 5 });
    expect(chosenOf(at(lg, "pc"))).toEqual({ w: 6, h: 6 });
    expect(lg.some((c) => c.i === "health")).toBe(false);
    expect(lg.some((c) => c.i === "live")).toBe(true);
    expect(d.v).toBe(LAYOUT_VERSION);
    expect(overlapping(lg)).toBe(false);
  });
});

describe("the grid while dragging", () => {
  const base = defaultDashboard().layouts.lg!;

  it("never overlaps tiles and always packs them upward, wherever a tile is dragged", () => {
    for (const c of base) {
      for (let x = 0; x <= 12 - c.w; x += 2) {
        for (let y = 0; y < 22; y += 3) {
          const out = dragFlow(base, c.i, x, y, 12);
          expect(overlapping(out)).toBe(false);
          expect(compactUp(out, 12)).toEqual(out);
          expect(out.map((o) => o.i).sort()).toEqual(base.map((o) => o.i).sort());
        }
      }
    }
  });

  it("takes Fans into the top row beside the PC without leaving a gap, and puts everything back when dragged home", () => {
    const up = dragFlow(base, "fans", 7, 0, 12);
    expect(at(up, "pc")).toEqual(at(base, "pc"));
    expect(at(up, "fans")).toMatchObject({ x: 8, y: 0 });
    expect(holes(up, 12)).toBe(0);
    const home = at(base, "fans");
    expect(dragFlow(base, "fans", home.x, home.y, 12)).toEqual(base);
  });

  it("keeps a big tile in place when a small one is dragged across its edge, and goes beside it instead", () => {
    for (const [x, y] of [[7, 3], [6, 2], [5, 2], [7, 6]]) {
      const out = dragFlow(base, "fans", x, y, 12);
      expect(at(out, "pc")).toEqual(at(base, "pc"));
      expect(holes(out, 12)).toBe(0);
    }
    expect(at(dragFlow(base, "fans", 6, 2, 12), "fans")).toMatchObject({ x: 8, y: 2 });
  });

  it("lets the neighbour fill the row when a tile is made narrower, and give the room back when it widens", () => {
    const smaller = resizeFlow(base, "temps", 5, 5, 12);
    expect(at(smaller, "temps").w).toBe(5);
    expect(at(smaller, "fans")).toMatchObject({ x: 5, w: 7 });
    expect(holes(smaller, 12)).toBe(0);
    expect(resizeFlow(base, "temps", 7, 5, 12)).toEqual(base);
  });

  it("moves a tile that fits into the room a narrower tile leaves, when no neighbour can take it", () => {
    const after = dragFlow(base, "fans", 7, 0, 12);
    const smaller = resizeFlow(after, "temps", 5, 4, 12);
    expect(at(smaller, "temps")).toMatchObject({ w: 5, h: 4 });
    expect(overlapping(smaller)).toBe(false);
    expect(gaps(smaller)).toBe(0);
  });

  it("keeps the PC from getting small", () => {
    const out = resizeFlow(base, "pc", 2, 2, 12);
    expect(at(out, "pc")).toMatchObject({ w: 5, h: 5 });
  });

  // The drag as the grid runs it: where the held tile is, in cells, becomes a cell, and the cell becomes a layout.
  const drag = (id: string, moves: [number, number][]) => {
    const me = at(base, id);
    let cell = { x: me.x, y: me.y };
    return moves.map(([fx, fy]) => {
      cell = stickyCell(cell, fx, fy, 12 - me.w);
      return { cell, landed: at(dragFlow(base, id, cell.x, cell.y, 12), id) };
    });
  };
  const shake = (x: number, y: number) => Array.from({ length: 40 }, (_, k): [number, number] => [x + Math.sin(k * 1.7) * 0.15, y + Math.cos(k * 2.3) * 0.15]);

  it("keeps the drop spot still while the pointer rests or shakes at any edge of the grid", () => {
    for (const c of base) {
      const edges: [number, number][] = [[-3, c.y], [-0.4, c.y + 0.5], [12, c.y], [12 - c.w + 0.5, c.y], [c.x, -4], [c.x + 0.5, 0.5], [0, 30], [12, 30]];
      for (const [x, y] of edges) {
        const to = drag(c.i, [[x, y], [x, y], [x, y]]).at(-1)!;
        const still = drag(c.i, [[x, y], [x, y], [x, y], ...shake(x, y)]);
        expect(new Set(still.slice(2).map((s) => JSON.stringify(s)))).toEqual(new Set([JSON.stringify(to)]));
      }
    }
  });

  it("keeps a dragged tile inside the grid however far past an edge the pointer goes", () => {
    const fans = at(base, "fans");
    expect(drag("fans", [[40, 2]]).at(-1)!.cell).toEqual({ x: 12 - fans.w, y: 2 });
    expect(drag("fans", [[-40, -40]]).at(-1)!.cell).toEqual({ x: 0, y: 0 });
    for (const [fx, fy] of [[40, 2], [-40, -40], [3, 60]] as [number, number][]) {
      const { landed } = drag("fans", [[fx, fy]]).at(-1)!;
      expect(landed.x).toBeGreaterThanOrEqual(0);
      expect(landed.x + landed.w).toBeLessThanOrEqual(12);
    }
  });

  it("moves the drop spot only once the tile is well into the next cell, and not back until it is well out again", () => {
    const cells = (moves: [number, number][]) => drag("health", moves).map((s) => s.cell.x);
    expect(cells([[8.4, 0], [8.65, 0], [8.35, 0]])).toEqual([8, 8, 8]);
    expect(cells([[7.6, 0], [7.25, 0], [7.4, 0], [7.65, 0], [7.75, 0]])).toEqual([8, 7, 7, 7, 8]);
    expect(drag("health", [[8, 0.6], [8, 0.75], [8, 0.4], [8, 0.25]]).map((s) => s.cell.y)).toEqual([0, 1, 1, 0]);
  });
});

describe("the grid after any change", () => {
  // A seeded random run of everything a person can do, so a failure always comes back the same way.
  const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const kinds = Object.keys(KINDS) as Kind[];
  // Open cells above the top of the lowest tile: inside the grid or down its sides. Below that it's the ragged end of the page.
  const open = (cells: Cell[], cols: number) => {
    const end = Math.max(0, ...cells.map((c) => c.y));
    let n = 0;
    for (let y = 0; y < end; y++) for (let x = 0; x < cols; x++) if (!cells.some((c) => c.x <= x && x < c.x + c.w && c.y <= y && y < c.y + c.h)) n++;
    return n;
  };
  const check = (next: Cell[], prev: Cell[], cols: number, touched: string | null, what: string) => {
    const where = `${what} at ${cols} columns: ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`;
    expect(overlapping(next), where).toBe(false);
    expect(open(next, cols), where).toBe(0);
    for (const c of next) {
      const lim = limits(c.i as Kind, cols), want = chosenOf(c);
      expect(c.x >= 0 && c.y >= 0 && c.x + c.w <= cols, where).toBe(true);
      expect(c.w >= lim.minW && c.w <= lim.maxW && c.h >= lim.minH && c.h <= lim.maxH, where).toBe(true);
      // Stretched to close a gap at most a step past the size the person chose, and that size stays theirs.
      expect(c.w <= want.w + STEP && c.h <= want.h + STEP, where).toBe(true);
      const was = prev.find((o) => o.i === c.i);
      if (was && c.i !== touched) expect(chosenOf(c), where).toEqual(chosenOf(was));
    }
  };

  for (const cols of [12, 8]) {
    it(`never leaves a gap, an overlap or a tile past its limits after thousands of moves, resizes, hides and adds at ${cols} columns`, () => {
      const r = seeded(cols);
      const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
      const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
      let ops = 0;
      for (let run = 0; run < 60; run++) {
        let cur = cellsFor(defaultDashboard(), cols === 12 ? "lg" : "md");
        for (let k = 0; k < 40; k++, ops++) {
          const shown = cur.map((c) => c.i), hidden = kinds.filter((x) => !shown.includes(x));
          const op = pick(["drag", "drag", "resize", "preset", "key", "keysize", ...(shown.length > 2 ? ["hide"] : []), ...(hidden.length ? ["add"] : [])]);
          const id = pick(shown), me = at(cur, id), lim = limits(id as Kind, cols);
          const bottom = Math.max(...cur.map((c) => c.y + c.h));
          let next = cur, touched: string | null = id;
          if (op === "drag") next = dragFlow(cur, id, int(0, cols - me.w), int(0, bottom), cols);
          else if (op === "resize") next = resizeFlow(cur, id, int(lim.minW, lim.maxW), int(lim.minH, lim.maxH), cols);
          else if (op === "preset") { const [w, h] = presetCells(id as Kind, pick(Object.keys(KINDS[id as Kind].sizes) as SizeName[]), cols); next = resizeFlow(cur, id, w, h, cols); }
          else if (op === "key") { const to = stepTarget(cur, id, pick(["left", "right", "up", "down"] as const), cols); if (to) next = dragFlow(cur, id, to.x, to.y, cols); }
          else if (op === "keysize") { const [dw, dh] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]); const want = clampCell({ ...me, w: me.w + dw, h: me.h + dh }, cols); next = resizeFlow(cur, id, want.w, want.h, cols); }
          else if (op === "hide") { next = settle(cur.filter((c) => c.i !== id), cols); touched = null; }
          else { touched = pick(hidden); next = addCell(cur, touched, cols); }
          check(next, cur, cols, touched, `${op} ${id}`);
          cur = next;
        }
      }
      expect(ops).toBe(2400);
    });
  }

  it("mends a damaged saved layout without a gap", () => {
    const r = seeded(7);
    for (let n = 0; n < 300; n++) {
      const lg = defaultDashboard().layouts.lg!.filter(() => r() > 0.15).map((c) => ({ ...c, x: c.x + Math.round((r() - 0.5) * 6), y: c.y + Math.round((r() - 0.5) * 8), w: c.w + Math.round((r() - 0.5) * 6), h: c.h + Math.round((r() - 0.5) * 4) }));
      const d = parseDashboard(JSON.stringify({ v: LAYOUT_VERSION, widgets: [], layouts: { lg } }));
      check(d.layouts.lg!, [], 12, null, "load");
    }
  });
});

describe("customizing Home", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  const customize = async () => {
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Customize Home" }));
    return screen.getByRole("toolbar", { name: "Customize Home" });
  };
  const tile = (name: string) => screen.getByRole("group", { name: new RegExp(`^${name}, `) });
  const said = () => document.querySelector("[aria-live]")!.textContent;
  const options = (name: string) => { fireEvent.click(screen.getByRole("button", { name: `${name} options` })); return within(screen.getByRole("dialog", { name: `${name} options` })); };
  const stored = () => JSON.parse(localStorage.getItem(KEY)!);

  it("moves a widget with the arrow keys and resizes it with shift, saying what changed", async () => {
    await customize();
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, Medium, place 5 of 8");
    fireEvent.keyDown(tile("Fans"), { key: "ArrowLeft" });
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, Medium, place 4 of 8");
    expect(said()).toBe("Fans moved to place 4 of 8.");
    fireEvent.keyDown(tile("Fans"), { key: "ArrowLeft" });
    expect(said()).toBe("Fans can't move further left.");
    fireEvent.keyDown(tile("Fans"), { key: "ArrowRight", shiftKey: true });
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, 6 by 5, place 4 of 8");
    expect(said()).toBe("Fans is now 6 by 5.");
    expect(stored().layouts.lg).toContainEqual({ i: "fans", x: 0, y: 8, w: 6, h: 5 });
    fireEvent.keyDown(tile("Fans"), { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Customize Home" })).toBeNull();
    expect(screen.queryByRole("group", { name: /^Fans, / })).toBeNull();
  });

  it("gives a chart its compact content once its tile is too short for the full one", async () => {
    await customize();
    expect(await screen.findByText("Idle processor")).toBeTruthy();
    fireEvent.keyDown(tile("Temperatures"), { key: "ArrowUp", shiftKey: true });
    expect(said()).toBe("Temperatures is now 7 by 4.");
    expect(screen.queryByText("Idle processor")).toBeNull();
  });

  it("hides a widget from its corner, closes the gap, and adds it back from the library", async () => {
    await customize();
    fireEvent.click(screen.getByRole("button", { name: "Hide Fans" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Fans" })).toBeNull());
    expect(said()).toBe("Fans hidden. Add it back from Add widget.");
    expect(gaps(stored().layouts.lg)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /^Add widget/ }));
    const library = within(screen.getByRole("dialog", { name: "Add widget" }));
    fireEvent.click(library.getByRole("button", { name: /^Fans/ }));
    expect(await screen.findByRole("heading", { name: "Fans" })).toBeTruthy();
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, Medium, place 8 of 8");
  });

  it("undoes the last change from the note, and with Ctrl Z", async () => {
    await customize();
    fireEvent.keyDown(tile("Fans"), { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Hide Storage" }));
    expect(screen.queryByRole("group", { name: /^Storage, / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(tile("Storage")).toBeTruthy();
    expect(said()).toBe("Undone.");
    expect(tile("Fans").getAttribute("aria-label")).toMatch(/place 4 of 8$/);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(tile("Fans").getAttribute("aria-label")).toMatch(/place 5 of 8$/);
  });

  it("changes what a widget shows when its style, size and tone change", async () => {
    await customize();
    const temps = () => screen.getByRole("heading", { name: "Temperatures" }).closest(".dw")!;
    await waitFor(() => expect(temps().querySelector(".pl-cap")).toBeTruthy());
    const panel = options("Temperatures");
    fireEvent.click(panel.getByRole("button", { name: "Range rows" }));
    await waitFor(() => expect(within(temps() as HTMLElement).getByRole("img").textContent).toMatch(/IdleGamingPeak/));
    expect(temps().querySelector(".pl-cap")).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Big numbers" }));
    expect(temps().querySelector(".pl-big")).toBeTruthy();
    expect(temps().classList.contains("tone-dark")).toBe(false);
    fireEvent.click(panel.getByRole("button", { name: "Dark" }));
    expect(temps().classList.contains("tone-dark")).toBe(true);
    expect(panel.getByRole("button", { name: "On the page" })).toHaveProperty("disabled", true);
    fireEvent.click(panel.getByRole("switch", { name: "Show the key" }));
    expect(within(temps() as HTMLElement).queryByText("Graphics card, peak")).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Small" }));
    expect(temps().getAttribute("data-size")).toBe("s");
    expect(tile("Temperatures").getAttribute("aria-label")).toMatch(/^Temperatures, Small, /);
    expect(panel.getByRole("button", { name: "Small" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("puts everything back after asking first", async () => {
    await customize();
    fireEvent.click(options("Temperatures").getByRole("button", { name: "Dark" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const confirm = within(screen.getByRole("dialog", { name: "Reset Home?" }));
    fireEvent.click(confirm.getByRole("button", { name: "Keep my layout" }));
    expect(screen.getByRole("heading", { name: "Temperatures" }).closest(".dw")!.classList.contains("tone-dark")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Reset Home?" })).getByRole("button", { name: "Reset Home" }));
    expect(screen.getByRole("heading", { name: "Temperatures" }).closest(".dw")!.classList.contains("tone-dark")).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the layout for the account across visits", async () => {
    await customize();
    fireEvent.keyDown(tile("Fans"), { key: "ArrowLeft" });
    fireEvent.click(options("Health").getByRole("button", { name: "Big number" }));
    expect(stored()).toMatchObject({ v: LAYOUT_VERSION });
    cleanup();
    await customize();
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, Medium, place 4 of 8");
    expect(screen.getByRole("img", { name: /^Health \d+ of 100$/ }).classList.contains("f-hnum")).toBe(true);
  });

  it("carries a first version layout over to the grid", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, widgets: [{ id: "storage", kind: "storage", size: "m" }, { id: "pc", kind: "pc", size: "l" }] }));
    await customize();
    expect(tile("Storage").getAttribute("aria-label")).toBe("Storage, Medium, place 1 of 8");
  });

  it("enters customizing from a widget's handle, or a long press on it, and leaves with Escape", async () => {
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Storage" }), { detail: 0 });
    expect(screen.getByRole("toolbar", { name: "Customize Home" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Customize Home" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Customize Home" })).toBeNull();
    const health = screen.getByRole("heading", { name: "Health" }).closest(".dw")!;
    fireEvent.pointerDown(health, { button: 0, clientX: 10, clientY: 10, pointerType: "touch" });
    await new Promise((r) => setTimeout(r, 520));
    expect(screen.getByRole("toolbar", { name: "Customize Home" })).toBeTruthy();
    fireEvent.pointerUp(window);
  });
});
