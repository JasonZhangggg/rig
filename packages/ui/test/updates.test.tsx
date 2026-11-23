// Rig's own updates: the app opens as usual, a new version shows as a small
// notice in the corner and an Update button in Settings, and nothing installs
// until the person picks Update.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import type { UpdateState, UpdatesHost } from "../src/state";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

function fakeUpdates(first: UpdateState) {
  let state = first;
  const fans = new Set<() => void>();
  const u = {
    get: () => state,
    subscribe: (fn: () => void) => { fans.add(fn); return () => { fans.delete(fn); }; },
    check: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    put: (s: UpdateState) => act(() => { state = s; fans.forEach((f) => f()); }),
  };
  return u satisfies UpdatesHost & { put: unknown };
}

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

const ready: UpdateState = { kind: "ready", version: "0.1.7", checkedAt: Date.now() };

describe("Updates", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("opens the app as usual when an update is ready, with a small notice instead of a dialog", async () => {
    const u = fakeUpdates(ready);
    render(<RigApp client={new DemoClient()} host={{ updates: u }} />);
    expect(await screen.findByText(/Things to look at/i)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    const notice = within(screen.getByRole("region", { name: "Rig 0.1.7 is ready" }));
    expect(notice.getByText(/Rig closes while it installs/)).toBeTruthy();
    expect(u.install).not.toHaveBeenCalled();
  });

  it("hides the notice on Not now, and keeps the Update button in Settings", async () => {
    const u = fakeUpdates(ready);
    render(<RigApp client={new DemoClient()} host={{ updates: u }} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.click(within(screen.getByRole("region", { name: "Rig 0.1.7 is ready" })).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: "Rig 0.1.7 is ready" })).toBeNull();
    expect(u.install).not.toHaveBeenCalled();

    await open("settings");
    const section = within(await screen.findByRole("region", { name: "Updates" }));
    expect(section.getByText(/Rig 0.1.7 is ready to install/)).toBeTruthy();
    fireEvent.click(section.getByRole("button", { name: "Update to 0.1.7" }));
    expect(u.install).toHaveBeenCalledTimes(1);

    // A newer version than the one put off shows the notice again.
    await u.put({ kind: "ready", version: "0.1.8", checkedAt: Date.now() });
    expect(screen.getByRole("region", { name: "Rig 0.1.8 is ready" })).toBeTruthy();
  });

  it("installs from the notice, and says Rig will close and open again", async () => {
    const u = fakeUpdates(ready);
    render(<RigApp client={new DemoClient()} host={{ updates: u }} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.click(within(screen.getByRole("region", { name: "Rig 0.1.7 is ready" })).getByRole("button", { name: "Update" }));
    expect(u.install).toHaveBeenCalledTimes(1);
    await u.put({ kind: "installing", version: "0.1.7" });
    const notice = within(screen.getByRole("region", { name: "Updating to Rig 0.1.7…" }));
    expect(notice.getByText(/opens again on its own/)).toBeTruthy();
    expect(notice.queryByRole("button")).toBeNull();

    await u.put({ kind: "failed", step: "install", version: "0.1.7", error: "network" });
    fireEvent.click(within(screen.getByRole("region", { name: "Rig 0.1.7 didn't install" })).getByRole("button", { name: "Try again" }));
    expect(u.install).toHaveBeenCalledTimes(2);
  });

  it("says when this is the newest version, and checks again on request", async () => {
    const u = fakeUpdates({ kind: "current", checkedAt: Date.now() });
    render(<RigApp client={new DemoClient()} host={{ updates: u }} />);
    await screen.findByText(/Things to look at/i);
    expect(screen.queryByRole("region", { name: /is ready/ })).toBeNull();
    await open("settings");
    const section = within(await screen.findByRole("region", { name: "Updates" }));
    expect(section.getByText(/This is the newest version. Checked just now./)).toBeTruthy();
    fireEvent.click(section.getByRole("button", { name: "Check for updates" }));
    expect(u.check).toHaveBeenCalledTimes(1);
    await u.put({ kind: "checking" });
    expect((section.getByRole("button", { name: "Checking…" }) as HTMLButtonElement).disabled).toBe(true);
    await u.put({ kind: "failed", step: "check", error: "offline" });
    expect(section.getByText(/couldn't check for updates just now/)).toBeTruthy();
  });

  it("has no Updates section or notice on the website", async () => {
    render(<RigApp client={new DemoClient()} />);
    await open("settings");
    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.queryByRole("region", { name: "Updates" })).toBeNull();
    expect(document.querySelector(".update-notice")).toBeNull();
  });
});
