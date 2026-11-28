import { describe, expect, it } from "vitest";
import { healthWhy } from "../src/pages/overview/widgets";

describe("Health tile's line", () => {
  it("names the areas that hold the score down, lowest first, and leaves what's wrong to Things to look at", () => {
    expect(healthWhy([
      { label: "Temperatures", value: 92, note: "Graphics card runs hotter than it used to", sev: "warn" },
      { label: "Startup and speed", value: 80, note: "8 apps start with Windows", sev: "warn" },
      { label: "Storage", value: 100, note: "Plenty of free space", sev: "ok" },
    ], "Running well.")).toBe("Below full marks: Startup and speed, Temperatures.");
    expect(healthWhy([
      { label: "Battery", value: 90, note: "Used 39% of the battery asleep last night", sev: "warn" },
      { label: "Storage", value: 100, note: "Plenty of free space", sev: "ok" },
    ], "Running well.")).toBe("Below full marks: Battery. Every other check passed.");
  });
  it("says every check passed when nothing does", () => {
    expect(healthWhy([{ label: "Storage", value: 100, note: "Plenty of free space", sev: "ok" }], "Running well.")).toBe("Every check passed.");
  });
  it("falls back to the summary with no breakdown", () => {
    expect(healthWhy(undefined, "Running well.")).toBe("Running well.");
  });
});
