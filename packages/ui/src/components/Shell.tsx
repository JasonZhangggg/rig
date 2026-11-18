import { useEffect } from "react";
import type { Route } from "@rig/core";
import { useApp } from "../state";
import { DiffTable } from "./common";

/** Every page, for the sidebar and Ctrl K. Upgrades, Games and Temperatures are parts of other pages now (see homeOf), so only Ctrl K lists them. */
export const navItems: [Route, string, string][] = [
  ["overview", "Home", "M3 10.5 10 4l7 6.5V17H3z"],
  ["pc", "My PC", "M6 3h8v14H6zM9 6h2M9 14h2"],
  ["chat", "Ask", "M4 5h12v8H9l-4 3v-3H4z"],
  ["changes", "Changes", "M4 10a6 6 0 1 0 2-4.5M4 4v3h3M10 7v3l2 2"],
  ["upgrades", "Upgrades", "M10 16V5M5.5 9.5 10 5l4.5 4.5"],
  ["games", "Games", "M4 8h12v6H4zM7 10v2M6 11h2M13 11h.01M15 11h.01"],
  ["history", "Temperatures", "M3 15l4-5 3 3 5-7M3 17h14"],
  ["logs", "Logs", "M5 3h7l3 3v11H5zM12 3v3h3M8 10h4M8 13h4"],
  ["settings", "Settings", "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4"],
];

/** The page a route lives on in the sidebar: upgrades and manuals are on My PC, temperatures and games are views of Logs. */
export const homeOf = (r: Route): Route => (r === "upgrades" || r === "manuals" ? "pc" : r === "history" || r === "games" ? "logs" : r);

/** Shows exactly what will change, before anything does. */
export function ReviewSheet() {
  const { ui, pc, set, confirmReview } = useApp();
  const r = ui.review;
  useEffect(() => {
    if (!r) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !r.busy) set({ review: null }); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [r, set]);
  if (!r) return null;
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget && !r.busy) set({ review: null }); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-head">
          <span className="label">{pc.name}</span>
          <h2 id="sheet-title" className="plain-h">{r.title}?</h2>
          <p className="muted">{r.body}</p>
        </div>
        <div className="diff-wrap"><DiffTable rows={r.rows} /></div>
        {r.error ? <div className="callout warn" role="alert">{r.error}</div>
          : <p className="note faint" style={{ fontSize: 12.5 }}>Rig saves the current values first. You can undo this from Changes at any time.</p>}
        <div className="sheet-foot">
          <button className="btn" type="button" disabled={r.busy} onClick={() => set({ review: null })}>Cancel</button>
          <button className="btn primary" type="button" onClick={confirmReview} disabled={r.busy} autoFocus>{r.busy ? "Working…" : r.cta}</button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const { ui, toggleChange } = useApp();
  const t = ui.toast;
  if (!t) return null;
  return (
    <div className="toast" role="status">
      <span>{t.msg}</span>
      {t.undo && <button className="btn sm" type="button" onClick={() => toggleChange(t.undo!)}>Undo</button>}
    </div>
  );
}
