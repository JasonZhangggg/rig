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
import { canvasTex, realMaterial, type Kit } from "./parts3d";
import { createSceneLabels, type LabelItem, type LabelPoint } from "./sceneLabels";

export { pinNumber } from "./board3d";

export interface BoardScene {
  /** Light up every item of a kind, one item by id, or nothing. */
  highlight(sel: { kind?: BoardItem["kind"]; id?: string } | null): void;
  dispose(): void;
  /** Triangles and draw calls in the last frame, for the size and speed checks. */
  stats(): { triangles: number; calls: number; ms: number };
}

export interface PinGroup {
  /** What plugs in ("Power switch"), without its + or − mark. */
  name: string;
  color: string;
  pins: { index: number; number: number; sign: "+" | "−" | "" }[];
}

// The colors the wires themselves usually have, so the map matches the plug in the person's hand.
const wireColor: Record<string, string> = {
  Ground: "#3a3b3f", "+12V": "#e3b324", Speed: "#3f9f58", PWM: "#3b78d0", "+5V": "#d4483b", Data: "#3f9f58",
  Red: "#d4483b", Green: "#3f9f58", Blue: "#3b78d0",
  "Power switch": "#d4673b", Reset: "#e3b324", "Power LED": "#3f9f58", "HDD LED": "#3b78d0", Reserved: "#9a9890",
};
const spare = ["#3b78d0", "#3f9f58", "#d4673b", "#a45cc2", "#e3b324", "#9a9890"];

/** A header's pins grouped by what plugs into them, in the order of their lowest pin number. */
export function pinGroups(item: BoardItem): PinGroup[] {
  const p = item.pins;
  if (!p?.names) return [];
  const missing = p.missing ?? [];
  const by = new Map<string, PinGroup>();
  p.names.forEach((raw, i) => {
    if (!raw || missing.includes(i)) return;
    const m = /^(.*?)\s*([+−-])$/.exec(raw);
    const name = m ? m[1] : raw, sign = m ? (m[2] === "+" ? "+" : "−") : "";
    if (!by.has(name)) by.set(name, { name, color: wireColor[name] ?? spare[by.size % spare.length], pins: [] });
    by.get(name)!.pins.push({ index: i, number: pinNumber(item, i), sign });
  });
  const out = [...by.values()];
  for (const g of out) g.pins.sort((a, b) => a.number - b.number);
  return out.sort((a, b) => a.pins[0].number - b.pins[0].number);
}

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
  opts: { accent?: string; onPick?: (id: string | null) => void } = {},
): BoardScene {
  const accent = new THREE.Color(opts.accent ?? "#E6D3A3");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.style.position ||= "relative";
  container.appendChild(renderer.domElement);
  const layer = document.createElement("div");
  layer.className = "scene-labels board-labels";
  container.appendChild(layer);
  // Callouts beside the board, as in the PC view (sceneLabels.ts).
  const callouts = createSceneLabels(layer, {
    onPick: (id) => { highlight({ id }); opts.onPick?.(id); },
    onHover: (id) => { hovered = id; },
  });
  let hovered: string | null = null, roomKey = "";
  const card = document.createElement("div");
  card.className = "pinout";
  card.hidden = true;
  container.appendChild(card);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
  controls.enablePan = false;
  controls.minDistance = 0.35;
  controls.maxDistance = 12;

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
    for (const h of halos) { h.removeFromParent(); (h.material as THREE.Material).dispose(); }
    halos.length = 0;
    for (const [mesh, m] of pinOriginal) mesh.material = m;
    pinOriginal.clear();
    for (const m of pinMats) m.dispose();
    pinMats.length = 0;
    for (const l of labels) l.at.removeFromParent();
    labels = [];
    card.hidden = true;
    card.replaceChildren();
    offsetFor = null; roomKey = "";
  }

  function addLabel(n: BoardNode) {
    const at = new THREE.Object3D();
    at.position.set(0, 0, n.top + 0.01);
    n.group.add(at);
    labels.push({ id: n.item.id, at });
  }

  function addHalo(n: BoardNode) {
    const w = n.item.w / 100, h = n.item.h / 100, pad = Math.max(0.035, Math.min(w, h) * 0.25);
    const m = new THREE.MeshBasicMaterial({ map: glowTex(), color: accent, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry((w + pad * 2) * 1.4, (h + pad * 2) * 1.4), m);
    halo.position.z = 0.0015;
    halo.renderOrder = 1;
    n.group.add(halo);
    halos.push(halo);
  }

  /** The pin map for one header: its pins as they sit on the board, then what each color is. */
  function showCard(n: BoardNode, groups: PinGroup[]) {
    const it = n.item, p = it.pins!;
    const head = document.createElement("div");
    head.className = "po-head";
    head.innerHTML = `<span class="po-name"></span><span class="po-label"></span>`;
    head.children[0].textContent = it.name;
    head.children[1].textContent = it.label;
    const grid = document.createElement("div");
    grid.className = "po-grid";
    grid.style.gridTemplateColumns = `repeat(${p.cols}, var(--po-pin))`;
    const colorOf = new Map<number, string>();
    for (const g of groups) for (const q of g.pins) colorOf.set(q.index, g.color);
    const cells: HTMLElement[] = [];
    for (let i = 0; i < p.cols * p.rows; i++) {
      const c = document.createElement("span");
      c.className = "po-pin";
      if ((p.missing ?? []).includes(i)) c.classList.add("is-empty");
      else {
        c.textContent = String(pinNumber(it, i));
        const col = colorOf.get(i);
        if (col) c.style.setProperty("--c", col); else c.classList.add("is-unused");
        if (pinNumber(it, i) === 1) c.classList.add("is-first");
      }
      cells.push(c);
      grid.append(c);
    }
    const legend = document.createElement("ul");
    legend.className = "po-legend";
    for (const g of groups) {
      const li = document.createElement("li");
      li.style.setProperty("--c", g.color);
      li.innerHTML = `<i></i><b></b><span></span>`;
      li.children[1].textContent = g.name;
      li.children[2].textContent = g.pins.map((q) => `${q.number}${q.sign ? ` ${q.sign}` : ""}`).join(", ");
      const mark = (on: boolean) => {
        for (const q of g.pins) {
          cells[q.index].classList.toggle("is-lit", on);
          const mesh = n.pins[q.index];
          if (mesh) mesh.scale.set(on ? 1.35 : 1, on ? 1.35 : 1, on ? 1.12 : 1);
        }
        grid.classList.toggle("has-lit", on);
      };
      li.addEventListener("pointerenter", () => mark(true));
      li.addEventListener("pointerleave", () => mark(false));
      legend.append(li);
    }
    const note = document.createElement("p");
    note.className = "po-note";
    note.textContent = groups.some((g) => g.pins.some((q) => q.sign))
      ? "Seen from above. Pin 1 is square. On an LED plug, + is the colored wire."
      : "Seen from above. Pin 1 is square.";
    card.append(head, grid, legend, note);
    card.hidden = false;
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
    const groups = one ? pinGroups(one.item) : [];
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
    const named = dim ? focus.filter((n) => !(n === one && groups.length)) : nodes.filter((n) => landmarks.includes(n.item.id));
    const items: LabelItem[] = [];
    for (const n of named) {
      const it = n.item;
      const plain = it.id === "dimm-1" && !dim ? "Memory slots" : it.label;
      const code = it.id === "dimm-1" && !dim ? "" : it.name && !/^Rear I\/O$/.test(it.name) ? it.name : "";
      addLabel(n);
      items.push({ id: it.id, title: plain, code: code || undefined });
    }
    callouts.setItems(items);
    frame();
    fromPos.copy(camera.position); fromTarget.copy(controls.target);
    tweenStart = performance.now();
  }

  // Where the camera goes: the whole board, or the lit items, framed with room for the pin map.
  function frame() {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    if (focus.length) for (const n of focus) box.expandByObject(n.group);
    else box.setFromObject(built.pcb);
    box.getCenter(target);
    // One small header near an edge: lean the view a little toward the board's middle so it shows where on the board it is
    if (focus.length === 1) target.lerp(new THREE.Box3().setFromObject(built.pcb).getCenter(new THREE.Vector3()), 0.18);
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, focus.length === 1 ? 0.6 : 0.3);
    const fit = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (focus.length ? 1.25 : 0.98);
    const dir = new THREE.Vector3(0.08, focus.length ? 0.5 : 0.32, 1).normalize();
    // The callout columns, or a phone's list, take room beside the board: fit the board in what's left.
    const room = w ? callouts.room(w) : null;
    const uw = Math.max(1, w - (room ? room.l + room.r : 0)), uh = Math.max(1, h - (room ? room.t + room.b : 0));
    const squeeze = room ? (h / uh) / Math.min(1, uw / uh) * Math.min(1, camera.aspect) : 1;
    camGoal.copy(target).addScaledVector(dir, Math.max(fit * squeeze / Math.min(1, camera.aspect), controls.minDistance + 0.05));
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
  renderer.domElement.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse") return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const id = (ray.intersectObject(built.group, true).find((h) => h.object.userData.id)?.object.userData.id as string | undefined) ?? null;
    hovered = id && labels.some((l) => l.id === id) ? id : null;
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return; // a drag, not a click
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(built.group, true).find((h) => h.object.userData.id);
    const id = (hit?.object.userData.id as string | undefined) ?? null;
    highlight(id ? { id } : null);
    opts.onPick?.(id);
  });

  // ---------- frame loop ----------
  let w = 0, h = 0, raf = 0, lastMs = 0;
  function resize() {
    w = container.clientWidth; h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    offsetFor = null; roomKey = "";
    frame();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  highlight(null);
  camera.position.copy(camGoal);
  controls.target.copy(target);
  tweenStart = -1;

  // Move the picture aside for the pin map: left of it on a wide stage, above it on a narrow one.
  function offsetView() {
    const want = card.hidden ? null : w >= 640 ? "right" : "bottom";
    const room = callouts.room(w);
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

  function tick() {
    raf = requestAnimationFrame(tick);
    offsetView();
    if (tweenStart >= 0) {
      const t = Math.min(1, (performance.now() - tweenStart) / 650), e = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(fromPos, camGoal, e);
      controls.target.lerpVectors(fromTarget, target, e);
      if (t >= 1) tweenStart = -1;
    }
    controls.update();
    const t0 = performance.now();
    const pulse = 0.5 + 0.2 * Math.sin(t0 / 420);
    for (const halo of halos) (halo.material as THREE.MeshBasicMaterial).opacity = pulse;
    renderer.render(scene, camera);
    lastMs = performance.now() - t0;
    layoutLabels();
  }
  tick();

  return {
    highlight,
    stats: () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, ms: lastMs }),
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearFocus();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      callouts.dispose();
      layer.remove();
      card.remove();
    },
  };
}
