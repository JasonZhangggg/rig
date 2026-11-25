// The graphics card close up, the way the board view shows the motherboard: the card standing on its slot edge
// with its bracket toward you, every display output drawn on the bracket and every power plug on the top edge.
// Pointing at one says what it is and what's on it; clicking zooms in, and a power plug gets a pin map.
// Drawn only while something moves, so a card at rest costs nothing.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { plugPinout, type GpuOutput, type GpuPlug, type GpuPorts, type GpuShape, type OutputKind, type PlugKind, type PlugPinout } from "@rig/core";
import { canvasTex, gpuPlugAt, isSharedTexture, makeGpu, mm, realMaterial, type Kit } from "./parts3d";
import { INTRO_DELAY, INTRO_FROM, INTRO_MS, pinInk, soft } from "./boardScene";
import { reducedMotion } from "./appearance";

/** What the pointer is over: an output or a plug, and the pin when it's over one, with the pointer's place in the view. */
export interface GpuHover { id: string; pin?: number; x: number; y: number }

export interface GpuScene {
  /** Zoom to one output (with the bracket around it) or plug (with its pin map), or back to the whole card. */
  focus(id: string | null): void;
  /** A soft light on some outputs or plugs without moving the camera. */
  hover(ids: string[]): void;
  /** Marks outputs in use (a filled frame), free (an outline) and "some of these" (hatched). */
  setUsage(states: Record<string, "used" | "free" | "some">): void;
  reset(): void;
  dispose(): void;
  stats(): { triangles: number; calls: number; ms: number; frames: number };
}

/** Pin colors on the map and in 3D: the same soft hues as the board's headers. */
export const plugPinColor: Record<string, string> = { "+12V": soft.ochre, Ground: "#3a3b3f", Sense: soft.plum, Power: soft.grey };

/** Each output's opening, mm: long side along the bracket, short side across it. */
const opening: Record<OutputKind, { w: number; h: number }> = { hdmi: { w: 14, h: 4.5 }, dp: { w: 16, h: 4.8 }, "usb-c": { w: 8.4, h: 2.6 }, dvi: { w: 37, h: 9 } };
/** Each plug's housing on the card, mm, along the card and across it, and its pin pitch. */
const housing: Record<PlugKind, { w: number; h: number; pitch: number }> = { "16-pin": { w: 21, h: 9.5, pitch: 3 }, "8-pin": { w: 20, h: 9.5, pitch: 4.2 }, "6-pin": { w: 15.5, h: 9.5, pitch: 4.2 } };

/** An output's outline in its own plane: x along the bracket, y across it, centered. */
function outline(kind: OutputKind, inset = 0): THREE.Shape {
  const { w: W, h: H } = opening[kind];
  const w = mm(W) - inset * 2, h = mm(H) - inset * 2, x = -w / 2, y = -h / 2;
  const s = new THREE.Shape();
  if (kind === "hdmi") {
    // Wide on top, its lower corners cut at an angle
    const c = mm(2.2);
    s.moveTo(x, y + h); s.lineTo(x + w, y + h); s.lineTo(x + w, y + h * 0.45); s.lineTo(x + w - c, y); s.lineTo(x + c, y); s.lineTo(x, y + h * 0.45); s.closePath();
  } else if (kind === "dp") {
    // One corner cut off
    const c = mm(2);
    s.moveTo(x, y); s.lineTo(x + w - c, y); s.lineTo(x + w, y + c); s.lineTo(x + w, y + h); s.lineTo(x, y + h); s.closePath();
  } else {
    const r = kind === "usb-c" ? h / 2 : mm(1.2);
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false); s.lineTo(x + w, y + h - r);
    s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false); s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  }
  return s;
}

/** Diagonal stripes, for outputs where some are in use and Windows doesn't say which. */
const hatchTex = () => canvasTex("gpu-hatch", 64, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = "#fff"; g.lineWidth = 9;
  for (let k = -w; k < w * 2; k += 22) { g.beginPath(); g.moveTo(k, h); g.lineTo(k + h, 0); g.stroke(); }
}, { repeat: [3, 1] });
const glowTex = () => canvasTex("gpu-glow", 128, 128, (g) => { g.filter = "blur(12px)"; g.fillStyle = "#fff"; g.beginPath(); g.roundRect(26, 26, 76, 76, 14); g.fill(); });
const shadowTex = () => canvasTex("gpu-shadow", 256, 128, (g) => { g.filter = "blur(16px)"; g.fillStyle = "rgba(0,0,0,0.6)"; g.beginPath(); g.roundRect(30, 34, 196, 60, 12); g.fill(); });
const reduced = () => { try { return reducedMotion(); } catch { return false; } };

interface Node {
  id: string; kind: "output" | "plug";
  group: THREE.Group;
  /** Where the camera frames it from, in the card's own frame. */
  face: THREE.Vector3;
  w: number; h: number;
  pins: THREE.Mesh[];
  plug?: GpuPlug; pinout?: PlugPinout;
}

export function createGpuScene(container: HTMLElement, shape: GpuShape, p: GpuPorts, opts: { accent?: string; onHover?: (h: GpuHover | null) => void; /** Opens zooming in, as the close-up takes over from the 3D PC. */ intro?: boolean } = {}): GpuScene {
  const accent = new THREE.Color(opts.accent ?? "#E6D3A3");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(renderer.domElement);
  const card = document.createElement("div");
  card.className = "pinout";
  card.hidden = true;
  container.appendChild(card);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a968c, 0.6));
  const key = new THREE.DirectionalLight(0xfff8ef, 1.7);
  key.position.set(-4, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe8eefc, 0.6);
  rim.position.set(4, 2, -3);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.08;
  controls.maxDistance = 14;
  // The same buttons as the 3D PC: drag turns, right-drag (or Shift-drag) moves, scroll zooms.
  controls.enablePan = true;

  // ---------- the card ----------
  // makeGpu's frame: X from the bracket along the card, Y from the backplate (0) to the fans (-thickness),
  // Z from the slot edge up to the top edge. Turned so the top edge is up and the fans face you.
  const kit: Kit = { M: (c, o) => realMaterial(c, o), accent: `#${accent.getHexString()}` };
  const L = mm(shape.length), T = mm(shape.thick), Hc = mm(shape.height);
  const body = makeGpu(kit, shape, { power: false });
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  scene.add(root);
  body.position.set(-L / 2, T / 2, -Hc / 2);
  root.add(body);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.3, T * 3.2), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, opacity: 0.5 }));
  shadow.position.set(L / 2, -T / 2, -0.09);
  body.add(shadow);

  const steel = realMaterial("#c7cacf", { metal: 0.95, rough: 0.3 });
  const cavity = realMaterial("#0e0f11", { rough: 0.8 });
  const tongue = realMaterial("#202124", { rough: 0.55 });
  const nylon = realMaterial("#141516", { rough: 0.6 });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const nodes: Node[] = [];

  // Outputs along the bracket's face (x just outside it), in a row in the slot next to the board, from the slot up.
  const BRACKET = -0.015, rowY = -0.085;
  const outs = p.outputs;
  const gap = mm(4);
  const spanZ = outs.reduce((n, o) => n + mm(opening[o.kind].w), 0) + gap * Math.max(0, outs.length - 1);
  let z = Math.max(0.1, Math.min(Hc, 1.1) / 2 + 0.03 - spanZ / 2);
  for (const o of outs) {
    const { w: W, h: H } = opening[o.kind];
    const g = new THREE.Group();
    // Drawn in its own plane (x along the bracket, y across), then turned so it faces out of the bracket.
    g.rotation.y = -Math.PI / 2;
    g.position.set(BRACKET, rowY, z + mm(W) / 2);
    const wall = mm(0.6);
    const shell = outline(o.kind, -wall);
    shell.holes.push(new THREE.Path(outline(o.kind).getPoints(12)));
    const shellMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shell, { depth: 0.05, bevelEnabled: false, curveSegments: 10 }), steel);
    shellMesh.position.z = -0.045;
    g.add(shellMesh);
    const back = new THREE.Mesh(new THREE.ShapeGeometry(outline(o.kind), 10), cavity);
    back.position.z = -0.02;
    g.add(back);
    if (o.kind !== "dvi") {
      const tw = mm(W) * (o.kind === "usb-c" ? 0.68 : 0.72), th = mm(o.kind === "usb-c" ? 0.7 : 1.4);
      const t = new THREE.Mesh(new THREE.BoxGeometry(tw, th, 0.022), tongue);
      t.position.set(0, o.kind === "hdmi" ? mm(0.6) : 0, -0.009);
      g.add(t);
    }
    // The bracket's cut-out round it
    const cut = new THREE.Mesh(new THREE.ShapeGeometry(outline(o.kind, -mm(1.1)), 10), cavity);
    cut.position.z = 0.0004;
    g.add(cut);
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(mm(W + 3), mm(H + 4)), hitMat);
    hit.position.z = 0.002;
    hit.userData.id = o.id;
    g.add(hit);
    body.add(g);
    nodes.push({ id: o.id, kind: "output", group: g, face: new THREE.Vector3(-1, -0.25, 0.08), w: mm(W), h: mm(H), pins: [] });
    z += mm(W) + gap;
  }

  // Power plugs on the top edge, pins facing up, side by side along the card.
  const plugX = gpuPlugAt(shape);
  p.power.forEach((plug, i) => {
    const hs = housing[plug.kind], po = plugPinout(plug.kind);
    const w = mm(hs.w), h = mm(hs.h), depth = 0.075;
    const g = new THREE.Group();
    g.position.set(plugX + (i - (p.power.length - 1) / 2) * (w + mm(6)), -0.025 - h / 2 - 0.012, Hc - 0.012);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), nylon);
    box.position.z = -depth / 2 + 0.012;
    g.add(box);
    const pins: THREE.Mesh[] = [];
    const pitch = mm(hs.pitch), cell = pitch * 0.78;
    const cols = po.rows[0].length;
    const cavGeo = new THREE.PlaneGeometry(cell, cell), pinGeo = new THREE.CylinderGeometry(cell * 0.2, cell * 0.2, 0.01, 10);
    pinGeo.rotateX(Math.PI / 2);
    const rowsY = po.sense ? [mm(0.2), -pitch + mm(0.2)] : [pitch / 2, -pitch / 2];
    let index = 0;
    po.rows.forEach((row, r) => row.forEach((pin, c) => {
      const x = (c - (cols - 1) / 2) * pitch, y = rowsY[r];
      const cav = new THREE.Mesh(cavGeo, cavity); cav.position.set(x, y, 0.0125); g.add(cav);
      const m = new THREE.Mesh(pinGeo, steel.clone()); m.position.set(x, y, 0.009);
      m.userData = { id: plug.id, pin: index++, name: pin.name };
      g.add(m); pins.push(m);
    }));
    if (po.sense) {
      const sp = mm(2), sc = sp * 0.6;
      po.sense.forEach((pin, c) => {
        const x = (c - 1.5) * sp, y = pitch * 0.82;
        const cav = new THREE.Mesh(new THREE.PlaneGeometry(sc, sc), cavity); cav.position.set(x, y, 0.0125); g.add(cav);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(sc * 0.22, sc * 0.22, 0.008, 8).rotateX(Math.PI / 2), steel.clone());
        m.position.set(x, y, 0.009);
        m.userData = { id: plug.id, pin: index++, name: pin.name };
        g.add(m); pins.push(m);
      });
    }
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(w + mm(4), h + mm(4)), hitMat);
    hit.position.z = 0.014;
    hit.userData.id = plug.id;
    g.add(hit);
    body.add(g);
    nodes.push({ id: plug.id, kind: "plug", group: g, face: new THREE.Vector3(-0.25, -0.55, 1), w, h, pins, plug, pinout: po });
  });

  // ---------- marks: in use, free, some of these ----------
  const USED = new THREE.Color(soft.sage);
  let marks: THREE.Mesh[] = [], marksKey = "";
  const freeMesh = (m: THREE.Mesh) => { m.removeFromParent(); m.geometry.dispose(); (m.material as THREE.Material).dispose(); };
  function ring(n: Node, pad: number, t: number) {
    const w = n.w + pad * 2, h = n.h + pad * 2;
    const s = new THREE.Shape(); s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2); s.lineTo(-w / 2, h / 2); s.closePath();
    const iw = w - t * 2, ih = h - t * 2;
    s.holes.push(new THREE.Path([new THREE.Vector2(-iw / 2, -ih / 2), new THREE.Vector2(-iw / 2, ih / 2), new THREE.Vector2(iw / 2, ih / 2), new THREE.Vector2(iw / 2, -ih / 2)]));
    return { geo: new THREE.ShapeGeometry(s), w: iw, h: ih };
  }
  function setUsage(states: Record<string, "used" | "free" | "some">) {
    const k = Object.keys(states).sort().map((id) => `${id}=${states[id]}`).join("|");
    if (k === marksKey) return;
    marksKey = k;
    marks.forEach(freeMesh); marks = [];
    for (const n of nodes) {
      const st = states[n.id];
      if (!st || n.kind !== "output") continue;
      const r = ring(n, mm(2.2), st === "free" ? mm(0.45) : mm(0.7));
      const frame = new THREE.Mesh(r.geo, new THREE.MeshBasicMaterial({ color: st === "free" ? 0xffffff : USED, transparent: true, opacity: st === "free" ? 0.5 : 1, depthWrite: false, toneMapped: false }));
      frame.position.z = 0.0012; frame.renderOrder = 2;
      n.group.add(frame); marks.push(frame);
      // Filled round the opening when in use; striped when some of this kind are and Windows doesn't say which
      if (st !== "free") {
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), new THREE.MeshBasicMaterial({ color: USED, map: st === "some" ? hatchTex() : null, transparent: true, opacity: st === "some" ? 0.6 : 0.45, depthWrite: false, toneMapped: false }));
        fill.position.z = 0.001; fill.renderOrder = 1;
        n.group.add(fill); marks.push(fill);
      }
    }
    invalidate();
  }

  // ---------- light and focus ----------
  let halos: THREE.Mesh[] = [], hoverHalos: THREE.Mesh[] = [], hoverKey = "";
  let focused: Node | null = null;
  const halo = (n: Node, opacity: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(n.w * 1.9 + 0.05, n.h * 1.9 + 0.05), new THREE.MeshBasicMaterial({ map: glowTex(), color: accent, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.position.z = n.kind === "plug" ? 0.016 : 0.0008;
    m.renderOrder = 3;
    n.group.add(m);
    return m;
  };
  function hover(ids: string[]) {
    const k = ids.join("|");
    if (k === hoverKey) return;
    hoverKey = k;
    hoverHalos.forEach(freeMesh);
    hoverHalos = nodes.filter((n) => ids.includes(n.id) && n !== focused).map((n) => halo(n, 0.5));
    invalidate();
  }
  let hoverPin: THREE.Mesh | null = null, pinCells: HTMLElement[] = [];
  function hoverPinAt(m: THREE.Mesh | null) {
    if (m === hoverPin) return;
    if (hoverPin && !hoverPin.userData.lit) hoverPin.scale.set(1, 1, 1);
    hoverPin = m;
    if (m) m.scale.set(1.4, 1.4, 1.2);
    const i = m && focused?.pins.includes(m) ? (m.userData.pin as number) : -1;
    pinCells.forEach((c, k) => c.classList.toggle("is-hover", k === i));
    invalidate();
  }

  const pinMats = new Map<THREE.Mesh, THREE.Material>();
  function clearFocus() {
    halos.forEach(freeMesh); halos = [];
    for (const [m, mat] of pinMats) { (m.material as THREE.Material).dispose(); m.material = mat; }
    pinMats.clear();
    card.hidden = true; card.replaceChildren(); pinCells = [];
    roomKey = "";
  }

  /** The plug's pin map: the pins as they sit, colored by what they carry, each run named beside it. */
  function showCard(n: Node) {
    const po = n.pinout!, plug = n.plug!;
    const head = document.createElement("div");
    head.className = "po-head";
    head.innerHTML = `<span class="po-name"></span><span class="po-label"></span>`;
    head.children[0].textContent = plug.label.replace(/ power( \d)?$/, "$1").replace(/^(\d+-pin)/, "$1 plug");
    head.children[1].textContent = plug.kind === "16-pin" ? "12V-2x6 power from the power supply" : "PCIe power from the power supply";
    const cols = po.rows[0].length;
    const grid = document.createElement("div");
    grid.className = `po-grid is-labeled${cols > 5 ? " is-wide" : ""}`;
    grid.style.gridTemplateColumns = `repeat(${cols}, var(--po-pin))`;
    const cells: HTMLElement[] = [];
    const all = [...po.rows.flat(), ...(po.sense ?? [])];
    const byName = new Map<string, number[]>();
    all.forEach((pin, i) => byName.set(pin.name, [...(byName.get(pin.name) ?? []), i]));
    const mark = (name: string, on: boolean) => {
      for (const i of byName.get(name) ?? []) { cells[i]?.classList.toggle("is-lit", on); const m = n.pins[i]; if (m) { m.userData.lit = on; m.scale.setScalar(on ? 1.3 : 1); } }
      grid.classList.toggle("has-lit", on);
      invalidate();
    };
    const tag = (name: string, row: number, from: number, to: number, above: boolean) => {
      const el = document.createElement("span");
      el.className = `po-tag ${above ? "is-above" : "is-below"}`;
      el.style.setProperty("--c", plugPinColor[name] ?? soft.grey);
      el.style.gridRow = String(row); el.style.gridColumn = `${from + 1} / ${to + 1}`;
      el.textContent = name;
      el.addEventListener("pointerenter", () => mark(name, true));
      el.addEventListener("pointerleave", () => mark(name, false));
      grid.append(el);
    };
    const pinCell = (pin: { name: string; number?: number }, row: number, col: number, small = false) => {
      const c = document.createElement("span");
      c.className = `po-pin${small ? " is-small" : ""}`;
      c.style.gridRow = String(row); c.style.gridColumn = String(col + 1);
      const color = plugPinColor[pin.name] ?? soft.grey;
      c.style.setProperty("--c", color); c.style.color = pinInk(color);
      c.textContent = pin.number ? String(pin.number) : "";
      return c;
    };
    // Rows top to bottom: names above, the sense pins (centered over the rest), the pins, names below.
    const runs = (pins: { name: string }[], row: number, above: boolean, off = 0) => {
      for (let c = 0; c < pins.length; ) { let e = c + 1; while (e < pins.length && pins[e].name === pins[c].name) e++; tag(pins[c].name, row, c + off, e + off, above); c = e; }
    };
    const senseOff = po.sense ? Math.floor((cols - po.sense.length) / 2) : 0;
    runs(po.sense ?? po.rows[0], 1, true, senseOff);
    let row = 2;
    po.sense?.forEach((pin, c) => { const el = pinCell(pin, row, c + senseOff, true); grid.append(el); });
    if (po.sense) row++;
    const rowCells = po.rows.flatMap((pins, r) => pins.map((pin, c) => pinCell(pin, row + r, c)));
    row += po.rows.length;
    runs(po.rows[po.rows.length - 1], row, false);
    // cells in the same order as the pin meshes: the rows, then the sense pins
    const senseCells = [...grid.querySelectorAll<HTMLElement>(".po-pin.is-small")];
    cells.push(...rowCells, ...senseCells);
    grid.append(...rowCells);
    const note = document.createElement("p");
    note.className = "po-note";
    note.textContent = po.note;
    card.append(head, grid, note);
    card.hidden = false;
    pinCells = cells;
    // The same colors on the pins in 3D
    n.pins.forEach((m, i) => {
      const pin = all[i];
      pinMats.set(m, m.material as THREE.Material);
      const c = plugPinColor[pin.name] ?? soft.grey;
      m.material = realMaterial(c, { metal: 0.35, rough: 0.35, emissive: c, ei: 0.25 });
    });
  }

  const target = new THREE.Vector3(), camGoal = new THREE.Vector3(), fromPos = new THREE.Vector3(), fromTarget = new THREE.Vector3();
  let tweenStart = -1, tweenMs = 650;
  function frame() {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let dir: THREE.Vector3;
    if (focused?.kind === "output") {
      // The whole row of outputs, so the one picked sits among the others
      for (const n of nodes) if (n.kind === "output") box.expandByObject(n.group);
      dir = new THREE.Vector3(-1, 0.18, 0.32);
    } else if (focused) {
      box.expandByObject(focused.group);
      dir = new THREE.Vector3(-0.18, 1, 0.42);
    } else {
      box.setFromObject(body);
      dir = new THREE.Vector3(-0.95, 0.32, 0.72);
    }
    box.getCenter(target);
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, focused ? 0.12 : 0.3);
    const fit = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (focused ? 1.15 : 0.92);
    camGoal.copy(target).addScaledVector(dir.normalize(), fit / Math.min(1, camera.aspect));
  }

  function focus(id: string | null) {
    clearFocus();
    focused = id ? nodes.find((n) => n.id === id) ?? null : null;
    if (focused) {
      halos.push(halo(focused, 0.62));
      if (focused.kind === "plug") showCard(focused);
    }
    const was = hoverKey; hoverKey = "\0"; hover(was ? was.split("|") : []);
    frame();
    fromPos.copy(camera.position); fromTarget.copy(controls.target);
    tweenStart = performance.now(); tweenMs = 650;
    invalidate();
  }

  // ---------- pointing ----------
  const ray = new THREE.Raycaster();
  const hits = () => nodes.flatMap((n) => [...n.group.children.filter((c) => c.userData.id), ...n.pins]);
  function pointAt(ev: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(hits(), false)[0];
    const id = (hit?.object.userData.id as string | undefined) ?? null;
    // A pin a hair off the pointer still counts when the pointer is over its plug.
    let pin: THREE.Mesh | null = hit && hit.object.userData.pin !== undefined ? (hit.object as THREE.Mesh) : null;
    if (!pin && hit && id) {
      const n = nodes.find((x) => x.id === id)!;
      let best = 0.018;
      for (const m of n.pins) { const d = m.getWorldPosition(v).distanceTo(hit.point); if (d < best) { best = d; pin = m; } }
    }
    return { id, pin, x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  const v = new THREE.Vector3();
  let down: { x: number; y: number } | null = null, lastHover = "";
  renderer.domElement.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse" || ev.buttons) return;
    const at = pointAt(ev);
    hoverPinAt(at.pin);
    hover(at.id ? [at.id] : []);
    renderer.domElement.style.cursor = at.id ? "pointer" : "";
    const k = `${at.id}:${at.pin?.userData.pin ?? ""}`;
    if (opts.onHover && (k !== lastHover || at.id)) opts.onHover(at.id ? { id: at.id, pin: at.pin?.userData.pin as number | undefined, x: at.x, y: at.y } : null);
    lastHover = k;
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    hoverPinAt(null); hover([]); lastHover = "";
    renderer.domElement.style.cursor = "";
    opts.onHover?.(null);
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
    const at = pointAt(ev);
    if (!at.id && !focused) return;
    focus(at.id);
  });

  // ---------- frame loop ----------
  let w = 0, h = 0, raf = 0, lastMs = 0, frames = 0, ticking = false, roomKey = "";
  function invalidate() { if (!raf) raf = requestAnimationFrame(tick); }
  function resize() {
    w = container.clientWidth; h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    roomKey = "";
    frame();
    if (tweenStart < 0 && !focused) { camera.position.copy(camGoal); controls.target.copy(target); }
    invalidate();
  }
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(body).expandByScalar(0.1);
  const shift = new THREE.Vector3();
  controls.addEventListener("change", () => {
    const t = controls.target;
    const c = shift.copy(t).clamp(bounds.min, bounds.max).sub(t);
    if (c.lengthSq() > 0) { t.add(c); camera.position.add(c); }
    if (!ticking) invalidate();
  });
  controls.addEventListener("start", () => { tweenStart = -1; });
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  camera.position.copy(camGoal);
  controls.target.copy(target);
  // Taking over from the 3D PC: start further out and glide in to the whole card (INTRO_* in boardScene.ts).
  if (opts.intro && !reduced()) {
    fromTarget.copy(target);
    fromPos.copy(camGoal).sub(target).multiplyScalar(INTRO_FROM).add(target);
    camera.position.copy(fromPos);
    tweenStart = performance.now() + INTRO_DELAY;
    tweenMs = INTRO_MS;
    invalidate();
  }

  // Move the picture aside for the pin map: left of it on a wide stage, above it on a narrow one.
  function offsetView() {
    const want = card.hidden ? "" : window.innerWidth >= 640 ? "right" : "bottom";
    const k = `${want}:${w}x${h}`;
    if (k === roomKey) return;
    roomKey = k;
    if (!want) camera.clearViewOffset();
    else if (want === "right") camera.setViewOffset(w, h, (card.offsetWidth + 24) / 2, 0, w, h);
    else camera.setViewOffset(w, h, 0, (card.offsetHeight + 16) / 2, w, h);
  }

  const wasT = new THREE.Vector3(), wasP = new THREE.Vector3();
  function tick() {
    raf = 0;
    offsetView();
    let moving = false;
    if (tweenStart >= 0) {
      const t = Math.min(1, Math.max(0, performance.now() - tweenStart) / (reduced() ? 1 : tweenMs)), e = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(fromPos, camGoal, e);
      controls.target.lerpVectors(fromTarget, target, e);
      if (t >= 1) { tweenStart = -1; tweenMs = 650; } else moving = true;
    }
    // Damping keeps easing a drag out; stop once a frame moves less than a twentieth of a pixel.
    wasT.copy(controls.target); wasP.copy(camera.position);
    ticking = true;
    const changed = controls.update();
    ticking = false;
    if (changed) {
      const px = camera.position.distanceTo(controls.target) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, h);
      const still = (0.05 * px) ** 2;
      if (wasT.distanceToSquared(controls.target) > still || wasP.distanceToSquared(camera.position) > still) moving = true;
    }
    const t0 = performance.now();
    renderer.render(scene, camera);
    frames++;
    lastMs = performance.now() - t0;
    if (moving) invalidate();
  }
  invalidate();

  return {
    focus,
    hover,
    setUsage,
    reset() { focus(null); },
    stats: () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, ms: lastMs, frames }),
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearFocus();
      hoverHalos.forEach(freeMesh);
      controls.dispose();
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const x of Object.values(m)) if (x instanceof THREE.Texture && !isSharedTexture(x)) x.dispose();
          m.dispose();
        }
      });
      scene.environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      card.remove();
    },
  };
}

export type { GpuOutput, GpuPlug };
