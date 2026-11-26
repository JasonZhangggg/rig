// A widget's options panel grows out of the control that opened it: below the control it unfolds downward, and when
// there's no room below it opens upward and is marked so, so it rises from the control instead of dropping onto it.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Popover } from "../src/pages/overview/Popover";

const at = (top: number) => {
  const b = document.createElement("button");
  document.body.append(b);
  b.getBoundingClientRect = () => ({ top, bottom: top + 32, left: 900, right: 940, width: 40, height: 32, x: 900, y: top, toJSON: () => ({}) });
  return b;
};

const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;

describe("a widget's options panel", () => {
  // jsdom lays nothing out, so the panel gets the height a real one has.
  beforeEach(() => Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 300 }));
  afterEach(() => { cleanup(); document.body.innerHTML = ""; Object.defineProperty(HTMLElement.prototype, "offsetHeight", height); });

  it("opens downward under a control near the top of the window", () => {
    render(<Popover anchor={at(80)} label="Fans options" onClose={() => {}}><button type="button">Hide</button></Popover>);
    expect(screen.getByRole("dialog", { name: "Fans options" }).hasAttribute("data-up")).toBe(false);
  });

  it("opens upward, marked as rising, over a control near the bottom of the window", () => {
    render(<Popover anchor={at(window.innerHeight - 60)} label="Fans options" onClose={() => {}}><button type="button">Hide</button></Popover>);
    expect(screen.getByRole("dialog", { name: "Fans options" }).hasAttribute("data-up")).toBe(true);
  });
});
