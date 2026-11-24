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
const card = vi.hoisted(() => ({ calls: [] as [string, unknown][], ports: null as unknown, point: null as ((h: GpuHover | null) => void) | null }));
vi.mock("../src/gpuScene", async (real) => ({
  ...(await real<typeof import("../src/gpuScene")>()),
  createGpuScene: (_el: HTMLElement, _shape: unknown, ports: unknown, opts: { onHover?: (h: GpuHover | null) => void }) => {
    card.point = opts.onHover ?? null;
    card.ports = ports;
    const rec = (name: string) => (arg?: unknown) => { card.calls.push([name, arg]); };
    return { focus: rec("focus"), hover: rec("hover"), reset: rec("reset"), setUsage: rec("setUsage"), dispose: rec("dispose"), stats: () => ({ frames: 0 }) };
  },
}));

const { RigApp } = await import("../src/App");
const { gpus } = await import("@rig/core");

// A card Rig can name from Windows' subsystem ids: MSI's Ventus 2X, one HDMI and three DisplayPort outputs. The id is
// made up for the test, since Rig's list has no real ids yet.
gpus["test-ventus"] = { ...gpus["msi-ventus2x-4070s-oc"], subsys: ["0001"] };
type DemoPCs = { pcs: Record<string, { inv: { gpus: { subsysVendor?: string; subsysId?: string }[] } }> };

beforeEach(() => {
  location.hash = "";
  localStorage.clear();
  card.calls = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width: 1101px"), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openCard(known = true) {
  location.hash = "pc";
  const client = new DemoClient();
  if (known) Object.assign((client as unknown as DemoPCs).pcs["demo-atlas"].inv.gpus[0], { subsysVendor: "1462", subsysId: "0001" });
  render(<RigApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Graphics card/ }, { timeout: 5000 }));
  await screen.findByRole("tab", { name: "Ports" }, { timeout: 5000 });
}
const group = (title: string) => screen.getByRole("heading", { name: title }).closest("li")!;

// The first test pays for the app's cold start, which takes several seconds on a busy CI runner, so each test
// gets as long as the waits above allow.
describe("The graphics card on My PC", { timeout: 15000 }, () => {
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

  it("says where its list of outputs and plugs came from", async () => {
    await openCard();
    expect(screen.getByText("Outputs and plugs: From MSI's spec page")).toBeTruthy();
    expect(within(group("Power")).getByText("1 plug")).toBeTruthy();
    expect(within(group("Power")).getByText("From the power supply. The card won't start without it. Push the 16-pin plug in until it clicks and no gap shows.")).toBeTruthy();
  });

  it("shows no outputs or plugs for a card it can't name, only the screens and the plugs such cards come with", async () => {
    await openCard(false);
    expect(card.ports).toEqual({ outputs: [], power: [], from: "", exact: false });
    expect(screen.queryByRole("heading", { name: "HDMI" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show on the card/ })).toBeNull();
    const screens = group("Screens");
    expect(within(screens).getByText("On a DisplayPort output, 2560 × 1440 at 60 Hz")).toBeTruthy();
    expect(within(screens).getByText("On an HDMI output, 1920 × 1080 at 60 Hz")).toBeTruthy();
    const power = group("Power");
    expect(within(power).getByText("16-pin")).toBeTruthy();
    expect(within(power).getByText("Every RTX 4070 SUPER card Rig knows takes this. Check the card's top edge to be sure.")).toBeTruthy();
    expect(screen.getByText("Rig can't tell which RTX 4070 SUPER this is yet, so it doesn't show the card's own outputs and plugs.")).toBeTruthy();
    expect(document.querySelector(".board-key")).toBeNull();
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
