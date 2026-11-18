// Changes, Upgrades, Games and History: what each leads with, what waits behind a button,
// and what each says when there's little or nothing to show yet.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PC, Upgrade } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { dayLabel } = await import("../src/pages/Changes");
const { bestPick } = await import("../src/pages/upgrades/pick");

async function show(route: string, client = new DemoClient()) {
  location.hash = route;
  render(<RigApp client={client} />);
  await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
  return client;
}

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
afterEach(() => cleanup());

describe("Changes", () => {
  it("leads with what's in place, then the fix waiting for review, then the timeline", async () => {
    await show("changes");
    const lead = await screen.findByRole("region", { name: "1 change in place on Atlas" });
    expect(within(lead).getByText("In place").nextElementSibling!.textContent).toBe("1");
    expect(within(lead).getByText(/The latest, 5 days ago: Turned off NVIDIA Broadcast at startup/)).toBeTruthy();

    const waiting = screen.getByRole("region", { name: "Waiting for you" });
    expect(within(waiting).getByText(/runs at 60 Hz but can do 165 Hz/)).toBeTruthy();
    expect(within(waiting).queryByText("60 Hz")).toBeNull();
    fireEvent.click(within(waiting).getByRole("button", { name: /^Details: / }));
    await within(waiting).findByText("60 Hz");

    const day = screen.getByRole("region", { name: dayLabel(new Date(Date.now() - 5 * 864e5).toISOString()) });
    expect(within(day).getByText("Turned off NVIDIA Broadcast at startup")).toBeTruthy();
    expect(within(day).queryByText("Starts with Windows")).toBeNull();
    fireEvent.click(within(day).getByRole("button", { name: "Details: Turned off NVIDIA Broadcast at startup" }));
    expect(within(day).getByText("Starts with Windows")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Filter" })).toBeNull();

    fireEvent.click(within(waiting).getByRole("button", { name: /^Review:/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("says when every change is undone", async () => {
    await show("changes");
    const day = await screen.findByRole("region", { name: dayLabel(new Date(Date.now() - 5 * 864e5).toISOString()) });
    fireEvent.click(within(day).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("region", { name: "Every change on Atlas is undone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
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
  it("leads with Rig's pick and why, with the room each part has beside its idea", async () => {
    await show("upgrades");
    const pick = await screen.findByRole("region", { name: "Add another NVMe SSD" });
    expect(within(pick).getByText("Rig's pick for Atlas")).toBeTruthy();
    expect(within(pick).getByText(/Nothing on Atlas needs upgrading right now/)).toBeTruthy();
    expect(within(pick).getByText("726 GB")).toBeTruthy();
    expect(within(pick).getByText(/Samsung SSD 990 PRO 2TB/)).toBeTruthy();

    const others = screen.getByRole("region", { name: "Other ideas" });
    expect(within(others).getByRole("img", { name: "2 of 4 slots used" })).toBeTruthy();
    expect(within(others).getByText("Another case fan")).toBeTruthy();
    expect(screen.queryByText("Where there's room")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ask what to buy" }).length).toBe(3);
    expect(screen.getByText("Have a part in mind?")).toBeTruthy();
  });

  it("picks the idea that answers something Rig flagged on the PC", () => {
    const pc = { name: "Atlas", issues: [{ id: "gpu-warm", severity: "warn", title: "Graphics card runs warm at 80°C", body: "", action: "", part: "gpu", go: "chat" }] } as unknown as PC;
    const list: Upgrade[] = [
      { part: "Storage", fit: "fits", title: "Add another NVMe SSD", detail: "", gain: "More room for games and files", price: "" },
      { part: "Cooling", fit: "check", title: "Another case fan", detail: "", gain: "", price: "" },
    ];
    expect(bestPick(list, pc, [])).toMatchObject({ idea: { part: "Cooling" }, why: "Graphics card runs warm at 80°C.", pressing: true });
    expect(bestPick(list, { ...pc, issues: [] }, [])).toMatchObject({ idea: { part: "Storage" }, pressing: false });
    expect(bestPick([{ ...list[0], fit: "later" }], pc, [])).toBeNull();
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
  it("leads with what matters, then the library, with recent sessions on request", async () => {
    await show("games");
    const list = await screen.findByRole("list", { name: "Games" });
    expect(screen.getByRole("region", { name: /safe limit|ran cool/ })).toBeTruthy();
    expect(within(list).getAllByRole("button").length).toBeGreaterThanOrEqual(2);

    expect(screen.queryByRole("list", { name: "Recent sessions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show recent sessions" }));
    const recent = screen.getByRole("list", { name: "Recent sessions" });
    const first = within(recent).getAllByRole("button")[0];
    const name = first.querySelector(".gm-recent-name")!.textContent!;
    fireEvent.click(first);
    expect(await screen.findByRole("heading", { level: 1, name })).toBeTruthy();
  });
});

describe("History", () => {
  it("shows each part's range and what happened, with more on request", async () => {
    await show("history");
    const ranges = (await screen.findByText("Lowest, typical and highest")).closest("section")!;
    expect(within(ranges).getByText("Processor")).toBeTruthy();
    expect(within(ranges).getByText("Graphics card")).toBeTruthy();
    expect(ranges.textContent).not.toMatch(/NaN|undefined/);

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    const events = await screen.findByRole("list", { name: "What happened" });
    const before = within(events).getAllByRole("listitem").length;
    fireEvent.click(screen.getByRole("button", { name: /^Show all \d+$/ }));
    expect(within(screen.getByRole("list", { name: "What happened" })).getAllByRole("listitem").length).toBeGreaterThan(before);
  });

  it("explains what will appear before there's any history", async () => {
    const client = new DemoClient();
    client.history = async () => [];
    await show("history", client);
    expect(await screen.findByText("Your history fills in as Rig runs")).toBeTruthy();
    expect(screen.queryByText("What happened")).toBeNull();
  });
});
