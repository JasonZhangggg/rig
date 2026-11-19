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
  const rail = () => within(screen.getByRole("navigation", { name: "Kinds of part" }));
  const row = (name: RegExp) => screen.getAllByRole("button", { name })[0].closest("li")!;

  it("is a tab of My PC that leads with Rig's pick and opens the parts for it", async () => {
    await show("upgrades");
    expect(await screen.findByRole("heading", { level: 1, name: "Atlas" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrades" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText("Another case fan")).toBeTruthy();
    expect(screen.getByText(/Graphics card runs hotter than it used to/)).toBeTruthy();
    // A free fix comes before anything to buy.
    expect(screen.getByText(/runs at 60 Hz but can do 165 Hz/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show parts that fit" }));
    expect(screen.getByRole("heading", { level: 2, name: "Case fans" })).toBeTruthy();
  });

  it("checks memory against Atlas: same kit fits, the wrong type is hidden until asked for", async () => {
    await show("upgrades");
    fireEvent.click(await rail().findByRole("button", { name: /Memory/ }));
    expect(screen.getByText("Atlas has 2 × 16 GB DDR5 at 6000 MT/s. 2 of 4 slots free.")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/Demo prices/);
    const kit = row(/Corsair Vengeance 32 GB/);
    expect(within(kit).getByText("Fits")).toBeTruthy();
    expect(within(kit).getByText("64 GB in all, up from 32 GB")).toBeTruthy();
    expect(screen.queryByText(/Kingston Fury Beast/)).toBeNull();

    fireEvent.click(within(kit).getByRole("button", { expanded: false }));
    expect(within(kit).getByText("Same kit as yours, into the 2 free slots.")).toBeTruthy();
    expect(within(kit).getByText(/Four sticks of DDR5 often run slower/)).toBeTruthy();
    expect(within(kit).getByRole("img", { name: /Lowest price over 12 weeks \(demo\)/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show 2 that won't fit" }));
    expect(within(row(/Kingston Fury Beast/)).getByText("Won't fit")).toBeTruthy();
  });

  it("builds a list with a total and the power it needs", async () => {
    await show("upgrades");
    fireEvent.click(await rail().findByRole("button", { name: /Memory/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Corsair Vengeance 32 GB (2 × 16 GB) to your list" }));
    fireEvent.click(rail().getByRole("button", { name: /Graphics card/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add NVIDIA GeForce RTX 5080 to your list" }));
    const list = rail().getByRole("button", { name: /Your list/ });
    expect(list.textContent).toMatch(/2 parts, \$1,103/);
    fireEvent.click(list);
    expect(screen.getByRole("heading", { level: 2, name: "Your list" })).toBeTruthy();
    expect(screen.getByText("$1,103")).toBeTruthy();
    expect(screen.getByText(/About 555 W at full load\. Tell Rig your power supply's wattage/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove NVIDIA GeForce RTX 5080" }));
    expect(list.textContent).toMatch(/1 part, \$104/);
  });

  it("searches a kind of part, filters by maker and points to matches in other kinds", async () => {
    await show("upgrades");
    fireEvent.click(await rail().findByRole("button", { name: /Memory/ }));
    const list = () => within(screen.getByRole("list", { name: /Memory that could go in Atlas/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search memory" }), { target: { value: "64gb" } });
    expect(list().getAllByRole("listitem")).toHaveLength(1);
    expect(list().getByText("Corsair Vengeance 64 GB (2 × 32 GB)")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search memory" }), { target: { value: "" } });
    const makers = within(screen.getByRole("group", { name: "Maker" }));
    fireEvent.click(makers.getByRole("button", { name: /G\.Skill/ }));
    expect(makers.getByRole("button", { name: /G\.Skill/ }).getAttribute("aria-pressed")).toBe("true");
    expect(list().getAllByRole("listitem").every((li) => /G\.Skill/.test(li.textContent ?? ""))).toBe(true);

    // A search kept across kinds: "2 TB" matches drives, so the hint opens Storage with the search in place.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search memory" }), { target: { value: "2 tb" } });
    expect(screen.getByText('No memory matches "2 tb".')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Storage \(\d\)/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Storage" })).toBeTruthy();
    expect((screen.getByRole("searchbox", { name: "Search storage" }) as HTMLInputElement).value).toBe("2 tb");
  });

  it("adds a part Rig doesn't list to the list, marked as not checked", async () => {
    await show("upgrades");
    fireEvent.click(await rail().findByRole("button", { name: /Storage/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search storage" }), { target: { value: "Optane 905P" } });
    fireEvent.click(screen.getByRole("button", { name: 'Add "Optane 905P" to your list anyway' }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Optane 905P");
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "$250" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to your list" }));
    const listBtn = rail().getByRole("button", { name: /Your list/ });
    expect(listBtn.textContent).toMatch(/1 part, \$250/);
    fireEvent.click(listBtn);
    const mine = within(screen.getByRole("list", { name: "Your list" }));
    expect(mine.getByText("Not checked")).toBeTruthy();
    expect(mine.getByText(/hasn't checked it/)).toBeTruthy();
    fireEvent.click(mine.getByRole("button", { name: "Remove Optane 905P" }));
    expect(listBtn.textContent).toMatch(/Nothing yet/);
  });

  it("shows where a photo goes and says the demo has none", async () => {
    await show("upgrades");
    fireEvent.click(await rail().findByRole("button", { name: /Memory/ }));
    const kit = row(/Corsair Vengeance 32 GB/);
    expect(kit.querySelector(".shop-photo svg")).toBeTruthy();
    expect(kit.querySelector("img")).toBeNull();
    fireEvent.click(within(kit).getByRole("button", { expanded: false }));
    expect(within(kit).getByText("No photo yet. Photos come with a real shop feed.")).toBeTruthy();
  });

  it("checks a graphics card against the power supply once it knows the wattage", async () => {
    await show("upgrades");
    fireEvent.click(await rail().findByRole("button", { name: /Graphics card/ }));
    const chip = () => within(row(/RTX 5080/)).getByText(/Fits|Check first|Won't fit/).textContent;
    expect(chip()).toBe("Check first");
    fireEvent.change(screen.getByLabelText(/What wattage is yours/), { target: { value: "850" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Your power supply:/).textContent).toMatch(/850 W/);
    expect(chip()).toBe("Fits");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText(/What wattage is yours/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: /Show \d+ that won't fit/ }));
    expect(chip()).toBe("Won't fit");
  });

  it("on a laptop, offers only what can change", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    await show("upgrades");
    expect(await rail().findByRole("button", { name: /Storage/ })).toBeTruthy();
    expect(rail().queryByRole("button", { name: /Memory/ })).toBeNull();
    expect(screen.getByText("Built into Pebble's board, so not upgradable: memory, graphics and processor.")).toBeTruthy();
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

  it("says so before Rig has read the parts", async () => {
    const client = new DemoClient();
    client.shop = async () => null;
    await show("upgrades", client);
    expect(await screen.findByText("Rig hasn't read Atlas's parts yet. Parts that fit show up once it has.")).toBeTruthy();
  });

  it("opens a part's Upgrade tab, then the parts that fit it", async () => {
    await show("pc");
    fireEvent.click(await screen.findByRole("button", { name: /Storage/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Upgrade" }));
    expect(screen.getByText(/726 GB free/)).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "See parts that fit" }));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(await screen.findByRole("heading", { level: 2, name: "Storage" })).toBeTruthy();
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

    const events = screen.getByRole("list", { name: "Busy times" });
    const row = within(events).getAllByRole("button", { pressed: false })[0];
    fireEvent.click(row);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(readout()).toMatch(/Processor \d+°C, Graphics card \d+°C/);

    fireEvent.click(screen.getByRole("button", { name: "Ranges" }));
    expect(screen.queryByRole("list", { name: "Busy times" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Busy times" }));
    const month = await screen.findByRole("list", { name: "Busy times" });
    const before = within(month).getAllByRole("listitem").length;
    fireEvent.click(screen.getByRole("button", { name: /^Show all \d+$/ }));
    expect(within(screen.getByRole("list", { name: "Busy times" })).getAllByRole("listitem").length).toBeGreaterThan(before);
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
    expect(screen.queryByText("Busy times")).toBeNull();
  });
});

describe("My PC", () => {
  it("sums up the parts in a sentence and opens a part's details from the list", async () => {
    await show("pc");
    const list = await screen.findByRole("list", { name: "Parts" });
    expect(screen.getByRole("heading", { level: 1, name: "Atlas" })).toBeTruthy();
    expect(screen.getByText("Nothing is running hot right now.")).toBeTruthy();
    expect(within(list).getAllByRole("button")).toHaveLength(8);
    fireEvent.click(within(list).getByRole("button", { name: /NVIDIA GeForce RTX 4070 SUPER/ }));
    expect(await screen.findByRole("heading", { name: "NVIDIA GeForce RTX 4070 SUPER" })).toBeTruthy();
    expect(screen.getByText("Temperature")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Specs" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("region", { name: "Upgrades" })).toBeNull();
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
