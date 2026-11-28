import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Game, Route, Upgrade } from "@rig/core";
import { useApp, useTemp, useUI } from "../state";
import { focusSection, settingsSections } from "../pages/settings/sections";
import { minutes, stateWord, whenRan } from "../pages/logs/words";
import { navItems } from "./Shell";
import { arrowKeys, useModal } from "./modal";
import { useManualSearch } from "../manuals/Search";
import { useManuals } from "../manuals/useManuals";
import { openManual } from "../manuals/viewerState";
import { partOf } from "../pages/upgrades/PCUpgrades";
import { shopCatOf } from "../pages/shared";
import { NET_CHECK_QUESTION } from "./NetCheck";

/** What a page is about, so a search in a person's own words finds it. */
const pageWords: Partial<Record<Route, [string, string]>> = {
  overview: ["Your dashboard: health, temperatures and things to look at", "home dashboard overview health summary tiles customize"],
  pc: ["Your PC in 3D with every part and how warm it runs", "my pc 3d parts specs components hardware temperature"],
  games: ["In Logs: how your games ran and how warm they got", "games fps gaming performance tuning"],
  upgrades: ["On My PC: parts that fit, with prices", "upgrades buy parts price prices compatible compatibility ram memory ssd storage graphics card gpu cpu processor cooler fan power supply psu wattage"],
  manuals: ["On My PC: every part's manual, drivers and BIOS", "manuals manual diagrams pdf drivers driver bios"],
  chat: ["Ask Rig anything about your PC", "ask chat help question"],
  logs: ["Every sensor, live or back to the last month", "logs readings live now real time realtime sensors temperature history temps heat chart graph day week month usage load cpu gpu memory ram fans performance task manager hwmonitor recordings recorded background log closer look custom log yesterday"],
  events: ["In Logs: everything that happened, newest first", "events log feed tail alerts windows event log crashes errors blue screen driver shutdown problems closer look"],
  changes: ["What Rig or you changed, with undo", "changes undo fixes applied review"],
  settings: ["Appearance, units, notifications and your account", "settings preferences appearance colors theme units notifications account"],
};

type Kind = "pages" | "checks" | "parts" | "manuals" | "changes" | "games" | "upgrades" | "logs" | "settings";
/** searchOnly items show once something typed matches them. */
interface Item { id: string; kind: Kind; title: string; sub: string; keys?: string; searchOnly?: boolean; hit?: boolean; badge?: { text: string; tone: string }; run: () => void }

const kindLabel: Record<Kind, string> = { pages: "Pages", checks: "Checks", parts: "Parts", manuals: "Manuals", changes: "Changes", games: "Games", upgrades: "Upgrades", logs: "Logs", settings: "Settings" };
const recTone = { pending: "muted", recording: "info", done: "ok", cancelled: "muted", failed: "warn" } as const;
const icon: Record<Kind, string> = {
  pages: "M5 4h14v16H5zM5 9h14M9 9v11",
  checks: "M3.5 9.5a12 12 0 0 1 17 0M6.5 12.5a7.5 7.5 0 0 1 11 0M9.5 15.5a3 3 0 0 1 5 0M12 19h.01",
  parts: "M6 6h12v12H6zM9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3",
  manuals: "M5 18.5V5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5 1.5 1.5 0 0 0 6.5 20H19M9 8h6",
  changes: "M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2",
  games: "M5 9h14v7H5zM8.5 11v3M7 12.5h3M15 12h.01M17 13.5h.01",
  upgrades: "M12 19V6M7 11l5-5 5 5",
  logs: "M7 4h10v16H7zM10 8h4M10 12h4M10 16h2",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
};

// Ctrl K search across the PC: parts, changes, games, upgrades and recordings, plus "Ask Rig".
// Only there while it's open, so it isn't drawn again on every reading while it's closed.
export function Palette() {
  return useUI().palette ? <OpenPalette /> : null;
}

function OpenPalette() {
  const ctx = useApp();
  const { ui, pc, data, set, go, ask, client, openRecording } = ctx;
  const temp = useTemp();
  const [extra, setExtra] = useState<{ games: Game[]; upgrades: Upgrade[] }>({ games: [], upgrades: [] });
  useEffect(() => {
    if (!ui.palette) return;
    Promise.all([client.games(pc.id), client.upgrades(pc.id)]).then(([games, upgrades]) => setExtra({ games, upgrades })).catch(() => {});
  }, [ui.palette, client, pc.id]);
  const [q, setQ] = useState("");
  const { manuals } = useManuals();
  const pages = useManualSearch(ui.palette ? q : "");
  const [tab, setTab] = useState<"all" | Kind>("all");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useModal(box, ui.palette);
  const close = () => { set({ palette: false }); setQ(""); setTab("all"); setActive(0); };
  const open = (route: Route, patch: Parameters<typeof set>[0] = {}) => { set(patch); go(route); close(); };

  useEffect(() => { if (ui.palette) setTimeout(() => input.current?.focus(), 0); }, [ui.palette]);
  // Escape closes it wherever focus is, and focus goes back where it was.
  useEffect(() => {
    if (!ui.palette) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("keydown", esc);
      if (!document.activeElement || document.activeElement === document.body) back?.focus();
    };
  }, [ui.palette]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo<Item[]>(() => {
    const items: Item[] = [];
    for (const [route, name] of navItems) {
      const [sub, keys] = pageWords[route] ?? ["", ""];
      items.push({ id: `page-${route}`, kind: "pages", title: name, sub, keys, searchOnly: true, run: () => open(route, route === "logs" || route === "events" ? { recordingId: null } : {}) });
    }
    // Read-only checks that run on the PC and answer in a dialog.
    items.push({ id: "check-network", kind: "checks", title: NET_CHECK_QUESTION, sub: `Checks ${pc.name}'s connection, your router and the internet`, keys: "internet slow wifi wi-fi wireless network connection lag ping latency router modem dns vpn ethernet cable signal", run: () => { close(); set({ netCheck: true }); } });
    for (const [id, p] of Object.entries(pc.parts ?? {})) {
      items.push({
        id: `p-${id}`, kind: "parts", title: p.name, sub: [p.type, p.temp !== undefined ? `${temp(p.temp)} now` : p.sub].filter(Boolean).join(" · "),
        badge: p.warn ? { text: "Running warm", tone: "warn" } : undefined,
        run: () => open("pc", { selected: id, tab: "live" }),
      });
    }
    for (const c of data.changes) items.push({ id: `c-${c.id}`, kind: "changes", title: c.title, sub: `${new Date(c.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${c.by === "you" ? "You" : "Rig"}`, badge: { text: c.status === "applied" ? "Applied" : "Undone", tone: c.status === "applied" ? "ok" : "muted" }, run: () => open("changes") });
    for (const g of extra.games) items.push({ id: `g-${g.id}`, kind: "games", title: g.name, sub: [g.res, g.now && `${g.now.avg} FPS`].filter(Boolean).join(" · "), badge: g.now && g.tuned ? { text: `+${g.tuned.avg - g.now.avg} FPS possible`, tone: "info" } : undefined, run: () => open("games") });
    for (const u of extra.upgrades) items.push({ id: `u-${u.title}`, kind: "upgrades", title: u.title, sub: [u.part, u.price].filter(Boolean).join(" · "), badge: u.fit === "fits" ? { text: "Fits", tone: "ok" } : u.fit === "check" ? { text: "Check first", tone: "warn" } : undefined, run: () => { const id = partOf(u, pc); open("upgrades", { shopCat: id ? shopCatOf[id] ?? null : null }); } });
    for (const r of data.recordings) items.push({ id: `r-${r.id}`, kind: "logs", title: r.reason, sub: `Recording · ${whenRan(r)} · ${minutes(r.minutes)}`, keys: r.headline, badge: { text: stateWord[r.state], tone: recTone[r.state] }, run: () => { openRecording(r.id); close(); } });
    for (const m of manuals ?? []) {
      if (!m.indexed) continue;
      items.push({ id: `m-${m.id}`, kind: "manuals", title: m.title, sub: `Manual · ${m.pageCount ?? "?"} pages`, keys: `${m.maker} ${m.model} manual`, searchOnly: true, run: () => { openManual(m.id); close(); } });
      for (const d of m.diagrams) items.push({ id: `m-${m.id}-${d.kind}-${d.page}`, kind: "manuals", title: d.label, sub: `${m.title} · page ${d.page}`, keys: "diagram", searchOnly: true, run: () => { openManual(m.id, d.page); close(); } });
    }
    // Pages whose words match what's typed: found by the manual search, so they always count as a match.
    for (const h of (pages.hits ?? []).slice(0, 5)) {
      items.push({ id: `mp-${h.manualId}-${h.page}`, kind: "manuals", title: `Page ${h.page} of the ${h.title}`, sub: h.snippet.replace(/[«»]/g, ""), hit: true, searchOnly: true, run: () => { openManual(h.manualId, h.page); close(); } });
    }
    for (const sec of settingsSections) {
      if (sec.show && !sec.show(ctx)) continue;
      items.push({ id: `s-${sec.id}`, kind: "settings", title: sec.title, sub: `Settings · ${sec.intro}`, keys: sec.keywords, searchOnly: true, run: () => { focusSection(sec.id); open("settings"); } });
    }
    return items;
  }, [pc, data.changes, data.recordings, extra, temp, manuals, pages.hits]); // eslint-disable-line react-hooks/exhaustive-deps

  const words = q.trim().toLowerCase();
  const matched = all.filter((i) => i.hit || (words ? `${i.title} ${i.sub} ${i.keys ?? ""}`.toLowerCase().includes(words) : !i.searchOnly));
  const counts = matched.reduce<Record<string, number>>((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {});
  const shown = tab === "all"
    ? [...matched.filter((i) => i.kind !== "settings").slice(0, 9), ...matched.filter((i) => i.kind === "settings")]
    : matched.filter((i) => i.kind === tab).slice(0, 20);
  const askText = words ? `Ask Rig about "${q.trim()}"` : `What's going on with ${pc.name}?`;
  const runAsk = () => { ask(words ? q.trim() : `What's going on with ${pc.name}?`); close(); };
  const total = shown.length + 1;
  const idx = Math.min(active, total - 1);

  // The arrow keys keep the highlighted line in view as it moves past the edge of the list.
  useLayoutEffect(() => {
    if (ui.palette) box.current?.querySelector<HTMLElement>('.pal-item[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [ui.palette, idx]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((idx + 1) % total); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((idx - 1 + total) % total); }
    else if (e.key === "Enter" && e.target === input.current) { e.preventDefault(); if (idx < shown.length) shown[idx].run(); else runAsk(); }
    else if (e.key === "Tab" && words && !e.shiftKey && e.target === input.current) { e.preventDefault(); runAsk(); }
  };

  let n = -1;
  const groups = (["pages", "checks", "parts", "manuals", "changes", "games", "upgrades", "logs", "settings"] as Kind[]).map((k) => [k, shown.filter((i) => i.kind === k)] as const).filter(([, l]) => l.length);
  return (
    <div className="palette-scrim" ref={box} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}>
        <div className="pal-search">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Search parts, manuals, games and logs" aria-label="Search" />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-tabs" role="tablist" aria-label="Show" onKeyDown={arrowKeys("tab")}>
          {(["all", "parts", "manuals", "changes", "games", "upgrades", "logs"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => { setTab(t); setActive(0); input.current?.focus(); }}>
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
