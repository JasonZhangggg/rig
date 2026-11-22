import { describe, expect, it } from "vitest";
import { effectiveStyle, relax, roomFor, splitSides, spreadColumn, surfaceMatrix } from "../src/labelStyles";

describe("label styles", () => {
  it("keeps a column of callouts in order, apart and on the stage", () => {
    // Three parts close together near the top: their labels stack down without touching.
    const y = spreadColumn([20, 24, 30], [30, 30, 30], 10, 400, 12);
    expect(y[0]).toBeGreaterThanOrEqual(10);
    expect(y[1] - y[0]).toBeGreaterThanOrEqual(42);
    expect(y[2] - y[1]).toBeGreaterThanOrEqual(42);
    // Near the bottom, they stack up instead of running off.
    const z = spreadColumn([390, 395], [30, 30], 10, 400, 12);
    expect(z[1] + 30).toBeLessThanOrEqual(400);
    expect(z[1] - z[0]).toBeGreaterThanOrEqual(42);
  });

  it("splits callouts between the two sides evenly", () => {
    const pts = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, x: 100 + i * 5, y: i * 40 }));
    const side = splitSides(pts, 300);
    const left = Object.values(side).filter((s) => s < 0).length;
    expect(Math.abs(left - (pts.length - left))).toBeLessThanOrEqual(1);
  });

  it("pushes overlapping markers apart", () => {
    const boxes = relax([{ x: 100, y: 100, w: 24, h: 24 }, { x: 104, y: 104, w: 24, h: 24 }], 3);
    const [a, b] = boxes;
    const apart = a.y + a.h + 3 <= b.y + 0.01 || b.y + b.h + 3 <= a.y + 0.01 || a.x + a.w + 3 <= b.x + 0.01 || b.x + b.w + 3 <= a.x + 0.01;
    expect(apart).toBe(true);
  });

  it("lays a tag on its surface, but stands it up when the surface turns edge-on", () => {
    // Facing the camera: as it is.
    expect(surfaceMatrix([100, 0], [0, 100])).toEqual([1, 0, 0, 1]);
    // Turned a little: the tag takes the slant.
    const [a, b] = surfaceMatrix([80, 20], [0, 100]);
    expect(b).toBeGreaterThan(0.1);
    expect(a).toBeLessThan(1);
    // Almost edge-on: upright again, so it can still be read.
    expect(surfaceMatrix([5, 1], [0, 100])).toEqual([1, 0, 0, 1]);
  });

  it("turns callouts into numbers on a phone, with the list under the model", () => {
    expect(effectiveStyle("callouts", 390)).toBe("numbers");
    expect(effectiveStyle("callouts", 1200)).toBe("callouts");
    expect(roomFor("numbers", 390, 7)!.b).toBeGreaterThan(150);
    expect(roomFor("focus", 1200, 7)).toBeNull();
  });
});
