// 3D view of one motherboard, built from its layout (BoardShape in core build.ts) with the same realistic
// board the tower uses (board3d.ts). Picking a kind ("Fan headers") or one header lights it up and steps the
// rest of the board back; labels hang off each lit item the way the PC view's labels do. One header with
// named pins also gets a pin map beside the board: the pins as they sit, colored by what plugs in, and the
// same colors on the pins in 3D so the two can be matched at a glance.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { BoardItem, BoardShape } from "@rig/core";
import { makeBoard, pinNumber, type BoardNode } from "./board3d";
import { canvasTex, isSharedTexture, realMaterial, type Kit } from "./parts3d";
import { contrast, reducedMotion } from "./appearance";
import { createSceneLabels, type LabelItem, type LabelPoint } from "./sceneLabels";

export { pinNumber } from "./board3d";

/** What the pointer is over on the board: an item, and one of its pins when it's over a pin. */
export interface BoardHover { id: string; pin?: number; x: number; y: number }

export interface BoardScene {
  /** Light up every item of a kind, one item by id, or nothing, and move the camera to it. */
  highlight(sel: { kind?: BoardItem["kind"]; id?: string } | null): void;
  /** A soft light on some items without moving the camera, as when the pointer is over their row in a list. */
  hover(ids: string[]): void;
  /** Back to the whole board. */
  reset(): void;
  /** Marks slots in use (a filled frame) and free (an outline). Slots left out get no mark. */
  setUsage(states: Record<string, "used" | "free">): void;
  dispose(): void;
  /** Triangles and draw calls in the last frame, for the size and speed checks. */
  stats(): { triangles: number; calls: number; ms: number; frames: number };
}

export interface PinGroup {
  /** What plugs in ("Power switch"), without its + or − mark. */
  name: string;
  color: string;
  pins: { index: number; number: number; sign: "+" | "−" | "" }[];
}

// The colors the wires themselves usually have, so the map matches the plug in the person's hand.
/** The app's data colors that pins are drawn in, so the pin map follows Settings, Appearance. */
export interface PinPalette { good: string; look: string; expected: string; goodMark: string; lookText: string }
const brassPins: PinPalette = { good: "#E6D3A3", look: "#D9804F", expected: "#A7A39B", goodMark: "#7C6A3A", lookText: "#A4471C" };
const GROUND = "#3a3b3f";
/** Each kind of wire in one of the palette's colors: power warm, signals pale, ground dark, spare pins grey. */
const wireRole: Record<string, keyof PinPalette | "ground"> = {
  Ground: "ground", "+12V": "look", "+5V": "look", Speed: "good", PWM: "goodMark", Data: "good",
  Red: "lookText", Green: "good", Blue: "goodMark",
  "Power switch": "look", Reset: "lookText", "Power LED": "good", "HDD LED": "goodMark", Reserved: "expected",
};
const spareRoles: (keyof PinPalette)[] = ["goodMark", "look", "expected", "good", "lookText"];
/** Dark ink on a light pin, white on a dark one. */
export const pinInk = (hex: string) => (contrast(hex, "#1B1B1F") >= contrast(hex, "#FFFFFF") ? "#1B1B1F" : "#FFFFFF");

/** A header's pins grouped by what plugs into them, in the order of their lowest pin number. */
export function pinGroups(item: BoardItem, pal: PinPalette = brassPins): PinGroup[] {
  const p = item.pins;
  if (!p?.names) return [];
  const missing = p.missing ?? [];
  const by = new Map<string, PinGroup>();
  p.names.forEach((raw, i) => {
    if (!raw || missing.includes(i)) return;
    const m = /^(.*?)\s*([+−-])$/.exec(raw);
    const name = m ? m[1] : raw, sign = m ? (m[2] === "+" ? "+" : "−") : "";
    const role = wireRole[name] ?? spareRoles[by.size % spareRoles.length];
    if (!by.has(name)) by.set(name, { name, color: role === "ground" ? GROUND : pal[role], pins: [] });
    by.get(name)!.pins.push({ index: i, number: pinNumber(item, i), sign });
  });
  const out = [...by.values()];
  for (const g of out) g.pins.sort((a, b) => a.number - b.number);
  return out.sort((a, b) => a.pins[0].number - b.pins[0].number);
}

/** How far from a pin (in scene units, 1 = 100 mm) the pointer still counts as on it. */
const PIN_REACH = 0.02;
const reduced = () => { try { return reducedMotion(); } catch { return false; } };

/** The items worth naming when nothing is picked. */
const landmarks = ["socket", "dimm-1", "pcie1", "m2-1", "atx24", "eps", "fp"];

/** A soft rounded glow, drawn once and tinted per use. */
const glowTex = () => canvasTex("board-glow", 256, 256, (g) => {
  g.filter = "blur(18px)";
  g.fillStyle = "#fff";
  g.beginPath(); g.roundRect(44, 44, 168, 168, 26); g.fill();
});
/** The board's own soft shadow on the surface under it. */
const shadowTex = () => canvasTex("board-shadow", 256, 256, (g) => {
  g.filter = "blur(22px)";
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.beginPath(); g.roundRect(40, 40, 176, 176, 12); g.fill();
});

export function createBoardScene(
  container: HTMLElement,
  board: BoardShape,
  opts: {
    accent?: string;
    /** Slots in use are marked in this color; the accent when left out. */
    used?: string;
    /** The data colors pins are drawn in. */
    pins?: PinPalette;
    onPick?: (id: string | null) => void;
    /** The item (and pin) under the pointer, with the pointer's place in the view, or null when it leaves the board. */
    onHover?: (h: BoardHover | null) => void;
    /** Drag moves the board around (map style), right-drag turns it. The proto page keeps drag-to-turn. */
    dragToPan?: boolean;
    /** Name a few landmarks (socket, memory, power) while nothing is picked. Off where pointing at a part says what it is. */
    landmarks?: boolean;
  } = {},
): BoardScene {
  const accent = new THREE.Color(opts.accent ?? "#E6D3A3");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(renderer.domElement);
  const layer = document.createElement("div");
  layer.className = "scene-labels board-labels";
  container.appendChild(layer);
  // Callouts beside the board, as in the PC view (sceneLabels.ts).
  const callouts = createSceneLabels(layer, {
    onPick: (id) => { highlight({ id }); opts.onPick?.(id); },
    onHover: (id) => { hovered = id; invalidate(); },
  });
  let hovered: string | null = null, roomKey = "";
  const card = document.createElement("div");
  card.className = "pinout";
  card.hidden = true;
  container.appendChild(card);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a968c, 0.55));
  const key = new THREE.DirectionalLight(0xfff8ef, 1.8);
  key.position.set(-4.5, 5, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -2.2; sc.right = 2.2; sc.top = 2.2; sc.bottom = -2.2; sc.near = 0.5; sc.far = 15;
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe8eefc, 0.5);
  rim.position.set(4, 2, -3);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  // Panning slides the board across the view, the way a map moves under a finger.
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.12;
  controls.maxDistance = 12;
  if (opts.dragToPan) {
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  }

  // ---------- the board ----------
  const kit: Kit = { M: (c, o) => realMaterial(c, o), spin: () => {}, accent: `#${accent.getHexString()}` };
  const built = makeBoard(kit, board, { pins: true, ppm: 8 });
  const BW = board.w / 100, BH = board.h / 100;
  const root = new THREE.Group();
  root.rotation.x = -0.42; // tilted back, like a board lying on a desk in front of you
  scene.add(root);
  built.group.position.set(-BW / 2, BH / 2, 0);
  root.add(built.group);
  built.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.receiveShadow = true;
    if (o !== built.pcb && o.geometry.type !== "PlaneGeometry") o.castShadow = true;
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(BW * 1.45, BH * 1.45), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, opacity: 0.55 }));
  shadow.position.set(0.04, -0.06, -0.12);
  root.add(shadow);

  // Everything the dimming touches, with its own color to come back to
  const nodes = built.nodes;
  const baseColor = new Map<THREE.Material, THREE.Color>();
  const remember = (m: THREE.Material) => { if ("color" in m && !baseColor.has(m)) baseColor.set(m, (m as THREE.MeshStandardMaterial).color.clone()); };
  built.group.traverse((o) => { if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(remember); });
  const nodeMats = new Map<BoardNode, Set<THREE.Material>>();
  for (const n of nodes) {
    const set = new Set<THREE.Material>();
    n.group.traverse((o) => { if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => set.add(m)); });
    nodeMats.set(n, set);
  }

  // ---------- highlight ----------
  let focus: BoardNode[] = [];
  let pinCells: HTMLElement[] = [];
  const halos: THREE.Mesh[] = [];
  const pinMats: THREE.MeshStandardMaterial[] = [];
  const pinOriginal = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  interface Label { id: string; at: THREE.Object3D }
  let labels: Label[] = [];
  const target = new THREE.Vector3(), camGoal = new THREE.Vector3();
  // The camera glides to a new view over a fixed time, so a slow computer gets there as soon as a fast one.
  const fromPos = new THREE.Vector3(), fromTarget = new THREE.Vector3();
  let tweenStart = -1;
  let offsetFor: "right" | "bottom" | null = null;

  function clearFocus() {
    halos.forEach(freeMesh);
    halos.length = 0;
    for (const [mesh, m] of pinOriginal) mesh.material = m;
    pinOriginal.clear();
    for (const m of pinMats) m.dispose();
    pinMats.length = 0;
    for (const l of labels) l.at.removeFromParent();
    labels = [];
    card.hidden = true;
    card.replaceChildren();
    pinCells = [];
    offsetFor = null; roomKey = "";
  }

  function addLabel(n: BoardNode) {
    const at = new THREE.Object3D();
    at.position.set(0, 0, n.top + 0.01);
    n.group.add(at);
    labels.push({ id: n.item.id, at });
  }

  function makeHalo(n: BoardNode, opacity: number) {
    const w = n.item.w / 100, h = n.item.h / 100, pad = Math.max(0.035, Math.min(w, h) * 0.25);
    const m = new THREE.MeshBasicMaterial({ map: glowTex(), color: accent, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry((w + pad * 2) * 1.4, (h + pad * 2) * 1.4), m);
    halo.position.z = 0.0015;
    halo.renderOrder = 1;
    n.group.add(halo);
    return halo;
  }
  function addHalo(n: BoardNode) { halos.push(makeHalo(n, 0.62)); }

  // ---------- in use / free ----------
  // A filled frame around each slot in use and a thin outline around each free one, so the board reads like the Slots tab.
  let usageMarks: THREE.Mesh[] = [], usageKey = "";
  const USED = new THREE.Color(opts.used ?? accent); // the same color as .board-key and the Slots tab
  const rounded = (w: number, h: number, r: number, path: THREE.Path = new THREE.Shape()) => {
    const x = -w / 2, y = -h / 2;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    path.moveTo(x + r, y);
    path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r);
    path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
    path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
    return path;
  };
  function setUsage(states: Record<string, "used" | "free">) {
    const key = Object.keys(states).sort().map((k) => `${k}=${states[k]}`).join("|");
    if (key === usageKey) return;
    usageKey = key;
    usageMarks.forEach(freeMesh);
    usageMarks = [];
    for (const n of nodes) {
      const state = states[n.item.id];
      if (!state) continue;
      const used = state === "used", pad = 0.012, t = used ? 0.011 : 0.007, r = 0.014;
      const w = n.item.w / 100 + pad * 2, h = n.item.h / 100 + pad * 2;
      const frame = rounded(w, h, r) as THREE.Shape;
      frame.holes.push(rounded(w - t * 2, h - t * 2, r - t, new THREE.Path()));
      const parts: [THREE.Shape, number][] = [[frame, used ? 1 : 0.45]];
      if (used) parts.push([rounded(w - t * 2, h - t * 2, r - t) as THREE.Shape, 0.55]);
      for (const [shape, opacity] of parts) {
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), new THREE.MeshBasicMaterial({ color: used ? USED : 0xffffff, transparent: true, opacity, depthWrite: false, toneMapped: false }));
        m.position.z = n.top + 0.002;
        m.renderOrder = 2;
        n.group.add(m);
        usageMarks.push(m);
      }
    }
    invalidate();
  }

  // ---------- hover ----------
  // A softer glow than a pick, and the pin under the pointer stands up a little.
  let hoverHalos: THREE.Mesh[] = [], hoverKey = "";
  let hoverPin: THREE.Mesh | null = null;
  function freeMesh(h: THREE.Mesh) { h.removeFromParent(); h.geometry.dispose(); (h.material as THREE.Material).dispose(); }
  function hover(ids: string[]) {
    const key = ids.join("|");
    if (key === hoverKey) return;
    hoverKey = key;
    hoverHalos.forEach(freeMesh);
    hoverHalos = nodes.filter((n) => ids.includes(n.item.id) && !focus.includes(n)).map((n) => makeHalo(n, 0.55));
    invalidate();
  }
  function hoverPinAt(mesh: THREE.Mesh | null) {
    if (mesh === hoverPin) return;
    if (hoverPin && !hoverPin.userData.lit) hoverPin.scale.set(1, 1, 1);
    hoverPin = mesh;
    if (mesh) mesh.scale.set(1.5, 1.5, 1.2);
    // The same pin on the pin map, when the map is for this header.
    const mapped = mesh && focus.length === 1 && focus[0].pins.includes(mesh) ? (mesh.userData.pin as number) : -1;
    pinCells.forEach((c, i) => c.classList.toggle("is-hover", i === mapped));
    invalidate();
  }

  /**
   * The pin map for one header: its pins as they sit on the board, each run of pins named right beside it, above the
   * top row and below the bottom one (or to the right of a header that stands on end). Signed pins show + and −.
   * A header with more than two rows of named pins keeps a list under the map instead.
   */
  function showCard(n: BoardNode, groups: PinGroup[]) {
    const it = n.item, p = it.pins!;
    const head = document.createElement("div");
    head.className = "po-head";
    head.innerHTML = `<span class="po-name"></span><span class="po-label"></span>`;
    head.children[0].textContent = it.name;
    head.children[1].textContent = it.label;
    const grid = document.createElement("div");
    grid.className = "po-grid";
    const groupOf = new Map<number, PinGroup>(), signOf = new Map<number, string>();
    for (const g of groups) for (const q of g.pins) { groupOf.set(q.index, g); signOf.set(q.index, q.sign); }
    const onEnd = p.cols === 1 && p.rows > 1;
    const labeled = groups.length > 0 && (p.rows <= 2 || onEnd);
    const top = labeled && !onEnd && p.rows === 2 ? 1 : 0; // a label row above the pins
    grid.style.gridTemplateColumns = onEnd && labeled ? "var(--po-pin) auto" : `repeat(${p.cols}, var(--po-pin))`;
    if (labeled) grid.classList.add("is-labeled");
    const cells: HTMLElement[] = [];
    for (let i = 0; i < p.cols * p.rows; i++) {
      const c = document.createElement("span");
      c.className = "po-pin";
      c.style.gridRow = String(Math.floor(i / p.cols) + 1 + top);
      c.style.gridColumn = String((i % p.cols) + 1);
      if ((p.missing ?? []).includes(i)) c.classList.add("is-empty");
      else {
        const g = groupOf.get(i), sign = signOf.get(i);
        c.textContent = labeled && sign ? sign : String(pinNumber(it, i));
        if (g) { c.style.setProperty("--c", g.color); c.style.color = pinInk(g.color); } else c.classList.add("is-unused");
        if (pinNumber(it, i) === 1) c.classList.add("is-first");
      }
      cells.push(c);
      grid.append(c);
    }
    const mark = (g: PinGroup, on: boolean) => {
      for (const q of g.pins) {
        cells[q.index].classList.toggle("is-lit", on);
        const mesh = n.pins[q.index];
        if (mesh) { mesh.userData.lit = on; mesh.scale.set(on ? 1.35 : 1, on ? 1.35 : 1, on ? 1.12 : 1); }
      }
      grid.classList.toggle("has-lit", on);
      invalidate();
    };
    const tag = (g: PinGroup) => {
      const el = document.createElement("span");
      el.className = "po-tag";
      el.style.setProperty("--c", g.color);
      el.textContent = g.name;
      el.addEventListener("pointerenter", () => mark(g, true));
      el.addEventListener("pointerleave", () => mark(g, false));
      return el;
    };
    if (labeled && onEnd) {
      // One name per run of pins, beside them.
      for (let r = 0; r < p.rows; ) {
        const g = groupOf.get(r);
        let end = r + 1;
        while (g && end < p.rows && groupOf.get(end) === g) end++;
        if (g) { const el = tag(g); el.classList.add("is-side"); el.style.gridRow = `${r + 1} / ${end + 1}`; el.style.gridColumn = "2"; grid.append(el); }
        r = end;
      }
    } else if (labeled) {
      // Runs of same-named pins along the top row get their name above, along the bottom row below.
      const rows = p.rows === 2 ? [0, 1] : [0];
      for (const row of rows) {
        const above = p.rows === 2 && row === 0;
        for (let col = 0; col < p.cols; ) {
          const g = groupOf.get(row * p.cols + col);
          let end = col + 1;
          while (g && end < p.cols && groupOf.get(row * p.cols + end) === g) end++;
          if (g) {
            const el = tag(g);
            el.classList.add(above ? "is-above" : "is-below");
            if (end - col === 1) el.classList.add(col === 0 ? "is-start" : col === p.cols - 1 ? "is-end" : "is-one");
            el.style.gridRow = String(above ? 1 : p.rows + 1 + top);
            el.style.gridColumn = `${col + 1} / ${end + 1}`;
            grid.append(el);
          }
          col = end;
        }
      }
    }
    const parts: HTMLElement[] = [head, grid];
    if (!labeled && groups.length) {
      const legend = document.createElement("ul");
      legend.className = "po-legend";
      for (const g of groups) {
        const li = document.createElement("li");
        li.style.setProperty("--c", g.color);
        li.innerHTML = `<i></i><b></b><span></span>`;
        li.children[1].textContent = g.name;
        li.children[2].textContent = g.pins.map((q) => `${q.number}${q.sign ? ` ${q.sign}` : ""}`).join(", ");
        li.addEventListener("pointerenter", () => mark(g, true));
        li.addEventListener("pointerleave", () => mark(g, false));
        legend.append(li);
      }
      parts.push(legend);
    }
    const note = document.createElement("p");
    note.className = "po-note";
    note.textContent = groups.some((g) => g.pins.some((q) => q.sign))
      ? "Seen from above. Pin 1 is square. On an LED plug, + is the colored wire."
      : "Seen from above. Pin 1 is square.";
    card.append(...parts, note);
    card.hidden = false;
    cells.forEach((c, i) => { c.dataset.pin = String(i); });
    pinCells = cells;
  }

  function highlight(sel: { kind?: BoardItem["kind"]; id?: string } | null) {
    clearFocus();
    focus = sel ? nodes.filter((n) => (sel.id ? n.item.id === sel.id : n.item.kind === sel.kind)) : [];
    const dim = focus.length > 0;
    for (const [m, c] of baseColor) { const sm = m as THREE.MeshStandardMaterial; sm.color.copy(c); sm.envMapIntensity = sm.userData.envI ??= sm.envMapIntensity; }
    if (dim) {
      // Step the rest back: the board darker, every other part darker still
      const lit = new Set<THREE.Material>();
      for (const n of focus) for (const m of nodeMats.get(n)!) lit.add(m);
      for (const [m, c] of baseColor) if (!lit.has(m)) { const sm = m as THREE.MeshStandardMaterial; sm.color.copy(c).multiplyScalar(0.34); sm.envMapIntensity = sm.userData.envI * 0.3; }
    }
    for (const n of focus) addHalo(n);
    const one = focus.length === 1 ? focus[0] : null;
    const groups = one ? pinGroups(one.item, opts.pins) : [];
    if (one && groups.length) {
      for (const g of groups) {
        const m = realMaterial(g.color, { metal: 0.35, rough: 0.32, emissive: g.color, ei: 0.45 });
        pinMats.push(m);
        for (const q of g.pins) {
          const mesh = one.pins[q.index];
          if (mesh) { pinOriginal.set(mesh, mesh.material); mesh.material = m; }
        }
      }
      showCard(one, groups);
    }
    // Labels: every lit item, or a few landmarks when nothing is picked. A header with a pin map is named by the map.
    const named = dim ? focus.filter((n) => !(n === one && groups.length)) : opts.landmarks === false ? [] : nodes.filter((n) => landmarks.includes(n.item.id));
    const items: LabelItem[] = [];
    for (const n of named) {
      const it = n.item;
      const plain = it.id === "dimm-1" && !dim ? "Memory slots" : it.label;
      const code = it.id === "dimm-1" && !dim ? "" : it.name && !/^Rear I\/O$/.test(it.name) ? it.name : "";
      addLabel(n);
      items.push({ id: it.id, title: plain, code: code || undefined });
    }
    callouts.setItems(items);
    layer.hidden = items.length === 0;
    const was = hoverKey; hoverKey = "\0";
    hover(was ? was.split("|") : []);
    frame();
    fromPos.copy(camera.position); fromTarget.copy(controls.target);
    tweenStart = performance.now();
    invalidate();
  }

  // Where the camera goes: the whole board, or the lit items, framed with room for the pin map.
  function frame() {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    if (focus.length) for (const n of focus) box.expandByObject(n.group);
    else box.setFromObject(built.pcb);
    box.getCenter(target);
    // One small header near an edge: lean the view a little toward the board's middle so it shows where on the board it is
    // One header: close enough to count its pins. A slot or anything bigger: framed whole.
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, focus.length === 1 ? (focus[0].item.pins ? 0.16 : 0.3) : 0.3);
    const fit = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (focus.length ? 1.25 : 0.98);
    const dir = new THREE.Vector3(0.08, focus.length ? 0.5 : 0.32, 1).normalize();
    // The callout columns, or a phone's list, take room beside the board: fit the board in what's left.
    const room = w && labels.length ? callouts.room(w) : null;
    const uw = Math.max(1, w - (room ? room.l + room.r : 0)), uh = Math.max(1, h - (room ? room.t + room.b : 0));
    const squeeze = room ? (h / uh) / Math.min(1, uw / uh) * Math.min(1, camera.aspect) : 1;
    camGoal.copy(target).addScaledVector(dir, Math.max(fit * squeeze / Math.min(1, camera.aspect), controls.minDistance + 0.05));
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
  // The pins are tiny, so a pin a hair off the pointer still counts when the pointer is over its header.
  const pinNear = (n: BoardNode | undefined, p: THREE.Vector3) => {
    if (!n) return null;
    let best: THREE.Mesh | null = null, bd = PIN_REACH;
    for (const m of n.pins) {
      if (!m) continue;
      const d = m.getWorldPosition(c1).distanceTo(p);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  };
  const c1 = new THREE.Vector3();
  let lastHover = "";
  function pointAt(ev: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(built.group, true).find((h) => h.object.userData.id);
    const id = (hit?.object.userData.id as string | undefined) ?? null;
    const node = id ? nodes.find((n) => n.item.id === id) : undefined;
    const pin = hit && node ? (hit.object.userData.pin !== undefined ? hit.object as THREE.Mesh : pinNear(node, hit.point)) : null;
    return { id, pin, x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse" || ev.buttons) return;
    const at = pointAt(ev);
    const was = hovered;
    hovered = at.id && labels.some((l) => l.id === at.id) ? at.id : null;
    hoverPinAt(at.pin);
    hover(at.id ? [at.id] : []);
    renderer.domElement.style.cursor = at.id ? "pointer" : "";
    const key = `${at.id}:${at.pin?.userData.pin ?? ""}`;
    if (was !== hovered) invalidate();
    if (opts.onHover && (key !== lastHover || at.id)) opts.onHover(at.id ? { id: at.id, pin: at.pin?.userData.pin as number | undefined, x: at.x, y: at.y } : null);
    lastHover = key;
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    hoverPinAt(null); hover([]); hovered = null; lastHover = "";
    renderer.domElement.style.cursor = "";
    opts.onHover?.(null);
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return; // a drag, not a click
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(built.group, true).find((h) => h.object.userData.id);
    const id = (hit?.object.userData.id as string | undefined) ?? null;
    // A click on the board where nothing is keeps the view where it is; only a click on a part moves it.
    if (!id && !focus.length) return;
    highlight(id ? { id } : null);
    opts.onPick?.(id);
  });

  // ---------- frame loop ----------
  // Drawn only when something changes (a drag, the camera gliding, a hover, a new size), so a board at rest costs nothing.
  let w = 0, h = 0, raf = 0, lastMs = 0, frames = 0, ticking = false;
  function invalidate() { if (!raf) raf = requestAnimationFrame(tick); }
  function resize() {
    w = container.clientWidth; h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    offsetFor = null; roomKey = "";
    frame();
    // A new size puts the whole board back in view.
    if (tweenStart < 0 && !focus.length) { camera.position.copy(camGoal); controls.target.copy(target); }
    invalidate();
  }
  // Panning stops at the board's edges, so the board can't be slid out of sight.
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(built.pcb).expandByScalar(0.08);
  const panShift = new THREE.Vector3();
  controls.addEventListener("change", () => {
    const t = controls.target;
    const clamped = panShift.copy(t).clamp(bounds.min, bounds.max).sub(t);
    if (clamped.lengthSq() > 0) { t.add(clamped); camera.position.add(clamped); }
    if (!ticking) invalidate(); // in a frame, tick decides whether another is needed
  });
  controls.addEventListener("start", () => { tweenStart = -1; });
  document.fonts?.ready.then(() => invalidate());
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  highlight(null);
  camera.position.copy(camGoal);
  controls.target.copy(target);
  tweenStart = -1;

  // Move the picture aside for the pin map: left of it on a wide stage, above it on a narrow one.
  function offsetView() {
    const want = card.hidden ? null : window.innerWidth >= 640 ? "right" : "bottom"; // as the card's own CSS places it
    const room = labels.length ? callouts.room(w) : null;
    const key = `${want}:${room ? [room.t, room.r, room.b, room.l].join(",") : ""}`;
    if (key === roomKey) return;
    roomKey = key;
    offsetFor = want;
    const l = room?.l ?? 0, t = room?.t ?? 0;
    const r = (room?.r ?? 0) + (want === "right" ? card.offsetWidth + 24 : 0);
    const b = (room?.b ?? 0) + (want === "bottom" ? card.offsetHeight + 16 : 0);
    if (!l && !r && !t && !b) camera.clearViewOffset();
    else camera.setViewOffset(w, h, (r - l) / 2, (b - t) / 2, w, h);
  }

  const v = new THREE.Vector3(), c0 = new THREE.Vector3(), _pb = new THREE.Box3();
  function layoutLabels() {
    const toScreen = (p: THREE.Vector3): [number, number, number] => { v.copy(p).project(camera); return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z]; };
    const points: LabelPoint[] = labels.map((l) => {
      l.at.getWorldPosition(c0);
      const [x, y, z] = toScreen(c0);
      return { id: l.id, x, y, off: z > 1 };
    });
    // The board's outline on screen: the callout columns sit outside it.
    _pb.setFromObject(built.pcb);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      const [sx, sy] = toScreen(c0.set(k & 1 ? _pb.max.x : _pb.min.x, k & 2 ? _pb.max.y : _pb.min.y, k & 4 ? _pb.max.z : _pb.min.z));
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    const right = card.hidden || offsetFor !== "right" ? w : w - card.offsetWidth - 24;
    callouts.layout(points, { width: right, height: h, box: { x0, y0, x1: Math.min(x1, right), y1 }, hovered, selected: focus.length === 1 ? focus[0].item.id : null });
  }

  const wasT = new THREE.Vector3(), wasP = new THREE.Vector3();
  function tick() {
    raf = 0;
    offsetView();
    let moving = false;
    if (tweenStart >= 0) {
      const t = Math.min(1, (performance.now() - tweenStart) / (reduced() ? 1 : 650)), e = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(fromPos, camGoal, e);
      controls.target.lerpVectors(fromTarget, target, e);
      if (t >= 1) tweenStart = -1; else moving = true;
    }
    // While damping eases a drag out, keep drawing until the camera settles. OrbitControls keeps saying it moved
    // while a pan's leftover drifts by far less than a pixel, so the board stops once a frame moves less than a twentieth of a pixel.
    wasT.copy(controls.target); wasP.copy(camera.position);
    ticking = true;
    const changed = controls.update();
    ticking = false;
    if (changed) {
      const px = camera.position.distanceTo(controls.target) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, h);
      const still = (0.05 * px) ** 2; // a twentieth of a pixel
      if (wasT.distanceToSquared(controls.target) > still || wasP.distanceToSquared(camera.position) > still) moving = true;
    }
    const t0 = performance.now();
    renderer.render(scene, camera);
    frames++;
    lastMs = performance.now() - t0;
    layoutLabels();
    if (moving) invalidate();
  }
  invalidate();

  return {
    highlight,
    hover,
    setUsage,
    reset() { highlight(null); },
    stats: () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, ms: lastMs, frames }),
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearFocus();
      hoverHalos.forEach(freeMesh);
      controls.dispose();
      // Geometry and materials are the board's own; textures drawn once and shared between views stay.
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture && !isSharedTexture(v)) v.dispose();
          m.dispose();
        }
      });
      scene.environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      callouts.dispose();
      layer.remove();
      card.remove();
    },
  };
}
