import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MARGIN = 12;
const focusable = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A panel beside the control that opened it, on the body so no tile clips it. On a phone it rises from the bottom.
 * Escape, a press outside or the close button shut it and put focus back on the control.
 */
export function Popover({ anchor, label, onClose, children, width = 360 }: { anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [sheet, setSheet] = useState(false);

  useLayoutEffect(() => {
    const place = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      if (vw < 560) { setSheet(true); setPos(null); return; }
      setSheet(false);
      const a = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 400;
      const left = Math.min(Math.max(MARGIN, a.right - width), vw - width - MARGIN);
      const below = vh - a.bottom - MARGIN * 2, above = a.top - MARGIN * 2;
      const down = below >= Math.min(h, 420) || below >= above;
      const maxHeight = Math.max(240, down ? below : above);
      const top = down ? a.bottom + 8 : Math.max(MARGIN, a.top - 8 - Math.min(h, maxHeight));
      setPos({ top, left, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, width]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(focusable)?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !anchor.contains(t)) onClose(); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); if (anchor.isConnected) anchor.focus(); };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref} role="dialog" aria-label={label} className={`dpop${sheet ? " sheet" : ""}`}
      style={sheet ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? 0, width, maxHeight: pos?.maxHeight }}
    >
      <div className="dpop-head">
        <h2>{label}</h2>
        <button type="button" className="dpop-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="dpop-body">{children}</div>
    </div>,
    document.body,
  );
}
