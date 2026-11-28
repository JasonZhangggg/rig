import { afterEach, describe, expect, it, vi } from "vitest";
import { whileShown } from "../src/whileShown";

let state: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
const show = (s: DocumentVisibilityState) => { state = s; document.dispatchEvent(new Event("visibilitychange")); };

// The setup fakes only the clock; this test fakes the timers too, then puts the setup's back.
afterEach(() => { vi.useRealTimers(); vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); show("visible"); });

describe("whileShown", () => {
  it("asks again every so often while the page is in view, not at all while it's hidden, and once as soon as it's back", () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    const look = vi.fn();
    const stop = whileShown(look, 15_000);
    vi.advanceTimersByTime(30_000);
    expect(look).toHaveBeenCalledTimes(2);
    show("hidden");
    vi.advanceTimersByTime(60 * 60_000);
    expect(look).toHaveBeenCalledTimes(2);
    show("visible");
    expect(look).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15_000);
    expect(look).toHaveBeenCalledTimes(4);
    // Hidden and shown again before the next look was due: nothing was missed, so nothing extra is asked.
    show("hidden"); show("visible");
    expect(look).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(60_000);
    show("hidden"); show("visible");
    expect(look).toHaveBeenCalledTimes(4);
  });
});
