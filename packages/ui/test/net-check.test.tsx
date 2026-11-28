// "Is it my PC or my internet?": opened from Ctrl K or the Ask page, it runs the demo's check and answers in plain words.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function openFromSearch(client = new DemoClient(), word = "PC") {
  render(<RigApp client={client} />);
  await screen.findByText(/Things to look at/i);
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  await screen.findByRole("textbox", { name: "Search" });
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Is it my ${word} or my internet\\? Checks \\w+'s connection, your router and the internet`) }));
  return screen.getByRole("dialog");
}

beforeEach(() => { location.hash = ""; localStorage.clear(); DemoClient.pace = 0; });
afterEach(() => { cleanup(); DemoClient.pace = 1; });

describe("Is it my PC or my internet?", () => {
  it("checks Atlas over its cable and says its side is fine", async () => {
    const dialog = await openFromSearch();
    expect(within(dialog).getByRole("heading").textContent).toBe("Checking your connection…");
    expect(await within(dialog).findByRole("heading", { name: "Your PC's connection is fine; any slowness is past your router" })).toBeTruthy();
    expect(within(dialog).getByText(/^Over the cable, your router answers in/)).toBeTruthy();
    const measured = within(within(dialog).getByLabelText("What Rig measured"));
    expect(measured.getByText("2.5 Gbps")).toBeTruthy();
    expect(measured.getByText("Router")).toBeTruthy();
    expect(within(dialog).queryByRole("list", { name: "What Rig found" })).toBeNull();
    expect(within(dialog).getByText("Rig only measured. Nothing on Atlas or your router changed.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Check again" }));
    expect(within(dialog).getByRole("heading").textContent).toBe("Checking your connection…");
    expect(await within(dialog).findByRole("heading", { name: /^Your PC's connection is fine/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("finds Pebble's weak Wi-Fi, says what to do, and asks Rig about it", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    const dialog = await openFromSearch(new DemoClient(), "laptop");
    // Pebble is a laptop, so the check asks about the laptop, not a PC.
    expect(within(dialog).getByText("Pebble · Is it my laptop or my internet?")).toBeTruthy();
    expect(await within(dialog).findByRole("heading", { name: "The Wi-Fi signal is weak (34%), which is the likely cause" })).toBeTruthy();
    const found = within(within(dialog).getByRole("list", { name: "What Rig found" }));
    expect(found.getAllByRole("listitem").map((li) => li.querySelector(".row-title")?.textContent)).toEqual(["Wi-Fi signal is weak: 34%", "Connected on 2.4 GHz", "Network driver is from 2023"]);
    expect(found.getByText("Move closer to the router, or clear what's between them")).toBeTruthy();
    fireEvent.click(found.getByRole("button", { name: "Details: Connected on 2.4 GHz" }));
    expect(found.getByText(/reaches further but is slower/)).toBeTruthy();

    fireEvent.click(found.getByRole("button", { name: "Ask Rig: My Wi-Fi signal is only 34%. How can I make it stronger?" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("My Wi-Fi signal is only 34%. How can I make it stronger?", { selector: ".bubble" })).toBeTruthy();
  });

  it("starts from the Ask page's questions too, without asking the chat", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await act(async () => { location.hash = "chat"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    fireEvent.click(await screen.findByRole("button", { name: "New chat" }));
    const starters = within(screen.getByRole("list", { name: "Questions to start with" }));
    fireEvent.click(starters.getByRole("button", { name: /^Is it my PC or my internet\?/ }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: /^Your PC's connection is fine/ })).toBeTruthy();
    expect(document.querySelector(".bubble")).toBeNull();
  });

  it("on the website, says the check runs from the Rig app on that PC", async () => {
    const client = new DemoClient();
    client.checkNetwork = async () => ({ kind: "unsupported", reason: "elsewhere" });
    const dialog = await openFromSearch(client);
    expect(await within(dialog).findByRole("heading", { name: "Run this check from the Rig app on Atlas" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("says when the check couldn't run, and offers to try again", async () => {
    const client = new DemoClient();
    client.checkNetwork = async () => { throw new Error("The check took too long. Try again."); };
    const dialog = await openFromSearch(client);
    expect(await within(dialog).findByRole("heading", { name: "Rig couldn't check the connection" })).toBeTruthy();
    expect(within(dialog).getByText("The check took too long. Try again.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Check again" })).toBeTruthy();
  });
});
