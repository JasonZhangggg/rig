// 3D view of one motherboard, built from its layout (BoardShape in core build.ts):
// every slot and header sits where the board's layout puts it, and headers get
// their real pins. Picking a kind ("Fan headers") or one header lights it up,
// dims the rest and moves the camera to it; one header also names its pins.
// Units: 1 unit = 100 mm, the board lies in the x-y plane facing +z.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { BoardItem, BoardShape } from "@rig/core";

export interface BoardScene {
  /** Light up every item of a kind, one item by id, or nothing. */
  highlight(sel: { kind?: BoardItem["kind"]; id?: string } | null): void;
  dispose(): void;
  /** Triangles and draw calls in the last frame, for the size and speed checks. */
  stats(): { triangles: number; calls: number; ms: number };
}

const PITCH = 0.0254; // 2.54 mm header pitch

/** The number printed for a pin. Two-row headers count across the rows, odd pins in the first row (1, 3, 5 over 2, 4, 6). */
export function pinNumber(item: BoardItem, i: number) {
  const { cols, rows } = item.pins!;
  const r = Math.floor(i / cols), c = i % cols;
  return rows === 2 ? c * 2 + r + 1 : i + 1;
}
const lift: Record<BoardItem["kind"], number> = {
  heatsink: 0.22, chipset: 0.09, io: 0.3, dimm: 0.08, pcie: 0.11, m2: 0.03, socket: 0.05, power: 0.1, fan: 0.07,
  usb: 0.07, "front-panel": 0.02, rgb: 0.02, audio: 0.02, sata: 0.09, other: 0.04,
};

export function createBoardScene(
  container: HTMLElement,
  board: BoardShape,
  opts: { accent?: string; dark?: boolean; onPick?: (id: string | null) => void } = {},
): BoardScene {
  const accent = new THREE.Color(opts.accent ?? "#E8692E");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  const layer = document.createElement("div");
  layer.className = "board-labels";
  Object.assign(layer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
  container.style.position ||= "relative";
  container.appendChild(layer);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 4, 8);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 0.3;
  controls.maxDistance = 14;

  const BW = board.w / 100, BH = board.h / 100;
  const toX = (u: number) => u / 100 - BW / 2;
  const toY = (v: number) => BH / 2 - v / 100;
  const root = new THREE.Group();
  root.rotation.x = -0.5; // tilted back a little, like a board on a desk
  scene.add(root);

  const pcb = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, 0.016), new THREE.MeshStandardMaterial({ color: board.color, roughness: 0.6, metalness: 0.1 }));
  pcb.position.z = -0.008;
  root.add(pcb);
  // Screen-printed grid so the board reads as a circuit board, not a slab
  const silk = new THREE.GridHelper(Math.max(BW, BH), 24, 0x3a3d42, 0x2c2f33);
  silk.rotation.x = Math.PI / 2;
  silk.position.z = 0.001;
  silk.scale.set(BW / Math.max(BW, BH), 1, BH / Math.max(BW, BH));
  root.add(silk);

  const baseColor: Record<BoardItem["kind"], string> = {
    heatsink: "#8b9098", chipset: "#8b9098", io: "#5a5e66", dimm: "#3a3d43", pcie: "#3a3d43", m2: "#9aa0a8", socket: "#d9c79a",
    power: "#e7e7e2", fan: "#f1f1ec", usb: "#2f6fd6", "front-panel": "#16171a", rgb: "#16171a", audio: "#16171a", sata: "#2b2d31", other: "#2b2d31",
  };

  interface Node { item: BoardItem; group: THREE.Group; mats: THREE.MeshStandardMaterial[]; pins: THREE.Vector3[] }
  const nodes: Node[] = [];
  const pinGeo = new THREE.BoxGeometry(0.0064, 0.0064, 0.06);
  const pinMat = new THREE.MeshStandardMaterial({ color: "#d8b25a", metalness: 0.35, roughness: 0.35 });
  const pin1Mat = new THREE.MeshStandardMaterial({ color: "#f5d77e", metalness: 0.35, roughness: 0.3, emissive: "#8a6a20", emissiveIntensity: 0.6 });

  for (const item of board.items) {
    const g = new THREE.Group();
    const w = item.w / 100, h = item.h / 100, d = lift[item.kind];
    g.position.set(toX(item.u) + w / 2, toY(item.v) - h / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: baseColor[item.kind], roughness: 0.55, metalness: item.kind === "heatsink" || item.kind === "chipset" || item.kind === "m2" ? 0.6 : 0.1, transparent: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    body.position.z = d / 2;
    body.userData.id = item.id;
    g.add(body);
    const pins: THREE.Vector3[] = [];
    if (item.pins) {
      const { cols, rows, missing = [] } = item.pins;
      const ox = -((cols - 1) * PITCH) / 2, oy = ((rows - 1) * PITCH) / 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const p = new THREE.Vector3(ox + c * PITCH, oy - r * PITCH, 0.03);
        pins.push(p);
        if (missing.includes(i)) continue;
        const m = new THREE.Mesh(pinGeo, i === 0 ? pin1Mat : pinMat);
        m.position.copy(p);
        m.userData.id = item.id;
        g.add(m);
      }
    }
    root.add(g);
    nodes.push({ item, group: g, mats: [mat], pins });
  }

  // ---------- highlight ----------
  let focus: Node[] = [];
  const labels: { el: HTMLElement; at: THREE.Object3D }[] = [];
  const target = new THREE.Vector3(), camGoal = new THREE.Vector3();
  let tween = 0;

  function clearLabels() {
    for (const l of labels) { l.el.remove(); l.at.removeFromParent(); }
    labels.length = 0;
  }
  function label(text: string, parent: THREE.Object3D, pos: THREE.Vector3, small = false) {
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, {
      position: "absolute", left: "0", top: "0", whiteSpace: "nowrap", font: `600 ${small ? 11 : 12}px system-ui, sans-serif`,
      padding: small ? "1px 5px" : "3px 8px", borderRadius: "6px", background: opts.dark ? "rgba(20,20,24,.85)" : "rgba(255,255,255,.92)",
      color: opts.dark ? "#fff" : "#16171a", boxShadow: "0 1px 4px rgba(0,0,0,.25)", transform: "translate(-50%,-130%)",
    });
    layer.appendChild(el);
    const at = new THREE.Object3D();
    at.position.copy(pos);
    parent.add(at);
    labels.push({ el, at });
  }

  function highlight(sel: { kind?: BoardItem["kind"]; id?: string } | null) {
    focus = sel ? nodes.filter((n) => (sel.id ? n.item.id === sel.id : n.item.kind === sel.kind)) : [];
    clearLabels();
    for (const n of nodes) {
      const on = focus.includes(n);
      for (const m of n.mats) {
        m.opacity = !focus.length || on ? 1 : 0.28;
        m.emissive.copy(on ? accent : new THREE.Color(0));
        m.emissiveIntensity = on ? 0.55 : 0;
      }
    }
    const box = new THREE.Box3();
    if (focus.length) for (const n of focus) box.expandByObject(n.group);
    else box.setFromObject(pcb);
    const one = focus.length === 1 ? focus[0] : null;
    for (const n of focus) label(n.item.name ? `${n.item.name} · ${n.item.label}` : n.item.label, n.group, new THREE.Vector3(0, n.item.h / 200 + (focus.length === 1 && n.item.pins?.names ? 0.07 : 0), lift[n.item.kind]));
    if (one?.item.pins?.names) {
      // Name every pin, alternating above and below so neighbours don't collide
      const { names, missing = [] } = one.item.pins;
      one.pins.forEach((p, i) => {
        if (missing.includes(i) || !names[i]) return;
        label(`${pinNumber(one.item, i)} ${names[i]}`, one.group, p.clone().add(new THREE.Vector3(0, i < one.item.pins!.cols ? 0.03 : -0.045, 0.03)), true);
      });
    }
    box.getCenter(target);
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = Math.max(one ? 0.55 : 0.9, size * 1.6);
    camGoal.copy(target).add(new THREE.Vector3(0.08, one ? -0.3 : -0.55, 1).normalize().multiplyScalar(dist));
    tween = 1;
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  renderer.domElement.addEventListener("click", (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(root.children, true).find((h) => h.object.userData.id);
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
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  highlight(null);
  camera.position.copy(camGoal);
  controls.target.copy(target);
  tween = 0;

  const v = new THREE.Vector3();
  function tick() {
    raf = requestAnimationFrame(tick);
    if (tween > 0) {
      camera.position.lerp(camGoal, 0.12);
      controls.target.lerp(target, 0.12);
      tween = camera.position.distanceTo(camGoal) > 0.002 ? 1 : 0;
    }
    controls.update();
    const t0 = performance.now();
    renderer.render(scene, camera);
    lastMs = performance.now() - t0;
    const pulse = 0.4 + 0.25 * Math.sin(t0 / 260);
    for (const n of focus) for (const m of n.mats) m.emissiveIntensity = pulse;
    for (const l of labels) {
      l.at.getWorldPosition(v).project(camera);
      l.el.style.translate = `${((v.x + 1) / 2) * w}px ${((1 - v.y) / 2) * h}px`;
      l.el.style.opacity = v.z < 1 ? "1" : "0";
    }
  }
  tick();

  return {
    highlight,
    stats: () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, ms: lastMs }),
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearLabels();
      renderer.dispose();
      renderer.domElement.remove();
      layer.remove();
    },
  };
}
