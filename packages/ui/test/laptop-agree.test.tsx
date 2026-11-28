// One fact, one figure: where two screens of Rig speak of the same thing, they say the same, and say it once.
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
  await screen.findByText(/Things to look at/i, undefined, { timeout: 10000 });
}

const go = (route: string) => act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });

/** A part's row on Home's part-by-part list, once the week's history has filled it in. */
async function homeRow(label: RegExp) {
  const list = await screen.findByRole("list", { name: "Parts" }, { timeout: 10000 });
  await within(list).findAllByText(/this week|still learning/, undefined, { timeout: 10000 });
  return within(list).getAllByRole("button").find((b) => label.test(b.querySelector(".pbp-name b")?.firstChild?.textContent ?? ""))!;
}

/** Opens a part on My laptop or My PC. */
async function openPart(name: RegExp) {
  await go("pc");
  fireEvent.click(await screen.findByRole("button", { name }, { timeout: 10000 }));
  await screen.findByRole("tab", { name: "Specs" }, { timeout: 10000 });
}

const degrees = (t: string | null | undefined) => Number((t ?? "").replace(/[^\d]/g, ""));

describe("Two screens, one figure", { timeout: 30000 }, () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; DemoClient.pace = 0; });
  afterEach(() => cleanup());

  for (const pc of ["demo-pebble", "demo-atlas"]) {
    it(`gives ${pc}'s drive the same temperature on Home as on its own page`, async () => {
      await open(pc);
      const home = degrees((await homeRow(/^Main drive$/)).querySelector(".pbp-now b")!.textContent);
      await openPart(/^Storage/);
      const tile = [...document.querySelectorAll(".live")].find((t) => t.querySelector(".label")?.textContent === "Temperature")!;
      // A reading can move a degree between the two looks; the hottest sensor and the drive's own differ by several.
      expect(Math.abs(degrees(tile.querySelector(".big")!.textContent) - home)).toBeLessThanOrEqual(1);
    });
  }
});
