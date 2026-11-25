// A part on My PC fits the window: the 3D view takes the height left under the title, so the page doesn't scroll.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

let wide = true;
beforeEach(() => {
  location.hash = "";
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width: 1101px") ? wide : false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("innerHeight", 880);
  // The 3D view starts 154px down the window, under the part's name.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = this.classList.contains("pc-view") ? 154 : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function openBoard() {
  location.hash = "pc";
  render(<RigApp client={new DemoClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Motherboard/ }, { timeout: 10000 }));
  await screen.findByRole("tab", { name: "Manual" }, { timeout: 10000 });
  return document.querySelector<HTMLElement>(".pc-view")!;
}

describe("A part on My PC", { timeout: 25000 }, () => {
  it("sizes the 3D view to the window height left under the title", async () => {
    wide = true;
    const view = await openBoard();
    expect(view.style.getPropertyValue("--fit-h")).toBe(`${880 - 154}px`);
  });

  it("leaves the 3D view's height to the page on a narrow window, where everything stacks", async () => {
    wide = false;
    const view = await openBoard();
    expect(view.style.getPropertyValue("--fit-h")).toBe("");
  });
});
