// The Home dashboard as data: which widgets show, in what order, at what size and in what style.
// Stored per account on this device, parsed defensively so an old or broken copy never breaks Home.

export const LAYOUT_VERSION = 1;

export type Kind = "pc" | "health" | "todo" | "asks" | "temps" | "fans" | "evenings" | "storage" | "live" | "parts";
export type SizeName = "s" | "m" | "l" | "wide" | "tall" | "full";
export type Tone = "light" | "dark";
export type Frame = "tile" | "open";
export type Density = "comfortable" | "compact";
export type Spacing = "tight" | "normal" | "roomy";
export type Corners = "round" | "soft" | "square";
export type OptValue = boolean | string | string[];

export interface Widget {
  id: string;
  kind: Kind;
  size: SizeName;
  tone: Tone;
  frame: Frame;
  style: string;
  hidden: boolean;
  opts: Record<string, OptValue>;
}

export interface Dashboard {
  v: typeof LAYOUT_VERSION;
  widgets: Widget[];
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
  /** Columns and rows of a 12 column grid for each size this kind allows. */
  sizes: Partial<Record<SizeName, [number, number]>>;
  size: SizeName;
  styles: [string, string][];
  tone: Tone;
  frame: Frame;
  hidden?: boolean;
  options: OptionDef[];
}

export const SIZE_LABEL: Record<SizeName, string> = { s: "Small", m: "Medium", l: "Large", wide: "Wide", tall: "Tall", full: "Full width" };

const days: [string, string][] = [["7", "7 days"], ["5", "5 days"], ["3", "3 days"]];

export const KINDS: Record<Kind, KindMeta> = {
  pc: {
    title: "Your PC", blurb: "The PC in 3D with its parts and live temperatures.",
    sizes: { m: [6, 6], l: [8, 8], wide: [12, 6], full: [12, 9] }, size: "l",
    styles: [["showcase", "Big figures"], ["chips", "Chips"]], tone: "light", frame: "open",
    options: [
      { key: "reads", label: "Show temperatures", type: "toggle", value: true },
      { key: "specs", label: "Show part names", type: "toggle", value: true },
      { key: "views", label: "Show heat and exploded buttons", type: "toggle", value: true },
      { key: "spin", label: "Turn slowly", type: "toggle", value: true },
    ],
  },
  health: {
    title: "Health", blurb: "One score for how the PC is doing, and why.",
    sizes: { s: [3, 2], m: [4, 2], wide: [6, 2], tall: [4, 4], l: [6, 4] }, size: "m",
    styles: [["ring", "Ring"], ["number", "Big number"], ["compact", "Compact"]], tone: "light", frame: "tile",
    options: [
      { key: "summary", label: "Show the summary", type: "toggle", value: true },
      { key: "breakdown", label: "Show what the score is made of", type: "toggle", value: false },
      { key: "link", label: "Show the history link", type: "toggle", value: true },
    ],
  },
  todo: {
    title: "Things to look at", blurb: "What needs a look, the most pressing first.",
    sizes: { m: [4, 4], tall: [4, 6], l: [6, 5], wide: [8, 4], full: [12, 4] }, size: "tall",
    styles: [["list", "List"], ["cards", "Cards"], ["compact", "Compact"]], tone: "light", frame: "open",
    options: [
      { key: "worth", label: "Include things worth knowing", type: "toggle", value: true },
      { key: "count", label: "Show the count", type: "toggle", value: true },
      { key: "foot", label: "Show the checkup link", type: "toggle", value: true },
    ],
  },
  temps: {
    title: "Temperatures", blurb: "Each day's idle, busy and peak temperatures.",
    sizes: { s: [4, 3], m: [5, 5], l: [7, 5], full: [12, 5] }, size: "l",
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
    sizes: { s: [3, 3], m: [5, 5], l: [7, 5], full: [12, 5] }, size: "m",
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
    sizes: { s: [4, 3], m: [6, 6], l: [8, 6], full: [12, 6] }, size: "l",
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
    sizes: { s: [3, 3], m: [4, 3], wide: [8, 2], tall: [4, 5] }, size: "m",
    styles: [["rows", "Rows"], ["chips", "Chips"]], tone: "light", frame: "open",
    options: [
      { key: "count", label: "Questions", type: "choice", value: "3", choices: [["3", "Three"], ["5", "Five"]] },
      { key: "box", label: "Show a box to type in", type: "toggle", value: false },
    ],
  },
  storage: {
    title: "Storage", blurb: "How full the drives are.",
    sizes: { s: [3, 3], m: [4, 3], wide: [6, 3], tall: [4, 5] }, size: "m",
    styles: [["bar", "Bar"], ["ring", "Ring"], ["number", "Big number"]], tone: "light", frame: "tile",
    options: [{ key: "list", label: "Show each drive", type: "toggle", value: true }],
  },
  live: {
    title: "Right now", blurb: "Live temperatures, memory and space at a glance.",
    sizes: { s: [3, 3], m: [4, 3], wide: [8, 2], full: [12, 2] }, size: "wide",
    styles: [["tiles", "Figures"], ["meters", "Meters"], ["list", "List"]], tone: "dark", frame: "tile", hidden: true,
    options: [
      { key: "notes", label: "Show notes", type: "toggle", value: true },
      { key: "off", label: "Readings to show", type: "set", value: [], source: "stats" },
    ],
  },
  parts: {
    title: "Parts", blurb: "Every part Rig found, by kind.",
    sizes: { m: [4, 4], tall: [4, 6], wide: [8, 3] }, size: "wide",
    styles: [["list", "List"], ["grid", "Grid"]], tone: "light", frame: "tile", hidden: true,
    options: [
      { key: "temps", label: "Show temperatures", type: "toggle", value: true },
      { key: "off", label: "Parts to show", type: "set", value: [], source: "parts" },
    ],
  },
};

/** Default order: the PC leads, then what needs attention, then the week, then the rest. */
export const KIND_ORDER: Kind[] = ["pc", "health", "todo", "temps", "fans", "evenings", "asks", "storage", "live", "parts"];

const isKind = (k: unknown): k is Kind => typeof k === "string" && k in KINDS;

export function defaultOpts(kind: Kind): Record<string, OptValue> {
  return Object.fromEntries(KINDS[kind].options.map((o) => [o.key, Array.isArray(o.value) ? [...o.value] : o.value]));
}

export function defaultWidget(kind: Kind): Widget {
  const m = KINDS[kind];
  return { id: kind, kind, size: m.size, tone: m.tone, frame: m.frame, style: m.styles[0][0], hidden: !!m.hidden, opts: defaultOpts(kind) };
}

export function defaultDashboard(): Dashboard {
  return { v: LAYOUT_VERSION, widgets: KIND_ORDER.map(defaultWidget), density: "comfortable", spacing: "normal", corners: "round" };
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

function parseWidget(raw: unknown): Widget | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isKind(r.kind)) return null;
  const m = KINDS[r.kind];
  const base = defaultWidget(r.kind);
  return {
    ...base,
    size: pick(r.size, Object.keys(m.sizes) as SizeName[], base.size),
    tone: pick(r.tone, ["light", "dark"] as const, base.tone),
    frame: pick(r.frame, ["tile", "open"] as const, base.frame),
    style: pick(r.style, m.styles.map(([s]) => s), base.style),
    hidden: typeof r.hidden === "boolean" ? r.hidden : base.hidden,
    opts: parseOpts(r.kind, r.opts),
  };
}

/** Reads a stored dashboard. Unknown kinds drop out, kinds added since are appended, and bad values fall back to defaults. */
export function parseDashboard(text: string | null): Dashboard {
  const fallback = defaultDashboard();
  if (!text) return fallback;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fallback; }
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== LAYOUT_VERSION) return fallback;
  const r = raw as Record<string, unknown>;
  const seen = new Set<Kind>();
  const widgets: Widget[] = [];
  for (const w of Array.isArray(r.widgets) ? r.widgets : []) {
    const parsed = parseWidget(w);
    if (parsed && !seen.has(parsed.kind)) { seen.add(parsed.kind); widgets.push(parsed); }
  }
  for (const k of KIND_ORDER) if (!seen.has(k)) widgets.push(defaultWidget(k));
  return {
    v: LAYOUT_VERSION, widgets,
    density: pick(r.density, ["comfortable", "compact"] as const, fallback.density),
    spacing: pick(r.spacing, ["tight", "normal", "roomy"] as const, fallback.spacing),
    corners: pick(r.corners, ["round", "soft", "square"] as const, fallback.corners),
  };
}

export const serialize = (d: Dashboard) => JSON.stringify(d);

// ----- Grid geometry -----

export interface Box { x: number; y: number; w: number; h: number }

export const sizeOf = (w: Pick<Widget, "kind" | "size">): [number, number] => KINDS[w.kind].sizes[w.size] ?? KINDS[w.kind].sizes[KINDS[w.kind].size]!;

/** Columns for a grid this wide, in px. Phones get one column whose tiles take their natural height. */
export const columnsFor = (width: number) => (width >= 1000 ? 12 : width >= 700 ? 8 : 1);

/** A 12 column width in a grid of `cols` columns. */
export function spanFor(w: number, cols: number) {
  if (cols >= 12) return Math.min(w, cols);
  if (cols <= 1) return 1;
  return Math.min(cols, Math.max(2, Math.round((w * cols) / 12)));
}

/** Places each widget where CSS dense auto-placement would: the first free slot, top to bottom, left to right. */
export function place(items: readonly Pick<Widget, "id" | "kind" | "size">[], cols: number): Map<string, Box> {
  const taken: boolean[][] = [];
  const free = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (taken[r]?.[c]) return false;
    return true;
  };
  const out = new Map<string, Box>();
  for (const it of items) {
    const [w12, h] = sizeOf(it);
    const w = spanFor(w12, cols);
    for (let y = 0, done = false; !done; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (!free(x, y, w, h)) continue;
        for (let r = y; r < y + h; r++) { taken[r] ??= []; for (let c = x; c < x + w; c++) taken[r][c] = true; }
        out.set(it.id, { x, y, w, h });
        done = true;
        break;
      }
    }
  }
  return out;
}

/** Empty cells with a widget somewhere below them, plus a lighter cost for a ragged bottom edge. */
export function holes(boxes: Iterable<Box>, cols: number) {
  const bottom = Array<number>(cols).fill(0), filled = Array<number>(cols).fill(0);
  for (const b of boxes) for (let c = b.x; c < b.x + b.w; c++) { bottom[c] = Math.max(bottom[c], b.y + b.h); filled[c] += b.h; }
  const end = Math.max(...bottom);
  return bottom.reduce((n, bt, c) => n + (bt - filled[c]) + (end - bt) * 0.25, 0);
}

/** The size of `id` that leaves the fewest holes in the grid, keeping its own size unless another one clearly fits better. */
export function fitSize(items: readonly Widget[], id: string, cols: number): SizeName {
  const me = items.find((w) => w.id === id);
  if (!me || cols <= 1) return me?.size ?? "m";
  const [w0, h0] = sizeOf(me);
  let best = me.size, bestCost = Infinity;
  for (const [name, [w, h]] of Object.entries(KINDS[me.kind].sizes) as [SizeName, [number, number]][]) {
    const trial = items.map((x) => (x.id === id ? { ...x, size: name } : x));
    const cost = holes(place(trial, cols).values(), cols) + (Math.abs(w - w0) + Math.abs(h - h0)) * 0.6;
    if (cost < bestCost - 0.01) { best = name; bestCost = cost; }
  }
  return best;
}

/** The size nearest a box of `cols` by `rows` grid cells, for a resize by dragging. */
export function nearestSize(kind: Kind, cols: number, rows: number, gridCols: number): SizeName {
  let best = KINDS[kind].size, d = Infinity;
  for (const [name, [w, h]] of Object.entries(KINDS[kind].sizes) as [SizeName, [number, number]][]) {
    const dd = (spanFor(w, gridCols) - cols) ** 2 + (h - rows) ** 2;
    if (dd < d) { d = dd; best = name; }
  }
  return best;
}

/** The next size in a direction, for resizing from the keyboard: wider, narrower, taller or shorter. */
export function stepSize(w: Widget, dir: "wider" | "narrower" | "taller" | "shorter"): SizeName {
  const [w0, h0] = sizeOf(w);
  let best: SizeName | null = null, cost = Infinity;
  for (const [name, [sw, sh]] of Object.entries(KINDS[w.kind].sizes) as [SizeName, [number, number]][]) {
    const main = dir === "wider" ? sw - w0 : dir === "narrower" ? w0 - sw : dir === "taller" ? sh - h0 : h0 - sh;
    if (main <= 0) continue;
    const off = dir === "wider" || dir === "narrower" ? Math.abs(sh - h0) : Math.abs(sw - w0);
    const c = main * 10 + off;
    if (c < cost) { cost = c; best = name; }
  }
  return best ?? w.size;
}

// ----- Changes -----

/** Moves a widget to `to`, counted among the shown widgets. Hidden widgets keep their place in the stored list. */
export function moveTo(widgets: readonly Widget[], id: string, to: number): Widget[] {
  const me = widgets.find((w) => w.id === id);
  if (!me) return [...widgets];
  const rest = widgets.filter((w) => w.id !== id);
  const shown = rest.filter((w) => !w.hidden);
  const anchor = shown[Math.max(0, to)];
  const at = anchor ? rest.indexOf(anchor) : rest.length;
  return [...rest.slice(0, at), me, ...rest.slice(at)];
}

export const update = (widgets: readonly Widget[], id: string, patch: Partial<Widget>) => widgets.map((w) => (w.id === id ? { ...w, ...patch } : w));
