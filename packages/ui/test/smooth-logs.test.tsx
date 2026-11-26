// Buttons on Logs, Changes, Chat and Games say what they're doing while it happens, and nothing on screen jumps or closes under the person.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import type { ProbeEdit, ProbeSpec, RecorderStatus } from "@rig/core";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { dayLabel } = await import("../src/pages/Changes");
const { checkProbe } = await import("@rig/core");

/** A promise the test lets go of when it's ready, standing in for a slow helper or server. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((r) => { open = r; });
  return { wait, open: () => act(async () => { open(); await wait; }) };
}

/** Makes one client method wait for the gate before doing what it does. */
function slow<K extends keyof DemoClient>(client: DemoClient, key: K) {
  const g = gate();
  const real = (client[key] as (...a: unknown[]) => Promise<unknown>).bind(client);
  (client as unknown as Record<string, unknown>)[key] = async (...a: unknown[]) => { await g.wait; return real(...a); };
  return g;
}

async function go(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

async function start(client = new DemoClient(), host = {}) {
  render(<RigApp client={client} host={host} />);
  await screen.findByText(/Things to look at/i);
  return client;
}

// jsdom has no PointerEvent, so the tap-or-mouse check needs one that carries pointerType.
if (typeof window.PointerEvent === "undefined") {
  class PointerEvent extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? ""; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEvent;
}

const fiveDaysAgo = () => dayLabel(new Date(Date.now() - 5 * 864e5).toISOString());

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
afterEach(() => cleanup());

describe("Changes", () => {
  it("says Undoing… on the button until the undo finishes", async () => {
    const client = await start();
    await go("changes");
    const day = await screen.findByRole("region", { name: fiveDaysAgo() });
    const g = slow(client, "undo");
    fireEvent.click(within(day).getByRole("button", { name: "Undo" }));
    const busy = within(day).getByRole("button", { name: "Undoing…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await g.open();
    const redo = await within(day).findByRole("button", { name: "Redo" }) as HTMLButtonElement;
    expect(redo.disabled).toBe(false);
  });

  it("keeps a change's details open when another change that day is undone", async () => {
    const client = new DemoClient();
    const changes = client.changes.bind(client);
    // A second change earlier the same day, so undoing the newest one changes which entry leads the day.
    client.changes = async (id) => {
      const list = await changes(id);
      const first = list.find((c) => c.status === "applied")!;
      const earlier = { ...first, id: "earlier", title: "Turned off Xbox Game Bar at startup", at: new Date(new Date(first.at).getTime() - 60_000).toISOString() };
      return [...list, earlier];
    };
    await start(client);
    await go("changes");
    const day = await screen.findByRole("region", { name: fiveDaysAgo() });
    fireEvent.click(within(screen.getByRole("group", { name: "Show only" })).getByRole("button", { name: /Applied/ }));
    const details = within(day).getByRole("button", { name: "Details: Turned off Xbox Game Bar at startup" });
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");

    const undo = within(day).getAllByRole("button", { name: "Undo" })[0];
    fireEvent.click(undo);
    await waitFor(() => expect(within(day).queryByText("Turned off NVIDIA Broadcast at startup")).toBeNull());
    expect(within(day).getByRole("button", { name: "Details: Turned off Xbox Game Bar at startup" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("says it's reading the settings while a waiting fix opens for review", async () => {
    const client = await start();
    await go("changes");
    const waiting = await screen.findByRole("region", { name: /^Waiting for review/ });
    const g = slow(client, "preview");
    const review = within(waiting).getAllByRole("button", { name: /^Review:/ })[0] as HTMLButtonElement;
    fireEvent.click(review);
    expect(review.textContent).toBe("Reading settings…");
    expect(review.disabled).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await g.open();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(review.textContent).toBe("Review");
  });
});

describe("Chat", () => {
  it("says it's reading the settings while a proposal opens for review", async () => {
    const client = await start();
    await go("chat");
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Why is startup slow?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    const button = await screen.findByRole("button", { name: "Review and apply" }, { timeout: 4000 }) as HTMLButtonElement;
    const g = slow(client, "preview");
    fireEvent.click(button);
    expect(button.textContent).toBe("Reading settings…");
    expect(button.disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "Not now" }).at(-1) as HTMLButtonElement).disabled).toBe(true);
    await g.open();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  }, 10000);

  it("says Approving… and holds both buttons while Windows asks for permission", async () => {
    const client = new DemoClient();
    const p = checkProbe({ label: "Who woke the PC", source: { kind: "script", text: "powercfg /lastwake", admin: true }, every: 600 }, { id: "c-s", by: "chat", now: Date.now() });
    if (typeof p === "string") throw new Error(p);
    client.chat = async (_id, _h, onEvent) => {
      onEvent({ type: "text", text: "This script reads what woke the PC." });
      onEvent({ type: "script", probe: p });
      onEvent({ type: "done" });
    };
    const g = gate();
    const status: RecorderStatus = { supported: true, service: "running", mine: "S-1", probes: { list: [] } };
    const recorder = { status: async () => status, set: async () => {}, probes: async (_r: ProbeEdit) => [] as ProbeSpec[], approveAdmin: async () => { await g.wait; return [] as ProbeSpec[]; } };
    await start(client, { autostart: { get: async () => false, set: async () => {} }, recorder });
    await go("chat");
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "What keeps waking my PC?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByText("powercfg /lastwake");

    const approve = screen.getByRole("button", { name: "Approve script" }) as HTMLButtonElement;
    fireEvent.click(approve);
    expect(approve.textContent).toBe("Approving…");
    expect(approve.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Not now" }) as HTMLButtonElement).disabled).toBe(true);
    await g.open();
    expect(await screen.findByText("Approved")).toBeTruthy();
  });
});

describe("Logs", () => {
  it("says Stopping… on Stop until the recording has stopped", async () => {
    const client = await start();
    await go("logs");
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    await screen.findByText("Recording now");
    const g = slow(client, "stopRecording");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    const busy = screen.getByRole("button", { name: "Stopping…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await g.open();
    await waitFor(() => expect(screen.queryByText("Recording now")).toBeNull());
  });

  it("says Stopping… on a recording's own page, and keeps its readings if a later read fails", async () => {
    const client = await start();
    await go("logs");
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    await screen.findByText("Recording now");
    fireEvent.click(screen.getByRole("button", { name: "Watch it" }));
    await screen.findByText("What Rig found");

    const g = slow(client, "stopRecording");
    client.recording = async () => { throw new Error("The helper didn't answer."); };
    const stop = screen.getByRole("button", { name: "Stop recording" }) as HTMLButtonElement;
    fireEvent.click(stop);
    expect(stop.textContent).toBe("Stopping…");
    expect(stop.disabled).toBe(true);
    await g.open();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Stop/ })).toBeNull());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByText("What Rig found")).toBeTruthy();
    expect(screen.queryByText(/Rig couldn't load this recording/)).toBeNull();
  });

  it("shows a day's tip for a mouse but not after a tap", async () => {
    await start();
    await go("events");
    const strip = await screen.findByRole("group", { name: "Last 30 days" });
    const day = within(strip).getByRole("button", { name: /1 entry: The PC turned off without shutting down/ });

    fireEvent.pointerDown(day, { pointerType: "touch" });
    fireEvent.pointerEnter(day, { pointerType: "touch" });
    fireEvent.focus(day);
    fireEvent.click(day);
    expect(day.getAttribute("aria-pressed")).toBe("true");
    expect(within(strip).queryByRole("tooltip")).toBeNull();
    fireEvent.blur(day);

    fireEvent.pointerEnter(day, { pointerType: "mouse" });
    expect(within(strip).getByRole("tooltip").textContent).toMatch(/The PC turned off without shutting down/);
    fireEvent.pointerLeave(day, { pointerType: "mouse" });
    expect(within(strip).queryByRole("tooltip")).toBeNull();
  });
});

describe("Games", () => {
  it("goes back to where the list was after All games", async () => {
    const calls: [number, number][] = [];
    window.scrollTo = ((x: number, y: number) => { calls.push([x, y]); }) as typeof window.scrollTo;
    location.hash = "games";
    render(<RigApp client={new DemoClient()} />);
    const list = await screen.findByRole("list", { name: "Games" });
    Object.defineProperty(window, "scrollY", { value: 640, configurable: true });
    fireEvent.click(within(list).getAllByRole("button")[0]);
    await screen.findByRole("heading", { level: 1 });
    expect(calls.at(-1)).toEqual([0, 0]);
    fireEvent.click(screen.getByRole("button", { name: /All games/ }));
    await screen.findByRole("list", { name: "Games" });
    expect(calls.at(-1)).toEqual([0, 640]);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });
});
