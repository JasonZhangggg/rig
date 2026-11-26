// A recording's bar shows how far along it is. The fill slides in from the left rather than growing, so it moves on
// the GPU and keeps its round end, and halfway through a recording it covers half the bar.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingInfo } from "@rig/core";
import { Progress } from "../src/pages/logs/RecordingCard";

describe("a recording's progress bar", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("fills half the bar halfway through", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000 + 30 * 60_000);
    const r = { state: "recording", startedAt: 1_000_000, endsAt: 1_000_000 + 60 * 60_000, sampleCount: 12 } as RecordingInfo;
    render(<Progress r={r} />);
    const bar = screen.getByRole("progressbar", { name: "Recording progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect((bar.firstElementChild as HTMLElement).style.transform).toBe("translateX(-50%)");
  });
});
