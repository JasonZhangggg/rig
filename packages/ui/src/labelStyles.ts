// Other ways to label the 3D views, beside the pins and pills that sceneLabels.ts places. The PC view and the board
// view hand a deck their items (what each label says) and, every frame, where each item's anchor is on screen;
// the deck draws them in one of four styles:
//   callouts  names in two columns beside the model, each joined to its part by a thin line
//   numbers   a numbered marker on each part and a list that says what each number is
//   focus     only small dots until a part is pointed at or picked, then one card with everything about it
//   tags      a tag lying flat on the part itself, turned with it like a sticker
// The layout maths is in plain functions below so it can be tested without a browser.

export type LabelStyle = "pins" | "callouts" | "numbers" | "focus" | "tags";

export const labelStyleNames: Record<LabelStyle, string> = {
  pins: "Pins (today)",
  callouts: "Callouts",
  numbers: "Numbers",
  focus: "Quiet",
  tags: "Tags",
};

export interface DeckItem {
  id: string;
  /** What it is, in plain words ("Processor and cooler", "Front panel header"). */
  title: string;
  /** The exact model, shown when the part is picked ("AMD Ryzen 7 7800X3D"). */
  sub?: string;
  /** The name printed on the board ("JFP1"). */
  code?: string;
  /** A reading ("51°"). */
  value?: string;
  warn?: boolean;
}

export interface DeckPoint {
  id: string;
  /** The anchor on screen, px from the stage's top left. */
  x: number; y: number;
  /** 0 nearest to 1 farthest. */
  depth: number;
  /** Something solid is in front of it. */
  behind?: boolean;
  /** Not on screen at all. */
  off?: boolean;
  /** For tags: how far one unit right and one unit down along the part's surface moves on screen, in px. */
  ux?: [number, number]; uy?: [number, number];
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

export interface DeckView {
  width: number; height: number;
  /** The model's outline on screen. */
  box?: Box | null;
  hovered?: string | null;
  selected?: string | null;
  /** Name every point even in the quiet style, as when someone asked for one kind of header. */
  named?: boolean;
}

/** Space a style wants kept clear of the model, in px, for its columns or its list. */
export interface Room { t: number; r: number; b: number; l: number }

const NARROW = 640;

/** Callouts need room on both sides; on a narrow stage, such as a phone's, they turn into numbers. */
export function effectiveStyle(style: LabelStyle, width: number): LabelStyle {
  return style === "callouts" && width < NARROW ? "numbers" : style;
}

export function roomFor(style: LabelStyle, width: number, items: number, widest = 150): Room | null {
  const s = effectiveStyle(style, width);
  // Each column is as wide as its widest label, plus the line out to it.
  if (s === "callouts") { const side = Math.min(240, Math.max(110, widest + 52), width * 0.24); return { t: 24, r: side, b: 24, l: side }; }
  if (s === "numbers") {
    if (width >= NARROW) return { t: 24, r: 24, b: 24, l: 264 };
    // One row per part under the model.
    return { t: 12, r: 12, b: items * 26 + 24, l: 12 };
  }
  return null;
}

/**
 * Spreads labels down one column: each wants its middle at want[i] (the list sorted by want) and is h[i] tall.
 * Returns each label's top, kept in order, at least gap apart and inside top..bottom where they fit.
 */
export function spreadColumn(want: number[], h: number[], top: number, bottom: number, gap: number): number[] {
  const n = want.length;
  const y = want.map((w, i) => w - h[i] / 2);
  // Down the column: no label above the one before it.
  for (let i = 0; i < n; i++) y[i] = Math.max(y[i], i ? y[i - 1] + h[i - 1] + gap : top);
  // Up from the bottom: none past the bottom, nor into the one after it.
  for (let i = n - 1; i >= 0; i--) y[i] = Math.min(y[i], i < n - 1 ? y[i + 1] - h[i] - gap : bottom - h[i]);
  // A column too tall for the stage starts at the top and runs over the bottom, rather than overlapping.
  if (n && y[0] < top) { y[0] = top; for (let i = 1; i < n; i++) y[i] = Math.max(y[i], y[i - 1] + h[i - 1] + gap); }
  return y;
}

/**
 * Which side of the model each point's callout goes: the side its anchor is on, keeping the side it had while it's
 * near the middle, then evened out so neither column has more than one label more than the other.
 */
export function splitSides(points: { id: string; x: number; y: number }[], cx: number, prev: Record<string, -1 | 1> = {}): Record<string, -1 | 1> {
  const side: Record<string, -1 | 1> = {};
  for (const p of points) side[p.id] = Math.abs(p.x - cx) < 18 && prev[p.id] ? prev[p.id] : p.x < cx ? -1 : 1;
  const count = (s: -1 | 1) => points.filter((p) => side[p.id] === s).length;
  for (let guard = 0; guard < points.length; guard++) {
    const l = count(-1), r = count(1);
    if (Math.abs(l - r) <= 1) break;
    const from: -1 | 1 = l > r ? -1 : 1;
    // Move the one nearest the middle.
    const mover = points.filter((p) => side[p.id] === from).sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx))[0];
    side[mover.id] = from === -1 ? 1 : -1;
  }
  return side;
}

/**
 * The 2D matrix that lays a tag on a surface: ux and uy are where one unit right and one unit down along the surface
 * land on screen. The tag keeps its readable size (its longer axis is never shrunk) and takes the surface's slant,
 * easing back to upright as the surface turns edge-on, where a slanted tag could no longer be read.
 */
export function surfaceMatrix(ux?: [number, number], uy?: [number, number]): [number, number, number, number] {
  if (!ux || !uy) return [1, 0, 0, 1];
  const L = Math.max(Math.hypot(...ux), Math.hypot(...uy));
  if (!(L > 1e-6)) return [1, 0, 0, 1];
  let [a, b, c, d] = [ux[0] / L, ux[1] / L, uy[0] / L, uy[1] / L];
  // Mirrored (seen from behind): read it the right way round.
  if (a * d - b * c < 0) { a = -a; b = -b; }
  const area = Math.abs(a * d - b * c);
  const k = Math.min(1, Math.max(0, (area - 0.3) / 0.35));
  return [1 + (a - 1) * k, b * k, c * k, 1 + (d - 1) * k];
}

/** Pushes overlapping boxes apart, mostly up and down, so none cover another. Moves boxes in place. */
export function relax(boxes: { x: number; y: number; w: number; h: number }[], gap: number, bounds?: { width: number; height: number }) {
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      const ox = Math.min(a.x + a.w, c.x + c.w) + gap - Math.max(a.x, c.x);
      const oy = Math.min(a.y + a.h, c.y + c.h) + gap - Math.max(a.y, c.y);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      // The shorter way out; up and down counts double, since labels read best in a column.
      if (oy <= ox * 2) { const s = a.y + a.h / 2 <= c.y + c.h / 2 ? 1 : -1; a.y -= (oy / 2) * s; c.y += (oy / 2) * s; }
      else { const s = a.x + a.w / 2 <= c.x + c.w / 2 ? 1 : -1; a.x -= (ox / 2) * s; c.x += (ox / 2) * s; }
    }
    if (bounds) for (const b of boxes) {
      b.x = Math.min(Math.max(b.x, 6), Math.max(6, bounds.width - 6 - b.w));
      b.y = Math.min(Math.max(b.y, 6), Math.max(6, bounds.height - 6 - b.h));
    }
    if (!moved) break;
  }
  return boxes;
}

// ---------- the deck ----------

export interface LabelDeck {
  readonly style: LabelStyle;
  setStyle(s: LabelStyle): void;
  setItems(items: DeckItem[]): void;
  /** Lays every label out for this frame. Reads sizes only after something changed. */
  layout(points: DeckPoint[], view: DeckView): void;
  /** Space this style wants kept clear of the model, for this stage width. */
  room(width: number): Room | null;
  dispose(): void;
}

interface Node {
  item: DeckItem;
  mark: HTMLElement;
  label: HTMLButtonElement;
  line: SVGPathElement;
  halo: SVGPathElement;
  row: HTMLLIElement;
  w: number; h: number;
}

const SVG = "http://www.w3.org/2000/svg";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function createLabelDeck(
  layer: HTMLElement,
  initial: LabelStyle,
  opts: { onPick?: (id: string) => void; onHover?: (id: string | null) => void } = {},
): LabelDeck {
  let style = initial;
  const root = document.createElement("div");
  root.className = "deck";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "dk-lines");
  svg.setAttribute("aria-hidden", "true");
  const legend = document.createElement("ol");
  legend.className = "dk-legend";
  legend.setAttribute("aria-label", "Parts");
  const card = document.createElement("div");
  card.className = "dk-card";
  card.setAttribute("aria-live", "polite");
  const cardLine = document.createElementNS(SVG, "path"), cardHalo = document.createElementNS(SVG, "path");
  cardHalo.setAttribute("class", "dk-halo"); cardLine.setAttribute("class", "dk-line");
  root.append(svg, legend, card);
  layer.appendChild(root);

  let nodes: Node[] = [];
  let dirty = true;
  let sides: Record<string, -1 | 1> = {};
  let cardFor: string | null = null, cardW = 0, cardH = 0;

  const put = (el: HTMLElement | SVGElement, prop: "transform" | "d", v: string) => {
    if (prop === "d") { if (el.getAttribute("d") !== v) el.setAttribute("d", v); }
    else if ((el as HTMLElement).style.transform !== v) (el as HTMLElement).style.transform = v;
  };
  const r1 = (n: number) => Math.round(n * 10) / 10;

  function setStyle(s: LabelStyle) {
    style = s;
    root.dataset.style = s;
    dirty = true;
  }
  setStyle(initial);

  function labelHTML(it: DeckItem) {
    // Board items lead with the plain name and keep the printed name small, since the manual uses it.
    const value = it.value ? `<span class="dk-value${it.warn ? " is-warn" : ""}">${esc(it.value)}</span>` : "";
    const code = it.code ? `<span class="dk-code">${esc(it.code)}</span>` : "";
    return `<span class="dk-title">${esc(it.title)}</span>${value}${code}`;
  }

  function setItems(items: DeckItem[]) {
    const keep = new Map(nodes.map((n) => [n.item.id, n]));
    const next: Node[] = [];
    items.forEach((it, i) => {
      let n = keep.get(it.id);
      if (!n) {
        const mark = document.createElement("span");
        mark.className = "dk-mark";
        mark.dataset.id = it.id;
        const label = document.createElement("button");
        label.type = "button";
        label.className = "dk-label";
        const row = document.createElement("li");
        const halo = document.createElementNS(SVG, "path"), line = document.createElementNS(SVG, "path");
        halo.setAttribute("class", "dk-halo"); line.setAttribute("class", "dk-line");
        svg.append(halo, line);
        const id = it.id;
        for (const el of [mark, label, row]) {
          el.addEventListener("click", (e) => { e.stopPropagation(); opts.onPick?.(id); });
          el.addEventListener("pointerenter", () => opts.onHover?.(id));
          el.addEventListener("pointerleave", () => opts.onHover?.(null));
        }
        label.addEventListener("focus", () => opts.onHover?.(id));
        label.addEventListener("blur", () => opts.onHover?.(null));
        root.append(mark, label);
        legend.append(row);
        n = { item: it, mark, label, line, halo, row, w: 0, h: 0 };
      }
      keep.delete(it.id);
      n.item = it;
      const html = labelHTML(it);
      if (n.label.innerHTML !== html) { n.label.innerHTML = html; dirty = true; }
      const num = String(i + 1);
      if (n.mark.dataset.n !== num) n.mark.dataset.n = num;
      n.mark.classList.toggle("is-warn", !!it.warn);
      n.mark.dataset.value = it.warn && it.value ? it.value : "";
      const row = `<i>${num}</i><b>${esc(it.title)}${it.code ? ` <small>${esc(it.code)}</small>` : ""}</b><span class="${it.warn ? "is-warn" : ""}">${esc(it.value ?? "")}</span>`;
      if (n.row.innerHTML !== row) n.row.innerHTML = row;
      next.push(n);
    });
    for (const n of keep.values()) { n.mark.remove(); n.label.remove(); n.row.remove(); n.line.remove(); n.halo.remove(); }
    nodes = next;
    // Keep the list in the items' order.
    for (const n of nodes) legend.append(n.row);
    if (cardFor && !nodes.some((n) => n.item.id === cardFor)) cardFor = null;
    dirty = true;
  }

  function measure() {
    if (!dirty) return;
    for (const n of nodes) { n.w = n.label.offsetWidth; n.h = n.label.offsetHeight; }
    dirty = false;
  }

  /** A line from the part out to its label: a soft light halo under a dark hairline, so it reads on dark and light parts. */
  function drawLine(n: { line: SVGPathElement; halo: SVGPathElement }, d: string) {
    put(n.line, "d", d); put(n.halo, "d", d);
  }

  function layout(points: DeckPoint[], view: DeckView) {
    const eff = effectiveStyle(style, view.width);
    if (root.dataset.eff !== eff) { root.dataset.eff = eff; root.dataset.wide = String(view.width >= NARROW); dirty = true; }
    root.dataset.wide = String(view.width >= NARROW);
    measure();
    svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
    const at = new Map(points.map((p) => [p.id, p]));
    const focus = view.hovered ?? view.selected ?? null;
    root.classList.toggle("has-focus", !!focus);
    const shown = nodes.filter((n) => { const p = at.get(n.item.id); return p && !p.off; });
    for (const n of nodes) {
      const p = at.get(n.item.id);
      const off = !p || p.off;
      n.mark.classList.toggle("is-off", off);
      n.label.classList.toggle("is-off", off);
      n.mark.classList.toggle("is-behind", !!p?.behind);
      n.label.classList.toggle("is-behind", !!p?.behind);
      const hot = focus === n.item.id;
      for (const el of [n.mark, n.label, n.row]) {
        el.classList.toggle("is-hot", hot);
        el.classList.toggle("is-picked", view.selected === n.item.id);
      }
      n.line.classList.toggle("is-hot", hot); n.halo.classList.toggle("is-hot", hot);
      if (off) drawLine(n, "");
    }
    if (eff === "callouts") callouts(shown, at, view);
    else if (eff === "numbers") numbers(shown, at, view);
    else if (eff === "focus") quiet(shown, at, view, focus);
    else if (eff === "tags") tags(shown, at, view);
  }

  function dot(n: Node, p: DeckPoint) { put(n.mark, "transform", `translate(${r1(p.x)}px, ${r1(p.y)}px)`); }

  function callouts(shown: Node[], at: Map<string, DeckPoint>, view: DeckView) {
    const box = view.box ?? { x0: view.width * 0.3, y0: view.height * 0.1, x1: view.width * 0.7, y1: view.height * 0.9 };
    const cx = (box.x0 + box.x1) / 2;
    const pts = shown.map((n) => at.get(n.item.id)!);
    sides = splitSides(pts, cx, sides);
    const top = Math.max(12, box.y0 - 8), bottom = Math.min(view.height - 12, box.y1 + 8);
    for (const s of [-1, 1] as const) {
      const col = shown.filter((n) => sides[n.item.id] === s).sort((a, b) => at.get(a.item.id)!.y - at.get(b.item.id)!.y);
      const ys = spreadColumn(col.map((n) => at.get(n.item.id)!.y), col.map((n) => n.h), top, bottom, 12);
      // The column's inner edge: just outside the model, never off the stage.
      const edge = s < 0 ? box.x0 - 40 : box.x1 + 40;
      col.forEach((n, i) => {
        const p = at.get(n.item.id)!;
        let x = s < 0 ? edge - n.w : edge;
        x = Math.min(Math.max(x, 12), view.width - 12 - n.w);
        const y = ys[i];
        put(n.label, "transform", `translate(${r1(x)}px, ${r1(y)}px)`);
        n.label.dataset.side = s < 0 ? "left" : "right";
        dot(n, p);
        // Out from the part to just outside the model, then level into the label's first line.
        const ly = y + Math.min(n.h / 2, 10);
        const elbow = s < 0 ? Math.min(box.x0 - 14, p.x - 6) : Math.max(box.x1 + 14, p.x + 6);
        const end = s < 0 ? x + n.w + 6 : x - 6;
        drawLine(n, `M${r1(p.x)} ${r1(p.y)}L${r1(elbow)} ${r1(ly)}L${r1(end)} ${r1(ly)}`);
      });
    }
  }

  function numbers(shown: Node[], at: Map<string, DeckPoint>, view: DeckView) {
    // Markers sit on their parts, nudged apart when two parts are close.
    const R = 12;
    const boxes = shown.map((n) => { const p = at.get(n.item.id)!; return { x: p.x - R, y: p.y - R, w: R * 2, h: R * 2 }; });
    relax(boxes, 3, view);
    shown.forEach((n, i) => {
      const p = at.get(n.item.id)!, b = boxes[i];
      const mx = b.x + R, my = b.y + R;
      put(n.mark, "transform", `translate(${r1(mx)}px, ${r1(my)}px)`);
      // A nudged marker keeps a short tick back to its part.
      drawLine(n, Math.hypot(mx - p.x, my - p.y) > 6 ? `M${r1(p.x)} ${r1(p.y)}L${r1(mx)} ${r1(my)}` : "");
    });
  }

  function quiet(shown: Node[], at: Map<string, DeckPoint>, view: DeckView, focus: string | null) {
    const lit = new Set<string>();
    for (const n of shown) {
      const p = at.get(n.item.id)!;
      dot(n, p);
      // Hot parts keep their reading showing, so the quiet view never hides a problem.
      if ((view.named || n.item.warn) && n.item.id !== focus) lit.add(n.item.id);
      drawLine(n, "");
    }
    // Small name tags beside each named dot, kept apart.
    const named = shown.filter((n) => lit.has(n.item.id));
    const boxes = named.map((n) => { const p = at.get(n.item.id)!; return { x: p.x + 12, y: p.y - n.h / 2, w: n.w, h: n.h }; });
    relax(boxes, 4, view);
    named.forEach((n, i) => {
      put(n.label, "transform", `translate(${r1(boxes[i].x)}px, ${r1(boxes[i].y)}px)`);
      n.label.classList.add("is-named");
      const p = at.get(n.item.id)!;
      drawLine(n, Math.hypot(boxes[i].x - p.x, boxes[i].y + n.h / 2 - p.y) > 16 ? `M${r1(p.x)} ${r1(p.y)}L${r1(boxes[i].x)} ${r1(boxes[i].y + n.h / 2)}` : "");
    });
    for (const n of shown) if (!lit.has(n.item.id)) n.label.classList.remove("is-named");
    // One card for the part pointed at or picked.
    const n = focus ? shown.find((m) => m.item.id === focus) : undefined;
    if (!n) { card.classList.remove("is-shown"); cardFor = null; put(cardLine, "d", ""); put(cardHalo, "d", ""); return; }
    const p = at.get(n.item.id)!;
    if (cardFor !== n.item.id) {
      const it = n.item;
      card.innerHTML = `<span class="dk-c-title">${esc(it.title)}</span>${it.sub ? `<span class="dk-c-sub">${esc(it.sub)}</span>` : ""}${it.code ? `<span class="dk-c-code">${esc(it.code)}</span>` : ""}${it.value ? `<span class="dk-c-value${it.warn ? " is-warn" : ""}">${esc(it.value)}</span>` : ""}`;
      cardFor = it.id;
      cardW = card.offsetWidth; cardH = card.offsetHeight;
      if (!cardLine.parentNode) svg.append(cardHalo, cardLine);
    }
    card.classList.add("is-shown");
    const box = view.box;
    const right = box ? p.x >= (box.x0 + box.x1) / 2 : p.x >= view.width / 2;
    let x = right ? p.x + 44 : p.x - 44 - cardW;
    if (x < 12 || x + cardW > view.width - 12) x = right ? p.x - 44 - cardW : p.x + 44;
    x = Math.min(Math.max(x, 12), view.width - 12 - cardW);
    const y = Math.min(Math.max(p.y - cardH / 2, 12), view.height - 12 - cardH);
    put(card, "transform", `translate(${r1(x)}px, ${r1(y)}px)`);
    const ex = x > p.x ? x : x + cardW, ey = Math.min(Math.max(p.y, y + 14), y + cardH - 14);
    const d = `M${r1(p.x)} ${r1(p.y)}L${r1(ex)} ${r1(ey)}`;
    put(cardLine, "d", d); put(cardHalo, "d", d);
  }

  function tags(shown: Node[], at: Map<string, DeckPoint>, view: DeckView) {
    const placed = shown.map((n) => {
      const p = at.get(n.item.id)!;
      const [a, b, c, d] = surfaceMatrix(p.ux, p.uy);
      // The tag's screen outline, centred on its anchor.
      const xs = [0, a * n.w, c * n.h, a * n.w + c * n.h], ys = [0, b * n.w, d * n.h, b * n.w + d * n.h];
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      return { n, p, m: [a, b, c, d], box: { x: p.x - bw / 2, y: p.y - bh / 2, w: bw, h: bh }, ox: Math.min(...xs), oy: Math.min(...ys) };
    });
    relax(placed.map((q) => q.box), 4, view);
    for (const q of placed) {
      const [a, b, c, d] = q.m;
      const tx = q.box.x - q.ox, ty = q.box.y - q.oy;
      put(q.n.label, "transform", `matrix(${a.toFixed(4)}, ${b.toFixed(4)}, ${c.toFixed(4)}, ${d.toFixed(4)}, ${r1(tx)}, ${r1(ty)})`);
      dot(q.n, q.p);
      const cx = q.box.x + q.box.w / 2, cy = q.box.y + q.box.h / 2;
      drawLine(q.n, Math.hypot(cx - q.p.x, cy - q.p.y) > q.box.h * 0.75 ? `M${r1(q.p.x)} ${r1(q.p.y)}L${r1(cx)} ${r1(cy)}` : "");
    }
  }

  return {
    get style() { return style; },
    setStyle,
    setItems,
    layout,
    room(width) {
      const eff = effectiveStyle(style, width);
      if (root.dataset.eff !== eff) { root.dataset.eff = eff; dirty = true; }
      measure();
      return roomFor(style, width, nodes.length, nodes.reduce((m, n) => Math.max(m, n.w), 0) || 150);
    },
    dispose() { root.remove(); },
  };
}
