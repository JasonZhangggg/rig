// When the desktop app can't read the PC, the screen says so and offers the two things that help: trying again and the log folder.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp, Splash } = await import("../src/App");

class BrokenPC extends DemoClient {
  override machines(): ReturnType<DemoClient["machines"]> { return Promise.reject(new Error("The helper stopped answering.")); }
}

describe("start problems", () => {
  afterEach(() => cleanup());

  it("offers the logs folder beside Try again when the PC can't be read", async () => {
    const openLogs = vi.fn(() => Promise.resolve());
    render(<RigApp client={new BrokenPC()} host={{ openLogs }} />);
    expect(await screen.findByText("Rig couldn't read this PC.")).toBeTruthy();
    expect(screen.getByText(/The helper stopped answering\. Try again/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open logs folder" }));
    expect(openLogs).toHaveBeenCalledOnce();
  });

  it("leaves the logs out where there's no folder to open, like the website", async () => {
    render(<RigApp client={new BrokenPC()} />);
    await screen.findByText("Rig couldn't read this PC.");
    expect(screen.queryByRole("button", { name: "Open logs folder" })).toBeNull();
  });

  it("starts quietly, and a failed start can be tried again without quitting Rig", () => {
    const retry = vi.fn();
    const { rerender } = render(<Splash text="Starting Rig…" />);
    expect(screen.getByRole("status").textContent).toContain("Starting Rig…");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Splash text="Rig couldn't start its helper." retry={retry} logs={() => Promise.resolve()} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
