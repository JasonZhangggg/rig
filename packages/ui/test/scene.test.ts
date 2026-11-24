import { describe, expect, it } from "vitest";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
const { fovFor, soloDistance } = await import("../src/scene");

const halfWidth = (aspect: number) => Math.tan((fovFor(aspect) * Math.PI) / 360) * aspect;

describe("3D stage framing", () => {
  it("keeps the whole PC in view on a stage taller than it is wide", () => {
    expect(fovFor(1.6)).toBe(32);
    expect(fovFor(1)).toBe(32);
    for (const a of [0.9, 0.6, 0.4]) expect(halfWidth(a)).toBeCloseTo(halfWidth(1), 6);
  });

  it("shows a part alone at the same size whatever its size, a small drive as large as a graphics card", () => {
    // The share of the stage's narrower side that a part's bounds cover.
    const share = (r: number, aspect: number) => {
      const fov = fovFor(aspect), v = (fov * Math.PI) / 360, h = Math.atan(Math.tan(v) * aspect);
      return r / (soloDistance(r, fov, aspect) * Math.tan(Math.min(v, h)));
    };
    for (const aspect of [1.6, 0.8]) {
      const ssd = share(0.17, aspect), gpu = share(1.4, aspect);
      expect(ssd).toBeCloseTo(gpu, 6);
      expect(ssd).toBeGreaterThan(0.7);
      expect(ssd).toBeLessThan(1);
    }
  });
});
