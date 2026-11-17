// 3D view of the user's PC for the design mockups.
// Models are built in code from part sizes. In the real app, popular cases,
// graphics cards and boards would load a matched model from a library instead,
// and anything else falls back to a shape built like this one.
// Units: 1 unit = 100 mm.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { PC, Part } from "./data";

export interface SceneTheme {
  bg: string; floor: string; caseColor: string; trim: string; glass: string; glassOpacity: number;
  board: string; heatsink: string; fins: string; copper: string; fanFrame: string; ram: string;
  gpuShroud: string; gpuBack: string; gpuFanRing: string; psu: string; laptopShell: string;
  chip: string; battery: string; ssd: string; keys: string; trackpad: string;
  screenBg: string; screenPanel: string; screenLine: string;
  heatCool: string; heatWarm: string; heatHot: string; highlight: string;
  hemi: number; key: number; rim: number; rimColor?: string; exposure?: number;
}

export interface PCScene {
  setPC(pc: PC, theme: SceneTheme): void;
  setTheme(theme: SceneTheme): void;
  setExploded(v: boolean): void;
  setHeat(v: boolean): void;
  select(id: string | null): void;
  resetView(): void;
  dispose(): void;
}

type Vec3 = [number, number, number];
interface MatOpts { r?: number; m?: number; op?: number; emissive?: string; ei?: number }
interface Entry { obj: THREE.Object3D; partId: string; fadeWhenExploded?: boolean }
interface Framing { target: THREE.Vector3; cam: THREE.Vector3; camExploded: THREE.Vector3 }

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createScene(
  container: HTMLElement,
  { onSelect, onHover }: { onSelect?: (id: string | null) => void; onHover?: (id: string | null) => void } = {},
): PCScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = "scene-labels";
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 4;
  controls.maxDistance = 22;
  controls.enablePan = false;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.6);
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

  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

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
  };
  const parts = (): Record<string, Part> => state.pc?.parts ?? {};
  const theme = (): SceneTheme => state.theme!;

  // ---------- helpers ----------
  function M(color: THREE.ColorRepresentation, o: MatOpts = {}) {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: o.r ?? 0.55, metalness: o.m ?? 0.1,
      transparent: o.op !== undefined && o.op < 1, opacity: o.op ?? 1,
      depthWrite: o.op === undefined || o.op >= 0.5,
    });
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
    m.userData.glow = !!o.emissive;
    m.userData.baseEmissive = m.emissive.clone();
    m.userData.baseEI = m.emissiveIntensity;
    m.userData.baseOpacity = m.opacity;
    return m;
  }
  function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
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
    const frameMat = M(frameColor, { r: 0.7 });
    const s = size, w = 0.08;
    g.add(box(s, w, t, frameMat, 0, s / 2 - w / 2, 0));
    g.add(box(s, w, t, frameMat, 0, -s / 2 + w / 2, 0));
    g.add(box(w, s, t, frameMat, s / 2 - w / 2, 0, 0));
    g.add(box(w, s, t, frameMat, -s / 2 + w / 2, 0, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.44, 0.018, 8, 48), M(accent, { emissive: accent, ei: opts.glow ?? 0.9 }));
    ring.position.z = t / 2 - 0.01;
    g.add(ring);
    const rotor = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.16, s * 0.16, t * 0.8, 24), M(frameColor, { r: 0.4 }));
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);
    const bladeMat = M(opts.blade ?? frameColor, { r: 0.5, op: opts.bladeOp ?? 1 });
    for (let i = 0; i < 7; i++) {
      const b = box(s * 0.3, 0.012, t * 0.55, bladeMat, s * 0.26, 0, 0);
      b.rotation.x = 0.5;
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

  function addLabel(partId: string, anchor: THREE.Object3D, pos: Vec3) {
    const part = parts()[partId];
    if (!part) return;
    const el = document.createElement("button");
    el.className = "part-label";
    el.type = "button";
    el.dataset.part = partId;
    el.innerHTML = `<span class="pl-name">${part.type}</span>${part.temp ? `<span class="pl-temp${part.warn ? " warn" : ""}">${part.temp}°</span>` : ""}`;
    el.addEventListener("click", (e) => { e.stopPropagation(); select(partId); });
    const obj = new CSS2DObject(el);
    obj.position.set(...pos);
    anchor.add(obj);
    state.labels[partId] = { el, obj };
  }

  // ---------- tower ----------
  function buildTower(pc: PC, th: SceneTheme): Framing {
    const W = 2.27, H = 4.46, D = 4.64;
    const caseMat = () => M(th.caseColor, { r: 0.45, m: 0.15 });
    const accent = pc.accent;

    // Case shell
    const shell = new THREE.Group();
    shell.add(box(0.04, H, D, caseMat(), -W / 2, H / 2, 0)); // right side (solid)
    shell.add(box(W, 0.04, D, caseMat(), 0, 0.02, 0)); // bottom
    shell.add(box(W, H, 0.04, caseMat(), 0, H / 2, -D / 2)); // back
    const shroud = box(W - 0.08, 0.9, D - 0.1, M(th.caseColor, { r: 0.5 }), 0, 0.49, 0);
    shell.add(shroud);
    // Feet
    for (const [fx, fz] of [[-0.8, -1.9], [0.8, -1.9], [-0.8, 1.9], [0.8, 1.9]]) {
      shell.add(box(0.3, 0.06, 0.3, M(th.trim, { r: 0.9 }), fx, -0.02, fz));
    }
    add(shell, "case");
    const top = box(W, 0.04, D, caseMat(), 0, H - 0.02, 0);
    add(top, "case", [0, 1.2, 0]);
    // Front mesh panel
    const front = new THREE.Group();
    front.add(box(W, H, 0.05, M(th.caseColor, { r: 0.8, op: 0.55 }), 0, H / 2, D / 2));
    // Accent light strip: part of identity
    front.add(box(0.05, H * 0.82, 0.02, M(accent, { emissive: accent, ei: 1.4 }), W / 2 - 0.12, H / 2, D / 2 + 0.03));
    add(front, "case", [0, 0, 1.8], { noPick: true });
    // Glass side panel
    const glass = box(0.02, H - 0.12, D - 0.12, M(th.glass, { r: 0.05, m: 0.0, op: th.glassOpacity }), W / 2, H / 2, 0);
    glass.castShadow = false;
    add(glass, "case", [2.6, 0, 0], { noPick: true, fade: true });

    // Motherboard against the right side
    const bx = -W / 2 + 0.2;
    const mb = new THREE.Group();
    mb.position.set(bx, 2.72, -0.88);
    mb.add(box(0.03, 3.05, 2.44, M(th.board, { r: 0.6 }), 0, 0, 0));
    const hs = M(th.heatsink, { r: 0.35, m: 0.6 });
    mb.add(box(0.18, 0.95, 0.3, hs, 0.1, 0.85, -0.6)); // VRM
    mb.add(box(0.18, 0.3, 0.9, hs, 0.1, 1.35, -0.25)); // VRM top
    mb.add(box(0.06, 0.45, 0.45, hs, 0.04, -1.05, 0.6)); // chipset
    // PCIe slots
    for (const y of [-0.55, -1.25]) mb.add(box(0.06, 0.07, 1.6, M(th.trim, { r: 0.6 }), 0.04, y, -0.25));
    // DIMM slots
    for (let i = 0; i < 4; i++) mb.add(box(0.06, 1.33, 0.05, M(th.trim, { r: 0.6 }), 0.04, 0.62, 0.76 + i * 0.1));
    // I/O shroud
    mb.add(box(0.25, 1.1, 0.25, M(th.trim, { r: 0.5, m: 0.3 }), 0.13, 0.75, -1.05));
    add(mb, "motherboard", [-0.4, 0, 0]);

    // CPU cooler (dual tower)
    const cool = new THREE.Group();
    cool.position.set(bx + 0.75, 3.4, -0.8);
    const finMat = M(th.fins, { r: 0.3, m: 0.75 });
    for (const zc of [-0.35, 0.35]) {
      for (let i = 0; i < 18; i++) {
        cool.add(box(1.05, 0.012, 0.52, finMat, 0.05, -0.62 + i * 0.075, zc));
      }
    }
    for (const zc of [-0.35, 0.35]) for (const dz of [-0.12, 0.12]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 12), M(th.copper, { r: 0.25, m: 0.9 }));
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
      stick.add(box(0.36, 1.33, 0.06, M(th.ram, { r: 0.4, m: 0.4 }), 0, 0, 0));
      stick.add(box(0.06, 1.25, 0.065, M(accent, { emissive: accent, ei: 1.2 }), 0.2, 0, 0));
      stick.position.z = i * 0.1;
      ram.add(stick);
    }
    add(ram, "ram", [1.4, 1.6, 0.9]);

    // SSD under its heatsink
    const ssd = box(0.03, 0.22, 0.8, M(th.heatsink, { r: 0.3, m: 0.6 }), bx + 0.06, 2.58, -0.75);
    add(ssd, "ssd", [2.4, 0.25, 1.1]);

    // Graphics card
    const gpu = new THREE.Group();
    gpu.position.set(bx + 0.72, 2.0, -0.93);
    gpu.add(box(1.34, 0.42, 2.67, M(th.gpuShroud, { r: 0.4, m: 0.25 }), 0, 0, 0));
    gpu.add(box(1.3, 0.04, 2.6, M(th.gpuBack, { r: 0.35, m: 0.7 }), 0, 0.23, 0)); // backplate
    gpu.add(box(0.03, 0.06, 1.6, M(accent, { emissive: accent, ei: 1.0 }), 0.68, 0.12, 0.2)); // light bar
    for (const z of [-0.62, 0.62]) {
      const f = fan(0.95, th.gpuShroud, th.gpuFanRing, { thick: 0.12, glow: 0.15 });
      f.rotation.x = Math.PI / 2;
      f.position.set(0, -0.22, z);
      gpu.add(f);
      state.rotors.push({ rotor: f.userData.rotor, partId: "gpu" });
    }
    add(gpu, "gpu", [2.4, -0.6, 1.2]);

    // Power supply inside the shroud
    const psu = box(1.5, 0.82, 1.6, M(th.psu, { r: 0.6, m: 0.2 }), -0.25, 0.48, -1.4);
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

    // Labels
    const lp = (id: string, obj: THREE.Object3D, p: Vec3) => addLabel(id, obj, p);
    lp("gpu", gpu, [0.9, 0, 0.9]);
    lp("cpu", cool, [0.6, 0.85, 0]);
    lp("ram", ram, [0.2, 0.75, 0.2]);
    lp("ssd", ssd, [0.1, 0.2, 0.4]);
    lp("psu", psu, [0.8, 0.3, 0.6]);
    lp("motherboard", mb, [0, -1.5, 1.2]);
    lp("fans", fans, [0.6, 3.7, D / 2]);

    return { target: new THREE.Vector3(0, 2.2, 0), cam: new THREE.Vector3(7.6, 4.6, 8.4), camExploded: new THREE.Vector3(10.5, 6.4, 10.2) };
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
    const accent = pc.accent;
    const shellMat = () => M(th.laptopShell, { r: 0.35, m: 0.55 });

    // Bottom cover
    const bottom = roundBox(W, 0.04, D, 0.12, shellMat(), 0, 0.02, 0);
    for (const [fx, fz] of [[-1.2, -0.85], [1.2, -0.85], [-1.2, 0.85], [1.2, 0.85]]) bottom.add(box(0.5, 0.02, 0.06, M(th.trim, { r: 0.9 }), fx, -0.03, fz));
    add(bottom, "chassis", [0, -1.1, 0]);

    // Internals
    const board = box(1.9, 0.015, 0.9, M(th.board, { r: 0.6 }), 0.1, 0.01, -0.5);
    const boardG = new THREE.Group(); boardG.add(board);
    add(boardG, "board", [0, 0.7, 0]);
    const cpu = new THREE.Group();
    cpu.add(box(0.28, 0.03, 0.22, M(th.chip, { r: 0.3, m: 0.4 }), 0.1, 0.03, -0.5));
    const pipeMat = M(th.copper, { r: 0.25, m: 0.9 });
    for (const dz of [-0.06, 0.06]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 10), pipeMat);
      p.rotation.z = Math.PI / 2; p.position.set(0.1, 0.06, -0.5 + dz);
      cpu.add(p);
    }
    add(cpu, "cpu", [0, 0.95, 0]);
    const ram = new THREE.Group();
    for (let i = 0; i < 4; i++) ram.add(box(0.14, 0.02, 0.16, M(th.chip, { r: 0.4 }), -0.35 + (i % 2) * 0.18, 0.025, -0.68 + Math.floor(i / 2) * 0.36));
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
    const bat = roundBox(2.5, 0.06, 0.82, 0.05, M(th.battery, { r: 0.7 }), 0, 0.04, 0.55);
    add(bat, "battery", [0, 0.5, 0.25]);
    const ssd = box(0.22, 0.02, 0.8, M(th.ssd, { r: 0.5 }), 0.85, 0.03, -0.45);
    ssd.rotation.y = Math.PI / 2;
    add(ssd, "ssd", [0.2, 0.8, 0.55]);

    // Deck with keyboard, and the lid (move together when exploded)
    const deck = new THREE.Group();
    deck.add(roundBox(W, 0.15, D, 0.12, shellMat(), 0, 0.115, 0));
    const keyMat = M(th.keys, { r: 0.8 });
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
    deck.add(box(1.15, 0.01, 0.62, M(th.trackpad, { r: 0.3, m: 0.3 }), 0, 0.194, 0.62));
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
    lid.add(box(0.42, 0.012, 0.42, M(accent, { emissive: accent, ei: 0.5, r: 0.3 }), 0, 0.035, D / 2));
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
    state.entries = []; state.rotors = []; state.pickables = []; state.labels = {};
    const th = theme();
    scene.background = new THREE.Color(th.bg);
    scene.fog = new THREE.Fog(th.bg, 18, 38);
    floor.material.color.set(th.floor);
    hemi.intensity = th.hemi; key.intensity = th.key; rim.intensity = th.rim;
    rim.color.set(th.rimColor ?? "#ffffff");
    renderer.toneMappingExposure = th.exposure ?? 1;
    framing = state.pc!.kind === "laptop" ? buildLaptop(state.pc!, th) : buildTower(state.pc!, th);
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
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const clock = new THREE.Clock();
  let raf = 0;
  function tick() {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const target = state.exploded ? 1 : 0;
    if (state.explodeT !== target) {
      const step = reduceMotion ? 1 : dt * 1.6;
      state.explodeT = target > state.explodeT ? Math.min(1, state.explodeT + step) : Math.max(0, state.explodeT - step);
      applyExplode(false);
    }
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + (reduceMotion ? 1 : dt * 1.4));
      camera.position.lerpVectors(camAnim.from, camAnim.to, easeInOut(camAnim.t));
      if (camAnim.t >= 1) camAnim = null;
    }
    if (!reduceMotion) {
      for (const { rotor, partId } of state.rotors) {
        const rpm = parts()[partId]?.fan ?? 1200;
        rotor.rotation.z -= dt * rpm * 0.012;
      }
    }
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  return {
    setPC(pc, t) {
      state.pc = pc; state.theme = t; state.selected = null;
      rebuild(); resize(); frame(state.exploded, true);
      if (!raf) tick();
    },
    setTheme(t) { state.theme = t; if (state.pc) rebuild(); },
    setExploded(v) { state.exploded = v; applyHighlights(); frame(v, false); },
    setHeat(v) { state.heat = v; applyHighlights(); },
    select,
    resetView() { frame(state.exploded, false); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); },
  };
}
