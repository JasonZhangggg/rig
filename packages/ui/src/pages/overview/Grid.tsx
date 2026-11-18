import { cloneElement, isValidElement, memo, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from "react";
import { flushSync } from "react-dom";
import { GridLayout, type Compactor, type EventCallback, type Layout, type ResizeHandleAxis } from "react-grid-layout";
import { calcGridItemPosition, transformStrategy } from "react-grid-layout/core";
import { APPEARANCE_EVENT, reducedMotion } from "../../appearance";
import { COLS, KINDS, clampCell, compactUp, dragFlow, kindOf, limits, nearestSize, orderOf, resizeFlow, sizeLabel, stepTarget, stickyCell, type Bp, type Cell, type Dir, type Widget } from "./layout";
import type { TileBox } from "./widgets";

/** How long a press has to rest before it picks the dashboard up for customizing. */
const LONG_PRESS = 450;
/** How close to the top or bottom of the window a drag starts scrolling it. */
const EDGE = 84;
/** The fastest the window scrolls under a drag, in pixels a millisecond, with the pointer right at the edge. */
const SPEED = 1.5;
/** Grid widths below this get the phone's single column list. A 1024 window with the sidebar open still gets the grid. */
const PHONE = 560;
/** The resize handles, one per edge that resizes. */
const HANDLE: Partial<Record<ResizeHandleAxis, string>> = { se: "dw-rh dw-rh-se", e: "dw-rh dw-rh-e", s: "dw-rh dw-rh-s" };
// The grid library sets cssTransforms, react-draggable-dragging and resizing on tiles itself; dash.css styles them.

export type Mode = "lg" | "md" | "phone";

export interface GridProps {
  /** The widgets that show. */
  widgets: Widget[];
  cells: Record<Bp, Cell[]>;
  phone: string[];
  editing: boolean;
  compact: boolean;
  gap: number;
  titleOf: (w: Widget) => string;
  render: (w: Widget, box: TileBox) => ReactNode;
  onCells: (bp: Bp, cells: Cell[], said: string) => void;
  onPhone: (order: string[], said: string) => void;
  onHide: (id: string) => void;
  onOptions: (id: string, from: HTMLElement) => void;
  onEdit: (id?: string) => void;
  onDone: () => void;
  announce: (text: string) => void;
  /** Which grid shows, so size choices apply to it. */
  onMode?: (mode: Mode) => void;
}

const coarse = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const same = (a: readonly Cell[], b: readonly Cell[]) => a.length === b.length && a.every((c) => { const o = b.find((x) => x.i === c.i); return !!o && o.x === c.x && o.y === c.y && o.w === c.w && o.h === c.h; });
/** Cells from the library's layout, keeping the size each tile was chosen at when the grid shows it at another. */
const strip = (layout: Layout): Cell[] => layout.map((c) => {
  const { i, x, y, w, h, cw, ch } = c as Layout[number] & Partial<Cell>;
  return { i, x, y, w, h, ...(cw !== undefined ? { cw } : {}), ...(ch !== undefined ? { ch } : {}) };
});
const withLimits = (cells: readonly Cell[], cols: number): Layout => cells.map((c) => ({ ...c, ...limits(kindOf(c.i), cols) }));

const Grip = () => <svg viewBox="0 0 20 12" aria-hidden="true">{[4, 10, 16].flatMap((x) => [3, 9].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}</svg>;
const Dots = () => <svg viewBox="0 0 20 20" aria-hidden="true">{[4.5, 10, 15.5].map((x) => <circle key={x} cx={x} cy="10" r="1.9" fill="currentColor" />)}</svg>;
const Minus = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 10h9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
const Up = ({ down }: { down?: boolean }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={down ? "M5 8l5 5 5-5" : "M5 12l5-5 5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Everything a tile asks of the grid, behind one stable ref so tiles never re-render for a new callback. */
interface Api {
  key: (e: ReactKeyboardEvent, w: Widget) => void;
  edit: (id: string) => void;
  hide: (id: string) => void;
  options: (id: string, from: HTMLElement) => void;
  step: (id: string, by: -1 | 1) => void;
}

const Content = memo(function Content({ w, size, span, rows, cols, render }: { w: Widget; render: GridProps["render"] } & TileBox) {
  return <>{render(w, { size, span, rows, cols })}</>;
});

interface TileProps {
  w: Widget;
  box: TileBox;
  title: string;
  label: string;
  editing: boolean;
  phone: boolean;
  first: boolean;
  last: boolean;
  motion: CSSProperties;
  render: GridProps["render"];
  api: RefObject<Api>;
}

/**
 * One widget: its content, and in customizing its handle, hide and options buttons. The buttons sit beside the tile
 * rather than in it, so they hold still while it wobbles and stay easy to hit.
 */
const Tile = memo(function Tile({ w, box, title, label, editing, phone, first, last, motion, render, api }: TileProps) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = body.current!; if (editing) el.setAttribute("inert", ""); else el.removeAttribute("inert"); }, [editing]);
  const a = () => api.current!;
  return (
    <>
      <div
        className={`dw${w.tone === "dark" ? " tone-dark" : ""}`}
        data-kind={w.kind} data-frame={w.tone === "dark" ? "tile" : w.frame} data-size={box.size} style={motion}
        tabIndex={editing ? 0 : undefined}
        role={editing ? "group" : undefined}
        aria-roledescription={editing ? "widget" : undefined}
        aria-label={editing ? label : undefined}
        aria-describedby={editing ? "dash-keys" : undefined}
        onKeyDown={(e) => a().key(e, w)}
      >
        <div className="dw-body" ref={body}>
          <Content w={w} {...box} render={render} />
        </div>
      </div>
      {!(editing && phone) && (
        <button
          type="button" className="dw-grip" aria-label={editing ? `Drag to move ${title}` : `Move ${title}`} title={editing ? "Drag to move" : "Drag to move, or press to customize"}
          tabIndex={editing ? -1 : 0}
          onClick={() => { if (!editing) a().edit(w.id); }}
        ><Grip /></button>
      )}
      {editing && (
        <>
          <button type="button" className="dw-del dw-ctl" aria-label={`Hide ${title}`} title="Hide" onClick={() => a().hide(w.id)}><Minus /></button>
          <button type="button" className="dw-opt dw-ctl" aria-label={`${title} options`} title="Options" onClick={(e) => a().options(w.id, e.currentTarget)}><Dots /></button>
        </>
      )}
      {editing && phone && (
        <div className="dw-steps dw-ctl">
          <button type="button" aria-label={`Move ${title} up`} disabled={first} onClick={() => a().step(w.id, -1)}><Up /></button>
          <button type="button" aria-label={`Move ${title} down`} disabled={last} onClick={() => a().step(w.id, 1)}><Up down /></button>
        </div>
      )}
    </>
  );
});

/** Each tile wobbles a little out of step with the others, and the bigger it is the less it turns. */
function wobble(index: number, w: number, h: number): CSSProperties {
  const deg = Math.max(0.35, Math.min(1.3, 7 / (w + h)));
  return { "--jig": `${deg.toFixed(2)}deg`, "--jig-d": `${-((index * 113) % 320)}ms`, "--jig-t": `${300 + ((index * 41) % 70)}ms` } as CSSProperties;
}

/**
 * The grid's width, and how much the page is zoomed by Settings > Text size. The pointer moves in screen pixels and
 * the grid lays out in page pixels, so drags divide by the zoom.
 */
function useWidth(ref: RefObject<HTMLDivElement>) {
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current!;
    const read = () => {
      setWidth(el.clientWidth);
      const z = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
      setZoom(Number.isFinite(z) && z > 0 ? Math.round(z * 1000) / 1000 : 1);
    };
    read();
    window.addEventListener(APPEARANCE_EVENT, read);
    if (typeof ResizeObserver === "undefined") return () => window.removeEventListener(APPEARANCE_EVENT, read);
    let t = 0;
    // While the window or sidebar changes size, tiles follow the width at once instead of gliding behind it.
    const ro = new ResizeObserver(() => {
      el.dataset.still = "";
      read();
      clearTimeout(t);
      t = window.setTimeout(() => delete el.dataset.still, 180);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(t); window.removeEventListener(APPEARANCE_EVENT, read); };
  }, [ref]);
  return [width, zoom] as const;
}

/**
 * Scrolls the window while a drag rests near its top or bottom edge, faster the deeper the pointer goes, and tells the
 * drag the pointer moved with the page. It waits until the pointer has moved, so picking up a tile near an edge doesn't
 * set the page off.
 */
function edgeScroll() {
  let raf = 0, x = 0, y = -1, from = -1, armed = false, last = 0, carry = 0;
  const track = (e: MouseEvent | TouchEvent) => {
    const p = "touches" in e ? e.touches[0] : e;
    if (!p) return;
    x = p.clientX; y = p.clientY;
    if (from < 0) from = y;
    armed ||= Math.abs(y - from) > 8;
  };
  const tick = (t: number) => {
    const dt = last ? Math.min(32, t - last) : 16;
    last = t;
    const vh = window.innerHeight, zone = Math.min(EDGE, vh / 5);
    const into = !armed || y < 0 ? 0 : y < zone ? (y - zone) / zone : y > vh - zone ? (y - (vh - zone)) / zone : 0;
    if (into) {
      carry += Math.sign(into) * Math.min(1, Math.abs(into)) ** 2 * SPEED * dt;
      const step = Math.trunc(carry);
      if (step) { carry -= step; window.scrollBy({ top: step, behavior: "instant" }); scrolled(); }
    } else carry = 0;
    raf = requestAnimationFrame(tick);
  };
  // However the page scrolls, by the edge or a wheel, the held tile is redrawn under the pointer before the next paint.
  let sent = window.scrollY;
  const scrolled = () => {
    if (y < 0 || window.scrollY === sent) return;
    sent = window.scrollY;
    flushSync(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true })));
  };
  window.addEventListener("mousemove", track, true);
  window.addEventListener("touchmove", track, { capture: true, passive: true });
  window.addEventListener("scroll", scrolled, { passive: true });
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("mousemove", track, true); window.removeEventListener("touchmove", track, true); window.removeEventListener("scroll", scrolled); };
}

/** A small press of the drop spot when the dragged tile snaps into a new slot, the way a phone ticks. */
function tick(spot: HTMLElement | null) {
  if (reducedMotion()) return;
  spot?.animate?.([{ scale: "1" }, { scale: "1.025" }, { scale: "1" }], { duration: 220, easing: "cubic-bezier(.2, .9, .3, 1.2)" });
}

/**
 * Widgets on a grid, laid out and dragged by react-grid-layout. Its pointer handling and transforms do
 * the moving; where everything lands is worked out here, from the layout as it was when the drag began, so the
 * grid never keeps a gap and dragging back puts things back.
 */
export function Grid(p: GridProps) {
  const { widgets, editing, compact, gap, titleOf, render } = p;
  const wrap = useRef<HTMLDivElement>(null);
  const spot = useRef<HTMLDivElement>(null);
  const [width, zoom] = useWidth(wrap);
  const measured = width > 0 || typeof ResizeObserver === "undefined";
  const gridWidth = width || 1200;
  const mode: Mode = gridWidth >= 1000 ? "lg" : gridWidth >= PHONE ? "md" : "phone";
  const bp: Bp = mode === "phone" ? "lg" : mode;
  const cols = mode === "phone" ? 1 : COLS[bp];
  const row = Math.round((gridWidth >= 1500 ? 88 : 80) * (compact ? 0.82 : 1));
  const cells = p.cells[bp];
  const [live, setLive] = useState<Cell | null>(null);
  // Bumped on every pointer move of a drag, so the dragged tile re-renders where the pointer is, not only when it changes cell.
  const [, follow] = useReducer((n: number) => n + 1, 0);
  const [touch] = useState(coarse);

  useEffect(() => { p.onMode?.(mode); }, [mode, p.onMode]);

  // Transitions wait until the first layout is on screen, so tiles don't fly in from the corner.
  useLayoutEffect(() => {
    const el = wrap.current!;
    el.dataset.still = "";
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => delete el.dataset.still); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [mode]);

  const latest = useRef({ p, cells, cols, bp, mode, editing, gridWidth, row, gap, zoom });
  latest.current = { p, cells, cols, bp, mode, editing, gridWidth, row, gap, zoom };

  // ----- Where things land: a compactor that works from the layout as it was when the drag began. -----
  // The library's own placeholder (react-grid-placeholder, hidden in dash.css) reads the dragged item after its move has
  // changed it in place, so when two moves come between renders (a scroll and the pointer, in one frame) it shows the raw
  // pointer cell for a frame and flickers. The drop spot is drawn here instead, from the slot this compactor chose.
  const active = useRef<{
    type: "drag" | "resize"; id: string; base: Cell[]; cache: Map<string, Cell[]>; slot: string; stop: () => void;
    /** The cell the held tile is over, which only changes once the tile is well into the next one. */
    cell: { x: number; y: number };
    /** The held tile's size when picked up. It keeps that size under the pointer; the drop spot shows where and how big it lands. */
    size: Cell;
    /** Set the moment the pointer is let go, so the layout the drop settles on has the tile at the size it landed. */
    dropped: boolean;
    /** Set by Escape: everything goes back to where it was when the drag began. */
    cancelled: boolean;
    /** The layout last worked out, with the sizes each tile was chosen at, which the drop saves. */
    last: Cell[] | null;
  } | null>(null);
  const spotAt = (c: Cell, instant = false) => {
    const el = spot.current;
    if (!el) return;
    const { cols: n, gridWidth: cw, row: rh, gap: g } = latest.current;
    const pos = calcGridItemPosition({ cols: n, margin: [g, g], containerPadding: [0, 0], containerWidth: cw, rowHeight: rh, maxRows: Infinity }, c.x, c.y, c.w, c.h);
    if (instant) el.style.transition = "none";
    el.style.transform = `translate(${pos.left}px, ${pos.top}px)`;
    el.style.width = `${pos.width}px`;
    el.style.height = `${pos.height}px`;
    if (instant) { void el.offsetWidth; el.style.transition = ""; }
  };
  const compactor = useMemo<Compactor>(() => ({
    type: "vertical",
    // The grid moves only the dragged tile; this compactor places the rest.
    allowOverlap: true,
    compact(layout, n) {
      const a = active.current;
      const now = strip(layout);
      if (!a) return withLimits(compactUp(now, n), n);
      if (a.cancelled) { a.last = a.base; spotAt(a.base.find((c) => c.i === a.id) ?? a.size); return withLimits(a.base, n); }
      const me = now.find((c) => c.i === a.id);
      if (!me) return withLimits(compactUp(now, n), n);
      const key = a.type === "drag" ? `${a.cell.x},${a.cell.y}` : `${me.w},${me.h}`;
      let out = a.cache.get(key);
      if (!out) {
        out = a.type === "drag" ? dragFlow(a.base, a.id, a.cell.x, a.cell.y, n) : resizeFlow(a.base, a.id, me.w, me.h, n);
        a.cache.set(key, out);
      }
      const landed = out.find((c) => c.i === a.id)!;
      const slot = `${landed.x},${landed.y},${landed.w},${landed.h}`;
      if (slot !== a.slot) { spotAt(landed); tick(spot.current); a.slot = slot; }
      a.last = out;
      if (a.type === "resize" || a.dropped) return withLimits(out, n);
      return withLimits(out.map((c) => (c.i === a.id ? { ...c, w: a.size.w, h: a.size.h } : c)), n);
    },
  }), []);

  const begin = (type: "drag" | "resize", id: string) => {
    const { cells: base, editing: on, p: props } = latest.current;
    active.current?.stop();
    const c = base.find((x) => x.i === id) ?? { i: id, x: 0, y: 0, w: 1, h: 1 };
    const el = wrap.current;
    // The page keeps at least its height until the drop, so it never shrinks under the pointer and jumps the scroll.
    if (el) el.style.minHeight = `${el.offsetHeight}px`;
    const drop = () => { if (active.current === a) a.dropped = true; };
    const scroll = edgeScroll();
    const a = {
      type, id, base, cache: new Map<string, Cell[]>(), slot: `${c.x},${c.y},${c.w},${c.h}`, cell: { x: c.x, y: c.y }, size: c,
      dropped: false, cancelled: false, last: null as Cell[] | null,
      stop: () => {
        scroll();
        for (const t of ["mouseup", "touchend", "touchcancel"]) window.removeEventListener(t, drop, true);
      },
    };
    for (const t of ["mouseup", "touchend", "touchcancel"]) window.addEventListener(t, drop, true);
    active.current = a;
    spotAt(c, true);
    spot.current?.setAttribute("data-on", "");
    el?.classList.add("dragging");
    if (!on) props.onEdit();
  };
  const end = (layout: Layout) => {
    const a = active.current;
    active.current = null;
    a?.stop();
    const el = wrap.current;
    el?.classList.remove("dragging");
    el?.style.removeProperty("min-height");
    spot.current?.removeAttribute("data-on");
    el?.querySelectorAll<HTMLElement>(".dg[data-lift]").forEach((d) => delete d.dataset.lift);
    setLive(null);
    if (!a) return;
    const { cells: was, bp: at, p: props } = latest.current;
    const next = a.last ?? strip(layout);
    if (same(next, was)) return;
    const w = props.widgets.find((x) => x.id === a.id);
    if (!w) return;
    const before = was.find((c) => c.i === a.id)!, after = next.find((c) => c.i === a.id)!;
    const title = props.titleOf(w);
    const label = sizeLabel(w.kind, after.w, after.h, COLS[at]);
    const order = orderOf(next);
    const said = a.type === "drag"
      ? `${title} moved to place ${order.indexOf(a.id) + 1} of ${order.length}.${after.w !== before.w ? ` It's now ${label}.` : ""}`
      : `${title} is now ${label}.`;
    props.onCells(at, next, said);
  };

  const onDragStart: EventCallback = (_l, _o, item) => { if (item) begin("drag", item.i); };
  const onDrag: EventCallback = (_l, _o, _n, _p, _e, node) => {
    // Drawn now rather than at the next render, which lands a frame after the pointer moved.
    flushSync(follow);
    const a = active.current, grid = node?.parentElement, el = wrap.current;
    // The page may grow while a tile is held low, but never shrinks back under the pointer until the drop.
    if (el && el.offsetHeight > parseFloat(el.style.minHeight || "0")) el.style.minHeight = `${el.offsetHeight}px`;
    if (a?.type !== "drag" || !node || !grid) return;
    const { cols: n, gridWidth: cw, row: rh, gap: g, zoom: z } = latest.current;
    const box = node.getBoundingClientRect(), at = grid.getBoundingClientRect();
    const col = (cw - g * (n - 1)) / n;
    a.cell = stickyCell(a.cell, (box.left - at.left) / z / (col + g), (box.top - at.top) / z / (rh + g), n - a.size.w);
  };
  const onDragStop: EventCallback = (layout) => end(layout);
  const onResizeStart: EventCallback = (_l, _o, item) => { if (item) begin("resize", item.i); };
  const onResize: EventCallback = (_l, _o, item) => { if (item) setLive((v) => (v && v.i === item.i && v.w === item.w && v.h === item.h ? v : { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h })); };
  const onResizeStop: EventCallback = (layout) => end(layout);
  const handlers = useRef({ onDragStart, onDrag, onDragStop, onResizeStart, onResize, onResizeStop });
  handlers.current = { onDragStart, onDrag, onDragStop, onResizeStart, onResize, onResizeStop };
  // Stable callbacks: a new function each render would re-render every tile on every frame of a drag.
  const [calls] = useState(() => ({
    onDragStart: ((...a) => handlers.current.onDragStart(...a)) as EventCallback,
    onDrag: ((...a) => handlers.current.onDrag(...a)) as EventCallback,
    onDragStop: ((...a) => handlers.current.onDragStop(...a)) as EventCallback,
    onResizeStart: ((...a) => handlers.current.onResizeStart(...a)) as EventCallback,
    onResize: ((...a) => handlers.current.onResize(...a)) as EventCallback,
    onResizeStop: ((...a) => handlers.current.onResizeStop(...a)) as EventCallback,
  }));
  useEffect(() => () => active.current?.stop(), []);

  // ----- Keyboard -----
  const said = (text: string) => latest.current.p.announce(text);

  const moveKey = (w: Widget, dir: Dir) => {
    const { cells: now, cols: n, bp: at, p: props } = latest.current;
    const title = props.titleOf(w);
    const to = stepTarget(now, w.id, dir, n);
    const next = to && dragFlow(now, w.id, to.x, to.y, n);
    if (!next || same(next, now)) { said(`${title} can't move further ${dir}.`); return; }
    const order = orderOf(next);
    const me = next.find((c) => c.i === w.id)!, was = now.find((c) => c.i === w.id)!;
    props.onCells(at, next, `${title} moved to place ${order.indexOf(w.id) + 1} of ${order.length}.${me.w !== was.w ? ` It's now ${sizeLabel(w.kind, me.w, me.h, n)}.` : ""}`);
  };

  const resizeKey = (w: Widget, dir: Dir) => {
    const { cells: now, cols: n, bp: at, p: props } = latest.current;
    const title = props.titleOf(w);
    const me = now.find((c) => c.i === w.id)!;
    const word = { right: "wider", left: "narrower", down: "taller", up: "shorter" }[dir];
    const want = clampCell({ ...me, w: me.w + (dir === "right" ? 1 : dir === "left" ? -1 : 0), h: me.h + (dir === "down" ? 1 : dir === "up" ? -1 : 0) }, n);
    const next = want.w === me.w && want.h === me.h ? null : resizeFlow(now, w.id, want.w, want.h, n);
    if (!next || same(next, now)) { said(`${title} can't get any ${word}.`); return; }
    const got = next.find((c) => c.i === w.id)!;
    props.onCells(at, next, `${title} is now ${sizeLabel(w.kind, got.w, got.h, n)}.`);
  };

  // ----- The phone's list -----
  const flip = useRef<Map<string, DOMRect> | null>(null);
  const step = (id: string, by: -1 | 1) => {
    const { p: props } = latest.current;
    const order = [...props.phone];
    const at = order.indexOf(id), to = at + by;
    const w = props.widgets.find((x) => x.id === id);
    if (!w || to < 0 || to >= order.length) { if (w) said(to < 0 ? `${props.titleOf(w)} is already first.` : `${props.titleOf(w)} is already last.`); return; }
    order.splice(at, 1);
    order.splice(to, 0, id);
    const m = new Map<string, DOMRect>();
    wrap.current?.querySelectorAll<HTMLElement>(".dg").forEach((el) => m.set(el.dataset.id!, el.getBoundingClientRect()));
    flip.current = m;
    props.onPhone(order, `${props.titleOf(w)} moved to place ${to + 1} of ${order.length}.`);
  };
  useLayoutEffect(() => {
    const from = flip.current;
    flip.current = null;
    if (!from || reducedMotion()) return;
    wrap.current?.querySelectorAll<HTMLElement>(".dg").forEach((el) => {
      const a = from.get(el.dataset.id!), b = el.getBoundingClientRect();
      if (!a || typeof el.animate !== "function" || Math.abs(a.top - b.top) < 1) return;
      el.animate([{ transform: `translateY(${a.top - b.top}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2, .9, .3, 1.15)" });
    });
  });

  // ----- A press that ends however it ends -----
  // A drag belongs to the library from the press until the mouseup. When the browser never sends that mouseup (it began
  // dragging selected text instead, the window lost focus, the touch was cancelled) the tile would stay stuck to the
  // pointer. So while a press is held, anything that ends it ends the drag too, and Escape puts everything back.
  const guard = useRef<(() => void) | null>(null);
  const watch = (from: { clientX: number; clientY: number }) => {
    guard.current?.();
    window.getSelection()?.removeAllRanges();
    const pt = { x: from.clientX, y: from.clientY, touch: -1 };
    let t = 0;
    const finish = () => {
      off();
      document.dispatchEvent(new MouseEvent("mouseup", { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      if (pt.touch < 0 || typeof Touch !== "function") return;
      try {
        const touch = new Touch({ identifier: pt.touch, target: document.body, clientX: pt.x, clientY: pt.y });
        document.dispatchEvent(new TouchEvent("touchend", { changedTouches: [touch], bubbles: true, cancelable: true }));
      } catch { /* no touch events here */ }
    };
    const move = (e: PointerEvent) => { pt.x = e.clientX; pt.y = e.clientY; };
    const touched = (e: TouchEvent) => { if (pt.touch < 0 && e.changedTouches[0]) pt.touch = e.changedTouches[0].identifier; };
    // The library's own mouseup comes straight after this; if a drag is still held a moment later, it never came.
    const up = () => { clearTimeout(t); t = window.setTimeout(() => (active.current ? finish() : off()), 80); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !active.current) return;
      e.preventDefault();
      e.stopPropagation();
      active.current.cancelled = true;
      finish();
    };
    const native = (e: DragEvent) => e.preventDefault();
    const on: [string, EventListener, boolean][] = [
      ["pointermove", move as EventListener, true], ["touchstart", touched as EventListener, true], ["pointerup", up, true],
      ["lostpointercapture", up, true], ["pointercancel", finish, true], ["dragend", finish, true], ["blur", finish, false],
      ["keydown", key as EventListener, true], ["dragstart", native as EventListener, true],
    ];
    const off = () => {
      clearTimeout(t);
      for (const [type, fn, capture] of on) window.removeEventListener(type, fn, capture);
      if (guard.current === off) guard.current = null;
    };
    for (const [type, fn, capture] of on) window.addEventListener(type, fn, capture);
    guard.current = off;
  };
  useEffect(() => () => guard.current?.(), []);

  // ----- Pointer: lift on press, long press to customize -----
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean; off: () => void } | null>(null);
  const lift = (item: HTMLElement) => {
    item.dataset.lift = "";
    const drop = () => { delete item.dataset.lift; window.removeEventListener("pointerup", drop); window.removeEventListener("pointercancel", drop); };
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
  };
  const onPress = (e: ReactPointerEvent) => {
    if (e.button) return;
    const t = e.target as HTMLElement;
    const item = t.closest<HTMLElement>(".dg");
    if (!item || t.closest(".dw-ctl")) return;
    if (t.closest(".react-resizable-handle")) { watch(e); return; }
    if (latest.current.editing) {
      if (latest.current.mode === "phone") return;
      watch(e);
      if (!touch || t.closest(".dw-grip")) lift(item);
      return;
    }
    if (t.closest(".dw-grip")) { watch(e); lift(item); return; }
    press.current?.off();
    const start = { x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse" };
    const s = { timer: 0, x: e.clientX, y: e.clientY, fired: false, off: () => {} };
    const move = (ev: PointerEvent) => { s.x = ev.clientX; s.y = ev.clientY; if (!s.fired && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) off(); };
    const up = () => {
      if (s.fired) {
        const swallow = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      }
      off();
    };
    const menu = (ev: Event) => { if (s.fired) ev.preventDefault(); };
    const off = () => {
      clearTimeout(s.timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", off);
      setTimeout(() => window.removeEventListener("contextmenu", menu, true), 0);
      if (press.current === s) press.current = null;
    };
    s.off = off;
    s.timer = window.setTimeout(() => {
      s.fired = true;
      navigator.vibrate?.(10);
      latest.current.p.onEdit();
      // A mouse still held carries straight on into a drag, as on a phone's home screen.
      if (!start.mouse || latest.current.mode === "phone") return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (press.current !== s) return;
        const target = item.querySelector<HTMLElement>(".dw");
        if (!target) return;
        watch({ clientX: s.x, clientY: s.y });
        lift(item);
        target.dispatchEvent(new MouseEvent("mousedown", { clientX: s.x, clientY: s.y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
      }));
    }, LONG_PRESS);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", off);
    window.addEventListener("contextmenu", menu, true);
    press.current = s;
  };
  useEffect(() => () => press.current?.off(), []);

  // ----- Hiding: focus goes to the tile that takes the hidden one's place, or the last one, so it never drops to the page. -----
  const refocus = useRef<{ gone: string; at: number } | null>(null);
  const hide = (id: string) => {
    const { mode: m, cells: now, p: props } = latest.current;
    refocus.current = { gone: id, at: (m === "phone" ? props.phone : orderOf(now)).indexOf(id) };
    props.onHide(id);
  };
  useLayoutEffect(() => {
    const r = refocus.current;
    if (!r || widgets.some((w) => w.id === r.gone)) return;
    refocus.current = null;
    const order = mode === "phone" ? p.phone : orderOf(cells);
    const to = order[Math.min(r.at, order.length - 1)];
    const next = to ? wrap.current?.querySelector<HTMLElement>(`.dg[data-id="${to}"] > .dw`) : null;
    (next ?? document.querySelector<HTMLElement>(".dash-bar button"))?.focus();
  });

  const api = useRef<Api>(null as unknown as Api);
  api.current = {
    key: (e, w) => {
      if (!latest.current.editing || e.target !== e.currentTarget) return;
      const dirs: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      const dir = dirs[e.key];
      if (dir) {
        e.preventDefault();
        if (latest.current.mode === "phone") { if (dir === "up" || dir === "left") step(w.id, -1); else step(w.id, 1); }
        else if (e.shiftKey) resizeKey(w, dir);
        else moveKey(w, dir);
      } else if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        latest.current.p.onDone();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        hide(w.id);
      }
    },
    edit: (id) => latest.current.p.onEdit(id),
    hide,
    options: (id, from) => latest.current.p.onOptions(id, from),
    step,
  };

  // ----- The tiles -----
  const order = useMemo(() => (mode === "phone" ? p.phone : orderOf(cells)), [mode, p.phone, cells]);
  const lg = p.cells.lg;
  const children = useMemo(() => widgets.map((w) => {
    const c = (live?.i === w.id ? live : null) ?? cells.find((x) => x.i === w.id) ?? { i: w.id, x: 0, y: 0, w: 4, h: 3 };
    const n = mode === "phone" ? 12 : cols;
    const src = mode === "phone" ? lg.find((x) => x.i === w.id) ?? c : c;
    const index = order.indexOf(w.id);
    const box: TileBox = { size: nearestSize(w.kind, src.w, src.h, n), span: mode === "phone" ? 1 : c.w, rows: src.h, cols };
    const title = titleOf(w);
    return (
      <div key={w.id} className="dg" data-id={w.id} data-heavy={KINDS[w.kind].heavy ? "" : undefined}>
        <Tile
          w={w} box={box} title={title} editing={editing} phone={mode === "phone"} render={render} api={api}
          label={`${title}, ${sizeLabel(w.kind, src.w, src.h, n)}, place ${index + 1} of ${order.length}`}
          first={index === 0} last={index === order.length - 1} motion={wobble(Math.max(0, index), c.w, c.h)}
        />
      </div>
    );
  }), [widgets, cells, lg, live, mode, cols, order, editing, render, titleOf]);

  const gridConfig = useMemo(() => ({ cols, rowHeight: row, margin: [gap, gap] as [number, number], containerPadding: [0, 0] as [number, number] }), [cols, row, gap]);
  const dragConfig = useMemo(() => ({ enabled: true, handle: editing && !touch ? undefined : ".dw-grip", cancel: ".dw-ctl", threshold: 4 }), [editing, touch]);
  const resizeConfig = useMemo(() => ({
    enabled: true,
    handles: ["se", "e", "s"] as ResizeHandleAxis[],
    handleComponent: (axis: ResizeHandleAxis, ref: Ref<HTMLElement>) => <span ref={ref as Ref<HTMLSpanElement>} className={`react-resizable-handle ${HANDLE[axis] ?? "dw-rh"}`} aria-hidden="true" />,
  }), []);
  const layout = useMemo(() => withLimits(cells, cols), [cells, cols]);
  const position = useMemo(() => (zoom === 1 ? transformStrategy : { ...transformStrategy, scale: zoom }), [zoom]);
  // The library redraws a tile only when its props change; a fresh element for the dragged one lets it track the pointer.
  // A resized tile still snaps from cell to cell, so its content always fits the size it shows.
  const held = active.current?.type === "drag" ? active.current.id : null;

  return (
    <div
      ref={wrap} className={`dash${editing ? " editing" : ""}`} data-cols={cols} style={{ "--dgap": `${gap}px`, "--row": `${row}px` } as CSSProperties}
      onPointerDown={onPress} onDragStart={editing ? (e) => e.preventDefault() : undefined}
    >
      <div ref={spot} className="dash-spot" aria-hidden="true" />
      {mode === "phone" ? (
        p.phone.map((id) => children.find((c) => c.key === id)).filter(Boolean)
      ) : measured ? (
        <GridLayout
          className="dash-grid" width={gridWidth} layout={layout} compactor={compactor} positionStrategy={position}
          gridConfig={gridConfig} dragConfig={dragConfig} resizeConfig={resizeConfig}
          onDragStart={calls.onDragStart} onDrag={calls.onDrag} onDragStop={calls.onDragStop}
          onResizeStart={calls.onResizeStart} onResize={calls.onResize} onResizeStop={calls.onResizeStop}
        >
          {held ? children.map((c) => (isValidElement(c) && c.key === held ? cloneElement(c) : c)) : children}
        </GridLayout>
      ) : null}
    </div>
  );
}
