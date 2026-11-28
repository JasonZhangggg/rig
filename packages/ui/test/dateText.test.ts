import { describe, expect, it } from "vitest";
import { dateText } from "../src/dateText";

describe("dates and times in words", () => {
  const t = new Date(2026, 10, 27, 15, 4, 9).getTime();
  const shapes: Intl.DateTimeFormatOptions[] = [
    { hour: "numeric", minute: "2-digit" }, { hour: "numeric", minute: "2-digit", second: "2-digit" }, { hour: "numeric" },
    { month: "short", day: "numeric" }, { weekday: "long" }, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  ];
  it("reads the same as the date's own words, for a date or a time number, again and again", () => {
    for (const o of shapes) for (let i = 0; i < 2; i++) {
      expect(dateText(t, o)).toBe(new Date(t).toLocaleString(undefined, o));
      expect(dateText(new Date(t), o)).toBe(new Date(t).toLocaleString(undefined, o));
    }
  });
  it("says Invalid Date for a date it can't read, as the date would, instead of breaking the page", () => {
    expect(dateText(new Date("not a date"), { month: "short" })).toBe("Invalid Date");
  });
});
