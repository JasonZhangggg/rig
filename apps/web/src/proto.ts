// Real-PC 3D prototype: /proto/?build=<preset> for the PC, /proto/?board=<item kind or id> for the board.
import "@rig/ui/styles.css";
import { coolers, gpus, resolveBuild, type BuildInput, type PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { createBoardScene, createScene, makeCooler, makeGpu, makeRam, plainFan, realMaterial, sceneTheme, type Kit } from "@rig/ui/proto3d";

const presets: Record<string, { title: string; input: BuildInput }> = {
  generic: { title: "Today: one typical tower for every PC", input: {} },
  atlas: {
    title: "Detected only: MSI B650 Tomahawk layout, Corsair Vengeance 35 mm in A2 and B2, a typical 4070 SUPER",
    input: { gpu: { name: "NVIDIA GeForce RTX 4070 SUPER" }, board: { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" }, memory: { slotsTotal: 4, modules: [{ partNumber: "CMK32GX5M2B6000C30", slot: "DIMM_A2" }, { partNumber: "CMK32GX5M2B6000C30", slot: "DIMM_B2" }] } },
  },
  north: {
    title: "Fractal North + ASUS TUF 4070 SUPER (301 mm, 3 fans) + Noctua NH-D15",
    input: { gpu: { name: "NVIDIA GeForce RTX 4070 SUPER", subsysVendor: "1043" }, board: { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" }, memory: { modules: [{ partNumber: "CMK32GX5M2B6000C30", slot: "DIMM_A2" }, { partNumber: "CMK32GX5M2B6000C30", slot: "DIMM_B2" }] }, picks: { case: "fractal-north", cooler: "noctua-nh-d15", gpu: "asus-tuf-4070s-oc" } },
  },
  o11: {
    title: "Lian Li O11 EVO + ROG Strix 4070 SUPER (339 mm) + 360 mm liquid cooler + Dominator 56 mm",
    input: { gpu: { name: "NVIDIA GeForce RTX 4070 SUPER", subsysVendor: "1043" }, board: { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" }, memory: { modules: ["A1", "A2", "B1", "B2"].map((s) => ({ partNumber: "CMT64GX5M4B6000C30", slot: s })) }, picks: { case: "lianli-o11-evo", cooler: "arctic-lf3-360", gpu: "asus-strix-4070s-oc" } },
  },
  h5: {
    title: "NZXT H5 Flow + MSI Ventus 2X 4070 SUPER (242 mm, 2 fans) + Peerless Assassin",
    input: { gpu: { name: "NVIDIA GeForce RTX 4070 SUPER", subsysVendor: "1462" }, board: { manufacturer: "MSI", product: "MAG B650 TOMAHAWK WIFI" }, memory: { modules: [{ partNumber: "CMH32GX5M2B6000C30", slot: "DIMM_A2" }, { partNumber: "CMH32GX5M2B6000C30", slot: "DIMM_B2" }] }, picks: { case: "nzxt-h5-flow", cooler: "thermalright-pa120se" } },
  },
};

const q = new URLSearchParams(location.search);
const stage = document.getElementById("stage")!;
const cap = document.getElementById("cap")!;
const w = window as unknown as { __ready?: boolean; __stats?: unknown };

async function cad(n: number) {
  const { THREE } = await import("@rig/ui/proto3d");
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(stage.clientWidth, stage.clientHeight);
  stage.appendChild(r.domElement);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1));
  const cam = new THREE.PerspectiveCamera(32, stage.clientWidth / stage.clientHeight, 0.1, 100);
  cam.position.set(0, 0, 6);
  // A torus knot with about n triangles stands in for a decimated maker CAD model of one card.
  const seg = Math.round(Math.sqrt(n / 8));
  const geo = new THREE.TorusKnotGeometry(1.4, 0.4, seg * 4, seg);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x777777 }));
  sc.add(mesh);
  const bytes = (geo.attributes.position.array.byteLength + geo.attributes.normal.array.byteLength + geo.attributes.uv.array.byteLength + (geo.index?.array.byteLength ?? 0));
  let ms = 0, k = 0;
  const loop = () => { mesh.rotation.y += 0.01; const t = performance.now(); r.render(sc, cam); ms += performance.now() - t; k++; requestAnimationFrame(loop); if (k === 40) { w.__stats = { triangles: r.info.render.triangles, mb: +(bytes / 1e6).toFixed(1), renderMs: +(ms / k).toFixed(1) }; w.__ready = true; } };
  loop();
  cap.textContent = `Stand-in for a maker CAD model: ${n.toLocaleString()} triangles`;
}

/** One part alone on a turntable: /proto/?part=gpu:asus-tuf-4070s-oc, cooler:noctua-nh-d15, ram:CMT64GX5M4B6000C30. */
async function showcase(spec: string) {
  const { THREE, RoomEnvironment, OrbitControls } = await import("@rig/ui/proto3d");
  const [kind, id] = spec.split(":");
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(1);
  r.setSize(stage.clientWidth, stage.clientHeight);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  stage.appendChild(r.domElement);
  const sc = new THREE.Scene();
  sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  sc.add(new THREE.HemisphereLight(0xffffff, 0x888888, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 6, 5); sc.add(key);
  const rotors: unknown[] = [];
  const kit: Kit = { M: (c, o) => realMaterial(c, o), spin: (x) => rotors.push(x), accent: "#E6D3A3" };
  const g = new THREE.Group();
  let title = "";
  if (kind === "gpu") { const s = gpus[id] ?? Object.values(gpus)[0]; const card = makeGpu(kit, { ...s, source: "picked" }); g.add(card); title = s.model; }
  else if (kind === "cooler") { const c = coolers[id] ?? coolers["noctua-nh-d15"]; const p = makeCooler(kit, { ...c, source: "picked" }, plainFan("#1b1c1e")); g.add(p.head); if (p.radiator) { p.radiator.position.set(0, 1.4, 0); g.add(p.radiator); } title = c.model; }
  else if (kind === "ram") { const b = resolveBuild({ memory: { modules: [{ partNumber: id }] } }); for (const dx of [-0.12, 0.12]) { const s = makeRam(kit, b.memory); s.position.x = dx; g.add(s); } title = b.memory.model; }
  // Parts are built lying in the board's frame; stand the board up the way a PC holds it, glass side to the camera.
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  g.position.sub(c);
  const holder = new THREE.Group(); holder.add(g); sc.add(holder);
  const view = q.get("view") ?? "top";
  const cam = new THREE.PerspectiveCamera(30, stage.clientWidth / stage.clientHeight, 0.01, 100);
  const dir = view === "fans" ? new THREE.Vector3(0.35, -1, 0.55) : view === "side" ? new THREE.Vector3(0.6, 0.35, 1) : new THREE.Vector3(0.45, 0.75, 1);
  cam.position.copy(dir.normalize().multiplyScalar(size * 1.75));
  const ctl = new OrbitControls(cam, r.domElement); ctl.update();
  const loop = () => { r.render(sc, cam); requestAnimationFrame(loop); };
  loop();
  cap.textContent = title;
  setTimeout(() => { w.__stats = { triangles: r.info.render.triangles, calls: r.info.render.calls }; w.__ready = true; }, 1500);
}

async function main() {
  if (q.has("cad")) return cad(Number(q.get("cad")));
  if (q.has("part")) return showcase(q.get("part")!);
  const pcs = await new DemoClient().machines();
  const atlas = pcs.find((p: PC) => p.kind === "tower" && p.parts)!;
  if (q.has("board")) {
    const board = resolveBuild(presets.atlas.input).board;
    const s = createBoardScene(stage, board);
    const sel = q.get("board")!;
    if (sel) s.highlight(board.items.some((i) => i.id === sel) ? { id: sel } : { kind: sel as never });
    cap.textContent = `${board.model}${sel ? ` · ${sel}` : ""}`;
    setTimeout(() => { w.__stats = s.stats(); w.__ready = true; }, 3000);
    return;
  }
  const preset = presets[q.get("build") ?? "generic"] ?? presets.generic;
  const t0 = performance.now();
  const build = resolveBuild(preset.input);
  const pc: PC = { ...atlas, build };
  const scene = createScene(stage);
  scene.setPC(pc, { ...sceneTheme, finish: q.has("ink") ? "ink" : "real" });
  if (q.has("exploded")) scene.setExploded(true);
  const built = performance.now() - t0;
  cap.textContent = `${preset.title} · ${Math.round(build.known * 100)}% of parts real`;
  setTimeout(() => { w.__stats = { ...scene.stats(), buildMs: built, known: build.known, sources: { case: build.case.source, board: build.board.source, gpu: build.gpu?.source, cooler: build.cooler.source, memory: build.memory.source } }; w.__ready = true; }, 2500);
}
main();
