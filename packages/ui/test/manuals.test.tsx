// Manuals: each part's Manual tab on My PC, finding and reading a manual,
// search from Ctrl K, the viewer, and manual sources in the chat. pdf.js needs a real
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
const { closeManual } = await import("../src/manuals/viewerState");

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

/** Opens a part on My PC at its Manual tab. */
async function partTab(type: string, client = demo()) {
  await show("pc", client);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${type}`) }));
  fireEvent.click(await screen.findByRole("tab", { name: "Manual" }));
}

const card = async (name: RegExp) => within(await screen.findByRole("article", { name }));
/** Opens every folded group of a manual's sections. */
const openGroups = (c: ReturnType<typeof within>) => c.queryAllByRole("button", { expanded: false }).filter((b: HTMLElement) => b.classList.contains("mn-og-head")).forEach((b: HTMLElement) => fireEvent.click(b));
const viewer = async () => within(await screen.findByRole("dialog", { name: /Manual|MAG B650|Zenbook/ }));

beforeEach(() => { location.hash = ""; localStorage.clear(); read.pages = []; });
afterEach(() => { act(() => closeManual()); cleanup(); });

describe("Manuals", () => {
  it("is a tab of My PC with every part's manual, search and drivers", async () => {
    await show("overview");
    expect(screen.queryByRole("link", { name: /^Manuals/ })).toBeNull();
    await open("manuals");
    expect(await screen.findByRole("heading", { level: 1, name: "Atlas" })).toBeTruthy();
    expect(location.hash).toBe("#manuals");
    const board = await card(/^Motherboard:/);
    expect(board.getByText("12 pages")).toBeTruthy();
    expect(board.getByRole("button", { name: "Open manual" })).toBeTruthy();
    expect(board.queryByRole("list")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Drivers and BIOS" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the manuals" }), { target: { value: "F_PANEL" } });
    const hit = await screen.findByRole("button", { name: /Page 9/ });
    fireEvent.click(hit);
    expect((await viewer()).getByLabelText("Page number")).toBeTruthy();
  });

  it("asks whether a driver is current even when the maker's download page is there too", async () => {
    await show("manuals");
    const drivers = within(screen.getByRole("heading", { level: 2, name: "Drivers and BIOS" }).closest("section")!);
    const gpu = within(drivers.getByText("NVIDIA GeForce RTX 4070 SUPER").closest("li, article, [role=listitem], .row") as HTMLElement);
    expect(gpu.getByRole("link", { name: "NVIDIA downloads" })).toBeTruthy();
    fireEvent.click(gpu.getByRole("button", { name: "Ask if there's a newer one" }));
    expect(await screen.findByText(/Is there a newer driver for my NVIDIA GeForce RTX 4070 SUPER\? I have NVIDIA 565\.90\./)).toBeTruthy();
  });

  it("on a desktop, lists the graphics card driver and the BIOS, with no laptop maker's page", async () => {
    await show("manuals");
    const drivers = within(screen.getByRole("heading", { level: 2, name: "Drivers and BIOS" }).closest("section")!);
    expect(drivers.getAllByRole("listitem").map((li) => li.querySelector(".row-title")?.textContent)).toEqual(["NVIDIA GeForce RTX 4070 SUPER", "MSI MAG B650 TOMAHAWK WIFI"]);
    expect(drivers.queryByRole("link", { name: /support$/ })).toBeNull();
    expect(drivers.queryByText(/safer pick/)).toBeNull();
    expect(screen.getByText("For your monitor, case, cooler or anything else")).toBeTruthy();
  });

  it("on a laptop, leads with the maker's support page, then the graphics driver and the BIOS", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    await show("manuals");
    expect(await screen.findByRole("heading", { level: 1, name: "Pebble" })).toBeTruthy();
    const drivers = within(screen.getByRole("heading", { level: 2, name: "Drivers and BIOS" }).closest("section")!);
    const rows = drivers.getAllByRole("listitem");
    expect(rows.map((li) => li.querySelector(".row-title")?.textContent)).toEqual(["ASUS Zenbook 14 OLED UX3405MA", "Intel Arc Graphics", "ASUS UX3405MA"]);

    const laptop = within(rows[0]);
    expect(laptop.getByText("Drivers, BIOS and manual")).toBeTruthy();
    expect(laptop.getByRole("link", { name: "ASUS support" }).getAttribute("href")).toBe("https://www.asus.com/support/download-center/");

    const graphics = within(rows[1]);
    expect(graphics.getByText("Graphics driver")).toBeTruthy();
    expect(graphics.getByText("Intel 32.0.101.6078")).toBeTruthy();
    expect(graphics.getByRole("link", { name: "Intel downloads" }).getAttribute("href")).toBe("https://www.intel.com/content/www/us/en/support/detect.html");
    expect(drivers.getByText("ASUS's own graphics driver is tested on this laptop, so it can be the safer pick than the newest one from the chip maker.")).toBeTruthy();
    expect(within(rows[2]).getByText("BIOS")).toBeTruthy();

    fireEvent.click(graphics.getByRole("button", { name: "Ask if there's a newer one" }));
    expect(await screen.findByText(/Is there a newer driver for my Intel Arc Graphics\? I have Intel 32\.0\.101\.6078\./)).toBeTruthy();
  });

  it("on a laptop, suggests a manual for a dock, monitor, mouse or charger, not a case or cooler", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    await show("manuals");
    const list = within(await screen.findByRole("region", { name: "Manuals" }));
    expect(list.getByText("For your dock, monitor, mouse or charger")).toBeTruthy();
    expect(list.queryByText(/case, cooler/)).toBeNull();
    fireEvent.click(list.getByRole("button", { name: /Add a manual/ }));
    const kinds = [...(list.getByLabelText("Kind") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(kinds).toEqual(["Monitor", "Drive", "Other"]);
    expect((list.getByLabelText("Model") as HTMLInputElement).placeholder).toBe("Like U2723QE");
  });

  it("lists each part's manual as a row, with no Ready badge and one box for opening a manual", async () => {
    await show("manuals");
    const list = within(await screen.findByRole("region", { name: "Manuals" }));
    const board = await card(/^Motherboard:/);
    expect(board.getByRole("heading", { level: 3 }).textContent).toBe("MSI MAG B650 TOMAHAWK WIFI");
    expect(board.getByText("Motherboard")).toBeTruthy();
    expect(board.queryByText("Ready")).toBeNull();
    expect(board.getByRole("button", { name: "Open manual" }).className).toContain("primary");
    const gpu = await card(/^Graphics card:/);
    expect(gpu.getByText("Rig needs the card's exact model to find its manual.")).toBeTruthy();
    expect(gpu.getByRole("button", { name: "Find manual" }).className).not.toContain("primary");
    expect(list.getAllByRole("listitem").at(-1)!.textContent).toMatch(/^Add a manual/);
  });

  it("opens Atlas's board manual from its name or the icon beside it, with Replace and Remove under the dots", async () => {
    await partTab("Motherboard");
    const board = await card(/^Motherboard:/);
    expect(board.getByText("12 pages")).toBeTruthy();
    expect(board.queryByRole("button", { name: "Open manual" })).toBeNull();
    expect(board.queryByRole("button", { name: "Replace" })).toBeNull();
    expect(board.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(board.getByRole("button", { name: /^Open the / })).toBeTruthy();
    fireEvent.click(within(board.getByRole("heading", { level: 3 })).getByRole("button"));
    expect((await viewer()).getByLabelText("Page number")).toBeTruthy();
    act(() => closeManual());
    fireEvent.click(board.getByRole("button", { name: /^More for the/ }));
    const menu = within(board.getByRole("menu"));
    expect(menu.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Replace with another PDF", "Remove this manual"]);
    fireEvent.click(menu.getByRole("menuitem", { name: "Remove this manual" }));
    expect(board.queryByRole("menu")).toBeNull();
    expect(board.getByText(/Its pages leave search and the chat/)).toBeTruthy();
  });

  it("groups the board manual's sections, with the group the part needs open and the rest folded", async () => {
    await partTab("Motherboard");
    const board = await card(/^Motherboard:/);
    const names = (list: HTMLElement) => within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    const groups = () => board.getAllByRole("button", { expanded: true }).concat(board.getAllByRole("button", { expanded: false })).filter((b) => b.classList.contains("mn-og-head"));
    expect(groups().map((b) => b.querySelector("span")?.textContent).sort()).toEqual(["About the board", "Fitting parts", "Plugging things in"]);
    expect(board.getAllByRole("list").map((l) => l.getAttribute("aria-label")?.split(",")[0])).toEqual(["Plugging things in"]);
    expect(names(board.getByRole("list"))).toEqual(["Front panel header, page 9", "Fan headers, page 10", "Power connectors, page 11", "USB headers, page 12", "RGB headers, page 12"]);
    fireEvent.click(board.getByRole("button", { name: /^Fitting parts/ }));
    expect(board.getAllByRole("list").map((l) => l.getAttribute("aria-label")?.split(",")[0])).toEqual(["Plugging things in", "Fitting parts"]);
    openGroups(board);
    expect(board.getAllByRole("list").flatMap(names)).toHaveLength(11);
    fireEvent.click(board.getByRole("button", { name: /^Plugging things in/ }));
    expect(board.getByRole("button", { name: /^Plugging things in/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("asks about the part from the box at the bottom of the Manual tab when Enter is pressed", async () => {
    await partTab("Motherboard");
    await card(/^Motherboard:/);
    const box = screen.getByRole("textbox", { name: "Ask a question about this part" });
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Where does the front USB-C go?" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(location.hash).not.toBe("#chat");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(location.hash).toBe("#chat"));
    expect(await screen.findByText(/^About my .+: Where does the front USB-C go\?$/)).toBeTruthy();
  });

  it("asks for the graphics card's exact model, and offers a PDF when the maker has none", async () => {
    await partTab("Graphics card");
    const gpu = await card(/^Graphics card:/);
    fireEvent.click(gpu.getByRole("button", { name: "Find manual" }));
    expect(gpu.getByText(/Windows only knows the chip/)).toBeTruthy();
    fireEvent.change(gpu.getByLabelText("Model"), { target: { value: "GAMING X TRIO 4080" } });
    fireEvent.click(gpu.getByRole("button", { name: "Find manual" }));
    expect(await gpu.findByText(/Rig couldn't find this manual on .+'s site\./)).toBeTruthy();
    expect(gpu.getByRole("button", { name: "Add a PDF you have" })).toBeTruthy();
    expect(gpu.getByRole("button", { name: "Search again with a different model name" })).toBeTruthy();
  });

  it("finds and reads Pebble's service guide from the laptop's Manual tab", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    read.pages = renderSampleManual(sampleLaptopGuide("ASUS", "Zenbook 14 OLED UX3405MA")).pages;
    await partTab("Laptop");
    const laptop = await card(/^Laptop:/);
    expect(laptop.getByText("Rig hasn't looked for this one yet.")).toBeTruthy();
    fireEvent.click(laptop.getByRole("button", { name: "Find manual" }));
    expect(await laptop.findByText("6 pages", {}, { timeout: 3000 })).toBeTruthy();
    openGroups(laptop);
    expect(laptop.getByRole("button", { name: /^Inside view, page \d/ })).toBeTruthy();
  });

  it("asks which case it is before looking, since Windows can't see the case", async () => {
    await partTab("Case");
    expect(await screen.findByText(/Windows can't see which case this is/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Maker"), { target: { value: "Fractal Design" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "North" } });
    fireEvent.click(screen.getByRole("button", { name: "Find manual" }));
    const found = await card(/^Case:/);
    expect(await found.findByText(/Rig couldn't find this manual on Fractal Design's site\./)).toBeTruthy();
  });

  it("adds a manual for something that isn't a part, like the monitor, on the Manuals tab", async () => {
    await show("manuals");
    const other = within(await screen.findByRole("region", { name: "Manuals" }));
    fireEvent.click(other.getByRole("button", { name: /Add a manual/ }));
    expect((other.getByLabelText("Kind") as HTMLSelectElement).value).toBe("monitor");
    fireEvent.click(other.getByRole("button", { name: "Cancel" }));
    expect(other.queryByLabelText("Kind")).toBeNull();
  });

  it("finds manual pages from Ctrl K and opens the viewer at the page found", async () => {
    await show("overview");
    fireEvent.click(screen.getByRole("button", { name: /Search or ask/ }));
    const palette = within(screen.getByRole("dialog", { name: "Search" }));
    fireEvent.change(palette.getByRole("textbox", { name: "Search" }), { target: { value: "F_PANEL" } });
    const hit = await palette.findByRole("button", { name: /^Page 9 of the/ });
    fireEvent.click(hit);
    const v = await viewer();
    expect((v.getByLabelText("Page number") as HTMLInputElement).value).toBe("9");
    expect(await v.findByRole("img", { name: /Page 9 of the/ })).toBeTruthy();
    expect(v.getByRole("button", { name: /Front panel header/ }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(v.getByRole("button", { name: "Next page" }));
    expect((v.getByLabelText("Page number") as HTMLInputElement).value).toBe("10");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("lists the diagram pages in Ctrl K by name", async () => {
    await show("overview");
    fireEvent.click(screen.getByRole("button", { name: /Search or ask/ }));
    const palette = within(screen.getByRole("dialog", { name: "Search" }));
    fireEvent.change(palette.getByRole("textbox", { name: "Search" }), { target: { value: "memory slot" } });
    expect(await palette.findByRole("button", { name: /^Memory slot order.*page 7/ })).toBeTruthy();
  });

  it("shows the board's manual on the motherboard's Manual tab", async () => {
    await show("pc");
    fireEvent.click(await screen.findByRole("button", { name: /Motherboard/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Manual" }));
    const part = await card(/^Motherboard:/);
    expect(part.getByText("12 pages")).toBeTruthy();
    fireEvent.click(part.getByRole("button", { name: /^Fitting parts/ }));
    fireEvent.click(part.getByRole("button", { name: "Memory slot order, page 7" }));
    const v = await viewer();
    expect((v.getByLabelText("Page number") as HTMLInputElement).value).toBe("7");
  });

  it("points the memory part at the board manual's slot page", async () => {
    await show("pc");
    fireEvent.click(await screen.findByRole("button", { name: /^Memory/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Manual" }));
    expect(await screen.findByText(/^In the /)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Memory slot order, page 7" })).toBeTruthy();
  });

  it("opens a manual source from a chat answer at its page", async () => {
    await show("chat");
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Where do the front panel wires go?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    const source = await screen.findByRole("button", { name: /, page 9$/ }, { timeout: 6000 });
    fireEvent.click(source);
    const v = await viewer();
    expect((v.getByLabelText("Page number") as HTMLInputElement).value).toBe("9");
  }, 15_000); // waits up to 6s for the streamed answer, longer than the default 5s test limit
});
