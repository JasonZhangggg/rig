// Adding a widget: the Customize bar sits at the top of Home, and Add widget opens a library that shows each widget as
// it will look, sorted into groups, with a search box and an Add button on every card.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const open = async () => {
  render(<RigApp client={new DemoClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Customize Home" }));
  const bar = screen.getByRole("toolbar", { name: "Customize Home" });
  fireEvent.click(within(bar).getByRole("button", { name: /^Add widget/ }));
  return { bar, library: screen.getByRole("dialog", { name: "Add widget" }) };
};

describe("the Add widget library", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("puts the Customize bar above Home's widgets", async () => {
    const { bar } = await open();
    const first = screen.getAllByRole("group").find((g) => /, place 1 of /.test(g.getAttribute("aria-label") ?? ""))!;
    expect(bar.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows each hidden widget as it will look, in groups, and adds one on Add", async () => {
    const { library } = await open();
    const lib = within(library);
    expect(library.getAttribute("aria-modal")).toBe("true");
    expect(lib.getByRole("region", { name: "Storage" })).toBeTruthy();
    const card = lib.getByRole("button", { name: "Add Drive health" }).closest("li")!;
    expect(card.querySelector(".dgal-prev .dw[data-kind='drives']")).toBeTruthy();
    fireEvent.click(lib.getByRole("button", { name: "Add Drive health" }));
    expect(await screen.findByRole("heading", { name: "Drive health" })).toBeTruthy();
    expect(lib.queryByRole("button", { name: "Add Drive health" })).toBeNull();
    expect(screen.getAllByText("Drive health added.").length).toBeGreaterThan(0);
  });

  it("finds a widget by its name or what it shows", async () => {
    const lib = within((await open()).library);
    fireEvent.change(lib.getByRole("searchbox", { name: "Find a widget" }), { target: { value: "crashes" } });
    expect(lib.getAllByRole("button", { name: /^Add / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Add Windows events"]);
    fireEvent.change(lib.getByRole("searchbox", { name: "Find a widget" }), { target: { value: "zzz" } });
    expect(lib.getByText("No widget matches “zzz”.")).toBeTruthy();
  });
});
