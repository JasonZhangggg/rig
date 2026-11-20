// The Logs screen and the recording card in chat, on the demo PCs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { LineChart } = await import("../src/chart");
const { highlights } = await import("../src/pages/logs/summary");
const { cleanEvents, eventTitle } = await import("@rig/core");
const { kindWord } = await import("../src/pages/logs/words");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

describe("Logs", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => cleanup());

  it("is in the sidebar, counts what went wrong and filters the events by a count", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    expect(screen.getByRole("link", { name: /Logs/ }).getAttribute("href")).toBe("#logs");
    await open("logs");
    const counts = await screen.findByRole("group", { name: "Show only" });
    const count = (name: RegExp) => within(counts).getByRole("button", { name });
    expect(count(/Driver resets/).textContent).toBe("2Driver resetsLast yesterday");
    expect(count(/Unexpected shutdown/).textContent).toMatch(/^1Unexpected shutdown/);
    expect(count(/Discord crash/).textContent).toMatch(/^1Discord crash/);
    expect(count(/Minor/).textContent).toMatch(/^3Minor/);
    expect(count(/All/).textContent).toMatch(/^7All/);
    expect(count(/All/).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Reading the event log…")).toBeNull();

    // Every event is listed straight away, one line each.
    const list = screen.getByRole("region", { name: /Events/ });
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(7);
    within(list).getByText("Discord.exe crashed");

    fireEvent.click(count(/Driver resets/));
    expect(count(/Driver resets/).getAttribute("aria-pressed")).toBe("true");
    expect(count(/All/).getAttribute("aria-pressed")).toBe("false");
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(2);
    expect(within(list).queryByText("Discord.exe crashed")).toBeNull();
    expect(screen.queryByRole("region", { name: "Graphics driver reset" })).toBeNull();

    fireEvent.click(count(/Minor/));
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(3);
    fireEvent.click(within(list).getByRole("button", { name: "Remove filter: Minor" }));
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(7);
    expect(count(/All/).getAttribute("aria-pressed")).toBe("true");
  });

  it("filters the events to a day from the strip, with what happened on hover", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    const strip = await screen.findByRole("group", { name: "Last 30 days" });
    const days = within(strip).getAllByRole("button");
    expect(days).toHaveLength(30);
    const day = within(strip).getByRole("button", { name: /1 event: The PC turned off without shutting down/ });

    fireEvent.mouseEnter(day);
    expect(within(strip).getByRole("tooltip").textContent).toMatch(/The PC turned off without shutting down/);
    fireEvent.mouseLeave(day);
    expect(within(strip).queryByRole("tooltip")).toBeNull();

    const list = screen.getByRole("region", { name: /Events/ });
    fireEvent.click(day);
    expect(day.getAttribute("aria-pressed")).toBe("true");
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(1);
    expect(within(list).queryByText("Discord.exe crashed")).toBeNull();
    const chip = within(list).getByRole("button", { name: /^Remove filter: / });
    fireEvent.click(day);
    expect(day.getAttribute("aria-pressed")).toBe("false");
    expect(chip.isConnected).toBe(false);
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(7);

    // A count and a day together.
    fireEvent.click(day);
    fireEvent.click(within(screen.getByRole("group", { name: "Show only" })).getByRole("button", { name: /Discord crash/ }));
    within(list).getByText(/None of these on/);
  });

  it("opens an event in place to what Windows wrote, and asks about it", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    const row = await screen.findByRole("button", { name: /Discord\.exe crashed/, expanded: false });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    const body = document.getElementById(row.getAttribute("aria-controls")!)!;
    expect(body.hasAttribute("inert")).toBe(true);
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(body.hasAttribute("inert")).toBe(false);
    within(body).getByText("Application Error · event 1000");
    within(body).getByText(/discord_voice\.node/);
    fireEvent.click(within(body).getByRole("button", { name: "Ask about this event" }));
    await waitFor(() => expect(location.hash).toBe("#chat"));
    await screen.findByText(/Windows logged "Discord\.exe crashed" on Atlas/);
  });

  it("shows a finished recording as what it found, and opens it from the events it caught", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    const recs = await screen.findByRole("region", { name: "Recordings" });
    const row = within(recs).getByRole("button", { name: /Watch temperatures, load and Windows events while you play/ });
    expect(row.textContent).toMatch(/Found: The graphics driver stopped and recovered/);
    expect(row.textContent).toMatch(/Finished/);
    fireEvent.click(row);
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
    screen.getByRole("img", { name: "Usage during the recording" });
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
    await screen.findByText(/Windows logged no problems on Pebble in the last 30 days/);
    screen.getByText(/No recordings yet/);
    expect(screen.queryByRole("group", { name: "Show only" })).toBeNull();
    expect(screen.queryByRole("region", { name: /Events/ })).toBeNull();
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

  it("groups repeats and names each group for its count", () => {
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
    expect(groups.map((g) => [g.title, g.short, g.events.length])).toEqual([["Windows crashed (blue screen)", "Blue screen", 1], ["game crashed", "game crashes", 3]]);
    expect(highlights(events.slice(4), "Box")).toEqual([]);
  });

  it("keeps updates and installs out of what went wrong, but names them", () => {
    const [install] = cleanEvents([{ t: Date.now(), log: "System", source: "Microsoft-Windows-UserPnp", id: 20001, level: "info", message: "Driver Management concluded the process to install driver nv_dispig.inf_amd64_1\\nv_dispig.inf for Device Instance ID PCI\\VEN_10DE with the following status: 0x0." }]);
    expect(highlights([install], "Box")).toEqual([]);
    expect(eventTitle(install)).toBe("Installed the NVIDIA graphics driver");
    expect(kindWord(install.kind)).toBe("Update or install");
  });
});
