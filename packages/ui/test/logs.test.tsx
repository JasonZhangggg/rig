// The Logs screen and the recording card in chat, on the demo PCs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

describe("Logs", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => cleanup());

  it("is in the sidebar under Help and lists Windows events with a filter", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    expect(screen.getByRole("link", { name: /Logs/ }).getAttribute("href")).toBe("#logs");
    await open("logs");
    await screen.findByText("Windows events");
    expect((await screen.findAllByText("The graphics driver stopped and recovered")).length).toBe(2);
    screen.getByText("The PC turned off without shutting down");
    screen.getByText("Discord.exe crashed");

    fireEvent.click(within(screen.getByRole("group", { name: "Kind of event" })).getByRole("button", { name: /Shutdowns/ }));
    expect(screen.queryByText("Discord.exe crashed")).toBeNull();
    screen.getByText("The PC turned off without shutting down");
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
  });
});
