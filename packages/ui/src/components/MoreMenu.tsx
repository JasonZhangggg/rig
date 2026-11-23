import { useEffect, useRef, useState, type ReactNode } from "react";
import { arrowKeys, focusFirstItem } from "./modal";

export interface MoreItem { label: string; run: () => void; danger?: boolean }

const Dots = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="15.5" cy="10" r="1.5" /></svg>
);

/**
 * A three-dots button with a short menu of the things people do less often, like replacing or removing.
 * A click outside or Escape closes it; Escape is used up here, so the page under it stays as it was.
 */
export function MoreMenu({ label, items, children }: { label: string; items: MoreItem[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("click", click);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("click", click); document.removeEventListener("keydown", key, true); };
  }, [open]);
  return (
    <div className="more" ref={box}>
      <button ref={btn} type="button" className="more-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Dots /></button>
      {open && (
        <div className="sh-menu more-menu" role="menu" aria-label={label} ref={focusFirstItem} onKeyDown={arrowKeys("menuitem")}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? "is-danger" : undefined} onClick={() => { setOpen(false); it.run(); }}>{it.label}</button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
