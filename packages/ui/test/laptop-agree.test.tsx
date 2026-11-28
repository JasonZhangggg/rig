// One fact, one figure: where two screens of Rig speak of the same thing, they say the same, and say it once.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  for (const pc of ["demo-pebble", "demo-comet", "demo-atlas"]) {
    it(`gives ${pc}'s processor the same usual range in games on Home as on its own page`, async () => {
      await open(pc);
      const usual = (await homeRow(/^Processor$/)).textContent ?? "";
      const [, lo, hi] = /usual (\d+)–(\d+)°/.exec(usual)!;
      await openPart(/^Processor/);
      const ribbon = await screen.findByRole("img", { name: /^Now / }, { timeout: 10000 });
      const [, plo, phi] = /Usually (\d+)°C to (\d+)°C (in games|when busy)/.exec(ribbon.getAttribute("aria-label")!)!;
      expect([plo, phi]).toEqual([lo, hi]);
    });
  }

  it("gives the battery one time left on its page, not two", async () => {
    await open("demo-pebble");
    await openPart(/^Battery/);
    await screen.findByRole("tab", { name: "Battery life", selected: true });
    const page = document.querySelector(".part-detail")!.textContent!;
    expect(screen.getByText("Left on battery")).toBeTruthy();
    expect(screen.getByText("at the last hour's rate")).toBeTruthy();
    // The rate this second's time isn't said beside it, in the tile or in the story under the tabs.
    expect(page).not.toMatch(/at this rate|would last/);
  });

  it("says a night that drained the battery once on Home, where it can be acted on, and once on the battery's page", async () => {
    await open("demo-comet");
    const todo = within(screen.getByText("Things to look at").closest("section")!);
    const item = await todo.findByText("Used 39% of the battery asleep last night");
    await homeRow(/^Battery$/);
    const main = document.querySelector("main")!;
    expect(main.textContent!.match(/39%/g)).toHaveLength(1);
    // The health tile names the area it costs; the item itself is where to act.
    expect(screen.getByText("Below full marks: Battery. Every other check passed.")).toBeTruthy();
    expect(item.closest("button")).toBeTruthy();
    await openPart(/^Battery/);
    await screen.findByRole("tab", { name: "Battery life", selected: true });
    const page = document.querySelector(".part-detail")!;
    expect(page.textContent!.match(/39%/g)).toHaveLength(1);
    const night = within(within(page as HTMLElement).getByRole("list", { name: "Recent sleeps on battery" })).getAllByRole("listitem")[0];
    expect(within(night).getByText("Used a lot")).toBeTruthy();
    fireEvent.click(within(night).getByRole("button", { name: /^Details/ }));
    expect(within(night).getByRole("button", { name: /^Ask about it/ })).toBeTruthy();
  });

  it("says the same of a laptop's memory on its Upgrade tab and on Upgrades", async () => {
    await open("demo-comet");
    await openPart(/^Memory/);
    fireEvent.click(screen.getByRole("tab", { name: "Upgrade" }));
    const idea = (await screen.findByRole("heading", { level: 3, name: "Memory is most likely built into the board" }, { timeout: 10000 })).closest("li")!;
    expect(idea.textContent).toMatch(/take no memory sticks/);
    expect(idea.textContent).not.toMatch(/Rig will check/);
    await go("upgrades");
    const closed = await screen.findByText(/^Built into Comet's board, so not upgradable:/, undefined, { timeout: 10000 });
    expect(closed.textContent).toBe("Built into Comet's board, so not upgradable: memory (most likely), graphics and processor.");
  });

  for (const pc of ["demo-comet", "demo-atlas"]) {
    it(`gives ${pc}'s Slow or loud a headline that points to the reasons, not one that repeats the first`, async () => {
      await open(pc);
      fireEvent.click(await screen.findByRole("button", { name: "Slow or loud? Check now" }));
      const found = within(await screen.findByRole("list", { name: "What Rig found" }, { timeout: 10000 }));
      const heading = screen.getByRole("dialog").querySelector("h2")!.textContent!;
      const first = found.getAllByRole("listitem")[0].querySelector(".row-title")!.textContent!;
      // The first reason is said once, in its row with its numbers and its step; the headline names no game, app or part of it.
      const who = /^(.+?) (keeps|is running)/.exec(first)?.[1] ?? first;
      expect(heading).toMatch(/^(The fans are loud\. Here's (why|the likely reason)\.|Here's what's (likely )?slowing \w+ down\.)$/);
      expect(heading).not.toContain(who);
    });
  }

  for (const [pc, word] of [["demo-comet", "Graphics"], ["demo-atlas", "Graphics card"]]) {
    it(`calls ${pc}'s graphics "${word}" on Home, its own page and Logs`, async () => {
      await open(pc);
      // Home's part-by-part row.
      const row = await homeRow(/^Graphics/);
      expect(row.querySelector(".pbp-name b")!.firstChild!.textContent).toBe(word);
      // My laptop or My PC: the list of parts, and the part's own page.
      await go("pc");
      const parts = within(await screen.findByRole("list", { name: "Parts" }, { timeout: 10000 }));
      fireEvent.click(parts.getByRole("button", { name: new RegExp(`^${word}( |$)`) }));
      expect((await screen.findByText(word, { selector: ".part-kind" }, { timeout: 10000 })).textContent).toBe(word);
      // Logs: the part's row over the readings.
      await go("logs");
      const names = await waitFor(() => {
        const found = [...document.querySelectorAll(".pbp-name b")].map((b) => b.textContent);
        expect(found).toContain("Processor");
        return found;
      }, { timeout: 10000 });
      expect(names).toContain(word);
      expect(document.querySelector("main")!.textContent).not.toMatch(word === "Graphics" ? /Graphics card/ : /Graphics(?! card)\b/);
    });
  }
});
