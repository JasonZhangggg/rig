// The Home dashboard as data: which widgets show, where each sits on the grid, and how each looks.
// Stored per account on this device, parsed defensively so an old or broken copy never breaks Home.
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

/**
 * Where a widget sits, in grid cells. `i` is the widget's id. `cw` and `ch` are the size the person chose, kept only
 * while the grid shows the tile at another size to close a gap.
 */
export interface Cell { i: string; x: number; y: number; w: number; h: number; cw?: number; ch?: number }

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
const clone = (cells: readonly Cell[]) => cells.map((c) => ({ ...c }));
/** Cells in the order of `like`, so a layout that ends up where it started is equal to it. */
const inOrder = (cells: readonly Cell[], like: readonly Cell[]) => {
  const at = new Map(like.map((c, k) => [c.i, k]));
  return [...cells].sort((a, b) => (at.get(a.i) ?? 1e9) - (at.get(b.i) ?? 1e9));
};

/** Widget ids top to bottom, left to right: the reading order and the order a phone shows. */
export const orderOf = (cells: readonly Cell[]) => [...cells].sort(byRow).map((c) => c.i);

/** How far past the size the person chose the grid may stretch a tile to close a gap, in cells each way: about one preset size. */
export const STEP = 2;

/** The size the person chose for a tile. The grid shows it up to STEP larger when that closes a gap, or smaller when squeezed. */
export const chosenOf = (c: Cell) => ({ w: c.cw ?? c.w, h: c.ch ?? c.h });

/** A tile at a size the grid picked, still remembering the size the person chose. */
function sized(c: Cell, w: number, h: number, x = c.x, y = c.y): Cell {
  const want = chosenOf(c);
  const out: Cell = { i: c.i, x, y, w, h };
  if (want.w !== w) out.cw = want.w;
  if (want.h !== h) out.ch = want.h;
  return out;
}

/** The largest the grid may stretch a tile: one step past the size the person chose, and never past its limits. */
function reach(c: Cell, cols: number) {
  const lim = limits(kindOf(c.i), cols), want = chosenOf(c);
  return { w: Math.min(lim.maxW, want.w + STEP), h: Math.min(lim.maxH, want.h + STEP) };
}

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

/** Everything as high as it will go, in reading order, the way the grid library compacts. Cells keep the order they came in. */
export function compactUp(cells: readonly Cell[], cols: number): Cell[] {
  const out = clone(cells);
  const done: Cell[] = [];
  for (const c of [...out].sort(byRow)) {
    c.w = Math.max(1, Math.min(c.w, cols));
    c.x = Math.max(0, Math.min(cols - c.w, c.x));
    c.y = Math.max(0, Math.min(c.y, done.reduce((m, o) => Math.max(m, o.y + o.h), 0)));
    while (c.y > 0 && !hitsAny({ ...c, y: c.y - 1 }, done)) c.y--;
    for (let hit = done.find((o) => overlaps(c, o)); hit; hit = done.find((o) => overlaps(c, o))) c.y = hit.y + hit.h;
    done.push(c);
  }
  return out;
}

/** Which cells are taken, and how far down each column reaches. */
function occupancy(cells: readonly Cell[], cols: number) {
  const rows = cells.reduce((n, c) => Math.max(n, c.y + c.h), 0);
  const taken = new Uint8Array(rows * cols), bottom = new Int32Array(cols);
  for (const c of cells) {
    for (let x = Math.max(0, c.x); x < Math.min(cols, c.x + c.w); x++) {
      bottom[x] = Math.max(bottom[x], c.y + c.h);
      for (let y = Math.max(0, c.y); y < c.y + c.h; y++) taken[y * cols + x] = 1;
    }
  }
  return { rows, bottom, busy: (x: number, y: number) => x < 0 || x >= cols || y < 0 || (y < rows && taken[y * cols + x] === 1) };
}

/** How far down tiles start: an open cell above the last tile's top row is a gap; below it, it's just the ragged end of the page. */
const lastTop = (cells: readonly Cell[]) => cells.reduce((n, c) => Math.max(n, c.y), 0);

/** Open cells the dashboard never keeps: any above the top row of its last tile, inside the grid or at its sides. */
export function gapsIn(cells: readonly Cell[], cols: number) {
  const { busy } = occupancy(cells, cols), end = lastTop(cells);
  let n = 0;
  for (let y = 0; y < end; y++) for (let x = 0; x < cols; x++) if (!busy(x, y)) n++;
  return n;
}

/** Gaps, plus a lighter cost for a ragged bottom edge. */
export function holes(cells: readonly Cell[], cols: number) {
  const { bottom } = occupancy(cells, cols);
  const end = Math.max(0, ...bottom);
  return gapsIn(cells, cols) + bottom.reduce((n, b) => n + (end - b) * 0.25, 0);
}

/**
 * What the grid holds steady while it lays tiles down. `fixed` tiles keep their size. `lead` is the tile the person is
 * moving: it takes the spot it's over as soon as the rows above that spot are full, ahead of whatever was there.
 */
export interface Hold { fixed?: ReadonlySet<string>; lead?: string }
const none: ReadonlySet<string> = new Set();

// What each kind of change costs when the grid picks how to fill an open stretch. Sliding sideways is far more jarring
// than rising into room above, a tile squeezed narrower loses more than one stretched a little wider, and a tile that
// jumps ahead of others waiting above it reads as the layout shuffling.
const COST = { side: 1, rise: 0.15, sink: 0.25, jump: 1, stretch: 0.8, squeeze: 2, fill: 0.5 };

/** A layout half laid down: how far down each column is full, the tiles placed, and the tiles still to place. */
interface Laying { sky: number[]; out: Cell[]; rest: Cell[] }

/** The ways to fill the lowest open stretch of a half laid layout, cheapest first. */
function movesFor(st: Laying, cols: number, rank: ReadonlyMap<string, number>, hold: Hold, loose: boolean): { cost: number; next: Laying }[] {
  const { fixed = none, lead } = hold;
  const { sky, out, rest } = st;
  const f = Math.min(...sky), a = sky.indexOf(f);
  let b = a;
  while (b < cols && sky[b] === f) b++;
  const room = b - a;
  // How narrow a tile may go: a step under the size chosen, or when nothing else works, as narrow as its limits allow.
  const minW = (c: Cell) => (fixed.has(c.i) ? c.w : Math.max(limits(kindOf(c.i), cols).minW, loose ? 0 : Math.min(c.w, chosenOf(c).w - STEP)));
  const moves: { cost: number; next: Laying }[] = [];
  const raise = (s: number[], c: Cell) => { for (let x = c.x; x < c.x + c.w; x++) s[x] = Math.max(s[x], c.y + c.h); };

  rest.forEach((c, k) => {
    const others = rest.filter((_, j) => j !== k);
    const least = others.length ? Math.min(...others.map(minW)) : 0;
    const lo = minW(c), most = fixed.has(c.i) ? c.w : reach(c, cols).w;
    const ahead = rest.reduce((n, o) => n + (rank.get(o.i)! < rank.get(c.i)! ? 1 : 0), 0);
    const near = c.i === lead && f >= c.y && c.x < b && a < c.x + c.w;
    for (const w of new Set(fixed.has(c.i) ? [c.w] : [Math.min(c.w, room), Math.min(room, most)])) {
      if (w > room || w < lo) continue;
      // The spot the held tile claims: under the pointer, or flush with the stretch's end when that would leave a sliver.
      let spot = Math.max(a, Math.min(b - w, c.x));
      if (spot > a && spot - a < least) spot = a;
      else if (b - spot - w > 0 && b - spot - w < least) spot = b - w;
      for (const x of new Set([a, b - w, Math.max(a, Math.min(b - w, c.x))])) {
        const left = x - a, right = b - x - w;
        if ((left && left < least) || (right && right < least)) continue;
        // The held tile takes only the spot nearest the pointer. A tile twice its size or more still waiting there is a wall
        // when the pointer is below its top row or barely over its edge: the held tile goes beside or below it instead.
        const wall = (o: Cell) => o.w * o.h >= 2 * c.w * c.h && overlaps(o, { i: c.i, x, y: f, w, h: c.h })
          && (o.y < c.y || 2 * (Math.min(x + w, o.x + o.w) - Math.max(x, o.x)) < w);
        const claims = near && w <= c.w && x === spot && !others.some(wall);
        const resize = w === c.w ? 0 : w > c.w ? (w - c.w) * COST.stretch * (c.i === lead ? 0.5 : 1) : (c.w - w) * COST.squeeze;
        const shift = Math.abs(c.x - x) * COST.side;
        const cost = claims ? -100 + resize + shift
          : resize + shift + (c.y > f ? (c.y - f) * COST.rise : (f - c.y) * COST.sink) + (c.i === lead ? 0 : ahead * COST.jump) + rank.get(c.i)! * 1e-3;
        const t = sized(c, w, c.h, x, f), s = [...sky];
        raise(s, t);
        moves.push({ cost, next: { sky: s, out: [...out, t], rest: others } });
      }
    }
  });

  // A tile already on this row beside the stretch widens into it.
  for (const o of out) {
    if (o.y !== f || fixed.has(o.i) || o.w + room > reach(o, cols).w || (o.x + o.w !== a && o.x !== b)) continue;
    const t = sized(o, o.w + room, o.h, o.x === b ? a : o.x), s = [...sky];
    raise(s, t);
    moves.push({ cost: room * o.h * COST.fill, next: { sky: s, out: out.map((p) => (p === o ? t : p)), rest } });
  }
  // The tiles under the stretch grow down to meet the taller columns on both sides.
  const up = Math.min(a > 0 ? sky[a - 1] : Infinity, b < cols ? sky[b] : Infinity);
  const floor = out.filter((o) => o.y + o.h === f && o.x < b && a < o.x + o.w);
  if (f > 0 && up < Infinity && floor.length && floor.reduce((n, o) => n + o.w, 0) === room
    && floor.every((o) => o.x >= a && o.x + o.w <= b && !fixed.has(o.i) && o.h + up - f <= reach(o, cols).h)) {
    const grown = new Map(floor.map((o) => [o, sized(o, o.w, o.h + up - f)]));
    const s = [...sky];
    for (let x = a; x < b; x++) s[x] = up;
    moves.push({ cost: (up - f) * room * COST.fill, next: { sky: s, out: out.map((p) => grown.get(p) ?? p), rest } });
  }
  return moves.sort((p, q) => p.cost - q.cost);
}

/**
 * Lays tiles down one at a time, always into the lowest open stretch of the grid, so no open cell is ever left above a
 * tile: every gap is closed by construction. The tile that goes there is the one whose wanted spot (its x and y in
 * `cells`) is nearest, at its size or up to a step wider or narrower to share a row; or a neighbour on the same row widens
 * into the stretch, or the tiles under it stretch down to meet their neighbours. The cheapest choice is tried first and a
 * dead end, where nothing can fill a stretch, steps back to the next choice. A layout with no gap comes back as it was.
 */
export function settle(cells: readonly Cell[], cols: number, hold: Hold = {}): Cell[] {
  const queue = [...cells].sort((p, q) => byRow(p, q) || (p.i === hold.lead ? -1 : q.i === hold.lead ? 1 : 0));
  const rank = new Map(queue.map((c, k) => [c.i, k]));
  const start: Laying = { sky: Array<number>(cols).fill(0), out: [], rest: queue.map((c) => ({ ...c, w: Math.min(c.w, cols) })) };
  // The cheapest choice at every stretch nearly always works. When it leads to a stretch nothing can fill, the search
  // allows one other choice somewhere along the way, then two, and of the layouts found at that count keeps the cheapest.
  // Tiles narrow at most a step first; only if that can't close every gap may they go as narrow as their limits allow.
  for (const loose of [false, true]) {
    for (let turns = 0; turns <= 2; turns++) {
      let budget = 2500, found: Laying | null = null, low = Infinity;
      const lay = (st: Laying, spent: number, left: number) => {
        if (!st.rest.length) { if (spent < low) { low = spent; found = st; } return; }
        if (--budget < 0 || spent >= low) return;
        const ms = movesFor(st, cols, rank, hold, loose);
        for (let k = 0; k < Math.min(ms.length, 1 + left); k++) lay(ms[k].next, spent + ms[k].cost, left - k);
      };
      lay(start, 0, turns);
      if (found) return inOrder((found as Laying).out, cells);
    }
  }
  // No way found without a gap: the cheapest choice each time, and where nothing fits, the first tile waiting goes where it fits.
  let st = start;
  while (st.rest.length) {
    const m = movesFor(st, cols, rank, hold, true)[0];
    if (m) { st = m.next; continue; }
    const [c, ...rest] = st.rest;
    const w = Math.min(c.w, cols), x = Math.max(0, Math.min(cols - w, c.x));
    const t = { ...c, w, x, y: Math.max(...st.sky.slice(x, x + w)) }, sky = [...st.sky];
    for (let k = x; k < x + w; k++) sky[k] = t.y + t.h;
    st = { sky, out: [...st.out, t], rest };
  }
  return inOrder(st.out, cells);
}

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
 * Worked out from `base` every time, so dragging back undoes what dragging over did. The dragged tile takes the spot
 * at the size the person chose, narrowing to share a row when it must; the others keep their order around it.
 */
export function dragFlow(base: readonly Cell[], id: string, x: number, y: number, cols: number, adapt = !KINDS[kindOf(id)].heavy): Cell[] {
  const me = base.find((c) => c.i === id);
  if (!me) return clone(base);
  const home = me.x === x && me.y === y;
  const want = chosenOf(me);
  const held: Cell = home || !adapt ? { ...me } : { i: id, x, y, w: want.w, h: want.h };
  held.x = Math.max(0, Math.min(cols - held.w, x));
  held.y = Math.max(0, y);
  // Held over the middle of a tile twice its size or more, it goes to whichever of that tile's sides or its foot is
  // nearest, instead of wherever the rest leave room, which can be the end of the page.
  const wallAt = (x: number, y: number) => {
    const box = { ...held, x, y };
    return base.find((o) => o.i !== id && o.w * o.h >= 2 * held.w * held.h && o.y < y && overlaps(o, box)
      && 2 * (Math.min(x + held.w, o.x + o.w) - Math.max(x, o.x)) >= held.w);
  };
  const wall = wallAt(held.x, held.y);
  if (wall) {
    const spots = [{ x: wall.x - held.w, y: held.y }, { x: wall.x + wall.w, y: held.y }, { x: held.x, y: wall.y + wall.h }]
      .filter((p) => p.x >= 0 && p.x < cols && !wallAt(p.x, p.y));
    const to = spots.sort((p, q) => Math.abs(p.x - held.x) + Math.abs(p.y - held.y) - Math.abs(q.x - held.x) - Math.abs(q.y - held.y))[0];
    if (to) { held.x = to.x; held.y = to.y; }
  }
  return settle(base.map((c) => (c.i === id ? held : c)), cols, { lead: id, fixed: adapt ? none : new Set([id]) });
}

/**
 * Where everything goes while `id` is resized to w by h. Tiles that share its column can follow its width and tiles that
 * share its row its height, the way columns and rows do in a document, and a neighbour on its right can give way or take
 * up the room. Whichever leaves the tile where it is and moves the rest least wins. It always keeps the exact size asked for.
 */
function resizeTo(base: readonly Cell[], id: string, w: number, h: number, cols: number): Cell[] {
  const me = base.find((c) => c.i === id)!;
  const r = clampCell({ ...me, w, h }, cols);
  const meet = (a: Cell, b: Cell) => a.y < b.y + b.h && b.y < a.y + a.h;
  // Neighbours follow only as far as a stretch may take them, and remember the size the person chose for them.
  const fits = (o: Cell, ow: number, oh: number) => { const lim = limits(kindOf(o.i), cols), most = reach(o, cols); return ow >= lim.minW && ow <= most.w && oh >= lim.minH && oh <= most.h; };
  const follow = base.flatMap((o) => {
    if (o.i === id || o.x !== me.x + me.w || !meet(o, me)) return [];
    const nx = r.x + r.w, nw = o.x + o.w - nx;
    return fits(o, nw, o.h) ? [sized(o, nw, o.h, nx)] : [];
  });
  const mates = r.h === me.h ? [] : base.flatMap((o) => (o.i !== id && o.y === me.y && o.h === me.h && fits(o, o.w, r.h) ? [sized(o, o.w, r.h)] : []));
  const stack = r.w === me.w ? [] : base.flatMap((o) => (o.i !== id && o.x === me.x && o.w === me.w && !meet(o, me) && fits(o, r.w, o.h) ? [sized(o, r.w, o.h)] : []));
  const shift = (cs: Cell[]) => cs.map((c) => ({ ...c, x: Math.max(0, me.x + me.w - c.w) }));
  const variants: Cell[][] = [[r], [r, ...follow], [r, ...mates], [r, ...stack], [r, ...follow, ...mates.filter((m) => !follow.some((f) => f.i === m.i))]];
  if (r.w < me.w) variants.push(shift([r]), shift([r, ...stack]));
  let best: Cell[] = clone(base), cost = Infinity;
  for (const v of variants) {
    const trial = settle(base.map((c) => v.find((t) => t.i === c.i) ?? c), cols, { lead: id, fixed: new Set([id]) });
    const got = trial.find((c) => c.i === id)!;
    const c = holes(trial, cols) + gapsIn(trial, cols) * 40 + reshape(base, trial, id) + (Math.abs(got.x - me.x) + Math.abs(got.y - me.y)) * 3;
    if (c < cost - 1e-6) { cost = c; best = trial; }
  }
  return best;
}

/**
 * The resize as asked, or when no layout at that size can be whole (a tile one column short of a row with nothing narrow
 * enough to sit beside it), the nearest size that can, so the tile snaps to a size that fits instead of leaving a gap.
 */
export function resizeFlow(base: readonly Cell[], id: string, w: number, h: number, cols: number): Cell[] {
  const me = base.find((c) => c.i === id);
  if (!me) return clone(base);
  const asked = clampCell({ ...me, w, h }, cols);
  const tries = [[0, 0], [1, 0], [-1, 0], [0, 1], [2, 0], [-2, 0], [1, 1], [-1, 1], [0, -1], [3, 0], [-3, 0]]
    .map(([dw, dh]) => clampCell({ ...asked, w: asked.w + dw, h: asked.h + dh }, cols))
    .filter((c, k, all) => all.findIndex((o) => o.w === c.w && o.h === c.h) === k);
  let first: Cell[] | null = null;
  for (const t of tries) {
    const out = resizeTo(base, id, t.w, t.h, cols);
    if (!gapsIn(out, cols)) return out;
    first ??= out;
  }
  return first!;
}

/** Shows `id` again at its default size, after everything else: at the end of the page, or in a stretch only it fits. */
export function addCell(cells: readonly Cell[], id: string, cols: number): Cell[] {
  const [w, h] = presetCells(kindOf(id), KINDS[kindOf(id)].size, cols);
  const rest = cells.filter((c) => c.i !== id);
  return settle([...rest, { i: id, x: 0, y: rest.reduce((n, c) => Math.max(n, c.y + c.h), 0), w, h }], cols);
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
    const want = chosenOf(lg.find((x) => x.i === i)!);
    return { i, w: Math.max(limits(kindOf(i), cols).minW, spanFor(want.w, cols)), h: want.h };
  }), cols), cols);
}

/**
 * One grid's new arrangement, carried over so the wide and tablet grids never drift apart. A change on the wide grid
 * lets the tablet grid follow it again. A change on the tablet grid is kept there, and the wide grid takes the same
 * order, with a tile resized there at the matching wide size.
 */
export function arrange(d: Dashboard, bp: Bp, cells: Cell[]): Dashboard {
  if (bp === "lg") return { ...d, layouts: { lg: cells } };
  const was = cellsFor(d, "md"), lg = d.layouts.lg ?? [];
  // Each tile wants the same spot, scaled to the wide grid, and keeps its wide size unless it was resized here.
  const wants = cells.map((c) => {
    const now = chosenOf(c), before = was.find((o) => o.i === c.i), wide = lg.find((o) => o.i === c.i);
    const lim = limits(kindOf(c.i), 12);
    const same = (k: "w" | "h") => !!wide && !!before && chosenOf(before)[k] === now[k];
    const w = same("w") ? chosenOf(wide!).w : Math.max(lim.minW, Math.min(lim.maxW, Math.round((now.w * 12) / COLS.md)));
    return { i: c.i, x: Math.min(12 - w, Math.round((c.x * 12) / COLS.md)), y: c.y, w, h: same("h") ? chosenOf(wide!).h : now.h };
  });
  return { ...d, layouts: { lg: settle(wants, 12), md: cells } };
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
  for (const raw1 of raw) {
    if (!raw1 || typeof raw1 !== "object") continue;
    const { i, x, y, w, h, cw, ch } = raw1 as Record<string, unknown>;
    if (typeof i !== "string" || !shown.includes(i) || seen.has(i) || !finite(x) || !finite(y) || !finite(w) || !finite(h)) continue;
    seen.add(i);
    const c = clampCell({ i, x, y: Math.min(y, 500), w, h }, cols);
    // A size the person chose is kept only when it's a real size for this widget and inside its limits.
    const lim = limits(kindOf(i), cols);
    const chosen = (v: unknown, now: number, lo: number, hi: number): v is number => finite(v) && Number.isInteger(v) && v >= lo && v <= hi && v !== now;
    if (chosen(cw, c.w, lim.minW, lim.maxW)) c.cw = cw;
    if (chosen(ch, c.h, lim.minH, lim.maxH)) c.ch = ch;
    cells.push(c);
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
