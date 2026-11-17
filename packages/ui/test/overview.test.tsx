// The home charts on a PC with little or no history: calm words instead of
// broken charts, and gaps instead of zeros.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fanTrend, insightContext, weekTemps, type HistoryPoint } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { FansCard } from "../src/pages/overview/FansCard";
import { TempsCard } from "../src/pages/overview/TempsCard";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

describe("Home charts", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("says Rig is still learning on a PC with no history yet", async () => {
    const client = new DemoClient();
    client.history = async () => [];
    render(<RigApp client={client} />);
    expect(await screen.findAllByText(/Rig is still learning this week/)).toHaveLength(2);
    expect(screen.getByText(/still learning how fast the fans run/)).toBeTruthy();
    expect(screen.queryByRole("img", { name: /°C/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it("leaves days without readings empty rather than at zero", () => {
    const now = Date.now();
    const points: HistoryPoint[] = [{ t: now - 60_000, cpu: 44, gpu: null, busy: false }];
    const ctx = insightContext({ kind: "tower" }, now);
    render(<TempsCard temps={weekTemps(points, ctx)} name="Atlas" />);
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")!.match(/no readings/g)).toHaveLength(6);
    expect(chart.textContent).not.toMatch(/\b0\b|NaN/);
  });

  it("hides the fan speeds on a PC that reports none", () => {
    const ctx = insightContext({ kind: "laptop" });
    const { container } = render(<FansCard fans={[]} trend={fanTrend([], ctx)} />);
    expect(screen.getByText(/doesn't report fan speeds/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d/);
  });
});
