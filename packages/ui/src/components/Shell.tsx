import { useEffect, useRef, useState } from "react";
import type { Route } from "@rig/core";
import { useActions, useAppSelector, useUI, useUpdates } from "../state";
import { updateWhat } from "../pages/settings/UpdatesSection";
import { DiffTable } from "./common";
import { useModal } from "./modal";

/** Every page, for the sidebar and Ctrl K. Upgrades, Manuals, Safety, Games and Temperatures are tabs of other pages now (see homeOf), so only Ctrl K lists them. */
export const navItems: [Route, string, string][] = [
  ["overview", "Home", "M3 10.5 10 4l7 6.5V17H3z"],
  ["pc", "My PC", "M6 3h8v14H6zM9 6h2M9 14h2"],
  ["chat", "Ask", "M4 5h12v8H9l-4 3v-3H4z"],
  ["changes", "Changes", "M4 10a6 6 0 1 0 2-4.5M4 4v3h3M10 7v3l2 2"],
  ["upgrades", "Upgrades", "M10 16V5M5.5 9.5 10 5l4.5 4.5"],
  ["manuals", "Manuals and drivers", "M5 16.5v-11A1.5 1.5 0 0 1 6.5 4H15v11H6.5A1.5 1.5 0 0 0 5 16.5 1.5 1.5 0 0 0 6.5 18H15"],
  ["safety", "Safety", "M10 3 4.5 5v4.5c0 3.6 2.3 6.4 5.5 7.5 3.2-1.1 5.5-3.9 5.5-7.5V5zM7.5 10l2 2 3.5-4"],
  ["games", "Games", "M4 8h12v6H4zM7 10v2M6 11h2M13 11h.01M15 11h.01"],
  ["logs", "Logs", "M5 3h7l3 3v11H5zM12 3v3h3M8 10h4M8 13h4"],
  ["events", "Events", "M10 3 2 17h16zM10 8v4M10 14.5v.01"],
  ["settings", "Settings", "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4"],
];

/** My laptop's icon in the sidebar: a laptop drawn like the tower beside it, a screen over a base. */
const LAPTOP_ICON = "M4.5 5h11v8h-11zM2.5 15.5h15";

/** A page's icon in the sidebar: My PC shows a laptop on a laptop. */
export const navIcon = (r: Route, word: string) => (r === "pc" && word === "laptop" ? LAPTOP_ICON : navItems.find(([id]) => id === r)?.[2] ?? "");

/** A page's name as the sidebar and Ctrl K show it: My PC is My laptop on a laptop. */
export const navLabel = (r: Route, word: string) => (r === "pc" ? `My ${word}` : navItems.find(([id]) => id === r)?.[1] ?? r);

/** The page a route lives on in the sidebar: upgrades, manuals and safety are on My PC, games and events are views of Logs. */
export const homeOf = (r: Route): Route => (r === "upgrades" || r === "manuals" || r === "safety" ? "pc" : r === "history" || r === "games" || r === "events" || r === "recorded" ? "logs" : r);

/** Shows exactly what will change, before anything does. */
export function ReviewSheet() {
  const { set, confirmReview } = useActions();
  const ui = useUI();
  const pc = { name: useAppSelector((c) => c.pc.name) };
  const r = ui.review;
  useEffect(() => {
    if (!r) return;
    // Escape that something open over the sheet already used, like Ctrl K search, leaves the sheet open.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || r.busy || ui.palette) return;
      e.preventDefault();
      set({ review: null });
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [r, set, ui.palette]);
  const box = useRef<HTMLDivElement>(null);
  useModal(box, !!r);
  if (!r) return null;
  return (
    <div className="scrim" ref={box} onClick={(e) => { if (e.target === e.currentTarget && !r.busy) set({ review: null }); }}>
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
          <button className="btn ghost" type="button" aria-disabled={r.busy} onClick={() => { if (!r.busy) set({ review: null }); }} autoFocus>Cancel</button>
          <button className="btn primary" type="button" aria-disabled={r.busy} onClick={() => { if (!r.busy) confirmReview(); }}>{r.busy ? "Making the change…" : r.cta}</button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const { set, toggleChange } = useActions();
  const ui = useUI();
  const t = ui.toast;
  return (
    <div className="toast-region" role="status">
      {t && (
        <div className="toast">
          <span>{t.msg}</span>
          {t.undo && <button className="btn sm" type="button" onClick={() => { const id = t.undo!; set({ toast: null }); void toggleChange(id); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

/**
 * A small card in the corner when a new version of Rig is ready. It never blocks the app: Not now hides it
 * until Rig restarts or a newer version comes out, and Settings, Updates always has the same button.
 */
export function UpdateNotice() {
  const { host } = useActions();
  const s = useUpdates(host);
  const [hidden, setHidden] = useState<string | null>(null);
  const version = s.kind === "ready" || s.kind === "installing" ? s.version : s.kind === "failed" && s.step === "install" ? s.version ?? null : null;
  if (!host.updates || !version || (hidden === version && s.kind !== "installing")) return null;
  const u = host.updates;
  return (
    <section className="update-notice" aria-labelledby="update-notice-h">
      <div className="update-notice-text">
        <b id="update-notice-h">{s.kind === "installing" ? `Updating to Rig ${version}…` : s.kind === "failed" ? `Rig ${version} didn't install` : `Rig ${version} is ready`}</b>
        <p>{s.kind === "installing" ? "Rig closes and opens again on its own when it's done." : s.kind === "failed" ? "Rig stays on this version for now. Try again in a moment." : updateWhat}</p>
      </div>
      {s.kind !== "installing" && (
        <div className="update-notice-actions">
          <button className="btn ghost sm" type="button" onClick={() => setHidden(version)}>Not now</button>
          <button className="btn sm primary" type="button" onClick={() => void u.install()}>{s.kind === "failed" ? "Try again" : "Update"}</button>
        </div>
      )}
    </section>
  );
}
