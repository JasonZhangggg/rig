// A laptop's battery on its part page: how long it lasts, what drained it today, and changes that stretch it, each
// through the usual review. Desktops show none of it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient, fixtures } from "@rig/core/demo";

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
      "Turn off processor boost on battery", "Turn the screen off after 5 minutes on battery", "Sleep after 15 minutes on battery", "Stop charging at 80%",
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
    expect(within(savers()).getAllByRole("listitem")).toHaveLength(3);
  });

  it("opens a worn battery's finding on the battery's own replacement", async () => {
    // A battery worn under 70%, built for this test from the demo laptop.
    const kept = fixtures.pebble.inv.battery;
    fixtures.pebble.inv.battery = { designWh: 75, fullWh: 45, cycles: 820 };
    try {
      location.hash = "";
      localStorage.setItem("rig.pc", "demo-pebble");
      render(<RigApp client={new DemoClient()} />);
      fireEvent.click(await screen.findByRole("button", { name: /^Battery holds 60% of its original charge/ }, { timeout: 10000 }));
      expect(await screen.findByRole("tab", { name: "Upgrade", selected: true })).toBeTruthy();
      expect(location.hash).toBe("#pc");
      expect(await screen.findByText("Replace the battery")).toBeTruthy();
    } finally {
      fixtures.pebble.inv.battery = kept;
    }
  });

  it("shows nothing of it on a desktop", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByRole("button", { name: /^Processor/ }, { timeout: 10000 });
    expect(screen.queryByRole("button", { name: /^Battery/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Processor/ }));
    await screen.findByRole("tab", { name: "Specs" });
    expect(screen.queryByRole("tab", { name: "Battery life" })).toBeNull();
    expect(screen.queryByText("Left on battery")).toBeNull();
    expect(screen.queryByText("While asleep")).toBeNull();
    expect(screen.queryByText(/^Charg(es|ing)/)).toBeNull();
  });
});

describe("Stopping charging short of full", { timeout: 25000 }, () => {
  const openBattery = async (pc: string) => {
    localStorage.setItem("rig.pc", pc);
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Battery/ }, { timeout: 10000 }));
    await screen.findByRole("tab", { name: "Battery life", selected: true });
  };

  it("says so on the laptop whose maker's app holds it at 80%, and offers nothing more", async () => {
    await openBattery("demo-comet");
    expect(screen.getByText("Charging stops at 80% to slow wear.")).toBeTruthy();
    expect(screen.queryByText(/^Stop charging/)).toBeNull();
    // The charge is the big figure, so the line under it doesn't say 80% a second time.
    expect(screen.getByText("Plugged in, not charging")).toBeTruthy();
    expect(screen.queryByText(/holding at 80%/)).toBeNull();
  });

  it("on the laptop that sits at 100% on the charger, names its maker's app and asks about it, since Rig can't set it there", async () => {
    await openBattery("demo-pebble");
    expect(screen.getByText("Charges to 100%.")).toBeTruthy();
    const row = within(savers()).getAllByRole("listitem").at(-1)!;
    expect(within(row).getByText("Stop charging at 80%")).toBeTruthy();
    expect(within(row).getByText("Plugged in at 100% most of the time. Set it in MyASUS.")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /^Review/ })).toBeNull();
    // The maker's app sets that one, so only the rows Rig reviews are undone from Changes.
    expect(screen.getByText("Each one you review can be undone from Changes.")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Ask about it: Stop charging at 80%" }));
    expect(await screen.findByText(/^My ASUS laptop is plugged in at 100% most of the time\. How do I make it stop charging at 80% in MyASUS/)).toBeTruthy();
  });

  it("on an HP, reviews the firmware change on its own card, sets it once approved, and lists it in Changes", async () => {
    // The demo laptop made an HP for this test: Rig sets the limit through HP's own firmware tools.
    const kept = fixtures.pebble.inv.machine.manufacturer;
    fixtures.pebble.inv.machine.manufacturer = "HP";
    try {
      await openBattery("demo-pebble");
      fireEvent.click(screen.getByRole("button", { name: "Review: Stop charging at 80%" }));
      expect(await screen.findByRole("heading", { name: "Changes Battery charge limit in firmware" })).toBeTruthy();
      expect(screen.getByText("This changes a firmware setting.")).toBeTruthy();
      expect(screen.getByText("Stops charging short of full while it's plugged in, so the battery wears more slowly.")).toBeTruthy();
      // Nothing is set until the person types the word and applies.
      expect(screen.getByText("Charges to 100%.")).toBeTruthy();
      fireEvent.change(screen.getByLabelText(/to turn on Apply/), { target: { value: "firmware" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(await screen.findByText("Charge limit set. It applies at the next restart, and you can undo it from Changes.", {}, { timeout: 4000 })).toBeTruthy();
      expect(await screen.findByText("Charging stops at 80% to slow wear.")).toBeTruthy();
      expect(screen.queryByText("Stop charging at 80%")).toBeNull();
      fireEvent.click(screen.getByRole("link", { name: /^Changes/ }));
      await screen.findByRole("heading", { level: 1, name: "Changes" });
      expect(await screen.findByText("Stop charging at 80%", {}, { timeout: 4000 })).toBeTruthy();
    } finally {
      fixtures.pebble.inv.machine.manufacturer = kept;
    }
  });
});

describe("How much battery each sleep used", { timeout: 25000 }, () => {
  const sleeps = () => screen.getByRole("list", { name: "Recent sleeps on battery" });
  const titles = () => within(sleeps()).getAllByRole("listitem").map((li) => li.querySelector(".row-title > span")!.textContent);
  const openBattery = async (pc: string) => {
    localStorage.setItem("rig.pc", pc);
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Battery/ }, { timeout: 10000 }));
    await screen.findByRole("tab", { name: "Battery life", selected: true });
  };

  it("lists the gaming laptop's bad night first, flagged, with what woke it and a next step", async () => {
    await openBattery("demo-comet");
    expect(screen.getByRole("heading", { name: "While asleep" })).toBeTruthy();
    expect(titles()).toEqual(["9 h 20 min asleep, used 39%", "2 h 30 min asleep, used 2%"]);
    const bad = within(sleeps()).getAllByRole("listitem")[0];
    expect(within(bad).getByText("Used a lot")).toBeTruthy();
    expect(within(bad).getByText(/night$/)).toBeTruthy();
    expect(within(bad).getByText(/ to .+ · 80% to 41%$/)).toBeTruthy();
    // Only the bad night has more to say.
    expect(within(sleeps()).getAllByRole("button", { name: /^Details/ })).toHaveLength(1);
    fireEvent.click(within(bad).getByRole("button", { name: /^Details/ }));
    expect(within(bad).getByText("That's about 4% an hour, where under 1% is usual. It woke 14 times for its Wi-Fi adapter, MediaTek Wi-Fi 7 MT7925.")).toBeTruthy();
    expect(within(bad).getByText(/^Windows lets a Wi-Fi adapter wake the laptop to stay connected\./)).toBeTruthy();
    // The change that fits comes first among the savers, through the usual review.
    expect(within(savers()).getAllByRole("listitem")[0].querySelector(".row-title")!.textContent).toBe("Hibernate after 3 hours asleep on battery");
    fireEvent.click(within(bad).getByRole("button", { name: /^Ask about it/ }));
    expect(await screen.findByText(/^My laptop woke 14 times overnight for its Wi-Fi adapter \(MediaTek Wi-Fi 7 MT7925\) and used 39% of its battery asleep\./)).toBeTruthy();
  });

  it("says so on Home, in Things to look at and on the battery's row", async () => {
    location.hash = "";
    localStorage.setItem("rig.pc", "demo-comet");
    render(<RigApp client={new DemoClient()} />);
    const todo = within((await screen.findByText("Things to look at", undefined, { timeout: 10000 })).closest("section")!);
    expect(await todo.findByText("Used 39% of the battery asleep last night")).toBeTruthy();
    expect(screen.getByText("Used 39% asleep last night")).toBeTruthy();
  });

  it("shows the other laptop's ordinary week calmly, with nothing flagged", async () => {
    await openBattery("demo-pebble");
    expect(titles()).toHaveLength(5);
    for (const t of titles()) expect(t).toMatch(/^\d+ h( \d+ min)? asleep, used [4-7]%$/);
    expect(within(sleeps()).queryByText("Used a lot")).toBeNull();
    expect(within(sleeps()).queryByRole("button", { name: /^Details/ })).toBeNull();
    expect(screen.queryByText("Hibernate after 3 hours asleep on battery")).toBeNull();
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
