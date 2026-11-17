import { useEffect, useRef, useState } from "react";
import { user, type Route } from "../data";
import { useApp } from "../state";
import { styles } from "../themes";
import { DiffTable, Icon } from "./common";

const navItems: [Route, string, string][] = [
  ["overview", "Overview", "M3 10.5 10 4l7 6.5V17H3z"],
  ["pc", "My PC", "M6 3h8v14H6zM9 6h2M9 14h2"],
  ["chat", "Ask", "M4 5h12v8H9l-4 3v-3H4z"],
  ["changes", "Changes", "M4 10a6 6 0 1 0 2-4.5M4 4v3h3M10 7v3l2 2"],
  ["upgrades", "Upgrades", "M10 16V5M5.5 9.5 10 5l4.5 4.5"],
  ["games", "Games", "M4 8h12v6H4zM7 10v2M6 11h2M13 11h.01M15 11h.01"],
  ["history", "History", "M3 15l4-5 3 3 5-7M3 17h14"],
];

export function Nav() {
  const { ui, pc, set, toast } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const warnCount = (pc.issues ?? []).filter((i) => i.severity === "warn").length;
  const mine = Object.values(ui.pcs).filter((x) => x.parts);

  return (
    <nav className="nav" aria-label="Main">
      <div className="brand"><span className="brand-mark" />Rig</div>
      <div className="pc-switch" ref={box}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="dot" />
          <span><span className="pcs-name">{pc.name}</span><br /><span className="pcs-sub">{pc.nickname}</span></span>
          <span className="caret">▾</span>
        </button>
        {open && (
          <div className="menu" role="menu">
            {mine.map((x) => (
              <button key={x.id} type="button" role="menuitem" onClick={() => { set({ pcId: x.id, selected: null }); setOpen(false); }}>
                <span className="dot" style={{ ["--pc" as string]: x.accent }} />
                <span>{x.name}<br /><span className="faint">{x.nickname}</span></span>
              </button>
            ))}
            <hr />
            <a href="#web" role="menuitem" onClick={() => setOpen(false)}>All your PCs on the web</a>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); toast("Adding a PC opens a download link and a pairing code."); }}>Add a PC</button>
          </div>
        )}
      </div>
      <ul className="nav-list">
        {navItems.map(([id, label, d]) => (
          <li key={id}>
            <a href={`#${id}`} aria-current={ui.route === id ? "page" : undefined}>
              <Icon d={d} />{label}{id === "overview" && warnCount > 0 && <span className="count">{warnCount}</span>}
            </a>
          </li>
        ))}
      </ul>
      <div className="nav-foot">
        <span className="avatar">{user.name[0]}</span>
        <span className="who">{user.name}<br /><span className="faint">Synced</span></span>
        <a className="btn ghost sm" href="#signin" style={{ marginLeft: "auto" }}>Sign out</a>
      </div>
    </nav>
  );
}

// Floating panel for reviewing the mockups. Not part of the design.
export function MockPanel() {
  const { ui, set, go } = useApp();
  const style = styles.find((s) => s.id === ui.style)!;
  const pickPC = (id: string) => {
    set({ pcId: id, selected: null });
    if (ui.route === "signin" || ui.route === "web") go("overview");
  };
  return (
    <aside className={`mock${ui.mockMin ? " min" : ""}`} aria-label="Mockup controls">
      <div className="mock-head"><span>Mockup controls</span><button type="button" onClick={() => set({ mockMin: !ui.mockMin })}>{ui.mockMin ? "Show" : "Hide"}</button></div>
      <div className="mbody" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="mrow">
          {styles.map((s) => <button key={s.id} type="button" aria-pressed={ui.style === s.id} onClick={() => set({ style: s.id })}>{s.name}</button>)}
        </div>
        <div className="mnote">{style.note}</div>
        <div className="mrow">
          <button type="button" aria-pressed={ui.pcId === "atlas"} onClick={() => pickPC("atlas")}>Tower</button>
          <button type="button" aria-pressed={ui.pcId === "pebble"} onClick={() => pickPC("pebble")}>Laptop</button>
        </div>
        <div className="mrow">
          <button type="button" aria-pressed={ui.route === "signin"} onClick={() => go("signin")}>Sign-in</button>
          <button type="button" aria-pressed={ui.route === "web"} onClick={() => go("web")}>Web</button>
        </div>
      </div>
    </aside>
  );
}

export function Modal() {
  const { ui, pc, set, applyModal } = useApp();
  const m = ui.modal;
  useEffect(() => {
    if (!m) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") set({ modal: null }); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [m, set]);
  if (!m) return null;
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) set({ modal: null }); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-head">
          <span className="label">{pc.name}</span>
          <h2 id="sheet-title" className="plain-h">{m.title}</h2>
          <p className="muted">{m.body}</p>
        </div>
        <div className="diff-wrap"><DiffTable rows={m.rows} /></div>
        <p className="note faint" style={{ fontSize: 12.5 }}>A restore point is made first. You can undo this from Changes at any time.</p>
        <div className="sheet-foot">
          <button className="btn" type="button" onClick={() => set({ modal: null })}>Cancel</button>
          <button className="btn primary" type="button" onClick={applyModal} autoFocus>{m.cta}</button>
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
