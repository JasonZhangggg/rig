// Rough edges that were fixed: History's figures, the greeting, what shows
// when the server can't be reached, and Escape closing what's open.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, RigClient } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { greeting, firstName } = await import("../src/pages/shared");
const { limitWords } = await import("../src/pages/PCPage");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

/** The demo, but talking like the website, with parts of it failing on request. */
function webClient(over: Partial<Pick<RigClient, "account" | "machines">>): RigClient {
  const demo = new DemoClient();
  return Object.assign(Object.create(demo), { kind: "web", ...over }) as RigClient;
}

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
afterEach(() => cleanup());

describe("History figures", () => {
  it("shows how warm the graphics card runs when busy, never a bare difference as a temperature", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await open("history");
    for (const range of ["Day", "Week", "Month"]) {
      fireEvent.click(screen.getByRole("button", { name: range }));
      const card = (await screen.findByText("Graphics card when busy")).parentElement!;
      const figure = card.querySelector(".big-figure")!.textContent!;
      expect(figure, range).toMatch(/^\d+°C$/);
      expect(card.textContent, range).not.toMatch(/Steady/);
      const hottest = (await screen.findByText("Hottest moment")).parentElement!.textContent!;
      expect(hottest, range).toMatch(/(under|over) the limit|at the limit/);
    }
  });

  it("converts the differences in °F as differences, not as temperatures", async () => {
    const read = async () => {
      location.hash = "";
      render(<RigApp client={new DemoClient()} />);
      await screen.findByText(/Things to look at/i);
      await open("history");
      fireEvent.click(screen.getByRole("button", { name: "Month" }));
      const busy = (await screen.findByText(/when busy$/)).parentElement!.textContent!;
      const hottest = (await screen.findByText("Hottest moment")).parentElement!.textContent!;
      cleanup();
      const n = (text: string, re: RegExp) => { const m = text.match(re); return m ? Number(m[1]) : null; };
      return { change: n(busy, /(\d+)° (?:warmer|cooler)/), headroom: n(hottest, /(\d+)° (?:under|over) the limit/), busy, hottest };
    };
    const c = await read();
    localStorage.setItem("rig.tempUnit", "f");
    const f = await read();
    expect(f.busy + f.hottest).not.toMatch(/°C/);
    expect(c.headroom).not.toBeNull();
    expect(f.headroom).toBe(Math.round(c.headroom! * 1.8));
    if (c.change != null) expect(f.change).toBe(Math.round(c.change * 1.8));
  });
});

describe("Greeting", () => {
  it("fits the time of day, with late nights as evening", () => {
    expect([2, 5, 11, 12, 17, 18, 23].map((h) => greeting(h))).toEqual(
      ["Good evening", "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening"]);
  });

  it("uses a first name, and nothing when the name isn't one", () => {
    expect(firstName("Jason Miller")).toBe("Jason");
    expect(firstName("  jason ")).toBe("Jason");
    expect(firstName("McKenzie")).toBe("McKenzie");
    expect(firstName("jason@example.com")).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName(undefined)).toBeNull();
  });

  it("greets a signed-in person by first name, and nobody in the demo", async () => {
    const jason: Account = { id: "u1", name: "Jason Miller", email: "jason@example.com" };
    render(<RigApp client={webClient({ account: async () => jason })} />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/^Good (morning|afternoon|evening), Jason$/);
    cleanup();
    render(<RigApp client={new DemoClient()} />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/^Good (morning|afternoon|evening)$/);
  });
});

describe("When the server can't be reached", () => {
  it("says so calmly on the website instead of showing sign-in, and tries again", async () => {
    let up = false;
    const account = vi.fn(async () => { if (!up) throw new Error("Rig's server isn't answering right now."); return { id: "u1", name: "Jason", email: "j@example.com" }; });
    render(<RigApp client={webClient({ account })} requireAccount />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/can't reach its server/);
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    up = true;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByText(/Things to look at/i);
  });

  it("doesn't claim there are no PCs when the list couldn't be read", async () => {
    render(<RigApp client={webClient({ machines: async () => { throw new Error("offline"); } })} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/can't reach your PCs/);
    expect(screen.queryByText(/No PCs yet/)).toBeNull();
  });
});

describe("Escape and focus", () => {
  it("closes the search palette from anywhere and puts focus back", async () => {
    render(<RigApp client={new DemoClient()} />);
    const search = await screen.findByRole("button", { name: /Search or ask/ });
    search.focus();
    fireEvent.click(search);
    await screen.findByRole("dialog", { name: "Search" });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(document.activeElement).toBe(search);
  });

  it("lets Tab move through the palette until something is typed", async () => {
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Search or ask/ }));
    const input = within(await screen.findByRole("dialog", { name: "Search" })).getByRole("textbox", { name: "Search" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(location.hash).not.toBe("#chat");
    fireEvent.change(input, { target: { value: "fans" } });
    fireEvent.keyDown(input, { key: "Tab" });
    await waitFor(() => expect(location.hash).toBe("#chat"));
  });

  it("closes Customize, then the part's details, with Escape", async () => {
    render(<RigApp client={new DemoClient()} />);
    await open("pc");
    const customize = await screen.findByRole("button", { name: "Customize" });
    fireEvent.click(customize);
    await screen.findByRole("dialog", { name: "Customize" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Customize" })).toBeNull();
    expect(document.activeElement).toBe(customize);

    fireEvent.click(await screen.findByRole("button", { name: /Storage/ }));
    await screen.findByRole("tab", { name: "Specs" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    await screen.findByText("Parts");
  });
});

describe("Part limits", () => {
  it("says over the limit when a part is past it, not zero under", () => {
    expect(limitWords(80, 88)).toBe("8° under its 88°C limit");
    expect(limitWords(91, 88)).toBe("3° over its 88°C limit");
    expect(limitWords(88, 88)).toBe("right at its 88°C limit");
    expect(limitWords(80, undefined)).toBe("running warm");
  });

  it("converts the gap as a difference in °F, not as a temperature", () => {
    expect(limitWords(80, 88, "f")).toBe("14° under its 190°F limit");
    expect(limitWords(91, 88, "f")).toBe("5° over its 190°F limit");
  });
});
