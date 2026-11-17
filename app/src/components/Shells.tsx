import { useEffect, useRef, useState, type ReactNode } from "react";
import { user, type Route } from "../data";
import { useApp } from "../state";
import { Icon } from "./common";
import { navItems } from "./Shell";

const label = (r: Route) => navItems.find(([id]) => id === r)?.[1] ?? r;
const path = (r: Route) => navItems.find(([id]) => id === r)?.[2] ?? "";
const order: Route[] = ["overview", "pc", "chat", "changes", "upgrades", "games", "history"];

function useOutside(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const c = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", c);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("click", c); document.removeEventListener("keydown", k); };
  }, [open, close]);
  return box;
}

function PCMenu({ onPick }: { onPick: () => void }) {
  const { ui, set, toast } = useApp();
  const mine = Object.values(ui.pcs).filter((x) => x.parts);
  return (
    <div className="sh-menu" role="menu">
      {mine.map((x) => (
        <button key={x.id} type="button" role="menuitem" onClick={() => { set({ pcId: x.id, selected: null }); onPick(); }}>
          <span className="sh-dot" style={{ ["--pc" as string]: x.accent }} />
          <span><b>{x.name}</b><br /><span className="faint">{x.nickname}</span></span>
        </button>
      ))}
      <hr />
      <a href="#web" role="menuitem" onClick={onPick}>All your PCs on the web</a>
      <button type="button" role="menuitem" onClick={() => { onPick(); toast("Adding a PC opens a download link and a pairing code."); }}>Add a PC</button>
    </div>
  );
}

const Search = () => <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;

/* ---------- Friendly: a round top bar, no sidebar ---------- */
function FriendlyShell({ children }: { children: ReactNode }) {
  const { ui, pc, set } = useApp();
  const [open, setOpen] = useState(false);
  const box = useOutside(open, () => setOpen(false));
  const warn = (pc.issues ?? []).filter((i) => i.severity === "warn").length;
  return (
    <div className="shell shell-friendly">
      <header className="f-bar">
        <a className="f-logo" href="#overview" aria-label="Rig home"><span>R</span>Rig</a>
        <nav className="f-nav" aria-label="Main">
          {order.map((r) => (
            <a key={r} href={`#${r}`} className="f-nav-btn" aria-current={ui.route === r ? "page" : undefined} title={label(r)}>
              <Icon d={path(r)} /><span className="f-nav-text">{label(r)}</span>
              {r === "overview" && warn > 0 && <i className="f-badge">{warn}</i>}
            </a>
          ))}
        </nav>
        <div className="f-right">
          <button type="button" className="f-round" onClick={() => set({ palette: true })} aria-label="Search or ask"><Search /></button>
          <div className="f-pcsw" ref={box}>
            <button type="button" className="f-pc-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
              <span className="f-pc-ava" style={{ ["--pc" as string]: pc.accent }}>{pc.name[0]}</span>
              <span className="f-pcsw-name">{pc.name}</span><span className="caret">▾</span>
            </button>
            {open && <PCMenu onPick={() => setOpen(false)} />}
          </div>
          <a className="f-me" href="#signin" title="Account">{user.name[0]}</a>
        </div>
      </header>
      <main className="main" id="main">{children}</main>
    </div>
  );
}

/* ---------- Canvas: floating toolbars over a dotted canvas ---------- */
function CanvasShell({ children }: { children: ReactNode }) {
  const { ui, pc, set, toast } = useApp();
  const mine = Object.values(ui.pcs).filter((x) => x.parts);
  const warn = (pc.issues ?? []).filter((i) => i.severity === "warn").length;
  return (
    <div className="shell shell-canvas">
      <header className="c-bar">
        <nav className="c-tools" aria-label="Main">
          <a className="c-logo" href="#overview" aria-label="Rig home"><span /></a>
          {order.map((r) => (
            <a key={r} href={`#${r}`} aria-current={ui.route === r ? "page" : undefined} title={label(r)}>
              <Icon d={path(r)} /><span className="c-tool-text">{r === "overview" ? "Canvas" : label(r)}</span>
            </a>
          ))}
        </nav>
        <div className="c-tabs" role="tablist" aria-label="Your PCs">
          {mine.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === pc.id} className="c-tab" onClick={() => set({ pcId: x.id, selected: null })}>
              <span className="sh-dot" style={{ ["--pc" as string]: x.accent }} />{x.name}
              {(x.issues ?? []).some((i) => i.severity === "warn") && <i className="c-tab-flag" aria-label="Needs a look" />}
            </button>
          ))}
          <button type="button" className="c-tab add" aria-label="Add a PC" onClick={() => toast("Adding a PC opens a download link and a pairing code.")}>+</button>
        </div>
        <div className="c-right">
          <button type="button" className="c-ghost" onClick={() => set({ palette: true })}><Search /><kbd>Ctrl K</kbd></button>
          {warn > 0 && <a className="c-fix" href="#chat">Fix {warn} issue{warn > 1 ? "s" : ""}</a>}
          <a className="c-me" href="#signin" title="Account">{user.name[0]}</a>
        </div>
      </header>
      <main className="main" id="main">{children}</main>
    </div>
  );
}

/* ---------- Workspace: icon rail + tree, main sheet ---------- */
const treeParts = (kind: string) => kind === "laptop" ? ["cpu", "ssd", "battery", "fans", "board"] : ["cpu", "gpu", "ram", "ssd", "fans", "psu"];
function WorkspaceShell({ children }: { children: ReactNode }) {
  const { ui, pc, set, go, toast } = useApp();
  const [setup, setSetup] = useState(true);
  const mine = Object.values(ui.pcs).filter((x) => x.parts);
  const rail: Route[] = ["overview", "pc", "chat", "changes", "upgrades", "games", "history"];
  return (
    <div className="shell shell-work">
      <nav className="w-rail" aria-label="Main">
        <a className="w-logo" href="#overview" aria-label="Rig home">R</a>
        {rail.map((r) => (
          <a key={r} href={`#${r}`} className="w-rail-btn" aria-current={ui.route === r ? "page" : undefined} title={label(r)}><Icon d={path(r)} /></a>
        ))}
        <span className="w-rail-gap" />
        <button type="button" className="w-rail-btn" title="Search" onClick={() => set({ palette: true })}><Search /></button>
        <a className="w-me" href="#signin" title="Account">{user.name[0]}</a>
      </nav>
      <aside className="w-tree" aria-label="Your PCs">
        <div className="w-ws"><span className="w-ws-ico">J</span><b>{user.name}'s PCs</b><span className="caret">▾</span></div>
        <button type="button" className="w-search" onClick={() => set({ palette: true })}><Search /><span>Search</span><kbd>Ctrl K</kbd></button>
        <div className="w-sec">Your PCs</div>
        {mine.map((x) => {
          const on = x.id === pc.id;
          return (
            <div key={x.id} className="w-node">
              <button type="button" className={`w-row${on ? " on" : ""}`} onClick={() => { set({ pcId: x.id, selected: null }); go("overview"); }}>
                <span className={`w-chev${on ? " open" : ""}`}>›</span><span className="sh-dot" style={{ ["--pc" as string]: x.accent }} />{x.name}
                {(x.issues ?? []).some((i) => i.severity === "warn") && <i className="w-pill red">1</i>}
              </button>
              {on && (
                <div className="w-kids">
                  {treeParts(x.kind).filter((k) => x.parts?.[k]).map((k) => {
                    const p = x.parts![k];
                    return (
                      <button key={k} type="button" className={`w-leaf${ui.route === "pc" && ui.selected === k ? " on" : ""}`} onClick={() => { set({ selected: k, tab: "live" }); go("pc"); }}>
                        {p.type.replace(" and cooler", "")}
                        {p.temp !== undefined ? <i className={`w-pill${p.warn ? " red" : ""}`}>{p.temp}°</i> : p.fan ? <i className="w-pill">{(p.fan / 1000).toFixed(1)}k</i> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div className="w-sec">Help</div>
        <a className="w-row" href="#chat" aria-current={ui.route === "chat" ? "page" : undefined}>Ask Rig</a>
        <a className="w-row" href="#changes" aria-current={ui.route === "changes" ? "page" : undefined}>Changes <i className="w-pill">{ui.changes.length}</i></a>
        <a className="w-row" href="#history" aria-current={ui.route === "history" ? "page" : undefined}>Temperature history</a>
        <div className="w-sec">Reports</div>
        <a className="w-row" href="#games" aria-current={ui.route === "games" ? "page" : undefined}>Game tuning</a>
        <a className="w-row" href="#upgrades" aria-current={ui.route === "upgrades" ? "page" : undefined}>Upgrade ideas</a>
        {setup && (
          <div className="w-setup">
            <b>Finish setup</b>
            <p>Let Rig control the fans so {pc.name} stays quiet when you're not gaming.</p>
            <div className="w-setup-bar"><i style={{ width: "75%" }} /></div>
            <div className="w-setup-row"><span>3 of 4 done</span>
              <button type="button" onClick={() => { setSetup(false); toast("Fan control is set up. Rig will ask before it changes a fan curve."); }}>Continue</button>
            </div>
          </div>
        )}
      </aside>
      <main className="main w-sheet" id="main">{children}</main>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { ui } = useApp();
  if (ui.style === "workbench") return <CanvasShell>{children}</CanvasShell>;
  if (ui.style === "checkup") return <WorkspaceShell>{children}</WorkspaceShell>;
  return <FriendlyShell>{children}</FriendlyShell>;
}
