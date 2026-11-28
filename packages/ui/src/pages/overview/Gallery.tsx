import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KINDS, kindBlurb, kindTitle, presetCells, type Kind, type Widget } from "./layout";
import { useMachineWord } from "../../state";
import type { TileBox } from "./widgets";

/** Where a widget is being dragged to, in screen pixels, or null once it leaves the page. */
export type Point = { x: number; y: number };

/** Shelves of the library, so a long list reads in a few groups. A kind with no shelf here goes under More. */
const shelvesFor = (word: string): [string, Kind[]][] => [
  [`Your ${word}`, ["pc", "health", "todo", "live", "parts", "asks"]],
  ["Heat and fans", ["temps", "fans", "trend", "evenings"]],
  ["Storage", ["storage", "drives"]],
  ["What happened", ["changes", "events", "logs", "games"]],
  ["Parts and upkeep", ["upgrade", "drivers", "manuals"]],
];

/** The tile sizes the previews are drawn at: the Home grid's own, read off the page, so a preview looks like the real thing. */
function gridSize() {
  const el = document.querySelector<HTMLElement>(".f-home .dash");
  const n = (v: string | undefined, d: number) => { const x = parseFloat(v ?? ""); return Number.isFinite(x) && x > 0 ? x : d; };
  const cols = Number(el?.dataset.cols);
  return {
    width: cols >= 8 ? Math.max(900, el!.clientWidth) : 1100,
    row: n(el?.style.getPropertyValue("--row"), 80),
    gap: n(el?.style.getPropertyValue("--dgap"), 24),
  };
}

const FRAME_H = 172;

/** One widget drawn as it would sit on Home, shrunk to fit its card. It can't be pressed or focused. */
const Preview = memo(function Preview({ w, frame, render }: { w: Widget; frame: number; render: (w: Widget, box: TileBox) => ReactNode }) {
  const g = useMemo(gridSize, []);
  const kind = w.kind;
  const word = useMachineWord();
  const [cw, ch] = presetCells(kind, KINDS[kind].size, 12);
  const colW = (g.width - g.gap * 11) / 12;
  const width = cw * colW + (cw - 1) * g.gap, height = ch * g.row + (ch - 1) * g.gap;
  const scale = Math.min((frame - 28) / width, (FRAME_H - 28) / height, 0.75);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { body.current?.setAttribute("inert", ""); }, []);
  if (KINDS[kind].heavy) {
    return (
      <div className="dgal-still" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"><path d="M18 8h28v48H18z" /><path d="M24 16h16M24 22h16" strokeLinecap="round" /><circle cx="32" cy="40" r="7" /></svg>
        <span>Your {word} in 3D, part by part</span>
      </div>
    );
  }
  const box: TileBox = { size: KINDS[kind].size, span: cw, rows: ch, cols: 12 };
  return (
    <div className="dgal-scale" aria-hidden="true" style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` } as CSSProperties}>
      <div className={`dw${w.tone === "dark" ? " tone-dark" : ""}`} data-kind={kind} data-frame={w.tone === "dark" ? "tile" : w.frame} data-size={box.size}>
        <div className="dw-body" ref={body}>{render(w, box)}</div>
      </div>
    </div>
  );
});

const Plus = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const Grab = () => <svg viewBox="0 0 20 12" aria-hidden="true">{[4, 10, 16].flatMap((x) => [3, 9].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}</svg>;
const focusable = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface GalleryProps {
  hidden: Widget[];
  render: (w: Widget, box: TileBox) => ReactNode;
  /** Whether a widget can be dragged onto Home: a grid on screen and a mouse or pen to drag with. */
  canDrag: boolean;
  /** The control that opened the library, which gets focus back when it closes. */
  from: HTMLElement | null;
  onAdd: (id: string) => void;
  onClose: () => void;
  /** A widget held over the page, or null when it leaves. */
  onHover: (id: string, at: Point | null) => void;
  /** A widget let go at a point, or put back with null. True when it landed on Home. */
  onDrop: (id: string, at: Point | null) => boolean;
}

/**
 * Every widget that isn't on Home, drawn as it would look there, in a few shelves. Add puts one on Home and shows it;
 * on a grid a widget can also be dragged out and dropped where it should go, while the library steps out of the way.
 */
export function Gallery({ hidden, render, canDrag, from, onAdd, onClose, onHover, onDrop }: GalleryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const word = useMachineWord();
  const [frame, setFrame] = useState(320);
  const [held, setHeld] = useState<{ id: string; x: number; y: number } | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const shut = useRef(onClose), back = useRef(from);
  shut.current = onClose; back.current = from;

  // The previews take the width of a card, whatever the window does.
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const read = () => { const card = el.querySelector<HTMLElement>(".dgal-prev"); if (card?.clientWidth) setFrame(card.clientWidth); };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hidden.length > 0]);

  // Focus goes to the library when it opens, and back to the opener when it closes.
  // Tab stays inside; Escape shuts it.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    return () => { const a = back.current; if (a?.isConnected) a.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); if (!drag.current) shut.current(); return; }
      const el = ref.current;
      if (e.key !== "Tab" || !el) return;
      const all = [...el.querySelectorAll<HTMLElement>(focusable)];
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1], now = document.activeElement;
      const inside = !!now && el.contains(now);
      if (e.shiftKey && (now === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (now === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, []);

  // Adding with the button keeps the library open for the next one, with focus on the card that takes its place.
  const next = useRef<number | null>(null);
  useLayoutEffect(() => {
    const i = next.current;
    next.current = null;
    if (i === null || !ref.current) return;
    const left = [...ref.current.querySelectorAll<HTMLElement>(".dgal-meta .dbtn")];
    (left[Math.min(i, left.length - 1)] ?? ref.current).focus({ preventScroll: true });
  }, [hidden]);
  const add = (id: string, btn: HTMLElement) => {
    next.current = [...(ref.current?.querySelectorAll(".dgal-meta .dbtn") ?? [])].indexOf(btn);
    onAdd(id);
  };

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (w: Widget) => { const text = `${kindTitle(w.kind, word)} ${kindBlurb(w.kind, word)}`.toLowerCase(); return words.every((x) => text.includes(x)); };
  const shelves = useMemo(() => {
    const all = shelvesFor(word);
    const out: [string, Widget[]][] = all.map(([t, kinds]) => [t, hidden.filter((w) => kinds.includes(w.kind))]);
    const rest = hidden.filter((w) => !all.some(([, kinds]) => kinds.includes(w.kind)));
    return [...out, ["More", rest] as [string, Widget[]]];
  }, [hidden, word]);
  const shown = shelves.map(([t, list]) => [t, list.filter(matches)] as const).filter(([, list]) => list.length);

  // ----- Dragging a widget out onto Home -----
  const drag = useRef<{ id: string; off: () => void } | null>(null);
  useEffect(() => () => { const d = drag.current; d?.off(); if (d) onHover(d.id, null); }, []);
  const press = (e: ReactPointerEvent, id: string) => {
    if (!canDrag || e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest("button")) return;
    // Held down, a card drags rather than starting a text selection.
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let live = false, pt = start, raf = 0, last = 0, carry = 0;
    const edge = (t: number) => {
      // Near the top or bottom of the window the page scrolls, faster the closer the pointer is, so any spot can be reached.
      const dt = last ? Math.min(32, t - last) : 16;
      last = t;
      const vh = window.innerHeight, zone = Math.min(90, vh / 6);
      const into = pt.y < zone ? (pt.y - zone) / zone : pt.y > vh - zone ? (pt.y - (vh - zone)) / zone : 0;
      if (into) {
        carry += Math.sign(into) * Math.min(1, Math.abs(into)) ** 2 * 1.2 * dt;
        const step = Math.trunc(carry);
        if (step) { carry -= step; window.scrollBy({ top: step, behavior: "instant" }); onHover(id, pt); }
      } else carry = 0;
      raf = requestAnimationFrame(edge);
    };
    const move = (ev: PointerEvent) => {
      // A release the page never heard about, say over another window, ends the drag where the pointer is.
      if (!ev.buttons) { up(); return; }
      pt = { x: ev.clientX, y: ev.clientY };
      if (!live) {
        if (Math.hypot(pt.x - start.x, pt.y - start.y) < 6) return;
        live = true;
        document.documentElement.dataset.placing = "";
        raf = requestAnimationFrame(edge);
        setHeld({ id, ...pt });
      }
      ev.preventDefault();
      // The ghost follows the pointer without a render, so the previews stay put.
      if (ghost.current) ghost.current.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
      onHover(id, pt);
    };
    const finish = (at: Point | null) => {
      off();
      if (!live) return;
      setHeld(null);
      if (!onDrop(id, at)) ref.current?.querySelector<HTMLElement>(`[data-kind="${id}"] .dgal-meta .dbtn`)?.focus({ preventScroll: true });
    };
    const up = () => finish(pt);
    const cancel = () => finish(null);
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancel(); } };
    const off = () => {
      cancelAnimationFrame(raf);
      delete document.documentElement.dataset.placing;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    drag.current = { id, off };
  };

  return createPortal(
    <>
      <div className="dgal-scrim" data-away={held ? "" : undefined} aria-hidden="true" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dgal-title" className="dgal" data-away={held ? "" : undefined}>
        <div className="dgal-head">
          <div className="dgal-title">
            <h2 id="dgal-title">Add widget</h2>
            <p>{canDrag ? "Drag a widget to where you want it on Home, or press Add." : "Press Add and the widget goes at the end of Home."}</p>
          </div>
          <button type="button" className="dpop-x" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
          {hidden.length > 3 && (
            <label className="dgal-find">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              <input type="search" value={query} placeholder="Find a widget" aria-label="Find a widget" onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
        </div>
        <div className="dgal-body" ref={grid}>
          {!hidden.length ? (
            <p className="dnote">Every widget is on Home. Hide one from its options and it waits here.</p>
          ) : !shown.length ? (
            <p className="dnote">No widget matches “{query.trim()}”.</p>
          ) : shown.map(([title, list]) => (
            <section key={title} className="dgal-shelf" aria-label={title}>
              <h3>{title}</h3>
              <ul>
                {list.map((w) => (
                  <li key={w.id} className="dgal-card" data-kind={w.id} data-drag={canDrag ? "" : undefined} data-held={held?.id === w.id ? "" : undefined} onPointerDown={(e) => press(e, w.id)}>
                    <div className="dgal-prev"><Preview w={w} frame={frame} render={render} /></div>
                    <div className="dgal-meta">
                      <span><b>{kindTitle(w.kind, word)}</b><small>{kindBlurb(w.kind, word)}</small></span>
                      <button type="button" className="dbtn" aria-label={`Add ${kindTitle(w.kind, word)}`} onClick={(e) => add(w.id, e.currentTarget)}><Plus />Add</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      {held && (
        <div ref={ghost} className="dgal-ghost" aria-hidden="true" style={{ transform: `translate(${held.x}px, ${held.y}px)` }}>
          <Grab /><span>{kindTitle(hidden.find((w) => w.id === held.id)?.kind ?? "storage", word)}</span>
        </div>
      )}
    </>,
    document.body,
  );
}
