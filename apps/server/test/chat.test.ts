import { describe, expect, it } from "vitest";
import type { PC } from "@rig/core";
import { compactReadings, describePC } from "../src/chat";

const pc = (o: Partial<PC> = {}): PC => ({
  id: "p", name: "Atlas", kind: "tower", accent: "", nickname: "", os: "Windows 11", health: 80, lastSync: "now", online: true, summary: "", ...o,
});

describe("what the chat knows about the PC", () => {
  it("passes on each issue's evidence and how sure Rig is", () => {
    const block = describePC({
      view: pc({ issues: [{ id: "shutdowns-load", part: "psu", severity: "bad", title: "The PC shut off twice under load", body: "Points at the power supply.", evidence: ["Nov 18, 9:02 PM: graphics card 66°C at 97% load"], confidence: "likely", action: "", go: "chat" }] }),
      facts: null, inventory: null,
    });
    expect(block).toContain('"evidence":["Nov 18, 9:02 PM: graphics card 66°C at 97% load"]');
    expect(block).toContain('"confidence":"likely"');
  });

  it("gives the readings the parts list leaves out, most useful first and capped", () => {
    const lines = compactReadings([
      { id: "c", part: "cpu", name: "Core Clock", type: "clock", value: 5012.4, max: 5250 },
      { id: "h", part: "gpu", name: "GPU Hot Spot", type: "temperature", value: 78.4, max: 91 },
      { id: "v", part: "board", name: "+12V", type: "voltage", value: 11.832, max: 11.832 },
      { id: "x", part: "gpu", name: "GPU Memory Used", type: "data", value: 7.2 },
      { id: "n", part: "fans", name: "Fan #2", type: "fan", value: null },
    ]);
    expect(lines).toEqual(["gpu: GPU Hot Spot 78°C (max 91)", "board: +12V 11.83 V", "cpu: Core Clock 5012 MHz (max 5250)"]);
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, part: "cpu", name: `Core #${i}`, type: "temperature" as const, value: 50 }));
    expect(compactReadings(many)).toHaveLength(80);
    expect(compactReadings([])).toBeUndefined();
  });
});
