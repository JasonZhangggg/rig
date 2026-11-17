import { describe, expect, it } from "vitest";
import { seenLabel } from "../src";

const now = Date.parse("2026-11-17T20:00:00.000Z");

describe("seenLabel", () => {
  it("turns the server's sync time into words instead of showing the raw time", () => {
    expect(seenLabel({ online: true, lastSync: "2026-11-17T19:58:00.000Z" }, now)).toBe("Online");
    expect(seenLabel({ online: false, lastSync: "2026-11-17T19:59:30.000Z" }, now)).toBe("Last seen just now");
    expect(seenLabel({ online: false, lastSync: "2026-11-17T19:15:00.000Z" }, now)).toBe("Last seen 45 minutes ago");
    expect(seenLabel({ online: false, lastSync: "2026-11-17T19:00:00.000Z" }, now)).toBe("Last seen 1 hour ago");
    expect(seenLabel({ online: false, lastSync: "2026-11-14T18:00:00.000Z" }, now)).toBe("Last seen 3 days ago");
    expect(seenLabel({ online: false, lastSync: "2026-08-01T18:00:00.000Z" }, now)).toMatch(/^Last seen (Aug|Jul) \d+, 2026$/);
  });

  it("keeps words the desktop or the demo sent", () => {
    expect(seenLabel({ online: true, lastSync: "Live on this PC" }, now)).toBe("Live on this PC");
    expect(seenLabel({ online: false, lastSync: "Last seen 3 days ago" }, now)).toBe("Last seen 3 days ago");
  });
});
