// The Home dashboard: a saved layout read defensively and carried over from the first version, a grid that never
// keeps a gap, widgets moved and resized from the keyboard, hidden and added back, undone, restyled, reset, and kept.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import { KIND_ORDER, LAYOUT_VERSION, cellsFor, compactUp, defaultDashboard, dragFlow, holes, orderOf, parseDashboard, resizeFlow, type Cell } from "../src/pages/overview/layout";

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
    expect(orderOf(lg)).toEqual(["pc", "health", "todo", "temps", "fans", "evenings", "asks", "storage"]);
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
    expect(at(lg, "fans")).toMatchObject({ x: 7, y: 0, w: 5 });
    expect(at(lg, "pc")).toMatchObject({ x: 0, y: 0, h: 5 });
    expect(at(lg, "pc").w).toBeGreaterThanOrEqual(5);
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
    expect(at(lg, "pc")).toMatchObject({ w: 6, h: 6 });
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

  it("lets the neighbour fill the row when a tile is made narrower, and give the room back when it widens", () => {
    const smaller = resizeFlow(base, "temps", 5, 5, 12);
    expect(at(smaller, "temps").w).toBe(5);
    expect(at(smaller, "fans")).toMatchObject({ x: 5, w: 7 });
    expect(holes(smaller, 12)).toBe(0);
    expect(resizeFlow(base, "temps", 7, 5, 12)).toEqual(base);
  });

  it("keeps the PC from getting small", () => {
    const out = resizeFlow(base, "pc", 2, 2, 12);
    expect(at(out, "pc")).toMatchObject({ w: 5, h: 5 });
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
