import { describe, expect, it } from "vitest";
import { placeLabels, type Pin } from "../src/sceneLabels";

const box = (p: ReturnType<typeof placeLabels>[number], pin: Pin) => ({ x0: p.x, y0: p.y, x1: p.x + pin.w * p.scale, y1: p.y + pin.h * p.scale });
const pin = (id: string, x: number, y: number, depth = 0.5, w = 120): Pin => ({ id, x, y, depth, w, h: 26 });

describe("3D part labels", () => {
  const stage = { width: 700, height: 500, cx: 350 };

  it("hangs each label out to the side of the PC its part is on", () => {
    const [left, right] = placeLabels([pin("ram", 250, 200), pin("gpu", 450, 200)], stage);
    expect(left.side).toBe(-1);
    expect(left.x + 120 * left.scale).toBeLessThan(250);
    expect(right.side).toBe(1);
    expect(right.x).toBeGreaterThan(450);
    expect(right.ex).toBe(right.x);
    expect(left.ex).toBeCloseTo(left.x + 120 * left.scale);
  });

  it("never lets two labels overlap, even when their parts sit close together", () => {
    const pins = [pin("a", 420, 200), pin("b", 430, 205), pin("c", 425, 210), pin("d", 440, 198)];
    const placed = placeLabels(pins, stage);
    const boxes = placed.map((p, i) => box(p, pins[i]));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      expect(overlap).toBe(false);
    }
  });

  it("keeps labels on the stage, switching sides when one side has no room", () => {
    const pins = [pin("edge", 690, 10), pin("left", 12, 490)];
    const placed = placeLabels(pins, stage);
    placed.forEach((p, i) => {
      const b = box(p, pins[i]);
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(700);
      expect(b.y1).toBeLessThanOrEqual(500);
    });
    expect(placed[0].side).toBe(-1);
    expect(placed[1].side).toBe(1);
  });

  it("draws nearer parts' labels a little larger and their pins stronger", () => {
    const [near, far] = placeLabels([pin("near", 200, 100, 0), pin("far", 200, 400, 1)], stage);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.opacity).toBeGreaterThan(far.opacity);
    expect(far.opacity).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps a label on its side while its part sways across the middle", () => {
    const sides: Record<string, -1 | 1> = {};
    sides.cpu = placeLabels([pin("cpu", 340, 200)], stage)[0].side;
    expect(sides.cpu).toBe(-1);
    expect(placeLabels([pin("cpu", 355, 200)], stage, sides)[0].side).toBe(-1);
    expect(placeLabels([pin("cpu", 380, 200)], stage, sides)[0].side).toBe(1);
  });
});
