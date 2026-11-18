// Manuals: the page, finding and reading a manual, search, the viewer, the
// part's Manual tab, and manual sources in the chat. pdf.js needs a real
// browser, so reading and drawing are stubbed with the demo's own page text.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualPage } from "@rig/core";
import { DemoClient, renderSampleManual, sampleLaptopGuide } from "@rig/core/demo";

const read = vi.hoisted(() => ({ pages: [] as ManualPage[] }));

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));
vi.mock("../src/manuals/pdf", () => ({
  loadPdfjs: async () => { throw new Error("No pdf.js in tests"); },
  closePdf: async () => {},
  readPdf: async (_b: ArrayBuffer, onProgress?: (d: number, t: number) => void) => {
    read.pages.forEach((p) => onProgress?.(p.n, read.pages.length));
    return { pages: read.pages, pageCount: read.pages.length };
  },
  renderPage: async () => ({ pageCount: 12, height: 900 }),
  isCancelled: () => false,
}));

const { RigApp } = await import("../src/App");
const { closeManual } = await import("../src/manuals/viewer");

function demo() {
  const client = new DemoClient();
  client.shelf.delay = 0;
  return client;
}

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

async function show(route: string, client = demo()) {
  render(<RigApp client={client} />);
  await screen.findByText(/Things to look at/i);
  await open(route);
  return client;
}

const card = async (name: RegExp) => within(await screen.findByRole("article", { name }));
const viewer = async () => within(await screen.findByRole("dialog", { name: /Manual|MAG B650|Zenbook/ }));

beforeEach(() => { location.hash = ""; localStorage.clear(); read.pages = []; });
afterEach(() => { act(() => closeManual()); cleanup(); });

describe("Manuals", () => {
  it("has its own place in the navigation", async () => {
    await show("overview");
    const nav = screen.getAllByRole("link", { name: "Manuals" });
    expect(nav.length).toBeGreaterThan(0);
    fireEvent.click(nav[0]);
    expect(await screen.findByRole("heading", { name: "Manuals for Atlas" })).toBeTruthy();
  });

  it("lists Atlas's board manual as ready, with its diagram pages", async () => {
    await show("manuals");
    const board = await card(/^Motherboard:/);
    expect(board.getByText("Ready")).toBeTruthy();
    expect(board.getByText("12 pages")).toBeTruthy();
    const chips = within(board.getByRole("list", { name: /Diagrams in the/ })).getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual(expect.arrayContaining(["Board layout · p. 4", "Front panel header · p. 9"]));
  });

  it("asks for the graphics card's exact model, and offers a PDF when the maker has none", async () => {
    await show("manuals");
    const gpu = await card(/^Graphics card:/);
    fireEvent.click(gpu.getByRole("button", { name: "Find manual" }));
    expect(gpu.getByText(/Windows only knows the chip/)).toBeTruthy();
    fireEvent.change(gpu.getByLabelText("Model"), { target: { value: "GAMING X TRIO 4080" } });
    fireEvent.click(gpu.getByRole("button", { name: "Find manual" }));
    expect(await gpu.findByText(/Rig couldn't find this manual on .+'s site\./)).toBeTruthy();
    expect(gpu.getByText("Not found")).toBeTruthy();
    expect(gpu.getByRole("button", { name: "Add a PDF you have" })).toBeTruthy();
    expect(gpu.getByRole("button", { name: "Search again with a different model name" })).toBeTruthy();
  });

  it("finds and reads Pebble's service guide, then marks it ready", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    read.pages = renderSampleManual(sampleLaptopGuide("ASUS", "Zenbook 14 OLED UX3405MA")).pages;
    await show("manuals");
    expect(await screen.findByRole("heading", { name: "Manuals for Pebble" })).toBeTruthy();
    const laptop = await card(/^Laptop:/);
    expect(laptop.getByText("Rig hasn't looked for this one yet.")).toBeTruthy();
    fireEvent.click(laptop.getByRole("button", { name: "Find manual" }));
    expect(await laptop.findByText("Ready", {}, { timeout: 3000 })).toBeTruthy();
    expect(laptop.getByText("6 pages")).toBeTruthy();
    expect(laptop.getByRole("button", { name: /Inside view · p\. \d/ })).toBeTruthy();
  });

  it("searches every manual and opens the viewer at the page found", async () => {
    await show("manuals");
    await card(/^Motherboard:/);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search all manuals" }), { target: { value: "F_PANEL" } });
    const results = await screen.findAllByRole("button", { name: /Page \d+/ });
    expect(results[0].textContent).toMatch(/Page 9/);
    expect(results[0].querySelector("mark")?.textContent).toBe("F_PANEL");
    fireEvent.click(results[0]);
    const v = await viewer();
    expect((v.getByLabelText("Page number") as HTMLInputElement).value).toBe("9");
    expect(await v.findByRole("img", { name: /Page 9 of the/ })).toBeTruthy();
    expect(v.getByRole("button", { name: /Front panel header/ }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(v.getByRole("button", { name: "Next page" }));
    expect((v.getByLabelText("Page number") as HTMLInputElement).value).toBe("10");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when nothing matches", async () => {
    await show("manuals");
    await card(/^Motherboard:/);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search all manuals" }), { target: { value: "thunderbolt docking" } });
    expect(await screen.findByText(/Nothing in Atlas's manuals matches "thunderbolt docking"/)).toBeTruthy();
  });

  it("shows the board's manual on the motherboard's Manual tab", async () => {
    await show("pc");
    fireEvent.click(await screen.findByRole("button", { name: /Motherboard/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Manual" }));
    const part = await card(/^Motherboard:/);
    expect(part.getByText("12 pages")).toBeTruthy();
    fireEvent.click(part.getByRole("button", { name: "Memory slot order · p. 7" }));
    const v = await viewer();
    expect((v.getByLabelText("Page number") as HTMLInputElement).value).toBe("7");
  });

  it("points the memory part at the board manual's slot page", async () => {
    await show("pc");
    fireEvent.click(await screen.findByRole("button", { name: /^Memory/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Manual" }));
    expect(await screen.findByText(/^In the /)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Memory slot order · p. 7" })).toBeTruthy();
  });

  it("opens a manual source from a chat answer at its page", async () => {
    await show("chat");
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Where do the front panel wires go?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    const source = await screen.findByRole("button", { name: /^Manual.*p\. 9/ }, { timeout: 6000 });
    fireEvent.click(source);
    const v = await viewer();
    expect((v.getByLabelText("Page number") as HTMLInputElement).value).toBe("9");
  });
});
