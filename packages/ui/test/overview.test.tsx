// The home charts on a PC with little or no history: calm words instead of
// broken charts, and gaps instead of zeros.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fanTrend, insightContext, weekTemps, type HistoryPoint } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { FansCard } from "../src/pages/overview/FansCard";
import { TempsCard } from "../src/pages/overview/TempsCard";

const sceneCalls = vi.hoisted(() => [] as [string, unknown[]][]);
vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: (_, k) => (...a: unknown[]) => { sceneCalls.push([String(k), a]); } }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

describe("Home charts", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("says Rig is still learning on a PC with no history yet", async () => {
    const client = new DemoClient();
    client.history = async () => [];
    render(<RigApp client={client} />);
    expect(await screen.findAllByText(/Rig is still learning this week/)).toHaveLength(2);
    expect(screen.getByText(/still learning how fast the fans run/)).toBeTruthy();
    expect(screen.queryByRole("img", { name: /°C/ })).toBeNull();
    expect(screen.queryByText("Hottest")).toBeNull();
    expect(screen.queryByText("In all")).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it("leads each chart of the week with its headline number", async () => {
    render(<RigApp client={new DemoClient()} />);
    const week = within((await screen.findByRole("heading", { name: "This week" })).closest("section")!);
    const hottest = (await week.findByText("Hottest")).parentElement!;
    expect(hottest.textContent).toMatch(/^\d+°CHottest$/);
    expect((await week.findByText("In all")).parentElement!.textContent).toMatch(/^[\d.,]+ hIn all$/);
    expect(week.getByRole("heading", { name: "Temperatures" })).toBeTruthy();
    expect(week.getByRole("heading", { name: "Evenings" })).toBeTruthy();
  });

  it("leaves days without readings empty rather than at zero", () => {
    const now = Date.now();
    const points: HistoryPoint[] = [{ t: now - 60_000, cpu: 44, gpu: null, busy: false }];
    const ctx = insightContext({ kind: "tower" }, now);
    render(<TempsCard temps={weekTemps(points, ctx)} name="Atlas" />);
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")!.match(/no readings/g)).toHaveLength(6);
    expect(chart.textContent).not.toMatch(/\b0\b|NaN/);
  });

  it("hides the fan speeds on a PC that reports none", () => {
    const ctx = insightContext({ kind: "laptop" });
    const { container } = render(<FansCard fans={[]} trend={fanTrend([], ctx)} />);
    expect(screen.getByText(/doesn't report fan speeds/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe("Home hero", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; sceneCalls.length = 0; });
  afterEach(() => cleanup());
  const last = (method: string) => sceneCalls.filter(([k]) => k === method).at(-1)?.[1][0];

  it("names the main parts beside the 3D PC", async () => {
    render(<RigApp client={new DemoClient()} />);
    const hero = (await screen.findByRole("link", { name: "Open 3D view" })).closest("section")!;
    const specs = within(hero).getByText("Processor", { selector: "dt" }).closest("dl")!;
    expect(within(specs).getAllByRole("term").map((t) => t.textContent)).toEqual(["Processor", "Graphics card", "Memory"]);
    expect(within(specs).getByText(/Ryzen/)).toBeTruthy();
  });

  it("turns heat and the exploded view on in the hero, and puts the scene back on leaving", async () => {
    render(<RigApp client={new DemoClient()} />);
    const heat = await screen.findByRole("button", { name: "Heat" });
    const exploded = screen.getByRole("button", { name: "Exploded" });
    expect(heat.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(heat);
    fireEvent.click(exploded);
    expect(heat.getAttribute("aria-pressed")).toBe("true");
    expect(exploded.getAttribute("aria-pressed")).toBe("true");
    expect(last("setHeat")).toBe(true);
    expect(last("setExploded")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Processor/ }));
    expect(await screen.findByRole("button", { name: "Reset view" })).toBeTruthy();
    expect(last("setHeat")).toBe(false);
    expect(last("setExploded")).toBe(false);
  });

  it("asks Rig a suggested question from Things to look at", async () => {
    render(<RigApp client={new DemoClient()} />);
    const todo = within((await screen.findByText("Things to look at")).closest("section")!);
    fireEvent.click(todo.getByRole("button", { name: "What should I upgrade first?" }));
    await waitFor(() => expect(screen.queryByText("Things to look at")).toBeNull());
    expect(screen.getAllByText("What should I upgrade first?").length).toBeGreaterThan(0);
  });

  it("reads out each part's temperature now, against its limit when the maker gives one", async () => {
    render(<RigApp client={new DemoClient()} />);
    const now = within(await screen.findByRole("group", { name: "Temperatures now" }));
    expect(now.getByRole("button", { name: /^Processor \d+°C, limit \d+°$/ })).toBeTruthy();
    expect(now.getByRole("button", { name: /^Storage \d+°C, high today \d+°$/ })).toBeTruthy();
    const health = within(screen.getByRole("heading", { name: "Health" }).closest("section")!);
    expect(health.getByText("/100").parentElement!.textContent).toMatch(/^\d+\/100$/);
  });

  it("says what will show when a PC reports no temperatures yet", async () => {
    const client = new DemoClient();
    const watch = client.watch.bind(client);
    client.watch = (id, cb) => watch(id, (pc) => cb({ ...pc, parts: Object.fromEntries(Object.entries(pc.parts ?? {}).map(([k, p]) => [k, { ...p, temp: undefined }])) }));
    render(<RigApp client={client} />);
    const now = within(await screen.findByRole("group", { name: "Temperatures now" }));
    expect(now.getByText(/Temperatures show up here as soon as Rig reads/)).toBeTruthy();
    expect(now.queryByRole("button")).toBeNull();
  });

  it("says there's nothing to look at on a PC without issues", async () => {
    const client = new DemoClient();
    const watch = client.watch.bind(client);
    client.watch = (id, cb) => watch(id, (pc) => cb({ ...pc, alerts: [], issues: [], cleanedAt: undefined }));
    render(<RigApp client={client} />);
    const todo = within((await screen.findByText("Things to look at")).closest("section")!);
    expect(await todo.findByText(/Nothing to look at\. Rig keeps watching while you use/)).toBeTruthy();
    expect(todo.queryByRole("list")).toBeNull();
    expect(todo.getByRole("button", { name: "Run a checkup" })).toBeTruthy();
  });
});
