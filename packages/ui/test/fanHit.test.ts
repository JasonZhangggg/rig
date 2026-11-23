import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { makeFan, plainFan, type Kit } from "../src/parts3d";

// Pointing at a spinning fan must keep finding the fan. Through the gaps between its blades the pointer would
// otherwise reach whatever is behind it, and the fan would light up and go dark over and over.
describe("pointing at a fan", () => {
  it("finds the fan wherever its blades are in their turn", () => {
    const rotors: THREE.Object3D[] = [];
    const kit: Kit = { M: () => new THREE.MeshBasicMaterial(), spin: (r) => rotors.push(r), accent: "#ffffff", lite: true };
    const size = 1.2;
    const fan = makeFan(kit, size, 0.25, plainFan("#222222"));
    const ray = new THREE.Raycaster();
    const meshes: THREE.Object3D[] = [];
    fan.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
    let misses = 0;
    for (let turn = 0; turn < 36; turn++) {
      rotors[0].rotation.z = (turn / 36) * Math.PI * 2;
      fan.updateMatrixWorld(true);
      // Straight at the fan's face, halfway out along the blades.
      ray.set(new THREE.Vector3(size * 0.3, size * 0.05, 5), new THREE.Vector3(0, 0, -1));
      if (!ray.intersectObjects(meshes, false).length) misses++;
    }
    expect(misses).toBe(0);
  });
});
