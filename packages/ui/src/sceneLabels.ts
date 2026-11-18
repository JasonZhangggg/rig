// Where the 3D view's part labels go on screen. Each label hangs off a pin on its part by a short leader,
// out to the side of the PC the part is on, and labels push each other apart so none overlap.

export interface Pin {
  id: string;
  /** The part's anchor on screen, in px from the stage's top left. */
  x: number; y: number;
  /** 0 for the nearest point of the PC to 1 for the farthest. */
  depth: number;
  /** The label's own size, unscaled. */
  w: number; h: number;
}

export interface Placed {
  id: string;
  /** The label's top left, in px, and its scale. Scale is applied from the label's top left. */
  x: number; y: number; scale: number; opacity: number;
  /** Which side of its pin the label hangs on: -1 left, 1 right. */
  side: -1 | 1;
  /** The leader runs from the pin to this point on the label's inner edge. */
  ex: number; ey: number;
}

export interface Bounds {
  width: number; height: number;
  /** The middle of the PC on screen: pins left of it hang their label to the left. */
  cx: number;
  /** How far a label sits out from its pin, in px. */
  reach?: number;
  /** Space kept clear at the stage's edges and between labels, in px. */
  pad?: number; gap?: number;
}

/** Nearer parts read a little larger and stronger, farther ones smaller and softer. */
export const depthScale = (depth: number) => 1.04 - 0.14 * clamp01(depth);
export const depthOpacity = (depth: number) => 1 - 0.3 * clamp01(depth);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function placeLabels(pins: readonly Pin[], b: Bounds, prevSide: Record<string, -1 | 1> = {}): Placed[] {
  const reach = b.reach ?? 40, pad = b.pad ?? 8, gap = b.gap ?? 6;
  const out = pins.map((p) => {
    const scale = depthScale(p.depth);
    const w = p.w * scale, h = p.h * scale;
    // A pin near the middle keeps its side, so its label doesn't flip back and forth as the PC sways.
    const lean = p.x - b.cx;
    let side: -1 | 1 = Math.abs(lean) < 14 && prevSide[p.id] ? prevSide[p.id] : lean < 0 ? -1 : 1;
    const hang = (s: -1 | 1) => (s > 0 ? p.x + reach : p.x - reach - w);
    let x = hang(side);
    // No room on that side: hang it on the other.
    if (x < pad || x + w > b.width - pad) {
      const other = hang(side > 0 ? -1 : 1);
      if (other >= pad && other + w <= b.width - pad) { side = side > 0 ? -1 : 1; x = other; }
    }
    x = Math.min(Math.max(x, pad), Math.max(pad, b.width - pad - w));
    return { id: p.id, x, y: p.y - h / 2, w, h, scale, opacity: depthOpacity(p.depth), side, py: p.y };
  });
  // Push overlapping labels apart, top to bottom, then keep them on the stage.
  const order = [...out].sort((a, c) => a.py - c.py);
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
      const a = order[i], c = order[j];
      if (a.x >= c.x + c.w + gap || c.x >= a.x + a.w + gap) continue;
      const over = a.y + a.h + gap - c.y;
      if (over <= 0) continue;
      a.y -= over / 2; c.y += over / 2; moved = true;
    }
    for (const l of order) l.y = Math.min(Math.max(l.y, pad), Math.max(pad, b.height - pad - l.h));
    if (!moved) break;
  }
  return out.map(({ id, x, y, w, h, scale, opacity, side }) => ({
    id, x, y, scale, opacity, side, ex: side > 0 ? x : x + w, ey: y + h / 2,
  }));
}
