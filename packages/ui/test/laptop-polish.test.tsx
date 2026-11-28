// Small things a pass over the demo laptops found: each says on screen what's true of a laptop, once.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

// Picking a part in the list selects it, as the 3D view would.
vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function open(pc: string) {
  localStorage.setItem("rig.pc", pc);
  render(<RigApp client={new DemoClient()} />);
  await screen.findByText(/Things to look at/i);
}

describe("Laptop polish", { timeout: 25000 }, () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => cleanup());

  it("doesn't call a battery that drained asleep warm in search", async () => {
    await open("demo-comet");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search" }), { target: { value: "battery" } });
    const row = screen.getByRole("button", { name: /^73 Wh battery/ });
    expect(within(row).getByText("Needs a look")).toBeTruthy();
    expect(within(row).queryByText("Running warm")).toBeNull();
  });

  it("points a laptop's built-in parts to the laptop's own manual, not a cooler's or a card's", async () => {
    await open("demo-comet");
    await act(async () => { location.hash = "manuals"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByRole("heading", { name: "Manuals" }, { timeout: 10000 });
    expect(await screen.findAllByText("ASUS ROG Zephyrus G14 GA403UV")).toBeTruthy();
    expect(screen.queryByText(/the card's exact model/)).toBeNull();
    await act(async () => { location.hash = "pc"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    for (const part of ["Processor", "Graphics", "Cooling", "Battery"]) {
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${part}`) }, { timeout: 10000 }));
      fireEvent.click(await screen.findByRole("tab", { name: "Manual" }, { timeout: 10000 }));
      const body = document.querySelector(".detail-body")!;
      expect(await within(body as HTMLElement).findByText("ASUS ROG Zephyrus G14 GA403UV"), part).toBeTruthy();
      expect(body.textContent, part).not.toMatch(/cooler's own manual|card's exact model|doesn't keep a manual/);
      fireEvent.click(screen.getByRole("button", { name: "All parts" }));
    }
  });

  it("gives the fans the same figure on their page as their row on Home: the fastest fan", async () => {
    await open("demo-pebble");
    const row = (await screen.findAllByRole("button", { name: /^Fans/ })).find((b) => b.closest(".pbp-list"))!;
    const home = row.querySelector(".pbp-now b")!.textContent!.replace(/\D/g, "");
    await act(async () => { location.hash = "pc"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    fireEvent.click(await screen.findByRole("button", { name: /^Cooling/ }, { timeout: 10000 }));
    await screen.findByRole("tab", { name: "Specs" }, { timeout: 10000 });
    const tile = [...document.querySelectorAll(".live")].find((t) => t.querySelector(".label")?.textContent === "Fan")!;
    const fans = [...document.querySelectorAll("td, dd, .spec-value")].map((e) => e.textContent ?? "").filter((t) => / rpm$/.test(t)).map((t) => Number(t.replace(/\D/g, "")));
    expect(Number(tile.querySelector(".big")!.textContent!.replace(/\D/g, ""))).toBe(Math.max(...fans));
    expect(Math.max(...fans)).toBe(Number(home));
  });
});
