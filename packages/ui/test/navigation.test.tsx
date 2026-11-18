// Finding your way: the sidebar names pages the way the pages name themselves, and search finds any page by everyday words.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

describe("navigation", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("groups the pages by what you came to do, with Settings in reach", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    const nav = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}`) });
    for (const name of ["Home", "My PC", "Temperatures", "Games", "Upgrades", "Ask", "Logs", "Changes", "Settings"]) expect(nav(name)).toBeTruthy();
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
    fireEvent.click(palette.getByRole("button", { name: /^Temperatures/ }));
    expect(location.hash).toBe("#history");
    expect(await screen.findByRole("heading", { name: "Temperature history" })).toBeTruthy();
  });
});
