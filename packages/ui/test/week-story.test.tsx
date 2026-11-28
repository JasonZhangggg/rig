// Logs > Readings > Week, told as a story, on the demo PC.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

describe("The week as a story", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => cleanup());

  it("says what stood out, compares the week with the one before, and lists what happened", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0));
    try {
      render(<RigApp client={new DemoClient()} />);
      await screen.findByText(/Things to look at/i);
      await open("logs");
      const readings = await screen.findByRole("region", { name: "Readings" });
      // Story is one way to show the week, beside the sensors, not in place of them; shorter spans only have the sensors.
      expect(within(readings).queryByRole("group", { name: "Show as" })).toBeNull();
      fireEvent.click(within(within(readings).getByRole("group", { name: "How far back" })).getByRole("button", { name: "Week" }));
      const views = within(readings).getByRole("group", { name: "Show as" });
      expect(within(views).getAllByRole("button").map((b) => b.textContent)).toEqual(["Story", "Sensors"]);
      fireEvent.click(within(views).getByRole("button", { name: "Story" }));

      const story = await within(readings).findByRole("region", { name: /^A normal week, except/ });
      within(story).getByText("This week on Atlas");
      // Wednesday's Cyberpunk evening ran the graphics card past its limit, and the driver reset during it.
      within(story).getByText("Cyberpunk 2077 ran hot yesterday and the graphics driver reset");
      const figures = within(story).getByRole("group", { name: "This week against the week before" });
      expect(figures.textContent).toMatch(/\d+°resting · \d+° before/);
      expect(figures.textContent).toMatch(/\d+(\.5)? hplayed · \d+(\.5)? h last week/);
      expect(figures.textContent).toMatch(/9\d°hottest · \d+° last week/);
      within(story).getByRole("img", { name: "Graphics card temperature, last 7 days" });

      // One row per moment, newest first, with a grey line on what Rig saw and a way to it.
      const list = within(story).getByRole("list", { name: "What happened this week" });
      const titles = within(list).getAllByRole("listitem").map((li) => li.querySelector(".row-title")!.textContent);
      expect(titles).toEqual([
        "Cyberpunk 2077 took the graphics card to 90°C, and the graphics driver reset",
        "Discord crashed",
        "Turned off NVIDIA Broadcast at startup",
      ]);
      within(list).getByText(/^The graphics card was at \d+°C then, \d+° under its 88°C limit\.$/);
      within(list).getByText(/^The graphics card has rested at .*°C since/);
      // Nothing claims the change was the cause.
      expect(list.textContent).not.toMatch(/helped|because/i);

      fireEvent.click(within(list).getByRole("button", { name: "See the change" }));
      await screen.findByRole("heading", { level: 1, name: "Changes" });

      // Back on Logs, a shorter span shows the charts again.
      await open("logs");
      const again = await screen.findByRole("region", { name: "Readings" });
      fireEvent.click(within(within(again).getByRole("group", { name: "How far back" })).getByRole("button", { name: "Day" }));
      expect(within(again).queryByRole("group", { name: "Show as" })).toBeNull();
      await within(again).findByRole("img", { name: "Temperatures" });
    } finally { vi.useRealTimers(); }
  });

  it("follows the temperature unit picked in Settings", async () => {
    // The demo week depends on today's date, so pin it like the test above.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0));
    try {
      localStorage.setItem("rig.tempUnit", "f");
      render(<RigApp client={new DemoClient()} />);
      await screen.findByText(/Things to look at/i);
      await open("history");
      const readings = await screen.findByRole("region", { name: "Readings" });
      fireEvent.click(within(within(readings).getByRole("group", { name: "Show as" })).getByRole("button", { name: "Story" }));
      const story = await within(readings).findByRole("region", { name: /^A normal week/ });
      const list = within(story).getByRole("list", { name: "What happened this week" });
      expect(list.textContent).toMatch(/°F/);
      expect(story.textContent).not.toMatch(/°C/);
    } finally { vi.useRealTimers(); }
  });
});
