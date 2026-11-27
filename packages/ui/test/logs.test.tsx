// The Logs screen and the recording card in chat, on the demo PCs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import type { RecordingInfo } from "@rig/core";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { LineChart } = await import("../src/chart");
const { highlights } = await import("../src/pages/logs/summary");
const { cleanEvents, eventTitle } = await import("@rig/core");
const { kindWord } = await import("../src/pages/logs/words");
const { Lanes, AllSensors } = await import("../src/pages/logs/Lanes");

// jsdom has no PointerEvent; the strip's tip shows only for a mouse, so the test needs one that carries pointerType.
if (typeof window.PointerEvent === "undefined") {
  class PointerEvent extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? ""; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEvent;
}

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
    const tabs = await screen.findByRole("navigation", { name: "Logs" });
    expect(within(tabs).getAllByRole("link").map((a) => a.textContent)).toEqual(["Readings", "Events"]);
    fireEvent.click(within(tabs).getByRole("link", { name: "Events" }));
    await open("events");
    const counts = await screen.findByRole("group", { name: "Show only" });
    const count = (name: RegExp) => within(counts).getByRole("button", { name });
    expect(count(/Driver resets/).textContent).toBe("2Driver resetsLast yesterday");
    expect(count(/Unexpected shutdown/).textContent).toMatch(/^1Unexpected shutdown/);
    expect(count(/Discord crash/).textContent).toMatch(/^1Discord crash/);
    expect(count(/Minor/).textContent).toMatch(/^3Minor/);
    expect(screen.queryByText("Reading the logs…")).toBeNull();

    // Every event is listed straight away, one line each, with everything else that happened.
    const list = screen.getByRole("region", { name: "Log" });
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(7);
    within(list).getByText("Discord.exe crashed");

    fireEvent.click(count(/Driver resets/));
    expect(count(/Driver resets/).getAttribute("aria-pressed")).toBe("true");
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(2);
    expect(within(list).queryByText("Discord.exe crashed")).toBeNull();
    expect(screen.queryByRole("region", { name: "Graphics driver reset" })).toBeNull();

    fireEvent.click(count(/Minor/));
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(3);
    fireEvent.click(within(list).getByRole("button", { name: "Remove filter: Minor" }));
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(7);
    expect(count(/Minor/).getAttribute("aria-pressed")).toBe("false");
  });

  it("filters the events to a day from the strip, with what happened on hover", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("events");
    const strip = await screen.findByRole("group", { name: "Last 30 days" });
    const days = within(strip).getAllByRole("button");
    expect(days).toHaveLength(30);
    const day = within(strip).getByRole("button", { name: /1 entry: The PC turned off without shutting down/ });

    fireEvent.pointerEnter(day, { pointerType: "mouse" });
    expect(within(strip).getByRole("tooltip").textContent).toMatch(/The PC turned off without shutting down/);
    fireEvent.pointerLeave(day, { pointerType: "mouse" });
    expect(within(strip).queryByRole("tooltip")).toBeNull();

    const list = screen.getByRole("region", { name: "Log" });
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
    within(list).getByText(/^Nothing here on /);
  });

  it("shows each event as a row with its time and kind, opens what Windows wrote under Details, and asks about it", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("events");
    const details = await screen.findByRole("button", { name: "Details: Discord.exe crashed", expanded: false });
    const row = details.closest("li")!;
    within(row).getByText("Crash, logged by Application Error.");
    const body = document.getElementById(details.getAttribute("aria-controls")!)!;
    expect(body.hidden).toBe(true);
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(details.textContent).toBe("Hide");
    expect(body.hidden).toBe(false);
    within(body).getByText("Application Error · event 1000");
    within(body).getByText(/discord_voice\.node/);
    fireEvent.click(within(row).getByRole("button", { name: /^Ask/ }));
    await waitFor(() => expect(location.hash).toBe("#chat"));
    await screen.findByText(/Windows logged "Discord\.exe crashed" on Atlas/);
  });

  it("groups events by day, with how many on each", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("events");
    const list = await screen.findByRole("region", { name: "Log" });
    await within(list).findAllByText("The graphics driver stopped and recovered");
    const days = within(list).getAllByRole("region");
    expect(days.length).toBeGreaterThan(1);
    for (const d of days) {
      const n = within(d).getAllByRole("listitem").length;
      within(d).getByText(n === 1 ? "1 entry" : `${n} entries`);
    }
  });

  it("shows a finished recording as what it found, and opens it from the events it caught", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("recorded");
    const recs = await screen.findByRole("region", { name: "Recordings" });
    const row = within(recs).getByRole("button", { name: /Watch temperatures, load and Windows events while you play/ });
    expect(row.textContent).toMatch(/Found: The graphics driver stopped and recovered/);
    expect(row.textContent).toMatch(/Finished/);
    fireEvent.click(row);
    await screen.findByText("Heat most likely set it off");
  });

  it("leads a recording that caught the black screen with its most likely cause, what it ruled out and what to do", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("recorded");
    fireEvent.click(await screen.findByRole("button", { name: /Watch temperatures, load and Windows events while you play/ }));
    await screen.findByRole("heading", { level: 1, name: "The black screen, caught" });
    const lead = await screen.findByRole("region", { name: "Heat most likely set it off" });
    expect(lead.textContent).toMatch(/The graphics card had been above your normal for Cyberpunk 2077 for \d+ minutes and was at \d+°C when the graphics driver reset\./);
    // The same reset a week before, which Rig didn't record.
    expect(lead.textContent).toMatch(/Windows logged the same reset on .+, when Rig wasn't recording\./);

    // The temperature against the game's usual range from its earlier sessions, with the stretch above it and the moment.
    const chart = screen.getByRole("region", { name: "The 45 minutes Rig recorded" });
    within(chart).getByText(/^Your normal in Cyberpunk 2077, \d+ to \d+°C$/);
    within(chart).getByText("Above your normal");
    const svg = within(chart).getByRole("img", { name: /^Graphics card temperature during the recording, with black screen at/ });
    expect(svg.textContent).toMatch(/Black screen/);
    expect(svg.textContent).toMatch(/Goes above your normal/);
    expect(svg.textContent).toMatch(/load fell to 4% for about \d+ seconds/);
    within(chart).getByText("Cyberpunk 2077");

    const ruled = screen.getByRole("region", { name: "What it ruled out" });
    expect(within(ruled).getAllByRole("listitem").map((li) => li.querySelector("b")!.textContent)).toEqual(
      ["Ruled out: Not the processor", "Ruled out: Not memory", "Ruled out: Not another app", "Ruled out: The power held"]);
    within(ruled).getByText(/^Only Cyberpunk 2077 was busy/);

    const todo = screen.getByRole("region", { name: "What to do" });
    within(todo).getByText("It ran above your normal here. Dust is the usual cause.");
    fireEvent.click(within(todo).getByRole("button", { name: "I cleaned it" }));
    await within(todo).findByText("You cleaned it today. Record a game to check.");
    fireEvent.click(within(todo).getByRole("button", { name: "Record" }));
    await within(todo).findByText("Recording now. It shows in Logs.");

    // The busiest apps and the Windows events stay one press away, and Ask reads the recording.
    expect(screen.queryByText("Cyberpunk2077.exe", { selector: "td" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apps and Windows events" }));
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

    await open("recorded");
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    await screen.findByText("Recording now");
    await screen.findByText(/Ends at/);
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.queryByText("Recording now")).toBeNull());
    await screen.findByRole("button", { name: "Start recording" });

    // A recording that caught nothing keeps its plain page: what Rig found, and nothing made up about a cause.
    fireEvent.click(screen.getByRole("button", { name: /A recording you started from Logs/ }));
    await screen.findByText("What Rig found");
    expect(screen.queryByText(/most likely/i)).toBeNull();
    expect(screen.queryByRole("region", { name: "What it ruled out" })).toBeNull();
  });

  it("says plainly when a PC has no events and no recordings", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    await screen.findByText(/No recordings yet/);
    screen.getByRole("button", { name: "Start recording" });
    await open("events");
    await screen.findByText("Nothing logged on Pebble in the last 30 days.");
    expect(screen.queryByRole("group", { name: "Show only" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Last 30 days" })).toBeNull();
  });

  it("shows a recording in °F when that's the unit picked", async () => {
    localStorage.setItem("rig.tempUnit", "f");
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("recorded");
    fireEvent.click(await screen.findByRole("button", { name: /Watch temperatures, load and Windows events while you play/ }));
    const found = await screen.findByText("Heat most likely set it off");
    const page = found.closest(".page")!;
    await waitFor(() => expect(page.textContent).toMatch(/\d+°F/));
    expect(page.textContent).not.toMatch(/°C/);
    expect(screen.getByRole("img", { name: /^Graphics card temperature during the recording/ }).textContent).toMatch(/\d+°F safe limit/);
    screen.getByText(/^Your normal in Cyberpunk 2077, \d+ to \d+°F$/);
  });

  it("finds the Logs screen and a recording from the search palette", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = await screen.findByRole("textbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "crashes" } });
    screen.getByRole("button", { name: /^Events In Logs: everything that happened/ });
    fireEvent.change(search, { target: { value: "sensors" } });
    screen.getByRole("button", { name: /^Logs Every sensor, live or back to the last month/ });
    expect(screen.queryByRole("button", { name: /^Performance/ })).toBeNull();
    fireEvent.change(search, { target: { value: "while you play" } });
    fireEvent.click(await screen.findByRole("button", { name: /Watch temperatures, load and Windows events while you play/ }));
    await waitFor(() => expect(location.hash).toBe("#logs"));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByText("Heat most likely set it off");
  });

  it("opens on what's happening now: readings that move as they come in, and every log entry on Events", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    // Readings that came in on Home are already drawn when Logs opens; nobody waits for the chart to fill.
    await act(() => new Promise((r) => setTimeout(r, 4500)));
    await open("logs");
    expect(within(screen.getByRole("navigation", { name: "Logs" })).getByRole("link", { name: "Readings" }).getAttribute("aria-current")).toBe("page");
    const readings = screen.getByRole("region", { name: "Readings" });
    const temps = await within(readings).findByRole("img", { name: "Temperatures" }, { timeout: 500 });
    within(readings).getByRole("heading", { name: "Last 5 minutes" });
    within(readings).getByText("Live");
    within(readings).getByText(/A reading every 2 s/);
    // One picker reaches from the last few minutes back to the month.
    const spans = within(readings).getByRole("group", { name: "How far back" });
    expect(within(spans).getAllByRole("button").map((b) => b.textContent)).toEqual(["5 min", "1 hour", "6 hours", "Day", "Week", "Month"]);
    // Rig has only been open a few seconds, so an hour of readings starts partway, and says when.
    fireEvent.click(within(spans).getByRole("button", { name: "1 hour" }));
    within(readings).getByText(/Readings start at .*, when Rig opened/);
    fireEvent.click(within(spans).getByRole("button", { name: "5 min" }));
    // The line moves with each new reading.
    const line = () => [...temps.querySelectorAll("path")].map((p) => p.getAttribute("d")).join("|");
    const before = line();
    await waitFor(() => expect(line()).not.toBe(before), { timeout: 4000 });

    await open("events");
    const log = await screen.findByRole("region", { name: "Log" });
    (await within(log).findAllByText("The graphics driver stopped and recovered"));
    within(log).getByText(/Discord's memory and processor use/);
    fireEvent.click(within(log).getByRole("button", { name: /^Problems/ }));
    expect(within(log).queryByText(/Discord's memory and processor use/)).toBeNull();
    within(log).getAllByText("The graphics driver stopped and recovered");
  }, 15000);

  it("redraws today's readings when the background log gets a newer reading, even when its count stays the same", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0));
    try {
      const client = new DemoClient();
      const watch = client.watchRecordings.bind(client);
      let send!: (list: RecordingInfo[]) => void;
      let list: RecordingInfo[] = [];
      client.watchRecordings = (id, cb) => { send = cb; return watch(id, (l) => { list = l; cb(l); }); };
      const read = client.recording.bind(client);
      let reads = 0;
      // The first read of today is a reading short, the way it is just before its newest reading lands.
      client.recording = async (id, rid) => {
        const r = await read(id, rid);
        if (!r || !rid.startsWith("bg-d-")) return r;
        reads++;
        return reads === 1 ? { ...r, samples: r.samples.slice(0, -1) } : r;
      };
      render(<RigApp client={client} />);
      await screen.findByText(/Things to look at/i);
      await open("recorded");
      await screen.findByRole("heading", { name: "Today" });
      const readings = screen.getByRole("region", { name: "Readings" });
      const span = await within(readings).findByText(/ to .*, every 30 s$/);
      const before = span.textContent;
      // A day keeps a set number of readings, so the newest one replaces an old one: same count, later finish.
      const today = list.filter((r) => r.id.startsWith("bg-d-")).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
      await act(async () => { send(list.map((r) => (r.id === today.id ? { ...r, finishedAt: (r.finishedAt ?? 0) + 30_000 } : r))); });
      await waitFor(() => expect(within(readings).getByText(/ to /).textContent).not.toBe(before));
    } finally { vi.useRealTimers(); }
  });

  it("shows a day of the background log with every sensor, and opens its closer look from Events", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0));
    try {
      render(<RigApp client={new DemoClient()} />);
      await screen.findByText(/Things to look at/i);
      await open("recorded");
      await screen.findByRole("heading", { name: "Today" });
      expect(within(screen.getByRole("navigation", { name: "Logs" })).getByRole("link", { name: "Readings" }).getAttribute("aria-current")).toBe("page");
      fireEvent.click(screen.getByRole("button", { name: "Day before" }));
      await screen.findByRole("heading", { name: "Yesterday" });
      const readings = screen.getByRole("region", { name: "Readings" });
      await within(readings).findByRole("img", { name: "Temperatures" });
      within(readings).getByRole("img", { name: "Fans" });
      fireEvent.click(within(readings).getByRole("button", { name: /^Graphics card/ }));
      within(readings).getByText("GPU Hot Spot");
      within(readings).getByRole("img", { name: "Power" });

      await open("events");
      const log = await screen.findByRole("region", { name: "Log" });
      const look = (await within(log).findAllByText(/^Closer look: Rig read every sensor/))[0].closest("li")!;
      fireEvent.click(within(look).getByRole("button", { name: "Open" }));
      await screen.findByRole("heading", { level: 1, name: "The graphics driver stopped and recovered" });
      const key = screen.getByLabelText("Key readings");
      within(key).getByText("Graphics card");
      within(key).getByText("limit 88°C");
      const all = screen.getByRole("region", { name: "All sensors" });
      expect(key.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Ask about this" })).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("shows the last 6 hours, the week or the month on the same chart, saying where the readings came from", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0));
    try {
      render(<RigApp client={new DemoClient()} />);
      await screen.findByText(/Things to look at/i);
      await open("logs");
      const readings = await screen.findByRole("region", { name: "Readings" });
      const spans = within(readings).getByRole("group", { name: "How far back" });
      fireEvent.click(within(spans).getByRole("button", { name: "Week" }));
      within(readings).getByRole("heading", { name: "Last 7 days" });
      expect(within(readings).queryByRole("button", { name: "Day before" })).toBeNull();
      await within(readings).findByText("Every sensor, every 30 s");
      await within(readings).findByRole("img", { name: "Temperatures" });

      fireEvent.click(within(spans).getByRole("button", { name: "6 hours" }));
      within(readings).getByRole("heading", { name: "Last 6 hours" });
      await within(readings).findByRole("img", { name: "Temperatures" });

      // A month is longer than the background log keeps, so it's Rig's 10-minute history, on the same chart.
      fireEvent.click(within(spans).getByRole("button", { name: "Month" }));
      within(readings).getByRole("heading", { name: "Last 30 days" });
      within(readings).getByText("Every 10 minutes while Rig was open");
      const month = await within(readings).findByRole("img", { name: "Temperatures" });
      within(within(readings).getByRole("group", { name: "Parts" })).getByRole("button", { name: /^Processor/ });
      // A month's axis names a date every few days, not all thirty weekdays in a row.
      const dates = [...month.parentElement!.parentElement!.querySelectorAll("text.chart-tick")].map((t) => t.textContent ?? "").filter((x) => /^[A-Z][a-z]{2} \d+$/.test(x));
      expect(dates.length).toBeGreaterThan(1);
      expect(dates.length).toBeLessThan(15);
    } finally { vi.useRealTimers(); }
  });

  it("lists every sensor in a table, like a hardware monitor, with its lowest and highest, and finds one by name", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0));
    try {
      render(<RigApp client={new DemoClient()} />);
      await screen.findByText(/Things to look at/i);
      await open("recorded");
      await screen.findByRole("heading", { name: "Today" });
      const readings = screen.getByRole("region", { name: "Readings" });
      await within(readings).findByRole("img", { name: "Temperatures" });
      fireEvent.click(within(within(readings).getByRole("group", { name: "Show as" })).getByRole("button", { name: "Table" }));
      const table = within(readings).getByRole("table", { name: "Every sensor" });
      expect(within(readings).queryByRole("img", { name: "Temperatures" })).toBeNull();
      expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Sensor", "Last", "Lowest", "Highest"]);
      // Grouped by part, then by kind, like HWMonitor.
      const gpu = within(table).getByRole("rowgroup", { name: "Graphics card" });
      within(gpu).getByRole("rowheader", { name: "Temperatures" });
      const hot = within(gpu).getByRole("row", { name: /^GPU Hot Spot/ });
      const [last, low, high] = within(hot).getAllByRole("cell").map((c) => c.textContent ?? "");
      for (const v of [last, low, high]) expect(v).toMatch(/^\d+°C$/);
      expect(parseInt(low)).toBeLessThanOrEqual(parseInt(last));
      expect(parseInt(high)).toBeGreaterThanOrEqual(parseInt(last));
      expect(within(table).getAllByRole("rowgroup").length).toBeGreaterThan(3);

      fireEvent.change(within(readings).getByRole("searchbox", { name: "Find a sensor" }), { target: { value: "hot spot" } });
      const rows = within(within(readings).getByRole("table", { name: "Every sensor" })).getAllByRole("row").filter((r) => r.querySelector("th[scope=row]"));
      expect(rows.map((r) => r.querySelector("th")!.textContent)).toEqual(["GPU Hot Spot"]);
      fireEvent.change(within(readings).getByRole("searchbox", { name: "Find a sensor" }), { target: { value: "nothing like this" } });
      within(readings).getByText(/No sensor matches/);

      fireEvent.click(within(readings).getByRole("button", { name: "Chart" }));
      await within(readings).findByRole("img", { name: "Temperatures" });
    } finally { vi.useRealTimers(); }
  });

  it("draws a day from Rig's history on a PC without the background log, and says how to get more", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("logs");
    const readings = await screen.findByRole("region", { name: "Readings" });
    fireEvent.click(within(readings).getByRole("button", { name: "Day" }));
    within(readings).getByRole("heading", { name: "Last 24 hours" });
    within(readings).getByText("Every 10 minutes while Rig was open");
    await within(readings).findByRole("img", { name: "Temperatures" });
    within(readings).getByText(/Turn on the background recorder in Settings/);
  });

  it("opens a custom log with its highest readings and a chart of them", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("recorded");
    const custom = await screen.findByRole("region", { name: "Custom logs" });
    fireEvent.click(within(custom).getByRole("button", { name: /Discord's memory/ }));
    await screen.findByRole("heading", { level: 1, name: /Discord's memory and processor use/ });
    const key = screen.getByLabelText("Key readings");
    within(key).getByText("Memory, highest");
    screen.getByRole("img", { name: "Memory" });
    screen.getByText("Every entry");
  });

  it("fits a chart to its readings, so a few degrees of change fill it", () => {
    const t0 = Date.now() - 60_000;
    const points = Array.from({ length: 30 }, (_, k) => ({ t: t0 + k * 2000, v: [61 + (k % 4), 20 + (k % 3) * 2] }));
    const lanes = [
      { title: "Temperatures", type: "temperature" as const, limit: 95, series: [{ i: 0, cls: "c-ink", name: "Processor" }] },
      { title: "Usage", type: "load" as const, series: [{ i: 1, cls: "c-ink", name: "Processor" }] },
    ];
    render(<Lanes points={points} lanes={lanes} t0={t0} t1={t0 + 60_000} cursor={null} onCursor={() => {}} />);
    const ticks = (name: string) => [...screen.getByRole("img", { name }).querySelectorAll("text.chart-tick")].map((t) => Number.parseFloat(t.textContent ?? ""));
    const temps = ticks("Temperatures");
    // Readings from 61° to 64° get an axis a few degrees wide, not one from 60° up past the 95° limit.
    expect(Math.min(...temps)).toBeGreaterThanOrEqual(55);
    expect(Math.max(...temps)).toBeLessThanOrEqual(70);
    const usage = ticks("Usage");
    expect(Math.min(...usage)).toBeGreaterThan(0);
    expect(Math.max(...usage)).toBeLessThanOrEqual(40);
    // The limit is left off when the readings are far below it, and drawn when they come near.
    expect(screen.getByRole("img", { name: "Temperatures" }).querySelector(".chart-limit")).toBeNull();
    cleanup();
    const hot = points.map((p) => ({ ...p, v: [p.v[0]! + 26, p.v[1]] }));
    render(<Lanes points={hot} lanes={lanes} t0={t0} t1={t0 + 60_000} cursor={null} onCursor={() => {}} />);
    expect(screen.getByRole("img", { name: "Temperatures" }).querySelector(".chart-limit")).not.toBeNull();
  });

  it("draws a live line all the way to the right edge, so no gap opens before the next reading", () => {
    const now = Date.now();
    // A reading every 2 s, the newest one a moment ago, as the live view gets them.
    const points = Array.from({ length: 40 }, (_, k) => ({ t: now - 300 - (39 - k) * 2000, v: [50 + (k % 5)] }));
    const lanes = [{ title: "Temperatures", type: "temperature" as const, series: [{ i: 0, cls: "c-ink", name: "Processor" }] }];
    render(<Lanes points={points} lanes={lanes} t0={now - 60_000} t1={now} cursor={null} onCursor={() => {}} live />);
    const d = screen.getByRole("img", { name: "Temperatures" }).querySelector("path.ln-line")!.getAttribute("d") ?? "";
    const xs = [...d.matchAll(/[ML](-?[\d.]+),/g)].map((m) => Number(m[1]));
    // The chart is 900 wide with 8 to spare on the right, so the line has to reach 892.
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(892);
  });

  it("draws a part's key lines, a highest and average where nothing sums its sensors up, and the rest on request", () => {
    const t0 = Date.now() - 60_000;
    const cpu = (type: "temperature" | "clock", name: string) => ({ id: `${type}-${name}`, hw: "cpu" as const, hwName: "", type, name, part: "cpu" });
    const sensors = [cpu("temperature", "CPU Package"), cpu("temperature", "Core Max"),
      ...[1, 2, 3, 4, 5, 6].map((n) => cpu("temperature", `P-Core #${n}`)), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => cpu("clock", `P-Core #${n}`))];
    const points = Array.from({ length: 30 }, (_, k) => ({ t: t0 + k * 2000, v: sensors.map((s, i) => (s.type === "clock" ? (k + i) % 2 ? 800 : 5300 : 50 + ((k + i) % 6))) }));
    const r = { sensors, points, full: true, parts: [{ id: "cpu", name: "Processor", sensors: sensors.map((_, i) => i), lead: 0 }] };
    render(<AllSensors r={r} from={t0} to={t0 + 60_000} limits={{}} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Parts" })).getByRole("button", { name: /^Processor/ }));
    const lines = (name: string) => screen.getByRole("img", { name }).querySelectorAll("path.ln-line").length;
    // Temperatures: the package and the hottest core, not all eight.
    expect(lines("Temperatures")).toBe(2);
    // Speeds has no line that sums up its cores, so it draws their highest and average.
    expect(lines("Speeds")).toBe(2);
    const speeds = screen.getByRole("img", { name: "Speeds" }).parentElement!;
    within(speeds).getByText("Highest");
    within(speeds).getByText("Average");
    fireEvent.click(within(speeds).getByRole("button", { name: "Show all 10" }));
    expect(lines("Speeds")).toBe(10);
    fireEvent.click(within(speeds).getByRole("button", { name: "Show fewer" }));
    expect(lines("Speeds")).toBe(2);
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
