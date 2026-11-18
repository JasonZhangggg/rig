// The Home dashboard as data: which widgets show, where each sits on the grid, and how each looks.
// Stored per account on this device, parsed defensively so an old or broken copy never breaks Home.
import { verticalCompactor } from "react-grid-layout/core";

export const LAYOUT_VERSION = 2;

export type Kind = "pc" | "health" | "todo" | "asks" | "temps" | "fans" | "evenings" | "storage" | "live" | "parts";
export type SizeName = "s" | "m" | "l" | "wide" | "tall" | "full";
export type Tone = "light" | "dark";
export type Frame = "tile" | "open";
export type Density = "comfortable" | "compact";
export type Spacing = "tight" | "normal" | "roomy";
export type Corners = "round" | "soft" | "square";
export type OptValue = boolean | string | string[];
/** The two grids: 12 columns on a wide screen, 8 on a narrow one. Phones get one column in a list. */
export type Bp = "lg" | "md";

export const COLS: Record<Bp, number> = { lg: 12, md: 8 };

/** Where a widget sits, in grid cells. `i` is the widget's id. */
export interface Cell { i: string; x: number; y: number; w: number; h: number }

export interface Widget {
  id: string;
  kind: Kind;
  tone: Tone;
  frame: Frame;
  style: string;
  hidden: boolean;
  opts: Record<string, OptValue>;
}

export interface Dashboard {
  v: typeof LAYOUT_VERSION;
  widgets: Widget[];
  /** Each grid's own arrangement. A grid with none follows the wide one. */
  layouts: Partial<Record<Bp, Cell[]>>;
  /** The phone's order, once the person changes it there. */
  phone?: string[];
  density: Density;
  spacing: Spacing;
  corners: Corners;
}

/** A list the person picks from on the page, filled from the PC (its fans, its readings). Stored as the labels left out. */
export type Source = "fans" | "stats" | "parts";

export type OptionDef =
  | { key: string; label: string; type: "toggle"; value: boolean }
  | { key: string; label: string; type: "choice"; value: string; choices: [string, string][] }
  | { key: string; label: string; type: "set"; value: string[]; source: Source };

export interface KindMeta {
  title: string;
  /** One line for the Add widget library. */
  blurb: string;
  /** Columns and rows of the 12 column grid for each preset size. */
  sizes: Partial<Record<SizeName, [number, number]>>;
  size: SizeName;
  /** The smallest and largest the tile may be dragged to, in 12 column cells. */
  min: [number, number];
  max: [number, number];
  styles: [string, string][];
  tone: Tone;
  frame: Frame;
  hidden?: boolean;
  /** Draws a 3D scene, which is costly to resize: it keeps its size while dragged and snaps to a new size rather than animating. */
  heavy?: boolean;
  options: OptionDef[];
}

export const SIZE_LABEL: Record<SizeName, string> = { s: "Small", m: "Medium", l: "Large", wide: "Wide", tall: "Tall", full: "Full width" };

const days: [string, string][] = [["7", "7 days"], ["5", "5 days"], ["3", "3 days"]];

export const KINDS: Record<Kind, KindMeta> = {
  pc: {
    title: "Your PC", blurb: "The PC in 3D with its parts and live temperatures.",
    sizes: { m: [6, 6], l: [8, 8], wide: [12, 6], full: [12, 9] }, size: "l", min: [5, 5], max: [12, 10],
    styles: [["showcase", "Big figures"], ["chips", "Chips"]], tone: "light", frame: "open", heavy: true,
    options: [
      { key: "reads", label: "Show temperatures", type: "toggle", value: true },
      { key: "specs", label: "Show part names", type: "toggle", value: true },
      { key: "views", label: "Show heat and exploded buttons", type: "toggle", value: true },
      { key: "spin", label: "Turn slowly", type: "toggle", value: true },
    ],
  },
  health: {
    title: "Health", blurb: "One score for how the PC is doing, and why.",
    sizes: { s: [3, 2], m: [4, 2], wide: [6, 2], tall: [4, 4], l: [6, 4] }, size: "m", min: [3, 2], max: [8, 5],
    styles: [["ring", "Ring"], ["number", "Big number"], ["compact", "Compact"]], tone: "light", frame: "tile",
    options: [
      { key: "summary", label: "Show the summary", type: "toggle", value: true },
      { key: "breakdown", label: "Show what the score is made of", type: "toggle", value: false },
      { key: "link", label: "Show the history link", type: "toggle", value: true },
    ],
  },
  todo: {
    title: "Things to look at", blurb: "What needs a look, the most pressing first.",
    sizes: { m: [4, 4], tall: [4, 6], l: [6, 5], wide: [8, 4], full: [12, 4] }, size: "tall", min: [3, 3], max: [12, 9],
    styles: [["list", "List"], ["cards", "Cards"], ["compact", "Compact"]], tone: "light", frame: "open",
    options: [
      { key: "worth", label: "Include things worth knowing", type: "toggle", value: true },
      { key: "count", label: "Show the count", type: "toggle", value: true },
      { key: "foot", label: "Show the checkup link", type: "toggle", value: true },
    ],
  },
  temps: {
    title: "Temperatures", blurb: "Each day's idle, busy and peak temperatures.",
    sizes: { s: [4, 3], m: [5, 5], l: [7, 5], full: [12, 5] }, size: "l", min: [3, 3], max: [12, 7],
    styles: [["caps", "Capsules"], ["rows", "Range rows"], ["big", "Big numbers"]], tone: "light", frame: "tile",
    options: [
      { key: "days", label: "Days", type: "choice", value: "7", choices: days },
      { key: "idle", label: "Show idle", type: "toggle", value: true },
      { key: "typical", label: "Show busy", type: "toggle", value: true },
      { key: "peak", label: "Show peak", type: "toggle", value: true },
      { key: "figure", label: "Show the hottest", type: "toggle", value: true },
      { key: "legend", label: "Show the key", type: "toggle", value: true },
    ],
  },
  fans: {
    title: "Fans", blurb: "How hard the fans work now and over the last days.",
    sizes: { s: [3, 3], m: [5, 5], l: [7, 5], full: [12, 5] }, size: "m", min: [3, 3], max: [12, 7],
    styles: [["dots", "Dot grid"], ["bars", "Bars"], ["rings", "Rings"]], tone: "light", frame: "tile",
    options: [
      { key: "span", label: "History", type: "choice", value: "4", choices: [["2", "2 days"], ["4", "4 days"], ["7", "7 days"]] },
      { key: "live", label: "Show live speeds", type: "toggle", value: true },
      { key: "legend", label: "Show the key", type: "toggle", value: true },
      { key: "off", label: "Fans to show", type: "set", value: [], source: "fans" },
    ],
  },
  evenings: {
    title: "Evenings", blurb: "What ran after 6 PM each day, game by game.",
    sizes: { s: [4, 3], m: [6, 6], l: [8, 6], full: [12, 6] }, size: "l", min: [4, 3], max: [12, 8],
    styles: [["pills", "Pills with initials"], ["thin", "Thin bars"]], tone: "light", frame: "open",
    options: [
      { key: "days", label: "Days", type: "choice", value: "7", choices: days },
      { key: "background", label: "Show background tasks", type: "toggle", value: true },
      { key: "total", label: "Show the total", type: "toggle", value: true },
      { key: "legend", label: "Show the key", type: "toggle", value: true },
    ],
  },
  asks: {
    title: "Ask Rig", blurb: "Questions to start a chat with one tap.",
    sizes: { s: [3, 3], m: [4, 3], wide: [8, 2], tall: [4, 5] }, size: "m", min: [3, 2], max: [12, 6],
    styles: [["rows", "Rows"], ["chips", "Chips"]], tone: "light", frame: "open",
    options: [
      { key: "count", label: "Questions", type: "choice", value: "3", choices: [["3", "Three"], ["5", "Five"]] },
      { key: "box", label: "Show a box to type in", type: "toggle", value: false },
    ],
  },
  storage: {
    title: "Storage", blurb: "How full the drives are.",
    sizes: { s: [3, 3], m: [4, 3], wide: [6, 3], tall: [4, 5] }, size: "m", min: [3, 2], max: [8, 6],
    styles: [["bar", "Bar"], ["ring", "Ring"], ["number", "Big number"]], tone: "light", frame: "tile",
    options: [{ key: "list", label: "Show each drive", type: "toggle", value: true }],
  },
  live: {
    title: "Right now", blurb: "Live temperatures, memory and space at a glance.",
    sizes: { s: [3, 3], m: [4, 3], wide: [8, 2], full: [12, 2] }, size: "wide", min: [3, 2], max: [12, 4],
    styles: [["tiles", "Figures"], ["meters", "Meters"], ["list", "List"]], tone: "dark", frame: "tile", hidden: true,
    options: [
      { key: "notes", label: "Show notes", type: "toggle", value: true },
      { key: "off", label: "Readings to show", type: "set", value: [], source: "stats" },
    ],
  },
  parts: {
    title: "Parts", blurb: "Every part Rig found, by kind.",
    sizes: { m: [4, 4], tall: [4, 6], wide: [8, 3] }, size: "wide", min: [4, 3], max: [12, 7],
    styles: [["list", "List"], ["grid", "Grid"]], tone: "light", frame: "tile", hidden: true,
    options: [
      { key: "temps", label: "Show temperatures", type: "toggle", value: true },
      { key: "off", label: "Parts to show", type: "set", value: [], source: "parts" },
    ],
  },
};

/** Default order: the PC leads, then what needs attention, then the week, then the rest. Storage, a card, sits above Ask Rig, whose short list then ends the column instead of leaving a gap above the card. */
export const KIND_ORDER: Kind[] = ["pc", "health", "todo", "temps", "fans", "evenings", "storage", "asks", "live", "parts"];

const isKind = (k: unknown): k is Kind => typeof k === "string" && k in KINDS;
export const kindOf = (i: string): Kind => (isKind(i) ? i : "storage");

// ----- Grid geometry -----

/** A 12 column width in a grid of `cols` columns. */
export function spanFor(w: number, cols: number) {
  if (cols >= 12) return Math.min(w, cols);
  if (cols <= 1) return 1;
  return Math.min(cols, Math.max(2, Math.round((w * cols) / 12)));
}

/** The smallest and largest a widget may be in a grid of `cols` columns. */
export function limits(kind: Kind, cols: number) {
  const { min, max } = KINDS[kind];
  const scale = (w: number) => (cols >= 12 ? w : Math.min(cols, Math.max(2, Math.ceil((w * cols) / 12))));
  return { minW: Math.min(scale(min[0]), cols), maxW: Math.min(scale(max[0]), cols), minH: min[1], maxH: max[1] };
}

/** A preset size as cells of a grid of `cols` columns. */
export function presetCells(kind: Kind, size: SizeName, cols: number): [number, number] {
  const [w, h] = KINDS[kind].sizes[size] ?? KINDS[kind].sizes[KINDS[kind].size]!;
  return [spanFor(w, cols), h];
}

/** The preset a box matches exactly, if any. */
export function presetOf(kind: Kind, w: number, h: number, cols: number): SizeName | null {
  for (const name of Object.keys(KINDS[kind].sizes) as SizeName[]) {
    const [pw, ph] = presetCells(kind, name, cols);
    if (pw === w && ph === h) return name;
  }
  return null;
}

/** The preset nearest a box, so a widget picks its compact or full content at any size. */
export function nearestSize(kind: Kind, w: number, h: number, cols: number): SizeName {
  let best = KINDS[kind].size, d = Infinity;
  for (const name of Object.keys(KINDS[kind].sizes) as SizeName[]) {
    const [pw, ph] = presetCells(kind, name, cols);
    const dd = (pw - w) ** 2 + (ph - h) ** 2;
    if (dd < d) { d = dd; best = name; }
  }
  return best;
}

/** Rows a widget needs for its full content: its shortest preset above Small. Fewer rows get the compact content. */
export function fullRows(kind: Kind) {
  return Math.min(...Object.entries(KINDS[kind].sizes).filter(([name]) => name !== "s").map(([, wh]) => wh[1]));
}

/** How a size reads aloud and in the options: the preset's name, or its cells. */
export function sizeLabel(kind: Kind, w: number, h: number, cols: number) {
  const p = presetOf(kind, w, h, cols);
  return p ? SIZE_LABEL[p] : `${w} by ${h}`;
}

const overlaps = (a: Cell, b: Cell) => a.i !== b.i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const hitsAny = (c: Cell, list: readonly Cell[]) => list.some((o) => overlaps(c, o));
const byRow = (a: Cell, b: Cell) => a.y - b.y || a.x - b.x;
const clone = (cells: readonly Cell[]) => cells.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));

/** Widget ids top to bottom, left to right: the reading order and the order a phone shows. */
export const orderOf = (cells: readonly Cell[]) => [...cells].sort(byRow).map((c) => c.i);

/** Puts each item in the first free slot, top to bottom, left to right, around any cells already taken. */
export function place(items: readonly { i: string; w: number; h: number }[], cols: number, taken: readonly Cell[] = []): Cell[] {
  const out: Cell[] = [];
  const all = [...taken];
  for (const it of items) {
    const w = Math.min(it.w, cols);
    for (let y = 0, done = false; !done; y++) {
      for (let x = 0; x + w <= cols; x++) {
        const c = { i: it.i, x, y, w, h: it.h };
        if (hitsAny(c, all)) continue;
        out.push(c); all.push(c); done = true;
        break;
      }
    }
  }
  return out;
}

/** Everything as high as it will go, using the grid library's own vertical compaction. */
export function compactUp(cells: readonly Cell[], cols: number): Cell[] {
  return clone(verticalCompactor.compact(clone(cells), cols) as Cell[]);
}

/** Empty cells with a widget somewhere below them, plus a lighter cost for a ragged bottom edge. */
export function holes(cells: Iterable<Cell>, cols: number) {
  const bottom = Array<number>(cols).fill(0), filled = Array<number>(cols).fill(0);
  for (const b of cells) for (let c = b.x; c < b.x + b.w && c < cols; c++) { bottom[c] = Math.max(bottom[c], b.y + b.h); filled[c] += b.h; }
  const end = Math.max(0, ...bottom);
  return bottom.reduce((n, bt, c) => n + (bt - filled[c]) + (end - bt) * 0.25, 0);
}

/** Which cells are taken, as a flat array of rows. */
function occupancy(cells: readonly Cell[], cols: number) {
  const rows = cells.reduce((n, c) => Math.max(n, c.y + c.h), 0);
  const grid = new Uint8Array(rows * cols);
  const bottom = new Int32Array(cols);
  for (const c of cells) {
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) grid[y * cols + x] = 1;
    for (let x = c.x; x < c.x + c.w; x++) bottom[x] = Math.max(bottom[x], c.y + c.h);
  }
  return { busy: (x: number, y: number) => y >= rows || y < 0 ? y < 0 : grid[y * cols + x] === 1, hole: (x: number, y: number) => y >= 0 && y < bottom[x] && grid[y * cols + x] === 0 };
}

/** Lets neighbours grow into any hole beside, above or below them, so a dashboard never has gaps in the middle. */
export function fillHoles(cells: readonly Cell[], cols: number, keep: ReadonlySet<string> = new Set()): Cell[] {
  const out = clone(cells).sort(byRow);
  for (let guard = 0; guard < 200; guard++) {
    const { busy, hole } = occupancy(out, cols);
    const column = (x: number, y0: number, h: number) => { let any = false; for (let y = y0; y < y0 + h; y++) { if (busy(x, y)) return false; any ||= hole(x, y); } return any; };
    const row = (y: number, x0: number, w: number) => { if (y < 0) return false; let any = false; for (let x = x0; x < x0 + w; x++) { if (busy(x, y)) return false; any ||= hole(x, y); } return any; };
    let grew = false;
    for (const b of out) {
      if (keep.has(b.i)) continue;
      const lim = limits(kindOf(b.i), cols);
      if (b.w < lim.maxW && b.x + b.w < cols && column(b.x + b.w, b.y, b.h)) { b.w++; grew = true; break; }
      if (b.w < lim.maxW && b.x > 0 && column(b.x - 1, b.y, b.h)) { b.x--; b.w++; grew = true; break; }
      if (b.h < lim.maxH && row(b.y + b.h, b.x, b.w)) { b.h++; grew = true; break; }
      if (b.h < lim.maxH && row(b.y - 1, b.x, b.w)) { b.y--; b.h++; grew = true; break; }
    }
    if (!grew) break;
  }
  return out;
}

/** Compacts upward, fills what's left, compacts again. `keep` are the tiles the person just set; they never change size. */
export const settle = (cells: readonly Cell[], cols: number, keep: ReadonlySet<string> = new Set()) => compactUp(fillHoles(compactUp(cells, cols), cols, keep), cols);

/** Keeps a box inside the grid and inside its widget's limits. */
export function clampCell(c: Cell, cols: number): Cell {
  const lim = limits(kindOf(c.i), cols);
  const w = Math.max(lim.minW, Math.min(lim.maxW, Math.round(c.w)));
  const h = Math.max(lim.minH, Math.min(lim.maxH, Math.round(c.h)));
  return { i: c.i, w, h, x: Math.max(0, Math.min(cols - w, Math.round(c.x))), y: Math.max(0, Math.round(c.y)) };
}

/**
 * The cell a dragged tile is over, from where it is in cells (fractions and all), kept inside the grid for a tile `maxX`
 * cells from the right edge. It only moves on once the tile is `slack` of a cell past the halfway line, so a pointer
 * resting on a line, or a hand that shakes there, never flips the drop spot back and forth.
 */
export function stickyCell(prev: { x: number; y: number }, fx: number, fy: number, maxX: number, slack = 0.2) {
  const x = Math.max(0, Math.min(maxX, fx)), y = Math.max(0, fy);
  return {
    x: Math.abs(x - prev.x) > 0.5 + slack ? Math.round(x) : prev.x,
    y: Math.abs(y - prev.y) > 0.5 + slack ? Math.round(y) : prev.y,
  };
}

const lowest = (c: Cell, placed: readonly Cell[]) => { const t = { ...c, y: 0 }; while (hitsAny(t, placed)) t.y++; return t.y; };

/**
 * The others around tiles that stay put, each as high as it will go in its own columns. One that would be pushed
 * down slides sideways instead when that keeps it higher, so two tiles side by side trade places.
 */
function packAround(base: readonly Cell[], pinned: readonly Cell[], cols: number): Cell[] {
  const ids = new Set(pinned.map((p) => p.i));
  const out = clone(pinned);
  for (const o of [...base].filter((c) => !ids.has(c.i)).sort(byRow)) {
    let best = { ...o, y: lowest(o, out) };
    if (best.y > o.y) {
      for (let x = 0; x + o.w <= cols; x++) {
        if (x === o.x) continue;
        const y = lowest({ ...o, x }, out);
        if (y < best.y || (y === best.y && Math.abs(x - o.x) < Math.abs(best.x - o.x))) best = { ...o, x, y };
      }
    }
    out.push(best);
  }
  return compactUp(out, cols);
}

const reshape = (a: readonly Cell[], b: readonly Cell[], skip: string) => {
  let n = 0, moved = 0;
  for (const c of b) {
    const o = a.find((x) => x.i === c.i);
    if (!o || c.i === skip) continue;
    n += Math.abs(o.w - c.w) + Math.abs(o.h - c.h);
    // A big tile jumping away is far more jarring than a small one, so how far each moves counts by its area.
    moved += (Math.abs(o.x - c.x) + Math.abs(o.y - c.y)) * o.w * o.h;
  }
  return n * 0.6 + moved * 0.006;
};

/**
 * Where everything goes while `id` is dragged to cell (x, y) of a layout that was `base` when the drag began.
 * Worked out from `base` every time, so dragging back undoes what dragging over did. The dragged tile may take
 * a narrower or wider size when that closes a gap; neighbours may grow into gaps beside them.
 */
export function dragFlow(base: readonly Cell[], id: string, x: number, y: number, cols: number, adapt = !KINDS[kindOf(id)].heavy): Cell[] {
  const me = base.find((c) => c.i === id);
  if (!me) return clone(base);
  const lim = limits(kindOf(id), cols);
  const keep = new Set([id]);
  let best: Cell[] = clone(base), cost = Infinity;
  const widths = adapt ? Array.from({ length: lim.maxW - lim.minW + 1 }, (_, k) => lim.minW + k) : [me.w];
  // A tile twice the size or more under the pointer, below its top row, is a wall: besides shoving it, try sitting beside it or just below it.
  const wallsAt = (cx: number, w: number) => base.filter((o) => o.i !== id && o.w * o.h >= 2 * w * me.h && y > o.y && overlaps(o, { i: id, x: cx, y, w, h: me.h }));
  for (const w of widths) {
    const near = [x, x + me.w - w, x + Math.round((me.w - w) / 2)];
    const xs = new Set([...near, ...wallsAt(x, w).flatMap((o) => [o.x + o.w, o.x - w])].map((v) => Math.max(0, Math.min(cols - w, v))));
    for (const cx of xs) {
      const ys = new Set([y, ...wallsAt(cx, w).map((o) => o.y + o.h)]);
      for (const cy of ys) {
        const trial = settle(packAround(base, [{ i: id, x: cx, y: cy, w, h: me.h }], cols), cols, keep);
        const c = holes(trial, cols) + Math.abs(w - me.w) * 1.1 + (cx - x) ** 2 * 0.15 + Math.abs(cy - y) * 0.6 + reshape(base, trial, id);
        if (c < cost - 1e-6) { cost = c; best = trial; }
      }
    }
  }
  return best;
}

/**
 * Where everything goes while `id` is resized to w by h. A neighbour on its right gives way or takes up the room,
 * tiles of the same height beside it can follow its height, and whatever needs the fewest gaps wins.
 */
export function resizeFlow(base: readonly Cell[], id: string, w: number, h: number, cols: number): Cell[] {
  const me = base.find((c) => c.i === id);
  if (!me) return clone(base);
  const r = clampCell({ ...me, w, h }, cols);
  const keep = new Set([id]);
  const follow = base.flatMap((o) => {
    if (o.i === id || o.x !== me.x + me.w || !(o.y < me.y + me.h && me.y < o.y + o.h)) return [];
    const nx = r.x + r.w, nw = o.x + o.w - nx, lim = limits(kindOf(o.i), cols);
    return nw >= lim.minW && nw <= lim.maxW ? [{ ...o, x: nx, w: nw }] : [];
  });
  const mates = (list: Cell[]) => base.flatMap((o) => {
    if (o.i === id || o.y !== me.y || o.h !== me.h || r.h === me.h) return [];
    const lim = limits(kindOf(o.i), cols);
    return r.h >= lim.minH && r.h <= lim.maxH ? [{ ...(list.find((c) => c.i === o.i) ?? o), h: r.h }] : [];
  });
  const variants = [[], follow, mates([]), [...follow.filter((f) => !mates(follow).some((m) => m.i === f.i)), ...mates(follow)]];
  // Room a narrower tile gives up, with no neighbour beside it to take it, goes to any tile that fits there, so no gap is left.
  const from = r.x + r.w;
  const free = base.reduce((end, o) => (o.i !== id && o.x >= from && o.y < r.y + r.h && r.y < o.y + o.h ? Math.min(end, o.x) : end), cols) - from;
  if (free > 0 && r.w < me.w) {
    for (const o of base) {
      const lim = limits(kindOf(o.i), cols);
      if (o.i === id || KINDS[kindOf(o.i)].heavy || free < lim.minW) continue;
      variants.push([{ i: o.i, x: from, y: r.y, w: Math.min(free, lim.maxW), h: Math.max(lim.minH, Math.min(lim.maxH, r.h)) }]);
    }
  }
  let best: Cell[] = clone(base), cost = Infinity;
  for (const v of variants) {
    const pinned = [r, ...v];
    if (pinned.some((a) => pinned.some((b) => overlaps(a, b)))) continue;
    const trial = settle(packAround(base, pinned, cols), cols, keep);
    const c = holes(trial, cols) + reshape(base, trial, id) * 0.5;
    if (c < cost - 1e-6) { cost = c; best = trial; }
  }
  return best;
}

/** Puts `id` into the first gap it fits, or at the bottom, at its default size. */
export function addCell(cells: readonly Cell[], id: string, cols: number): Cell[] {
  const [w, h] = presetCells(kindOf(id), KINDS[kindOf(id)].size, cols);
  const rest = cells.filter((c) => c.i !== id);
  const [c] = place([{ i: id, w, h }], cols, rest);
  return settle([...rest, c], cols, new Set([id]));
}

export type Dir = "left" | "right" | "up" | "down";

/** The cell a tile moves to from the keyboard: one step, or past the tile in the way. Null at an edge. */
export function stepTarget(cells: readonly Cell[], id: string, dir: Dir, cols: number): { x: number; y: number } | null {
  const me = cells.find((c) => c.i === id);
  if (!me) return null;
  const others = cells.filter((c) => c.i !== id);
  const rowsMeet = (o: Cell) => o.y < me.y + me.h && me.y < o.y + o.h;
  const colsMeet = (o: Cell) => o.x < me.x + me.w && me.x < o.x + o.w;
  if (dir === "left" || dir === "right") {
    const nx = me.x + (dir === "left" ? -1 : 1);
    if (nx < 0 || nx + me.w > cols) return null;
    if (!hitsAny({ ...me, x: nx }, others)) return { x: nx, y: me.y };
    const side = others.filter((o) => rowsMeet(o) && (dir === "left" ? o.x + o.w <= me.x : o.x >= me.x + me.w)).sort((a, b) => (dir === "left" ? b.x - a.x : a.x - b.x))[0];
    if (!side) return null;
    return { x: dir === "left" ? side.x : Math.min(cols - me.w, side.x + side.w - me.w), y: me.y };
  }
  if (dir === "up") {
    const above = others.filter((o) => colsMeet(o) && o.y + o.h <= me.y).sort((a, b) => b.y + b.h - (a.y + a.h))[0];
    return above ? { x: me.x, y: above.y } : null;
  }
  const below = others.filter((o) => colsMeet(o) && o.y >= me.y + me.h).sort((a, b) => a.y - b.y)[0];
  return below ? { x: me.x, y: Math.max(me.y + 1, below.y + below.h - me.h) } : null;
}

// ----- Defaults, reading and writing -----

export function defaultOpts(kind: Kind): Record<string, OptValue> {
  return Object.fromEntries(KINDS[kind].options.map((o) => [o.key, Array.isArray(o.value) ? [...o.value] : o.value]));
}

export function defaultWidget(kind: Kind): Widget {
  const m = KINDS[kind];
  return { id: kind, kind, tone: m.tone, frame: m.frame, style: m.styles[0][0], hidden: !!m.hidden, opts: defaultOpts(kind) };
}

/** Lays widgets out in order at the given sizes, packed with no gaps. */
export function packOrder(items: readonly { i: string; size?: SizeName }[], cols: number): Cell[] {
  return settle(place(items.map((it) => { const k = kindOf(it.i); const [w, h] = presetCells(k, it.size ?? KINDS[k].size, cols); return { i: it.i, w, h }; }), cols), cols);
}

export function defaultDashboard(): Dashboard {
  const widgets = KIND_ORDER.map(defaultWidget);
  return { v: LAYOUT_VERSION, widgets, layouts: { lg: packOrder(widgets.filter((w) => !w.hidden).map((w) => ({ i: w.id })), 12) }, density: "comfortable", spacing: "normal", corners: "round" };
}

/** A grid's cells for the widgets that show: its own if it has them, or the wide grid's order at this grid's width. */
export function cellsFor(d: Dashboard, bp: Bp): Cell[] {
  const own = d.layouts[bp];
  if (own) return own;
  const lg = d.layouts.lg ?? [];
  if (bp === "lg") return lg;
  const cols = COLS[bp];
  return settle(place(orderOf(lg).map((i) => {
    const c = lg.find((x) => x.i === i)!;
    return { i, w: Math.max(limits(kindOf(i), cols).minW, spanFor(c.w, cols)), h: c.h };
  }), cols), cols);
}

/** The phone's order: its own once changed, otherwise the wide grid's reading order. */
export function phoneOrder(d: Dashboard): string[] {
  const shown = d.widgets.filter((w) => !w.hidden).map((w) => w.id);
  const base = d.phone ?? orderOf(d.layouts.lg ?? []);
  return [...base.filter((i) => shown.includes(i)), ...shown.filter((i) => !base.includes(i))];
}

/** Keeps the stored grids in step with which widgets show: hidden ones leave and the gap closes, shown ones get a place. */
export function syncLayouts(d: Dashboard): Dashboard {
  const shown = d.widgets.filter((w) => !w.hidden).map((w) => w.id);
  const layouts: Partial<Record<Bp, Cell[]>> = {};
  for (const bp of Object.keys(d.layouts) as Bp[]) {
    const cols = COLS[bp], all = d.layouts[bp] ?? [];
    let cells = all.filter((c) => shown.includes(c.i));
    if (cells.length !== all.length) cells = settle(cells, cols);
    for (const i of shown) if (!cells.some((c) => c.i === i)) cells = addCell(cells, i, cols);
    layouts[bp] = cells;
  }
  const phone = d.phone?.filter((i) => shown.includes(i));
  return { ...d, layouts, ...(phone ? { phone: [...phone, ...shown.filter((i) => !phone.includes(i))] } : {}) };
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

function parseOpts(kind: Kind, raw: unknown): Record<string, OptValue> {
  const out = defaultOpts(kind);
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const o of KINDS[kind].options) {
    const v = r[o.key];
    if (o.type === "toggle" && typeof v === "boolean") out[o.key] = v;
    else if (o.type === "choice" && o.choices.some(([c]) => c === v)) out[o.key] = v as string;
    else if (o.type === "set" && Array.isArray(v)) out[o.key] = v.filter((x): x is string => typeof x === "string");
  }
  return out;
}

function parseWidget(raw: unknown): (Widget & { size: SizeName }) | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isKind(r.kind)) return null;
  const m = KINDS[r.kind];
  const base = defaultWidget(r.kind);
  return {
    ...base,
    size: pick(r.size, Object.keys(m.sizes) as SizeName[], m.size),
    tone: pick(r.tone, ["light", "dark"] as const, base.tone),
    frame: pick(r.frame, ["tile", "open"] as const, base.frame),
    style: pick(r.style, m.styles.map(([s]) => s), base.style),
    hidden: typeof r.hidden === "boolean" ? r.hidden : base.hidden,
    opts: parseOpts(r.kind, r.opts),
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One grid's stored cells, each kept inside the grid and its limits, overlaps pushed apart, gaps closed. */
function parseCells(raw: unknown, shown: readonly string[], cols: number): Cell[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const cells: Cell[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const { i, x, y, w, h } = c as Record<string, unknown>;
    if (typeof i !== "string" || !shown.includes(i) || seen.has(i) || !finite(x) || !finite(y) || !finite(w) || !finite(h)) continue;
    seen.add(i);
    cells.push(clampCell({ i, x, y: Math.min(y, 500), w, h }, cols));
  }
  if (!cells.length) return undefined;
  // Overlaps resolve in reading order: a cell that lands on one already kept moves down until it's clear.
  const kept: Cell[] = [];
  for (const c of cells.sort(byRow)) { const t = { ...c }; while (hitsAny(t, kept)) t.y++; kept.push(t); }
  return settle(kept, cols);
}

/**
 * Reads a stored dashboard. Unknown kinds drop out, kinds added since are appended, and bad values fall back to defaults.
 * A first version copy (an ordered list with a size each) is laid out on the grid in that order, at those sizes.
 */
export function parseDashboard(text: string | null): Dashboard {
  const fallback = defaultDashboard();
  if (!text) return fallback;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fallback; }
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  if (r.v !== LAYOUT_VERSION && r.v !== 1) return fallback;
  const seen = new Set<Kind>();
  const parsed: (Widget & { size: SizeName })[] = [];
  for (const w of Array.isArray(r.widgets) ? r.widgets : []) {
    const p = parseWidget(w);
    if (p && !seen.has(p.kind)) { seen.add(p.kind); parsed.push(p); }
  }
  for (const k of KIND_ORDER) if (!seen.has(k)) parsed.push({ ...defaultWidget(k), size: KINDS[k].size });
  const shown = parsed.filter((w) => !w.hidden).map((w) => w.id);
  const layouts: Partial<Record<Bp, Cell[]>> = {};
  let phone: string[] | undefined;
  if (r.v === 1) {
    layouts.lg = packOrder(parsed.filter((w) => !w.hidden).map((w) => ({ i: w.id, size: w.size })), 12);
  } else {
    const rl = r.layouts && typeof r.layouts === "object" ? (r.layouts as Record<string, unknown>) : {};
    for (const bp of ["lg", "md"] as Bp[]) { const cells = parseCells(rl[bp], shown, COLS[bp]); if (cells) layouts[bp] = cells; }
    layouts.lg ??= packOrder(shown.map((i) => ({ i })), 12);
    if (Array.isArray(r.phone)) phone = r.phone.filter((i): i is string => typeof i === "string" && shown.includes(i));
  }
  const widgets: Widget[] = parsed.map(({ size: _size, ...w }) => w);
  return syncLayouts({
    v: LAYOUT_VERSION, widgets, layouts, ...(phone ? { phone } : {}),
    density: pick(r.density, ["comfortable", "compact"] as const, fallback.density),
    spacing: pick(r.spacing, ["tight", "normal", "roomy"] as const, fallback.spacing),
    corners: pick(r.corners, ["round", "soft", "square"] as const, fallback.corners),
  });
}

export const serialize = (d: Dashboard) => JSON.stringify(d);

export const update = (widgets: readonly Widget[], id: string, patch: Partial<Widget>) => widgets.map((w) => (w.id === id ? { ...w, ...patch } : w));
