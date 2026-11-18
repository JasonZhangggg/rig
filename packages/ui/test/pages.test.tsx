// Changes, Upgrades, Games and History: what each shows beside its main list,
// and what each says when there's little or nothing to show yet.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { dayLabel } = await import("../src/pages/Changes");

async function show(route: string, client = new DemoClient()) {
  location.hash = route;
  render(<RigApp client={client} />);
  await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
  return client;
}

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
afterEach(() => cleanup());

describe("Changes", () => {
  it("lists changes by day, with the fix waiting for review on top", async () => {
    await show("changes");
    const waiting = await screen.findByRole("region", { name: "Waiting for you" });
    expect(within(waiting).getByText(/runs at 60 Hz but can do 165 Hz/)).toBeTruthy();
    await within(waiting).findByText("60 Hz");

    const day = screen.getByRole("region", { name: dayLabel(new Date(Date.now() - 5 * 864e5).toISOString()) });
    expect(within(day).getByText("Turned off NVIDIA Broadcast at startup")).toBeTruthy();

    const rail = screen.getByRole("complementary", { name: "About your changes" });
    expect(within(rail).getByText("In place").nextElementSibling!.textContent).toBe("1");
    expect(within(rail).getByText(/Last change 5 days ago/)).toBeTruthy();

    fireEvent.click(within(waiting).getByRole("button", { name: /^Review:/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("says what will show up when nothing has changed yet", async () => {
    const client = new DemoClient();
    client.changes = async () => [];
    await show("changes", client);
    expect(await screen.findByText("No changes yet")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Filter" })).toBeNull();
    expect(screen.getByText("How changes work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask Rig what to fix" }));
    await waitFor(() => expect(location.hash).toBe("#chat"));
  });

  it("names days the way people say them", () => {
    const now = new Date(2026, 10, 17, 9);
    expect(dayLabel(new Date(2026, 10, 17, 1).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 16, 23).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 12, 18).toISOString(), now)).toMatch(/November 12/);
  });
});

describe("Upgrades", () => {
  it("shows where there's room from the parts Rig found", async () => {
    await show("upgrades");
    const room = await screen.findByRole("region", { name: "Where there's room" });
    expect(within(room).getByRole("img", { name: "2 of 4 slots used" })).toBeTruthy();
    expect(within(room).getByText(/Samsung SSD 990 PRO 2TB/)).toBeTruthy();
    expect(await within(room).findByText(/2 fit as they are, 1 needs a check first/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Ask what to buy" }).length).toBe(3);
  });

  it("says what will show up when there's nothing to suggest", async () => {
    const client = new DemoClient();
    client.upgrades = async () => [];
    await show("upgrades", client);
    expect(await screen.findByText("Nothing to suggest right now")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask what helps most" })).toBeTruthy();
  });
});

describe("Games", () => {
  it("sums up the range above the list and opens a game from its recent sessions", async () => {
    await show("games");
    const list = await screen.findByRole("list", { name: "Games" });
    const strip = screen.getByRole("region", { name: "Your games this week" });
    const total = screen.getByText(/h in all$/).textContent!.replace(" in all", "");
    expect(within(strip).getByText("Played this week").nextElementSibling!.textContent).toBe(total);
    expect(within(list).getAllByRole("button").length).toBeGreaterThanOrEqual(2);

    const recent = screen.getByRole("list", { name: "Recent sessions" });
    const first = within(recent).getAllByRole("button")[0];
    const name = first.querySelector(".gm-recent-name")!.textContent!;
    fireEvent.click(first);
    expect(await screen.findByRole("heading", { level: 1, name })).toBeTruthy();
  });
});

describe("History", () => {
  it("leads with the answer, then folds each part's range and what happened until asked", async () => {
    await show("history");
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(summary.textContent).toMatch(/safe limit this week|look good this week|fine this week/);
    expect(summary.textContent).toMatch(/The hottest moment was \d+°C on .+, (during|while)/);
    expect(screen.queryByText("Safe limit 89°C")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Lowest, typical and highest" }));
    const ranges = screen.getByRole("region", { name: "Lowest, typical and highest" });
    expect(within(ranges).getByText("Processor")).toBeTruthy();
    expect(within(ranges).getByText("Graphics card")).toBeTruthy();
    expect(ranges.textContent).not.toMatch(/NaN|undefined/);

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.queryByRole("list", { name: "What happened" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "What happened" }));
    const events = await screen.findByRole("list", { name: "What happened" });
    const before = within(events).getAllByRole("listitem").length;
    fireEvent.click(screen.getByRole("button", { name: /^Show all \d+$/ }));
    expect(within(screen.getByRole("list", { name: "What happened" })).getAllByRole("listitem").length).toBeGreaterThan(before);
  });

  it("says temperatures look good when nothing came near the limit, and what was running at the hottest moment", async () => {
    const client = new DemoClient();
    const t = Date.now();
    client.history = async () => Array.from({ length: 60 }, (_, i) => ({ t: t - (60 - i) * 6e4, cpu: 40 + (i === 30 ? 12 : 0), gpu: 38, busy: false, game: null }));
    await show("history", client);
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(summary.textContent).toMatch(/^Temperatures look good this week, well under the safe limit\./);
    expect(summary.textContent).toMatch(/while nothing heavy was running\.$/);
  });

  it("explains what will appear before there's any history", async () => {
    const client = new DemoClient();
    client.history = async () => [];
    await show("history", client);
    expect(await screen.findByText("Your history fills in as Rig runs")).toBeTruthy();
    expect(screen.queryByText("What happened")).toBeNull();
  });
});
