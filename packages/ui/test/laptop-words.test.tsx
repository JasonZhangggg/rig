// A laptop is called a laptop: wherever Rig means the machine on screen, it takes its noun from the machine's kind.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const go = async (route: string) => { await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); }); };
/** What a person reads, words in buttons' and links' names included. */
const shown = () => [document.body.textContent ?? "", ...[...document.querySelectorAll("[aria-label],[title]")].map((e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("title") ?? ""}`)].join("\n");
const machinePC = /\b(?:this|your|my|the|whole|3D|demo) PC\b/i;

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; DemoClient.pace = 0; });
afterEach(() => { cleanup(); DemoClient.pace = 1; });

describe("laptop words", () => {
  it("names a laptop a laptop in the sidebar, on My laptop and in search", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    const side = within(screen.getByRole("complementary", { name: "Main" }));
    expect(side.getByText("Your laptop")).toBeTruthy();
    expect(side.getByRole("link", { name: /^My laptop/ })).toBeTruthy();
    expect(side.queryByText(/\bPC\b/)).toBeNull();
    expect(side.getByRole("button", { name: "Rig, Pebble, switch laptop" })).toBeTruthy();

    await go("pc");
    expect(screen.getByRole("navigation", { name: "My laptop" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(screen.getByText("The accent marks this laptop in your list of PCs.")).toBeTruthy();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search" }), { target: { value: "my laptop" } });
    expect(screen.getByRole("button", { name: /^My laptop Your laptop in 3D/ })).toBeTruthy();
  });

  it("never calls Pebble a PC on the screens about it", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    // Logs is left out: its Performance view still says "Whole PC" (pages/logs/Lanes.tsx, Readings.tsx).
    for (const route of ["overview", "pc", "upgrades", "manuals", "safety", "games", "events", "chat", "changes", "settings"]) {
      await go(route);
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(shown().match(machinePC)?.[0], `#${route}`).toBeUndefined();
    }
    expect(screen.getByText(/Makes every screen a little bigger, the 3D laptop included\./)).toBeTruthy();
  });

  it("still calls a desktop a PC", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    const side = within(screen.getByRole("complementary", { name: "Main" }));
    expect(side.getByText("Your PC")).toBeTruthy();
    expect(side.getByRole("link", { name: /^My PC/ })).toBeTruthy();
    expect(side.queryByText(/laptop/i)).toBeNull();
    await go("settings");
    expect(screen.getByText(/Makes every screen a little bigger, the 3D PC included\./)).toBeTruthy();
  });
});
