import { useEffect, useMemo, useRef, useState } from "react";
import { games, upgrades, type Route } from "../data";
import { useApp } from "../state";

type Kind = "parts" | "changes" | "games" | "upgrades";
interface Item { id: string; kind: Kind; title: string; sub: string; badge?: { text: string; tone: string }; run: () => void }

const kindLabel: Record<Kind, string> = { parts: "Parts", changes: "Changes", games: "Games", upgrades: "Upgrades" };
const icon: Record<Kind, string> = {
  parts: "M6 6h12v12H6zM9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3",
  changes: "M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2",
  games: "M5 9h14v7H5zM8.5 11v3M7 12.5h3M15 12h.01M17 13.5h.01",
  upgrades: "M12 19V6M7 11l5-5 5 5",
};

// Ctrl K search across the PC: parts, changes, games and upgrades, plus "Ask Rig".
export function Palette() {
  const { ui, pc, set, go, ask } = useApp();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | Kind>("all");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { set({ palette: false }); setQ(""); setTab("all"); setActive(0); };
  const open = (route: Route, patch: Parameters<typeof set>[0] = {}) => { set(patch); go(route); close(); };

  useEffect(() => { if (ui.palette) setTimeout(() => input.current?.focus(), 0); }, [ui.palette]);

  const all = useMemo<Item[]>(() => {
    const items: Item[] = [];
    for (const [id, p] of Object.entries(pc.parts ?? {})) {
      items.push({
        id: `p-${id}`, kind: "parts", title: p.name, sub: [p.type, p.temp !== undefined ? `${p.temp}°C now` : p.sub].filter(Boolean).join(" · "),
        badge: p.warn ? { text: "Running warm", tone: "warn" } : undefined,
        run: () => open("pc", { selected: id, tab: "live" }),
      });
    }
    for (const c of ui.changes) items.push({ id: `c-${c.id}`, kind: "changes", title: c.title, sub: `${c.when} · ${c.by}`, badge: { text: c.status === "applied" ? "Applied" : "Undone", tone: c.status === "applied" ? "ok" : "muted" }, run: () => open("changes") });
    if (pc.kind !== "laptop") for (const g of games) items.push({ id: `g-${g.name}`, kind: "games", title: g.name, sub: `${g.res} · ${g.now.avg} FPS now`, badge: { text: `+${g.tuned.avg - g.now.avg} FPS ready`, tone: "info" }, run: () => open("games") });
    for (const u of upgrades[pc.id] ?? []) items.push({ id: `u-${u.title}`, kind: "upgrades", title: u.title, sub: [u.part, u.price].filter(Boolean).join(" · "), badge: u.fit === "fits" ? { text: "Fits", tone: "ok" } : u.fit === "check" ? { text: "Check first", tone: "warn" } : undefined, run: () => open("upgrades") });
    return items;
  }, [pc, ui.changes]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = q.trim().toLowerCase();
  const matched = all.filter((i) => !words || `${i.title} ${i.sub}`.toLowerCase().includes(words));
  const counts = matched.reduce<Record<string, number>>((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {});
  const shown = (tab === "all" ? matched : matched.filter((i) => i.kind === tab)).slice(0, tab === "all" ? 9 : 20);
  const askText = words ? `Ask Rig about "${q.trim()}"` : `What's going on with ${pc.name}?`;
  const runAsk = () => { ask(words ? q.trim() : `What's going on with ${pc.name}?`); close(); };
  const total = shown.length + 1;
  const idx = Math.min(active, total - 1);

  if (!ui.palette) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((idx + 1) % total); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((idx - 1 + total) % total); }
    else if (e.key === "Enter") { e.preventDefault(); if (idx < shown.length) shown[idx].run(); else runAsk(); }
    else if (e.key === "Tab") { e.preventDefault(); runAsk(); }
  };

  let n = -1;
  const groups = (["parts", "changes", "games", "upgrades"] as Kind[]).map((k) => [k, shown.filter((i) => i.kind === k)] as const).filter(([, l]) => l.length);
  return (
    <div className="palette-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}>
        <div className="pal-search">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder={`Search ${pc.name}: parts, changes, games`} aria-label="Search" />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-tabs" role="tablist">
          {(["all", "parts", "changes", "games", "upgrades"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setActive(0); input.current?.focus(); }}>
              {t === "all" ? "All" : kindLabel[t]}<span>{t === "all" ? matched.length : counts[t] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="pal-body">
          {groups.map(([k, list]) => (
            <div key={k} className="pal-group">
              <div className="pal-label">{kindLabel[k]}</div>
              {list.map((i) => {
                n++;
                const me = n;
                return (
                  <button key={i.id} type="button" className="pal-item" aria-current={idx === me} onMouseEnter={() => setActive(me)} onClick={i.run}>
                    <span className="pal-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={icon[k]} /></svg></span>
                    <span className="pal-text"><b>{i.title}</b><span>{i.sub}</span></span>
                    {i.badge && <span className={`pal-badge ${i.badge.tone}`}>{i.badge.text}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {!shown.length && <div className="pal-empty">Nothing on {pc.name} matches. Rig can still look it up for you.</div>}
          <div className="pal-group">
            <div className="pal-label">Ask Rig</div>
            <button type="button" className="pal-item ask" aria-current={idx === shown.length} onMouseEnter={() => setActive(shown.length)} onClick={runAsk}>
              <span className="pal-ico spark"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></svg></span>
              <span className="pal-text"><b>{askText}</b><span>Answers from your parts' manuals and {pc.name}'s own readings</span></span>
            </button>
          </div>
        </div>
        <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Tab</kbd> to ask Rig</span></div>
      </div>
    </div>
  );
}
