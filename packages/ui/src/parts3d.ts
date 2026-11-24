// Real-looking PC parts for the 3D views, built in code from each part's record (core build.ts).
// Each maker's design is drawn from its own features: shroud shape and trim, fan blades, fin stacks,
// heatpipes, heatspreaders and the printed names, so a TUF card reads as a TUF card.
//
// Frame for everything that sits on the motherboard ("board frame"), 1 unit = 100 mm:
//   X along the board from its rear edge to its front edge, Y up, Z out of the board toward the viewer.
// The tower and the board view both use this frame, so a part sits the same way in both.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CoolerShape, GpuShape, MemoryShape } from "@rig/core";

export interface MatOpts {
  op?: number; emissive?: string; ei?: number;
  /** Physical finish: 0 plastic to 1 bare metal, and 0 mirror to 1 matte. */
  metal?: number; rough?: number;
  map?: THREE.Texture; alphaMap?: THREE.Texture; roughMap?: THREE.Texture; bump?: THREE.Texture; bumpScale?: number;
  /** The map's colors also glow (lit logos). */
  emap?: boolean;
  /** A printed or cut-out shape: the map's alpha decides what shows. */
  cutout?: boolean;
  side?: THREE.Side; clearcoat?: number; glass?: boolean; envI?: number;
}
export type MakeMat = (color: THREE.ColorRepresentation, o?: MatOpts) => THREE.Material;

export interface Kit {
  M: MakeMat;
  /** Fan rotors register here so the view can spin them. */
  spin(rotor: THREE.Object3D): void;
  /** The PC's light color, for RGB parts. */
  accent: string;
  /** Lighter build for the whole-PC view: fewer tiny pieces. */
  lite?: boolean;
}

/** Physically based material for the "real" finish and the board view. */
export function realMaterial(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const op = o.op ?? 1;
  const phys = o.clearcoat !== undefined || o.glass;
  const m = phys ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  m.color.set(color);
  m.metalness = o.metal ?? 0;
  m.roughness = o.rough ?? 0.6;
  m.opacity = op;
  m.transparent = op < 1 || !!o.cutout;
  m.depthWrite = op >= 0.5 && !o.cutout;
  m.side = o.side ?? THREE.FrontSide;
  if (o.map) m.map = o.map;
  // Hashed alpha keeps fine mesh and vents see-through at any distance, where a hard cut turns them solid
  if (o.alphaMap) { m.alphaMap = o.alphaMap; m.alphaHash = true; m.transparent = false; m.depthWrite = true; }
  if (o.roughMap) m.roughnessMap = o.roughMap;
  if (o.bump) { m.bumpMap = o.bump; m.bumpScale = o.bumpScale ?? 1; }
  if (o.emissive) {
    m.emissive.set(o.emissive);
    m.emissiveIntensity = o.ei ?? 1;
    if (o.emap && o.map) m.emissiveMap = o.map;
  }
  if (o.cutout) { m.alphaTest = 0.04; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.userData.cutout = true; }
  if (m instanceof THREE.MeshPhysicalMaterial) {
    if (o.clearcoat) { m.clearcoat = o.clearcoat; m.clearcoatRoughness = 0.08; }
    if (o.glass) { m.roughness = 0.03; m.metalness = 0; m.envMapIntensity = 1.6; }
  }
  if (o.envI !== undefined) m.envMapIntensity = o.envI;
  return m;
}

// ---------- textures ----------
const texCache = new Map<string, THREE.Texture>();
const shared = new Set<THREE.Texture>();
/** Painted textures are kept for every build that uses them; a model being freed leaves them alone. */
export const isSharedTexture = (t: THREE.Texture) => shared.has(t);
type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** A texture painted on a canvas once and shared. Data maps (roughness, alpha) skip the color space. */
export function canvasTex(key: string, w: number, h: number, draw: Draw, o: { data?: boolean; repeat?: [number, number] } = {}) {
  let t = texCache.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (g) draw(g, w, h);
    t = new THREE.CanvasTexture(c);
    if (!o.data) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    texCache.set(key, t);
    shared.add(t);
  }
  if (!o.repeat) return t;
  const r = t.clone();
  r.wrapS = r.wrapT = THREE.RepeatWrapping;
  r.repeat.set(...o.repeat);
  r.needsUpdate = true;
  return r;
}

/** Repeatable random numbers, so painted textures come out the same every time. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fine streaks for brushed aluminum, as a roughness map. */
export function brushed(repeat: [number, number] = [1, 1]) {
  return canvasTex("brushed", 256, 256, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = "#7a7a7a"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const y = r() * h, v = Math.round(90 + r() * 80);
      g.fillStyle = `rgba(${v},${v},${v},${0.15 + r() * 0.3})`;
      g.fillRect(0, y, w, 0.6 + r() * 1.2);
    }
  }, { data: true, repeat });
}

/** Round holes, as an alpha map: white is metal, black is a hole. */
export function perforated(key: string, repeat: [number, number], hole = 0.32, hex = true) {
  return canvasTex(`perf-${key}-${hole}-${hex}`, 64, 64, (g) => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#000";
    const pts = hex ? [[16, 16], [48, 16], [0, 48], [32, 48], [64, 48]] : [[16, 16], [48, 16], [16, 48], [48, 48]];
    for (const [x, y] of pts) { g.beginPath(); g.arc(x, y, 32 * hole, 0, Math.PI * 2); g.fill(); }
  }, { data: true, repeat });
}

/** Slots, as an alpha map (vents in backplates and shrouds). */
export function slots(key: string, repeat: [number, number]) {
  return canvasTex(`slots-${key}`, 64, 64, (g) => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#000";
    g.beginPath(); g.roundRect(10, 6, 44, 20, 10); g.fill();
    g.beginPath(); g.roundRect(10, 38, 44, 20, 10); g.fill();
  }, { data: true, repeat });
}

export interface TextOpts { color?: string; weight?: number; family?: string; italic?: boolean; spacing?: number; size?: number; glow?: string }

/** A line of printed text on a transparent canvas, and its width over its height. */
export function textTex(text: string, o: TextOpts = {}) {
  const size = o.size ?? 96;
  const font = `${o.italic ? "italic " : ""}${o.weight ?? 800} ${size}px ${o.family ?? "Arial, Helvetica, 'DejaVu Sans', sans-serif"}`;
  const spacing = o.spacing ?? 0;
  const probe = document.createElement("canvas").getContext("2d");
  let tw = size * text.length * 0.6;
  if (probe) { probe.font = font; tw = probe.measureText(text).width + spacing * size * Math.max(0, text.length - 1); }
  const pad = size * 0.2;
  const w = Math.ceil(tw + pad * 2), h = Math.ceil(size * 1.3);
  const tex = canvasTex(`text-${text}-${font}-${o.color}-${spacing}-${o.glow}`, w, h, (g) => {
    g.font = font;
    g.textBaseline = "middle";
    g.fillStyle = o.color ?? "#ffffff";
    if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = size * 0.25; }
    let x = pad;
    if (!spacing) g.fillText(text, x, h / 2);
    else for (const ch of text) { g.fillText(ch, x, h / 2); x += g.measureText(ch).width + spacing * size; }
  });
  return { tex, aspect: w / h };
}

/** Printed text as a flat plate facing +Z, `height` tall (the text's cap area is about 70% of it). */
export function decal(kit: Kit, text: string, height: number, o: TextOpts & { metal?: number; rough?: number; lit?: number } = {}) {
  const { tex, aspect } = textTex(text, o);
  const m = kit.M("#ffffff", { map: tex, cutout: true, metal: o.metal ?? 0.2, rough: o.rough ?? 0.5, ...(o.lit ? { emissive: "#ffffff", ei: o.lit, emap: true } : {}) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), m);
  mesh.renderOrder = 2;
  return mesh;
}

/** Rainbow light for RGB parts, as a strip texture. */
export function rgbStrip(stops = ["#ff3b6b", "#ff9a3b", "#ffe14a", "#4dff9a", "#3bc7ff", "#7a5cff", "#ff3bd5"]) {
  return canvasTex(`rgb-${stops.join()}`, 256, 8, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s));
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
}

// ---------- shapes ----------
export const mm = (v: number) => v / 100;

/** A box with softly rounded edges, centered on (x, y, z). */
export function rbox(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, r?: number) {
  const rad = r ?? Math.min(0.012, Math.min(w, h, d) * 0.3);
  const g = rad > 0.002 ? new RoundedBoxGeometry(w, h, d, 2, rad) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** A box from its min and max corners. */
export function span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material, r?: number) {
  return rbox(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, r);
}

export function roundRect(w: number, h: number, r: number, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
const circle = (r: number, x = 0, y = 0) => { const p = new THREE.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); return p; };

/** A flat outline (drawn in X and Z) made thick along Y, from y0 up. Lies like a plate on a card's face. */
export function plateXZ(shape: THREE.Shape, depth: number, y0: number, bevel = 0) {
  // The shape is drawn with its second axis as -Z so the turn below is a rotation, not a mirror.
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 28 });
  g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, y0, 0, -1, 0, 0, 0, 0, 0, 1));
  return g;
}
/** Shape points in X and Z for plateXZ. */
const xz = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3[], rot?: THREE.Euler[]) {
  const im = new THREE.InstancedMesh(geo, mat, at.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  at.forEach((p, i) => { q.setFromEuler(rot?.[i] ?? new THREE.Euler()); im.setMatrixAt(i, m.compose(p, q, one)); });
  im.castShadow = true; im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

/** Bent pipes as one mesh: each path through its points, with rounded ends. */
function pipes(paths: THREE.Vector3[][], r: number, mat: THREE.Material) {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of paths) {
    const curve = new THREE.CatmullRomCurve3(p, false, "centripetal");
    geos.push(new THREE.TubeGeometry(curve, Math.max(16, p.length * 10), r, 10, false).toNonIndexed());
    for (const end of [p[0], p[p.length - 1]]) {
      const cap = new THREE.SphereGeometry(r, 10, 6).toNonIndexed();
      cap.translate(end.x, end.y, end.z);
      geos.push(cap);
    }
  }
  for (const g of geos) { g.deleteAttribute("uv"); }
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.castShadow = true;
  return mesh;
}

// ---------- fans ----------
export interface FanLook {
  blades: number; blade: string; bladeOp?: number;
  /** Square frame color; missing for a frameless graphics card fan that sits in its shroud. */
  frame?: string;
  hub?: string; sticker?: { text: string; bg: string; color: string };
  /** A ring joining the blade tips (ASUS Axial-tech, Founders Edition). */
  ring?: boolean;
  /** Blade tips joined in pairs (MSI TORX). */
  pairs?: boolean;
  /** Rubber corner pads (Noctua). */
  pads?: string;
  /** A lit ring around the frame (RGB fans). */
  rgb?: string;
  /** How far blades sweep (radians) and how much of the circle they fill (0 to 1). */
  sweep?: number; fill?: number;
  /** Frame outside size when not square (Noctua NF-A15 is 150 by 140). */
  w?: number; h?: number;
}

/** Blades as one mesh: each a pitched, swept, slightly cupped surface. */
function bladesGeometry(n: number, r0: number, r1: number, depth: number, sweep: number, fill: number, roundTip: boolean) {
  const NR = 12, NC = 7;
  const pos: number[] = [], idx: number[] = [];
  for (let b = 0; b < n; b++) {
    const base = (b / n) * Math.PI * 2, start = pos.length / 3;
    for (let i = 0; i <= NR; i++) {
      const f = i / NR, r = r0 + (r1 - r0) * f;
      const round = roundTip && f > 0.78 ? Math.sqrt(Math.max(0.12, 1 - ((f - 0.78) / 0.22) ** 2)) : 1;
      const width = ((Math.PI * 2) / n) * fill * (0.7 + 0.3 * f) * round;
      const mid = base + sweep * f * f;
      for (let j = 0; j <= NC; j++) {
        const t = j / NC - 0.5, a = mid + width * t;
        // Steeper at the root, flatter at the tip, and cupped.
        const z = -t * depth * (1 - 0.4 * f) + depth * 0.22 * (0.25 - t * t);
        pos.push(r * Math.cos(a), r * Math.sin(a), z);
      }
    }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NC; j++) {
      const a = start + i * (NC + 1) + j, c = a + NC + 1;
      idx.push(a, c, a + 1, c, c + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A hub sticker: a printed disc. */
function sticker(kit: Kit, r: number, s: NonNullable<FanLook["sticker"]>) {
  const tex = canvasTex(`sticker-${s.text}-${s.bg}-${s.color}`, 256, 256, (g) => {
    g.fillStyle = s.bg; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
    g.strokeStyle = s.color; g.globalAlpha = 0.35; g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1; g.fillStyle = s.color; g.textAlign = "center"; g.textBaseline = "middle";
    const size = Math.min(70, 300 / Math.max(3, s.text.length) * 1.35);
    g.font = `800 ${size}px Arial, Helvetica, sans-serif`;
    g.fillText(s.text, 128, 130);
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), kit.M("#ffffff", { map: tex, rough: 0.45 }));
  return m;
}

/**
 * A fan facing +Z (air in at +Z), `size` across the blades' circle, `thick` deep.
 * Its rotor, which spins about Z, is handed to kit.spin.
 */
export function makeFan(kit: Kit, size: number, thick: number, look: FanLook) {
  const g = new THREE.Group();
  const R = size * 0.47, hubR = size * (look.frame ? 0.17 : 0.2);
  if (look.frame) {
    const fw = look.w ?? size, fh = look.h ?? size, ft = Math.max(0.012, thick * 0.13);
    const frameMat = kit.M(look.frame, { rough: 0.55, metal: 0.05 });
    const flange = () => {
      const s = roundRect(fw, fh, size * 0.07);
      s.holes.push(circle(R));
      const c = size * 0.058;
      if (!kit.lite) for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) s.holes.push(circle(size * 0.022, sx * (fw / 2 - c), sy * (fh / 2 - c)));
      return new THREE.ExtrudeGeometry(s, { depth: ft, bevelEnabled: false, curveSegments: kit.lite ? 20 : 36 });
    };
    const front = new THREE.Mesh(flange(), frameMat);
    front.position.z = thick / 2 - ft;
    const back = new THREE.Mesh(flange(), frameMat);
    back.position.z = -thick / 2;
    g.add(front, back);
    const ductMat = kit.M(look.frame, { rough: 0.6, side: THREE.DoubleSide });
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(R, R, thick - ft * 2, kit.lite ? 28 : 48, 1, true), ductMat);
    duct.rotation.x = Math.PI / 2;
    g.add(duct);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.045, size * 0.045, thick - ft * 2, 12), frameMat);
      post.rotation.x = Math.PI / 2;
      post.position.set(sx * (fw / 2 - size * 0.058), sy * (fh / 2 - size * 0.058), 0);
      g.add(post);
      if (look.pads) {
        const pad = rbox(size * 0.13, size * 0.13, thick * 0.5, kit.M(look.pads, { rough: 0.85 }), sx * (fw / 2 - size * 0.05), sy * (fh / 2 - size * 0.05), 0, size * 0.03);
        pad.scale.set(1, 1, 1.05);
        g.add(pad);
      }
    }
    // Motor housing and the struts that hold it, at the back
    const strutMat = kit.M(look.frame, { rough: 0.6 });
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.98, hubR * 0.98, ft * 1.4, 28), strutMat);
    motor.rotation.x = Math.PI / 2;
    motor.position.z = -thick / 2 + ft * 0.7;
    g.add(motor);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, len = R - hubR;
      const s = new THREE.Mesh(new THREE.BoxGeometry(len, size * 0.028, ft), strutMat);
      s.position.set(Math.cos(a) * (hubR + len / 2), Math.sin(a) * (hubR + len / 2), -thick / 2 + ft / 2);
      s.rotation.z = a + 0.25;
      g.add(s);
    }
    if (look.rgb) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R + size * 0.012, size * 0.01, 6, 64), kit.M(look.rgb, { emissive: look.rgb, ei: 1.6 }));
      ring.position.z = thick / 2 + 0.001;
      g.add(ring);
    }
  }
  const rotor = new THREE.Group();
  const hubMat = kit.M(look.hub ?? look.blade, { rough: 0.5 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR * 1.02, thick * 0.62, 32), hubMat);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = thick * 0.08;
  rotor.add(hub);
  if (look.sticker) {
    const st = sticker(kit, hubR * 0.94, look.sticker);
    st.position.z = thick * 0.39 + 0.001;
    rotor.add(st);
  }
  const tipR = R - size * 0.012;
  const bladeMat = kit.M(look.blade, { rough: 0.5, op: look.bladeOp ?? 1, side: THREE.DoubleSide });
  const blades = new THREE.Mesh(bladesGeometry(look.blades, hubR * 0.96, tipR, thick * 0.62, look.sweep ?? -0.55, look.fill ?? 0.8, !look.ring && !look.pairs), bladeMat);
  blades.castShadow = true;
  rotor.add(blades);
  if (look.ring) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(tipR + 0.004, tipR + 0.004, thick * 0.3, 64, 1, true), kit.M(look.blade, { rough: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = Math.PI / 2;
    ring.position.z = -thick * 0.02;
    rotor.add(ring);
  }
  if (look.pairs) {
    // TORX: an arc ties each pair of blade tips together
    for (let i = 0; i < look.blades; i += 2) {
      const a0 = (i / look.blades) * Math.PI * 2 + (look.sweep ?? -0.55) - 0.25;
      const arc = new THREE.Mesh(new THREE.CylinderGeometry(tipR + 0.003, tipR + 0.003, thick * 0.22, 16, 1, true, a0, (Math.PI * 2 / look.blades) * 1.9), kit.M(look.blade, { rough: 0.5, side: THREE.DoubleSide }));
      arc.rotation.x = Math.PI / 2;
      rotor.add(arc);
    }
  }
  g.add(rotor);
  kit.spin(rotor);
  g.add(fanHitArea(R));
  return g;
}

const hitMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
// Every fan shares it, so rebuilding the PC leaves it be.
hitMaterial.userData.shared = true;
/**
 * A still disc over a fan's blades that's never drawn but catches the pointer. Without it the pointer falls through the
 * gaps between spinning blades, and the fan lights up and goes dark over and over while it's pointed at.
 */
export function fanHitArea(radius: number) {
  const hit = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), hitMaterial);
  hit.userData.noShadow = true;
  return hit;
}

// ---------- graphics cards ----------
interface GpuDesign {
  shroud: string; shroudMetal: number; shroudRough: number;
  trim: string; trimMetal: number;
  back: string; fan: FanLook;
  /** Name printed on the top edge, the side that faces the glass. */
  edge?: string; edgeColor?: string; edgeLit?: number;
  /** Lit strip on the top edge: rainbow, the accent, or none. */
  edgeLight?: "rgb" | "accent";
  backText?: string;
  /** Air passes through the far end of the card (cut-out backplate). */
  flow: boolean;
}

const gpuDesigns: Record<string, GpuDesign> = {
  tuf: {
    shroud: "#4a4e54", shroudMetal: 0.55, shroudRough: 0.4, trim: "#1e2023", trimMetal: 0.4, back: "#2b2d31",
    fan: { blades: 11, blade: "#1a1b1e", ring: true, hub: "#1a1b1e", sticker: { text: "TUF", bg: "#1a1b1e", color: "#c8ccd2" }, sweep: -0.5, fill: 0.86 },
    edge: "TUF GAMING", edgeColor: "#e4e6ea", edgeLit: 0.5, backText: "TUF GAMING", flow: true,
  },
  strix: {
    shroud: "#18191c", shroudMetal: 0.35, shroudRough: 0.4, trim: "#a9adb3", trimMetal: 0.9, back: "#16171a",
    fan: { blades: 11, blade: "#121315", ring: true, hub: "#121315", sticker: { text: "ROG", bg: "#121315", color: "#e04a4a" }, sweep: -0.55, fill: 0.86 },
    edge: "ROG STRIX", edgeColor: "#f2f2f2", edgeLight: "rgb", backText: "REPUBLIC OF GAMERS", flow: true,
  },
  ventus: {
    shroud: "#1d1e20", shroudMetal: 0.05, shroudRough: 0.72, trim: "#55585d", trimMetal: 0.2, back: "#1b1c1e",
    fan: { blades: 9, blade: "#18191b", pairs: true, hub: "#18191b", sticker: { text: "MSI", bg: "#18191b", color: "#d0d2d6" }, sweep: -0.6, fill: 0.78 },
    edge: "VENTUS", edgeColor: "#9a9da2", backText: "MSI", flow: false,
  },
  fe: {
    shroud: "#3c3f44", shroudMetal: 0.8, shroudRough: 0.32, trim: "#141517", trimMetal: 0.3, back: "#1a1b1d",
    fan: { blades: 7, blade: "#131416", ring: true, hub: "#131416", sweep: -0.7, fill: 0.9 },
    edge: "GEFORCE RTX", edgeColor: "#f4f6f8", edgeLit: 1.4, backText: "", flow: true,
  },
  generic: {
    shroud: "#2f3033", shroudMetal: 0.2, shroudRough: 0.55, trim: "#4a4c50", trimMetal: 0.4, back: "#35373a",
    fan: { blades: 9, blade: "#1b1c1e", hub: "#1b1c1e", sweep: -0.55, fill: 0.8 },
    flow: false,
  },
};

function backplateTex(d: GpuDesign, look: string, L: number, Hc: number, ventFrom: number) {
  const px = 380;
  return canvasTex(`back-${look}-${L}-${Hc}`, Math.round(px * L), Math.round(px * Hc), (g, w, h) => {
    g.fillStyle = d.back; g.fillRect(0, 0, w, h);
    const r = rng(3);
    // Faint machining grain
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.025})`; g.fillRect(0, r() * h, w, 1); }
    g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 2;
    if (look === "tuf") {
      // Angled panel lines and screw bosses
      g.beginPath(); g.moveTo(w * 0.05, h * 0.2); g.lineTo(w * 0.22, h * 0.2); g.lineTo(w * 0.3, h * 0.55); g.lineTo(w * ventFrom - 10, h * 0.55); g.stroke();
      g.beginPath(); g.moveTo(w * 0.05, h * 0.82); g.lineTo(w * 0.5, h * 0.82); g.lineTo(w * 0.56, h * 0.68); g.stroke();
    } else if (look === "strix") {
      g.strokeStyle = "rgba(190,195,202,0.35)"; g.lineWidth = 3;
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(w * (0.12 + k * 0.04), h * 0.9); g.lineTo(w * (0.24 + k * 0.04), h * 0.12); g.stroke(); }
    } else if (look === "ventus") {
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.beginPath(); g.moveTo(0, h * 0.7); g.lineTo(w, h * 0.45); g.stroke();
    }
    if (d.backText) {
      g.fillStyle = look === "strix" ? "rgba(220,224,230,0.55)" : "rgba(220,224,230,0.42)";
      const size = h * (d.backText.length > 10 ? 0.1 : 0.2);
      g.font = `800 ${size}px Arial, Helvetica, sans-serif`;
      g.textBaseline = "middle";
      g.fillText(d.backText, w * 0.08, h * 0.42);
    }
    for (const [sx, sy] of [[0.03, 0.12], [0.03, 0.88], [ventFrom - 0.03, 0.12], [ventFrom - 0.03, 0.88]]) {
      g.fillStyle = "rgba(0,0,0,0.5)"; g.beginPath(); g.arc(w * sx, h * sy, h * 0.025, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(200,200,200,0.35)"; g.beginPath(); g.arc(w * sx, h * sy, h * 0.012, 0, Math.PI * 2); g.fill();
    }
  });
}

/** Where along the card its power plugs sit: the middle on a Founders Edition, past it on most others. */
export const gpuPlugAt = (s: GpuShape) => mm(s.length) * (s.look === "fe" ? 0.5 : 0.6);

/**
 * A graphics card in the board frame: X from the bracket (0) to the far end (length), Y down from the
 * backplate (0) to the fans (-thickness), Z from the slot edge (0) to the top edge (height).
 */
export function makeGpu(kit: Kit, s: GpuShape, o: { power?: boolean } = {}) {
  const look = s.look && gpuDesigns[s.look] ? s.look : "generic";
  const d = gpuDesigns[look];
  const L = mm(s.length), T = mm(s.thick), Hc = mm(s.height);
  const card = new THREE.Group();
  const shroudMat = kit.M(d.shroud, { metal: d.shroudMetal, rough: d.shroudRough, roughMap: d.shroudMetal > 0.5 ? brushed([3, 1]) : undefined });
  const trimMat = kit.M(d.trim, { metal: d.trimMetal, rough: 0.38 });
  const bp = 0.025; // backplate
  const ventFrom = d.flow ? 0.7 : 1;
  const fe = look === "fe";

  // Backplate (or, on a Founders Edition, the top half of its frame)
  if (s.backplate && !fe) {
    const solidEnd = d.flow ? L * ventFrom : L - 0.01;
    const plate = span(0.02, solidEnd, -bp, 0, 0.02, Hc - 0.015, kit.M(d.back, { metal: 0.75, rough: 0.42, roughMap: brushed([4, 1]) }), 0.006);
    card.add(plate);
    if (!fe) {
      const art = new THREE.Mesh(new THREE.PlaneGeometry(solidEnd - 0.04, Hc - 0.05), kit.M("#ffffff", { map: backplateTex(d, look, solidEnd - 0.04, Hc - 0.05, 1), metal: 0.7, rough: 0.45 }));
      art.rotation.x = -Math.PI / 2;
      art.position.set(0.02 + (solidEnd - 0.04) / 2 + 0.01, 0.0015, (Hc - 0.015 + 0.02) / 2);
      card.add(art);
    }
    if (d.flow && !fe) {
      // The vented end: a perforated plate over the fins
      const vent = new THREE.Mesh(new THREE.PlaneGeometry(L - solidEnd - 0.03, Hc - 0.06), kit.M(d.back, { metal: 0.75, rough: 0.45, alphaMap: slots(look, [Math.round((L - solidEnd) * 34), Math.round(Hc * 16)]), side: THREE.DoubleSide }));
      vent.rotation.x = -Math.PI / 2;
      vent.position.set((solidEnd + L - 0.03) / 2, -0.004, Hc / 2);
      card.add(vent);
      card.add(span(L - 0.03, L, -bp, 0, 0.02, Hc - 0.015, kit.M(d.back, { metal: 0.75, rough: 0.42 }), 0.006));
    }
  }
  // Circuit board under the backplate, and the gold fingers in the slot
  const pcbEnd = d.flow ? L * ventFrom : L - 0.03;
  card.add(span(0.015, pcbEnd, -bp - 0.016, -bp, -0.01, Hc - 0.05, kit.M("#141516", { rough: 0.7 }), 0));
  if (!kit.lite) card.add(span(0.42, 1.31, -bp - 0.015, -bp - 0.001, -0.07, -0.01, kit.M("#c9a24a", { metal: 1, rough: 0.3 }), 0));

  // Fin stack: thin aluminum plates across the card, seen through the top edge
  const finTop = -bp - 0.035, finBottom = -T + 0.17;
  const finGeo = new THREE.BoxGeometry(0.004, Math.max(0.05, finTop - finBottom), Hc - 0.1);
  const finAt: THREE.Vector3[] = [];
  for (let x = 0.14; x < L - 0.06; x += kit.lite ? 0.03 : 0.022) finAt.push(new THREE.Vector3(x, (finTop + finBottom) / 2, Hc / 2));
  card.add(instanced(finGeo, kit.M("#c3c7cc", { metal: 0.85, rough: 0.35 }), finAt));
  // Heatpipe bends showing over the top edge
  const pipeMat = kit.M("#d3d6da", { metal: 1, rough: 0.22 });
  const nPipes = look === "generic" || look === "ventus" ? 3 : 5;
  const pipeY = (finTop + finBottom) / 2;
  const bends: THREE.Vector3[][] = [];
  for (let i = 0; i < nPipes; i++) {
    const x = L * 0.33 + i * 0.13;
    bends.push([new THREE.Vector3(x, pipeY - 0.09, Hc - 0.1), new THREE.Vector3(x + 0.02, pipeY - 0.05, Hc - 0.035), new THREE.Vector3(x + 0.02, pipeY + 0.05, Hc - 0.035), new THREE.Vector3(x, pipeY + 0.09, Hc - 0.1)]);
  }
  card.add(pipes(bends, 0.03, pipeMat));

  // Shroud: a plate across the fan side with a round opening for each fan
  const n = s.fans, fs = mm(s.fanMm);
  const fanR = fs * 0.5 + 0.02;
  const centers: number[] = [];
  if (fe) centers.push(L * 0.27);
  else {
    const gap = (L - 0.08 - n * fs) / (n + 1);
    for (let i = 0; i < n; i++) centers.push(0.04 + gap * (i + 1) + fs * (i + 0.5));
  }
  const fanZ = Hc / 2 + 0.01;
  const outline = xz([[0.02, 0.012], [L - (fe ? 0.02 : 0.06), 0.012], [L - 0.012, 0.07], [L - 0.012, Hc - 0.012], [0.02, Hc - 0.012]]);
  for (const cx of centers) outline.holes.push(new THREE.Path(new THREE.Path().absarc(cx, -fanZ, fanR, 0, Math.PI * 2, true).getPoints(48)));
  const sd = 0.05;
  const plateMesh = new THREE.Mesh(plateXZ(outline, sd, -T), shroudMat);
  plateMesh.castShadow = true;
  card.add(plateMesh);
  // Side walls of the shroud, top edge and bottom edge, and the far end
  const wallH = fe ? T - bp : T * 0.52;
  card.add(span(0.02, L - 0.012, -T, -T + wallH, Hc - 0.035, Hc, shroudMat, 0.008));
  card.add(span(0.02, L - 0.012, -T, -T + T * 0.34, 0, 0.03, shroudMat, 0.006));
  card.add(span(L - 0.04, L, -T, fe ? -bp : -T + wallH, 0.03, Hc - 0.035, shroudMat, 0.008));

  // Fans in their openings, blowing up into the fins
  for (const cx of centers) {
    const f = makeFan(kit, fs, 0.13, d.fan);
    f.rotation.x = Math.PI / 2;
    f.position.set(cx, -T + 0.08, fanZ);
    card.add(f);
    // A thin lip round each opening
    const lip = new THREE.Mesh(new THREE.TorusGeometry(fanR, 0.012, 8, 48), look === "strix" ? trimMat : shroudMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.set(cx, -T - 0.002, fanZ);
    card.add(lip);
  }

  // Each maker's own trim
  const face = -T - 0.006;
  if (look === "tuf") {
    // Raised armor between the fans and at each end, held by exposed screws
    const armorMat = kit.M("#26282c", { metal: 0.5, rough: 0.45 });
    for (let i = 0; i < centers.length - 1; i++) {
      const a = centers[i] + fanR + 0.01, b = centers[i + 1] - fanR - 0.01, m = (a + b) / 2;
      card.add(new THREE.Mesh(plateXZ(xz([[m - 0.07, 0.03], [m + 0.07, 0.03], [m + 0.03, Hc - 0.03], [m - 0.03, Hc - 0.03]]), 0.018, face - 0.018), armorMat));
    }
    card.add(new THREE.Mesh(plateXZ(xz([[L - 0.32, 0.03], [L - 0.03, 0.03], [L - 0.03, Hc - 0.03], [L - 0.22, Hc - 0.03]]), 0.012, face - 0.012), armorMat));
    card.add(new THREE.Mesh(plateXZ(xz([[0.03, 0.03], [0.18, 0.03], [0.1, Hc - 0.03], [0.03, Hc - 0.03]]), 0.012, face - 0.012), armorMat));
    const stripe = kit.M("#9aa0a8", { metal: 0.9, rough: 0.3 });
    card.add(new THREE.Mesh(plateXZ(xz([[L - 0.3, 0.05], [L - 0.27, 0.05], [L - 0.17, Hc - 0.05], [L - 0.2, Hc - 0.05]]), 0.006, face - 0.02), stripe));
    if (!kit.lite) {
      const screwMat = kit.M("#c9ccd1", { metal: 1, rough: 0.3 });
      const sc: THREE.Vector3[] = [];
      for (const cx of centers) for (const sz of [0.045, Hc - 0.045]) sc.push(new THREE.Vector3(cx - fanR * 0.7, face - 0.004, sz), new THREE.Vector3(cx + fanR * 0.7, face - 0.004, sz));
      card.add(instanced(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 6), screwMat, sc));
    }
  } else if (look === "strix") {
    // Silver slashes and a lit stripe across the far end
    for (const x0 of [0.05, L - 0.36]) {
      card.add(new THREE.Mesh(plateXZ(xz([[x0, 0.03], [x0 + 0.06, 0.03], [x0 + 0.2, Hc - 0.03], [x0 + 0.14, Hc - 0.03]]), 0.012, face - 0.012), trimMat));
    }
    const lit = new THREE.Mesh(plateXZ(xz([[L - 0.25, 0.03], [L - 0.215, 0.03], [L - 0.075, Hc - 0.03], [L - 0.11, Hc - 0.03]]), 0.008, face - 0.016), kit.M("#ffffff", { map: rgbStrip(), emissive: "#ffffff", ei: 1.2, emap: true }));
    card.add(lit);
  } else if (look === "ventus") {
    const grey = kit.M(d.trim, { metal: 0.2, rough: 0.6 });
    const m = (centers[0] + centers[centers.length - 1]) / 2;
    card.add(new THREE.Mesh(plateXZ(xz([[m - 0.05, 0.03], [m + 0.02, 0.03], [m + 0.05, Hc - 0.03], [m - 0.02, Hc - 0.03]]), 0.012, face - 0.012), grey));
    card.add(new THREE.Mesh(plateXZ(xz([[L - 0.14, 0.03], [L - 0.04, 0.03], [L - 0.04, Hc - 0.03], [L - 0.08, Hc - 0.03]]), 0.012, face - 0.012), grey));
  } else if (fe) {
    // Founders Edition: a metal frame round the edges, the second fan on the backplate side at the far end
    const x2 = L * 0.72;
    const top = xz([[0.02, 0.02], [L - 0.02, 0.02], [L - 0.02, Hc - 0.02], [0.02, Hc - 0.02]]);
    top.holes.push(new THREE.Path(new THREE.Path().absarc(x2, -fanZ, fanR, 0, Math.PI * 2, true).getPoints(48)));
    const topPlate = new THREE.Mesh(plateXZ(top, 0.03, -0.03), shroudMat);
    card.add(topPlate);
    const f2 = makeFan(kit, fs, 0.13, d.fan);
    f2.rotation.x = -Math.PI / 2;
    f2.position.set(x2, -0.1, fanZ);
    card.add(f2);
    // Dark center bands between the frame rails
    const dark = kit.M(d.trim, { metal: 0.3, rough: 0.5 });
    card.add(span(centers[0] + fanR + 0.03, L - 0.05, face - 0.004, face, 0.06, Hc - 0.06, dark, 0.004));
  }

  // Name on the top edge, facing the glass, and its light
  if (d.edge) {
    const h = Math.min(0.085, wallH * 0.45);
    const t = decal(kit, d.edge, h, { color: d.edgeColor, weight: 800, italic: look === "tuf" || look === "strix", spacing: look === "fe" ? 0.12 : 0.04, lit: d.edgeLit });
    t.position.set(fe ? L * 0.5 : 0.2 + (t.geometry as THREE.PlaneGeometry).parameters.width / 2, -T + wallH / 2, Hc + 0.002);
    card.add(t);
  }
  if (d.edgeLight) {
    const x0 = look === "strix" ? L * 0.5 : L * 0.62, x1 = look === "strix" ? L - 0.06 : L * 0.78;
    const light = span(x0, x1, -T + wallH * 0.3, -T + wallH * 0.62, Hc - 0.005, Hc + 0.004, kit.M("#ffffff", d.edgeLight === "rgb" ? { map: rgbStrip(), emissive: "#ffffff", ei: 1.4, emap: true } : { emissive: kit.accent, ei: 1.3, rough: 0.3 }), 0.004);
    card.add(light);
  }

  // Power connector (12V-2x6) on the top edge. The card close-up draws its own plugs, with their pins.
  const pc = gpuPlugAt(s);
  if (o.power !== false) card.add(span(pc - 0.1, pc + 0.1, -bp - 0.1, -bp - 0.01, Hc - 0.07, Hc - 0.01, kit.M("#121314", { rough: 0.6 }), 0.004));
  // Slot bracket at the back of the case
  const slotsH = Math.max(2, Math.ceil(T / 0.2032)) * 0.2032;
  card.add(span(-0.015, 0, -slotsH + 0.04, 0.04, -0.05, 1.2, kit.M("#b9bcc0", { metal: 0.9, rough: 0.35 }), 0.003));
  return card;
}

// ---------- processor coolers ----------
interface TowerSpec {
  towers: number[]; tw: number; fw: number; z0: number; z1: number;
  fin: string; tip: string; saw: boolean; fan: FanLook; fanSize: number; fanW?: number; fanH?: number; fanAt: number[]; fanZ: number;
  pipesPerTower: number;
}

function finShape(tw: number, fw: number, saw: boolean) {
  const s = new THREE.Shape();
  const teeth = 9, t = 0.016;
  s.moveTo(-tw / 2, -fw / 2);
  s.lineTo(tw / 2, -fw / 2);
  for (let i = 1; i <= teeth * 2; i++) s.lineTo(tw / 2 - (saw && i % 2 ? t : 0), -fw / 2 + (fw * i) / (teeth * 2));
  s.lineTo(-tw / 2, fw / 2);
  for (let i = 1; i <= teeth * 2; i++) s.lineTo(-tw / 2 + (saw && i % 2 ? t : 0), fw / 2 - (fw * i) / (teeth * 2));
  return s;
}

function towerCooler(kit: Kit, sp: TowerSpec) {
  const g = new THREE.Group();
  // Fins: thin plates parallel to the board, stacked away from it
  const fin = new THREE.ExtrudeGeometry(finShape(sp.tw, sp.fw, sp.saw), { depth: 0.005, bevelEnabled: false });
  const at: THREE.Vector3[] = [];
  const pitch = kit.lite ? 0.04 : 0.026;
  for (const tx of sp.towers) for (let z = sp.z0; z <= sp.z1; z += pitch) at.push(new THREE.Vector3(tx, 0, z));
  g.add(instanced(fin, kit.M(sp.fin, { metal: 0.85, rough: 0.36 }), at));
  // A slightly thicker top fin
  for (const tx of sp.towers) g.add(span(tx - sp.tw / 2, tx + sp.tw / 2, -sp.fw / 2, sp.fw / 2, sp.z1 + 0.005, sp.z1 + 0.02, kit.M(sp.fin, { metal: 0.85, rough: 0.32, roughMap: brushed([1, 2]) }), 0.004));
  // Heatpipes: through the base, bending up into each tower, ends showing above the top fin
  const n = sp.pipesPerTower, paths: THREE.Vector3[][] = [];
  const [ta, tb] = sp.towers.length > 1 ? sp.towers : [sp.towers[0] - 0.08, sp.towers[0] + 0.08];
  for (let i = 0; i < n; i++) {
    const yb = (i / (n - 1) - 0.5) * 0.38, yt = (i / (n - 1) - 0.5) * sp.fw * 0.72, dx = (i % 2 ? 1 : -1) * Math.min(0.08, sp.tw * 0.18);
    paths.push([
      new THREE.Vector3(ta + dx, yt, sp.z1 + 0.06), new THREE.Vector3(ta + dx, yt, sp.z0 + 0.05), new THREE.Vector3(ta * 0.6, (yt + yb) / 2, 0.2),
      new THREE.Vector3(ta * 0.2, yb, 0.08), new THREE.Vector3(tb * 0.2, yb, 0.08), new THREE.Vector3(tb * 0.6, (yt + yb) / 2, 0.2),
      new THREE.Vector3(tb - dx, yt, sp.z0 + 0.05), new THREE.Vector3(tb - dx, yt, sp.z1 + 0.06),
    ]);
  }
  g.add(pipes(paths, 0.03, kit.M(sp.tip, { metal: 1, rough: 0.22 })));
  // Base and mounting bar
  g.add(span(-0.22, 0.22, -0.22, 0.22, 0.02, 0.12, kit.M("#d0d3d7", { metal: 1, rough: 0.25 }), 0.01));
  g.add(span(-0.45, 0.45, -0.06, 0.06, 0.12, 0.15, kit.M("#b7babf", { metal: 0.9, rough: 0.35 }), 0.006));
  // Fans, blowing front to back through the towers
  for (const fx of sp.fanAt) {
    const f = makeFan(kit, sp.fanSize, 0.25, { ...sp.fan, w: sp.fanW, h: sp.fanH });
    f.rotation.y = Math.PI / 2;
    f.position.set(fx, 0, sp.fanZ);
    g.add(f);
    if (!kit.lite) {
      // Wire clips holding the fan to the fins
      const clip = kit.M("#c5c8cc", { metal: 1, rough: 0.3 });
      for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, (sp.fanH ?? sp.fanSize) * 0.8, 6), clip);
        c.position.set(fx + 0.04, 0, sp.fanZ + sz * ((sp.fanW ?? sp.fanSize) / 2 + 0.012));
        g.add(c);
      }
    }
  }
  return g;
}

/** Arctic Liquid Freezer III pump head, in the board frame on the socket. */
function lf3Pump(kit: Kit) {
  const g = new THREE.Group();
  const body = kit.M("#1c1d20", { rough: 0.55, metal: 0.1 });
  g.add(rbox(0.82, 0.74, 0.42, body, 0.04, 0, 0.25, 0.08));
  // Cover with its vent for the small VRM fan, and the name
  g.add(rbox(0.7, 0.62, 0.03, kit.M("#26272b", { rough: 0.35, metal: 0.3 }), 0.04, 0, 0.47, 0.05));
  const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.14), kit.M("#0c0c0d", { alphaMap: slots("lf3", [8, 1]), side: THREE.DoubleSide }));
  vent.position.set(0.04, -0.2, 0.486);
  g.add(vent);
  const name = decal(kit, "ARCTIC", 0.08, { color: "#d9dbde", weight: 700, spacing: 0.18 });
  name.position.set(0.04, 0.1, 0.487);
  g.add(name);
  // Hose fittings, pointing up
  for (const dx of [-0.12, 0.12]) {
    const fit = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 18), kit.M("#111214", { rough: 0.5 }));
    fit.position.set(0.3 + dx, 0.4, 0.3);
    g.add(fit);
  }
  return g;
}

/**
 * A radiator with its fans, in the board frame, lying flat under the top panel: X along its length,
 * Y its thickness (fans underneath blowing up), Z across. Centered on its own middle.
 */
export function makeRadiator(kit: Kit, c: CoolerShape) {
  const g = new THREE.Group();
  const n = (c.radiator ?? 360) / 120;
  const len = n * 1.2 + 0.38, wid = 1.2, th = 0.38;
  const finTex = canvasTex("rad-fins", 64, 64, (ctx) => {
    ctx.fillStyle = "#121315"; ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "#3a3c40"; ctx.lineWidth = 2;
    for (let x = 0; x < 64; x += 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke(); }
    ctx.fillStyle = "#1e1f22"; ctx.fillRect(0, 28, 64, 8);
  }, { repeat: [Math.round(len * 12), 1] });
  const core = kit.M("#ffffff", { map: finTex, rough: 0.6, metal: 0.4 });
  g.add(span(-len / 2 + 0.2, len / 2 - 0.2, 0, th, -wid / 2, wid / 2, core, 0));
  const tank = kit.M(c.color, { rough: 0.5, metal: 0.2 });
  g.add(span(-len / 2, -len / 2 + 0.2, 0, th, -wid / 2 - 0.02, wid / 2 + 0.02, tank, 0.02));
  g.add(span(len / 2 - 0.2, len / 2, 0, th, -wid / 2 - 0.02, wid / 2 + 0.02, tank, 0.02));
  const name = decal(kit, "ARCTIC", 0.08, { color: "#cfd2d6", weight: 700, spacing: 0.18 });
  name.rotation.x = -Math.PI / 2;
  name.position.set(-len / 2 + 0.1, th + 0.001, 0);
  name.rotation.z = Math.PI / 2;
  g.add(name);
  const fanLook: FanLook = { blades: 5, blade: "#151618", frame: "#151618", hub: "#151618", sticker: { text: "ARCTIC", bg: "#151618", color: "#cfd2d6" }, sweep: -0.6, fill: 0.92 };
  for (let i = 0; i < n; i++) {
    const f = makeFan(kit, 1.2, 0.25, fanLook);
    f.rotation.x = Math.PI / 2;
    f.position.set((i - (n - 1) / 2) * 1.22, -0.125, 0);
    g.add(f);
  }
  return g;
}

/** AMD Wraith Prism: a round shroud with a lit ring over a round heatsink. */
function wraith(kit: Kit, h: number) {
  const g = new THREE.Group();
  const finAt: THREE.Vector3[] = [], rot: THREE.Euler[] = [];
  for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; finAt.push(new THREE.Vector3(Math.cos(a) * 0.32, Math.sin(a) * 0.32, h * 0.33)); rot.push(new THREE.Euler(0, 0, a)); }
  g.add(instanced(new THREE.BoxGeometry(0.3, 0.008, h * 0.5), kit.M("#b8bcc1", { metal: 0.85, rough: 0.4 }), finAt, rot));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, h * 0.55, 24), kit.M("#c27a4a", { metal: 1, rough: 0.3 }));
  core.rotation.x = Math.PI / 2; core.position.z = h * 0.3;
  g.add(core);
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, h * 0.42, 48, 1, true), kit.M("#141416", { rough: 0.45, side: THREE.DoubleSide }));
  shroud.rotation.x = Math.PI / 2; shroud.position.z = h * 0.72;
  g.add(shroud);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.025, 8, 64), kit.M("#ffffff", { map: rgbStrip(), emissive: "#ffffff", ei: 1.5, emap: true }));
  ring.position.z = h * 0.93;
  g.add(ring);
  const f = makeFan(kit, 0.98, 0.2, { blades: 7, blade: "#2a2b2e", bladeOp: 0.85, hub: "#141416", sticker: { text: "AMD", bg: "#141416", color: "#e8e8e8" }, sweep: -0.7, fill: 0.85 });
  f.position.z = h * 0.8;
  g.add(f);
  return g;
}

export interface CoolerParts { head: THREE.Group; radiator?: THREE.Group }

/** The processor cooler in the board frame, centered on the socket at the board's surface. */
export function makeCooler(kit: Kit, c: CoolerShape, fallbackFan: FanLook): CoolerParts {
  const h = mm(c.height);
  if (c.kind === "aio") return { head: lf3Pump(kit), radiator: makeRadiator(kit, c) };
  if (c.kind === "low-profile") return { head: wraith(kit, h) };
  if (c.look === "nh-d15") {
    return { head: towerCooler(kit, {
      towers: [-0.375, 0.375], tw: 0.5, fw: 1.5, z0: 0.36, z1: h - 0.08, fin: "#cdd1d6", tip: "#d6d8dc", saw: true,
      fan: { blades: 7, blade: "#6a3f2e", frame: "#d3c0a1", hub: "#6a3f2e", pads: "#6a3f2e", sticker: { text: "noctua", bg: "#6a3f2e", color: "#e9d8bb" }, sweep: -0.85, fill: 0.96 },
      fanSize: 1.4, fanW: 1.4, fanH: 1.5, fanAt: [0, 0.75], fanZ: 0.97, pipesPerTower: 6,
    }) };
  }
  if (c.look === "pa120") {
    return { head: towerCooler(kit, {
      towers: [-0.3, 0.3], tw: 0.44, fw: 1.25, z0: 0.34, z1: h - 0.07, fin: c.color, tip: "#d6d8dc", saw: false,
      fan: { blades: 9, blade: "#1a1b1e", frame: c.fanColor ?? "#18191b", hub: "#18191b", sticker: { text: "Thermalright", bg: "#18191b", color: "#cfd2d6" }, sweep: -0.6, fill: 0.82 },
      fanSize: 1.2, fanAt: [0, 0.645], fanZ: 0.86, pipesPerTower: 6,
    }) };
  }
  const dual = c.kind === "dual-tower";
  const fs = mm(c.fanMm);
  return { head: towerCooler(kit, {
    towers: dual ? [-0.3, 0.3] : [0], tw: dual ? 0.44 : 0.5, fw: fs + 0.05, z0: 0.34, z1: h - 0.07, fin: "#c9ccd0", tip: "#d6d8dc", saw: false,
    fan: fallbackFan, fanSize: fs, fanAt: dual ? [0, 0.645] : [0.38], fanZ: h / 2 + 0.06, pipesPerTower: 4,
  }) };
}

// ---------- memory ----------
/** One memory stick in the board frame: X its thickness, Y its length (centered), Z up from the slot. */
export function makeRam(kit: Kit, m: MemoryShape) {
  const g = new THREE.Group();
  const H = mm(m.height), L = 1.33, look = m.look ?? "generic";
  g.add(span(-0.006, 0.006, -L / 2, L / 2, 0.02, H - 0.03, kit.M("#111213", { rough: 0.7 }), 0));
  const lit = look === "vengeance-rgb" ? 0.085 : look === "dominator" ? 0.1 : 0;
  const top = H - lit;
  // Heatspreader outline, drawn along Y and up Z, pressed out to each side
  const profile = (): [number, number][] => {
    if (look === "vengeance") return [[-L / 2, 0.06], [L / 2, 0.06], [L / 2, top - 0.05], [L / 2 - 0.08, top - 0.03], [L * 0.12, top - 0.03], [L * 0.08, top], [-L * 0.42, top], [-L / 2, top - 0.06]];
    if (look === "vengeance-rgb") return [[-L / 2, 0.06], [L / 2, 0.06], [L / 2, top], [L * 0.3, top], [L * 0.26, top - 0.03], [-L / 2 + 0.06, top - 0.03], [-L / 2, top]];
    if (look === "dominator") return [[-L / 2, 0.06], [L / 2, 0.06], [L / 2, top], [-L / 2, top]];
    return [[-L / 2, 0.05], [L / 2, 0.05], [L / 2, top - 0.01], [-L / 2, top - 0.01]];
  };
  const shape = new THREE.Shape(profile().map(([y, z]) => new THREE.Vector2(y, z)));
  const color = look === "dominator" ? "#2e3034" : m.color;
  const spreader = kit.M(color, { metal: look === "generic" ? 0.2 : 0.7, rough: look === "dominator" ? 0.32 : 0.45, roughMap: look === "dominator" ? brushed([1, 4]) : undefined });
  for (const side of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
    // Shape (Y, Z) pressed out along X: a rotation, not a mirror
    geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    const mesh = new THREE.Mesh(geo, spreader);
    mesh.position.x = side > 0 ? 0.008 : -0.03;
    mesh.castShadow = true;
    g.add(mesh);
  }
  // Printed name on the side facing the front of the case
  const name = look === "vengeance" ? "VENGEANCE" : look === "vengeance-rgb" ? "VENGEANCE RGB" : look === "dominator" ? "DOMINATOR" : "";
  if (name) {
    const t = decal(kit, name, look === "dominator" ? 0.12 : 0.1, { color: look === "dominator" ? "#d9dbdf" : "#8d9096", weight: 800, spacing: 0.06 });
    t.rotation.set(0, Math.PI / 2, Math.PI / 2);
    t.position.set(0.035, 0.02, Math.max(0.12, top * 0.55));
    g.add(t);
    if (look !== "dominator") {
      const brand = decal(kit, "CORSAIR", 0.06, { color: "#6f7277", weight: 700, spacing: 0.1 });
      brand.rotation.set(0, Math.PI / 2, Math.PI / 2);
      brand.position.set(0.035, -0.38, Math.max(0.1, top * 0.55));
      g.add(brand);
    }
  }
  if (lit) {
    // Light bar across the top: a frosted diffuser lit in rainbow (Vengeance RGB) or as a row of LEDs (Dominator)
    const bar = span(-0.03, 0.03, -L / 2 + 0.02, L / 2 - 0.02, top, H, kit.M("#ffffff", { map: rgbStrip(), emissive: "#ffffff", ei: look === "dominator" ? 0.9 : 1.3, emap: true, rough: 0.4 }), 0.012);
    g.add(bar);
    if (look === "dominator") {
      g.add(span(-0.034, 0.034, -L / 2, L / 2, top - 0.012, top + 0.004, kit.M("#c9ccd1", { metal: 1, rough: 0.25, roughMap: brushed([1, 6]) }), 0.004));
    }
  }
  return g;
}

/** The default case and cooler fan when the model isn't known. */
export const plainFan = (frame: string, blade = frame): FanLook => ({ blades: 7, blade, frame, hub: frame, sweep: -0.6, fill: 0.84 });
