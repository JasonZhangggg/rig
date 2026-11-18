// 3D view of the PC, drawn in ink: flat toon shading with outlined edges.
// Models are built in code from part sizes. Popular cases,
// graphics cards and boards will load a matched model from a library instead,
// and anything else falls back to a shape built like this one.
// Units: 1 unit = 100 mm.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import { formatTemp, type PC, type Part, type TempUnit } from "@rig/core";
import { reducedMotion } from "./appearance";

export interface SceneTheme {
  bg: string; floor: string; caseColor: string; trim: string; glass: string; glassOpacity: number;
  board: string; heatsink: string; fins: string; copper: string; fanFrame: string; ram: string;
  gpuShroud: string; gpuBack: string; gpuFanRing: string; psu: string; laptopShell: string;
  chip: string; battery: string; ssd: string; keys: string; trackpad: string;
  screenBg: string; screenPanel: string; screenLine: string;
  heatCool: string; heatWarm: string; heatHot: string; highlight: string;
  /** Light strips, fan rings and the turntable rim. Without it they take the PC's own accent. */
  accent?: string;
  hemi: number; key: number; rim: number; rimColor?: string; exposure?: number;
  /** Let the page show through behind the model; only a soft shadow stays on the floor. */
  transparent?: boolean;
  /** Strength of the soft shadow under the PC (0 to 1). */
  shadow?: number;
  /** Thin outline on glass and panel edges, so the case reads clearly. */
  edge?: string; edgeOpacity?: number;
  /** Soft light halos around fans and light strips. "add" glows on dark backdrops, "normal" tints on light ones. */
  glow?: number; glowBlend?: "add" | "normal";
  /** Colored light inside the case, in the PC's accent color. */
  interior?: number;
  /** Turntable the PC stands on. */
  pedestal?: string; pedestalRim?: number;
  /** Airflow particles: strength and cool/warm colors. */
  air?: number; airCool?: string; airWarm?: string; airBlend?: "add" | "normal";
}

export interface PCScene {
  setPC(pc: PC, theme: SceneTheme): void;
  /** New readings for the same PC: updates fan speeds and heat colors without rebuilding. */
  update(pc: PC): void;
  setTheme(theme: SceneTheme): void;
  setExploded(v: boolean): void;
  setHeat(v: boolean): void;
  select(id: string | null): void;
  resetView(): void;
  /** Wheel zoom on or off, so a page can scroll past a small preview. */
  setZoomable(v: boolean): void;
  /** Slow side-to-side sway, for previews. */
  setSpin(v: boolean): void;
  /** Show air moving through the case. */
  setAirflow(v: boolean): void;
  /** The unit the part labels show temperatures in. */
  setTempUnit(unit: TempUnit): void;
  dispose(): void;
}

type Vec3 = [number, number, number];
interface MatOpts { op?: number; emissive?: string; ei?: number }
interface Entry { obj: THREE.Object3D; partId: string; fadeWhenExploded?: boolean }
/** The camera's vertical field of view on a landscape stage, in degrees. */
const BASE_FOV = 32;

/** Widens the view on a stage taller than it is wide, so the sides of the PC aren't cut off. */
export function fovFor(aspect: number) {
  if (aspect >= 1) return BASE_FOV;
  const half = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
  return THREE.MathUtils.radToDeg(2 * Math.atan(half / aspect));
}

interface Framing { target: THREE.Vector3; cam: THREE.Vector3; camExploded: THREE.Vector3 }


export function createScene(
  container: HTMLElement,
  { onSelect, onHover }: { onSelect?: (id: string | null) => void; onHover?: (id: string | null) => void } = {},
): PCScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const outlined = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultKeepAlive: true });

  const labels = new CSS2DRenderer();
  labels.domElement.className = "scene-labels";
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 4;
  controls.maxDistance = 22;
  controls.enablePan = false;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.6);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 10, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(-6, 5, -6);
  scene.add(rim);
  // Soft fill from the front left so the dark side never goes flat black
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
  fill.position.set(-7, 3, 6);
  scene.add(fill);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const shadowFloor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.ShadowMaterial({ opacity: 0.45 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = 0.001;
  shadowFloor.receiveShadow = true;
  shadowFloor.visible = false;
  scene.add(shadowFloor);
  // Soft contact shadow under the PC, like a product photo
  const blobTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    if (g) {
      // alphaMap reads the green channel, so paint an opaque gray ramp
      g.fillStyle = "#000"; g.fillRect(0, 0, 256, 256);
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, "#fff");
      grad.addColorStop(0.35, "#b3b3b3");
      grad.addColorStop(0.7, "#333");
      grad.addColorStop(1, "#000");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    }
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, depthWrite: false, opacity: 0.3, toneMapped: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.003;
  blob.renderOrder = -1;
  scene.add(blob);
  const contact = blob.clone();
  contact.material = (blob.material as THREE.MeshBasicMaterial).clone();
  contact.position.y = 0.004;
  scene.add(contact);

  // Round soft dot used for halos and airflow particles
  const dotTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.25, "rgba(255,255,255,.65)");
      grad.addColorStop(0.6, "rgba(255,255,255,.18)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(c);
  })();

  // Turntable: a glossy disc with a thin lit edge, like a product stand
  const PED_TOP = -0.05;
  const pedestal = new THREE.Group();
  const pedMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 });
  const pedDisc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.02, 0.16, 96), pedMat);
  pedDisc.position.y = PED_TOP - 0.08;
  pedDisc.receiveShadow = true;
  pedestal.add(pedDisc);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true });
  const pedRim = new THREE.Mesh(new THREE.TorusGeometry(1.012, 0.012, 8, 160), rimMat);
  pedRim.rotation.x = Math.PI / 2;
  pedRim.position.y = PED_TOP - 0.004;
  pedestal.add(pedRim);
  scene.add(pedestal);

  let root = new THREE.Group();
  scene.add(root);

  const state = {
    pc: null as PC | null,
    theme: null as SceneTheme | null,
    exploded: false, heat: false,
    selected: null as string | null, hovered: null as string | null,
    explodeT: 0,
    entries: [] as Entry[],
    rotors: [] as { rotor: THREE.Object3D; partId: string }[],
    pickables: [] as THREE.Mesh[],
    labels: {} as Record<string, { el: HTMLButtonElement; obj: CSS2DObject }>,
    pulses: [] as THREE.Sprite[],
    air: null as null | { group: THREE.Group; mats: THREE.ShaderMaterial[] },
    airOn: true,
    tempUnit: "c" as TempUnit,
  };
  const parts = (): Record<string, Part> => state.pc?.parts ?? {};
  const theme = (): SceneTheme => state.theme!;

  // ---------- helpers ----------
  const toonRamp = (() => {
    const t = new THREE.DataTexture(new Uint8Array([96, 178, 255]), 3, 1, THREE.RedFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  })();
  function M(color: THREE.ColorRepresentation, o: MatOpts = {}) {
    const op = o.op ?? 1;
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, transparent: op < 1, opacity: op, depthWrite: op >= 0.5 });
    // A see-through panel would show its own outline hull through it as a grey sheet, so glass gets none
    m.userData.outlineParameters = { thickness: 0.0042, color: new THREE.Color(theme().trim).toArray(), visible: op >= 0.5, keepAlive: true };
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
    m.userData.glow = !!o.emissive;
    m.userData.baseEmissive = m.emissive.clone();
    m.userData.baseEI = m.emissiveIntensity;
    m.userData.baseOpacity = m.opacity;
    return m;
  }
  // Soft halo that faces the camera
  function halo(color: string, sx: number, sy: number, opacity: number) {
    const th = theme();
    const add = (th.glowBlend ?? "add") === "add";
    const mat = new THREE.SpriteMaterial({
      map: dotTex, color, transparent: true, depthWrite: false, toneMapped: false,
      opacity: opacity * (th.glow ?? 1), blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(sx, sy, 1);
    sp.renderOrder = 4;
    sp.userData.baseOpacity = mat.opacity;
    return sp;
  }

  // Boxes get slightly rounded edges so light catches them, like real parts.
  function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const r = Math.min(0.035, Math.min(w, h, d) * 0.45);
    const g = r > 0.006 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  function outline(w: number, h: number, d: number) {
    const th = theme();
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: th.edge ?? "#ffffff", transparent: true, opacity: th.edgeOpacity ?? 0.5 }),
    );
    lines.raycast = () => {};
    return lines;
  }
  // Perforated mesh pattern for the front panel (holes are see-through).
  function meshTexture(repeatX: number, repeatY: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#fff"; g.fillRect(0, 0, 32, 32);
      g.fillStyle = "#000";
      for (const [x, y] of [[8, 8], [24, 24]]) { g.beginPath(); g.arc(x, y, 5.2, 0, Math.PI * 2); g.fill(); }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 4;
    return t;
  }
  function roundBox(w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const shape = new THREE.Shape();
    const hw = w / 2 - r, hd = d / 2 - r;
    shape.moveTo(-hw, -d / 2);
    shape.lineTo(hw, -d / 2); shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -hd);
    shape.lineTo(w / 2, hd); shape.quadraticCurveTo(w / 2, d / 2, hw, d / 2);
    shape.lineTo(-hw, d / 2); shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, hd);
    shape.lineTo(-w / 2, -hd); shape.quadraticCurveTo(-w / 2, -d / 2, -hw, -d / 2);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: Math.min(0.02, h / 4), bevelSize: Math.min(0.02, r / 2), bevelSegments: 3, curveSegments: 8 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  function fan(size: number, frameColor: string, accent: string, opts: { thick?: number; glow?: number; blade?: string; bladeOp?: number } = {}) {
    const g = new THREE.Group();
    const t = opts.thick ?? 0.25;
    const frameMat = M(frameColor);
    const s = size, w = 0.08;
    g.add(box(s, w, t, frameMat, 0, s / 2 - w / 2, 0));
    g.add(box(s, w, t, frameMat, 0, -s / 2 + w / 2, 0));
    g.add(box(w, s, t, frameMat, s / 2 - w / 2, 0, 0));
    g.add(box(w, s, t, frameMat, -s / 2 + w / 2, 0, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.44, 0.018, 8, 48), M(accent, { emissive: accent, ei: opts.glow ?? 0.9 }));
    ring.position.z = t / 2 - 0.01;
    g.add(ring);
    if ((opts.glow ?? 0.9) >= 0.5) {
      const h = halo(accent, s * 1.25, s * 1.25, 0.32);
      h.position.z = t / 2 + 0.05;
      g.add(h);
    }
    const rotor = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.16, s * 0.16, t * 0.8, 24), M(frameColor));
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);
    const bladeMat = M(opts.blade ?? frameColor, { op: opts.bladeOp ?? 1 });
    bladeMat.side = THREE.DoubleSide;
    const r0 = s * 0.15, r1 = s * 0.43;
    const bs = new THREE.Shape();
    bs.moveTo(r0, -s * 0.05);
    bs.quadraticCurveTo((r0 + r1) / 2, -s * 0.15, r1, -s * 0.07);
    bs.quadraticCurveTo(r1 + s * 0.03, s * 0.04, r1 * 0.88, s * 0.11);
    bs.quadraticCurveTo((r0 + r1) / 2, s * 0.07, r0, s * 0.05);
    const bladeGeo = new THREE.ExtrudeGeometry(bs, { depth: 0.012, bevelEnabled: false, curveSegments: 10 });
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(bladeGeo, bladeMat);
      b.rotation.x = 0.42;
      b.castShadow = true;
      const holder = new THREE.Group();
      holder.add(b);
      holder.rotation.z = (i / 7) * Math.PI * 2;
      rotor.add(holder);
    }
    g.add(rotor);
    g.userData.rotor = rotor;
    return g;
  }

  // Register an object as (part of) a clickable part with an explode offset.
  function add(obj: THREE.Object3D, partId: string, offset: Vec3 = [0, 0, 0], opts: { fade?: boolean; noPick?: boolean } = {}) {
    obj.userData.basePos = obj.position.clone();
    obj.userData.offset = new THREE.Vector3(...offset);
    state.entries.push({ obj, partId, fadeWhenExploded: opts.fade });
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.userData.part = partId;
        if (!opts.noPick) state.pickables.push(o);
      }
    });
    root.add(obj);
    if (obj.userData.rotor) state.rotors.push({ rotor: obj.userData.rotor, partId });
    return obj;
  }

  const labelHTML = (part: Part) =>
    `<span class="pl-name">${part.type}</span>${part.temp ? `<span class="pl-temp${part.warn ? " warn" : ""}">${formatTemp(part.temp, state.tempUnit, { mark: "degree" })}</span>` : ""}`;

  function refreshLabels() {
    for (const [id, l] of Object.entries(state.labels)) {
      const part = parts()[id];
      const html = part ? labelHTML(part) : "";
      if (part && l.el.innerHTML !== html) l.el.innerHTML = html;
    }
  }

  function addLabel(partId: string, anchor: THREE.Object3D, pos: Vec3) {
    const part = parts()[partId];
    if (!part) return;
    const el = document.createElement("button");
    el.className = "part-label";
    el.type = "button";
    el.dataset.part = partId;
    el.innerHTML = labelHTML(part);
    el.addEventListener("click", (e) => { e.stopPropagation(); select(partId); });
    const obj = new CSS2DObject(el);
    obj.position.set(...pos);
    anchor.add(obj);
    state.labels[partId] = { el, obj };
  }

  // ---------- tower ----------
  function buildTower(pc: PC, th: SceneTheme): Framing {
    const W = 2.27, H = 4.46, D = 4.64;
    const caseMat = () => M(th.caseColor);
    const accent = th.accent ?? pc.accent;

    // Case shell
    const shell = new THREE.Group();
    shell.add(box(0.04, H, D, caseMat(), -W / 2, H / 2, 0)); // right side (solid)
    shell.add(box(W, 0.04, D, caseMat(), 0, 0.02, 0)); // bottom
    shell.add(box(W, H, 0.04, caseMat(), 0, H / 2, -D / 2)); // back
    const shroud = box(W - 0.08, 0.9, D - 0.1, M(th.caseColor), 0, 0.49, 0);
    shell.add(shroud);
    // Feet
    for (const [fx, fz] of [[-0.8, -1.9], [0.8, -1.9], [-0.8, 1.9], [0.8, 1.9]]) {
      shell.add(box(0.3, 0.06, 0.3, M(th.trim), fx, -0.02, fz));
    }
    add(shell, "case");
    const top = box(W, 0.04, D, caseMat(), 0, H - 0.02, 0);
    top.add(outline(W, 0.04, D));
    add(top, "case", [0, 1.2, 0]);
    // Front mesh panel
    const front = new THREE.Group();
    const meshMat = M(th.caseColor);
    meshMat.alphaMap = meshTexture(W * 14, H * 14);
    meshMat.transparent = true;
    meshMat.alphaTest = 0.4;
    meshMat.side = THREE.DoubleSide;
    meshMat.userData.baseOpacity = 1;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.12, H - 0.12), meshMat);
    panel.position.set(0, H / 2, D / 2 + 0.02);
    front.add(panel);
    // Frame around the mesh
    const fm = caseMat();
    front.add(box(W, 0.08, 0.06, fm, 0, 0.04, D / 2));
    front.add(box(W, 0.08, 0.06, fm, 0, H - 0.04, D / 2));
    front.add(box(0.08, H, 0.06, fm, -W / 2 + 0.04, H / 2, D / 2));
    front.add(box(0.08, H, 0.06, fm, W / 2 - 0.04, H / 2, D / 2));
    // Accent light strip: part of identity
    front.add(box(0.05, H * 0.82, 0.02, M(accent, { emissive: accent, ei: 1.4 }), W / 2 - 0.12, H / 2, D / 2 + 0.03));
    const stripGlow = halo(accent, 0.55, H * 0.95, 0.5);
    stripGlow.position.set(W / 2 - 0.12, H / 2, D / 2 + 0.08);
    front.add(stripGlow);
    add(front, "case", [0, 0, 1.8], { noPick: true });
    // Glass side panel
    const glassMat = M(th.glass, { op: th.glassOpacity });
    const glass = box(0.02, H - 0.12, D - 0.12, glassMat, W / 2, H / 2, 0);
    glass.castShadow = false;
    glass.add(outline(0.02, H - 0.12, D - 0.12));
    add(glass, "case", [2.6, 0, 0], { noPick: true, fade: true });

    // Motherboard against the right side
    const bx = -W / 2 + 0.2;
    const mb = new THREE.Group();
    mb.position.set(bx, 2.72, -0.88);
    mb.add(box(0.03, 3.05, 2.44, M(th.board), 0, 0, 0));
    const hs = M(th.heatsink);
    mb.add(box(0.18, 0.95, 0.3, hs, 0.1, 0.85, -0.6)); // VRM
    mb.add(box(0.18, 0.3, 0.9, hs, 0.1, 1.35, -0.25)); // VRM top
    mb.add(box(0.06, 0.45, 0.45, hs, 0.04, -1.05, 0.6)); // chipset
    // PCIe slots
    for (const y of [-0.55, -1.25]) mb.add(box(0.06, 0.07, 1.6, M(th.trim), 0.04, y, -0.25));
    // DIMM slots
    for (let i = 0; i < 4; i++) mb.add(box(0.06, 1.33, 0.05, M(th.trim), 0.04, 0.62, 0.76 + i * 0.1));
    // I/O shroud
    mb.add(box(0.25, 1.1, 0.25, M(th.trim), 0.13, 0.75, -1.05));
    add(mb, "motherboard", [-0.4, 0, 0]);

    // CPU cooler (dual tower)
    const cool = new THREE.Group();
    cool.position.set(bx + 0.75, 3.4, -0.8);
    const finMat = M(th.fins);
    for (const zc of [-0.35, 0.35]) {
      for (let i = 0; i < 18; i++) {
        cool.add(box(1.05, 0.012, 0.52, finMat, 0.05, -0.62 + i * 0.075, zc));
      }
    }
    for (const zc of [-0.35, 0.35]) for (const dz of [-0.12, 0.12]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 12), M(th.copper));
      pipe.position.set(-0.35, -0.05, zc + dz);
      cool.add(pipe);
    }
    const cfan = fan(1.2, th.fanFrame, accent, { glow: 0.7 });
    cfan.position.set(0.05, 0, 0.0);
    cfan.scale.set(0.95, 1.05, 0.9);
    cool.add(cfan);
    state.rotors.push({ rotor: cfan.userData.rotor, partId: "cpu" });
    add(cool, "cpu", [1.9, 0.9, 0.4]);

    // RAM sticks (slots 2 and 4)
    const ram = new THREE.Group();
    ram.position.set(bx + 0.24, 3.34, -0.12);
    for (const i of [0, 2]) {
      const stick = new THREE.Group();
      stick.add(box(0.36, 1.33, 0.06, M(th.ram), 0, 0, 0));
      stick.add(box(0.06, 1.25, 0.065, M(accent, { emissive: accent, ei: 1.2 }), 0.2, 0, 0));
      stick.position.z = i * 0.1;
      const rg = halo(accent, 0.45, 1.5, 0.28);
      rg.position.set(0.24, 0, 0);
      stick.add(rg);
      ram.add(stick);
    }
    add(ram, "ram", [1.4, 1.6, 0.9]);

    // SSD under its heatsink
    const ssd = box(0.03, 0.22, 0.8, M(th.heatsink), bx + 0.06, 2.58, -0.75);
    add(ssd, "ssd", [2.4, 0.25, 1.1]);

    // Graphics card
    const gpu = new THREE.Group();
    gpu.position.set(bx + 0.72, 2.0, -0.93);
    gpu.add(box(1.34, 0.42, 2.67, M(th.gpuShroud), 0, 0, 0));
    // Fin stack peeking out of the sides
    const gfin = M(th.fins);
    for (let i = 0; i < 22; i++) gpu.add(box(1.36, 0.26, 0.012, gfin, 0, -0.02, -1.15 + i * 0.105));
    gpu.add(box(1.3, 0.04, 2.6, M(th.gpuBack), 0, 0.23, 0)); // backplate
    gpu.add(box(0.03, 0.06, 1.6, M(accent, { emissive: accent, ei: 1.0 }), 0.68, 0.12, 0.2)); // light bar
    for (const z of [-0.62, 0.62]) {
      const f = fan(0.95, th.gpuShroud, th.gpuFanRing, { thick: 0.12, glow: 0.15 });
      f.rotation.x = Math.PI / 2;
      f.position.set(0, -0.22, z);
      gpu.add(f);
      state.rotors.push({ rotor: f.userData.rotor, partId: "gpu" });
    }
    if (pc.parts?.gpu?.warn) {
      const heat = halo(th.heatHot, 2.4, 1.2, 0.35);
      heat.position.set(0.1, -0.35, 0);
      heat.userData.pulse = true;
      gpu.add(heat);
      state.pulses.push(heat);
    }
    add(gpu, "gpu", [2.4, -0.6, 1.2]);

    // Accent light inside the case, so the parts are lit like a real build
    if (th.interior) {
      const inner = new THREE.PointLight(accent, th.interior, 6, 1.7);
      inner.position.set(0.55, 3.1, 0.9);
      root.add(inner);
      const low = new THREE.PointLight(accent, th.interior * 0.6, 4, 1.7);
      low.position.set(0.5, 1.2, 1.4);
      root.add(low);
    }

    // Air through the case: in at the front fans, over the parts, out the back and top
    buildAirflow([
      [[0.1, 3.45, 2.7], [0.1, 3.45, 1.7], [0.15, 3.5, 0.4], [-0.1, 3.4, -0.8], [-0.1, 3.4, -1.7], [-0.1, 3.4, -2.8]],
      [[0.1, 2.15, 2.7], [0.2, 2.2, 1.5], [0.3, 2.55, 0.2], [0.1, 3.1, -0.9], [-0.05, 3.45, -1.8], [-0.1, 3.4, -2.8]],
      [[0.1, 2.15, 2.7], [0.35, 1.65, 1.2], [0.35, 1.6, -0.2], [0.3, 2.5, -1.2], [0.0, 3.3, -1.9], [-0.1, 3.35, -2.8]],
    ], th);

    // Power supply inside the shroud
    const psu = box(1.5, 0.82, 1.6, M(th.psu), -0.25, 0.48, -1.4);
    add(psu, "psu", [2.6, -0.1, 0.4]);

    // Case fans
    const fans = new THREE.Group();
    for (const y of [2.15, 3.45]) {
      const f = fan(1.2, th.fanFrame, accent, { glow: 0.8 });
      f.position.set(0, y, D / 2 - 0.2);
      fans.add(f);
      state.rotors.push({ rotor: f.userData.rotor, partId: "fans" });
    }
    add(fans, "fans", [0, 0, 1.0]);
    const rear = fan(1.2, th.fanFrame, accent, { glow: 0.6 });
    rear.position.set(-0.1, 3.4, -D / 2 + 0.18);
    add(rear, "fans", [0, 0, -1.0]);

    // Sleeved cables from the power supply; hidden in the exploded view
    const cables = new THREE.Group();
    const cable = (pts: Vec3[], color: string, r = 0.045) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, r, 10, false), M(color));
      m.castShadow = true;
      cables.add(m);
    };
    cable([[bx + 0.1, 0.95, 0.35], [bx + 0.35, 1.3, 0.4], [bx + 0.5, 2.2, 0.38], [bx + 0.12, 2.6, 0.36]], th.trim, 0.06); // 24-pin
    cable([[bx + 0.6, 0.95, 0.2], [bx + 0.85, 1.45, 0.25], [bx + 1.05, 1.95, 0.32]], th.trim);
    cable([[bx + 0.7, 0.95, 0.12], [bx + 0.95, 1.5, 0.16], [bx + 1.15, 1.98, 0.22]], accent, 0.03);
    add(cables, "psu", [0, 0, 0], { fade: true, noPick: true });

    // Labels
    const lp = (id: string, obj: THREE.Object3D, p: Vec3) => addLabel(id, obj, p);
    lp("gpu", gpu, [0.9, 0, 0.9]);
    lp("cpu", cool, [0.6, 0.85, 0]);
    lp("ram", ram, [0.2, 0.75, 0.2]);
    lp("ssd", ssd, [0.1, 0.2, 0.4]);
    lp("psu", psu, [0.8, 0.3, 0.6]);
    lp("motherboard", mb, [0, -1.5, 1.2]);
    lp("fans", fans, [0.6, 3.7, D / 2]);

    return { target: new THREE.Vector3(0, 1.85, 0), cam: new THREE.Vector3(8.9, 4.5, 9.9), camExploded: new THREE.Vector3(11, 6.2, 10.8) };
  }

  // ---------- airflow ----------
  // Thin flow lines with moving dashes, cool where air comes in and warm where it leaves.
  function buildAirflow(paths: Vec3[][], th: SceneTheme) {
    if (!th.air) return;
    const group = new THREE.Group();
    const mats: THREE.ShaderMaterial[] = [];
    const offsets: Vec3[] = [[0.12, 0.1, 0], [-0.12, -0.1, 0]];
    paths.forEach((path, pi) => offsets.forEach((o, oi) => {
      const curve = new THREE.CatmullRomCurve3(path.map((v, i) => {
        const k = Math.sin((i / (path.length - 1)) * Math.PI);
        return new THREE.Vector3(v[0] + o[0] * (0.5 + k), v[1] + o[1] * (0.5 + k), v[2] + o[2]);
      }));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: Math.random() * 10 }, opacity: { value: th.air },
          cool: { value: new THREE.Color(th.airCool ?? "#7CC4FF") }, warm: { value: new THREE.Color(th.airWarm ?? "#FF9A55") },
          phase: { value: pi * 0.37 + oi * 0.21 },
        },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float time; uniform float opacity; uniform vec3 cool; uniform vec3 warm; uniform float phase; varying vec2 vUv;
          void main(){
            float u = vUv.x;
            float f = fract(u * 4.0 - time * 0.4 + phase);
            float dash = smoothstep(0.0, 0.25, f) * (1.0 - smoothstep(0.35, 0.6, f));
            float ends = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.85, 1.0, u));
            vec3 c = mix(cool, warm, smoothstep(0.2, 0.85, u));
            float a = dash * ends * opacity;
            if (a < 0.01) discard;
            gl_FragColor = vec4(c, a);
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false,
        blending: (th.airBlend ?? "add") === "add" ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.016, 6, false), mat);
      tube.renderOrder = 6;
      group.add(tube);
      mats.push(mat);
    }));
    root.add(group);
    state.air = { group, mats };
  }
  function stepAir(dt: number) {
    const a = state.air;
    if (!a) return;
    const vis = state.airOn ? 1 - easeInOut(state.explodeT) : 0;
    a.group.visible = vis > 0.01;
    if (!a.group.visible) return;
    const speed = (parts().fans?.fan ?? 1100) / 1100;
    for (const m of a.mats) {
      if (!reducedMotion()) m.uniforms.time.value += dt * speed;
      m.uniforms.opacity.value = (theme().air ?? 0) * vis;
    }
  }

  // ---------- laptop ----------
  function screenTexture(accent: string, th: SceneTheme) {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 640;
    const g = c.getContext("2d")!;
    g.fillStyle = th.screenBg; g.fillRect(0, 0, 1024, 640);
    g.fillStyle = th.screenPanel; g.fillRect(0, 0, 200, 640);
    g.fillStyle = accent; g.fillRect(40, 48, 120, 18);
    for (let i = 0; i < 6; i++) { g.fillStyle = th.screenLine; g.fillRect(40, 110 + i * 46, 110, 12); }
    for (let i = 0; i < 3; i++) { g.fillStyle = th.screenPanel; g.fillRect(240 + i * 255, 60, 230, 150); g.fillStyle = i === 0 ? accent : th.screenLine; g.fillRect(260 + i * 255, 150, 120 - i * 20, 26); }
    g.strokeStyle = accent; g.lineWidth = 6; g.beginPath();
    for (let x = 0; x <= 740; x += 20) { const y = 470 - Math.sin(x / 70) * 50 - (x / 740) * 60; x === 0 ? g.moveTo(250 + x, y) : g.lineTo(250 + x, y); }
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function buildLaptop(pc: PC, th: SceneTheme): Framing {
    const W = 3.12, D = 2.2;
    const accent = th.accent ?? pc.accent;
    const shellMat = () => M(th.laptopShell);

    // Bottom cover
    const bottom = roundBox(W, 0.04, D, 0.12, shellMat(), 0, 0.02, 0);
    for (const [fx, fz] of [[-1.2, -0.85], [1.2, -0.85], [-1.2, 0.85], [1.2, 0.85]]) bottom.add(box(0.5, 0.02, 0.06, M(th.trim), fx, -0.03, fz));
    add(bottom, "chassis", [0, -1.1, 0]);

    // Internals
    const board = box(1.9, 0.015, 0.9, M(th.board), 0.1, 0.01, -0.5);
    const boardG = new THREE.Group(); boardG.add(board);
    add(boardG, "board", [0, 0.7, 0]);
    const cpu = new THREE.Group();
    cpu.add(box(0.28, 0.03, 0.22, M(th.chip), 0.1, 0.03, -0.5));
    const pipeMat = M(th.copper);
    for (const dz of [-0.06, 0.06]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 10), pipeMat);
      p.rotation.z = Math.PI / 2; p.position.set(0.1, 0.06, -0.5 + dz);
      cpu.add(p);
    }
    add(cpu, "cpu", [0, 0.95, 0]);
    const ram = new THREE.Group();
    for (let i = 0; i < 4; i++) ram.add(box(0.14, 0.02, 0.16, M(th.chip), -0.35 + (i % 2) * 0.18, 0.025, -0.68 + Math.floor(i / 2) * 0.36));
    add(ram, "ram", [0, 0.85, 0]);
    const lfans = new THREE.Group();
    for (const x of [-1.15, 1.25]) {
      const f = fan(0.62, th.fanFrame, th.fanFrame, { thick: 0.08, glow: 0 });
      f.rotation.x = -Math.PI / 2;
      f.position.set(x, 0.06, -0.6);
      lfans.add(f);
      state.rotors.push({ rotor: f.userData.rotor, partId: "fans" });
    }
    add(lfans, "fans", [0, 1.1, 0]);
    const bat = roundBox(2.5, 0.06, 0.82, 0.05, M(th.battery), 0, 0.04, 0.55);
    add(bat, "battery", [0, 0.5, 0.25]);
    const ssd = box(0.22, 0.02, 0.8, M(th.ssd), 0.85, 0.03, -0.45);
    ssd.rotation.y = Math.PI / 2;
    add(ssd, "ssd", [0.2, 0.8, 0.55]);

    // Deck with keyboard, and the lid (move together when exploded)
    const deck = new THREE.Group();
    deck.add(roundBox(W, 0.15, D, 0.12, shellMat(), 0, 0.115, 0));
    const keyMat = M(th.keys);
    const keyGeo = new THREE.BoxGeometry(0.16, 0.02, 0.15);
    const keys = new THREE.InstancedMesh(keyGeo, keyMat, 6 * 14);
    const dummy = new THREE.Object3D();
    let k = 0;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 14; c++) {
      dummy.position.set(-1.2 + c * 0.185, 0.2, -0.82 + r * 0.19);
      dummy.updateMatrix();
      keys.setMatrixAt(k++, dummy.matrix);
    }
    keys.castShadow = true;
    deck.add(keys);
    deck.add(box(1.15, 0.01, 0.62, M(th.trackpad), 0, 0.194, 0.62));
    // Lid
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.19, -D / 2 + 0.02);
    const lid = new THREE.Group();
    lid.add(roundBox(W, 0.06, D, 0.12, shellMat(), 0, 0, D / 2));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.22, D - 0.26), new THREE.MeshBasicMaterial({ map: screenTexture(accent, th), toneMapped: false }));
    screen.rotation.x = Math.PI / 2;
    screen.position.set(0, -0.031, D / 2 + 0.02);
    lid.add(screen);
    // Accent identity: a small light on the lid back
    lid.add(box(0.42, 0.012, 0.42, M(accent, { emissive: accent, ei: 0.5 }), 0, 0.035, D / 2));
    hinge.add(lid);
    hinge.rotation.x = -1.92;
    deck.add(hinge);
    add(deck, "chassis", [0, 1.85, 0]);

    addLabel("cpu", cpu, [0.1, 0.15, -0.5]);
    addLabel("ram", ram, [-0.3, 0.12, -0.6]);
    addLabel("battery", bat, [0.6, 0.1, 0.1]);
    addLabel("ssd", ssd, [0, 0.1, 0]);
    addLabel("fans", lfans, [-1.15, 0.15, -0.6]);
    addLabel("board", boardG, [0.7, 0.05, -0.2]);

    return { target: new THREE.Vector3(0, 0.75, 0), cam: new THREE.Vector3(4.4, 4.2, 6.2), camExploded: new THREE.Vector3(5.6, 5.4, 7.4) };
  }

  // ---------- build / theme ----------
  let framing: Framing | null = null;
  function rebuild() {
    scene.remove(root);
    root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const l of Object.values(state.labels)) l.obj.removeFromParent();
    root = new THREE.Group();
    scene.add(root);
    state.entries = []; state.rotors = []; state.pickables = []; state.labels = {}; state.pulses = []; state.air = null;
    const th = theme();
    scene.background = th.transparent ? null : new THREE.Color(th.bg);
    scene.fog = th.transparent ? null : new THREE.Fog(th.bg, 18, 38);
    floor.material.color.set(th.floor);
    floor.visible = !th.transparent;
    shadowFloor.visible = false;
    hemi.intensity = th.hemi; key.intensity = th.key; rim.intensity = th.rim;
    rim.color.set(th.rimColor ?? "#ffffff");
    renderer.toneMappingExposure = th.exposure ?? 1;
    (shadowFloor.material as THREE.ShadowMaterial).opacity = (th.shadow ?? 0.3) * 0.55;
    framing = state.pc!.kind === "laptop" ? buildLaptop(state.pc!, th) : buildTower(state.pc!, th);
    const bb = new THREE.Box3().setFromObject(root);
    const size = bb.getSize(new THREE.Vector3()), mid = bb.getCenter(new THREE.Vector3());
    const ped = !!th.pedestal;
    pedestal.visible = ped;
    const pr = Math.hypot(size.x, size.z) * 0.5 + 0.3;
    pedestal.position.set(mid.x, 0, mid.z);
    pedestal.scale.set(pr, 1, pr);
    pedMat.color.set(th.pedestal ?? "#ffffff");
    rimMat.color.set(th.accent ?? state.pc!.accent);
    rimMat.opacity = th.pedestalRim ?? 0.8;
    const sy = ped ? PED_TOP + 0.002 : 0.003;
    blob.scale.set(size.x * 1.9 + 0.8, size.z * 1.45 + 0.8, 1);
    blob.position.set(mid.x, sy, mid.z);
    (blob.material as THREE.MeshBasicMaterial).opacity = th.shadow ?? 0.3;
    blob.visible = !!th.transparent;
    contact.scale.set(size.x * 1.2 + 0.2, size.z * 1.08 + 0.2, 1);
    contact.position.set(mid.x, sy + 0.001, mid.z);
    (contact.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, (th.shadow ?? 0.3) * 1.5);
    contact.visible = !!th.transparent;
    // Only the PC's own parts get outlines; the stage, shadows and halos stay clean.
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.material.userData?.outlineParameters) o.material.userData.outlineParameters = { visible: false };
    });
    applyHighlights();
    applyExplode(true);
  }

  function frame(exploded: boolean, instant: boolean) {
    if (!framing) return;
    const want = exploded ? framing.camExploded : framing.cam;
    controls.target.copy(framing.target);
    if (instant) camera.position.copy(want);
    else camAnim = { from: camera.position.clone(), to: want.clone(), t: 0 };
  }
  let camAnim: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;

  function heatColor(t: number) {
    const th = theme();
    const k = THREE.MathUtils.clamp((t - 35) / 55, 0, 1);
    const a = new THREE.Color(th.heatCool), b = new THREE.Color(th.heatWarm), c = new THREE.Color(th.heatHot);
    return k < 0.5 ? a.lerp(b, k * 2) : b.lerp(c, (k - 0.5) * 2);
  }

  function applyHighlights() {
    const all = parts();
    for (const e of state.entries) {
      const p = all[e.partId];
      e.obj.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = o.material as THREE.MeshStandardMaterial;
        if (!m.userData || m.userData.baseEmissive === undefined) return;
        m.emissive.copy(m.userData.baseEmissive);
        m.emissiveIntensity = m.userData.baseEI;
        if (state.heat) {
          if (p && p.temp && !m.userData.glow) {
            m.emissive.copy(heatColor(p.temp));
            m.emissiveIntensity = 0.85;
          }
        }
        const isSel = state.selected === e.partId;
        const isHov = state.hovered === e.partId;
        if ((isSel || isHov) && !m.userData.glow) {
          m.emissive.set(theme().highlight);
          m.emissiveIntensity = isSel ? 0.45 : 0.25;
        }
        // Case panels go see-through in heat view so internals show
        let op = m.userData.baseOpacity;
        if (state.heat && (e.partId === "case" || e.partId === "chassis")) op = Math.min(op, 0.18);
        m.opacity = op;
        m.transparent = op < 1;
        m.depthWrite = op >= 0.5;
      });
    }
    for (const [id, l] of Object.entries(state.labels)) {
      l.el.classList.toggle("is-selected", state.selected === id);
      l.el.hidden = !(state.exploded || state.heat || state.selected === id);
    }
  }

  function applyExplode(instant: boolean) {
    if (instant) state.explodeT = state.exploded ? 1 : 0;
    const t = easeInOut(state.explodeT);
    for (const e of state.entries) {
      const { basePos, offset } = e.obj.userData;
      e.obj.position.copy(basePos).addScaledVector(offset, t);
      if (e.fadeWhenExploded) e.obj.visible = t < 0.98;
    }
  }
  const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt: [number, number] | null = null;
  function pick(ev: PointerEvent): string | null {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(state.pickables, false)[0];
    return hit ? (hit.object.userData.part as string) : null;
  }
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 5) return;
    const id = pick(e);
    select(id);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const id = pick(e);
    if (id !== state.hovered) {
      state.hovered = id;
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
      applyHighlights();
      onHover?.(id);
    }
  });

  function select(id: string | null) {
    state.selected = id && parts()[id] ? id : null;
    applyHighlights();
    onSelect?.(state.selected);
  }

  // ---------- loop ----------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let spin = false, spinT = 0, spinOff = 0, dragging = false;
  controls.addEventListener("start", () => { dragging = true; spin = false; });
  controls.addEventListener("end", () => { dragging = false; });
  const clock = new THREE.Clock();
  // Draws only while the stage is on screen and the tab is showing, and picks up again on the next change.
  let raf = 0, onScreen = true, tabShown = !document.hidden, built = false, gone = false;
  const live = () => built && onScreen && tabShown && !gone;
  function wake() {
    if (raf || !live()) return;
    clock.getDelta();
    tick();
  }
  const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    wake();
  });
  io?.observe(container);
  const onVisibility = () => { tabShown = !document.hidden; wake(); };
  document.addEventListener("visibilitychange", onVisibility);
  function tick() {
    raf = 0;
    if (!live()) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const target = state.exploded ? 1 : 0;
    if (state.explodeT !== target) {
      const step = reducedMotion() ? 1 : dt * 1.6;
      state.explodeT = target > state.explodeT ? Math.min(1, state.explodeT + step) : Math.max(0, state.explodeT - step);
      applyExplode(false);
    }
    if (spin && !camAnim && !dragging && !reducedMotion()) {
      spinT += dt;
      const off = Math.sin(spinT * 0.35) * 0.32;
      const d = off - spinOff;
      spinOff = off;
      const v = camera.position.clone().sub(controls.target);
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), d);
      camera.position.copy(controls.target).add(v);
    }
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + (reducedMotion() ? 1 : dt * 1.4));
      camera.position.lerpVectors(camAnim.from, camAnim.to, easeInOut(camAnim.t));
      if (camAnim.t >= 1) camAnim = null;
    }
    if (!reducedMotion()) {
      for (const { rotor, partId } of state.rotors) {
        const rpm = parts()[partId]?.fan ?? 1200;
        rotor.rotation.z -= dt * rpm * 0.012;
      }
    }
    stepAir(dt);
    if (state.pulses.length) {
      const k = reducedMotion() ? 0.8 : 0.65 + Math.sin(clock.elapsedTime * 2.2) * 0.35;
      for (const sp of state.pulses) (sp.material as THREE.SpriteMaterial).opacity = sp.userData.baseOpacity * k;
    }
    controls.update();
    outlined.render(scene, camera);
    labels.render(scene, camera);
  }

  return {
    setPC(pc, t) {
      state.pc = pc; state.theme = t; state.selected = null;
      rebuild(); resize(); frame(state.exploded, true);
      built = true;
      wake();
    },
    update(pc) { state.pc = pc; refreshLabels(); applyHighlights(); },
    setTheme(t) { state.theme = t; if (state.pc) rebuild(); },
    setExploded(v) { state.exploded = v; applyHighlights(); frame(v, false); },
    setHeat(v) { state.heat = v; applyHighlights(); },
    select,
    resetView() { frame(state.exploded, false); },
    setZoomable(v) { controls.enableZoom = v; },
    setSpin(v) { spin = v; spinT = 0; spinOff = 0; },
    setAirflow(v) { state.airOn = v; },
    setTempUnit(unit) { state.tempUnit = unit; refreshLabels(); },
    dispose() {
      gone = true;
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.dispose();
    },
  };
}
