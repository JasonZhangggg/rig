import { describe, expect, it } from "vitest";
import { askAgainAt } from "../src/dailyReset";

describe("when the daily allowance starts again", () => {
  it("says the time on the person's own clock", () => {
    // 3 PM in New York on Nov 27 is 20:00 UTC, so the allowance resets at 7 PM there the same day.
    expect(askAgainAt(new Date("2026-11-27T20:00:00Z"), "America/New_York")).toBe("at 7:00 PM");
  });

  it("says tomorrow when the reset falls on the next day there", () => {
    // 10 PM in Tokyo on Nov 27 is 13:00 UTC; midnight UTC is 9 AM on Nov 28 in Tokyo.
    expect(askAgainAt(new Date("2026-11-27T13:00:00Z"), "Asia/Tokyo")).toBe("tomorrow at 9:00 AM");
  });

  it("falls back to UTC without a time zone it knows", () => {
    expect(askAgainAt(new Date("2026-11-27T13:00:00Z"))).toBe("at midnight UTC");
    expect(askAgainAt(new Date("2026-11-27T13:00:00Z"), "Not/AZone")).toBe("at midnight UTC");
  });
});
