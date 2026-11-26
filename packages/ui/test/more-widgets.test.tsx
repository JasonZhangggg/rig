// The Home widgets for the rest of Rig: each one in the Add widget library, showing the demo PC's own data, and
// opening its page from a row. A Home someone already set up stays as it was until they add one.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const KEY = "rig.dashboard.v1:demo";
const NEW = ["Last hour", "Drive health", "Changes", "Windows events", "Games", "Next upgrade", "Drivers", "Logs", "Manuals"];
const kinds = ["trend", "drives", "changes", "events", "games", "upgrade", "drivers", "logs", "manuals"];

/** A saved Home that shows only these widgets, in this order. */
const showOnly = (shown: string[]) =>
  localStorage.setItem(KEY, JSON.stringify({ v: 1, widgets: shown.map((kind) => ({ id: kind, kind, hidden: false, size: "m" })) }));

describe("widgets for every part of Rig", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("leaves Home as it was and offers each one in the Add widget library", async () => {
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Customize Home" }));
    for (const title of NEW) expect(screen.queryByRole("heading", { name: title })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Add widget/ }));
    const library = within(screen.getByRole("dialog", { name: "Add widget" }));
    for (const title of NEW) expect(library.getByRole("button", { name: new RegExp(`^${title}`) })).toBeTruthy();
    fireEvent.click(library.getByRole("button", { name: /^Windows events/ }));
    expect(await screen.findByRole("heading", { name: "Windows events" })).toBeTruthy();
  });

  it("shows the PC's changes, events, games, drives, drivers, logs and manuals", async () => {
    showOnly(kinds);
    render(<RigApp client={new DemoClient()} />);
    for (const title of NEW) expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    // Each list shows what the demo PC has, read the way its own page reads it.
    expect(await screen.findByText("Turned off NVIDIA Broadcast at startup")).toBeTruthy();
    expect(await screen.findByText("Crashes")).toBeTruthy();
    expect(await screen.findByText("Baldur's Gate 3")).toBeTruthy();
    expect(await screen.findByText("Samsung SSD 990 PRO 2TB")).toBeTruthy();
    expect(await screen.findByText(/^NVIDIA \d/)).toBeTruthy();
    expect(await screen.findByText(/^BIOS /)).toBeTruthy();
    expect(await screen.findByText("MSI MAG B650 TOMAHAWK WIFI")).toBeTruthy();
    expect(await screen.findByText("Another case fan")).toBeTruthy();
  });

  it("opens the page behind a row", async () => {
    showOnly(["changes", "events", "games"]);
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Turned off NVIDIA Broadcast at startup/ }));
    await waitFor(() => expect(location.hash).toBe("#changes"));
    cleanup();
    location.hash = "";
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Baldur's Gate 3/ }));
    await waitFor(() => expect(location.hash).toBe("#games"));
  });

  it("says what to do when a list is switched to show nothing", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, widgets: [{ id: "trend", kind: "trend", hidden: false, size: "wide", opts: { cpu: false, gpu: false } }] }));
    render(<RigApp client={new DemoClient()} />);
    expect(await screen.findByText("Both lines are switched off. Turn one back on in this widget's options.")).toBeTruthy();
  });
});
