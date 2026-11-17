import { useEffect, useRef } from "react";

/* A PC tower drawn in characters, turning slowly on a turntable and read like a
   thermal camera: denser glyphs face the light and the data colors mean hotter.
   Each cell casts one ray at a few boxes and fan planes, so near parts hide far
   ones. The pointer is a heat source that spreads and cools; dragging turns it. */

const RAMP = " .:-=+*#%@";
const LEVELS = 16;
const SHADES = 4;
const MAX_CELLS = 14000;
// Characters read fine at 30 frames a second, and it halves the drawing.
const FRAME_MS = 1000 / 30 - 2;
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';
const MIN_C = 24;
const SPAN_C = 66;
const AUTO = (-Math.PI * 2) / 26;
const PITCH = 0.28;
const DIST = 11;
const REST_YAW = -0.62;

type V3 = [number, number, number];
type Tex = "vent" | "grille" | "board" | "fins" | "back" | "strip" | "ram";
type Box = { kind: "box"; lo: V3; hi: V3; heat: number; albedo: number; inner?: boolean; tex?: Tex; glass?: boolean; holes?: [number, number, number][] };
type Fan = { kind: "fan"; c: V3; half: number; r: number; blades: number; speed: number; heat: number; albedo: number };
type Part = Box | Fan;

const W = 0.42, H = 1, D = 0.78, T = 0.03;
const box = (lo: V3, hi: V3, heat: number, albedo: number, more: Partial<Box> = {}): Box => ({ kind: "box", lo, hi, heat, albedo, ...more });
const fan = (c: V3, half: number, speed: number, heat: number): Fan => ({ kind: "fan", c, half, r: half * 0.94, blades: 7, speed, heat, albedo: 0.95 });
const part = (lo: V3, hi: V3, heat: number, albedo: number, more: Partial<Box> = {}) => box(lo, hi, heat, albedo, { inner: true, ...more });

// The glass side is x-, the front z+; fans all face along z.
const PARTS: Part[] = [
  box([-W, H - T, -D], [W, H, D], 0.4, 1, { tex: "grille" }),
  box([-W, -H, -D], [W, -H + T, D], 0.36, 1),
  box([W - T, -H, -D], [W, H, D], 0.38, 1),
  box([-W, -H, -D], [W, H, -D + T], 0.4, 1, { tex: "back", holes: [[-0.1, 0.5, 0.16]] }),
  box([-W, -H, -D], [-W + 0.012, H, D], 0.4, 1, { glass: true }),
  box([-W, -H, D - T], [W, H, D], 0.42, 0.95, { holes: [[0, 0.58, 0.235], [0, 0.04, 0.235], [0, -0.5, 0.235]] }),
  ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box([sx * 0.34 - 0.05, -H - 0.05, sz * 0.6 - 0.09], [sx * 0.34 + 0.05, -H, sz * 0.6 + 0.09], 0.3, 0.8))),
  part([0.35, -0.5, -0.74], [0.39, 0.88, 0.14], 0.56, 0.7, { tex: "board" }),
  part([-0.02, 0.22, -0.52], [0.35, 0.7, -0.24], 0.5, 0.95, { tex: "fins" }),
  fan([0.165, 0.46, -0.225], 0.19, 5.5, 0.55),
  part([0.22, 0.16, -0.17], [0.35, 0.78, 0.0], 0.66, 1, { tex: "ram" }),
  part([-0.2, -0.27, -0.75], [0.35, -0.06, 0.38], 0.6, 1, { tex: "strip" }),
  part([-W + 0.012, -H + T, -D + T], [W - T, -0.6, 0.46], 0.52, 0.9, { tex: "vent" }),
  fan([0, 0.58, 0.68], 0.25, 4.2, 0.58), fan([0, 0.04, 0.68], 0.25, 4.4, 0.58), fan([0, -0.5, 0.68], 0.25, 4.0, 0.58),
  fan([-0.1, 0.5, -0.71], 0.17, -4.8, 0.45),
  box([0.14, 0.12, -0.81], [0.35, 0.78, -D + T], 0.32, 0.9),
];
const BOUND = { lo: [-W - 0.01, -H - 0.06, -0.83] as V3, hi: [W + 0.01, H + 0.01, D + 0.01] as V3 };
const FLOOR_Y = -H - 0.055, FLOOR_R = 1.0;
// Heat sources inside the case: x, y, z, strength, spread.
const HEAT: [number, number, number, number, number][] = [
  [0.28, 0.46, -0.38, 0.75, 0.2],
  [0.12, -0.16, -0.2, 0.6, 0.28],
  [0.0, -0.82, -0.45, 0.32, 0.3],
  [0.37, 0.78, -0.5, 0.3, 0.12],
];

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const fract = (v: number) => v - Math.floor(v);

interface Camera { eye: V3; f: V3; r: V3; u: V3; light: V3 }

function camera(yaw: number): Camera {
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH), sa = Math.sin(yaw), ca = Math.cos(yaw);
  const f: V3 = [-sa * cp, -sp, -ca * cp], r: V3 = [ca, 0, -sa];
  const u: V3 = [-r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1]];
  // The light stays with the viewer, up and to the left, so faces change as it turns.
  const lx = -0.5, ly = 0.72, lz = 0.48, ln = Math.hypot(lx, ly, lz);
  const light = [0, 1, 2].map((k) => (r[k] * lx + u[k] * ly - f[k] * lz) / ln) as V3;
  return { eye: [-f[0] * DIST, -f[1] * DIST, -f[2] * DIST], f, r, u, light };
}

function project(cam: Camera, p: V3) {
  const v = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]];
  const z = v[0] * cam.f[0] + v[1] * cam.f[1] + v[2] * cam.f[2];
  return [((v[0] * cam.r[0] + v[2] * cam.r[2]) * DIST) / z, ((v[0] * cam.u[0] + v[1] * cam.u[1] + v[2] * cam.u[2]) * DIST) / z];
}

const HULL: V3[] = [];
for (const x of [BOUND.lo[0], BOUND.hi[0]]) for (const y of [BOUND.lo[1], BOUND.hi[1]]) for (const z of [BOUND.lo[2], BOUND.hi[2]]) HULL.push([x, y, z]);
for (let k = 0; k < 16; k++) HULL.push([Math.cos(k * 0.3927) * FLOOR_R, FLOOR_Y, Math.sin(k * 0.3927) * FLOOR_R]);

function extent(cams: Camera[], pts = HULL) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const cam of cams) for (const p of pts) {
    const [x, y] = project(cam, p);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}
// Fit the whole turn, so the tower keeps its size as it spins.
const TURN = extent(Array.from({ length: 48 }, (_, k) => camera((k / 48) * Math.PI * 2)));

/** Where the tower sits: on wide bands it moves right, so the copy keeps the left. */
function stage(w: number, h: number) {
  const ew = TURN.x1 - TURN.x0, eh = TURN.y1 - TURN.y0;
  let x: number, y: number, bw: number, bh: number;
  if (w / h > 1.6) {
    bh = h * 0.9; bw = Math.min(w * 0.5, bh * 1.1);
    x = w - bw - Math.max(12, w * 0.04); y = (h - bh) / 2;
  } else {
    const top = 80;
    bh = Math.max(160, h - top - 170); bw = w * 0.88;
    x = (w - bw) / 2; y = top;
  }
  const s = Math.min(bw / ew, bh / eh);
  return { s, cx: x + bw / 2 - (s * (TURN.x0 + TURN.x1)) / 2, cy: y + bh / 2 + (s * (TURN.y0 + TURN.y1)) / 2 };
}

interface Grid {
  w: number; h: number; cols: number; rows: number; cw: number; ch: number;
  s: number; cx: number; cy: number;
  id: Int32Array; depth: Float32Array; soft: Uint8Array; bright: Float32Array; tex: Float32Array; therm: Float32Array;
  heat: Float32Array; tmp: Float32Array;
}

function build(w: number, h: number): Grid {
  let cw = w < 600 ? 4.5 : 6, ch = w < 600 ? 7.5 : 10;
  const n = (w / cw) * (h / ch);
  if (n > MAX_CELLS) { const k = Math.sqrt(n / MAX_CELLS); cw *= k; ch *= k; }
  const cols = Math.max(1, Math.ceil(w / cw)), rows = Math.max(1, Math.ceil(h / ch));
  const size = cols * rows;
  return {
    w, h, cols, rows, cw, ch, ...stage(w, h),
    id: new Int32Array(size).fill(-1), depth: new Float32Array(size), soft: new Uint8Array(size), bright: new Float32Array(size), tex: new Float32Array(size), therm: new Float32Array(size),
    heat: new Float32Array(size), tmp: new Float32Array(size),
  };
}

function texture(t: Tex | undefined, axis: number, p: V3) {
  switch (t) {
    case "vent": return axis === 1 && Math.abs(p[0]) < 0.32 && Math.abs(p[2]) < 0.65 && fract(p[2] * 13) < 0.45 ? 0.35 : 1;
    case "board": return fract(p[1] * 7) < 0.1 || fract(p[2] * 7) < 0.1 ? 1.15 : 0.75;
    case "fins": return axis !== 1 && fract(p[1] * 26) < 0.5 ? 0.4 : 1.05;
    case "back": return axis === 2 && p[0] > -0.3 && p[0] < 0.1 && p[1] > -0.5 && p[1] < 0.05 && fract(p[1] * 12) < 0.4 ? 0.4 : 1;
    case "strip": return axis === 0 ? 1.15 : 0.8;
    case "grille": return axis === 1 && Math.abs(p[0]) < 0.26 && p[2] > -0.65 && p[2] < -0.08 && fract(p[2] * 12) < 0.4 ? 0.45 : 1;
    case "ram": return axis !== 2 && fract(p[2] * 18) < 0.4 ? 0.35 : 1.1;
    default: return 1;
  }
}

const CORNERS: V3[][] = PARTS.map((q) => {
  if (q.kind === "fan") return [-1, 1].flatMap((a) => [-1, 1].map((b): V3 => [q.c[0] + a * q.half, q.c[1] + b * q.half, q.c[2]]));
  const out: V3[] = [];
  for (const x of [q.lo[0], q.hi[0]]) for (const y of [q.lo[1], q.hi[1]]) for (const z of [q.lo[2], q.hi[2]]) out.push([x, y, z]);
  return out;
});
const RECT = new Int32Array(PARTS.length * 4);

/** Casts one ray per cell over the tower's screen box and keeps the nearest surface. */
function trace(gd: Grid, cam: Camera, spin: number) {
  const { cols, rows, cw, ch, s, cx, cy, id, depth, soft, bright, tex, therm } = gd;
  id.fill(-1);
  const toCol = (x: number) => (cx + x * s) / cw, toRow = (y: number) => (cy - y * s) / ch;
  // Each part only tests the cells its projected corners can cover.
  CORNERS.forEach((pts, i) => {
    const e = extent([cam], pts);
    RECT[i * 4] = Math.floor(toCol(e.x0)) - 1; RECT[i * 4 + 1] = Math.ceil(toCol(e.x1)) + 1;
    RECT[i * 4 + 2] = Math.floor(toRow(e.y1)) - 1; RECT[i * 4 + 3] = Math.ceil(toRow(e.y0)) + 1;
  });
  const all = extent([cam]);
  const c0 = Math.max(0, Math.floor(toCol(all.x0)) - 1), c1 = Math.min(cols - 1, Math.ceil(toCol(all.x1)) + 1);
  const r0 = Math.max(0, Math.floor(toRow(all.y1)) - 1), r1 = Math.min(rows - 1, Math.ceil(toRow(all.y0)) + 1);
  const { eye: o, f, r: rt, u, light: L } = cam;
  const p: V3 = [0, 0, 0];

  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    const sx = ((col + 0.5) * cw - cx) / s, sy = (cy - (row + 0.5) * ch) / s;
    const dx = f[0] * DIST + rt[0] * sx + u[0] * sy, dy = f[1] * DIST + rt[1] * sx + u[1] * sy, dz = f[2] * DIST + rt[2] * sx + u[2] * sy;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = Infinity, hit = -1, face = 0, axis = 1, glass = Infinity, fanTex = 1;

    for (let i = 0; i < PARTS.length; i++) {
      const k4 = i * 4;
      if (col < RECT[k4] || col > RECT[k4 + 1] || row < RECT[k4 + 2] || row > RECT[k4 + 3]) continue;
      const q = PARTS[i];
      if (q.kind === "box") {
        let a = (q.lo[0] - o[0]) * ix, b = (q.hi[0] - o[0]) * ix;
        let near = a < b ? a : b, far = a < b ? b : a, ax = 0;
        a = (q.lo[1] - o[1]) * iy; b = (q.hi[1] - o[1]) * iy;
        let lo = a < b ? a : b, hi = a < b ? b : a;
        if (lo > near) { near = lo; ax = 1; }
        if (hi < far) far = hi;
        a = (q.lo[2] - o[2]) * iz; b = (q.hi[2] - o[2]) * iz;
        lo = a < b ? a : b; hi = a < b ? b : a;
        if (lo > near) { near = lo; ax = 2; }
        if (hi < far) far = hi;
        if (near > far || near <= 0 || near >= best) continue;
        if (q.glass && ax === 0) { if (near < glass) glass = near; continue; }
        if (q.holes && ax === 2) {
          const hx = o[0] + dx * near, hy = o[1] + dy * near;
          let open = false;
          for (const [x, y, rr] of q.holes) if ((hx - x) ** 2 + (hy - y) ** 2 < rr * rr) open = true;
          if (open) continue;
        }
        best = near; hit = i; axis = ax; face = ax * 2 + ((ax === 0 ? dx : ax === 1 ? dy : dz) > 0 ? 0 : 1);
      } else {
        const tt = (q.c[2] - o[2]) * iz;
        if (tt <= 0 || tt >= best) continue;
        const px = o[0] + dx * tt - q.c[0], py = o[1] + dy * tt - q.c[1];
        if (px > q.half || px < -q.half || py > q.half || py < -q.half) continue;
        const rr = Math.sqrt(px * px + py * py) / q.r;
        best = tt; hit = i; axis = 2; face = 6;
        fanTex = rr > 1 ? 0.55 : rr < 0.26 ? 1.9 : Math.cos(q.blades * (Math.atan2(py, px) - spin * q.speed) + 2.6 * rr) > 0.3 ? 1.7 : 0.25;
      }
    }
    const i = row * cols + col;
    if (hit < 0) {
      if (dy >= 0) continue;
      const tt = (FLOOR_Y - o[1]) * iy, fx = o[0] + dx * tt, fz = o[2] + dz * tt, fr = Math.hypot(fx, fz) / FLOOR_R;
      if (fr > 1) continue;
      const tick = fr > 0.86 && Math.abs(fract((Math.atan2(fz, fx) / (Math.PI * 2)) * 24) - 0.5) > 0.44;
      if (fr < 0.97 && !tick) continue;
      id[i] = -2; bright[i] = tick ? 0.26 : 0.16; therm[i] = 0.1;
      continue;
    }
    const q = PARTS[hit];
    p[0] = o[0] + dx * best; p[1] = o[1] + dy * best; p[2] = o[2] + dz * best;
    const lam = Math.max(0, ((axis === 0 ? dx : axis === 1 ? dy : dz) > 0 ? -1 : 1) * L[axis]);
    let heat = q.heat;
    for (const [hx, hy, hz, amp, sg] of HEAT) heat += amp * Math.exp(-((p[0] - hx) ** 2 + (p[1] - hy) ** 2 + (p[2] - hz) ** 2) / (2 * sg * sg));
    id[i] = hit * 8 + face;
    depth[i] = best;
    // Fans glow on their own, so their blades read whichever way they face.
    bright[i] = q.kind === "fan" ? Math.max(0.8, lam) : (0.2 + 0.8 * lam) * q.albedo;
    const sheen = glass < best ? (fract((o[1] + dy * glass + (o[2] + dz * glass) * 0.7) * 2.2) < 0.1 ? 1.5 : 0.85) : 1;
    tex[i] = (q.kind === "box" ? texture(q.tex, axis, p) : fanTex) * sheen;
    soft[i] = q.kind === "box" && q.inner ? 1 : 0;
    therm[i] = clamp(heat);
  }
}

/** Resolves any CSS color, tokens included, to RGB through a 1px canvas. */
function readColors(el: HTMLElement, names: string[]) {
  const probe = document.createElement("span");
  el.appendChild(probe);
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d", { willReadFrequently: true });
  const out = names.map((n) => {
    probe.style.color = `var(${n})`;
    if (!g) return [128, 128, 128];
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = getComputedStyle(probe).color;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  probe.remove();
  return out;
}

function palette(el: HTMLElement) {
  const [bg, grey, expected, good, look] = readColors(el, ["--graphite", "--text-3", "--expected", "--good", "--look"]);
  const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  // Cool parts sit in warm grey, working parts in brass, the hottest in coral.
  const stops: [number, number[]][] = [[0, mix(bg, grey, 0.7)], [0.25, expected], [0.55, good], [0.85, look], [1, look]];
  const rgb: number[][] = [];
  for (let l = 0; l < LEVELS; l++) {
    const t = l / (LEVELS - 1);
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < t) k++;
    const [t0, c0] = stops[k - 1], [t1, c1] = stops[k];
    rgb.push(mix(c0, c1, clamp((t - t0) / (t1 - t0))));
  }
  const shaded: string[] = [];
  for (const c of rgb) for (let s = 0; s < SHADES; s++) shaded.push(`rgb(${mix(bg, c, 0.5 + (0.5 * s) / (SHADES - 1)).join(",")})`);
  return { bg: `rgb(${bg.join(",")})`, rgb, shaded };
}

function atlas(cw: number, ch: number, dpr: number, colors: string[]) {
  const a = document.createElement("canvas");
  const sw = Math.ceil(cw * dpr), sh = Math.ceil(ch * dpr);
  a.width = sw * RAMP.length;
  a.height = sh * colors.length;
  const g = a.getContext("2d");
  if (!g) return null;
  g.font = `600 ${Math.round(ch * 0.95 * dpr)}px ${MONO}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  colors.forEach((col, l) => {
    g.fillStyle = col;
    for (let k = 1; k < RAMP.length; k++) g.fillText(RAMP[k], k * sw + sw / 2, l * sh + sh / 2);
  });
  return { canvas: a, sw, sh };
}

export function AsciiField() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = wrap.current!, cv = canvas.current!, out = readout.current!;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = cv.getContext("2d"); } catch { ctx = null; }
    if (!ctx) return;
    const g = ctx;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let grid: Grid | null = null;
    let sprites: ReturnType<typeof atlas> = null;
    let colors = palette(el);
    let dpr = 1;
    let visible = true, raf = 0, last = 0, clock = 0, shown = 0, leftAt = 0;
    let yaw = REST_YAW, vel = still ? 0 : AUTO;
    let drag: { x: number; at: number } | null = null;
    let glow: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; img: ImageData } | null = null;
    let pointer: { x: number; y: number; inside: boolean } | null = null;
    const pulses: { x: number; y: number; age: number }[] = [];

    const resize = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      grid = build(r.width, r.height);
      colors = palette(el);
      sprites = atlas(grid.cw, grid.ch, dpr, colors.shaded);
      const gc = document.createElement("canvas");
      gc.width = grid.cols; gc.height = grid.rows;
      const gg = gc.getContext("2d");
      glow = gg ? { canvas: gc, g: gg, img: gg.createImageData(grid.cols, grid.rows) } : null;
      draw();
    };

    const addHeat = (x: number, y: number, amp: number, sigma: number) => {
      if (!grid) return;
      const { cols, rows, cw, ch, heat } = grid;
      const k = 1 / (2 * sigma * sigma), reach = sigma * 3;
      for (let r = Math.max(0, Math.floor((y - reach) / ch)); r <= Math.min(rows - 1, Math.floor((y + reach) / ch)); r++)
        for (let c = Math.max(0, Math.floor((x - reach) / cw)); c <= Math.min(cols - 1, Math.floor((x + reach) / cw)); c++) {
          const dx = (c + 0.5) * cw - x, dy = (r + 0.5) * ch - y, i = r * cols + c;
          heat[i] = Math.min(1.4, heat[i] + amp * Math.exp(-(dx * dx + dy * dy) * k));
        }
    };

    const tempAt = (x: number, y: number) => {
      if (!grid) return 0;
      const { cols, rows, cw, ch, id, therm, heat } = grid;
      const c0 = Math.floor(x / cw), r0 = Math.floor(y / ch);
      let sum = 0, n = 0;
      for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const i = r * cols + c;
        sum += clamp((id[i] >= 0 ? therm[i] * 0.9 : 0) + heat[i]); n++;
      }
      return n ? sum / n : 0;
    };

    const step = (dt: number) => {
      if (!grid) return;
      if (drag) vel *= Math.exp(-dt * 8);
      else { vel += (AUTO - vel) * (1 - Math.exp(-dt * 0.9)); yaw += vel * dt; }
      const { cols, rows, heat, tmp } = grid;
      const sigma = Math.max(grid.cw, grid.ch) * 1.7;
      if (pointer?.inside) addHeat(pointer.x, pointer.y, 1.5 * dt, sigma);
      for (let p = pulses.length - 1; p >= 0; p--) {
        const q = pulses[p];
        q.age += dt;
        if (q.age > 0.7) { pulses.splice(p, 1); continue; }
        const rad = 18 + q.age * 320, amp = 1.6 * dt * (1 - q.age / 0.7);
        for (let a = 0; a < 40; a++) addHeat(q.x + Math.cos(a * 0.157) * rad, q.y + Math.sin(a * 0.157) * rad, amp * 0.35, sigma * 0.8);
      }
      const d = Math.min(0.24, dt * 12), keep = Math.exp(-dt * 1.5);
      let any = false;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, v = heat[i];
        const n = (c > 0 ? heat[i - 1] : v) + (c < cols - 1 ? heat[i + 1] : v) + (r > 0 ? heat[i - cols] : v) + (r < rows - 1 ? heat[i + cols] : v);
        const nv = (v + d * (n / 4 - v)) * keep;
        tmp[i] = nv < 0.004 ? 0 : nv;
        if (nv > 0.004) any = true;
      }
      grid.heat = tmp; grid.tmp = heat;
      if (!any && !pointer?.inside) grid.heat.fill(0);
    };

    const draw = () => {
      if (!grid || !sprites) return;
      const t = still ? 0 : clock;
      trace(grid, camera(yaw), t);
      const { cols, rows, cw, ch, id, depth, soft, bright, tex, therm, heat } = grid;
      // Only the nearer side of a step in depth draws the line, so edges stay one cell thin.
      const owns = (i: number, j: number) => {
        const o = id[j];
        if (o < 0) return true;
        if (o === id[i]) return false;
        const gap = depth[j] - depth[i];
        return gap > 0.004 || (gap > -0.004 && id[i] > o);
      };
      const { canvas: a, sw, sh } = sprites;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = colors.bg;
      g.fillRect(0, 0, cv.width, cv.height);
      if (glow) {
        const px = glow.img.data;
        for (let i = 0; i < cols * rows; i++) {
          const v = clamp((id[i] >= 0 ? therm[i] * 0.75 : 0) + heat[i]), c = colors.rgb[Math.round(v * (LEVELS - 1))];
          px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = v * v * 110;
        }
        glow.g.putImageData(glow.img, 0, 0);
        g.imageSmoothingEnabled = true;
        g.drawImage(glow.canvas, 0, 0, cols, rows, 0, 0, cols * cw * dpr, rows * ch * dpr);
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, me = id[i], hp = heat[i];
        let dens: number, col: number, shade = SHADES - 1;
        if (me >= 0) {
          const edge = (c > 0 && owns(i, i - 1)) || (c < cols - 1 && owns(i, i + 1)) || (r > 0 && owns(i, i - cols)) || (r < rows - 1 && owns(i, i + cols));
          const b = bright[i], hb = therm[i];
          const shimmer = hb > 0.55 ? (hb - 0.55) * 0.14 * Math.sin(c * 0.55 + t * 1.4) * Math.sin(r * 0.8 - t * 1.1) : 0;
          // Parts inside the case draw lighter than the shell, so the box outline leads.
          const sf = soft[i] ? 0.78 : 1;
          dens = (edge ? (0.58 + 0.34 * b) * sf : (0.06 + 0.4 * b) * tex[i] * sf) + hp * 0.7 + shimmer;
          col = hb + hp;
          shade = Math.min(SHADES - 1, Math.round((edge ? 0.5 + 0.5 * b : b) * (SHADES - 1)));
        } else if (me === -2) {
          dens = bright[i] + hp * 0.6; col = therm[i] + hp; shade = 1;
        } else {
          dens = hp * 0.9; col = hp;
        }
        const k = Math.round(clamp(dens) * (RAMP.length - 1) - 0.15);
        if (k <= 0) continue;
        const l = Math.round(clamp(col) * (LEVELS - 1)) * SHADES + shade;
        g.drawImage(a, k * sw, l * sh, sw, sh, Math.round(c * cw * dpr), Math.round(r * ch * dpr), sw, sh);
      }
    };

    const showReadout = (dt: number) => {
      if (!pointer) { out.style.opacity = "0"; return; }
      const target = tempAt(pointer.x, pointer.y);
      shown = dt ? shown + (target - shown) * Math.min(1, dt * 5) : target;
      out.textContent = `${Math.round(MIN_C + SPAN_C * shown)}°`;
      const on = pointer.inside || (!still && clock - leftAt < 1.4);
      out.style.opacity = on ? "1" : "0";
      if (!on && !pointer.inside) pointer = null;
    };

    const frame = (now: number) => {
      raf = 0;
      if (last && now - last < FRAME_MS) { loop(); return; }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      clock += dt;
      step(dt);
      draw();
      showReadout(dt);
      loop();
    };
    const loop = () => {
      const run = visible && document.visibilityState === "visible" && !still;
      if (run && !raf) raf = requestAnimationFrame(frame);
      if (!run) { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
    };

    let pending = 0;
    const stillFrame = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        if (!grid) return;
        grid.heat.fill(0);
        if (pointer?.inside) addHeat(pointer.x, pointer.y, 0.85, Math.max(grid.cw, grid.ch) * 2.4);
        draw();
        if (pointer && !pointer.inside) pointer = null;
        showReadout(0);
      });
    };

    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (drag && grid) {
        const turn = -(p.x - drag.x) / (grid.s * 0.9), span = (e.timeStamp - drag.at) / 1000;
        yaw += turn;
        if (span > 0) vel = clamp(vel + (turn / span - vel) * 0.5, -8, 8);
        drag = { x: p.x, at: e.timeStamp };
      }
      if (pointer?.inside && grid && !still) {
        const dx = p.x - pointer.x, dy = p.y - pointer.y, dist = Math.hypot(dx, dy), stepPx = Math.max(grid.cw, grid.ch);
        for (let s = 1; s <= Math.min(30, Math.floor(dist / stepPx)); s++) addHeat(pointer.x + (dx * s * stepPx) / dist, pointer.y + (dy * s * stepPx) / dist, 0.16, stepPx * 1.4);
      }
      pointer = { ...p, inside: true };
      out.style.transform = `translate(${Math.round(p.x + 14)}px, ${Math.round(p.y - 30)}px)`;
      if (still) stillFrame();
    };
    const onUp = () => { drag = null; };
    const onLeave = () => { onUp(); if (pointer) pointer.inside = false; leftAt = clock; if (still) stillFrame(); };
    const onDown = (e: PointerEvent) => {
      onMove(e);
      const p = local(e);
      drag = { x: p.x, at: e.timeStamp };
      vel = 0;
      try { el.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer can't be captured */ }
      if (still || !grid) return;
      addHeat(p.x, p.y, 0.7, Math.max(grid.cw, grid.ch) * 2.6);
      pulses.push({ ...p, age: 0 });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointercancel", onLeave);

    const onVis = () => loop();
    document.addEventListener("visibilitychange", onVis);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(el);
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; loop(); }) : null;
    io?.observe(el);
    resize();
    loop();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (pending) cancelAnimationFrame(pending);
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
    };
  }, []);

  return (
    <div className="ascii" ref={wrap} aria-hidden="true">
      <canvas ref={canvas} />
      <span className="ascii-temp num" ref={readout} />
    </div>
  );
}
