// Scripts Rig's chat proposes for the background recorder: nothing runs until the person approves, and custom logs show in Settings.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import { checkProbe, type ChatEvent, type ProbeEdit, type ProbeSpec, type RecorderStatus } from "@rig/core";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const NOW = Date.now();

function spec(admin: boolean): ProbeSpec {
  const p = checkProbe({ label: "Who woke the PC", source: { kind: "script", text: "powercfg /lastwake", admin }, every: 600 }, { id: "c-s", by: "chat", now: NOW });
  if (typeof p === "string") throw new Error(p);
  return p;
}

function setup(admin: boolean) {
  const client = new DemoClient();
  client.chat = async (_id, _h, onEvent: (e: ChatEvent) => void) => {
    onEvent({ type: "text", text: "This script reads what woke the PC." });
    onEvent({ type: "script", probe: spec(admin) });
    onEvent({ type: "done" });
  };
  const edits: ProbeEdit[] = [];
  const approveAdmin = vi.fn(async (_p: ProbeSpec) => [] as ProbeSpec[]);
  const status: RecorderStatus = { supported: true, service: "running", mine: "S-1", probes: { list: [{ id: "c-old", label: "GPU heat", kind: "sensor", by: "chat", createdAt: NOW, expiresAt: NOW + 864e5, every: 10, state: "on" }] } };
  const recorder = { status: async () => status, set: async () => {}, probes: async (r: ProbeEdit) => { edits.push(r); return [] as ProbeSpec[]; }, approveAdmin };
  render(<RigApp client={client} host={{ autostart: { get: async () => false, set: async () => {} }, recorder }} />);
  return { edits, approveAdmin };
}

async function ask() {
  await screen.findByText(/Things to look at/i);
  await act(async () => { location.hash = "chat"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  const box = await screen.findByRole("textbox", { name: "Message" });
  fireEvent.change(box, { target: { value: "What keeps waking my PC?" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await screen.findByText("powercfg /lastwake");
}

beforeEach(() => { location.hash = ""; localStorage.clear(); });
afterEach(() => cleanup());

describe("Scripts from the chat", () => {
  it("shows the exact script and runs nothing until the person approves", async () => {
    const { edits } = setup(false);
    await ask();
    expect(screen.getByText(/runs as you/)).toBeTruthy();
    expect(edits).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Approve script" }));
    await waitFor(() => expect(edits).toEqual([{ op: "approve", probe: spec(false) }].map((x) => ({ ...x, probe: expect.objectContaining({ source: x.probe.source }) }))));
    expect(await screen.findByText("Approved")).toBeTruthy();
  });

  it("approves an admin script only through Windows' prompt", async () => {
    const { edits, approveAdmin } = setup(true);
    await ask();
    expect(screen.getByText(/Windows will ask for permission/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve script" }));
    await waitFor(() => expect(approveAdmin).toHaveBeenCalledTimes(1));
    expect(edits).toEqual([]);
  });

  it("lists custom logs in Settings with a switch and a way to turn one off", async () => {
    const { edits } = setup(false);
    await screen.findByText(/Things to look at/i);
    await act(async () => { location.hash = "settings"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const sw = await screen.findByRole("switch", { name: /GPU heat/ });
    expect(sw.textContent).toMatch(/Asked for by Rig's chat/);
    fireEvent.click(sw);
    await waitFor(() => expect(edits).toEqual([{ op: "pause", id: "c-old" }]));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(edits.at(-1)).toEqual({ op: "remove", id: "c-old" }));
  });
});
