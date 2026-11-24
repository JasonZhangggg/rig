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
gpus["test-ventus"] = { ...gpus["msi-ventus2x-4070s-oc"], model: "Test Ventus", subsys: ["0001"] };
type DemoPCs = { pcs: Record<string, { id: { picks?: object }; inv: { gpus: { name: string; subsysVendor?: string; subsysId?: string }[]; displays: { gpu?: string }[] } }> };

beforeEach(() => {
  location.hash = "";
  localStorage.clear();
  card.calls = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width: 1101px"), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/**
 * Opens the card on My PC. picked: the demo's owner told Rig it's MSI's Ventus. detected: Windows' ids name it.
 * unknown: neither, so Rig asks which card it is first. An RX 6700 XT from XFX that Windows doesn't name the model of.
 */
async function openCard(how: "picked" | "detected" | "unknown" | "xfx" = "picked") {
  location.hash = "pc";
  const client = new DemoClient();
  const atlas = (client as unknown as DemoPCs).pcs["demo-atlas"];
  if (how !== "picked") delete atlas.id.picks;
  if (how === "detected") Object.assign(atlas.inv.gpus[0], { subsysVendor: "1462", subsysId: "0001" });
  if (how === "xfx") {
    Object.assign(atlas.inv.gpus[0], { name: "AMD Radeon RX 6700 XT", subsysVendor: "1eae" });
    atlas.inv.displays.forEach((d) => { d.gpu = "AMD Radeon RX 6700 XT"; });
  }
  const rename = vi.spyOn(client, "rename");
  render(<RigApp client={client} />);
  if (how === "unknown" || how === "xfx") return { rename };
  fireEvent.click(await screen.findByRole("button", { name: /^Graphics card/ }, { timeout: 5000 }));
  await screen.findByRole("tab", { name: "Ports" }, { timeout: 5000 });
  return { rename };
}
const openPorts = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /^Graphics card/ }, { timeout: 5000 }));
  await screen.findByRole("tab", { name: "Ports" }, { timeout: 5000 });
};
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

  it("says which card it is and where its list of outputs and plugs came from", async () => {
    await openCard();
    const model = document.querySelector(".gp-model")!;
    expect(within(model as HTMLElement).getByText("MSI RTX 4070 SUPER Ventus 2X OC")).toBeTruthy();
    expect(within(model as HTMLElement).getByText("You picked it")).toBeTruthy();
    expect(within(model as HTMLElement).getByRole("button", { name: "Change" })).toBeTruthy();
    expect(screen.getByText("Outputs and plugs: From MSI's spec page")).toBeTruthy();
    expect(within(group("Power")).getByText("1 plug")).toBeTruthy();
    expect(within(group("Power")).getByText("From the power supply. The card won't start without it. Push the 16-pin plug in until it clicks and no gap shows.")).toBeTruthy();
  });

  it("names a card from Windows' ids without asking", async () => {
    await openCard("detected");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Windows names it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(within(group("HDMI")).getByText("1 of 1 in use")).toBeTruthy();
  });

  it("asks once which card it is, and shows no outputs or plugs after \"I'm not sure\", only the screens and the plugs such cards come with", async () => {
    const { rename } = await openCard("unknown");
    const ask = await screen.findByRole("dialog", { name: "Which RTX 4070 SUPER is it?" }, { timeout: 5000 });
    expect(within(ask).getByRole("button", { name: /^MSI RTX 4070 SUPER Ventus 2X OC/ })).toBeTruthy();
    fireEvent.click(within(ask).getByRole("button", { name: "I'm not sure" }));
    expect(rename).toHaveBeenCalledWith("demo-atlas", { picks: { gpu: "unsure:RTX 4070 SUPER" } });
    await openPorts();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(card.ports).toEqual({ outputs: [], power: [], from: "", exact: false });
    expect(screen.queryByRole("heading", { name: "HDMI" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show on the card/ })).toBeNull();
    const screens = group("Screens");
    expect(within(screens).getByText("On a DisplayPort output, 2560 × 1440 at 60 Hz")).toBeTruthy();
    expect(within(screens).getByText("On an HDMI output, 1920 × 1080 at 60 Hz")).toBeTruthy();
    const power = group("Power");
    expect(within(power).getByText("16-pin")).toBeTruthy();
    expect(within(power).getByText("Every RTX 4070 SUPER card Rig knows takes this. Check the card's top edge to be sure.")).toBeTruthy();
    expect(screen.getByText("Rig can't tell which RTX 4070 SUPER this is")).toBeTruthy();
    expect(document.querySelector(".board-key")).toBeNull();
  });

  it("takes a pick from the card's page and shows that card's own outputs and plugs", async () => {
    const { rename } = await openCard("unknown");
    fireEvent.click(within(await screen.findByRole("dialog", {}, { timeout: 5000 })).getByRole("button", { name: "I'm not sure" }));
    await openPorts();
    fireEvent.click(screen.getByRole("button", { name: "Pick your card" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^ASUS TUF RTX 4070 SUPER OC/ }));
    expect(rename).toHaveBeenLastCalledWith("demo-atlas", { picks: { gpu: "asus-tuf-4070s-oc" } });
    expect(await screen.findByRole("heading", { name: "HDMI (2)" })).toBeTruthy();
    expect(screen.getByText("You picked it")).toBeTruthy();
  });

  it("offers only the maker's models, and shows a picked RX 6700 XT's own power plugs with the screens", async () => {
    await openCard("xfx");
    const ask = await screen.findByRole("dialog", { name: "Which RX 6700 XT is it?" }, { timeout: 5000 });
    expect(within(ask).getByText("Windows calls it AMD Radeon RX 6700 XT and says XFX made it, but not which model. Pick yours and Rig shows its power plugs. You can change it later on the graphics card's page.", { exact: false })).toBeTruthy();
    const rows = within(ask).getAllByRole("button", { pressed: false });
    expect(rows.map((b) => b.textContent)).toEqual(["XFX Speedster SWFT 309 RX 6700 XT8 + 8-pin PCIe", "XFX Speedster QICK 319 RX 6700 XT8 + 8-pin PCIe"]);
    fireEvent.click(rows[1]);
    await openPorts();
    expect(screen.getByText("XFX Speedster QICK 319 RX 6700 XT")).toBeTruthy();
    expect(within(group("Screens")).getByText("On a DisplayPort output, 2560 × 1440 at 60 Hz")).toBeTruthy();
    const power = group("Power");
    expect(within(power).getByText("2 plugs")).toBeTruthy();
    expect(within(power).getAllByRole("button", { name: /^8-pin power \d\. Show on the card$/ })).toHaveLength(2);
    expect(screen.getByText("Power plugs: From XFX's spec page. Rig doesn't have this card's outputs yet.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "HDMI" })).toBeNull();
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
