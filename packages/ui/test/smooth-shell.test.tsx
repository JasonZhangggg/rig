// Interactions that should feel settled: nothing jumps or reloads under the person, a press that's still
// working says so and can't be pressed twice, and Escape closes only the thing on top.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, ManualPage, RigClient } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));
vi.mock("../src/manuals/pdf", () => ({
  loadPdfjs: async () => { throw new Error("No pdf.js in tests"); },
  closePdf: async () => {},
  readPdf: async () => ({ pages: [] as ManualPage[], pageCount: 0 }),
  renderPage: async () => ({ pageCount: 12, height: 900 }),
  isCancelled: () => false,
}));

const { RigApp } = await import("../src/App");
const { DeviceApprove } = await import("../src/pages/DeviceApprove");
const { closeManual, openManual } = await import("../src/manuals/viewerState");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

const later = <T,>() => {
  let done!: (v: T) => void, fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { done = res; fail = rej; });
  return { promise, done, fail };
};

const searchButton = () => within(screen.getByRole("complementary", { name: "Main" })).getByRole("button", { name: /Search or ask/ });

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { act(() => closeManual()); cleanup(); vi.restoreAllMocks(); });

describe("Upgrades tab", () => {
  it("starts on the kind of part Rig picked, with its pick already on top, and stays there", async () => {
    const client = new DemoClient();
    const slow = client.upgrades.bind(client);
    vi.spyOn(client, "upgrades").mockImplementation(async (id) => { await new Promise((r) => setTimeout(r, 60)); return slow(id); });
    location.hash = "#upgrades";
    render(<RigApp client={client} />);
    const rail = await screen.findByRole("navigation", { name: "Kinds of part" });
    expect(screen.getByText(/^Rig's pick for/)).toBeTruthy();
    const first = rail.querySelector('[aria-current="true"]')?.textContent;
    await new Promise((r) => setTimeout(r, 150));
    expect(rail.querySelector('[aria-current="true"]')?.textContent).toBe(first);
  });

  it("keeps the parts on screen when coming back to the tab", async () => {
    location.hash = "#upgrades";
    render(<RigApp client={new DemoClient()} />);
    await screen.findByRole("navigation", { name: "Kinds of part" });
    await open("pc");
    act(() => { location.hash = "upgrades"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(screen.queryByText(/Looking at what fits/)).toBeNull();
    expect(screen.getByRole("navigation", { name: "Kinds of part" })).toBeTruthy();
  });

  it("says it's checking while the free fix's review loads, and takes one press", async () => {
    const client = new DemoClient();
    const wait = later<never>();
    const preview = vi.spyOn(client, "preview").mockImplementation(() => wait.promise);
    location.hash = "#upgrades";
    render(<RigApp client={client} />);
    const fix = await screen.findByRole("button", { name: "Review change" });
    fireEvent.click(fix);
    const busy = screen.getByRole("button", { name: "Checking…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(preview).toHaveBeenCalledTimes(1);
  });
});

describe("Escape closes only what's on top", () => {
  it("closes search over the review sheet and leaves the sheet open", async () => {
    location.hash = "#upgrades";
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review change" }));
    const sheet = await screen.findByRole("dialog", { name: /\?$/ });
    fireEvent.click(searchButton());
    const input = within(screen.getByRole("dialog", { name: "Search" })).getByRole("textbox", { name: "Search" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    expect(sheet.isConnected).toBe(true);
  });

  it("closes search over a manual and leaves the manual open", async () => {
    const client = new DemoClient();
    client.shelf.delay = 0;
    render(<RigApp client={client} />);
    await screen.findByText(/Things to look at/i);
    const manual = (await client.manuals("demo-atlas")).find((m) => m.indexed)!;
    act(() => openManual(manual.id));
    const viewer = await screen.findByRole("dialog", { name: /Manual|MAG B650|Zenbook/ });
    fireEvent.click(searchButton());
    fireEvent.keyDown(within(screen.getByRole("dialog", { name: "Search" })).getByRole("textbox", { name: "Search" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    expect(viewer.isConnected).toBe(true);
  });

  it("closes the PC menu and keeps the open part, with focus back on the menu's button", async () => {
    render(<RigApp client={new DemoClient()} />);
    await open("pc");
    fireEvent.click(await screen.findByRole("button", { name: /Storage/ }));
    await screen.findByRole("tab", { name: "Specs" });
    const brand = screen.getByRole("button", { name: /switch PC$/ });
    fireEvent.click(brand);
    const menu = screen.getByRole("menu");
    (within(menu).getAllByRole("menuitem")[0] as HTMLElement).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("tab", { name: "Specs" })).toBeTruthy();
    expect(document.activeElement).toBe(brand);
  });
});

describe("Search", () => {
  it("keeps the highlighted line in view as the arrow keys move it", async () => {
    const seen: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { seen.push(this); };
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.click(searchButton());
    const box = within(screen.getByRole("dialog", { name: "Search" }));
    seen.length = 0;
    fireEvent.keyDown(box.getByRole("textbox", { name: "Search" }), { key: "ArrowDown" });
    fireEvent.keyDown(box.getByRole("textbox", { name: "Search" }), { key: "ArrowDown" });
    const lit = box.getAllByRole("button").find((b) => b.getAttribute("aria-current") === "true");
    expect(lit).toBeTruthy();
    expect(seen.at(-1)).toBe(lit);
  });

  it("opens a Settings section while Settings is already open, and doesn't open it again next time", async () => {
    render(<RigApp client={new DemoClient()} />);
    await open("settings");
    const about = await screen.findByRole("region", { name: "About" });
    const fold = within(about).getByRole("button", { name: /^About/ });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(searchButton());
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "version" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Search" })).getByRole("button", { name: /^About/ }));
    await waitFor(() => expect(fold.getAttribute("aria-expanded")).toBe("true"));

    await open("overview");
    await open("settings");
    const again = within(await screen.findByRole("region", { name: "About" })).getByRole("button", { name: /^About/ });
    expect(again.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Presses that take a moment", () => {
  it("clears the toast when Undo is pressed, so it can't be pressed twice", async () => {
    location.hash = "#upgrades";
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review change" }));
    fireEvent.click(await screen.findByRole("button", { name: "Make this change" }));
    const undo = await screen.findByRole("button", { name: "Undo" }, { timeout: 3000 });
    fireEvent.click(undo);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(await screen.findByText(/^Undone\./, {}, { timeout: 3000 })).toBeTruthy();
  });

  it("says it's signing out, and says so when it can't", async () => {
    const client = new DemoClient();
    const out = later<void>();
    const account: Account = { id: "u1", name: "Jo", email: "jo@example.com" } as Account;
    Object.assign(client, { kind: "web", account: async () => account, signOut: () => out.promise });
    render(<RigApp client={client as RigClient} />);
    await open("settings");
    const main = within(await screen.findByRole("main"));
    fireEvent.click(await main.findByRole("button", { name: "Sign out" }));
    const busy = main.getByRole("button", { name: "Signing out…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => { out.fail(new Error("offline")); });
    expect(await screen.findByText("Couldn't sign out just now. Check your internet connection and try again.")).toBeTruthy();
    expect((main.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("holds the Start with Windows switch while Windows asks", async () => {
    const answer = later<void>();
    const set = vi.fn(() => answer.promise);
    render(<RigApp client={new DemoClient()} host={{ autostart: { get: async () => false, set } }} />);
    await open("settings");
    const sw = await screen.findByRole("switch", { name: /Start Rig with Windows/ }) as HTMLButtonElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    fireEvent.click(sw);
    expect(sw.disabled).toBe(true);
    fireEvent.click(sw);
    expect(set).toHaveBeenCalledTimes(1);
    await act(async () => { answer.done(); });
    expect(sw.disabled).toBe(false);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("says Declining on the button that was pressed", () => {
    const client = { approveDevice: () => new Promise<void>(() => {}) } as unknown as RigClient;
    render(<DeviceApprove client={client} account={{ id: "u1", name: "Jo", email: "jo@example.com" } as Account} code="ABCD-1234" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "That wasn't me" }));
    expect(screen.getByRole("button", { name: "Declining…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approving…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("renames the PC once when Done follows typing a name", async () => {
    const client = new DemoClient();
    // Like the server: the new name comes back a moment after it's sent.
    const rename = vi.spyOn(client, "rename").mockImplementation(() => new Promise(() => {}));
    render(<RigApp client={client} />);
    await open("pc");
    fireEvent.click(await screen.findByRole("button", { name: "Customize" }));
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Forge" } });
    fireEvent.blur(name);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Customize" })).toBeNull();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(expect.any(String), { name: "Forge" });
  });

  it("dims a button that's held while a change is made", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/components.css"), "utf8");
    expect(css).toMatch(/\.btn:is\(:disabled, \[aria-disabled="true"\]\) \{ opacity: \.55; cursor: default; \}/);
  });
});
