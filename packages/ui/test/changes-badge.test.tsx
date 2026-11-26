// The number beside Changes in the sidebar: only changes you haven't seen, and none once you've looked.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}
/** The sidebar's Changes link, read the way a screen reader names it: "Changes", or "Changes" and the count. */
const changesLink = () => screen.getByRole("link", { name: /^Changes/ });
const badge = () => changesLink().textContent!.replace("Changes", "");
const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));

describe("the Changes count in the sidebar", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("shows nothing when there's nothing new, though the PC has changes", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await settle();
    // The demo PC has a change from five days ago.
    expect(badge()).toBe("");
  });

  it("counts a change you haven't seen, and clears once you open Changes", async () => {
    // Last time you looked at Changes was before the demo PC's change was made.
    localStorage.setItem("rig.changesSeen.demo-atlas", JSON.stringify({ at: new Date(0).toISOString(), ids: [] }));
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await waitFor(() => expect(badge()).toBe("1"));
    await open("changes");
    await screen.findByRole("heading", { level: 1, name: "Changes" });
    await waitFor(() => expect(badge()).toBe(""));
    await open("overview");
    await settle();
    expect(badge()).toBe("");
  });

  it("doesn't count up for a change you made yourself, now or after Rig opens again", async () => {
    const client = new DemoClient();
    location.hash = "#upgrades";
    const { unmount } = render(<RigApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review change" }));
    fireEvent.click(await screen.findByRole("button", { name: "Make this change" }));
    await screen.findByRole("button", { name: "Undo" }, { timeout: 3000 });
    await settle();
    expect(badge()).toBe("");
    unmount();
    location.hash = "#overview";
    render(<RigApp client={client} />);
    await screen.findByText(/Things to look at/i);
    await settle();
    expect(badge()).toBe("");
  });
});
