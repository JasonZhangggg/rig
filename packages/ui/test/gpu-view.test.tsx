// The graphics card on My PC: a close-up card you can move around and point at, and a Ports tab that says
// which screen is on which kind of output, and where Windows can't say which.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import type { GpuHover } from "../src/gpuScene";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

// The card view's calls, and its pointer, without WebGL.
const card = vi.hoisted(() => ({ calls: [] as [string, unknown][], point: null as ((h: GpuHover | null) => void) | null }));
vi.mock("../src/gpuScene", async (real) => ({
  ...(await real<typeof import("../src/gpuScene")>()),
  createGpuScene: (_el: HTMLElement, _shape: unknown, _ports: unknown, opts: { onHover?: (h: GpuHover | null) => void }) => {
    card.point = opts.onHover ?? null;
    const rec = (name: string) => (arg?: unknown) => { card.calls.push([name, arg]); };
    return { focus: rec("focus"), hover: rec("hover"), reset: rec("reset"), setUsage: rec("setUsage"), dispose: rec("dispose"), stats: () => ({ frames: 0 }) };
  },
}));

const { RigApp } = await import("../src/App");

beforeEach(() => {
  location.hash = "";
  localStorage.clear();
  card.calls = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width: 1101px"), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openCard() {
  location.hash = "pc";
  render(<RigApp client={new DemoClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Graphics card/ }));
  await screen.findByRole("tab", { name: "Ports" });
}
const group = (title: string) => screen.getByRole("heading", { name: title }).closest("li")!;

describe("The graphics card on My PC", () => {
  it("opens on the Ports tab with the screen on its one HDMI output named", async () => {
    await openCard();
    expect(screen.getByRole("tab", { name: "Ports" }).getAttribute("aria-selected")).toBe("true");
    const hdmi = group("HDMI");
    expect(within(hdmi).getByText("1 of 1 in use")).toBeTruthy();
    expect(within(hdmi).getByRole("button", { name: "HDMI: in use, Dell P2422H. Show on the card" })).toBeTruthy();
  });

  it("says one of the DisplayPort outputs is in use without saying which", async () => {
    await openCard();
    const dp = group("DisplayPort (3)");
    expect(within(dp).getByText("1 of 3 in use")).toBeTruthy();
    expect(within(dp).getByText("1 of 3 in use. Windows doesn't say which ones.")).toBeTruthy();
    expect(within(dp).getByText("LG 27GP850, 2560 × 1440 at 60 Hz")).toBeTruthy();
    expect(within(dp).getAllByRole("button", { name: /maybe in use, Windows doesn't say which/ })).toHaveLength(3);
  });

  it("says where its list of outputs came from, and that Windows can't see the power plug", async () => {
    await openCard();
    expect(screen.getByText(/^Outputs and plugs: What most RTX 4070 SUPER cards have/)).toBeTruthy();
    expect(within(group("Power")).getByText(/^Windows can't see power plugs, but the card won't start without it\. Push the 16-pin plug in/)).toBeTruthy();
  });

  it("marks the outputs on the card and zooms in on a click", async () => {
    await openCard();
    const marks = card.calls.filter(([n]) => n === "setUsage").at(-1)?.[1];
    expect(marks).toEqual({ "hdmi-1": "used", "dp-1": "some", "dp-2": "some", "dp-3": "some" });
    expect(document.querySelector(".board-key")?.textContent).toBe("In useFreeOne of these");
    fireEvent.click(within(group("Power")).getByRole("button", { name: /^16-pin power/ }));
    expect(card.calls.at(-1)).toEqual(["focus", "power-1"]);
  });

  it("says what's on an output when the card is pointed at, and lights its row", async () => {
    await openCard();
    act(() => card.point!({ id: "dp-2", x: 100, y: 100 }));
    expect(document.querySelector(".board-tip")?.textContent).toBe("DisplayPort 21.4aLG 27GP850 is on one of these 3. Windows doesn't say which.");
    expect(group("DisplayPort (3)").classList.contains("is-lit")).toBe(true);
    act(() => card.point!({ id: "power-1", pin: 2, x: 100, y: 100 }));
    expect(document.querySelector(".board-tip-pin")?.textContent).toBe("Power pin (+12V or ground)");
    act(() => card.point!(null));
    expect(document.querySelector(".board-tip")).toBeNull();
  });

  it("puts Reset view back to the whole card", async () => {
    await openCard();
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(card.calls.at(-1)?.[0]).toBe("reset");
  });
});
