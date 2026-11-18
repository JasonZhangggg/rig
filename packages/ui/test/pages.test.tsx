// Changes, Upgrades, Games, History and My PC: what each leads with, what waits behind a button,
// and what each says when there's little or nothing to show yet.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PC, Upgrade } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
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
    const pick = await screen.findByRole("region", { name: "Another case fan" });
    expect(within(pick).getByText("Rig's pick for Atlas")).toBeTruthy();
    expect(within(pick).getByText(/Graphics card runs hotter than it used to/)).toBeTruthy();

    const others = screen.getByRole("region", { name: "Other ideas" });
    expect(within(others).getByRole("img", { name: "2 of 4 slots used" })).toBeTruthy();
    expect(within(others).getByText("Add another NVMe SSD")).toBeTruthy();
    expect(within(others).getByText(/726 GB free/)).toBeTruthy();
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
    const alert = { ...pc.issues![0], id: "gpu-hotter", title: "Graphics card runs hotter than it used to" };
    expect(bestPick(list, { ...pc, issues: [], alerts: [alert] } as unknown as PC, [])).toMatchObject({ idea: { part: "Cooling" }, why: "Graphics card runs hotter than it used to.", pressing: true });
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

describe("My PC", () => {
  it("sums up the parts in a sentence and opens a part's details from the list", async () => {
    await show("pc");
    const list = await screen.findByRole("list", { name: "Parts" });
    expect(screen.getByText("Nothing is running hot right now.")).toBeTruthy();
    expect(within(list).getAllByRole("button")).toHaveLength(8);
    fireEvent.click(within(list).getByRole("button", { name: /NVIDIA GeForce RTX 4070 SUPER/ }));
    expect(await screen.findByRole("heading", { name: "NVIDIA GeForce RTX 4070 SUPER" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Live" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "All parts" }));
    expect(await screen.findByRole("list", { name: "Parts" })).toBeTruthy();
  });

  it("says what will appear when Rig hasn't read a PC's parts yet", async () => {
    const { partsSummary } = await import("../src/pages/PCPage");
    expect(partsSummary([], "Desk PC", true)).toBe("Rig hasn't read Desk PC's parts yet. They show up here once the Rig app on Desk PC sends its first reading.");
    const hot = { type: "Graphics card", name: "RTX", warn: true, temp: 90, specs: [], manual: [], modelSource: "generic" as const };
    expect(partsSummary([hot], "Desk PC", true)).toBe("Your graphics card needs a look.");
  });
});
