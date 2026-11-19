// The line chart's readout: the nearest reading's time and values, by pointer, keys or a pinned moment.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HistoryPoint } from "@rig/core";
import { LineChart } from "../src/chart";

const t0 = new Date(2026, 10, 18, 20, 0).getTime();
const points: HistoryPoint[] = Array.from({ length: 30 }, (_, i) => ({ t: t0 + i * 6e4, cpu: 50 + i, gpu: 60 + i, busy: false }));
const series = [{ key: "cpu" as const, cls: "cpu" }, { key: "gpu" as const, cls: "gpu" }];
// jsdom has no PointerEvent, so a pointer would carry no position; a mouse event with a pointer type stands in.
if (!("PointerEvent" in window)) {
  class PointerEvent extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? "mouse"; }
  }
  Object.assign(window, { PointerEvent });
}
const live = () => document.querySelector("[aria-live]")!.textContent;

afterEach(() => cleanup());

describe("LineChart readout", () => {
  it("moves one reading with the arrow keys, ten with Shift, and hides with Escape", () => {
    render(<LineChart points={points} series={series} label="Temperatures" />);
    const chart = screen.getByRole("img", { name: "Temperatures" });
    expect(chart.getAttribute("tabindex")).toBe("0");
    expect(live()).toBe("");

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(live()).toMatch(/: Processor 50°C, Graphics card 60°C$/);
    expect(document.querySelector(".chart-tip")!.textContent).toContain("Graphics card60°C");
    expect(document.querySelectorAll(".chart-dot")).toHaveLength(2);

    fireEvent.keyDown(chart, { key: "ArrowRight", shiftKey: true });
    expect(live()).toMatch(/Processor 60°C, Graphics card 70°C$/);
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(live()).toMatch(/Processor 59°C/);
    fireEvent.keyDown(chart, { key: "End" });
    expect(live()).toMatch(/Processor 79°C/);

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(live()).toBe("");
    expect(document.querySelector(".chart-tip")).toBeNull();
  });

  it("shows load in percent and holds a pinned moment, letting go on Escape", () => {
    let unpinned = false;
    render(<LineChart points={points} series={series} unit="percent" pin={t0 + 10 * 6e4 + 1000} onUnpin={() => { unpinned = true; }} label="Load" />);
    expect(live()).toMatch(/: Processor 60%, Graphics card 70%$/);
    const chart = screen.getByRole("img", { name: "Load" });
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(live()).toBe("");
    expect(unpinned).toBe(true);
  });

  it("shows the reading nearest the pointer and hides when it leaves", () => {
    render(<LineChart points={points} series={series} />);
    const chart = screen.getByRole("img", { name: "Temperature history" });
    chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 860, height: 300, right: 860, bottom: 300, x: 0, y: 0, toJSON: () => ({}) });
    // The plot runs from x 40 to 844; its far end is the last reading.
    fireEvent.pointerMove(chart, { clientX: 844, pointerType: "mouse" });
    expect(live()).toMatch(/Processor 79°C/);
    fireEvent.pointerLeave(chart, { pointerType: "mouse" });
    expect(live()).toBe("");
  });
});
