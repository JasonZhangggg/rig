// A laptop's battery on its part page: how long it lasts, what drained it today, and changes that stretch it, each
// through the usual review. Desktops show none of it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

beforeEach(() => { location.hash = "pc"; localStorage.clear(); window.scrollTo = () => {}; DemoClient.pace = 0; });
afterEach(() => cleanup());

const savers = () => screen.getByRole("list", { name: "Ways to make the battery last longer" });

describe("The battery on a laptop", { timeout: 25000 }, () => {
  it("shows the charge, the time left, today's story and ways to stretch it", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Battery/ }, { timeout: 10000 }));
    expect(await screen.findByRole("tab", { name: "Battery life", selected: true })).toBeTruthy();
    expect(screen.getByText("Charge")).toBeTruthy();
    expect(screen.getByText("58%")).toBeTruthy();
    expect(screen.getByText("Left on battery")).toBeTruthy();
    expect(screen.getByText("at this rate")).toBeTruthy();
    expect(screen.getByText(/^Went from 100% to 58% in 2 h [12]0 min\. The fastest drop was .+, while (Teams and Chrome|Chrome and Teams) were busy\./)).toBeTruthy();
    expect(within(savers()).getAllByRole("listitem").map((li) => li.querySelector(".row-title")!.textContent)).toEqual([
      "Turn off processor boost on battery", "Turn the screen off after 5 minutes on battery", "Sleep after 15 minutes on battery",
    ]);
  });

  it("reviews a saver before anything changes, and it leaves the list once made", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Battery/ }, { timeout: 10000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Review: Turn the screen off after 5 minutes on battery" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Turn off the screen after (plugged in / battery)")).toBeTruthy();
    expect(within(sheet).getByText("10 minutes / 15 minutes")).toBeTruthy();
    expect(within(sheet).getByText("10 minutes / 5 minutes")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Make this change" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Review: Turn the screen off after 5 minutes on battery" })).toBeNull(), { timeout: 5000 });
    expect(within(savers()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows nothing of it on a desktop", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByRole("button", { name: /^Processor/ }, { timeout: 10000 });
    expect(screen.queryByRole("button", { name: /^Battery/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Processor/ }));
    await screen.findByRole("tab", { name: "Specs" });
    expect(screen.queryByRole("tab", { name: "Battery life" })).toBeNull();
    expect(screen.queryByText("Left on battery")).toBeNull();
  });
});

describe("The battery's page on a phone", () => {
  it("keeps a picked part's 3D view short, so the charge shows without scrolling past an empty picture", () => {
    const decls: Record<string, string> = {};
    postcss.parse(readFileSync(join(__dirname, "../src/styles/pages/pc.css"), "utf8")).walkAtRules("media", (at) => {
      if (!/max-width: 760px/.test(at.params)) return;
      at.walkRules((r) => { if (/\.is-part/.test(r.selector) && /\.stage-card/.test(r.selector)) r.walkDecls((d) => { decls[d.prop] = d.value; }); });
    });
    expect(decls["min-height"]).toBe("0");
    const most = Math.max(...[...decls.height.matchAll(/(\d+)px/g)].map((m) => +m[1]));
    expect(most).toBeLessThanOrEqual(320);
  });
});
