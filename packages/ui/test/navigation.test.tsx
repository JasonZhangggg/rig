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

  it("groups the pages by what you came to do, with Settings in reach", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    const nav = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}`) });
    for (const name of ["Home", "My PC", "Ask", "Logs", "Changes", "Settings"]) expect(nav(name)).toBeTruthy();
    // Folded into other pages: upgrades and manuals on My PC, performance and games in Logs.
    for (const name of ["Performance", "Games", "Upgrades", "Manuals"]) expect(screen.queryByRole("link", { name: new RegExp(`^${name}`) })).toBeNull();
    expect(screen.getByText("Fix problems")).toBeTruthy();
    expect(nav("Settings").getAttribute("href")).toBe("#settings");
    expect(screen.queryByRole("link", { name: /^Overview/ })).toBeNull();
  });

  it("finds a page from everyday words and opens it", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.click(screen.getByRole("button", { name: /Search or ask/ }));
    const palette = within(screen.getByRole("dialog", { name: "Search" }));
    fireEvent.change(palette.getByRole("textbox", { name: "Search" }), { target: { value: "temps" } });
    fireEvent.click(palette.getByRole("button", { name: /^Performance/ }));
    expect(location.hash).toBe("#history");
    expect(await screen.findByRole("heading", { name: "Logs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Performance" }).getAttribute("aria-current")).toBe("page");
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
