// Small things a pass over the demo laptops found: each says on screen what's true of a laptop, once.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function open(pc: string) {
  localStorage.setItem("rig.pc", pc);
  render(<RigApp client={new DemoClient()} />);
  await screen.findByText(/Things to look at/i);
}

describe("Laptop polish", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => cleanup());

  it("doesn't call a battery that drained asleep warm in search", async () => {
    await open("demo-comet");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search" }), { target: { value: "battery" } });
    const row = screen.getByRole("button", { name: /^73 Wh battery/ });
    expect(within(row).getByText("Needs a look")).toBeTruthy();
    expect(within(row).queryByText("Running warm")).toBeNull();
  });
});
