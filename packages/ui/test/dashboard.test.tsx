// Customizing Home on the page: widgets moved and resized from the keyboard and by pointer, hidden and added back,
// undone, restyled, reset, and kept. The layout model on its own is tested in layout.test.ts.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import { LAYOUT_VERSION, type Cell } from "../src/pages/overview/layout";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const KEY = "rig.dashboard.v1:demo";
const at = (cells: Cell[], i: string) => cells.find((c) => c.i === i)!;
const gaps = (cells: Cell[], cols = 12) => { let n = 0; for (let x = 0; x < cols; x++) { const col = cells.filter((c) => c.x <= x && x < c.x + c.w); n += Math.max(0, ...col.map((c) => c.y + c.h)) - col.reduce((s, c) => s + c.h, 0); } return n; };
const overlapping = (cells: Cell[]) => cells.some((a) => cells.some((b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
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
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, 6 columns by 5 rows, place 4 of 8");
    expect(said()).toBe("Fans is now 6 columns by 5 rows.");
    expect(stored().layouts.lg).toContainEqual({ i: "fans", x: 0, y: 8, w: 6, h: 5 });
    fireEvent.keyDown(tile("Fans"), { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Customize Home" })).toBeNull();
    expect(screen.queryByRole("group", { name: /^Fans, / })).toBeNull();
  });

  it("gives a chart its compact content once its tile is too short for the full one", async () => {
    await customize();
    expect(await screen.findByText("Idle processor")).toBeTruthy();
    fireEvent.keyDown(tile("Temperatures"), { key: "ArrowUp", shiftKey: true });
    expect(said()).toBe("Temperatures is now 7 columns by 4 rows.");
    expect(screen.queryByText("Idle processor")).toBeNull();
  });

  it("hides a widget from its corner, closes the gap, and adds it back from the library", async () => {
    await customize();
    fireEvent.click(screen.getByRole("button", { name: "Hide Fans" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Fans" })).toBeNull());
    expect(said()).toBe("Fans hidden. Add it back from Add widget.");
    expect(gaps(stored().layouts.lg)).toBe(0);
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/place 5 of 7$/);
    fireEvent.click(screen.getByRole("button", { name: /^Add widget/ }));
    const library = within(screen.getByRole("dialog", { name: "Add widget" }));
    fireEvent.click(library.getByRole("button", { name: /^Fans/ }));
    expect(await screen.findByRole("heading", { name: "Fans" })).toBeTruthy();
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, Medium, place 8 of 8");
  });

  it("hides the focused widget with Delete and moves focus to the one that takes its place, or the last one", async () => {
    await customize();
    tile("Fans").focus();
    fireEvent.keyDown(tile("Fans"), { key: "Delete" });
    await waitFor(() => expect(screen.queryByRole("group", { name: /^Fans, / })).toBeNull());
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/place 5 of 7$/);
    const last = screen.getAllByRole("group").find((g) => /place 7 of 7$/.test(g.getAttribute("aria-label")!))!;
    last.focus();
    fireEvent.keyDown(last, { key: "Backspace" });
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/place 6 of 6$/));
  });

  it("resizes Health taller and shorter from its bottom edge, the tile and its landing spot agreeing and the tiles below moving out of the way", async () => {
    await customize();
    const box = (el: Element) => {
      const s = (el as HTMLElement).style, held = "hold" in (el as HTMLElement).dataset;
      const [x, y] = ((held ? s.getPropertyValue("--hold-t") : s.transform).match(/[-\d.]+/g) ?? []).map(Number);
      return { x, y, w: parseFloat(held ? s.getPropertyValue("--hold-w") : s.width), h: parseFloat(held ? s.getPropertyValue("--hold-h") : s.height) };
    };
    const health = () => document.querySelector('.dg[data-id="health"]')!;
    const handle = health().querySelector(".dw-rh-s")!;
    const tiles = () => [...document.querySelectorAll(".dash-grid > .dg")].map((el) => ({ i: (el as HTMLElement).dataset.id!, ...box(el) }));
    const apart = () => tiles().every((a) => tiles().every((b) => a.i === b.i || a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y));
    fireEvent.mouseDown(handle, { button: 0, clientX: 1000, clientY: 200 });
    for (const y of [260, 330, 420, 500, 420, 330, 230]) {
      fireEvent.mouseMove(document, { clientX: 1000, clientY: y });
      const held = box(health()), spot = box(document.querySelector(".dash-spot")!);
      expect(health().classList.contains("resizing")).toBe(true);
      expect([held.x, held.y, held.w, held.h]).toEqual([spot.x, spot.y, spot.w, spot.h]);
      expect(apart()).toBe(true);
    }
    fireEvent.mouseMove(document, { clientX: 1000, clientY: 330 });
    fireEvent.mouseUp(document, { clientX: 1000, clientY: 330 });
    expect(said()).toMatch(/^Health is now /);
    const saved: Cell[] = stored().layouts.lg;
    expect(at(saved, "health").h).toBeGreaterThan(2);
    expect(overlapping(saved)).toBe(false);
    expect(gaps(saved)).toBe(0);
    expect(apart()).toBe(true);
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

  it("changes what a widget shows when its style and tone change, leaving size to dragging", async () => {
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
    for (const name of ["Small", "Move earlier", "Move later", "Reset this widget", "Hide widget"]) expect(panel.queryByRole("button", { name })).toBeNull();
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
