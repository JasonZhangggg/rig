// Home's panels and words: options that can be undone, panels that keep focus, one home for corners and density,
// and a new PC that has reported almost nothing yet reading as new rather than broken.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import { KIND_ORDER } from "../src/pages/overview/layout";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const KEY = "rig.dashboard.v1:demo";

describe("Home's panels", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  const customize = async () => {
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Customize Home" }));
    return within(screen.getByRole("toolbar", { name: "Customize Home" }));
  };
  const options = (name: string) => { fireEvent.click(screen.getByRole("button", { name: `${name} options` })); return within(screen.getByRole("dialog", { name: `${name} options` })); };

  it("offers Undo after a style change in a widget's options, and Undo puts it back", async () => {
    await customize();
    fireEvent.click(options("Temperatures").getByRole("button", { name: "Range rows" }));
    expect(screen.getAllByText("Temperatures now shows Range rows.").length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem(KEY)!).widgets.find((w: { kind: string }) => w.kind === "temps").style).toBe("rows");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(KEY)!).widgets.find((w: { kind: string }) => w.kind === "temps").style).toBe("caps"));
  });

  it("says which switch changed, so the Undo note is clear", async () => {
    await customize();
    fireEvent.click(options("Temperatures").getByRole("switch", { name: "Show the key" }));
    expect(screen.getAllByText("Temperatures: show the key off.").length).toBeGreaterThan(0);
  });

  it("keeps Tab inside an open panel", async () => {
    const bar = await customize();
    fireEvent.click(bar.getByRole("button", { name: "Layout" }));
    const panel = screen.getByRole("dialog", { name: "Home layout" });
    const buttons = within(panel).getAllByRole("button");
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("leaves corners and density to Settings and opens Appearance from Home's layout panel", async () => {
    const bar = await customize();
    fireEvent.click(bar.getByRole("button", { name: "Layout" }));
    const panel = within(screen.getByRole("dialog", { name: "Home layout" }));
    expect(panel.queryByRole("group", { name: "Corners" })).toBeNull();
    expect(panel.queryByRole("group", { name: "Density" })).toBeNull();
    expect(panel.getByRole("group", { name: "Space between widgets" })).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: "Open Appearance settings" }));
    await waitFor(() => expect(location.hash).toBe("#settings"));
    expect(await screen.findByRole("group", { name: "Corners" })).toBeTruthy();
  });

  it("keeps the Add widget panel open on the bar once the empty Home's button goes", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, widgets: KIND_ORDER.map((kind) => ({ kind, hidden: true })) }));
    render(<RigApp client={new DemoClient()} />);
    expect(await screen.findByText(/Home is empty/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Add widget" })).getByRole("button", { name: "Add Health" }));
    expect(screen.queryByText(/Home is empty/)).toBeNull();
    expect(screen.getByRole("dialog", { name: "Add widget" })).toBeTruthy();
    expect(screen.getAllByText("Health added.").length).toBeGreaterThan(0);
  });
});

describe("a new PC on Home", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("reads as new, not broken, before Rig has scored it or found its parts", async () => {
    const client = new DemoClient();
    const [pc] = await client.machines();
    const bare = { ...pc, health: 0, breakdown: [], summary: "", parts: {}, stats: [], issues: [], alerts: [] };
    client.machines = async () => [bare];
    client.watch = () => () => {};
    localStorage.setItem(KEY, JSON.stringify({ v: 2, widgets: [{ kind: "parts", hidden: false }] }));
    render(<RigApp client={client} />);
    expect(await screen.findByText(new RegExp(`Rig is getting to know ${pc.name}`))).toBeTruthy();
    expect(screen.queryByText(/not at its best/)).toBeNull();
    expect(screen.getByRole("img", { name: "Health not scored yet" })).toBeTruthy();
    expect(screen.getByText(new RegExp(`Rig lists each part here once it has had a look inside ${pc.name}`))).toBeTruthy();
    expect(screen.queryByText(/switched off/)).toBeNull();
  });
});
