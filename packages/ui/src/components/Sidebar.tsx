import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "@rig/core";
import { useApp } from "../state";
import { Icon } from "./common";
import { homeOf, navItems } from "./Shell";

const label = (r: Route) => navItems.find(([id]) => id === r)?.[1] ?? r;
const path = (r: Route) => navItems.find(([id]) => id === r)?.[2] ?? "";
const groups: [string, Route[]][] = [["Your PC", ["overview", "pc", "logs"]], ["Fix problems", ["chat", "changes"]], ["", ["settings"]]];

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

const Search = () => <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
const Check = () => <svg className="sh-check" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 10.5 8.5 14 15 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

function PCMenu({ onPick }: { onPick: () => void }) {
  const { data, pc, pickPC, toast, client } = useApp();
  const mine = data.pcs.filter((x) => x.parts);
  return (
    <div className="sh-menu" role="menu">
      {mine.map((x) => (
        <button key={x.id} type="button" role="menuitem" aria-current={x.id === pc.id ? "true" : undefined} onClick={() => { pickPC(x.id); onPick(); }}>
          <span className="sh-dot" />
          <span><b>{x.name}</b><br /><span className="faint">{x.nickname}</span></span>
          {x.id === pc.id && <Check />}
        </button>
      ))}
      <hr />
      <a href="#web" role="menuitem" onClick={onPick}>All your PCs</a>
      <button type="button" role="menuitem" onClick={() => { onPick(); toast(client.kind === "web" ? "Install Rig on the PC and sign in with this account. It shows up here on its own." : "Install Rig on the other PC and sign in with the same account."); }}>Add a PC</button>
    </div>
  );
}

/** Setup steps that are still open, worked out from the PC itself. */
function useSetup() {
  const { pc, data, client, go, set } = useApp();
  const [skipped, setSkipped] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("rig.setupSkipped") ?? "[]"); } catch { return []; } });
  const steps: { id: string; title: string; body: string; cta: string; run: () => void; done: boolean }[] = [
    { id: "sensors", title: "Allow temperature readings", body: "Windows only shares processor and board temperatures with apps that have admin permission.", cta: "How", run: () => go("chat"), done: !pc.issues?.some((i) => i.id === "needs-admin") },
    { id: "name", title: `Name ${pc.kind === "laptop" ? "your laptop" : "your PC"}`, body: "Pick a name and a color. It marks this PC everywhere you see it.", cta: "Name it", run: () => { set({ selected: null }); go("pc"); }, done: pc.name !== "My PC" },
    { id: "account", title: "Sign in to sync", body: "See this PC from any browser and keep its history if you reinstall.", cta: "Sign in", run: () => go("signin"), done: !!data.account || client.kind === "demo" },
  ];
  const open = steps.filter((s) => !s.done && !skipped.includes(s.id));
  const skip = (id: string) => { const next = [...skipped, id]; setSkipped(next); try { localStorage.setItem("rig.setupSkipped", JSON.stringify(next)); } catch { /* storage unavailable */ } };
  return { step: open[0], done: steps.length - open.length, total: steps.length, skip };
}

function SetupCard() {
  const { step, done, total, skip } = useSetup();
  if (!step) return null;
  return (
    <div className="fp-setup">
      <span className="fp-setup-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 3v3M10 14v3M3 10h3M14 10h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></span>
      <b>{step.title}</b>
      <p>{step.body}</p>
      <div className="fp-setup-row">
        <span className="fp-ring" style={{ ["--p" as string]: `${(done / total) * 100}%` }} aria-hidden="true" />
        <span>{done} of {total}</span>
        <button type="button" className="fp-skip" onClick={() => skip(step.id)}>Skip</button>
        <button type="button" className="fp-next" onClick={step.run}>{step.cta}</button>
      </div>
    </div>
  );
}

const Caret = () => <svg className="fp-me-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 8 10 5l3 3M7 12l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Account pinned to the bottom of the sidebar. */
function AccountBlock() {
  const { data, client, ui, go, toast } = useApp();
  const [open, setOpen] = useState(false);
  const box = useOutside(open, () => setOpen(false));
  const a = data.account;
  return (
    <div className="fp-foot" ref={box}>
      <button type="button" className="fp-me" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={a ? `Account, ${a.name}` : "Account, not signed in"} title={ui.sideMini ? a?.name ?? "Not signed in" : undefined}>
        <span aria-hidden="true">{a ? a.name[0]?.toUpperCase() : "?"}</span>
        <b>{a ? a.name : "Not signed in"}</b>
        <small>{!a ? "Sign in" : client.kind === "demo" ? "Demo" : "Synced"}</small>
        <Caret />
      </button>
      {open && (
        <div className="sh-menu up" role="menu">
          {a && <><div className="sh-menu-head" role="presentation"><b>{a.name}</b><span>{a.email}</span></div><hr /></>}
          {!a && <a href="#signin" role="menuitem" onClick={() => setOpen(false)}>Sign in</a>}
          {a && <a href="#web" role="menuitem" onClick={() => setOpen(false)}>All your PCs</a>}
          <a href="#settings" role="menuitem" onClick={() => setOpen(false)}>Settings</a>
          {a && client.kind !== "demo" && <button type="button" role="menuitem" onClick={() => { setOpen(false); client.signOut().then(() => { go("signin"); location.reload(); }, () => toast("Couldn't sign out just now. Check your internet connection and try again.")); }}>Sign out</button>}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ children }: { children: ReactNode }) {
  const { ui, pc, data, set } = useApp();
  const [open, setOpen] = useState(false);
  const box = useOutside(open, () => setOpen(false));
  const mini = ui.sideMini;
  const warn = (pc.issues ?? []).filter((i) => i.severity === "warn" || i.severity === "bad").length;
  const count = (r: Route) => r === "overview" && warn > 0 ? <em className="fp-count">{warn}</em>
    : r === "changes" && data.changes.length ? <em className="fp-count">{data.changes.length}</em>
    : r === "logs" && data.recordings.some((x) => x.state === "recording") ? <em className="fp-count" title="Recording now">●</em> : null;
  return (
    <div className={`shell-fpanel${mini ? " mini" : ""}`}>
      <div className="fp-frame">
        <aside className="fp-side" aria-label="Main">
          <div className="fp-nav">
            <div className="fp-brand" ref={box}>
              <button type="button" className="fp-brand-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Switch PC, now ${pc.name}`}>
                <span className="fp-logo">R<i /></span>
                <span className="fp-brand-txt"><b>Rig</b><small>{pc.name} · {pc.nickname}</small></span>
              </button>
              <button type="button" className="fp-collapse" onClick={() => set({ sideMini: !mini })} aria-label={mini ? "Expand sidebar" : "Collapse sidebar"}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 4v12" stroke="currentColor" strokeWidth="1.5" /><path d={mini ? "M11.5 8.5 13 10l-1.5 1.5" : "M13 8.5 11.5 10l1.5 1.5"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {open && <PCMenu onPick={() => setOpen(false)} />}
            </div>
            {groups.map(([g, ids]) => (
              <div key={g || ids[0]} className="fp-group">
                {g && <div className="fp-label">{g}</div>}
                {ids.map((r) => (
                  <a key={r} href={`#${r}`} className="fp-item" title={mini ? label(r) : undefined} aria-current={homeOf(ui.route) === r ? "page" : undefined}>
                    <Icon d={path(r)} /><span>{label(r)}</span>{count(r)}
                  </a>
                ))}
              </div>
            ))}
            <button type="button" className="fp-item fp-search" onClick={() => set({ palette: true })} title={mini ? "Search or ask" : undefined}>
              <Search /><span>Search or ask</span><kbd>Ctrl K</kbd>
            </button>
            <SetupCard />
          </div>
          <AccountBlock />
        </aside>
        {/* Home is a dashboard of tiles on a warm ground. Every other page reads as one flat sheet. */}
        <main className={`fp-main${ui.route === "overview" ? "" : " flat"}`} id="main">{children}</main>
      </div>
    </div>
  );
}
