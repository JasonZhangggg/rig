import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FAN_FPS, fanSpeed, makeFan, plainFan, type Kit } from "../src/parts3d";

// The 3D view draws turning fans at 30 frames a second. Between two frames a fan's blades move further than the gaps
// between them are wide, so whatever sits behind a fan (a cooler's fins, the case wall) showed through in a new place
// every frame, and the area behind the fan flashed.
describe("a turning fan", () => {
  it("never shows what's behind it through the gaps between its blades", () => {
    const rotors: THREE.Object3D[] = [];
    const kit: Kit = { M: () => new THREE.MeshBasicMaterial(), spin: (r) => rotors.push(r), accent: "#ffffff", lite: true };
    const size = 1.2;
    const fan = makeFan(kit, size, 0.25, plainFan("#222222"));
    const shown: THREE.Object3D[] = [];
    fan.traverse((o) => { if (o instanceof THREE.Mesh && (o.material as THREE.Material).visible) shown.push(o); });
    const ray = new THREE.Raycaster();
    let seenThrough = 0;
    for (let turn = 0; turn < 24; turn++) {
      rotors[0].rotation.z = (turn / 24) * Math.PI * 2;
      fan.updateMatrixWorld(true);
      for (const r of [0.22, 0.3, 0.4]) for (let a = 0; a < 16; a++) {
        const t = ((a + 0.37) / 16) * Math.PI * 2;
        ray.set(new THREE.Vector3(Math.cos(t) * r * size, Math.sin(t) * r * size, 5), new THREE.Vector3(0, 0, -1));
        if (!ray.intersectObjects(shown, false).length) seenThrough++;
      }
    }
    expect(seenThrough).toBe(0);
  });

  it("moves less than half the way to the next blade between frames, however fast it runs", () => {
    for (const blades of [5, 7, 9, 11]) {
      const gap = (Math.PI * 2) / blades;
      for (const rpm of [600, 1200, 2000, 3000]) expect(fanSpeed(rpm, blades) / FAN_FPS).toBeLessThan(gap / 2);
    }
  });

  it("still turns slower when its fan reads slower, and stands still at 0 rpm", () => {
    expect(fanSpeed(300, 7)).toBeLessThan(fanSpeed(600, 7));
    expect(fanSpeed(0, 7)).toBe(0);
  });
});
