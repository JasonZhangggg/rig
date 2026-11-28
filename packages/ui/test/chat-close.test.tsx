// Closing Rig while it is still answering stops the answer.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

class Slow extends DemoClient {
  signal?: AbortSignal;
  override chat(...[, , , signal]: Parameters<DemoClient["chat"]>) {
    this.signal = signal;
    return new Promise<void>(() => {});
  }
}

describe("an answer still coming in", () => {
  beforeEach(() => { localStorage.clear(); location.hash = ""; });
  afterEach(() => cleanup());

  it("stops when Rig closes", async () => {
    const client = new Slow();
    const { unmount } = render(<RigApp client={client} />);
    await screen.findByText(/Things to look at/i);
    await act(async () => { location.hash = "chat"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Why is it loud?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(client.signal?.aborted).toBe(false);
    unmount();
    expect(client.signal?.aborted).toBe(true);
  });
});
