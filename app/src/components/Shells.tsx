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
  const { ui, pc, set, toast } = useApp();
  const mine = Object.values(ui.pcs).filter((x) => x.parts);
  return (
    <div className="sh-menu" role="menu">
      {mine.map((x) => (
        <button key={x.id} type="button" role="menuitem" aria-current={x.id === pc.id ? "true" : undefined} onClick={() => { set({ pcId: x.id, selected: null }); onPick(); }}>
          <span className="sh-dot" style={{ ["--pc" as string]: x.accent }} />
          <span><b>{x.name}</b><br /><span className="faint">{x.nickname}</span></span>
          {x.id === pc.id && <svg className="sh-check" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 10.5 8.5 14 15 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
      ))}
      <hr />
      <button type="button" role="menuitem" onClick={() => { onPick(); toast("Adding a PC opens a download link and a pairing code."); }}>Add a PC</button>
    </div>
  );
}

function AccountMenu({ onPick }: { onPick: () => void }) {
  const { toast } = useApp();
  return (
    <div className="sh-menu up" role="menu">
      <div className="sh-menu-head" role="presentation"><b>{user.name}</b><span>{user.email}</span></div>
      <hr />
      <button type="button" role="menuitem" onClick={() => { onPick(); toast("Account settings open on the web."); }}>Account settings</button>
      <a href="#web" role="menuitem" onClick={onPick}>Your PCs on the web</a>
      <hr />
      <a href="#signin" role="menuitem" onClick={onPick}>Sign out</a>
    </div>
  );
}

const Search = () => <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;

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

/* ---------- Friendly: a framed app with a soft panel ---------- */
const groups: [string, Route[]][] = [["Your PC", ["overview", "pc", "games", "upgrades"]], ["Help", ["chat", "changes", "history"]]];
const setupSteps = [
  ["Finish setup", "Let Rig control the fans so your PC stays quiet when you're not gaming."],
  ["Add your games", "Rig found 3 games. Add them so it can tune each one."],
];
function FriendlyPanelShell({ children }: { children: ReactNode }) {
  const { ui, pc, set, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [acct, setAcct] = useState(false);
  const [mini, setMini] = useState(false);
  const [step, setStep] = useState(0);
  const box = useOutside(open, () => setOpen(false));
  const me = useOutside(acct, () => setAcct(false));
  const warn = (pc.issues ?? []).filter((i) => i.severity === "warn").length;
  const done = 3 + step;
  const count = (r: Route) => r === "overview" && warn > 0 ? <em className="fp-count hot">{warn}</em>
    : r === "changes" ? <em className="fp-count">{ui.changes.length}</em> : null;
  return (
    <div className={`shell shell-fpanel${mini ? " mini" : ""}`}>
      <div className="fp-frame">
        <aside className="fp-side" aria-label="Main">
          <div className="fp-nav">
            <div className="fp-brand" ref={box}>
              <button type="button" className="fp-brand-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Switch PC, now ${pc.name}`}>
                <span className="fp-logo">R<i /></span>
                <span className="fp-brand-txt"><b>Rig</b><small>{pc.name} · {pc.nickname}</small></span>
              </button>
              <button type="button" className="fp-collapse" onClick={() => setMini(!mini)} aria-label={mini ? "Expand sidebar" : "Collapse sidebar"}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 4v12" stroke="currentColor" strokeWidth="1.5" /><path d={mini ? "M11.5 8.5 13 10l-1.5 1.5" : "M13 8.5 11.5 10l1.5 1.5"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {open && <PCMenu onPick={() => setOpen(false)} />}
            </div>
            {groups.map(([g, ids]) => (
              <div key={g} className="fp-group">
                <div className="fp-label">{g}</div>
                {ids.map((r) => (
                  <a key={r} href={`#${r}`} className="fp-item" title={mini ? label(r) : undefined} aria-current={ui.route === r ? "page" : undefined}>
                    <Icon d={path(r)} /><span>{label(r)}</span>{count(r)}
                  </a>
                ))}
              </div>
            ))}
            <button type="button" className="fp-item fp-search" onClick={() => set({ palette: true })} title={mini ? "Search or ask" : undefined}>
              <Search /><span>Search or ask</span><kbd>Ctrl K</kbd>
            </button>
            {step < setupSteps.length && (
              <div className="fp-setup">
                <span className="fp-setup-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 3v3M10 14v3M3 10h3M14 10h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></span>
                <b>{setupSteps[step][0]}</b>
                <p>{setupSteps[step][1]}</p>
                <div className="fp-setup-row">
                  <span className="fp-ring" style={{ ["--p" as string]: `${done * 25}%` }} aria-hidden="true" />
                  <span>{done} of 4</span>
                  <button type="button" className="fp-skip" onClick={() => setStep(step + 1)}>Skip</button>
                  <button type="button" className="fp-next" onClick={() => { toast(step === 0 ? "Fan control is set up. Rig will ask before it changes a fan curve." : "Games added. Rig will tune each one the first time you play."); setStep(step + 1); }}>Next</button>
                </div>
              </div>
            )}
          </div>
          <div className="fp-foot" ref={me}>
            <button type="button" className="fp-me" onClick={() => setAcct(!acct)} aria-expanded={acct} aria-haspopup="menu" aria-label={`Account, ${user.name}`} title={mini ? user.name : undefined}>
              <span>{user.name[0]}</span><b>{user.name}</b><small>Synced</small>
              <svg className="fp-me-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 8 10 5l3 3M7 12l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {acct && <AccountMenu onPick={() => setAcct(false)} />}
          </div>
        </aside>
        <main className="main fp-main" id="main">{children}</main>
      </div>
    </div>
  );
}

/* ---------- Pulse: pill nav on top, round icon rail on the left ---------- */
const pulseNav: Route[] = ["overview", "pc", "games", "upgrades", "chat"];
const railItems: [Route, string, string][] = [
  ["changes", "Changes", path("changes")],
  ["history", "History", path("history")],
  ["web", "On the web", "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM3 10h14M10 3c2 2 2.8 4.3 2.8 7s-.8 5-2.8 7c-2-2-2.8-4.3-2.8-7S8 5 10 3"],
];
function PulseShell({ children }: { children: ReactNode }) {
  const { ui, pc, set, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [acct, setAcct] = useState(false);
  const box = useOutside(open, () => setOpen(false));
  const me = useOutside(acct, () => setAcct(false));
  const warn = (pc.issues ?? []).filter((i) => i.severity === "warn").length;
  return (
    <div className="shell shell-pulse">
      <header className="pl-top">
        <a className="pl-logo" href="#overview" aria-label="Rig home">R</a>
        <nav className="pl-nav" aria-label="Main">
          {pulseNav.map((r) => (
            <a key={r} href={`#${r}`} className="pl-pill" aria-current={ui.route === r ? "page" : undefined} title={label(r)}>
              <Icon d={path(r)} /><span>{label(r)}</span>
              {r === "overview" && warn > 0 && <em className="pl-badge" aria-label={`${warn} needs a look`}>{warn}</em>}
            </a>
          ))}
          <button type="button" className="pl-round" onClick={() => set({ palette: true })} aria-label="Search or ask" title="Search or ask (Ctrl K)"><Search /></button>
        </nav>
        <div className="pl-switch" ref={box}>
          <button type="button" className="pl-switch-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Switch PC, now ${pc.name}`}>
            <span className="sh-dot" />
            <span className="pl-switch-txt"><b>{pc.name}</b><small>{pc.nickname}</small></span>
            <svg className="pl-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {open && <PCMenu onPick={() => setOpen(false)} />}
        </div>
      </header>
      <aside className="pl-rail" aria-label="More">
        {railItems.map(([r, text, d]) => (
          <a key={r} href={`#${r}`} className="pl-rail-btn" aria-current={ui.route === r ? "page" : undefined} aria-label={text} data-tip={text}>
            <Icon d={d} />
            {r === "changes" && <em className="pl-badge">{ui.changes.length}</em>}
          </a>
        ))}
        <button type="button" className="pl-rail-btn" aria-label="Add a PC" data-tip="Add a PC" onClick={() => toast("Adding a PC opens a download link and a pairing code.")}>
          <Icon d="M10 4v12M4 10h12" />
        </button>
        <span className="pl-rail-gap" />
        <div className="pl-me-wrap" ref={me}>
          <button type="button" className="pl-me" onClick={() => setAcct(!acct)} aria-expanded={acct} aria-haspopup="menu" aria-label={`Account, ${user.name}`} data-tip={acct ? undefined : user.name}>
            {user.name[0]}
          </button>
          {acct && <AccountMenu onPick={() => setAcct(false)} />}
        </div>
      </aside>
      <main className="main pl-main" id="main">{children}</main>
    </div>
  );
}

/* ---------- Paper: floating numbered sidebar on paper ---------- */
const paperNav: Route[] = ["overview", "pc", "games", "upgrades", "chat", "changes", "history"];
const two = (n: number) => String(n).padStart(2, "0");
export function paperSection(r: Route): [string, string] {
  const i = paperNav.indexOf(r);
  return i >= 0 ? [two(i + 1), label(r)] : [two(paperNav.length + 1), "On the web"];
}
const Caret = ({ up }: { up?: boolean }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={up ? "M7 8 10 5l3 3M7 12l3 3 3-3" : "M6 8l4 4 4-4"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

function PaperShell({ children }: { children: ReactNode }) {
  const { ui, pc, set } = useApp();
  const [open, setOpen] = useState(false);
  const [acct, setAcct] = useState(false);
  const box = useOutside(open, () => setOpen(false));
  const me = useOutside(acct, () => setAcct(false));
  const warn = (pc.issues ?? []).some((i) => i.severity === "warn");
  const [num, name] = paperSection(ui.route);
  return (
    <div className="shell shell-paper">
      <aside className="pp-side" aria-label="Main">
        <div className="pp-top">
          <div className="pp-brand" ref={box}>
            <button type="button" className="pp-brand-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Switch PC, now ${pc.name}`}>
              <span className="pp-word"><span className="pp-mark">R</span><b>Rig</b></span>
              <span className="pp-pcline"><span>{pc.name}</span><small>{pc.nickname}</small></span>
              <Caret />
            </button>
            {open && <PCMenu onPick={() => setOpen(false)} />}
          </div>
          <nav className="pp-nav">
            {paperNav.map((r, i) => (
              <a key={r} href={`#${r}`} className="pp-link" aria-current={ui.route === r ? "page" : undefined}>
                <span className="pp-n">{two(i + 1)}</span><span className="pp-t">{label(r)}</span>
                {r === "overview" && warn && <i className="pp-flag" aria-label="Needs a look" />}
              </a>
            ))}
          </nav>
          <button type="button" className="pp-search" onClick={() => set({ palette: true })}>
            <Search /><span>Search</span><kbd>Ctrl K</kbd>
          </button>
        </div>
        <a className="pp-ask" href="#chat">Ask Rig</a>
        <div className="pp-acct" ref={me}>
          <button type="button" className="pp-me" onClick={() => setAcct(!acct)} aria-expanded={acct} aria-haspopup="menu" aria-label={`Account, ${user.name}`}>
            <span className="pp-ava">{user.name[0]}</span>
            <span className="pp-me-txt"><b>{user.name}</b><small>Synced</small></span>
            <Caret up />
          </button>
          {acct && <AccountMenu onPick={() => setAcct(false)} />}
        </div>
      </aside>
      <main className="main pp-main" id="main" style={{ ["--pp-num" as string]: `"${num}"`, ["--pp-name" as string]: `"${name}"` }}>{children}</main>
    </div>
  );
}

/* ---------- Signature: compact floating sidebar, ask bar on top ---------- */
function SignatureShell({ children }: { children: ReactNode }) {
  const { ui, pc, set } = useApp();
  const [open, setOpen] = useState(false);
  const [acct, setAcct] = useState(false);
  const [mini, setMini] = useState(false);
  const box = useOutside(open, () => setOpen(false));
  const me = useOutside(acct, () => setAcct(false));
  const warn = (pc.issues ?? []).filter((i) => i.severity === "warn").length;
  return (
    <div className={`shell shell-sig${mini ? " mini" : ""}`}>
      <aside className="sg-side" aria-label="Main">
        <div className="sg-top">
          <div className="sg-brand">
            <a className="sg-mark" href="#overview" aria-label="Rig home">R</a>
            <b className="sg-word">Rig</b>
            <button type="button" className="sg-collapse" onClick={() => setMini(!mini)} aria-label={mini ? "Expand sidebar" : "Collapse sidebar"}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 4v12" stroke="currentColor" strokeWidth="1.5" /><path d={mini ? "M11.5 8.5 13 10l-1.5 1.5" : "M13 8.5 11.5 10l1.5 1.5"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          {groups.map(([g, ids]) => (
            <div key={g} className="sg-group">
              <div className="sg-label">{g}</div>
              {ids.map((r) => (
                <a key={r} href={`#${r}`} className="sg-item" title={mini ? label(r) : undefined} aria-current={ui.route === r ? "page" : undefined}>
                  <Icon d={path(r)} /><span className="sg-item-t">{label(r)}</span>
                  {r === "overview" && warn > 0 && <em className="sg-count hot" aria-label={`${warn} needs a look`}>{warn}</em>}
                  {r === "changes" && <em className="sg-count">{ui.changes.length}</em>}
                  {ui.route === r && <i className="sg-live" aria-hidden="true" />}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className="sg-acct" ref={me}>
          <button type="button" className="sg-me" onClick={() => setAcct(!acct)} aria-expanded={acct} aria-haspopup="menu" aria-label={`Account, ${user.name}`} title={mini ? user.name : undefined}>
            <span className="sg-ava">{user.name[0]}</span>
            <span className="sg-me-txt"><b>{user.name}</b><small>Synced</small></span>
            <Caret up />
          </button>
          {acct && <AccountMenu onPick={() => setAcct(false)} />}
        </div>
      </aside>
      <div className="sg-body">
        <header className="sg-bar">
          <button type="button" className="sg-ask" onClick={() => set({ palette: true })}>
            <Search /><span>Ask Rig about {pc.name}…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="sg-switch" ref={box}>
            <button type="button" className="sg-switch-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Switch PC, now ${pc.name}`}>
              <span className="sg-switch-dot" aria-hidden="true" />
              <span className="sg-switch-txt"><b>{pc.name}</b><small>{pc.nickname}</small></span>
              <Caret />
            </button>
            {open && <PCMenu onPick={() => setOpen(false)} />}
          </div>
        </header>
        <main className="main sg-main" id="main">{children}</main>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { ui } = useApp();
  if (ui.style === "paper") return <PaperShell>{children}</PaperShell>;
  if (ui.style === "signature") return <SignatureShell>{children}</SignatureShell>;
  if (ui.style === "pulse") return <PulseShell>{children}</PulseShell>;
  if (ui.style === "workbench") return <CanvasShell>{children}</CanvasShell>;
  if (ui.style === "checkup") return <WorkspaceShell>{children}</WorkspaceShell>;
  return <FriendlyPanelShell>{children}</FriendlyPanelShell>;
}
