// The graphics card's page shows its temperature on a ribbon from cool to its limit, against where it usually sits.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";
import { usualRange, type HistoryPoint } from "@rig/core";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { rangeWords } = await import("../src/pages/TempRange");

// Thursday morning, so the demo week holds Wednesday evening's Cyberpunk session and nothing is running now.
beforeEach(() => { location.hash = ""; localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 26, 10, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openPart(name: RegExp) {
  location.hash = "pc";
  render(<RigApp client={new DemoClient()} />);
  fireEvent.click(await screen.findByRole("button", { name }, { timeout: 10000 }));
  return screen.findByRole("region", { name: "Temperature" }, { timeout: 25000 });
}

describe("Temperature range", { timeout: 40000 }, () => {
  it("shows the graphics card against its limit and where it usually sits this week", async () => {
    const box = await openPart(/^Graphics card/);
    // Atlas's card hit 90°C in Cyberpunk this week, past the 88°C where it slows itself down: the room left says so.
    expect(within(box).getByText(/over its limit/).textContent).toBe("2° over its limit");
    within(box).getByText("At this week's hottest, yesterday in Cyberpunk 2077. It slows itself down from 88°C.");
    const ribbon = within(box).getByRole("img");
    expect(ribbon.getAttribute("aria-label")).toMatch(/^Now \d+°C\. Usually \d+°C to \d+°C in games\. Usually \d+°C to \d+°C at rest\. It slows itself down from 88°C\.$/);
    for (const zone of ["Cool", "Normal", "Warm", "Near the limit"]) within(box).getByText(zone);
    const key = within(box).getByText("Hottest this week").closest("dl")!;
    expect(key.textContent).toMatch(/Hottest this week90°C, yesterday/);
    expect(key.textContent).toMatch(/Usual in games\d+ to \d+°C · \d+° to spare/);
    expect(key.textContent).toMatch(/Usual at rest\d+ to \d+°C/);
    within(box).getByRole("heading", { name: /resting|game|limit|usual|Between/i });
  });

  it("works the same for the processor", async () => {
    const box = await openPart(/^Processor/);
    expect(within(box).getByRole("img").getAttribute("aria-label")).toMatch(/It slows itself down from \d+°C\.$/);
    // The room left, as one figure: "22° to spare".
    within(box).getByText((_, el) => el?.tagName === "P" && /^\d+° (to spare|over its limit)$/.test(el.textContent ?? ""));
  });
});

describe("rangeWords", () => {
  const NOW = Date.now();
  const w = (n: number, gpu: number, busy: boolean): HistoryPoint[] =>
    Array.from({ length: n }, (_, i) => ({ t: NOW - (i + 1) * 600_000, cpu: 50, gpu, busy, game: busy ? "Baldur's Gate 3" : null }));
  const range = usualRange([...w(10, 40, false), ...w(10, 76, true)], "gpu", NOW);

  it("says a reading inside the usual game range is normal for a game, and one near the limit is near it", () => {
    expect(rangeWords("busy", 76, 88, range, "c")).toEqual({ title: "Normal for a game", sub: "Where it usually sits in games: 76°C." });
    expect(rangeWords("near", 84, 88, range, "c")).toEqual({ title: "Near its limit", sub: "It slows itself down from 88°C." });
    expect(rangeWords("resting", 40, 88, range, "f")).toEqual({ title: "Its usual resting temperature", sub: "It usually rests at 104°F and sits at 169°F in games." });
    expect(rangeWords("unknown", 60, 88, null, "c").title).toBe("Normal");
  });
});
