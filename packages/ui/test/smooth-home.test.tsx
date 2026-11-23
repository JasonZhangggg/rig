// Home's customizing feels steady: finishing doesn't jump the page, focus stays where the person was, moves that can't
// happen show as dimmed, the bar's buttons shut what they open, a phone's sheet shuts without pressing what's under it,
// and the week's charts keep their room while history loads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import { FansCard } from "../src/pages/overview/FansCard";
import { KIND_ORDER } from "../src/pages/overview/layout";
import { TempsCard } from "../src/pages/overview/TempsCard";
import { WeekCard } from "../src/pages/overview/WeekCard";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const width = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!;
const rect = Element.prototype.getBoundingClientRect;
const innerWidth = window.innerWidth;
/** Lays Home out as a phone's one column list. */
const phone = () => Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get() { return (this as HTMLElement).classList.contains("dash") ? 380 : 0; } });

const customize = async () => {
  render(<RigApp client={new DemoClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Customize Home" }));
  return within(screen.getByRole("toolbar", { name: "Customize Home" }));
};
const tiles = () => screen.getAllByRole("group", { name: /, place \d+ of \d+$/ });
const titleOf = (tile: HTMLElement) => tile.getAttribute("aria-label")!.split(",")[0];
const inOrder = () => [...tiles()].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

describe("customizing Home smoothly", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(Element.prototype, "clientWidth", width);
    Element.prototype.getBoundingClientRect = rect;
    window.innerWidth = innerWidth;
  });

  it("puts focus back on Customize Home after Done without scrolling the page", async () => {
    const bar = await customize();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    fireEvent.click(bar.getByRole("button", { name: "Done" }));
    const button = screen.getByRole("button", { name: "Customize Home" });
    expect(document.activeElement).toBe(button);
    expect(focus.mock.contexts.includes(button)).toBe(true);
    for (const [i, el] of focus.mock.contexts.entries()) if (el === button) expect(focus.mock.calls[i][0]).toEqual({ preventScroll: true });
  });

  it("keeps focus on the widget customizing was finished from", async () => {
    await customize();
    const fans = screen.getByRole("group", { name: /^Fans, / });
    fans.focus();
    fireEvent.keyDown(fans, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Customize Home" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Fans" }));
  });

  it("dims the move arrows a widget can't use, and keeps focus on an arrow that still moves it", async () => {
    await customize();
    const first = tiles().find((t) => t.getAttribute("aria-label")!.endsWith("place 1 of 8"))!;
    const name = titleOf(first);
    fireEvent.click(screen.getByRole("button", { name: `${name} options` }));
    const panel = within(screen.getByRole("dialog", { name: `${name} options` }));
    expect(panel.getByRole("button", { name: "Move up" })).toHaveProperty("disabled", true);
    expect(panel.getByRole("button", { name: "Move left" })).toHaveProperty("disabled", true);
    const down = panel.getByRole("button", { name: "Move down" });
    expect(down).toHaveProperty("disabled", false);
    // Moved back up to the top, its Move up arrow dims and focus steps to one that still works.
    fireEvent.click(down);
    const up = panel.getByRole("button", { name: "Move up" });
    expect(up).toHaveProperty("disabled", false);
    up.focus();
    fireEvent.click(up);
    expect(up).toHaveProperty("disabled", true);
    expect(document.activeElement).not.toBe(up);
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("dialog", { name: `${name} options` }).contains(document.activeElement)).toBe(true);
  });

  it("shuts the bar's panels when their button is pressed again, and says which is open", async () => {
    const bar = await customize();
    for (const [button, dialog] of [["Add widget", "Add widget"], ["Layout", "Home layout"], ["Reset", "Reset Home?"]]) {
      const b = bar.getByRole("button", { name: new RegExp(`^${button}`) });
      expect(b.getAttribute("aria-expanded")).toBe("false");
      fireEvent.pointerDown(b);
      fireEvent.click(b);
      expect(screen.getByRole("dialog", { name: dialog })).toBeTruthy();
      expect(b.getAttribute("aria-expanded")).toBe("true");
      fireEvent.pointerDown(b);
      fireEvent.click(b);
      expect(screen.queryByRole("dialog", { name: dialog })).toBeNull();
      expect(b.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(b);
    }
  });

  it("keeps focus in the widget library after adding one, on the one that takes its place", async () => {
    const bar = await customize();
    for (const name of ["Fans", "Evenings"]) fireEvent.keyDown(screen.getByRole("group", { name: new RegExp(`^${name}, `) }), { key: "Delete" });
    fireEvent.click(bar.getByRole("button", { name: /^Add widget/ }));
    const panel = within(screen.getByRole("dialog", { name: "Add widget" }));
    const before = panel.getAllByRole("button", { name: /Add$/ });
    before[0].focus();
    fireEvent.click(before[0]);
    const left = panel.getAllByRole("button", { name: /Add$/ });
    expect(left).toHaveLength(before.length - 1);
    expect(document.activeElement).toBe(left[0]);
  });

  it("keeps focus in the library when an empty Home's Add widget button gives way to the bar's", async () => {
    localStorage.setItem("rig.dashboard.v1:demo", JSON.stringify({ v: 2, widgets: KIND_ORDER.map((kind) => ({ kind, hidden: true })) }));
    render(<RigApp client={new DemoClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add widget" }));
    const panel = within(screen.getByRole("dialog", { name: "Add widget" }));
    const [first] = panel.getAllByRole("button", { name: /Add$/ });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(screen.queryByText(/Home is empty/)).toBeNull());
    expect(document.activeElement).toBe(panel.getAllByRole("button", { name: /Add$/ })[0]);
  });

  it("shuts a phone's options sheet on the tap's click, not as the finger lands", async () => {
    window.innerWidth = 380;
    const bar = await customize();
    fireEvent.click(bar.getByRole("button", { name: "Layout" }));
    const scrim = document.querySelector<HTMLElement>(".dpop-scrim")!;
    expect(scrim).toBeTruthy();
    fireEvent.pointerDown(scrim);
    expect(screen.getByRole("dialog", { name: "Home layout" })).toBeTruthy();
    fireEvent.click(scrim);
    expect(screen.queryByRole("dialog", { name: "Home layout" })).toBeNull();
  });
});

describe("customizing Home on a phone", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; phone(); });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(Element.prototype, "clientWidth", width);
    Element.prototype.getBoundingClientRect = rect;
  });

  it("keeps the first widget on screen where it was when the list opens up for customizing", async () => {
    render(<RigApp client={new DemoClient()} />);
    await waitFor(() => expect(document.querySelector(".dash[data-cols='1'] .dg")).toBeTruthy());
    await act(async () => {});
    // Each tile sits 300 pixels below the last, and customizing opens 56 more above each.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const item = this.closest(".dg");
      if (!item || item !== this) return rect.call(this);
      const i = [...item.parentElement!.children].filter((c) => c.classList.contains("dg")).indexOf(item);
      const top = i * 300 + (item.closest(".dash.editing") ? 56 * (i + 1) : 0) - 100;
      return { top, bottom: top + 280, left: 0, right: 380, width: 380, height: 280, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    const scroll = vi.fn();
    window.scrollBy = scroll as typeof window.scrollBy;
    fireEvent.click(screen.getByRole("button", { name: "Customize Home" }));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.calls[0][0]).toMatchObject({ top: 56 });
  });

  it("keeps focus on a widget moved down with the arrow keys", async () => {
    await customize();
    const [top] = inOrder();
    const name = titleOf(top);
    top.focus();
    fireEvent.keyDown(top, { key: "ArrowDown" });
    expect(titleOf(inOrder()[1])).toBe(name);
    expect(document.activeElement).toBe(screen.getByRole("group", { name: new RegExp(`^${name}, `) }));
  });

  it("keeps focus on a step button after a move, or moves it to the other one once the end is reached", async () => {
    await customize();
    const name = titleOf(inOrder()[0]);
    const down = screen.getByRole("button", { name: `Move ${name} down` });
    down.focus();
    fireEvent.click(down);
    expect(titleOf(inOrder()[1])).toBe(name);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: `Move ${name} down` }));
    const up = screen.getByRole("button", { name: `Move ${name} up` });
    up.focus();
    fireEvent.click(up);
    expect(titleOf(inOrder()[0])).toBe(name);
    expect(screen.getByRole("button", { name: `Move ${name} up` })).toHaveProperty("disabled", true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: `Move ${name} down` }));
  });
});

describe("the week's charts while history loads", () => {
  afterEach(() => cleanup());

  it("keep their room, so nothing below them jumps when the history arrives", () => {
    const cards = [
      render(<TempsCard temps={null} name="Atlas" />).container,
      render(<WeekCard week={null} recorded={false} name="Atlas" />).container,
      render(<FansCard fans={[{ label: "CPU fan", rpm: 900, max: 2000 }] as never} trend={null} />).container,
    ];
    for (const card of cards) {
      expect(card.querySelector("section")!.getAttribute("aria-busy")).toBe("true");
      expect(card.querySelector(".pl-wait")).toBeTruthy();
    }
  });
});

describe("Home's stylesheet", () => {
  const css = (file: string) => postcss.parse(readFileSync(join(__dirname, "../src/styles/pages", file), "utf8"));
  const inMedia = (file: string, media: RegExp) => {
    const out: string[] = [];
    css(file).walkAtRules("media", (at) => { if (media.test(at.params)) at.walkRules((r) => { out.push(r.selector); }); });
    return out.join("\n");
  };

  it("lets a finger through the unseen handle outside customizing, so a swipe scrolls and a long press customizes", () => {
    expect(inMedia("dash.css", /pointer: coarse/)).toMatch(/\.dash:not\(\.editing\) \.dw-grip/);
  });

  it("answers a pointer over Home's round buttons and a widget's buttons", () => {
    const hover = inMedia("home.css", /hover: hover/) + inMedia("dash.css", /hover: hover/);
    for (const sel of [/\.f-cta:hover/, /\.f-round[^\n]*:hover/, /\.dw-del:hover/, /\.dw-opt:hover/, /\.dw-steps button[^\n]*:hover/]) expect(hover).toMatch(sel);
  });
});
