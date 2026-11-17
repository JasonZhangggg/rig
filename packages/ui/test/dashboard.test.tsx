// The Home dashboard: a saved layout read defensively, widgets moved and resized from the keyboard,
// hidden and added back, restyled, reset, and kept across visits.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import { KIND_ORDER, LAYOUT_VERSION, defaultDashboard, fitSize, holes, parseDashboard, place, type Widget } from "../src/pages/overview/layout";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const KEY = "rig.dashboard.v1:demo";

describe("the saved layout", () => {
  it("falls back to the default dashboard when nothing usable is stored", () => {
    const fallback = defaultDashboard();
    expect(parseDashboard(null)).toEqual(fallback);
    expect(parseDashboard("not json")).toEqual(fallback);
    expect(parseDashboard(JSON.stringify({ v: LAYOUT_VERSION + 1, widgets: [] }))).toEqual(fallback);
  });

  it("drops unknown widgets, appends ones added since, and replaces bad values with defaults", () => {
    const stored = {
      v: LAYOUT_VERSION, density: "huge", spacing: "tight",
      widgets: [
        { kind: "fans", size: "gigantic", tone: "dark", style: "rings", opts: { span: "7", live: "yes", off: ["Fan 2", 3] } },
        { kind: "weather", size: "m" },
        { kind: "pc", size: "s", tone: "purple", style: "chips" },
        { kind: "fans", size: "l" },
      ],
    };
    const d = parseDashboard(JSON.stringify(stored));
    expect(d.widgets.map((w) => w.kind)).toEqual(["fans", "pc", ...KIND_ORDER.filter((k) => k !== "fans" && k !== "pc")]);
    const [fans, pc] = d.widgets;
    expect(fans).toMatchObject({ size: "m", tone: "dark", style: "rings", opts: { span: "7", live: true, off: ["Fan 2"] } });
    expect(pc).toMatchObject({ size: "l", tone: "light", style: "chips" });
    expect(d.density).toBe("comfortable");
    expect(d.spacing).toBe("tight");
  });

  it("packs the default dashboard with no holes on a wide screen", () => {
    const shown = defaultDashboard().widgets.filter((w) => !w.hidden);
    expect(holes(place(shown, 12).values(), 12)).toBe(0);
    expect(holes(place(shown, 8).values(), 8)).toBe(0);
  });

  it("picks the size that fills a row when a widget lands beside others", () => {
    const w = (kind: Widget["kind"], size: Widget["size"]): Widget => ({ ...defaultDashboard().widgets.find((x) => x.kind === kind)!, size });
    // Temperatures at Large (7 wide) beside Fans at Large (7 wide) can't share a row; at Medium (5) it fills it.
    expect(fitSize([w("temps", "l"), w("fans", "l")], "temps", 12)).toBe("m");
    expect(fitSize([w("temps", "l"), w("fans", "m")], "temps", 12)).toBe("l");
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

  it("moves a widget with the arrow keys and resizes it with shift, saying what changed", async () => {
    await customize();
    const fans = tile("Fans");
    expect(fans.getAttribute("aria-label")).toBe("Fans, Medium, place 5 of 8");
    fireEvent.keyDown(fans, { key: "ArrowLeft" });
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, Medium, place 4 of 8");
    expect(said()).toBe("Fans moved to place 4 of 8.");
    fireEvent.keyDown(tile("Fans"), { key: "ArrowRight", shiftKey: true });
    expect(tile("Fans").getAttribute("aria-label")).toMatch(/^Fans, Large, /);
    expect(said()).toMatch(/^Fans is now Large\./);
    fireEvent.keyDown(tile("Fans"), { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Customize Home" })).toBeNull();
    expect(screen.queryByRole("group", { name: /^Fans, / })).toBeNull();
  });

  it("hides a widget and adds it back from the library", async () => {
    await customize();
    options("Fans").getByRole("button", { name: "Hide widget" }).click();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Fans" })).toBeNull());
    expect(said()).toBe("Fans hidden. Add it back from Add widget.");
    fireEvent.click(screen.getByRole("button", { name: /^Add widget/ }));
    const library = within(screen.getByRole("dialog", { name: "Add widget" }));
    fireEvent.click(library.getByRole("button", { name: /^Fans/ }));
    expect(await screen.findByRole("heading", { name: "Fans" })).toBeTruthy();
    expect(tile("Fans").getAttribute("aria-label")).toBe("Fans, Medium, place 8 of 8");
  });

  it("changes what a widget shows when its style and tone change", async () => {
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
    expect(localStorage.getItem(KEY)).toBeTruthy();
    cleanup();
    render(<RigApp client={new DemoClient()} />);
    const fans = await screen.findByRole("heading", { name: "Fans" });
    const temps = screen.getByRole("heading", { name: "Temperatures" });
    expect(fans.compareDocumentPosition(temps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Health \d+ of 100$/ }).classList.contains("f-hnum")).toBe(true);
  });

  it("enters customizing from a widget's handle", async () => {
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Storage" }), { detail: 0 });
    expect(screen.getByRole("toolbar", { name: "Customize Home" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Customize Home" }).getAttribute("aria-pressed")).toBe("true");
  });
});
