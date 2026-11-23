import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MARGIN = 12;
const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The page's CSS zoom from Settings > Text size: rects come back zoomed, while the panel's own top and left are zoomed again. */
const zoomOf = (el: Element) => (el as Element & { currentCSSZoom?: number }).currentCSSZoom ?? (parseFloat(getComputedStyle(document.documentElement).zoom) || 1);

/**
 * A panel beside the control that opened it, on the body so no tile clips it, following the control as it moves.
 * On a phone it rises from the bottom over a dimmed page. Tab stays inside it; Escape, a press outside or the close
 * button shut it and put focus back on the control.
 */
export function Popover({ anchor, label, onClose, children, width = 360 }: { anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [sheet, setSheet] = useState(false);

  useLayoutEffect(() => {
    let last = "", frame = 0;
    const place = () => {
      const z = zoomOf(document.body);
      const vw = window.innerWidth / z, vh = window.innerHeight / z;
      if (vw < 560) {
        if (last !== "sheet") { last = "sheet"; setSheet(true); setPos(null); }
        return;
      }
      if (!anchor.isConnected) return;
      const r = anchor.getBoundingClientRect();
      const a = { top: r.top / z, bottom: r.bottom / z, right: r.right / z };
      const h = ref.current?.offsetHeight ?? 400;
      const left = Math.min(Math.max(MARGIN, a.right - width), vw - width - MARGIN);
      const below = vh - a.bottom - MARGIN * 2, above = a.top - MARGIN * 2;
      const down = below >= Math.min(h, 420) || below >= above;
      const maxHeight = Math.max(240, down ? below : above);
      const top = down ? a.bottom + 8 : Math.max(MARGIN, a.top - 8 - Math.min(h, maxHeight));
      const key = `${Math.round(top)} ${Math.round(left)} ${Math.round(maxHeight)}`;
      if (key === last) return;
      last = key;
      setSheet(false);
      setPos({ top, left, maxHeight });
    };
    // The control can move with no scroll or resize (a tile gliding to its new place), so the panel looks every frame it's open.
    const loop = () => { place(); frame = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [anchor, width]);

  // The latest control and close, so a control that changes under an open panel (the empty Home's Add widget button giving
  // way to the bar's) neither pulls focus back to the panel's first button nor drops it.
  const at = useRef(anchor), shut = useRef(onClose);
  at.current = anchor; shut.current = onClose;

  // Focus goes into the panel once, when it opens, and back to the control that opened it when it closes.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(focusable)?.focus();
    return () => { const a = at.current; if (a.isConnected) a.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); shut.current(); return; }
      const el = ref.current;
      if (e.key !== "Tab" || !el) return;
      const all = [...el.querySelectorAll<HTMLElement>(focusable)];
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1], now = document.activeElement;
      const inside = !!now && el.contains(now);
      if (e.shiftKey && (now === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (now === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    // A press outside a panel beside its control shuts it. The phone's sheet shuts on a tap of the dimmed page instead,
    // once the tap is over, so the tap never lands on whatever was under the dimming.
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !at.current.contains(t)) shut.current(); };
    document.addEventListener("keydown", key, true);
    if (!sheet) document.addEventListener("pointerdown", down, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  }, [sheet]);

  return createPortal(
    <>
      {sheet && <div className="dpop-scrim" aria-hidden="true" onClick={onClose} />}
      <div
        ref={ref} role="dialog" aria-modal={sheet || undefined} aria-label={label} className={`dpop${sheet ? " sheet" : ""}`}
        style={sheet ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? 0, width, maxHeight: pos?.maxHeight }}
      >
        <div className="dpop-head">
          <h2>{label}</h2>
          <button type="button" className="dpop-x" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="dpop-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}
