import { describe, expect, it } from "vitest";
import { healthWhy } from "../src/pages/overview/widgets";

describe("Health tile's line", () => {
  it("names what holds the score down, lowest first", () => {
    expect(healthWhy([
      { label: "Temperatures", value: 92, note: "Graphics card runs hotter than it used to", sev: "warn" },
      { label: "Startup and speed", value: 80, note: "8 apps start with Windows", sev: "warn" },
      { label: "Storage", value: 100, note: "Plenty of free space", sev: "ok" },
    ], "Running well.")).toBe("Startup and speed: 8 apps start with Windows.");
  });
  it("says every check passed when nothing does", () => {
    expect(healthWhy([{ label: "Storage", value: 100, note: "Plenty of free space", sev: "ok" }], "Running well.")).toBe("Every check passed.");
  });
  it("falls back to the summary with no breakdown", () => {
    expect(healthWhy(undefined, "Running well.")).toBe("Running well.");
  });
});
