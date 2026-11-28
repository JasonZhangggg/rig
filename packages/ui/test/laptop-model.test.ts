import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { keyboardLayout, LAPTOP, makeLaptopBody } from "../src/laptop3d";

const colors = { shell: "#D9DAD7", keys: "#2B2D31", trackpad: "#C6C7C4", screenBg: "#0B0C0F", screenPanel: "#232C3D", screenLine: "#6A7793" };
const mat = (color: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color });

function build() {
  const body = makeLaptopBody(mat, colors, "#E6D3A3");
  const root = new THREE.Group();
  root.add(body.bottom, body.deck);
  root.updateMatrixWorld(true);
  return { body, root };
}

/** What a person looking from `eye` toward `at` sees first. */
function firstSeen(root: THREE.Object3D, eye: THREE.Vector3, at: THREE.Vector3) {
  const ray = new THREE.Raycaster(eye, at.clone().sub(eye).normalize());
  return ray.intersectObject(root, true)[0]?.object;
}

describe("laptop model", () => {
  it("shows the screen on the inside of the lid, not hidden in it", () => {
    const { body, root } = build();
    const glass = new THREE.Box3().setFromObject(body.screen).getCenter(new THREE.Vector3());
    // From where the person sits, in front of the laptop and a little above the keyboard.
    expect(firstSeen(root, new THREE.Vector3(0.3, 1.4, 5), glass)).toBe(body.screen);
  });

  it("shows the keys and the trackpad on top of the base, not sunk into it", () => {
    const { body, root } = build();
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const layout = keyboardLayout();
    for (const i of [0, 20, 40, layout.length - 1]) {
      body.keys.getMatrixAt(i, m);
      p.setFromMatrixPosition(m).applyMatrix4(body.keys.matrixWorld);
      expect(firstSeen(root, p.clone().add(new THREE.Vector3(0, 3, 0.4)), p)).toBe(body.keys);
    }
    const pad = new THREE.Box3().setFromObject(body.trackpad).getCenter(new THREE.Vector3());
    expect(firstSeen(root, pad.clone().add(new THREE.Vector3(0.2, 3, 1)), pad)).toBe(body.trackpad);
  });

  it("lays the keys out in even rows that fit the keyboard well without touching", () => {
    const keys = keyboardLayout();
    const { well } = LAPTOP;
    for (const k of keys) {
      expect(Math.abs(k.x) + k.w / 2).toBeLessThan(well.w / 2);
      expect(k.z - k.d / 2).toBeGreaterThan(well.z0);
      expect(k.z + k.d / 2).toBeLessThan(well.z1);
    }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j];
      const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2;
      expect(apart).toBe(true);
    }
    // Every row starts and ends at the same place, so the keyboard reads as one neat block.
    const bands = [...new Set(keys.filter((k) => k.d > 0.075).map((k) => k.z.toFixed(4)))].map(Number);
    expect(bands.length).toBe(6);
    const rows = bands.map((z) => {
      const inRow = keys.filter((k) => Math.abs(k.z - z) < 0.09 && (k.d > 0.075 ? k.z.toFixed(4) === z.toFixed(4) : true));
      return { min: Math.min(...inRow.map((k) => k.x - k.w / 2)), max: Math.max(...inRow.map((k) => k.x + k.w / 2)) };
    });
    for (const r of rows) { expect(r.min).toBeCloseTo(rows[0].min, 6); expect(r.max).toBeCloseTo(rows[0].max, 6); }
  });

  it("is a thin laptop that is thinner at the front than at the hinge", () => {
    const { body } = build();
    const base = new THREE.Box3().setFromObject(body.bottom).union(new THREE.Box3().setFromObject(body.deck.children[0]));
    const size = base.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(3.12, 1);
    expect(size.z).toBeCloseTo(2.2, 1);
    expect(size.y).toBeLessThan(0.12);
    const ray = (z: number) => new THREE.Raycaster(new THREE.Vector3(1.45, 2, z), new THREE.Vector3(0, -1, 0)).intersectObject(body.deck.children[0])[0].point.y;
    expect(ray(1.0)).toBeLessThan(ray(-0.95));
  });
});
