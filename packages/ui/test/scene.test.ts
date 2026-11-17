import { describe, expect, it } from "vitest";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
const { fovFor } = await import("../src/scene");

const halfWidth = (aspect: number) => Math.tan((fovFor(aspect) * Math.PI) / 360) * aspect;

describe("3D stage framing", () => {
  it("keeps the whole PC in view on a stage taller than it is wide", () => {
    expect(fovFor(1.6)).toBe(32);
    expect(fovFor(1)).toBe(32);
    for (const a of [0.9, 0.6, 0.4]) expect(halfWidth(a)).toBeCloseTo(halfWidth(1), 6);
  });
});
