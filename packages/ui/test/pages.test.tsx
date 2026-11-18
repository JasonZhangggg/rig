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
  it("lists the fixes waiting for review above the timeline with its counts", async () => {
    await show("changes");
    const waiting = await screen.findByRole("region", { name: /^Waiting for review/ });
    expect(within(waiting).getByText(/runs at 60 Hz but can do 165 Hz/)).toBeTruthy();
    expect(within(waiting).queryByText("60 Hz")).toBeNull();
    fireEvent.click(within(waiting).getAllByRole("button", { name: /^Details:/ })[0]);
    await within(waiting).findByText("60 Hz");

    const counts = screen.getByRole("group", { name: "Show only" });
    expect(within(counts).getByRole("button", { name: /In place/ }).textContent).toBe("1In place");
    expect(within(counts).queryByRole("button", { name: /Undone/ })).toBeNull();

    const day = screen.getByRole("region", { name: dayLabel(new Date(Date.now() - 5 * 864e5).toISOString()) });
    expect(within(day).getByText("Turned off NVIDIA Broadcast at startup")).toBeTruthy();
    expect(within(day).queryByText("Starts with Windows")).toBeNull();
    fireEvent.click(within(day).getByRole("button", { name: "Details: Turned off NVIDIA Broadcast at startup" }));
    expect(within(day).getByText("Starts with Windows")).toBeTruthy();

    fireEvent.click(within(waiting).getAllByRole("button", { name: /^Review:/ })[0]);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("starts with the timeline when nothing waits for review", async () => {
    const client = new DemoClient();
    const watch = client.watch.bind(client);
    client.watch = (id, cb) => watch(id, (pc) => cb({ ...pc, issues: (pc.issues ?? []).filter((i) => !i.fix?.length) }));
    await show("changes", client);
    await screen.findByRole("heading", { name: "Recent changes" });
    expect(screen.queryByRole("region", { name: /^Waiting for review/ })).toBeNull();
  });

  it("filters the list from the counts", async () => {
    await show("changes");
    const day = await screen.findByRole("region", { name: dayLabel(new Date(Date.now() - 5 * 864e5).toISOString()) });
    fireEvent.click(within(day).getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "Redo" })).toBeTruthy();
    const counts = screen.getByRole("group", { name: "Show only" });
    fireEvent.click(within(counts).getByRole("button", { name: /Undone/ }));
    expect(screen.getByRole("heading", { name: "Undone" })).toBeTruthy();
    fireEvent.click(within(counts).getByRole("button", { name: /All/ }));
    expect(screen.getByRole("heading", { name: "Recent changes" })).toBeTruthy();
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
  it("sits on My PC: Rig's pick and the other ideas, each opening its part at an Upgrade tab", async () => {
    await show("pc");
    const card = await screen.findByRole("region", { name: "Upgrades" });
    const pick = await within(card).findByRole("button", { name: /Rig's pick.*Another case fan/ });
    expect(within(pick).getByText(/Graphics card runs hotter than it used to/)).toBeTruthy();
    const others = within(card).getByRole("list", { name: "Other ideas" });
    expect(within(others).getByText("Add another NVMe SSD")).toBeTruthy();

    fireEvent.click(within(others).getByRole("button", { name: /Add another NVMe SSD/ }));
    expect(screen.getByRole("tab", { name: "Upgrade" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/726 GB free/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask what to buy" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /All parts/ }));
    fireEvent.click(within(screen.getByRole("list", { name: "Other ideas" })).getByRole("button", { name: /16 GB/ }));
    expect(screen.getByRole("img", { name: "2 of 4 slots used" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Memory slot order in your manual, p\. 7/ })).toBeTruthy();
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

  it("says so when there's nothing to suggest, and offers to ask", async () => {
    const client = new DemoClient();
    client.upgrades = async () => [];
    await show("pc", client);
    const card = await screen.findByRole("region", { name: "Upgrades" });
    expect(await within(card).findByText("Nothing to suggest for Atlas right now.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Have a part in mind? Ask if it fits" })).toBeTruthy();
  });
});

describe("Games", () => {
  it("leads with the library, with recent sessions on request", async () => {
    await show("games");
    const list = await screen.findByRole("list", { name: "Games" });
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
  const readout = () => screen.getByRole("img", { name: "Temperature history" }).parentElement!.querySelector("[aria-live]")!.textContent!;

  it("leads with the figures and the chart, then shows what happened and each part's range, each pinning the chart", async () => {
    await show("history");
    const figures = await screen.findByRole("group", { name: "Key figures" });
    expect(readout()).toBe("");

    const hottest = within(figures).getByRole("button", { name: /^Hottest moment/ });
    expect(hottest.textContent).toMatch(/(under|over|at) the limit/);
    fireEvent.click(hottest);
    expect(hottest.getAttribute("aria-pressed")).toBe("true");
    expect(readout()).toContain(hottest.querySelector(".fig-n")!.textContent!);
    fireEvent.click(hottest);
    expect(readout()).toBe("");

    const events = screen.getByRole("list", { name: "What happened" });
    const row = within(events).getAllByRole("button", { pressed: false })[0];
    fireEvent.click(row);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(readout()).toMatch(/Processor \d+°C, Graphics card \d+°C/);

    fireEvent.click(screen.getByRole("button", { name: "Ranges" }));
    expect(screen.queryByRole("list", { name: "What happened" })).toBeNull();
    const ranges = screen.getByRole("region", { name: "Lowest, typical and highest" });
    expect(within(ranges).getByText("Processor")).toBeTruthy();
    expect(within(ranges).getByText("Graphics card")).toBeTruthy();
    expect(ranges.textContent).not.toMatch(/NaN|undefined/);
    const high = within(ranges).getByRole("button", { name: /^Graphics card highest/ });
    fireEvent.click(high);
    expect(readout()).toContain(`Graphics card ${high.textContent}`);

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByRole("img", { name: "Temperature history" });
    expect(readout()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "What happened" }));
    const month = await screen.findByRole("list", { name: "What happened" });
    const before = within(month).getAllByRole("listitem").length;
    fireEvent.click(screen.getByRole("button", { name: /^Show all \d+$/ }));
    expect(within(screen.getByRole("list", { name: "What happened" })).getAllByRole("listitem").length).toBeGreaterThan(before);
  });

  it("says what was running at the hottest moment", async () => {
    const client = new DemoClient();
    const t = Date.now();
    client.history = async () => Array.from({ length: 60 }, (_, i) => ({ t: t - (60 - i) * 6e4, cpu: 40 + (i === 30 ? 12 : 0), gpu: 38, busy: false, game: null }));
    await show("history", client);
    const figures = await screen.findByRole("group", { name: "Key figures" });
    expect(within(figures).getByRole("button", { name: /^Hottest moment/ }).textContent).toMatch(/while nothing heavy was running\./);
    expect(screen.queryByRole("button", { name: /when busy/ })).toBeNull();
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
    expect(partsSummary([hot], "Desk PC", true)).toBe("Graphics card has a warning. Open it for details.");
    expect(partsSummary([{ ...hot, limit: 88 }], "Desk PC", true)).toBe("Graphics card is at 90°C, 2° over its 88°C limit.");
  });
});
