// What stays steady across the app: a second press doesn't run an action twice, switching range keeps the chart up,
// Ctrl K doesn't open over another dialog, and going back to the Logs list lands where you were.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function show(route: string, client = new DemoClient()) {
  location.hash = route;
  render(<RigApp client={client} />);
  await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
  return client;
}

/** A promise that settles only when the test says so. */
function later<T>() {
  let done!: (v: T) => void;
  const promise = new Promise<T>((r) => { done = r; });
  return { promise, done };
}

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Steady interactions", () => {
  it("keeps the chart up while another range loads", async () => {
    const client = await show("logs");
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await screen.findByRole("img", { name: "Temperatures" });
    vi.spyOn(client, "history").mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByRole("img", { name: "Temperatures" })).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("undoes once however many times Undo is pressed while it works", async () => {
    const client = await show("changes");
    const undo = await screen.findByRole("button", { name: /^Undo/ });
    const slow = later<Awaited<ReturnType<DemoClient["undo"]>>>();
    const real = client.undo.bind(client);
    const spy = vi.spyOn(client, "undo").mockImplementation((...a) => slow.promise.then(() => real(...a)));
    fireEvent.click(undo);
    fireEvent.click(undo);
    fireEvent.click(undo);
    await act(async () => { slow.done(undefined as never); });
    await waitFor(() => expect(screen.getByText(/^Undid “.+”\. Your PC is back to how it was before\.$/)).toBeTruthy());
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: /^Redo/ }));
    await waitFor(() => expect(screen.getByText(/^Redid “.+”\. The change is back on\.$/)).toBeTruthy());
  });

  it("reads the settings once however many times Review is pressed", async () => {
    const client = await show("changes");
    const review = (await screen.findAllByRole("button", { name: /^Review:/ }))[0];
    const spy = vi.spyOn(client, "preview").mockImplementation(() => new Promise(() => {}));
    fireEvent.click(review);
    fireEvent.click(review);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("doesn't open search over another dialog", async () => {
    await show("changes");
    fireEvent.click((await screen.findAllByRole("button", { name: /^Review:/ }))[0]);
    const sheet = await screen.findByRole("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("goes back to where the Logs list was scrolled after a recording", async () => {
    await show("logs");
    const scrolls: number[] = [];
    window.scrollTo = ((_x: number, y: number) => { scrolls.push(y); }) as typeof window.scrollTo;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    fireEvent.click(await screen.findByRole("button", { name: /Watch temperatures, load and Windows events while you play/ }));
    await screen.findByText("Heat most likely set it off");
    expect(scrolls.at(-1)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    await waitFor(() => expect(scrolls.at(-1)).toBe(640));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });
});
