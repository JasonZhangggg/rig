// The Logs screen and the recording card in chat, on the demo PCs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { LineChart } = await import("../src/chart");
const { highlights, summaryLine } = await import("../src/pages/logs/summary");
const { cleanEvents } = await import("@rig/core");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

describe("Logs", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => cleanup());

  it("is in the sidebar under Help, leads with a summary and the events that matter, and keeps every event behind All events", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    expect(screen.getByRole("link", { name: /Logs/ }).getAttribute("href")).toBe("#logs");
    await open("logs");
    const summary = await screen.findByRole("region", { name: "Summary" });
    await waitFor(() => expect(summary.textContent).toMatch(/In the last 30 days, the graphics driver reset twice, Atlas shut off unexpectedly once and Discord crashed once\./));
    expect(summary.textContent).toMatch(/3 minor things/);

    const worth = screen.getByRole("region", { name: "Worth knowing" });
    const items = within(worth).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/Graphics driver reset/);
    expect(items[0].textContent).toMatch(/2 times, last/);
    within(worth).getByText("Atlas turned off without shutting down");
    within(worth).getByText("Discord crashed");
    expect(worth.textContent).not.toMatch(/event 4101|nvlddmkm|0xc0000005/);

    expect(screen.queryByText("Discord.exe crashed")).toBeNull();
    const toggle = screen.getByRole("button", { name: /All events/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    screen.getByText("Discord.exe crashed");
    screen.getByText("Application Error · event 1000");
    fireEvent.click(within(screen.getByRole("group", { name: "Kind of event" })).getByRole("button", { name: /Shutdowns/ }));
    expect(screen.queryByText("Discord.exe crashed")).toBeNull();
    screen.getByText("The PC turned off without shutting down");
  });

  it("shows a finished recording as what it found, and opens it from the event it caught", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    const recs = await screen.findByRole("region", { name: "Recordings" });
    const row = within(recs).getByRole("button", { name: /Watch temperatures, load and Windows events while you play/ });
    expect(row.textContent).toMatch(/Found: The graphics driver stopped and recovered/);
    expect(row.textContent).toMatch(/Finished/);
    fireEvent.click(await screen.findByRole("button", { name: /A recording caught this/ }));
    await screen.findByText("What Rig found");
  });

  it("opens a recording with what Rig found, its charts and Ask about this", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    fireEvent.click(await screen.findByRole("button", { name: /Watch temperatures, load and Windows events while you play/ }));
    await screen.findByText("What Rig found");
    expect((await screen.findAllByText(/Graphics card ran hot for \d+ minutes/)).length).toBeGreaterThan(0);
    screen.getByText(/Graphics card load fell from/);
    screen.getByRole("img", { name: "Temperatures during the recording" });
    screen.getByRole("img", { name: "Load during the recording" });
    expect(screen.queryByText("Cyberpunk2077.exe", { selector: "td" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Readings, apps and Windows events" }));
    screen.getByText("Cyberpunk2077.exe", { selector: "td" });
    screen.getByText("Windows events during the recording");

    fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    await waitFor(() => expect(location.hash).toBe("#chat"));
    await screen.findByText(/Found it\. At/, undefined, { timeout: 8000 });
  }, 12000);

  it("shows the conversation that started the recording, and lets you start and stop one", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("chat");
    await screen.findByText(/My screen went black/);
    screen.getByText("Recording finished");
    screen.getByRole("button", { name: "See what Rig found" });

    await open("logs");
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    await screen.findByText("Recording now");
    await screen.findByText(/Ends at/);
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.queryByText("Recording now")).toBeNull());
    await screen.findByRole("button", { name: "Start recording" });
  });

  it("says plainly when a PC has no events and no recordings", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    await screen.findByText(/Nothing went wrong on Pebble in the last 30 days/);
    screen.getByText(/No recordings yet/);
    expect(screen.queryByRole("region", { name: "Worth knowing" })).toBeNull();
    expect(screen.queryByRole("button", { name: /All events/ })).toBeNull();
    screen.getByRole("button", { name: "Start recording" });
  });

  it("shows a recording in °F when that's the unit picked", async () => {
    localStorage.setItem("rig.tempUnit", "f");
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    fireEvent.click(await screen.findByRole("button", { name: /Watch temperatures, load and Windows events while you play/ }));
    const found = await screen.findByText("What Rig found");
    const page = found.closest(".page")!;
    await waitFor(() => expect(page.textContent).toMatch(/\d+°F/));
    expect(page.textContent).not.toMatch(/°C/);
    expect(screen.getByRole("img", { name: "Temperatures during the recording" }).textContent).toMatch(/°F limit/);
  });

  it("finds the Logs screen and a recording from the search palette", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = await screen.findByRole("textbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "crashes" } });
    screen.getByRole("button", { name: /^Logs Windows errors/ });
    fireEvent.change(search, { target: { value: "while you play" } });
    fireEvent.click(await screen.findByRole("button", { name: /Watch temperatures, load and Windows events while you play/ }));
    await waitFor(() => expect(location.hash).toBe("#logs"));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByText("What Rig found");
  });

  it("labels the start and end of a chart with only a few readings", () => {
    const t0 = new Date(2026, 10, 17, 21, 0, 3).getTime();
    const points = [0, 2000, 4000].map((d, i) => ({ t: t0 + d, cpu: 60 + i, gpu: null, busy: false }));
    render(<LineChart points={points} series={[{ key: "cpu", cls: "gpu" }]} label="Short" />);
    const ticks = [...screen.getByRole("img", { name: "Short" }).querySelectorAll("text.chart-tick")].map((t) => t.textContent ?? "");
    const times = ticks.filter((x) => /\d:\d\d/.test(x));
    expect(times).toHaveLength(2);
    expect(times[0]).not.toBe(times[1]);
  });

  it("groups repeats and words the summary from the events alone", () => {
    const t = Date.now();
    const ev = (n: number, source: string, id: number, level: "critical" | "error" | "warning", message = "") => ({ t: t - n * 36e5, log: "System" as const, source, id, level, message });
    const events = cleanEvents([
      ev(1, "Application Error", 1000, "error", "Faulting application name: game.exe, version: 1"),
      ev(2, "Application Error", 1000, "error", "Faulting application name: game.exe, version: 1"),
      ev(3, "Application Error", 1000, "error", "Faulting application name: game.exe, version: 1"),
      ev(4, "Microsoft-Windows-WER-SystemErrorReporting", 1001, "error"),
      ev(5, "Microsoft-Windows-WHEA-Logger", 19, "warning"),
    ]);
    const groups = highlights(events, "Box");
    expect(groups.map((g) => [g.title, g.events.length])).toEqual([["Windows crashed (blue screen)", 1], ["game crashed", 3]]);
    expect(summaryLine(events, "Box")).toEqual({ main: "In the last 30 days, Windows crashed once and game crashed 3 times.", rest: "Windows also noted 1 minor thing." });
    expect(summaryLine(events.slice(4), "Box").main).toBe("Nothing serious happened on Box in the last 30 days.");
  });
});
