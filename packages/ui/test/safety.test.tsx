// "Safe and up to date": the Safety tab of My PC and its Home widget, from the demo PCs' readings. Atlas has an update
// waiting since yesterday for a restart; Pebble's virus definitions are 9 days old. Everything else reads as fine, with what was read.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { KIND_ORDER } = await import("../src/pages/overview/layout");

const KEY = "rig.dashboard.v1:demo";
const rowsOf = async () => within(await screen.findByRole("list", { name: "Safe and up to date" })).getAllByRole("listitem");

describe("safe and up to date", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("shows the four rows on My PC's Safety tab, with a chip only on the one that needs a look", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    location.hash = "safety";
    render(<RigApp client={new DemoClient()} />);
    const rows = await rowsOf();
    expect(rows.map((r) => within(r).getAllByText(/./)[0].textContent)).toEqual(["Windows updates", "Virus protection", "Firewall", "Backup"]);
    expect(within(rows[0]).getByText("Last update 12 days ago")).toBeTruthy();
    expect(within(rows[1]).getByText("9 days old")).toBeTruthy();
    expect(within(rows[1]).getByText("Microsoft Defender, on, updated 9 days ago")).toBeTruthy();
    expect(within(rows[2]).getByText("On for every network")).toBeTruthy();
    expect(within(rows[3]).getByText("File History copied 2 days ago")).toBeTruthy();
    expect(rows.flatMap((r) => [...r.querySelectorAll(".chip")]).length).toBe(1);
    expect(screen.getByText("One thing needs a look · checked 5 minutes ago")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Safety" }).getAttribute("aria-current")).toBe("page");
  });

  it("says a fresh restart is waiting without calling it a problem", async () => {
    location.hash = "safety";
    render(<RigApp client={new DemoClient()} />);
    const rows = await rowsOf();
    expect(within(rows[0]).getByText("Last update yesterday · restart waiting")).toBeTruthy();
    expect(rows.flatMap((r) => [...r.querySelectorAll(".chip")]).length).toBe(0);
    expect(screen.getByText("Nothing needs a look · checked 5 minutes ago")).toBeTruthy();
  });

  it("says why and what to do in Details, and asks the chat from the row", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    location.hash = "safety";
    render(<RigApp client={new DemoClient()} />);
    await rowsOf();
    fireEvent.click(screen.getByRole("button", { name: "Details: Virus protection" }));
    expect(screen.getByText(/under Protection updates choose Check for updates/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask about virus protection" }));
    await waitFor(() => expect(location.hash).toBe("#chat"));
  });

  it("shows the Home widget when it's added, and opens the Safety tab from a row", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    localStorage.setItem(KEY, JSON.stringify({ v: 1, widgets: ["safety", ...KIND_ORDER.filter((k) => k !== "safety")].map((kind) => ({ id: kind, kind, hidden: kind !== "safety", size: "m" })) }));
    render(<RigApp client={new DemoClient()} />);
    expect(await screen.findByRole("heading", { name: "Safe and up to date" })).toBeTruthy();
    const row = await screen.findByRole("button", { name: /^Virus protection/ });
    expect(row.textContent).toContain("Microsoft Defender, on, updated 9 days ago");
    expect(row.getAttribute("data-sev")).toBe("warn");
    expect(screen.getByRole("button", { name: /^Firewall/ }).getAttribute("data-sev")).toBeNull();
    fireEvent.click(row);
    await waitFor(() => expect(location.hash).toBe("#safety"));
  });

  it("isn't on a new Home, and the problem still shows in Things to look at", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    expect(await screen.findByText("Virus definitions are 9 days old")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Safe and up to date" })).toBeNull();
  });
});
