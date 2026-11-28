// Home's PC widget, part by part: a row per part with what it does, its reading now against its usual while you play,
// and how it's doing. New Homes start with it; a Home saved with the PC in 3D keeps the 3D view.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import type { PC } from "@rig/core";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const KEY = "rig.dashboard.v1:demo";
const stored = () => JSON.parse(localStorage.getItem(KEY)!);

/** The widget, found by its headline, once the week's history has filled it in. */
async function partByPart() {
  const heading = await screen.findByRole("heading", { name: /^Right now / });
  const widget = heading.closest("section")!;
  await within(widget).findAllByText(/this week|still learning/);
  return { heading, widget: within(widget) };
}

describe("Your PC, part by part", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("starts a new Home with each part on a line of its own, in plain words, instead of the 3D view", async () => {
    render(<RigApp client={new DemoClient()} />);
    const { heading, widget } = await partByPart();
    // Thursday morning at the desktop, the day after Cyberpunk took the card to its limit.
    expect(heading.textContent).toBe("Right now Atlas is resting, and every part is calm");
    expect(await widget.findByText("One part ran hot this week: the graphics card, in Cyberpunk 2077.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open 3D view" })).toBeNull();
    const rows = within(widget.getByRole("list", { name: "Parts" })).getAllByRole("button");
    expect(rows.map((r) => r.querySelector(".pbp-name b")!.firstChild!.textContent)).toEqual(["Graphics card", "Processor", "Memory", "Main drive", "Motherboard", "Fans", "Power supply", "Case"]);
    const card = within(rows[0]);
    expect(card.getByText("RTX 4070 SUPER")).toBeTruthy();
    expect(card.getByText("Draws every frame of your games")).toBeTruthy();
    expect(card.getByText(/^usual \d+–\d+°$/)).toBeTruthy();
    expect(card.getByText("Calm")).toBeTruthy();
    expect(card.getByText(/^Hit \d+° in Cyberpunk 2077, [A-Z][a-z]{2} \d+$/).className).toBe("look");
    expect(within(rows[1]).getByText(/^\d+° at most this week$/).className).toBe("");
    expect(within(rows[6]).getByText("Rig can't read it")).toBeTruthy();
    expect(widget.getByText("Its usual while you play")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it("says a laptop's processor at its limit in a game is working as built, in the headline and on its row", async () => {
    /** Comet in a long game: its processor at its limit, at full speed, with nothing in Things to look at about it. */
    class AtLimit extends DemoClient {
      override watch(id: string, cb: (pc: PC) => void) {
        return super.watch(id, (pc) => {
          const cpu = pc.parts!.cpu;
          cb({ ...pc, parts: { ...pc.parts, cpu: { ...cpu, temp: cpu.limit, load: 85 } }, issues: pc.issues?.filter((i) => i.id !== "cpu-hot") });
        });
      }
    }
    localStorage.setItem("rig.pc", "demo-comet");
    render(<RigApp client={new AtLimit()} />);
    const { heading, widget } = await partByPart();
    expect(heading.textContent).toBe("Right now Comet is working hard, and the processor is at its limit, as built");
    expect(widget.getByText("Nothing ran hot this week.")).toBeTruthy();
    expect(widget.queryByText(/slowing|parts? ran hot/i)).toBeNull();
    const row = within(within(widget.getByRole("list", { name: "Parts" })).getAllByRole("button").find((r) => r.textContent?.startsWith("Processor"))!);
    expect(row.getByText("At its limit, as built").className).toBe("");
  });

  it("reads a laptop's battery by its charge, and leaves out the parts Rig can never read", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    render(<RigApp client={new DemoClient()} />);
    const { widget } = await partByPart();
    const rows = within(widget.getByRole("list", { name: "Parts" })).getAllByRole("button");
    expect(rows.map((r) => r.querySelector(".pbp-name b")!.firstChild!.textContent)).toEqual(["Processor", "Memory", "Main drive", "Motherboard", "Fans", "Battery"]);
    const battery = within(rows[5]);
    expect(battery.getByText("58")).toBeTruthy();
    expect(battery.getByText("On battery")).toBeTruthy();
    // Running down, its charge now is the week's lowest: said once, beside the row, not again under it.
    expect(battery.getByText("Its lowest this week")).toBeTruthy();
    expect(rows[5].textContent!.match(/58/g)).toHaveLength(1);
    expect(widget.queryByText("Rig can't read it")).toBeNull();
    expect(widget.queryByText("No sensor Windows can read")).toBeNull();
  });

  it("says a battery held at one charge all week once, not three times", async () => {
    localStorage.setItem("rig.pc", "demo-comet");
    // Without the night off its charger, which the row would say instead (battery.test.tsx).
    const client = new DemoClient();
    const watch = client.watch.bind(client);
    client.watch = (id, cb) => watch(id, (pc) => cb({ ...pc, ...(pc.battery ? { battery: { ...pc.battery, sleeps: undefined } } : {}) }));
    render(<RigApp client={client} />);
    const { widget } = await partByPart();
    const row = within(widget.getByRole("list", { name: "Parts" })).getAllByRole("button").find((r) => r.textContent?.startsWith("Battery"))!;
    expect(within(row).getByText("80")).toBeTruthy();
    expect(within(row).getByText("Held there all week")).toBeTruthy();
    expect(row.textContent!.match(/80/g)).toHaveLength(1);
  });

  it("words the usual for work when the busy hours weren't games", async () => {
    const client = new DemoClient();
    const history = client.history.bind(client);
    client.history = async (...args: Parameters<typeof history>) => (await history(...args)).map((p) => ({ ...p, game: null }));
    render(<RigApp client={client} />);
    const { widget } = await partByPart();
    // The usual is worded once the week's readings load, so wait for it.
    expect(await widget.findByText("Its usual when busy")).toBeTruthy();
    expect(widget.queryByText("Its usual while you play")).toBeNull();
  });

  it("opens a part in My PC from its row", async () => {
    render(<RigApp client={new DemoClient()} />);
    const { widget } = await partByPart();
    fireEvent.click(widget.getByRole("button", { name: /^Processor/ }));
    await waitFor(() => expect(location.hash).toBe("#pc"));
    expect(await screen.findByRole("button", { name: "Reset view" })).toBeTruthy();
  });

  it("says Rig is still learning each part's usual on a PC with no history yet", async () => {
    const client = new DemoClient();
    client.history = async () => [];
    render(<RigApp client={client} />);
    const { widget } = await partByPart();
    expect(widget.getByText(/^Rig learns each part's usual from a few days of using Atlas\.$/)).toBeTruthy();
    expect(widget.queryByText(/^usual /)).toBeNull();
    expect(widget.queryByText(/ran hot/)).toBeNull();
  });

  it("keeps a Home saved with the 3D view, and switches between the two from the widget's options", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, widgets: [{ id: "pc", kind: "pc", style: "showcase" }], spacing: "normal" }));
    render(<RigApp client={new DemoClient()} />);
    expect(await screen.findByRole("link", { name: "Open 3D view" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Right now / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customize Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Your PC options" }));
    const panel = within(screen.getByRole("dialog", { name: "Your PC options" }));
    expect(panel.getByRole("switch", { name: "Turn slowly" })).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: "Part by part" }));
    await partByPart();
    expect(stored().widgets.find((w: { kind: string }) => w.kind === "pc").style).toBe("parts");
    // The 3D view's own switches leave; part names still apply.
    expect(panel.queryByRole("switch", { name: "Turn slowly" })).toBeNull();
    expect(panel.queryByRole("switch", { name: "Show heat and exploded buttons" })).toBeNull();
    fireEvent.click(panel.getByRole("switch", { name: "Show part names" }));
    await waitFor(() => expect(screen.queryByText("RTX 4070 SUPER")).toBeNull());
  });

  it("keeps a PC widget saved before it had styles in 3D", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, widgets: [{ id: "pc", kind: "pc", hidden: false, size: "l" }] }));
    render(<RigApp client={new DemoClient()} />);
    expect(await screen.findByRole("link", { name: "Open 3D view" })).toBeTruthy();
  });
});

describe("Part by part's stylesheet", () => {
  it("gives the reading now room for a fan's figure and its unit, so 2,580 rpm keeps clear of the track", () => {
    let cols = "";
    postcss.parse(readFileSync(join(__dirname, "../src/styles/pages/partbypart.css"), "utf8")).walkRules(/^\.pbp-cols, \.pbp-row$/, (r) => r.walkDecls("grid-template-columns", (d) => { cols = d.value; }));
    const now = cols.split(/\s+(?![^(]*\))/)[1];
    expect(parseFloat(now)).toBeGreaterThanOrEqual(72);
  });
});
