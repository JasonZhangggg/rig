// A part clicked the moment the PC page draws opens, even before the page has finished settling in.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

afterEach(() => { cleanup(); localStorage.clear(); location.hash = ""; });

describe("Clicking a part", { timeout: 20000 }, () => {
  it("opens it even when clicked the instant the parts list appears", async () => {
    location.hash = "pc";
    let clicked = false;
    const watch = new MutationObserver(() => {
      if (clicked) return;
      const btn = [...document.querySelectorAll<HTMLButtonElement>(".part-txt")].find((s) => s.textContent?.startsWith("Graphics card"))?.closest("button");
      if (btn) { clicked = true; btn.click(); }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    render(<RigApp client={new DemoClient()} />);
    await screen.findByRole("tablist", {}, { timeout: 10000 });
    watch.disconnect();
  });
});
