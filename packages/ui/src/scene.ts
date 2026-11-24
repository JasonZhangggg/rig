// 3D view of the PC, drawn in ink: flat toon shading with outlined edges.
// Models are built in code from each part's real size and layout (pc.build,
// from core build.ts); anything Rig doesn't know is a typical part of its kind.
// Units: 1 unit = 100 mm.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import { formatTemp, resolveBuild, type PC, type Part, type TempUnit } from "@rig/core";
import { reducedMotion } from "./appearance";
import { createSceneLabels, type LabelPoint } from "./sceneLabels";
import { fanHitArea, isSharedTexture, makeCooler, makeFan, makeGpu, makeRam, mm, realMaterial, span, type Kit, type MatOpts } from "./parts3d";
import { makeBoard } from "./board3d";
import { makeCase, makePsu } from "./case3d";

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
  /** "real": metal, plastic, glass and wood that catch the light like the real parts. "ink" (default): flat toon shading with outlines. */
  finish?: "ink" | "real";
}

export interface PCScene {
  setPC(pc: PC, theme: SceneTheme): void;
  /** New readings for the same PC: updates fan speeds and heat colors without rebuilding. */
  update(pc: PC): void;
  setTheme(theme: SceneTheme): void;
  setExploded(v: boolean): void;
  setHeat(v: boolean): void;
  select(id: string | null): void;
  /** Lights a part up without selecting it, as when the pointer is over its row in a list. */
  hover(id: string | null): void;
  resetView(): void;
  /** Wheel zoom on or off, so a page can scroll past a small preview. */
  setZoomable(v: boolean): void;
  /** Slow side-to-side sway, for previews. */
  setSpin(v: boolean): void;
  /** The unit the part labels show temperatures in. */
  setTempUnit(unit: TempUnit): void;
  /** Triangles and draw calls in the last frame. */
  stats(): { triangles: number; calls: number };
  dispose(): void;
}

type Vec3 = [number, number, number];
interface Entry { obj: THREE.Object3D; partId: string; fadeWhenExploded?: boolean }
interface Label { anchor: THREE.Object3D; hidden: boolean }
/** The camera's vertical field of view on a landscape stage, in degrees. */
const BASE_FOV = 32;

/** How far the camera sits from a part shown alone so it fills the same share of the stage whatever its size: its bounds fit the narrower side of the view with a margin. */
export function soloDistance(radius: number, fov: number, aspect: number, margin = 1.3) {
  const v = THREE.MathUtils.degToRad(fov) / 2;
  const h = Math.atan(Math.tan(v) * aspect);
  return (Math.max(radius, 0.01) / Math.sin(Math.min(v, h))) * margin;
}

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
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // Asking the driver for each shader's error log makes the page wait for the shader to finish compiling; only worth it while developing.
  renderer.debug.checkShaderErrors = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Shadows change only when parts move, so they're drawn again only then, not on every frame of a spinning fan.
  renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);
  const outlined = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultKeepAlive: false });

  // Part labels: callouts beside the PC, each joined to its part by a line (sceneLabels.ts), laid out in px each frame.
  const layer = document.createElement("div");
  layer.className = "scene-labels";
  container.appendChild(layer);
  // Pointing at a label lights its part, as pointing at the part does.
  const labels = createSceneLabels(layer, { onPick: (id) => select(id), onHover: (id) => hoverFromScene(id) });

  const scene = new THREE.Scene();
  // The room is only needed to bake the lighting, so it and the baking buffers are freed straight after.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();

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

  // Round soft dot used for halos
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
    /** The part shown alone: the picked one. Everything else is put away until it's let go. */
    solo: null as string | null,
    explodeT: 0,
    entries: [] as Entry[],
    rotors: [] as { rotor: THREE.Object3D; partId: string }[],
    pickables: [] as THREE.Mesh[],
    labels: {} as Record<string, Label>,
    pulses: [] as THREE.Sprite[],
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
  function M(color: THREE.ColorRepresentation, o: MatOpts = {}): THREE.Material {
    const op = o.op ?? 1;
    let m: THREE.MeshStandardMaterial | THREE.MeshToonMaterial;
    if (theme().finish === "real") {
      m = realMaterial(color, o);
      m.userData.outlineParameters = { visible: false };
    } else {
      m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, transparent: op < 1 || !!o.cutout, opacity: op, depthWrite: op >= 0.5 && !o.cutout, side: o.side ?? THREE.FrontSide });
      if (o.map) m.map = o.map;
      if (o.alphaMap) { m.alphaMap = o.alphaMap; m.alphaTest = 0.5; m.transparent = false; m.depthWrite = true; }
      if (o.cutout) { m.alphaTest = 0.04; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.userData.cutout = true; }
      // A see-through panel would show its own outline hull through it as a grey sheet, so glass gets none
      m.userData.outlineParameters = { thickness: 0.0042, color: new THREE.Color(theme().trim).toArray(), visible: op >= 0.5 && !o.cutout };
      if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; if (o.emap && o.map) m.emissiveMap = o.map; }
    }
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
      // Shadows aren't redrawn while fans spin, so a blade casts none rather than a frozen one.
      b.userData.noShadow = true;
      const holder = new THREE.Group();
      holder.add(b);
      holder.rotation.z = (i / 7) * Math.PI * 2;
      rotor.add(holder);
    }
    g.add(rotor);
    g.userData.rotor = rotor;
    g.add(fanHitArea(s * 0.44));
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
        // Parts inside cast shadows on each other; the case's own walls and glass don't, so light still reaches inside.
        const mat = o.material as THREE.Material;
        if (partId !== "case" && !o.userData.noShadow && mat.opacity >= 0.5 && !mat.userData?.cutout) o.castShadow = true;
        o.receiveShadow = true;
        if (!opts.noPick) state.pickables.push(o);
      }
    });
    root.add(obj);
    if (obj.userData.rotor) state.rotors.push({ rotor: obj.userData.rotor, partId });
    return obj;
  }

  /** What each label says, in the order the parts list beside the view uses, so a phone's numbers read the same in both. */
  function refreshLabels() {
    const order = Object.keys(parts());
    const ids = Object.keys(state.labels).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    labels.setItems(ids.flatMap((id) => {
      const p: Part | undefined = parts()[id];
      return p ? [{ id, title: p.type, value: p.temp ? formatTemp(p.temp, state.tempUnit, { mark: "degree" }) : undefined, warn: p.warn }] : [];
    }));
  }

  function addLabel(partId: string, anchor: THREE.Object3D, pos: Vec3) {
    if (!parts()[partId]) return;
    const at = new THREE.Object3D();
    at.position.set(...pos);
    anchor.add(at);
    state.labels[partId] = { anchor: at, hidden: false };
    refreshLabels();
  }

  // ---------- tower ----------
  // Which part a fan being built belongs to, so its speed follows that part's reading.
  let spinPart = "fans";
  function buildTower(pc: PC, th: SceneTheme): Framing {
    // Every size and design comes from the PC's build (build.ts); without one, a typical tower.
    const b = pc.build ?? resolveBuild({});
    const accent = th.accent ?? pc.accent;
    const kit: Kit = { M, spin: (r) => state.rotors.push({ rotor: r, partId: spinPart }), accent, lite: true };
    const W = mm(b.case.w), H = mm(b.case.h), D = mm(b.case.d);
    const dual = b.case.layout === "dual-chamber";

    // The case. Its glass is on the left (-x), so through the glass the front is on the right, as on a real PC.
    spinPart = "fans";
    const cs = makeCase(kit, b.case, { caseColor: th.caseColor, glass: th.glass, glassOpacity: th.glassOpacity, trim: th.trim, fanFrame: th.fanFrame });
    add(cs.shell, "case");
    add(cs.top, "case", [0, 1.2, 0]);
    add(cs.front, "case", [0, 0, 1.8], { noPick: true });
    add(cs.glass, "case", [-2.6, 0, 0], { noPick: true, fade: true });

    // Everything on the motherboard is placed in the board's own frame (parts3d.ts), turned to face the glass.
    const onBoard = () => {
      const g = new THREE.Group();
      g.rotation.y = -Math.PI / 2;
      g.position.set(cs.surf, cs.yTop, cs.zBack);
      return g;
    };
    const BW = mm(b.board.w), BH = mm(b.board.h);
    const at = (id: string) => b.board.items.find((i) => i.id === id);
    const mid = (i: { u: number; v: number; w: number; h: number }) => new THREE.Vector3(mm(i.u + i.w / 2), -mm(i.v + i.h / 2), 0);

    const board = makeBoard(kit, { ...b.board, color: b.board.source === "generic" ? th.board : b.board.color }, { ppm: 4 });
    // The first M.2 slot's heatsink covers the SSD, so it stands for the storage part.
    const m2 = board.nodes.find((n) => n.item.id === "m2-1");
    if (m2) board.group.remove(m2.group);
    const mb = onBoard();
    mb.add(board.group);
    add(mb, "motherboard", [0.4, 0, 0]);
    const ssd = onBoard();
    if (m2) ssd.add(m2.group);
    else ssd.add(span(0.5, 1.3, -1.52, -1.3, 0, 0.04, M(th.heatsink, { metal: 0.8, rough: 0.35 })));
    add(ssd, "ssd", [-2.4, 0.25, 1.1]);

    // Processor cooler on the socket; a liquid cooler's radiator under the top panel (or behind the front)
    spinPart = "cpu";
    const sock = mid(at("socket") ?? { u: 85, v: 52, w: 40, h: 40 });
    const parts = makeCooler(kit, b.cooler, cs.fan);
    const cool = onBoard();
    parts.head.position.copy(sock);
    cool.add(parts.head);
    let coolTop = mm(b.cooler.height || 60);
    if (parts.radiator) {
      const rad = parts.radiator;
      const len = ((b.cooler.radiator ?? 360) / 120) * 1.2 + 0.38;
      const span0 = D - 0.12; // board X of the front panel
      const glassZ = cs.surf + W / 2 - 0.05; // board Z of the glass
      if (dual) {
        rad.position.set(Math.min(span0 - len / 2 - 0.15, Math.max(len / 2 - 0.05, BW / 2 + 0.6)), H - 0.03 - cs.yTop - 0.38, glassZ * 0.48);
      } else {
        // No room over the board in a standard case: the radiator stands behind the front panel
        rad.rotation.z = -Math.PI / 2;
        rad.position.set(span0 - 0.3, (H + cs.shroud) / 2 - cs.yTop, glassZ * 0.5);
      }
      cool.add(rad);
      // Hoses from the pump to the radiator's end tank
      const hoses: THREE.Vector3[][] = [];
      rad.updateMatrix();
      for (const dz of [-0.12, 0.12]) {
        const a = sock.clone().add(new THREE.Vector3(0.3 + dz, 0.48, 0.3));
        const end = new THREE.Vector3(-len / 2 + 0.1, 0.19, dz * 1.6).applyMatrix4(rad.matrix);
        hoses.push([a, a.clone().add(new THREE.Vector3(0, 0.35, 0.1)), end.clone().add(new THREE.Vector3(0.2, -0.3, 0)), end]);
      }
      for (const path of hoses) cool.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 40, 0.05, 10, false), M("#141516", { rough: 0.7 })));
      coolTop = 0.55;
    }
    add(cool, "cpu", [-1.9, 0.9, 0.4]);

    // Memory sticks in the slots that hold them, as tall as the kit really is
    const ram = onBoard();
    for (const name of b.memory.slots) {
      const slot = b.board.items.find((i) => i.kind === "dimm" && i.name === name);
      if (!slot) continue;
      const stick = makeRam(kit, b.memory);
      stick.position.copy(mid(slot)).setZ(0.04);
      ram.add(stick);
    }
    add(ram, "ram", [-1.4, 1.6, 0.9]);

    // Graphics card in the first long slot, its bracket at the back of the case
    let gpu: THREE.Group | null = null, gpuAnchor: Vec3 = [0, 0, 0];
    if (b.gpu) {
      spinPart = "gpu";
      const slot = mid(at("pcie1") ?? { u: 42, v: 156, w: 89, h: 7 });
      const card = makeGpu(kit, b.gpu);
      card.position.set(-D / 2 + 0.03 - cs.zBack, slot.y + 0.05, 0.02);
      gpu = onBoard();
      gpu.add(card);
      const L = mm(b.gpu.length), T = mm(b.gpu.thick), Hc = mm(b.gpu.height);
      gpuAnchor = [card.position.x + L * 0.62, card.position.y - T * 0.5, Hc + 0.02];
      // The glow of a hot graphics card is always there and shown only while it's hot, so heat coming and going doesn't rebuild the PC.
      const heat = halo(th.heatHot, 2.4, 1.2, 0.35);
      heat.position.set(card.position.x + L / 2, card.position.y - T, Hc / 2);
      heat.userData.pulse = true;
      heat.visible = !!pc.parts?.gpu?.warn;
      gpu.add(heat);
      state.pulses.push(heat);
      add(gpu, "gpu", [-2.4, -0.6, 1.2]);
    }

    // Light inside the case: a soft white fill so dark parts keep their shape, and the PC's own glow
    const fillIn = new THREE.PointLight("#ffffff", th.finish === "real" ? 5 : 0, 7, 1.4);
    fillIn.position.set(-W / 2 + 0.5, H * 0.72, 0.8);
    root.add(fillIn);
    if (th.finish === "real") {
      const fillLow = new THREE.PointLight("#ffffff", 2.5, 5, 1.4);
      fillLow.position.set(-W / 2 + 0.4, H * 0.3, 0.6);
      root.add(fillLow);
    }
    if (th.interior) {
      const inner = new THREE.PointLight(accent, th.interior * (th.finish === "real" ? 0.5 : 1), 6, 1.7);
      inner.position.set(-0.55, H * 0.7, 0.9);
      root.add(inner);
      const low = new THREE.PointLight(accent, th.interior * 0.6, 4, 1.7);
      low.position.set(-0.5, 1.2, 1.4);
      root.add(low);
    }

    // Power supply: under the shroud, or behind the board tray in a dual-chamber case
    const psu = dual ? makePsu(kit, 0.78, 0.86, 1.6) : makePsu(kit, 1.5, 0.82, 1.6);
    if (dual) psu.position.set((cs.surf + 0.09 + W / 2 - 0.02) / 2, 0.55, -D / 2 + 1.0);
    else psu.position.set(W / 2 - 0.85, 0.5, -D / 2 + 0.9);
    add(psu, "psu", [-2.6, -0.1, 0.4]);

    // Case fans where this case has them
    spinPart = "fans";
    const fans = new THREE.Group();
    const cf = mm(b.case.fans.size);
    const row = (n: number, place: (i: number, f: THREE.Group) => void) => {
      for (let i = 0; i < n; i++) {
        const f = makeFan(kit, cf, 0.25, { ...cs.fan, w: cf + 0.05, h: cf + 0.05 });
        place(i, f);
        fans.add(f);
      }
    };
    const fanX = (-W / 2 + cs.surf) / 2;
    row(b.case.fans.front, (i, f) => f.position.set(-0.04, H - 0.32 - cf / 2 - i * (cf + 0.06), D / 2 - 0.17));
    if (dual) row(b.case.fans.bottom, (i, f) => { f.rotation.x = Math.PI / 2; f.position.set(fanX, 0.24, D / 2 - 0.3 - cf / 2 - i * (cf + 0.06)); });
    else row(b.case.fans.bottom, (_i, f) => { f.rotation.x = Math.PI / 2 + 0.45; f.position.set(fanX - 0.05, cs.shroud + 0.2, D / 2 - 0.65); });
    row(b.case.fans.side, (i, f) => { f.rotation.y = Math.PI / 2; f.position.set(cs.surf - 0.17, 0.95 + cf / 2 + i * (cf + 0.06), D / 2 - 0.3 - cf / 2); });
    if (b.cooler.kind !== "aio" || !dual) row(b.case.fans.top, (i, f) => { f.rotation.x = Math.PI / 2; f.position.set(fanX, H - 0.17, D / 2 - 0.4 - cf / 2 - i * (cf + 0.06)); });
    add(fans, "fans", [0, 0, 1.0]);
    if (b.case.fans.rear) {
      const rear = makeFan(kit, cf, 0.25, { ...cs.fan, w: cf + 0.05, h: cf + 0.05 });
      rear.position.set(cs.surf - 0.12 - cf / 2, cs.yTop - cf / 2 - 0.08, -D / 2 + 0.16);
      add(rear, "fans", [0, 0, -1.0]);
    }

    // Labels
    if (gpu) addLabel("gpu", gpu, gpuAnchor);
    addLabel("cpu", cool, [sock.x, sock.y + 0.3, coolTop]);
    const dimm = b.board.items.find((i) => i.kind === "dimm" && i.name === b.memory.slots[0]);
    addLabel("ram", ram, dimm ? [mid(dimm).x, -0.5, mm(b.memory.height)] : [1.8, -0.5, 0.4]);
    addLabel("ssd", ssd, m2 ? [m2.group.position.x, m2.group.position.y, 0.06] : [0.9, -1.4, 0.05]);
    addLabel("psu", psu, [-0.3, 0.3, 0.6]);
    addLabel("motherboard", mb, [BW * 0.72, -BH * 0.88, 0.06]);
    addLabel("fans", fans, [-0.04, H * 0.78, D / 2 - 0.1]);

    const s = Math.max(H / 4.46, D / 4.64);
    return { target: new THREE.Vector3(0, H * 0.45, 0), cam: new THREE.Vector3(-8.9 * s, 4.5 * s, 9.9 * s), camExploded: new THREE.Vector3(-11 * s, 6.2 * s, 10.8 * s) };
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
  const keep = new Set<THREE.Texture>([blobTex, dotTex, toonRamp]);
  /** Frees the GPU copies of a model's shapes, materials and its own textures. Shared painted textures stay for the next build. */
  function freeTree(obj: THREE.Object3D) {
    const textures = new Set<THREE.Texture>();
    obj.traverse((o) => {
      const r = o as THREE.Mesh;
      if (!r.geometry && !r.material) return;
      r.geometry?.dispose();
      for (const m of ([] as THREE.Material[]).concat(r.material ?? [])) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
        if (!m.userData.shared) m.dispose();
      }
    });
    for (const t of textures) if (!keep.has(t) && t !== scene.environment && !isSharedTexture(t)) t.dispose();
  }
  let framing: Framing | null = null;
  function rebuild() {
    scene.remove(root);
    freeTree(root);
    root = new THREE.Group();
    scene.add(root);
    state.entries = []; state.rotors = []; state.pickables = []; state.labels = {}; state.pulses = [];
    refreshLabels();
    const th = theme();
    scene.background = th.transparent ? null : new THREE.Color(th.bg);
    scene.fog = th.transparent ? null : new THREE.Fog(th.bg, 18, 38);
    floor.material.color.set(th.floor);
    floor.visible = !th.transparent;
    shadowFloor.visible = false;
    hemi.intensity = th.hemi; key.intensity = th.key; rim.intensity = th.rim;
    rim.color.set(th.rimColor ?? "#ffffff");
    renderer.toneMappingExposure = (th.exposure ?? 1) * (th.finish === "real" ? 1.15 : 1);
    (shadowFloor.material as THREE.ShadowMaterial).opacity = (th.shadow ?? 0.3) * 0.55;
    framing = state.pc!.kind === "laptop" ? buildLaptop(state.pc!, th) : buildTower(state.pc!, th);
    // Light from the side the camera looks from
    const side = Math.sign(framing.cam.x) || 1;
    key.position.set(6 * side, 10, 7); rim.position.set(-6 * side, 5, -6); fill.position.set(-7 * side, 3, 6);
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
    // What the camera fits to the stage: the PC's box and the turntable. The turntable's sides may run a little
    // past the box, under a page's text, so the PC itself can be bigger; its front edge always shows.
    fitPts.length = 0;
    // Only the parts' solid shapes count, not the glow around fans.
    const box3 = new THREE.Box3(), part = new THREE.Box3();
    root.updateMatrixWorld(true);
    for (const e of state.entries) e.obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box3.union(part.copy(o.geometry.boundingBox!).applyMatrix4(o.matrixWorld));
    });
    if (box3.isEmpty()) box3.copy(bb);
    for (let i = 0; i < 8; i++) fitPts.push({ v: new THREE.Vector3(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z), x: true, y: true });
    if (ped) for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const [k, x, y] of [[1.02, false, true], [0.62, true, false]] as const) {
        for (const h of [PED_TOP, PED_TOP - 0.16]) fitPts.push({ v: new THREE.Vector3(mid.x + Math.cos(a) * pr * k, h, mid.z + Math.sin(a) * pr * k), x, y });
      }
    }
    box3.getBoundingSphere(model);
  }

  // ---------- framing ----------
  // A page can ask for the PC to fill a box inside the stage, through CSS on the stage:
  // --fit-inset (top right bottom left, in px) and --fit-x (0 hugs the box's left, 0.5 centres it).
  // Without it the camera keeps its designed distance.
  const fitPts: { v: THREE.Vector3; x: boolean; y: boolean }[] = [];
  const model = new THREE.Sphere();
  const fitCam = new THREE.PerspectiveCamera();
  let fit: { t: number; r: number; b: number; l: number; x: number } | null = null;
  let fitD = 0;
  let stageW = 0, stageH = 0, foot = 0;
  const SWAY = 0.32;

  function readFit() {
    const cs = getComputedStyle(container);
    const raw = cs.getPropertyValue("--fit-inset").trim();
    // A page can ask for only the picked part's label (--labels: picked), as Home does. Otherwise the callout
    // columns, or a phone's list, get room beside the PC.
    // A part shown alone gets no labels at all: the page's title already names it.
    labels.setPickedOnly(cs.getPropertyValue("--labels").trim() === "picked" || !!state.solo);
    // The page's buttons along the stage's bottom edge (--stage-foot, in px) are kept clear too.
    foot = parseFloat(cs.getPropertyValue("--stage-foot")) || 0;
    const room = labels.room(container.clientWidth);
    if (!raw && !room) { fit = null; return; }
    const [t, r = t, b = t, l = r] = raw ? raw.split(/\s+/).map(parseFloat) : [36, 36, 36, 36];
    const x = parseFloat(cs.getPropertyValue("--fit-x"));
    fit = { t: t + (room?.t ?? 0), r: r + (room?.r ?? 0), b: b + (room?.b ?? 0) + (room ? foot : 0), l: l + (room?.l ?? 0), x: Number.isFinite(x) ? x : 0.5 };
  }

  // The PC's outline on screen from a camera dist away along dir, over the whole of the slow sway.
  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function footprint(dir: THREE.Vector3, dist: number, w: number, h: number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of [-SWAY, 0, SWAY]) {
      fitCam.position.copy(framing!.target).addScaledVector(_d.copy(dir).applyAxisAngle(UP, a), dist);
      fitCam.lookAt(framing!.target);
      fitCam.updateMatrixWorld();
      for (const f of fitPts) {
        _p.copy(f.v).project(fitCam);
        const x = (_p.x + 1) / 2 * w, y = (1 - _p.y) / 2 * h;
        if (f.x) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
        if (f.y) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
    }
    return { x0, y0, x1, y1 };
  }

  function applyFit() {
    const wasFit = fitD > 0;
    if (!fit || !framing || !fitPts.length || !stageW) {
      fitD = 0;
      camera.clearViewOffset();
      if (wasFit && framing && !state.solo) { camAnim = null; camera.position.copy(wantPos(state.exploded)); }
      return;
    }
    const w = stageW, h = stageH;
    fitCam.fov = camera.fov; fitCam.aspect = w / h; fitCam.near = camera.near; fitCam.far = camera.far;
    fitCam.updateProjectionMatrix();
    const dir = framing.cam.clone().sub(framing.target).normalize();
    const bw = Math.max(40, w - fit.l - fit.r), bh = Math.max(40, h - fit.t - fit.b);
    let dist = framing.cam.distanceTo(framing.target), o = footprint(dir, dist, w, h);
    for (let i = 0; i < 3; i++) {
      dist /= Math.min(bw / (o.x1 - o.x0), bh / (o.y1 - o.y0));
      o = footprint(dir, dist, w, h);
    }
    fitD = dist;
    const ox = fit.l + (bw - (o.x1 - o.x0)) * fit.x - o.x0, oy = fit.t + (bh - (o.y1 - o.y0)) / 2 - o.y0;
    camera.setViewOffset(w, h, -ox, -oy, w, h);
    // A part shown alone keeps its own framing (focusOn).
    if (state.solo) return;
    if (camAnim) camAnim.to = wantPos(state.exploded);
    else {
      const k = state.exploded ? explodedRatio() : 1;
      camera.position.sub(framing.target).setLength(fitD * k).add(framing.target);
    }
  }

  const explodedRatio = () => framing!.camExploded.distanceTo(framing!.target) / framing!.cam.distanceTo(framing!.target);
  function wantPos(exploded: boolean) {
    const base = exploded ? framing!.camExploded : framing!.cam;
    if (!fitD) return base.clone();
    return base.clone().sub(framing!.target).setLength(fitD * (exploded ? explodedRatio() : 1)).add(framing!.target);
  }

  function frame(exploded: boolean, instant: boolean) {
    if (!framing) return;
    const want = wantPos(exploded);
    if (instant) { controls.target.copy(framing.target); camera.position.copy(want); camAnim = null; }
    else camAnim = { from: camera.position.clone(), to: want, t: 0, look: { from: controls.target.clone(), to: framing.target.clone() } };
  }
  let camAnim: { from: THREE.Vector3; to: THREE.Vector3; t: number; look?: { from: THREE.Vector3; to: THREE.Vector3 } } | null = null;

  // A picked part pulls the camera in until it fills most of the view, from the side you were already looking at.
  const _sphere = new THREE.Sphere();
  function focusOn(id: string) {
    if (!framing || id === "case" || id === "chassis") return;
    const mine = state.entries.filter((e) => e.partId === id && e.obj.visible);
    if (!mine.length) return;
    _box.makeEmpty();
    for (const e of mine) _box.union(_part.setFromObject(e.obj));
    _box.getBoundingSphere(_sphere);
    const dir = camera.position.clone().sub(controls.target).normalize();
    // Alone, the part fills the stage by its own size, so a small drive shows as large as a graphics card;
    // the camera may come as close as it needs. In the PC, small parts keep a floor so the view doesn't dive in.
    const alone = state.solo === id;
    const dist = alone ? soloDistance(_sphere.radius, camera.fov, camera.aspect)
      : Math.min(Math.max(_sphere.radius, 0.45) / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.6, camera.position.distanceTo(controls.target));
    controls.minDistance = alone ? Math.min(1, dist * 0.5) : 4;
    camAnim = { from: camera.position.clone(), to: _sphere.center.clone().addScaledVector(dir, dist), t: 0, look: { from: controls.target.clone(), to: _sphere.center.clone() } };
    wake();
  }

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
        // The part pointed at, or picked, takes the highlight color. A part shown alone needs none.
        const isSel = state.selected === e.partId;
        const isHov = state.hovered === e.partId;
        if ((isSel || isHov) && !state.solo && !m.userData.glow) {
          m.emissive.set(theme().highlight);
          m.emissiveIntensity = isSel ? 0.6 : 0.5;
        }
        // Case panels go see-through in heat view so internals show
        let op = m.userData.baseOpacity;
        if (state.heat && (e.partId === "case" || e.partId === "chassis")) op = Math.min(op, 0.18);
        m.opacity = op;
        m.transparent = op < 1 || !!m.userData.cutout;
        m.depthWrite = op >= 0.5 && !m.userData.cutout;
      });
    }
  }

  function applyExplode(instant: boolean) {
    if (instant) state.explodeT = state.exploded ? 1 : 0;
    const t = easeInOut(state.explodeT);
    for (const e of state.entries) {
      const { basePos, offset } = e.obj.userData;
      e.obj.position.copy(basePos).addScaledVector(offset, t);
      e.obj.visible = (!state.solo || e.partId === state.solo) && !(e.fadeWhenExploded && t >= 0.98);
    }
    // A part shown alone floats free of the turntable; the case or laptop body still stands on it.
    const standing = !state.solo || state.solo === "case" || state.solo === "chassis";
    pedestal.visible = !!theme().pedestal && standing;
    blob.visible = contact.visible = !!theme().transparent && standing;
    floor.visible = !theme().transparent && standing;
  }
  const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt: [number, number] | null = null;
  function pick(ev: { clientX: number; clientY: number }): string | null {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(state.pickables, false).find((h) => shown(h.object));
    return hit ? (hit.object.userData.part as string) : null;
  }
  /** On screen: neither it nor anything holding it is put away. */
  function shown(o: THREE.Object3D | null) {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  }
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    // A part shown alone stays until the page lets it go (its back button or Escape), so a stray click can't close it.
    if (moved > 5 || state.solo) return;
    const id = pick(e);
    select(id);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || inMotion) return;
    const id = pick(e);
    renderer.domElement.style.cursor = id ? "pointer" : "grab";
    hoverFromScene(id);
  });

  // Where the mouse is over the stage, so that once the view stops moving the part under it can be found again.
  let pointer: { clientX: number; clientY: number } | null = null;
  container.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") pointer = { clientX: e.clientX, clientY: e.clientY }; });
  container.addEventListener("pointerleave", () => { pointer = null; });
  // While the view moves (a part being framed, the PC pulled apart, a drag), parts and labels slide under a still
  // mouse. Lighting each one it passes makes the highlight jump about, so pointing is ignored until the view stops.
  let inMotion = false;

  /** The view has stopped: light whatever is under the mouse now, a label or a part, or nothing. */
  function settleHover() {
    if (!pointer) return;
    const el = document.elementFromPoint(pointer.clientX, pointer.clientY);
    if (!el || !container.contains(el)) return hoverFromScene(null);
    const label = el.closest<HTMLElement>("[data-part], [data-id]");
    if (label && container.contains(label)) return hoverFromScene(label.dataset.part ?? label.dataset.id ?? null);
    hoverFromScene(el === renderer.domElement ? pick(pointer) : null);
  }

  /** The pointer is over a part, or its label, in the 3D view itself: light it and tell the page, so a list can light its row. */
  function hoverFromScene(id: string | null) {
    if (inMotion || id === state.hovered) return;
    state.hovered = id;
    applyHighlights();
    onHover?.(id);
    invalidate();
  }

  /** Picking a part shows it alone, framed to fill the stage; letting go brings the whole PC back. */
  function select(id: string | null) {
    const was = state.selected;
    state.selected = id && parts()[id] ? id : null;
    state.solo = state.selected;
    if (state.hovered && state.solo) { state.hovered = null; onHover?.(null); }
    applyExplode(false);
    if (state.selected && state.selected !== was) {
      readFit(); applyFit();
      focusOn(state.selected);
    } else if (!state.selected && was) {
      controls.minDistance = 4;
      frame(state.exploded, false);
      readFit(); applyFit();
    }
    applyHighlights();
    invalidate();
    onSelect?.(state.selected);
  }

  // ---------- labels ----------
  let labelFrame = 0;
  const _a = new THREE.Vector3(), _l = new THREE.Vector3(), _s = new THREE.Vector3();
  const occluder = new THREE.Raycaster();

  function layoutLabels() {
    const all = state.solo ? [] : Object.entries(state.labels);
    if (!stageW) return;
    const w = stageW, h = stageH;
    // Every few frames, anchors behind something solid get a hollow dot.
    const look = labelFrame++ % 6 === 0;
    const points: LabelPoint[] = [];
    for (const [id, l] of all) {
      l.anchor.getWorldPosition(_a);
      const dist = _a.distanceTo(camera.position);
      if (look) {
        occluder.set(camera.position, _l.copy(_a).sub(camera.position).normalize());
        occluder.far = dist - 0.05;
        const hit = occluder.intersectObjects(state.pickables, false).find((x) => {
          const m = (x.object as THREE.Mesh).material as THREE.Material;
          return x.object.userData.part !== id && m.visible && m.opacity >= 0.5 && shown(x.object);
        });
        l.hidden = !!hit;
      }
      _s.copy(_a).project(camera);
      const x = (_s.x + 1) / 2 * w, y = (1 - _s.y) / 2 * h;
      points.push({ id, x, y, behind: l.hidden, off: _s.z > 1 || x < -0.05 * w || x > 1.05 * w || y < -0.05 * h || y > 1.05 * h });
    }
    labels.layout(points, { width: w, height: h, box: modelBox(w, h), hovered: state.hovered, selected: state.selected, foot });
  }
  document.fonts?.ready.then(() => { refreshLabels(); invalidate(); });

  // The PC's outline on screen, from its bounds (kept until the build or the explode changes).
  const _mb = new THREE.Box3();
  let mbKey = "";
  function modelBox(w: number, h: number) {
    const k = `${root.uuid}:${state.explodeT.toFixed(3)}`;
    if (k !== mbKey) { _mb.setFromObject(root); mbKey = k; }
    if (_mb.isEmpty()) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k2 = 0; k2 < 8; k2++) {
      _s.set(k2 & 1 ? _mb.max.x : _mb.min.x, k2 & 2 ? _mb.max.y : _mb.min.y, k2 & 4 ? _mb.max.z : _mb.min.z).project(camera);
      const sx = (_s.x + 1) / 2 * w, sy = (1 - _s.y) / 2 * h;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return { x0, y0, x1, y1 };
  }

  // A part's bounds, for framing it.
  const _box = new THREE.Box3(), _part = new THREE.Box3();

  // ---------- loop ----------
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    // Parked off screen between pages it isn't drawn, so it keeps its size: resizing reallocates every buffer, twice per page change.
    if (!w || !h || container.closest(".stage-park")) return;
    if (w !== stageW || h !== stageH) {
      stageW = w; stageH = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = fovFor(camera.aspect);
      camera.updateProjectionMatrix();
    }
    readFit();
    applyFit();
    // A part shown alone is framed again for the new size, as when the stage moves from Home onto the part's page.
    if (state.solo) focusOn(state.solo);
    invalidate();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let spin = false, spinT = 0, spinOff = 0, dragging = false;
  controls.addEventListener("start", () => { dragging = true; spin = false; invalidate(); });
  controls.addEventListener("change", () => invalidate());
  controls.addEventListener("end", () => { dragging = false; });
  const clock = new THREE.Clock();
  // Draws only while the stage is on screen and the tab is showing, and then only when something on it changes:
  // the camera, a part's look, the explode. A quarter second more after each change lets the labels settle. Spinning fans,
  // pulses and Home's slow sway keep it drawing at 30 frames a second, but only while the window is in front and someone
  // has moved the pointer or typed in the last little while: a window left open, behind a game or minimised draws nothing.
  // With reduced motion, a still stage draws nothing.
  let raf = 0, onScreen = true, tabShown = !document.hidden, built = false, gone = false;
  let settleUntil = 0, lastDraw = 0, relabel = false;
  const SETTLE_MS = 250, AMBIENT_MS = 1000 / 30 - 1, IDLE_MS = 20_000;
  const live = () => built && onScreen && tabShown && !gone;
  let focused = typeof document.hasFocus === "function" ? document.hasFocus() : true, lastInput = performance.now();
  const awake = () => focused && performance.now() - lastInput < IDLE_MS;
  /** Someone's using the window: wakes the fans if they had stopped. */
  const stir = () => { const was = awake(); lastInput = performance.now(); if (!was && focused) invalidate(); };
  const onFocus = () => { focused = true; stir(); };
  const onBlur = () => { focused = false; };
  const inputs = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
  for (const k of inputs) window.addEventListener(k, stir, { passive: true });
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  /** Draws on the next frame, never inside the caller: several changes at once make one frame, and the page paints first. */
  function wake() {
    if (raf || !live()) return;
    clock.getDelta();
    raf = requestAnimationFrame(tick);
  }
  function invalidate() {
    settleUntil = performance.now() + SETTLE_MS;
    wake();
  }
  /** New readings change only the labels' text, unless heat colors the parts: lay the labels out again without drawing. */
  function labelsChanged() {
    relabel = true;
    wake();
  }
  const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    // Back from the park into a page whose slot happens to be the park's size gets no resize of its own.
    if (onScreen) resize();
    invalidate();
  });
  io?.observe(container);
  const onVisibility = () => { tabShown = !document.hidden; invalidate(); };
  document.addEventListener("visibilitychange", onVisibility);
  function tick() {
    raf = 0;
    if (!live()) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const still = reducedMotion();
    const target = state.exploded ? 1 : 0;
    const exploding = state.explodeT !== target;
    const turning = !!camAnim;
    if (exploding) {
      const step = reducedMotion() ? 1 : dt * 1.6;
      state.explodeT = target > state.explodeT ? Math.min(1, state.explodeT + step) : Math.max(0, state.explodeT - step);
      applyExplode(false);
    }
    if (spin && !camAnim && !dragging && !reducedMotion() && awake()) {
      spinT += dt;
      const off = Math.sin(spinT * 0.35) * SWAY;
      const d = off - spinOff;
      spinOff = off;
      const v = camera.position.clone().sub(controls.target);
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), d);
      camera.position.copy(controls.target).add(v);
    }
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + (reducedMotion() ? 1 : dt * 1.4));
      camera.position.lerpVectors(camAnim.from, camAnim.to, easeInOut(camAnim.t));
      if (camAnim.look) controls.target.lerpVectors(camAnim.look.from, camAnim.look.to, easeInOut(camAnim.t));
      if (camAnim.t >= 1) camAnim = null;
    }
    if (!reducedMotion()) {
      for (const { rotor, partId } of state.rotors) {
        const rpm = parts()[partId]?.fan ?? 1200;
        rotor.rotation.z -= dt * rpm * 0.012;
      }
    }
    const pulsing = state.pulses.some((sp) => sp.visible);
    if (pulsing) {
      const k = reducedMotion() ? 0.8 : 0.65 + Math.sin(clock.elapsedTime * 2.2) * 0.35;
      for (const sp of state.pulses) (sp.material as THREE.SpriteMaterial).opacity = sp.userData.baseOpacity * k;
    }
    const moved = controls.update();
    const wasMoving = inMotion;
    inMotion = !!camAnim || dragging || exploding || moved;
    if (wasMoving && !inMotion) settleHover();
    const now = performance.now();
    if (moved || dragging || exploding || turning) settleUntil = now + SETTLE_MS;
    const settling = now < settleUntil;
    const ambient = !still && awake() && (state.rotors.length > 0 || pulsing || (spin && !dragging));
    if (settling || (ambient && now - lastDraw >= AMBIENT_MS)) {
      lastDraw = now;
      relabel = false;
      // Something moved: cast the shadows again. A frame that only turns the fans keeps the last ones.
      if (settling) renderer.shadowMap.needsUpdate = true;
      outlined.render(scene, camera);
      layoutLabels();
    } else if (relabel) {
      relabel = false;
      layoutLabels();
    } else if (!ambient) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  return {
    stats: () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.calls }),
    setPC(pc, t) {
      state.pc = pc; state.theme = t; state.selected = null; state.solo = null; controls.minDistance = 4;
      rebuild(); resize(); frame(state.exploded, true);
      built = true;
      invalidate();
    },
    update(pc) {
      state.pc = pc;
      refreshLabels();
      applyHighlights();
      const hot = !!pc.parts?.gpu?.warn;
      let glow = false;
      for (const sp of state.pulses) if (sp.visible !== hot) { sp.visible = hot; glow = true; }
      if (state.heat || glow) invalidate(); else labelsChanged();
    },
    setTheme(t) { state.theme = t; if (state.pc) rebuild(); invalidate(); },
    setExploded(v) { state.exploded = v; applyHighlights(); frame(v, false); invalidate(); },
    setHeat(v) { state.heat = v; applyHighlights(); invalidate(); },
    select,
    hover(id) {
      const next = id && parts()[id] ? id : null;
      if (next === state.hovered) return;
      state.hovered = next;
      applyHighlights();
      invalidate();
    },
    resetView() { if (state.solo) focusOn(state.solo); else frame(state.exploded, false); invalidate(); },
    setZoomable(v) { controls.enableZoom = v; },
    setSpin(v) { spin = v; spinT = 0; spinOff = 0; invalidate(); },
    setTempUnit(unit) { state.tempUnit = unit; refreshLabels(); invalidate(); },
    dispose() {
      gone = true;
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      for (const k of inputs) window.removeEventListener(k, stir);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      controls.dispose();
      labels.dispose();
      freeTree(scene);
      for (const t of keep) t.dispose();
      scene.environment?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      layer.remove();
    },
  };
}
