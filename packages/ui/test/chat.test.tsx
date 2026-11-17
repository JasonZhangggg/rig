// The Ask screen: starting a conversation, sending with Enter, and starting over.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function openChat() {
  render(<RigApp client={new DemoClient()} />);
  await screen.findByText(/Things to look at/i);
  await act(async () => { location.hash = "chat"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  return screen.findByRole("textbox", { name: "Message" });
}

beforeEach(() => { location.hash = ""; localStorage.clear(); });
afterEach(() => cleanup());

describe("Ask", () => {
  it("offers questions to start with before anything is asked", async () => {
    await openChat();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByRole("heading", { name: /What's going on with Atlas\?/ })).toBeTruthy();
    const starters = within(screen.getByRole("list", { name: "Questions to start with" })).getAllByRole("button");
    expect(starters).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
  });

  it("sends with Enter, keeps Shift and Enter for a new line, and shows Rig's answer", async () => {
    const box = await openChat() as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Why is startup slow?" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(box.value).toBe("Why is startup slow?");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("");
    expect(screen.getByText("Why is startup slow?", { selector: ".bubble" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rig is answering" })).toBeTruthy();
    await screen.findByRole("button", { name: "Review and apply" }, { timeout: 4000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    expect(within(screen.getByLabelText("Ask next")).queryByRole("button", { name: /Why is startup slow/ })).toBeNull();
  });

  it("starts a new chat", async () => {
    const box = await openChat();
    fireEvent.change(box, { target: { value: "Hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("Hello", { selector: ".bubble" })).toBeNull();
    expect(screen.getByRole("heading", { name: /What's going on with Atlas\?/ })).toBeTruthy();
  });
});
