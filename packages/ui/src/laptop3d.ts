// The laptop's body for the 3D view: a thin base that tapers toward the front, a keyboard set into a well,
// a trackpad, one hinge barrel and a thin lid whose glass shows a dim wallpaper.
//
// Laptop frame, 1 unit = 100 mm: x across, y up from the desk, z toward the person (the palm rest is at +z).
import * as THREE from "three";
import { canvasTex, type MakeMat } from "./parts3d";

export interface LaptopColors {
  shell: string; keys: string; trackpad: string;
  /** The glass around the display, the wallpaper's deep tone and its lighter tone. */
  screenBg: string; screenPanel: string; screenLine: string;
}

/** A 14-inch ultrabook's real sizes. */
export const LAPTOP = {
  w: 3.12, d: 2.2, r: 0.14,
  /** Bottom cover, and the top case above it at the back; the front is thinner by `taper`. */
  cover: 0.018, deck: 0.078, taper: 0.22,
  lid: 0.046,
  /** How far the lid is open, in radians from closed. */
  open: 1.92,
  /** Keyboard well (z from its back edge to its front edge) and the trackpad. */
  well: { w: 2.78, z0: -0.86, z1: 0.2, depth: 0.02 },
  trackpad: { w: 1.24, d: 0.68, z: 0.65 },
} as const;

/** A spot on the laptop's board, seen from above: its centre (x, z) and its size (w across, d front to back). */
export interface Spot { x: number; z: number; w: number; d: number }

/**
 * What sits on the board inside, between the two fans: the board itself, the processor, the graphics chip beside it
 * on a laptop with one of its own, the memory soldered on the other side, and the M.2 drive toward the right fan.
 */
export const BOARD: Record<"board" | "cpu" | "gpu" | "ram" | "ssd", Spot> = {
  board: { x: 0.05, z: -0.5, w: 1.72, d: 0.9 },
  cpu: { x: 0.1, z: -0.5, w: 0.3, d: 0.22 },
  gpu: { x: 0.43, z: -0.5, w: 0.26, d: 0.24 },
  ram: { x: -0.28, z: -0.495, w: 0.29, d: 0.31 },
  ssd: { x: 0.72, z: -0.45, w: 0.22, d: 0.8 },
};

/** Height of the base's top surface at z: highest at the hinge, lower at the front edge. */
export function deckTop(z: number) {
  const t = THREE.MathUtils.clamp((z + LAPTOP.d / 2) / LAPTOP.d, 0, 1);
  return LAPTOP.cover + LAPTOP.deck * (1 - LAPTOP.taper * t);
}
/** The base's slope from back to front, in radians. */
export const deckSlope = Math.atan((deckTop(-LAPTOP.d / 2) - deckTop(LAPTOP.d / 2)) / LAPTOP.d);

export interface Key { x: number; z: number; w: number; d: number }

/** A 14-inch layout: a short function row, five full rows and inverted-T arrows, every row the same width. */
export function keyboardLayout(): Key[] {
  const pitch = 0.18, gap = 0.032, fnPitch = 0.115;
  const rows: number[][] = [
    Array(15).fill(1),
    [...Array(13).fill(1), 2],
    [1.5, ...Array(12).fill(1), 1.5],
    [1.75, ...Array(11).fill(1), 2.25],
    [2.25, ...Array(10).fill(1), 2.75],
  ];
  const span = 15 * pitch;
  const keys: Key[] = [];
  const total = fnPitch + pitch * 5;
  const z0 = LAPTOP.well.z0 + (LAPTOP.well.z1 - LAPTOP.well.z0 - total) / 2;
  const lay = (row: number[], z: number, d: number) => {
    let x = -span / 2;
    for (const u of row) { keys.push({ x: x + (u * pitch) / 2, z, w: u * pitch - gap, d }); x += u * pitch; }
  };
  lay(rows[0], z0 + fnPitch / 2, fnPitch - gap);
  rows.slice(1).forEach((row, i) => lay(row, z0 + fnPitch + pitch * (i + 0.5), pitch - gap));
  // Bottom row: Ctrl, Fn, Windows, Alt, the space bar, Alt, Ctrl, then the arrows with Up and Down sharing one key's height.
  const zb = z0 + fnPitch + pitch * 4.5, d = pitch - gap;
  let x = -span / 2;
  for (const u of [1, 1, 1, 1, 6, 1, 1]) { keys.push({ x: x + (u * pitch) / 2, z: zb, w: u * pitch - gap, d }); x += u * pitch; }
  const half = (pitch - gap * 1.5) / 2;
  keys.push({ x: x + pitch / 2, z: zb + pitch / 4 - gap / 4, w: pitch - gap, d: half });
  keys.push({ x: x + pitch * 1.5, z: zb - pitch / 4 + gap / 4, w: pitch - gap, d: half });
  keys.push({ x: x + pitch * 1.5, z: zb + pitch / 4 - gap / 4, w: pitch - gap, d: half });
  keys.push({ x: x + pitch * 2.5, z: zb + pitch / 4 - gap / 4, w: pitch - gap, d: half });
  return keys;
}

function roundRect(path: THREE.Path, w: number, d: number, r: number, cx = 0, cz = 0) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  path.moveTo(x0 + r, z0);
  path.lineTo(x1 - r, z0); path.quadraticCurveTo(x1, z0, x1, z0 + r);
  path.lineTo(x1, z1 - r); path.quadraticCurveTo(x1, z1, x1 - r, z1);
  path.lineTo(x0 + r, z1); path.quadraticCurveTo(x0, z1, x0, z1 - r);
  path.lineTo(x0, z0 + r); path.quadraticCurveTo(x0, z0, x0 + r, z0);
  return path;
}

/**
 * A rounded slab exactly w by d and h tall, from y = 0 up, with softened edges.
 * Holes are cut straight through. The bevel sits inside the given size, so parts placed on it never sink in.
 */
export function slab(w: number, d: number, r: number, h: number, o: { bevel?: number; holes?: { w: number; d: number; r: number; x?: number; z?: number }[]; curve?: number } = {}) {
  const b = Math.min(o.bevel ?? 0.01, h / 3, r / 2);
  const shape = roundRect(new THREE.Shape(), w - 2 * b, d - 2 * b, Math.max(0.001, r - b)) as THREE.Shape;
  for (const hole of o.holes ?? []) shape.holes.push(roundRect(new THREE.Path(), hole.w + 2 * b, hole.d + 2 * b, hole.r + b, hole.x ?? 0, hole.z ?? 0));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0005, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: o.curve ?? 10,
  });
  // The shape is drawn in x and z; the extrusion runs up.
  geo.rotateX(Math.PI / 2);
  geo.translate(0, h - b, 0);
  return geo;
}

/** Lowers the top of a base-shaped geometry toward the front, keeping its underside flat. */
function taper(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, (pos.getY(i) * (deckTop(pos.getZ(i)) - LAPTOP.cover)) / LAPTOP.deck);
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  return geo;
}

/** A flat rounded panel facing -y in its own frame, its texture covering it once. */
function panel(w: number, d: number, r: number) {
  const geo = new THREE.ShapeGeometry(roundRect(new THREE.Shape(), w, d, r) as THREE.Shape, 10);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / d + 0.5);
  // Shape coordinates are x and y; lay it in x and z, facing down.
  geo.rotateX(Math.PI / 2);
  return geo;
}

/** The display as seen through the glass: a black border, a calm dim wallpaper and one soft reflection across it all. */
export function screenTexture(c: LaptopColors, accent: string) {
  return canvasTex(`laptop-screen-${c.screenBg}-${c.screenPanel}-${c.screenLine}-${accent}`, 1024, 724, (g, w, h) => {
    g.fillStyle = c.screenBg; g.fillRect(0, 0, w, h);
    // The display inside the glass border: thin sides and top, a slightly taller chin.
    const x0 = 22, y0 = 22, x1 = w - 22, y1 = h - 34;
    const sky = g.createLinearGradient(0, y0, 0, y1);
    sky.addColorStop(0, c.screenPanel); sky.addColorStop(1, c.screenBg);
    g.fillStyle = sky; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Two broad, soft swells of light, like a quiet default wallpaper.
    const swell = (cx: number, cy: number, rad: number, color: string, a: number) => {
      const r = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      r.addColorStop(0, withAlpha(color, a)); r.addColorStop(1, withAlpha(color, 0));
      g.fillStyle = r; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    swell(x0 + (x1 - x0) * 0.3, y1 + 80, 680, c.screenLine, 0.7);
    swell(x0 + (x1 - x0) * 0.78, y0 + 120, 420, accent, 0.12);
    // Camera in the top border.
    g.fillStyle = "#1c1e22"; g.beginPath(); g.arc(w / 2, 11, 4, 0, Math.PI * 2); g.fill();
    // A wide, faint reflection across the whole glass, from upper left.
    const sheen = g.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, "rgba(255,255,255,0.10)");
    sheen.addColorStop(0.38, "rgba(255,255,255,0.035)");
    sheen.addColorStop(0.39, "rgba(255,255,255,0)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sheen; g.fillRect(0, 0, w, h);
  });
}

function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface LaptopBody {
  /** The bottom cover, which stays on the stand when the laptop is opened up. */
  bottom: THREE.Group;
  /** The top case with its keyboard and trackpad, and the lid on its hinge; they lift away together. */
  deck: THREE.Group;
  keys: THREE.InstancedMesh;
  trackpad: THREE.Mesh;
  screen: THREE.Mesh;
}

/** `M` makes the body's materials; `flat`, if given, the screen's, which is lit only by itself, so it can skip real lighting. */
export function makeLaptopBody(M: MakeMat, c: LaptopColors, accent: string, flat: MakeMat = M): LaptopBody {
  const { w: W, d: D, r: R, cover, lid: T } = LAPTOP;
  const shell = M(c.shell, { metal: 0.55, rough: 0.42 });
  // The well under the keys and the rubber feet, darker than the keys so the gaps between them draw the grid.
  const deep = M("#" + new THREE.Color(c.keys).multiplyScalar(0.42).getHexString(), { rough: 0.8 });

  const bottom = new THREE.Group();
  const coverMesh = new THREE.Mesh(slab(W - 0.01, D - 0.01, R, cover, { bevel: 0.006 }), shell);
  bottom.add(coverMesh);
  // Two long rubber feet underneath.
  for (const z of [-0.78, 0.84]) {
    const foot = new THREE.Mesh(slab(2.2, 0.07, 0.03, 0.008, { bevel: 0.003 }), deep);
    foot.position.set(0, -0.008, z);
    bottom.add(foot);
  }

  const deck = new THREE.Group();
  const { well, trackpad: tp } = LAPTOP;
  const wellD = well.z1 - well.z0, wellZ = (well.z0 + well.z1) / 2;
  const top = new THREE.Mesh(taper(slab(W, D, R, LAPTOP.deck, { bevel: 0.012, holes: [{ w: well.w, d: wellD, r: 0.035, z: wellZ }] })), shell);
  top.position.y = cover;
  deck.add(top);

  // The keyboard, tilted with the slope of the base and set just below its surface.
  const kb = new THREE.Group();
  kb.position.set(0, deckTop(wellZ), wellZ);
  kb.rotation.x = deckSlope;
  const floor = new THREE.Mesh(slab(well.w + 0.01, wellD + 0.01, 0.035, 0.004, { bevel: 0 }), deep);
  floor.position.set(0, -well.depth - 0.004, 0);
  kb.add(floor);
  const layout = keyboardLayout();
  const keyH = 0.016;
  const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(1, keyH, 1), M(c.keys, { rough: 0.55 }), layout.length);
  const dummy = new THREE.Object3D();
  layout.forEach((k, i) => {
    dummy.position.set(k.x, -well.depth + keyH / 2, k.z - wellZ);
    dummy.scale.set(k.w, 1, k.d);
    dummy.updateMatrix();
    keys.setMatrixAt(i, dummy.matrix);
  });
  keys.castShadow = true; keys.receiveShadow = true;
  // Each key drawn with an ink outline turns the keyboard into noise; the dark gaps between them already draw the grid.
  (keys.material as THREE.Material).userData.outlineParameters = { visible: false };
  kb.add(keys);
  deck.add(kb);

  // The trackpad: a glass plate flush with the palm rest. Its edge is a hairline on the real thing, so it has no ink
  // outline, and it is drawn just above the surface so the two never flicker into each other.
  const padMat = M(c.trackpad, { metal: 0.1, rough: 0.3 });
  padMat.userData.outlineParameters = { visible: false };
  padMat.polygonOffset = true; padMat.polygonOffsetFactor = -2; padMat.polygonOffsetUnits = -2;
  const pad = new THREE.Mesh(panel(tp.w, tp.d, 0.05).rotateX(Math.PI), padMat);
  pad.position.set(0, deckTop(tp.z) + 0.0006, tp.z);
  pad.rotation.x = deckSlope;
  deck.add(pad);

  // One hinge barrel across the back, and the lid turning on it.
  const axisY = deckTop(-D / 2) - 0.004, axisZ = -D / 2 + 0.05;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.62, T * 0.62, W - 0.86, 24), M(c.keys, { metal: 0.4, rough: 0.45 }));
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0, axisY, axisZ);
  deck.add(barrel);

  const hinge = new THREE.Group();
  hinge.position.set(0, axisY, axisZ);
  const lid = new THREE.Group();
  const lidD = D - 0.06;
  const lidShell = new THREE.Mesh(slab(W, lidD, R, T, { bevel: 0.01 }), shell);
  lidShell.position.set(0, -T / 2, 0.02 + lidD / 2);
  lid.add(lidShell);
  // The glass covers the inside of the lid but for a hairline of the shell around it.
  const sw = W - 0.03, sd = lidD - 0.03;
  const screenMat = flat("#000000", { map: screenTexture(c, accent), emissive: "#ffffff", ei: 1, emap: true, rough: 0.15 });
  screenMat.userData.outlineParameters = { visible: false };
  const screen = new THREE.Mesh(panel(sw, sd, R - 0.015), screenMat);
  screen.position.set(0, -T / 2 - 0.0012, 0.02 + lidD / 2);
  lid.add(screen);
  // The PC's color, as a small mark on the back of the lid.
  const mark = new THREE.Mesh(slab(0.34, 0.06, 0.03, 0.003, { bevel: 0.001 }), M(accent, { emissive: accent, ei: 0.35, metal: 0.6, rough: 0.3 }));
  mark.position.set(0, T / 2, 0.02 + lidD * 0.55);
  lid.add(mark);
  hinge.add(lid);
  hinge.rotation.x = -LAPTOP.open;
  deck.add(hinge);

  for (const g of [bottom, deck]) g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { bottom, deck, keys, trackpad: pad, screen };
}
