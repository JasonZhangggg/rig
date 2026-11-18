// Appearance: color presets and custom colors that keep text readable, the
// chrome, page, corners, density, text size and motion, applied at once on
// every screen and remembered on this device.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import {
  brass, chromes, contrast, DISTINCT, derive, FILL_INK, fillProblems, leastDifference, meetsContrast, pageTones, palettes, paletteOf, defaultAppearance,
} from "../src/appearance";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const tokensCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/tokens.css"), "utf8");
const shipped = (name: string) => tokensCss.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
const applied = (name: string) => document.documentElement.style.getPropertyValue(name);

describe("contrast helper", () => {
  it("measures WCAG contrast", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("darkens text until it passes AA on light grounds and lightens marks on graphite", () => {
    const d = derive({ good: "#FFF3B0", look: "#FFB0B0", expected: "#CCCCCC" });
    for (const bg of ["#FFFFFF", "#F2F0EC", d.goodBg]) expect(contrast(d.goodText, bg)).toBeGreaterThanOrEqual(4.5);
    const dark = derive({ good: "#203040", look: "#401010", expected: "#333333" });
    expect(contrast(dark.goodOnDark, chromes[0].raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.lookOnDark, chromes[0].raised)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("presets", () => {
  it("keep Brass exactly as the stylesheet ships it", () => {
    const p = paletteOf(defaultAppearance);
    expect(p.colors).toEqual({ good: shipped("--good"), look: shipped("--look"), expected: shipped("--expected") });
    expect(p.goodMark).toBe(shipped("--good-mark"));
    expect(p.goodText).toBe(shipped("--good-text"));
    expect(p.goodBg).toBe(shipped("--good-bg"));
    expect(p.lookText).toBe(shipped("--look-text"));
    expect(p.lookBg).toBe(shipped("--look-bg"));
    expect(shipped("--graphite")).toBe(chromes[0].graphite);
    expect(shipped("--graphite-2")).toBe(chromes[0].raised);
    expect(shipped("--ground")).toBe(pageTones[0].ground);
  });

  it("all pass AA, keep labels on fills readable and keep Settled and Needs a look apart with color blindness, on every chrome and page", () => {
    for (const preset of palettes) {
      for (const chrome of chromes) {
        expect(fillProblems(preset.colors, chrome), `${preset.id} on ${chrome.id}`).toEqual({ goodTooDark: false, lookTooDark: false, tooAlike: false });
        for (const page of pageTones) {
          const p = paletteOf({ ...defaultAppearance, palette: preset.id, chrome: chrome.id, page: page.id });
          expect(meetsContrast(p, chrome, page), `${preset.id} on ${chrome.id}, ${page.id}`).toBe(true);
        }
      }
      expect(leastDifference(preset.colors.good, preset.colors.look)).toBeGreaterThanOrEqual(DISTINCT);
    }
    expect(contrast(FILL_INK, brass.colors.good)).toBeGreaterThan(4.5);
  });
});

async function openSettings() {
  await act(async () => { location.hash = "settings"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  return screen.findByRole("group", { name: "Colors" });
}

describe("Appearance in Settings", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); document.documentElement.removeAttribute("style"); delete document.documentElement.dataset.motion; delete document.documentElement.dataset.text; });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("starts in Brass with the shipped tokens and nothing to reset", async () => {
    render(<RigApp client={new DemoClient()} />);
    await openSettings();
    expect(applied("--good")).toBe("#E6D3A3");
    expect(applied("--look-text")).toBe("#A4471C");
    expect(applied("--graphite")).toBe("#1B1B1F");
    expect(applied("--r")).toBe("28px");
    expect(screen.getByRole("button", { name: /^Brass/ }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Reset appearance" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("applies a preset at once, everywhere, and remembers it after the app reopens", async () => {
    const { unmount } = render(<RigApp client={new DemoClient()} />);
    const colors = await openSettings();
    fireEvent.click(within(colors).getByRole("button", { name: /^Sage/ }));
    const sage = palettes.find((p) => p.id === "sage")!;
    expect(applied("--good")).toBe(sage.colors.good);
    expect(applied("--look")).toBe(sage.colors.look);
    expect(contrast(applied("--good-text"), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(JSON.parse(localStorage.getItem("rig.appearance.v1")!).palette).toBe("sage");

    unmount();
    document.documentElement.removeAttribute("style");
    render(<RigApp client={new DemoClient()} />);
    expect(applied("--good")).toBe(sage.colors.good);
    expect((await openSettings()).querySelector('[aria-pressed="true"]')?.textContent).toMatch(/^Sage/);
  });

  it("takes custom colors, warns about a dark one and fixes it, and resets to Brass", async () => {
    render(<RigApp client={new DemoClient()} />);
    const colors = await openSettings();
    fireEvent.click(within(colors).getByRole("button", { name: /^Custom/ }));
    fireEvent.change(screen.getByLabelText(/usual reading/), { target: { value: "#3a2a8a" } });
    expect(applied("--good")).toBe("#3A2A8A");
    expect(screen.getByText(/Labels on Settled are hard to read/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use a lighter shade" }));
    expect(contrast(FILL_INK, applied("--good"))).toBeGreaterThanOrEqual(4.5);
    expect(screen.queryByText(/Labels on Settled are hard to read/)).toBeNull();

    const hex = screen.getByRole("textbox", { name: "Needs a look, hex code" });
    fireEvent.change(hex, { target: { value: "e36" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(applied("--look")).toBe("#EE3366");

    fireEvent.click(screen.getByRole("button", { name: "Reset to Brass" }));
    expect(applied("--good")).toBe(brass.colors.good);
    expect(applied("--look")).toBe(brass.colors.look);
  });

  it("keeps chrome, page, corners and density under More appearance options", async () => {
    render(<RigApp client={new DemoClient()} />);
    await openSettings();
    expect(screen.queryByRole("group", { name: "Chrome" })).toBeNull();
    const more = screen.getByRole("button", { name: /^More appearance options/ });
    expect(more.textContent).toMatch(/Graphite chrome, warm page, rounded corners, comfortable spacing/);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    for (const name of ["Chrome", "Page", "Corners", "Density"]) expect(screen.getByRole("group", { name })).toBeTruthy();
  });

  it("changes chrome, page, corners, density, text size and motion, and resets them all", async () => {
    render(<RigApp client={new DemoClient()} />);
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: /^More appearance options/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Chrome" })).getByRole("button", { name: "Ink" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Page" })).getByRole("button", { name: "Mist" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Corners" })).getByRole("button", { name: "Square" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Density" })).getByRole("button", { name: "Compact" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Text size" })).getByRole("button", { name: "Largest" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Motion" })).getByRole("button", { name: "Reduce" }));
    const root = document.documentElement;
    expect(applied("--graphite")).toBe(chromes.find((c) => c.id === "ink")!.graphite);
    expect(applied("--ground")).toBe(pageTones.find((p) => p.id === "mist")!.ground);
    expect([applied("--r"), applied("--r-sm"), applied("--gap"), applied("--fs")]).toEqual(["8px", "5px", "10px", "14px"]);
    expect(root.dataset.text).toBe("larger");
    expect(root.dataset.motion).toBe("reduce");

    fireEvent.click(screen.getByRole("button", { name: "Reset appearance" }));
    expect(applied("--graphite")).toBe("#1B1B1F");
    expect(applied("--r")).toBe("28px");
    expect(root.dataset.text).toBeUndefined();
    expect(root.dataset.motion).toBeUndefined();
    expect(screen.getByText("Appearance is back to how Rig ships.")).toBeTruthy();
  });

  it("follows a change made in another window", async () => {
    render(<RigApp client={new DemoClient()} />);
    await openSettings();
    await act(async () => {
      localStorage.setItem("rig.appearance.v1", JSON.stringify({ palette: "cobalt" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "rig.appearance.v1" }));
    });
    expect(applied("--good")).toBe(palettes.find((p) => p.id === "cobalt")!.colors.good);
  });

  it("falls back to the default look for a damaged saved value", async () => {
    localStorage.setItem("rig.appearance.v1", "{not json");
    render(<RigApp client={new DemoClient()} />);
    await openSettings();
    expect(applied("--good")).toBe("#E6D3A3");
  });
});
