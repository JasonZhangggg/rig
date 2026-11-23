// The 3D views' part labels: callouts. Names sit in two columns beside the model, each joined to its part by a thin
// line, so no label covers a part and the text sits on the page, readable whatever the part's color. On a narrow stage,
// such as a phone's, there's no room for columns: each part gets a numbered marker and a list under the model says
// what each number is. The PC view and the board view hand the labels their items (what each says) and, every frame,
// where each item's anchor is on screen. The layout maths is in plain functions so it can be tested without a browser.

export interface LabelItem {
  id: string;
  /** What it is, in plain words ("Processor and cooler", "Front panel header"). */
  title: string;
  /** The name printed on the board ("JFP1"). */
  code?: string;
  /** A reading ("51°"). */
  value?: string;
  warn?: boolean;
}

export interface LabelPoint {
  id: string;
  /** The anchor on screen, px from the stage's top left. */
  x: number; y: number;
  /** Something solid is in front of it. */
  behind?: boolean;
  /** Not on screen at all. */
  off?: boolean;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

export interface LabelView {
  width: number; height: number;
  /** The model's outline on screen. */
  box?: Box | null;
  hovered?: string | null;
  selected?: string | null;
  /** Height kept clear along the stage's bottom edge for the page's own buttons, in px. */
  foot?: number;
}

/** Space the labels want kept clear of the model, in px. */
export interface Room { t: number; r: number; b: number; l: number }

/** Below this stage width the columns don't fit, and labels become numbers with a list. */
export const NARROW = 640;

export const calloutsFit = (width: number) => width >= NARROW;

/** Room for the two columns, each as wide as its widest label plus its line; or, when narrow, for the list under the model. */
export function roomFor(width: number, items: number, widest = 150): Room {
  if (calloutsFit(width)) { const side = Math.min(240, Math.max(110, widest + 52), width * 0.24); return { t: 24, r: side, b: 24, l: side }; }
  return { t: 12, r: 12, b: items * 26 + 24, l: 12 };
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
 * Which side of the model each callout goes: the side its anchor is on, keeping the side it had while it's near the
 * middle (so labels don't flip as the PC turns), then evened out so neither column has more than one label more.
 */
export function splitSides(points: { id: string; x: number }[], cx: number, prev: Record<string, -1 | 1> = {}): Record<string, -1 | 1> {
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

/** Pushes overlapping boxes apart, mostly up and down. Moves boxes in place. */
export function relax(boxes: { x: number; y: number; w: number; h: number }[], gap: number, bounds?: { width: number; height: number }) {
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      const ox = Math.min(a.x + a.w, c.x + c.w) + gap - Math.max(a.x, c.x);
      const oy = Math.min(a.y + a.h, c.y + c.h) + gap - Math.max(a.y, c.y);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
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

// ---------- the labels ----------

export interface SceneLabels {
  setItems(items: LabelItem[]): void;
  /** Only the picked part gets a label and nothing is kept clear, as on Home, where the PC is small. */
  setPickedOnly(v: boolean): void;
  /** Lays every label out for this frame. Reads sizes only after something changed. */
  layout(points: LabelPoint[], view: LabelView): void;
  /** Space to keep clear of the model at this stage width, or none. */
  room(width: number): Room | null;
  dispose(): void;
}

interface Node {
  item: LabelItem;
  mark: HTMLElement;
  label: HTMLButtonElement;
  line: SVGPathElement;
  halo: SVGPathElement;
  row: HTMLLIElement;
  w: number; h: number;
}

const SVG = "http://www.w3.org/2000/svg";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function createSceneLabels(
  layer: HTMLElement,
  opts: { onPick?: (id: string) => void; onHover?: (id: string | null) => void } = {},
): SceneLabels {
  const root = document.createElement("div");
  root.className = "callouts";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "co-lines");
  svg.setAttribute("aria-hidden", "true");
  const legend = document.createElement("ol");
  legend.className = "co-legend";
  legend.setAttribute("aria-label", "Parts");
  root.append(svg, legend);
  layer.appendChild(root);

  let nodes: Node[] = [];
  let dirty = true, pickedOnly = false;
  // Labels are measured once their font has loaded, so the columns don't space for a fallback font.
  document.fonts?.ready.then(() => { dirty = true; });
  let sides: Record<string, -1 | 1> = {};

  const put = (el: HTMLElement, v: string) => { if (el.style.transform !== v) el.style.transform = v; };
  const path = (n: { line: SVGPathElement; halo: SVGPathElement }, d: string) => {
    for (const p of [n.line, n.halo]) if (p.getAttribute("d") !== d) p.setAttribute("d", d);
  };
  const r1 = (n: number) => Math.round(n * 10) / 10;

  function setItems(items: LabelItem[]) {
    const keep = new Map(nodes.map((n) => [n.item.id, n]));
    const next: Node[] = [];
    items.forEach((it, i) => {
      let n = keep.get(it.id);
      if (!n) {
        const mark = document.createElement("span");
        mark.className = "co-mark";
        mark.dataset.id = it.id;
        const label = document.createElement("button");
        label.type = "button";
        label.className = "co-label";
        label.dataset.part = it.id;
        const row = document.createElement("li");
        const halo = document.createElementNS(SVG, "path"), line = document.createElementNS(SVG, "path");
        halo.setAttribute("class", "co-halo"); line.setAttribute("class", "co-line");
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
        n = { item: it, mark, label, line, halo, row, w: 0, h: 0 };
      }
      keep.delete(it.id);
      n.item = it;
      // Board items lead with the plain name and keep the printed one small under it, since the manual uses it.
      const value = it.value ? `<span class="co-value${it.warn ? " is-warn" : ""}">${esc(it.value)}</span>` : "";
      const code = it.code ? `<span class="co-code">${esc(it.code)}</span>` : "";
      const html = `<span class="co-title">${esc(it.title)}</span>${value}${code}`;
      if (n.label.innerHTML !== html) { n.label.innerHTML = html; dirty = true; }
      const num = String(i + 1);
      n.mark.dataset.n = num;
      n.mark.classList.toggle("is-warn", !!it.warn);
      const row = `<i>${num}</i><b>${esc(it.title)}${it.code ? ` <small>${esc(it.code)}</small>` : ""}</b><span class="${it.warn ? "is-warn" : ""}">${esc(it.value ?? "")}</span>`;
      if (n.row.innerHTML !== row) n.row.innerHTML = row;
      next.push(n);
    });
    for (const n of keep.values()) { n.mark.remove(); n.label.remove(); n.row.remove(); n.line.remove(); n.halo.remove(); }
    nodes = next;
    for (const n of nodes) legend.append(n.row);
    dirty = true;
  }

  function setMode(width: number) {
    const mode = pickedOnly || calloutsFit(width) ? "callouts" : "numbers";
    if (root.dataset.mode !== mode) { root.dataset.mode = mode; dirty = true; }
    return mode;
  }

  function measure() {
    if (!dirty) return;
    for (const n of nodes) { n.w = n.label.offsetWidth; n.h = n.label.offsetHeight; }
    dirty = false;
  }

  function layout(points: LabelPoint[], view: LabelView) {
    const mode = setMode(view.width);
    measure();
    svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
    const at = new Map(points.map((p) => [p.id, p]));
    const focus = view.hovered ?? view.selected ?? null;
    root.classList.toggle("has-focus", !!focus);
    const shown: Node[] = [];
    for (const n of nodes) {
      const p = at.get(n.item.id);
      const off = !p || !!p.off || (pickedOnly && view.selected !== n.item.id);
      for (const el of [n.mark, n.label]) { el.classList.toggle("is-off", off); el.classList.toggle("is-behind", !!p?.behind); }
      const hot = focus === n.item.id;
      for (const el of [n.mark, n.label, n.row]) el.classList.toggle("is-hot", hot);
      n.line.classList.toggle("is-hot", hot); n.halo.classList.toggle("is-hot", hot);
      if (off) path(n, ""); else shown.push(n);
    }
    if (mode === "callouts") callouts(shown, at, view);
    else numbers(shown, at, view);
  }

  function callouts(shown: Node[], at: Map<string, LabelPoint>, view: LabelView) {
    const box = view.box ?? { x0: view.width * 0.3, y0: view.height * 0.1, x1: view.width * 0.7, y1: view.height * 0.9 };
    const cx = (box.x0 + box.x1) / 2;
    sides = splitSides(shown.map((n) => at.get(n.item.id)!), cx, sides);
    const top = Math.max(12, box.y0 - 8), bottom = Math.min(view.height - 12 - (view.foot ?? 0), box.y1 + 8);
    for (const s of [-1, 1] as const) {
      const col = shown.filter((n) => sides[n.item.id] === s).sort((a, b) => at.get(a.item.id)!.y - at.get(b.item.id)!.y);
      const ys = spreadColumn(col.map((n) => at.get(n.item.id)!.y), col.map((n) => n.h), top, bottom, 12);
      // The column's inner edge sits just outside the model, never off the stage.
      const edge = s < 0 ? box.x0 - 40 : box.x1 + 40;
      col.forEach((n, i) => {
        const p = at.get(n.item.id)!;
        const x = Math.min(Math.max(s < 0 ? edge - n.w : edge, 12), view.width - 12 - n.w);
        const y = ys[i];
        put(n.label, `translate(${r1(x)}px, ${r1(y)}px)`);
        n.label.dataset.side = s < 0 ? "left" : "right";
        put(n.mark, `translate(${r1(p.x)}px, ${r1(p.y)}px)`);
        // Out from the part to just outside the model, then level into the label's first line.
        const ly = y + Math.min(n.h / 2, 10);
        const elbow = s < 0 ? Math.min(box.x0 - 14, p.x - 6) : Math.max(box.x1 + 14, p.x + 6);
        const end = s < 0 ? x + n.w + 6 : x - 6;
        path(n, `M${r1(p.x)} ${r1(p.y)}L${r1(elbow)} ${r1(ly)}L${r1(end)} ${r1(ly)}`);
      });
    }
  }

  function numbers(shown: Node[], at: Map<string, LabelPoint>, view: LabelView) {
    // Markers sit on their parts, nudged apart when two parts are close, with a short tick back to the part.
    const R = 12;
    const boxes = relax(shown.map((n) => { const p = at.get(n.item.id)!; return { x: p.x - R, y: p.y - R, w: R * 2, h: R * 2 }; }), 3, view);
    shown.forEach((n, i) => {
      const p = at.get(n.item.id)!, mx = boxes[i].x + R, my = boxes[i].y + R;
      put(n.mark, `translate(${r1(mx)}px, ${r1(my)}px)`);
      path(n, Math.hypot(mx - p.x, my - p.y) > 6 ? `M${r1(p.x)} ${r1(p.y)}L${r1(mx)} ${r1(my)}` : "");
    });
  }

  return {
    setItems,
    setPickedOnly(v) { if (v !== pickedOnly) { pickedOnly = v; dirty = true; } },
    layout,
    room(width) {
      if (pickedOnly || !nodes.length) return null;
      setMode(width);
      measure();
      return roomFor(width, nodes.length, nodes.reduce((m, n) => Math.max(m, n.w), 0) || 150);
    },
    dispose() { root.remove(); },
  };
}
