import { useEffect, useRef, type ReactNode } from "react";

/* A PC tower drawn in characters, turning slowly on a turntable and read like a
   thermal camera: denser glyphs face the light and the data colors mean hotter.
   Each cell casts one ray at a few boxes and fan planes, so near parts hide far
   ones. Edges take the slant of the 3D edge they sit on. The pointer is a heat
   source that spreads and cools; dragging turns it. */

const RAMP = " .:+*#%@";
const GLYPHS = RAMP + "-/|\\";
const EDGE = RAMP.length;
const LEVELS = 16;
const SHADES = 5;
const MAX_CELLS = 14000;
// A big tower would otherwise draw thousands more glyphs; past this many cells over it, the cells grow with it.
const TOWER_CELLS = 6000;
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
type Tex = "side" | "vent" | "grille" | "board" | "fins" | "back" | "shroud" | "plate" | "ram" | "cap";
type Box = { kind: "box"; lo: V3; hi: V3; heat: number; albedo: number; inner?: boolean; tex?: Tex; glass?: boolean; holes?: [number, number, number][] };
type Fan = { kind: "fan"; c: V3; half: number; r: number; blades: number; speed: number; heat: number; albedo: number };
type Part = Box | Fan;

const W = 0.42, H = 1, D = 0.78, T = 0.03, RIM = 0.055;
const box = (lo: V3, hi: V3, heat: number, albedo: number, more: Partial<Box> = {}): Box => ({ kind: "box", lo, hi, heat, albedo, ...more });
const fan = (c: V3, half: number, speed: number, heat: number): Fan => ({ kind: "fan", c, half, r: half * 0.92, blades: 5, speed, heat, albedo: 0.95 });
const part = (lo: V3, hi: V3, heat: number, albedo: number, more: Partial<Box> = {}) => box(lo, hi, heat, albedo, { inner: true, ...more });
const RAM = [0, 1, 2, 3].map((k) => -0.2 + k * 0.058);

// The glass side is x-, the front z+; fans all face along z.
const PARTS: Part[] = [
  box([-W, H - T, -D], [W, H, D], 0.2, 1, { tex: "grille" }),
  box([-W, -H, -D], [W, -H + T, D], 0.18, 1),
  box([W - T, -H, -D], [W, H, D], 0.2, 1, { tex: "side" }),
  box([-W, -H, -D], [W, H, -D + T], 0.22, 1, { tex: "back", holes: [[-0.1, 0.5, 0.16]] }),
  box([-W, -H, -D], [-W + 0.012, H, D], 0.22, 1, { glass: true }),
  box([-W, -H, D - T], [W, H, D], 0.24, 0.95, { holes: [[0, 0.58, 0.235], [0, 0.04, 0.235], [0, -0.5, 0.235]] }),
  ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box([sx * 0.34 - 0.05, -H - 0.05, sz * 0.6 - 0.09], [sx * 0.34 + 0.05, -H, sz * 0.6 + 0.09], 0.16, 0.8))),
  part([0.35, -0.5, -0.74], [0.39, 0.88, 0.14], 0.34, 0.75, { tex: "board" }),
  part([0.3, 0.74, -0.62], [0.35, 0.84, -0.18], 0.42, 0.95),
  part([0.32, -0.04, -0.66], [0.35, 0.02, -0.3], 0.42, 1),
  part([-0.02, 0.22, -0.52], [0.35, 0.7, -0.26], 0.5, 1, { tex: "fins" }),
  part([-0.03, 0.7, -0.53], [0.35, 0.73, -0.25], 0.52, 1, { tex: "cap" }),
  fan([0.165, 0.46, -0.235], 0.19, 5.5, 0.62),
  ...RAM.map((z) => part([0.24, 0.18, z], [0.35, 0.72, z + 0.036], 0.4, 1, { tex: "ram" })),
  ...RAM.map((z) => part([0.235, 0.72, z - 0.004], [0.35, 0.77, z + 0.04], 0.7, 1, { tex: "cap" })),
  part([-0.22, -0.31, -0.75], [0.35, -0.13, 0.38], 0.66, 1, { tex: "shroud" }),
  part([-0.22, -0.13, -0.75], [0.35, -0.1, 0.38], 0.46, 1, { tex: "plate" }),
  part([-W + 0.012, -H + T, -D + T], [W - T, -0.6, 0.46], 0.26, 0.9, { tex: "vent" }),
  fan([0, 0.58, 0.68], 0.25, 4.2, 0.6), fan([0, 0.04, 0.68], 0.25, 4.4, 0.6), fan([0, -0.5, 0.68], 0.25, 4.0, 0.6),
  fan([-0.1, 0.5, -0.71], 0.17, -4.8, 0.55),
  box([0.14, 0.12, -0.81], [0.35, 0.78, -D + T], 0.24, 0.9),
];
const BOUND = { lo: [-W - 0.01, -H - 0.06, -0.83] as V3, hi: [W + 0.01, H + 0.01, D + 0.01] as V3 };
const FLOOR_Y = -H - 0.055, FLOOR_R = 1.0;
// Heat sources inside the case: x, y, z, strength, spread.
const HEAT: [number, number, number, number, number][] = [
  [0.2, 0.46, -0.38, 0.5, 0.18],
  [0.1, -0.2, -0.2, 0.42, 0.3],
  [0.0, -0.82, -0.45, 0.14, 0.3],
  [0.35, 0.79, -0.4, 0.2, 0.12],
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

/** Where the tower sits and how big: `size` is the share of the panel's height its whole turn fills, `x` and `y` place its center, `width` caps its share of the width. */
export interface TowerFit { size: number; x?: number; y?: number; width?: number }

/** Where the tower sits: centered with room around it, or where a fit puts it; on a short wide band it fills the height. */
function stage(w: number, h: number, fit?: TowerFit) {
  const ew = TURN.x1 - TURN.x0, eh = TURN.y1 - TURN.y0;
  const wide = w / h > 1.6;
  if (fit && !wide) {
    const s = Math.min((h * fit.size) / eh, (w * (fit.width ?? 0.92)) / ew);
    return { s, cx: w * (fit.x ?? 0.5) - (s * (TURN.x0 + TURN.x1)) / 2, cy: h * (fit.y ?? 0.5) + (s * (TURN.y0 + TURN.y1)) / 2 };
  }
  const bh = wide ? h * 0.86 : Math.min(h * 0.56, w * 0.74), bw = wide ? w * 0.6 : w * 0.72;
  const s = Math.min(bw / ew, bh / eh);
  return { s, cx: w / 2 - (s * (TURN.x0 + TURN.x1)) / 2, cy: h / 2 + (s * (TURN.y0 + TURN.y1)) / 2 };
}

interface Grid {
  w: number; h: number; cols: number; rows: number; cw: number; ch: number;
  s: number; cx: number; cy: number;
  id: Int32Array; depth: Float32Array; flags: Uint8Array; dir: Uint8Array; bright: Float32Array; tex: Float32Array; accent: Float32Array; therm: Float32Array;
  heat: Float32Array; tmp: Float32Array;
}
const INNER = 1, INSIDE = 2, GLINT = 4, FAN = 8, LINE = 16;

function build(w: number, h: number, fit?: TowerFit): Grid {
  let cw = w < 600 ? 4 : 5.4, ch = w < 600 ? 6.6 : 9;
  const n = (w / cw) * (h / ch);
  if (n > MAX_CELLS) { const k = Math.sqrt(n / MAX_CELLS); cw *= k; ch *= k; }
  const st = stage(w, h, fit);
  const tw = Math.min(w, st.cx + st.s * TURN.x1) - Math.max(0, st.cx + st.s * TURN.x0);
  const th = Math.min(h, st.cy - st.s * TURN.y0) - Math.max(0, st.cy - st.s * TURN.y1);
  const over = (tw * th) / (cw * ch);
  if (over > TOWER_CELLS) { const k = Math.sqrt(over / TOWER_CELLS); cw *= k; ch *= k; }
  const cols = Math.max(1, Math.ceil(w / cw)), rows = Math.max(1, Math.ceil(h / ch));
  const size = cols * rows;
  return {
    w, h, cols, rows, cw, ch, ...st,
    id: new Int32Array(size).fill(-1), depth: new Float32Array(size), flags: new Uint8Array(size), dir: new Uint8Array(size),
    bright: new Float32Array(size), tex: new Float32Array(size), accent: new Float32Array(size), therm: new Float32Array(size),
    heat: new Float32Array(size), tmp: new Float32Array(size),
  };
}

// A texture writes how dense the glyph is, how much it lights up, and the axis of any stroke it draws.
const TX = { d: 1, a: 0, l: -1 };
const line = (v: number, step: number, width: number) => Math.abs(fract(v / step + 0.5) - 0.5) * step < width;
const stroke = (axis: number, a: number) => { TX.l = axis; TX.a = a; };

function texture(t: Tex | undefined, axis: number, p: V3) {
  TX.d = 1; TX.a = 0; TX.l = -1;
  switch (t) {
    case "side":
      if (axis !== 0 || p[0] < 0) return;
      if (Math.abs(Math.abs(p[2]) - (D - 0.1)) < 0.018 && Math.abs(p[1]) < H - 0.1) stroke(1, 0.15);
      else if (Math.abs(Math.abs(p[1]) - (H - 0.1)) < 0.022 && Math.abs(p[2]) < D - 0.1) stroke(2, 0.15);
      return;
    case "grille":
      if (axis === 1 && Math.abs(p[0]) < 0.26 && Math.abs(p[2]) < 0.6) { if (line(p[2], 0.1, 0.022)) stroke(0, 0.2); else TX.d = 0.3; }
      return;
    case "back":
      if (axis !== 2) return;
      if (p[0] > -0.32 && p[0] < 0.1 && p[1] > -0.56 && p[1] < 0.02) { if (line(p[1], 0.09, 0.02)) stroke(0, 0.1); else TX.d = 0.3; }
      else if (Math.abs(Math.hypot(p[0] + 0.05, p[1] + 0.8) - 0.1) < 0.02) TX.d = 1.6;
      return;
    case "board":
      if (axis !== 0) return;
      TX.d = 0.6;
      if (line(p[1], 0.2, 0.022) && fract(p[2] * 2.2 + Math.floor(p[1] * 5 + 0.5) * 0.41) < 0.55) stroke(2, 0.6);
      else if (line(p[2], 0.18, 0.02) && fract(p[1] * 1.9 + Math.floor(p[2] * 5.5 + 0.5) * 0.53) < 0.5) stroke(1, 0.6);
      return;
    case "fins":
      if (axis === 1) TX.d = 1.1;
      else if (line(p[1], 0.09, 0.022)) stroke(axis === 0 ? 2 : 0, 0.5);
      else TX.d = 0.3;
      return;
    case "cap": TX.d = 1.3; TX.a = 0.8; return;
    case "ram": TX.d = axis === 0 ? 1.1 : line(p[1], 0.11, 0.025) ? 0.35 : 1.05; return;
    case "shroud":
      if (axis !== 1 && p[1] > -0.24 && p[1] < -0.2) stroke(axis === 0 ? 2 : 0, 1);
      return;
    case "plate":
      if (axis === 1 && Math.abs(p[0] + 0.15) < 0.025) stroke(2, 0.7); else TX.d = 0.9;
      return;
    case "vent":
      if (axis === 1 && Math.abs(p[0]) < 0.3 && p[2] > 0.08 && p[2] < 0.42) { if (line(p[0], 0.09, 0.02)) stroke(2, 0.1); else TX.d = 0.3; }
      else if (axis === 0 && p[1] > -0.8 && p[1] < -0.76 && p[2] > -0.55 && p[2] < 0.25) stroke(2, 0.7);
      return;
  }
}

const CORNERS: V3[][] = PARTS.map((q) => {
  if (q.kind === "fan") return [-1, 1].flatMap((a) => [-1, 1].map((b): V3 => [q.c[0] + a * q.half, q.c[1] + b * q.half, q.c[2]]));
  const out: V3[] = [];
  for (const x of [q.lo[0], q.hi[0]]) for (const y of [q.lo[1], q.hi[1]]) for (const z of [q.lo[2], q.hi[2]]) out.push([x, y, z]);
  return out;
});
const RECT = new Int32Array(PARTS.length * 4);

/** Picks the edge glyph whose slant matches a 3D direction seen on screen. */
function slant(cam: Camera, x: number, y: number, z: number) {
  const sx = x * cam.r[0] + z * cam.r[2], sy = x * cam.u[0] + y * cam.u[1] + z * cam.u[2];
  const a = fract(Math.atan2(sy, sx) / Math.PI);
  return a < 0.13 || a > 0.87 ? 0 : a < 0.37 ? 1 : a < 0.63 ? 2 : 3;
}

/** Casts one ray per cell over the tower's screen box and keeps the nearest surface. */
function trace(gd: Grid, cam: Camera, spin: number) {
  const { cols, rows, cw, ch, s, cx, cy, id, depth, flags, dir, bright, tex, accent, therm } = gd;
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
    let best = Infinity, hit = -1, face = 0, axis = 1, glass = Infinity, fx = 0, fy = 0;

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
        // The glass is clear inside a thin frame.
        if (q.glass && ax === 0) {
          const gy = o[1] + dy * near, gz = o[2] + dz * near;
          if (Math.abs(gy) < H - RIM && Math.abs(gz) < D - RIM) { if (near < glass) glass = near; continue; }
        }
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
        best = tt; hit = i; axis = 2; face = 6; fx = px; fy = py;
      }
    }
    const i = row * cols + col;
    if (hit < 0) {
      if (dy >= 0) continue;
      const tt = (FLOOR_Y - o[1]) * iy, gx = o[0] + dx * tt, gz = o[2] + dz * tt, fr = Math.hypot(gx, gz) / FLOOR_R;
      if (fr > 1) continue;
      const tick = fr > 0.86 && Math.abs(fract((Math.atan2(gz, gx) / (Math.PI * 2)) * 24) - 0.5) > 0.44;
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
    let fl = 0;
    if (q.kind === "fan") {
      const rr = Math.hypot(fx, fy) / q.r;
      const blade = Math.cos(q.blades * (Math.atan2(fy, fx) - spin * q.speed) + 3.2 * rr) > 0.2;
      bright[i] = Math.max(0.75, lam);
      // A fan's density is set outright: solid blades brightening to the tips, open gaps, a hot hub.
      fl |= FAN;
      tex[i] = rr > 1 ? 0.2 : rr < 0.22 ? 1 : blade ? 0.55 + 0.4 * rr : 0;
      accent[i] = rr < 0.22 ? 1 : blade ? 0.2 + 0.6 * rr : 0;
      if (rr < 0.22) heat += 0.25;
      const ex = q.half - Math.abs(fx), ey = q.half - Math.abs(fy);
      dir[i] = Math.min(ex, ey) < q.half * 0.1 ? slant(cam, ex < ey ? 0 : 1, ex < ey ? 1 : 0, 0) : slant(cam, -fy, fx, 0);
    } else {
      bright[i] = (q.inner ? 0.3 + 0.7 * lam : 0.14 + 0.86 * lam) * q.albedo;
      texture(q.tex, axis, p);
      tex[i] = TX.d; accent[i] = TX.a;
      if (TX.l >= 0) fl |= LINE;
      if (q.inner) fl |= INNER;
      else if (glass < best) fl |= INSIDE;
      // The edge glyph follows whichever edge of this face is closest.
      const t1 = axis === 0 ? 1 : 0, t2 = axis === 2 ? 1 : 2;
      const d1 = Math.min(p[t1] - q.lo[t1], q.hi[t1] - p[t1]), d2 = Math.min(p[t2] - q.lo[t2], q.hi[t2] - p[t2]);
      let along = d1 < d2 ? t2 : t1, near = Math.min(d1, d2), tx = 0, ty = 0, round = false;
      if (q.holes && axis === 2) for (const [x, y, rr] of q.holes) {
        const hx = p[0] - x, hy = p[1] - y, gap = Math.abs(Math.hypot(hx, hy) - rr);
        if (gap < near) { near = gap; tx = -hy; ty = hx; round = true; }
      }
      if (q.glass) { const gy = Math.abs(H - RIM - Math.abs(p[1])), gz = Math.abs(D - RIM - Math.abs(p[2])); if (Math.min(gy, gz) < near) along = gy < gz ? 2 : 1; }
      if (TX.l >= 0) { along = TX.l; round = false; }
      dir[i] = round ? slant(cam, tx, ty, 0) : slant(cam, along === 0 ? 1 : 0, along === 1 ? 1 : 0, along === 2 ? 1 : 0);
    }
    // A pane of glass catches two soft streaks that stay put as the case turns.
    if (glass < best) {
      const g = fract((col * cw * 0.55 + row * ch) / (s * 1.1));
      if (g < 0.05 || (g > 0.11 && g < 0.13)) fl |= GLINT;
    }
    flags[i] = fl;
    therm[i] = clamp(heat);
  }
}

/** A five-cell soft blur along one axis: stride 1 runs along rows, stride cols down columns. */
function blur(src: Float32Array, dst: Float32Array, cols: number, rows: number, stride: number) {
  const n = cols * rows, len = stride === 1 ? cols : rows;
  for (let i = 0; i < n; i++) {
    const at = stride === 1 ? i % cols : Math.floor(i / cols);
    let sum = 3 * src[i], wt = 3;
    for (let k = 1; k <= 2; k++) {
      const w = 3 - k;
      if (at - k >= 0) { sum += w * src[i - k * stride]; wt += w; }
      if (at + k < len) { sum += w * src[i + k * stride]; wt += w; }
    }
    dst[i] = sum / wt;
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
  const [bg, grey, expected, good, look, light] = readColors(el, ["--graphite", "--text-3", "--expected", "--good", "--look", "--text"]);
  const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  // The tokens are soft for text on light pages; on graphite the art pushes them further from grey.
  const vivid = (c: number[], k: number) => { const m = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((v) => Math.round(clamp(m + (v - m) * k, 0, 255))); };
  const brass = vivid(good, 1.9), coral = vivid(look, 1.3);
  // Cool parts sit in warm grey, working parts in brass, the hottest in coral.
  const stops: [number, number[]][] = [
    [0, mix(bg, grey, 0.75)], [0.28, vivid(expected, 1.4)], [0.5, brass], [0.66, mix(brass, coral, 0.45)], [0.82, coral], [1, mix(coral, light, 0.18)],
  ];
  const rgb: number[][] = [];
  for (let l = 0; l < LEVELS; l++) {
    const t = l / (LEVELS - 1);
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < t) k++;
    const [t0, c0] = stops[k - 1], [t1, c1] = stops[k];
    rgb.push(mix(c0, c1, clamp((t - t0) / (t1 - t0))));
  }
  // Shades run from a face turned away from the light to a lit edge catching it.
  const shaded: string[] = [];
  for (const c of rgb) for (const k of [0.3, 0.5, 0.74, 1, -0.42]) shaded.push(`rgb(${(k < 0 ? mix(c, light, -k) : mix(bg, c, k)).join(",")})`);
  return { bg: `rgb(${bg.join(",")})`, rgb, shaded };
}

function atlas(cw: number, ch: number, dpr: number, colors: string[]) {
  const a = document.createElement("canvas");
  const sw = Math.ceil(cw * dpr), sh = Math.ceil(ch * dpr);
  a.width = sw * GLYPHS.length;
  a.height = sh * colors.length;
  const g = a.getContext("2d");
  if (!g) return null;
  g.textAlign = "center";
  g.textBaseline = "middle";
  colors.forEach((col, l) => {
    g.fillStyle = col;
    for (let k = 1; k < GLYPHS.length; k++) {
      g.font = `${k >= EDGE ? 700 : 600} ${Math.round(ch * (k >= EDGE ? 1.02 : 0.95) * dpr)}px ${MONO}`;
      g.fillText(GLYPHS[k], k * sw + sw / 2, l * sh + sh / 2);
    }
  });
  return { canvas: a, sw, sh };
}

/** The turning tower. Children are drawn over it and can place themselves around it with the --tower-* box it sets. */
export function AsciiField({ fit, children }: { fit?: TowerFit; children?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;
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
    let glow: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; img: ImageData; v: Float32Array; w: Float32Array } | null = null;
    let pointer: { x: number; y: number; inside: boolean } | null = null;
    const pulses: { x: number; y: number; age: number }[] = [];

    const resize = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      grid = build(r.width, r.height, fitRef.current);
      const { s, cx, cy } = grid;
      el.style.setProperty("--tower-l", `${Math.round(cx + s * TURN.x0)}px`);
      el.style.setProperty("--tower-r", `${Math.round(r.width - cx - s * TURN.x1)}px`);
      el.style.setProperty("--tower-t", `${Math.round(cy - s * TURN.y1)}px`);
      el.style.setProperty("--tower-b", `${Math.round(r.height - cy + s * TURN.y0)}px`);
      colors = palette(el);
      sprites = atlas(grid.cw, grid.ch, dpr, colors.shaded);
      const gc = document.createElement("canvas");
      gc.width = grid.cols; gc.height = grid.rows;
      const gg = gc.getContext("2d");
      glow = gg ? { canvas: gc, g: gg, img: gg.createImageData(grid.cols, grid.rows), v: new Float32Array(grid.cols * grid.rows), w: new Float32Array(grid.cols * grid.rows) } : null;
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
      const { cols, rows, cw, ch, id, depth, flags, dir, bright, tex, accent, therm, heat } = grid;
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
        const px = glow.img.data, v = glow.v, w = glow.w;
        // Only the warm parts and the pointer glow, so cool metal stays crisp on graphite.
        for (let i = 0; i < cols * rows; i++) v[i] = clamp(((id[i] >= 0 ? therm[i] : 0) + heat[i] - 0.55) * 2.4);
        blur(v, w, cols, rows, 1); blur(w, v, cols, rows, cols);
        for (let i = 0; i < cols * rows; i++) {
          const k = v[i], c = colors.rgb[Math.round((0.5 + k * 0.5) * (LEVELS - 1))];
          px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = Math.min(255, k * 115);
        }
        glow.g.putImageData(glow.img, 0, 0);
        g.imageSmoothingEnabled = true;
        g.drawImage(glow.canvas, 0, 0, cols, rows, 0, 0, cols * cw * dpr, rows * ch * dpr);
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, me = id[i], hp = heat[i];
        let glyph: number, col: number, shade = SHADES - 2;
        if (me >= 0) {
          const edge = (c > 0 && owns(i, i - 1)) || (c < cols - 1 && owns(i, i + 1)) || (r > 0 && owns(i, i - cols)) || (r < rows - 1 && owns(i, i + cols));
          const b = bright[i], hb = therm[i], fl = flags[i], ac = accent[i];
          if (fl & LINE && !edge && !(fl & INSIDE)) {
            glyph = EDGE + dir[i];
            col = hb + ac * 0.3 + hp;
            shade = ac > 0.4 ? 4 : b > 0.4 ? 3 : 2;
          } else if (edge) {
            // Edges lead: the case outline in brass, parts inside in their own heat.
            glyph = EDGE + dir[i];
            col = (fl & INNER ? hb + 0.08 : Math.max(hb, 0.5)) + hp;
            shade = b > 0.5 ? 4 : b > 0.25 ? 3 : 2;
            if (fl & INSIDE) { shade = 1; col = hb; }
          } else {
            const shimmer = hb > 0.7 ? (hb - 0.7) * 0.2 * Math.sin(c * 0.55 + t * 1.4) * Math.sin(r * 0.8 - t * 1.1) : 0;
            // The case's inner walls stay dark so the parts inside stand clear of them; the outer skin keeps a light grain.
            const base = fl & FAN ? tex[i] : fl & INSIDE ? 0.05 * tex[i] : fl & INNER ? (0.06 + 0.3 * b) * tex[i] : (0.13 + 0.16 * b) * tex[i];
            const dens = base + hp * 0.7 + shimmer;
            glyph = Math.round(clamp(dens) * (RAMP.length - 1) - 0.2);
            // The outer skin is colored by the light, so lit faces turn brass and the far ones stay grey.
            col = (fl & (INNER | INSIDE | FAN) ? hb : hb + 0.32 * b) + ac * 0.22 + hp;
            shade = ac > 0.5 ? 4 : Math.min(3, Math.round(b * 3 + ac));
          }
          if (fl & GLINT) { shade = Math.min(4, shade + 1); if (glyph <= 0) { glyph = 1; shade = 1; col = 0.3; } }
        } else if (me === -2) {
          glyph = Math.round(clamp(bright[i] + hp * 0.6) * (RAMP.length - 1) - 0.15); col = therm[i] + hp; shade = 1;
        } else {
          glyph = Math.round(clamp(hp * 0.9) * (RAMP.length - 1) - 0.15); col = hp;
        }
        if (glyph <= 0) continue;
        const l = Math.round(clamp(col) * (LEVELS - 1)) * SHADES + shade;
        g.drawImage(a, glyph * sw, l * sh, sw, sh, Math.round(c * cw * dpr), Math.round(r * ch * dpr), sw, sh);
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
      {children}
      <span className="ascii-temp num" ref={readout} />
    </div>
  );
}
