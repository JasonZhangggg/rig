// Finding your way: the sidebar names pages the way the pages name themselves, and search finds any page by everyday words.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { getStage } = await import("../src/components/Stage");

describe("navigation", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("groups the pages by what you came to do, and keeps Settings in the account menu", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    const nav = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}`) });
    for (const name of ["Home", "My PC", "Ask", "Logs", "Changes"]) expect(nav(name)).toBeTruthy();
    // Folded into other pages: upgrades and manuals on My PC, performance and games in Logs.
    for (const name of ["Performance", "Games", "Upgrades", "Manuals"]) expect(screen.queryByRole("link", { name: new RegExp(`^${name}`) })).toBeNull();
    expect(screen.getByText("Fix problems")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Overview/ })).toBeNull();
    // Settings shows up only once you open your account.
    expect(screen.queryByRole("link", { name: /^Settings/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Settings/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Account, You/ }));
    const settings = screen.getByRole("menuitem", { name: /^Settings/ });
    expect(settings.getAttribute("href")).toBe("#settings");
    fireEvent.click(settings);
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    // On Settings, the account is marked as where you are, in the sidebar and in its menu.
    const account = screen.getByRole("button", { name: /^Account, You/ });
    expect(account.getAttribute("aria-current")).toBe("page");
    fireEvent.click(account);
    expect(screen.getByRole("menuitem", { name: /^Settings/ }).getAttribute("aria-current")).toBe("page");
  });

  it("opens Settings from the account menu on a phone, and Back then leaves Settings", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 760px"), media: q, addEventListener() {}, removeEventListener() {} }));
    try {
      render(<RigApp client={new DemoClient()} />);
      await screen.findByText(/Things to look at/i);
      const before = history.length;
      fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
      const menu = within(await screen.findByRole("dialog", { name: "Main" }));
      fireEvent.click(menu.getByRole("button", { name: /^Account, You/ }));
      fireEvent.click(menu.getByRole("menuitem", { name: /^Settings/ }));
      await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
      expect(location.hash).toBe("#settings");
      expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Main" })).toBeNull();
      // The page took the open menu's place in history, so Back goes to the page before, not the menu.
      expect(history.length).toBe(before + 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("finds a page from everyday words and opens it", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.click(screen.getByRole("button", { name: /Search or ask/ }));
    const palette = within(screen.getByRole("dialog", { name: "Search" }));
    fireEvent.change(palette.getByRole("textbox", { name: "Search" }), { target: { value: "temps" } });
    fireEvent.click(palette.getByRole("button", { name: /^Logs Every sensor/ }));
    expect(location.hash).toBe("#logs");
    expect(await screen.findByRole("heading", { name: "Logs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Readings" }).getAttribute("aria-current")).toBe("page");
    // The sidebar marks Logs, the page the view belongs to.
    expect(screen.getByRole("link", { name: /^Logs/ }).getAttribute("aria-current")).toBe("page");
  });

  it("opens a part's own page when it's picked in Home's 3D view", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    act(() => getStage().scene.select("gpu"));
    expect(await screen.findByRole("heading", { level: 1, name: "NVIDIA GeForce RTX 4070 SUPER" })).toBeTruthy();
    expect(location.hash).toBe("#pc");
    // The part is shown alone, so there's nothing to pull apart.
    const tools = within(screen.getByRole("toolbar", { name: "View" }));
    expect(tools.queryByRole("button", { name: "Exploded view" })).toBeNull();
    expect(tools.getByRole("button", { name: "Reset view" })).toBeTruthy();
  });

    it("opens Upgrades and Manuals as tabs of My PC, each at its own address", async () => {
    location.hash = "#upgrades";
    render(<RigApp client={new DemoClient()} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Atlas" })).toBeTruthy();
    expect(location.hash).toBe("#upgrades");
    const tabs = within(screen.getByRole("navigation", { name: "My PC" }));
    expect(tabs.getByRole("link", { name: "Upgrades" }).getAttribute("aria-current")).toBe("page");
    expect(tabs.getByRole("link", { name: "Manuals" }).getAttribute("href")).toBe("#manuals");
  });
});
