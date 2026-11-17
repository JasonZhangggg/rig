import { useEffect, useRef } from "react";

/* A PC drawn in characters, read like a thermal camera: denser glyphs and the
   data colors mean hotter. The pointer is a heat source that spreads and cools. */

const RAMP = " .:-=+*#%@";
const LEVELS = 16;
const MAX_CELLS = 14000;
// Characters read fine at 30 frames a second, and it halves the drawing.
const FRAME_MS = 1000 / 30 - 2;
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';
const MIN_C = 24;
const SPAN_C = 66;

type Fan = { x: number; y: number; r: number; blades: number; speed: number; rim: number };
type Region<T> = { def: T; cells: Int32Array };

interface Grid {
  w: number; h: number; cols: number; rows: number; cw: number; ch: number;
  shape: Float32Array; live: Float32Array; base: Float32Array; heat: Float32Array; tmp: Float32Array;
  fans: Region<Fan>[];
}

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

/** Where the case sits: on wide bands it moves right, so the copy keeps the left. */
function caseBox(w: number, h: number) {
  if (w / h > 1.6) {
    const ch = h * 0.8, cw = ch * 0.84;
    return { x: w - cw - Math.max(24, w * 0.06), y: (h - ch) / 2, w: cw, h: ch };
  }
  const top = 88, avail = Math.max(160, h - top - 220);
  let ch = avail * 0.96, cw = ch * 0.84;
  if (cw > w * 0.72) { cw = w * 0.72; ch = cw / 0.84; }
  return { x: (w - cw) / 2, y: top + (avail - ch) / 2, w: cw, h: ch };
}

function build(w: number, h: number): Grid {
  let cw = w < 600 ? 4.5 : 6, ch = w < 600 ? 7.5 : 10;
  const n = (w / cw) * (h / ch);
  if (n > MAX_CELLS) { const k = Math.sqrt(n / MAX_CELLS); cw *= k; ch *= k; }
  const cols = Math.max(1, Math.ceil(w / cw)), rows = Math.max(1, Math.ceil(h / ch));
  const size = cols * rows;
  const shape = new Float32Array(size), base = new Float32Array(size);
  const b = caseBox(w, h);
  const X = (u: number) => b.x + u * b.w, Y = (v: number) => b.y + v * b.h;

  const put = (i: number, v: number) => { if (v > shape[i]) shape[i] = v; };
  const each = (f: (i: number, px: number, py: number) => void) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) f(r * cols + c, (c + 0.5) * cw, (r + 0.5) * ch);
  };
  const rect = (u0: number, v0: number, u1: number, v1: number, edge: number, fill = 0, pattern?: (c: number, r: number) => number) => {
    const c0 = Math.round(X(u0) / cw - 0.5), c1 = Math.round(X(u1) / cw - 0.5), r0 = Math.round(Y(v0) / ch - 0.5), r1 = Math.round(Y(v1) / ch - 0.5);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++)
      put(r * cols + c, c === c0 || c === c1 || r === r0 || r === r1 ? edge : pattern ? pattern(c, r) : fill);
  };
  const curve = (pts: number[], v: number) => {
    const [ax, ay, cx, cy, bx, by] = pts.map((p, k) => (k % 2 ? Y(p) : X(p)));
    const steps = 160;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, m = 1 - t;
      const px = m * m * ax + 2 * m * t * cx + t * t * bx, py = m * m * ay + 2 * m * t * cy + t * t * by;
      const c = Math.floor(px / cw), r = Math.floor(py / ch);
      if (c >= 0 && c < cols && r >= 0 && r < rows) put(r * cols + c, v);
    }
  };
  const warm = (u: number, v: number, amp: number, sx: number, sy = sx) => {
    const x = X(u), y = Y(v), kx = 1 / (2 * (sx * b.w) ** 2), ky = 1 / (2 * (sy * b.w) ** 2);
    each((i, px, py) => { base[i] += amp * Math.exp(-((px - x) ** 2) * kx - (py - y) ** 2 * ky); });
  };

  rect(0, 0, 1, 1, 0.55);
  rect(0.1, 1.015, 0.2, 1.015, 0.5);
  rect(0.8, 1.015, 0.9, 1.015, 0.5);
  rect(0.38, 0.05, 0.95, 0.56, 0.3);
  rect(0.49, 0.075, 0.6, 0.105, 0.42, 0.32);
  for (let k = 0; k < 4; k++) rect(0.865 + k * 0.024, 0.13, 0.875 + k * 0.024, 0.42, 0.46, 0.46);
  rect(0.24, 0.6, 0.94, 0.75, 0.46);
  rect(0.02, 0.81, 0.98, 0.81, 0.36);
  rect(0.05, 0.85, 0.55, 0.96, 0.44, 0, (c) => (c % 3 ? 0 : 0.22));
  curve([0.52, 0.86, 0.99, 0.8, 0.95, 0.45], 0.26);
  curve([0.22, 0.82, 0.26, 0.04, 0.49, 0.09], 0.24);
  curve([0.42, 0.82, 0.44, 0.55, 0.68, 0.6], 0.26);

  warm(0.63, 0.28, 0.95, 0.13);
  warm(0.58, 0.675, 0.72, 0.22, 0.07);
  warm(0.3, 0.9, 0.34, 0.16, 0.06);
  warm(0.87, 0.27, 0.24, 0.06, 0.16);
  warm(0.54, 0.09, 0.3, 0.07, 0.04);
  warm(0.12, 0.4, 0.1, 0.06, 0.3);

  const cellsIn = (x0: number, y0: number, x1: number, y1: number) => {
    const out: number[] = [];
    for (let r = Math.max(0, Math.floor(y0 / ch)); r <= Math.min(rows - 1, Math.floor(y1 / ch)); r++)
      for (let c = Math.max(0, Math.floor(x0 / cw)); c <= Math.min(cols - 1, Math.floor(x1 / cw)); c++) out.push(r * cols + c);
    return Int32Array.from(out);
  };
  const fan = (u: number, v: number, rr: number, blades: number, speed: number): Region<Fan> => {
    const def = { x: X(u), y: Y(v), r: rr * b.w, blades, speed, rim: ch * 0.55 };
    const e = def.r + def.rim;
    return { def, cells: cellsIn(def.x - e, def.y - e, def.x + e, def.y + e) };
  };
  const fans = [
    fan(0.63, 0.28, 0.18, 7, 0.8),
    fan(0.12, 0.17, 0.075, 7, 1.1), fan(0.12, 0.4, 0.075, 7, 1.15), fan(0.12, 0.63, 0.075, 7, 1.05),
    fan(0.42, 0.675, 0.06, 9, -1.6), fan(0.76, 0.675, 0.06, 9, -1.5),
  ];
  return { w, h, cols, rows, cw, ch, shape, live: new Float32Array(size), base, heat: new Float32Array(size), tmp: new Float32Array(size), fans };
}

function fanAt(f: Fan, px: number, py: number, t: number) {
  const dx = px - f.x, dy = py - f.y, dist = Math.sqrt(dx * dx + dy * dy), d = dist / f.r;
  if (dist > f.r + f.rim) return -1;
  if (dist > f.r - f.rim) return 0.5;
  if (d < 0.22) return d < 0.12 ? 0.8 : 0.58;
  const blade = Math.cos(f.blades * (Math.atan2(dy, dx) - t * f.speed) + 2.4 * d);
  return blade > 0.5 ? 0.42 + 0.3 * blade : blade > 0 ? 0.2 : 0.001;
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
  const [bg, grey, ...data] = readColors(el, ["--graphite", "--text-3", "--look", "--good", "--expected"]);
  const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const light = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // Hotter reads lighter on graphite, whichever color set is on.
  const [a, b, c] = data.sort((x, y) => light(x) - light(y));
  const stops: [number, number[]][] = [[0, mix(bg, grey, 0.55)], [0.35, a], [0.68, b], [1, c]];
  const rgb: number[][] = [];
  for (let l = 0; l < LEVELS; l++) {
    const t = l / (LEVELS - 1);
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < t) k++;
    const [t0, c0] = stops[k - 1], [t1, c1] = stops[k];
    rgb.push(mix(c0, c1, clamp((t - t0) / (t1 - t0))));
  }
  return { bg: `rgb(${bg.join(",")})`, rgb, levels: rgb.map((c) => `rgb(${c.join(",")})`) };
}

function atlas(cw: number, ch: number, dpr: number, levels: string[]) {
  const a = document.createElement("canvas");
  const sw = Math.ceil(cw * dpr), sh = Math.ceil(ch * dpr);
  a.width = sw * RAMP.length;
  a.height = sh * levels.length;
  const g = a.getContext("2d");
  if (!g) return null;
  g.font = `600 ${Math.round(ch * 0.95 * dpr)}px ${MONO}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  levels.forEach((col, l) => {
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
      sprites = atlas(grid.cw, grid.ch, dpr, colors.levels);
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
      const { cols, rows, cw, ch, base, heat } = grid;
      const c0 = Math.floor(x / cw), r0 = Math.floor(y / ch);
      let sum = 0, n = 0;
      for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        sum += clamp(base[r * cols + c] * 0.9 + heat[r * cols + c]); n++;
      }
      return n ? sum / n : 0;
    };

    const step = (dt: number) => {
      if (!grid) return;
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
      const { cols, rows, cw, ch, shape, live, base, heat, fans } = grid;
      const { canvas: a, sw, sh } = sprites;
      const t = still ? 0 : clock;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = colors.bg;
      g.fillRect(0, 0, cv.width, cv.height);
      live.set(shape);
      for (const { def, cells } of fans) for (const i of cells) {
        const v = fanAt(def, ((i % cols) + 0.5) * cw, (Math.floor(i / cols) + 0.5) * ch, t);
        if (v >= 0) live[i] = v;
      }
      if (glow) {
        const px = glow.img.data;
        for (let i = 0; i < cols * rows; i++) {
          const v = clamp(base[i] * 0.8 + heat[i]), c = colors.rgb[Math.round(v * (LEVELS - 1))];
          px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = v * v * 110;
        }
        glow.g.putImageData(glow.img, 0, 0);
        g.imageSmoothingEnabled = true;
        g.drawImage(glow.canvas, 0, 0, cols, rows, 0, 0, cols * cw * dpr, rows * ch * dpr);
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, s = live[i], hb = base[i], hp = heat[i];
        const shimmer = hb > 0.06 ? hb * 0.1 * Math.sin(c * 0.55 + t * 1.4) * Math.sin(r * 0.8 - t * 1.1) : 0;
        const dens = clamp(s + hb * (s > 0 ? 0.16 : 0.4) + hp * 0.95 + shimmer);
        const k = Math.round(dens * (RAMP.length - 1) - 0.15);
        if (k <= 0) continue;
        const col = clamp(hb * (s > 0 ? 0.85 : 0.55) + hp);
        const l = Math.round(col * (LEVELS - 1));
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
      if (pointer?.inside && grid && !still) {
        const dx = p.x - pointer.x, dy = p.y - pointer.y, dist = Math.hypot(dx, dy), stepPx = Math.max(grid.cw, grid.ch);
        for (let s = 1; s <= Math.min(30, Math.floor(dist / stepPx)); s++) addHeat(pointer.x + (dx * s * stepPx) / dist, pointer.y + (dy * s * stepPx) / dist, 0.16, stepPx * 1.4);
      }
      pointer = { ...p, inside: true };
      out.style.transform = `translate(${Math.round(p.x + 14)}px, ${Math.round(p.y - 30)}px)`;
      if (still) stillFrame();
    };
    const onLeave = () => { if (pointer) pointer.inside = false; leftAt = clock; if (still) stillFrame(); };
    const onDown = (e: PointerEvent) => {
      onMove(e);
      if (still || !grid) return;
      const p = local(e);
      addHeat(p.x, p.y, 0.7, Math.max(grid.cw, grid.ch) * 2.6);
      pulses.push({ ...p, age: 0 });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
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
