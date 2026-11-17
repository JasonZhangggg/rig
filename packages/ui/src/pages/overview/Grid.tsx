import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { SIZE_LABEL, columnsFor, fitSize, nearestSize, place, sizeOf, spanFor, stepSize, type Box, type SizeName, type Widget } from "./layout";
import type { TileBox } from "./widgets";

/** How far a press has to travel before it becomes a drag, so a click stays a click. */
const SLOP = 5;
const EDGE = 72;
const PH = "__placeholder";

type Drag =
  | { mode: "move"; id: string; order: string[]; size: SizeName }
  | { mode: "resize"; id: string; size: SizeName };

interface Rect { x: number; y: number; w: number; h: number }

export interface GridProps {
  widgets: Widget[];
  editing: boolean;
  compact: boolean;
  gap: number;
  titleOf: (w: Widget) => string;
  render: (w: Widget, box: TileBox) => ReactNode;
  onMove: (id: string, to: number, size?: SizeName) => void;
  onResize: (id: string, size: SizeName) => void;
  onOptions: (id: string, from: HTMLElement) => void;
  onEdit: (id: string) => void;
  onDone: () => void;
  announce: (text: string) => void;
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollerOf(el: HTMLElement | null): HTMLElement {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

const Grip = () => <svg viewBox="0 0 20 12" aria-hidden="true">{[4, 10, 16].flatMap((x) => [3, 9].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}</svg>;
const Dots = () => <svg viewBox="0 0 20 20" aria-hidden="true">{[4.5, 10, 15.5].map((x) => <circle key={x} cx={x} cy="10" r="1.9" fill="currentColor" />)}</svg>;
const Up = ({ down }: { down?: boolean }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={down ? "M5 8l5 5 5-5" : "M5 12l5-5 5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const Content = memo(function Content({ w, size, span, rows, cols, render }: { w: Widget; size: SizeName; span: number; rows: number; cols: number; render: GridProps["render"] }) {
  return <>{render(w, { size, span, rows, cols })}</>;
});

/** Widgets on a 12 column grid. Drag a tile to move it, its corner to resize it; neighbours slide out of the way. */
export function Grid(p: GridProps) {
  const { widgets, editing, compact, gap, titleOf, render } = p;
  const gridRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const cols = width ? columnsFor(width) : 12;
  const row = Math.round((width >= 1500 ? 88 : 80) * (compact ? 0.82 : 1));

  useLayoutEffect(() => {
    const el = gridRef.current!;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = new Map(widgets.map((w) => [w.id, w]));
  const items: Widget[] = drag?.mode === "move"
    ? drag.order.flatMap((id) => { const w = byId.get(id); return w ? [id === drag.id ? { ...w, size: drag.size } : w] : []; })
    : drag?.mode === "resize" ? widgets.map((w) => (w.id === drag.id ? { ...w, size: drag.size } : w)) : widgets;
  const boxes = place(items, cols);

  // ----- Motion: each tile slides from where it was seen to where it now sits. -----
  const rest = useRef(new Map<string, Rect>());
  const seen = useRef<Map<string, Rect> | null>(null);
  const focusAfter = useRef<string | null>(null);

  /** Where every tile is on screen right now, mid-slide included, so the next layout starts from there. */
  const snapshot = () => {
    const g = gridRef.current?.getBoundingClientRect();
    if (!g) return;
    const m = new Map<string, Rect>();
    els.current.forEach((el, id) => { const r = el.getBoundingClientRect(); m.set(id, { x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height }); });
    seen.current = m;
  };

  useLayoutEffect(() => {
    const from = seen.current;
    seen.current = null;
    const still = reduced();
    const next = new Map<string, Rect>();
    els.current.forEach((el, id) => {
      const to = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      next.set(id, to);
      if (drag?.mode === "move" && id === drag.id) return;
      const a = from?.get(id) ?? rest.current.get(id);
      if (still || !a || typeof el.animate !== "function") return;
      const dx = a.x - to.x, dy = a.y - to.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.getAnimations().forEach((an) => an.cancel());
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(.23, 1, .32, 1)" });
    });
    rest.current = next;
    if (focusAfter.current) { els.current.get(focusAfter.current)?.focus({ preventScroll: false }); focusAfter.current = null; }
  });

  // ----- Pointer -----
  const live = useRef({ items, cols, row, gap, widgets, drag, boxes });
  live.current = { items, cols, row, gap, widgets, drag, boxes };
  const session = useRef<{ id: string; mode: "move" | "resize"; x: number; y: number; started: boolean; offX: number; offY: number; w: number; h: number; base: Rect; lastAt: number; prev: string } | null>(null);
  const outline = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const setFloat = () => {
    const s = session.current, el = s && els.current.get(s.id), g = gridRef.current?.getBoundingClientRect();
    if (!s || !el || !g) return;
    if (s.mode === "move") {
      el.style.left = `${pointer.current.x - g.left - s.offX}px`;
      el.style.top = `${pointer.current.y - g.top - s.offY}px`;
    } else if (outline.current) {
      outline.current.style.width = `${Math.max(80, pointer.current.x - g.left - s.base.x)}px`;
      outline.current.style.height = `${Math.max(80, pointer.current.y - g.top - s.base.y)}px`;
    }
  };

  /** Moves the placeholder to the slot under the pointer: before or after the tile it's over, by which half. */
  const hitTest = () => {
    const s = session.current, { drag: d, cols: c, widgets: all } = live.current;
    if (!s || d?.mode !== "move") return;
    const { x, y } = pointer.current;
    const others = d.order.filter((id) => id !== d.id);
    let over: string | null = null, after = false;
    for (const id of [...others, PH]) {
      const el = els.current.get(id);
      const r = el?.getBoundingClientRect();
      if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      over = id;
      after = c > 1 ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
      break;
    }
    if (over === PH) return;
    let next: string[];
    if (over) {
      next = [...others];
      next.splice(next.indexOf(over) + (after ? 1 : 0), 0, d.id);
    } else {
      const g = gridRef.current!.getBoundingClientRect();
      const bottom = Math.max(g.top, ...others.map((id) => els.current.get(id)?.getBoundingClientRect().bottom ?? 0));
      if (y > bottom) next = [...others, d.id];
      else if (y < g.top) next = [d.id, ...others];
      else return;
    }
    const key = next.join();
    if (key === d.order.join()) return;
    if (key === s.prev && performance.now() - s.lastAt < 160) return;
    s.prev = d.order.join();
    s.lastAt = performance.now();
    const orig = all.find((w) => w.id === d.id)!;
    const trial = next.flatMap((id) => all.filter((v) => v.id === id));
    const size = fitSize(trial.map((w) => (w.id === d.id ? orig : w)), d.id, c);
    snapshot();
    setDrag({ mode: "move", id: d.id, order: next, size });
  };

  const resizeTest = () => {
    const s = session.current, { drag: d, cols: c, row: rh, gap: gp, widgets: all } = live.current;
    const g = gridRef.current;
    if (!s || !g || d?.mode !== "resize") return;
    const gr = g.getBoundingClientRect();
    const colW = (g.clientWidth - gp * (c - 1)) / c;
    const rawW = pointer.current.x - gr.left - s.base.x, rawH = pointer.current.y - gr.top - s.base.y;
    const me = all.find((w) => w.id === d.id)!;
    const size = nearestSize(me.kind, (rawW + gp) / (colW + gp), (rawH + gp) / (rh + gp), c);
    if (size !== d.size) { snapshot(); setDrag({ mode: "resize", id: d.id, size }); }
  };

  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const scroller = scrollerOf(gridRef.current);
    const tick = () => {
      const { y } = pointer.current, vh = window.innerHeight;
      const v = y < EDGE ? -(EDGE - y) / 3 : y > vh - EDGE ? (y - (vh - EDGE)) / 3 : 0;
      if (v) { scroller.scrollTop += v; setFloat(); if (session.current?.mode === "move") hitTest(); else resizeTest(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag?.id, drag?.mode]);

  useLayoutEffect(setFloat);

  const finish = (commit: boolean) => {
    const s = session.current, d = live.current.drag;
    session.current = null;
    stop();
    if (!s) return;
    if (!s.started) { if (!editing && s.mode === "move") p.onEdit(s.id); return; }
    snapshot();
    const el = els.current.get(s.id);
    if (el) { el.style.left = ""; el.style.top = ""; }
    setDrag(null);
    const me = live.current.widgets.find((w) => w.id === s.id)!;
    const title = titleOf(me);
    if (commit && d?.mode === "move") {
      const to = d.order.indexOf(s.id);
      const was = live.current.widgets.findIndex((w) => w.id === s.id);
      if (to !== was || d.size !== me.size) {
        p.onMove(s.id, to, d.size !== me.size ? d.size : undefined);
        p.announce(`${title} moved to place ${to + 1} of ${d.order.length}${d.size !== me.size ? `, now ${SIZE_LABEL[d.size]}` : ""}.`);
      }
    } else if (commit && d?.mode === "resize" && d.size !== me.size) {
      p.onResize(s.id, d.size);
      p.announce(`${title} is now ${SIZE_LABEL[d.size]}.`);
    }
  };

  const onMove = (e: PointerEvent) => {
    const s = session.current;
    if (!s) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (!s.started) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < SLOP) return;
      s.started = true;
      const el = els.current.get(s.id)!, r = el.getBoundingClientRect(), g = gridRef.current!.getBoundingClientRect();
      s.offX = s.x - r.left; s.offY = s.y - r.top; s.w = r.width; s.h = r.height;
      s.base = { x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height };
      const me = live.current.widgets.find((w) => w.id === s.id)!;
      snapshot();
      setDrag(s.mode === "move" ? { mode: "move", id: s.id, order: live.current.widgets.map((w) => w.id), size: me.size } : { mode: "resize", id: s.id, size: me.size });
      return;
    }
    e.preventDefault();
    setFloat();
    if (s.mode === "move") hitTest(); else resizeTest();
  };
  const handlers = useRef({ onMove, finish });
  handlers.current = { onMove, finish };
  const [listen] = useState(() => ({
    move: (e: PointerEvent) => handlers.current.onMove(e),
    up: () => handlers.current.finish(true),
    cancel: () => handlers.current.finish(false),
  }));
  const stop = () => {
    window.removeEventListener("pointermove", listen.move);
    window.removeEventListener("pointerup", listen.up);
    window.removeEventListener("pointercancel", listen.cancel);
  };

  const start = (e: ReactPointerEvent, id: string, mode: "move" | "resize") => {
    if (e.button !== 0 || session.current) return;
    e.stopPropagation();
    if (mode === "resize") e.preventDefault();
    session.current = { id, mode, x: e.clientX, y: e.clientY, started: false, offX: 0, offY: 0, w: 0, h: 0, base: { x: 0, y: 0, w: 0, h: 0 }, lastAt: 0, prev: "" };
    pointer.current = { x: e.clientX, y: e.clientY };
    window.addEventListener("pointermove", listen.move, { passive: false });
    window.addEventListener("pointerup", listen.up);
    window.addEventListener("pointercancel", listen.cancel);
  };

  useEffect(() => () => { session.current = null; stop(); }, []);

  // ----- Keyboard -----
  const moveBy = (w: Widget, to: number) => {
    const n = widgets.length;
    const at = Math.max(0, Math.min(n - 1, to));
    const from = widgets.findIndex((v) => v.id === w.id);
    if (at === from) { p.announce(at === 0 ? `${titleOf(w)} is already first.` : `${titleOf(w)} is already last.`); return; }
    snapshot();
    focusAfter.current = w.id;
    p.onMove(w.id, at);
    p.announce(`${titleOf(w)} moved to place ${at + 1} of ${n}.`);
  };

  /** The place of the tile straight above or below, so up and down move a row at a time. */
  const rowTarget = (w: Widget, dir: -1 | 1) => {
    const me = boxes.get(w.id)!;
    const mid = me.x + me.w / 2;
    let best = dir < 0 ? 0 : widgets.length - 1, cost = Infinity;
    widgets.forEach((v, i) => {
      const b = boxes.get(v.id);
      if (!b || v.id === w.id || !(dir < 0 ? b.y + b.h <= me.y : b.y >= me.y + me.h)) return;
      const c = Math.abs(b.y - me.y) * 100 + Math.abs(b.x + b.w / 2 - mid);
      if (c < cost) { cost = c; best = i; }
    });
    return best;
  };

  const onKey = (e: ReactKeyboardEvent, w: Widget) => {
    if (!editing || e.target !== e.currentTarget) return;
    const i = widgets.findIndex((v) => v.id === w.id);
    const arrows: Record<string, "wider" | "narrower" | "taller" | "shorter"> = { ArrowRight: "wider", ArrowLeft: "narrower", ArrowDown: "taller", ArrowUp: "shorter" };
    if (e.key in arrows && e.shiftKey) {
      e.preventDefault();
      const size = stepSize(w, arrows[e.key]);
      if (size === w.size) { p.announce(`${titleOf(w)} can't get any ${arrows[e.key]}.`); return; }
      snapshot();
      focusAfter.current = w.id;
      p.onResize(w.id, size);
      p.announce(`${titleOf(w)} is now ${SIZE_LABEL[size]}.`);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      moveBy(w, i + (e.key === "ArrowLeft" ? -1 : 1));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      moveBy(w, cols > 1 ? rowTarget(w, e.key === "ArrowUp" ? -1 : 1) : i + (e.key === "ArrowUp" ? -1 : 1));
    } else if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      p.onDone();
    }
  };

  const inert = useCallback((el: HTMLDivElement | null) => { if (el) { if (editing) el.setAttribute("inert", ""); else el.removeAttribute("inert"); } }, [editing]);

  const placeholder = drag?.mode === "move" ? boxes.get(drag.id) : undefined;
  const floatSize = session.current;
  const one = cols === 1;
  const area = (b: Box | undefined): CSSProperties => (one || !b ? {} : { gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / span ${b.h}` });

  return (
    <div
      ref={gridRef} className={`dash${editing ? " editing" : ""}${drag ? " dragging" : ""}`} data-cols={cols}
      style={{ "--cols": cols, "--row": `${row}px`, "--dgap": `${gap}px` } as CSSProperties}
    >
      {items.map((w) => {
        const b = boxes.get(w.id);
        const lifted = drag?.mode === "move" && drag.id === w.id;
        const resizing = drag?.mode === "resize" && drag.id === w.id;
        const title = titleOf(w);
        const [w12, h] = sizeOf(w);
        const span = one ? 1 : spanFor(w12, cols);
        const style: CSSProperties = lifted && floatSize
          ? { position: "absolute", width: floatSize.w, height: floatSize.h, zIndex: 30, gridArea: "auto" }
          : area(b);
        const i = widgets.findIndex((v) => v.id === w.id);
        return (
          <div
            key={w.id}
            ref={(el) => { if (el) els.current.set(w.id, el); else els.current.delete(w.id); }}
            className={`dw${w.tone === "dark" ? " tone-dark" : ""}`}
            data-kind={w.kind} data-frame={w.tone === "dark" ? "tile" : w.frame} data-size={w.size} data-drag={lifted ? "move" : resizing ? "resize" : undefined}
            style={style}
            tabIndex={editing ? 0 : undefined}
            role={editing ? "group" : undefined}
            aria-roledescription={editing ? "widget" : undefined}
            aria-label={editing ? `${title}, ${SIZE_LABEL[w.size]}, place ${i + 1} of ${widgets.length}` : undefined}
            aria-describedby={editing ? "dash-keys" : undefined}
            onKeyDown={(e) => onKey(e, w)}
            onPointerDown={editing ? (e) => { if (e.pointerType !== "touch") start(e, w.id, "move"); } : undefined}
          >
            <div className="dw-body" ref={inert}>
              <Content w={w} size={w.size} span={span} rows={h} cols={cols} render={render} />
            </div>
            <button
              type="button" className="dw-grip" aria-label={editing ? `Drag to move ${title}` : `Move ${title}`} title={editing ? "Drag to move" : "Drag to move, or press to customize"}
              tabIndex={editing ? -1 : 0}
              onPointerDown={(e) => start(e, w.id, "move")}
              onClick={(e) => { if (e.detail === 0 && !editing) p.onEdit(w.id); }}
            ><Grip /></button>
            {editing && (
              <button type="button" className="dw-opt" aria-label={`${title} options`} title="Options" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => p.onOptions(w.id, e.currentTarget)}><Dots /></button>
            )}
            {editing && !one && <span className="dw-size" aria-hidden="true" title="Drag to resize" onPointerDown={(e) => start(e, w.id, "resize")} />}
            {editing && one && (
              <div className="dw-steps" onPointerDown={(e) => e.stopPropagation()}>
                <button type="button" aria-label={`Move ${title} up`} disabled={i === 0} onClick={() => moveBy(w, i - 1)}><Up /></button>
                <button type="button" aria-label={`Move ${title} down`} disabled={i === widgets.length - 1} onClick={() => moveBy(w, i + 1)}><Up down /></button>
              </div>
            )}
          </div>
        );
      })}
      {placeholder && floatSize && (
        <div
          key={PH} ref={(el) => { if (el) els.current.set(PH, el); else els.current.delete(PH); }}
          className="dw-ph" aria-hidden="true"
          style={{ ...area(placeholder), ...(one ? { height: floatSize.h } : {}) }}
        />
      )}
      {drag?.mode === "resize" && floatSize && (
        <div ref={outline} className="dw-outline" aria-hidden="true" style={{ left: floatSize.base.x, top: floatSize.base.y, width: floatSize.base.w, height: floatSize.base.h }} />
      )}
    </div>
  );
}
