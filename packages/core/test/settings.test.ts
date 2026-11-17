import { describe, expect, it } from "vitest";
import { exportFileName, formatTemp, makeExport, tempsInText, toUnit, type HistoryPoint } from "../src";
import { DemoClient } from "../src/demo";

describe("formatTemp", () => {
  it("shows Celsius readings in the chosen unit", () => {
    expect(formatTemp(72, "c")).toBe("72°C");
    expect(formatTemp(72, "f")).toBe("162°F");
    expect(formatTemp(0, "f")).toBe("32°F");
    expect(formatTemp(-40, "f")).toBe("-40°F");
    expect(formatTemp(36.6, "c", { digits: 1 })).toBe("36.6°C");
  });

  it("scales a difference without the 32 offset", () => {
    expect(toUnit(10, "f", true)).toBe(18);
    expect(formatTemp(5, "f", { delta: true, sign: true, mark: "degree" })).toBe("+9°");
    expect(formatTemp(-3, "c", { delta: true, sign: true })).toBe("-3°C");
    expect(formatTemp(-0.2, "c", { delta: true, sign: true })).toBe("0°C");
    // A 6°C difference is 11°F, not the 43°F that 6°C reads as.
    expect(formatTemp(6, "f", { delta: true, mark: "degree" })).toBe("11°");
    expect(formatTemp(6, "f")).toBe("43°F");
  });

  it("writes the degree mark, or nothing, when asked", () => {
    expect(formatTemp(90, "f", { mark: "degree" })).toBe("194°");
    expect(formatTemp(90, "f", { mark: "none" })).toBe("194");
  });

  it("shows a dash when there's no reading", () => {
    expect(formatTemp(null, "c")).toBe("–");
    expect(formatTemp(undefined, "f")).toBe("–");
    expect(formatTemp(Number.NaN, "f")).toBe("–");
  });
});

describe("tempsInText", () => {
  it("converts readings and differences in a sentence written in °C", () => {
    expect(tempsInText("Processor runs warm at 88°C", "f")).toBe("Processor runs warm at 190°F");
    expect(tempsInText("That's 7° under its 95°C limit.", "f")).toBe("That's 13° under its 203°F limit.");
  });

  it("leaves Celsius text and text without temperatures alone", () => {
    const s = "That's 7° under its 95°C limit.";
    expect(tempsInText(s, "c")).toBe(s);
    expect(tempsInText("Turn off 3 startup apps", "f")).toBe("Turn off 3 startup apps");
  });
});

describe("makeExport", () => {
  const view = (name: string) => ({ id: name, name, kind: "tower" as const, accent: "#000000", nickname: "", os: "", health: 90, lastSync: "", online: true, summary: "" });
  const pts = (...t: number[]): HistoryPoint[] => t.map((x) => ({ t: x, cpu: 50, gpu: null, busy: false }));

  it("sorts PCs by name and each history oldest first", () => {
    const out = makeExport({
      account: { id: "u1", name: "Jo", email: "jo@example.com" },
      machines: [
        { id: "b", view: view("Zed"), inventory: null, facts: null, changes: [], games: [], history: pts(3, 1, 2) },
        { id: "a", view: view("Atlas"), inventory: null, facts: null, identity: { name: "Alpha" }, changes: [], games: [], history: [] },
      ],
      chatUsage: [{ day: "2026-11-02", count: 1 }, { day: "2026-11-01", count: 4 }],
      now: new Date("2026-11-17T10:00:00Z"),
    });
    expect(out.format).toBe("rig-export/1");
    expect(out.exportedAt).toBe("2026-11-17T10:00:00.000Z");
    expect(out.machines.map((m) => m.name)).toEqual(["Alpha", "Zed"]);
    expect(out.machines[1].history.map((p) => p.t)).toEqual([1, 2, 3]);
    expect(out.chatUsage.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it("names the file after the local date", () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 30))).toBe("rig-data-2026-01-05.json");
  });

  it("exports the demo PCs with a month of history", async () => {
    const out = await new DemoClient().exportData();
    expect(out.account?.email).toBe("demo@rig.app");
    expect(out.machines.map((m) => m.name)).toEqual(["Atlas", "Pebble"]);
    expect(out.machines[0].history.length).toBeGreaterThan(30 * 100);
    expect(out.machines[0].inventory).not.toBeNull();
  });
});
