import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fanTrend, insightContext, seenLabel, weekEvenings, weekTemps, type HistoryPoint, type PC } from "@rig/core";
import { getStage } from "../components/Stage";
import { useApp, useAppearance, useHistory } from "../state";
import { FansCard, type FansStyle } from "./overview/FansCard";
import { Grid, type Mode } from "./overview/Grid";
import { COLS, KINDS, SIZE_LABEL, cellsFor, defaultWidget, dragFlow, fullRows, orderOf, phoneOrder, presetCells, presetOf, resizeFlow, sizeLabel, stepTarget, type Bp, type Dir, type Kind, type SizeName, type Tone, type Widget } from "./overview/layout";
import { AddWidgets, DashOptions, ResetConfirm, WidgetOptions, type Place } from "./overview/Options";
import { Popover } from "./overview/Popover";
import { TempsCard, type TempsStyle } from "./overview/TempsCard";
import { dashboardKey, useDashboard } from "./overview/useDashboard";
import { WeekCard, type EveningsStyle } from "./overview/WeekCard";
import { ChangesWidget, DriversWidget, DrivesWidget, EventsWidget, GamesWidget, LogsWidget, ManualsWidget, TrendWidget, UpgradeWidget } from "./overview/more";
import { Arrow, AsksWidget, HealthWidget, LiveWidget, PCWidget, PartsWidget, StorageWidget, TodoWidget, checkupQuestion, scored, sourceItems, useHomeIssues, useOpenIssue, type TileBox } from "./overview/widgets";
import { focusSection } from "./settings/sections";
import { firstName, greeting } from "./shared";

const Mic = () => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
const Pulse = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;
const Sliders = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></svg>;

const GAPS = { tight: 14, normal: 24, roomy: 36 } as const;
/** How long the Undo note stays after a change. */
const UNDO_FOR = 6000;

/** Heat and exploded views for the hero. They belong to this page, so leaving it puts the shared scene back. */
function useHeroViews() {
  const [heat, setHeat] = useState(false);
  const [exploded, setExploded] = useState(false);
  useEffect(() => { getStage().scene.setHeat(heat); }, [heat]);
  useEffect(() => { getStage().scene.setExploded(exploded); }, [exploded]);
  useEffect(() => () => { const { scene } = getStage(); scene.setHeat(false); scene.setExploded(false); }, []);
  return useMemo(() => ({ heat, exploded, toggleHeat: () => setHeat((v) => !v), toggleExploded: () => setExploded((v) => !v) }), [heat, exploded]);
}

/** The home charts from the last week of history, in the viewer's local days. Null while history loads. */
function useWeekInsights(pc: PC, points: HistoryPoint[] | null) {
  // The PC object is replaced on every live reading, so the memo keys on the fields the charts read.
  const { kind } = pc;
  const cpu = pc.parts?.cpu?.limit, gpu = pc.parts?.gpu?.limit;
  return useMemo(() => {
    if (!points) return null;
    const ctx = insightContext({ kind, parts: { cpu: { limit: cpu }, gpu: { limit: gpu } } });
    return { recorded: points.length > 0, temps: weekTemps(points, ctx), evenings: weekEvenings(points, ctx), fans: fanTrend(points, ctx, 28) };
  }, [points, kind, cpu, gpu]);
}

type Panel = { type: "widget"; id: string; at: HTMLElement } | { type: "add" | "dash" | "reset"; at: HTMLElement } | null;

const TONE_SAID: Record<Tone | "default", string> = { light: "Every widget is now light.", dark: "Every widget is now dark.", default: "Every widget is back to its first tone." };

/** What an options change did, in a few words for the Undo note. */
function saidFor(w: Widget, patch: Partial<Widget>, ctx: Parameters<typeof sourceItems>[1]) {
  const meta = KINDS[w.kind];
  if (patch.style) return `${meta.title} now shows ${meta.styles.find(([s]) => s === patch.style)?.[1] ?? patch.style}.`;
  if (patch.tone) return `${meta.title} is now ${patch.tone}.`;
  if (patch.frame) return `${meta.title} now sits ${patch.frame === "tile" ? "on a tile" : "on the page"}.`;
  const key = patch.opts && Object.keys(patch.opts).find((k) => JSON.stringify(patch.opts![k]) !== JSON.stringify(w.opts[k]));
  const def = key ? meta.options.find((o) => o.key === key) : undefined;
  if (!def || !patch.opts) return `${meta.title} changed.`;
  const v = patch.opts[def.key];
  if (def.type === "toggle") return `${meta.title}: ${def.label.toLowerCase()} ${v ? "on" : "off"}.`;
  if (def.type === "choice") return `${meta.title}: ${def.label.toLowerCase()}, ${def.choices.find(([c]) => c === v)?.[1].toLowerCase() ?? v}.`;
  const before = (w.opts[def.key] as string[]) ?? [], after = (v as string[]) ?? [];
  const id = after.find((x) => !before.includes(x)) ?? before.find((x) => !after.includes(x));
  const name = sourceItems(def.source, ctx).find(([x]) => x === id)?.[1] ?? id;
  return `${meta.title}: ${name} ${after.includes(id ?? "") ? "hidden" : "shown"}.`;
}

export function Overview() {
  const { pc, data, client, set, ask, go } = useApp();
  const look = useAppearance();
  const { issues, open } = useHomeIssues();
  const openIssue = useOpenIssue();
  const top = open[0] ?? issues[0];
  const name = client.kind === "demo" ? null : firstName(data.account?.name);
  const known = scored(pc);
  const status = open.length === 0 ? "Nothing needs a look." : open.length === 1 ? "One thing needs a look." : `${open.length} things need a look.`;
  const now = new Date();
  const views = useHeroViews();
  const points = useHistory("7d");
  const week = useWeekInsights(pc, points);
  const board = useDashboard(dashboardKey(data.account?.id ?? pc.id));
  const { dash } = board;
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [said, setSaid] = useState("");
  const [mode, setMode] = useState<Mode>("lg");
  const [undoNote, setUndoNote] = useState<{ text: string; n: number } | null>(null);
  const shown = useMemo(() => dash.widgets.filter((w) => !w.hidden), [dash.widgets]);
  const hidden = dash.widgets.filter((w) => w.hidden);
  const cells = useMemo(() => ({ lg: cellsFor(dash, "lg"), md: cellsFor(dash, "md") }), [dash]);
  const phone = useMemo(() => phoneOrder(dash), [dash]);
  const titleOf = useCallback((w: Widget) => KINDS[w.kind].title, []);
  const close = useCallback(() => setPanel(null), []);
  const announce = useCallback((text: string) => setSaid(text), []);
  /** Says what changed, and offers to take it back for a few seconds. */
  const changed = useCallback((text: string) => { setSaid(text); setUndoNote((u) => ({ text, n: (u?.n ?? 0) + 1 })); }, []);
  useEffect(() => {
    if (!undoNote) return;
    const t = setTimeout(() => setUndoNote(null), UNDO_FOR);
    return () => clearTimeout(t);
  }, [undoNote]);
  const undo = useCallback(() => {
    setUndoNote(null);
    setSaid(board.undo() ? "Undone." : "Nothing to undo.");
  }, [board.undo]);

  const render = useCallback((w: Widget, box: TileBox) => {
    const props = { style: w.style, opts: w.opts, box, editing };
    const compact = box.size === "s" || box.rows < fullRows(w.kind);
    const o = w.opts;
    switch (w.kind as Kind) {
      case "pc": return <PCWidget {...props} views={views} points={points} />;
      case "health": return <HealthWidget {...props} />;
      case "todo": return <TodoWidget {...props} />;
      case "asks": return <AsksWidget {...props} />;
      case "storage": return <StorageWidget {...props} />;
      case "live": return <LiveWidget {...props} />;
      case "parts": return <PartsWidget {...props} />;
      case "trend": return <TrendWidget {...props} />;
      case "drives": return <DrivesWidget {...props} />;
      case "changes": return <ChangesWidget {...props} />;
      case "events": return <EventsWidget {...props} />;
      case "games": return <GamesWidget {...props} />;
      case "upgrade": return <UpgradeWidget {...props} />;
      case "drivers": return <DriversWidget {...props} />;
      case "logs": return <LogsWidget {...props} />;
      case "manuals": return <ManualsWidget {...props} />;
      case "temps": return (
        <TempsCard
          temps={week?.temps ?? null} name={pc.name} style={w.style as TempsStyle} days={Number(o.days)} compact={compact}
          show={{ idle: o.idle !== false, typical: o.typical !== false, peak: o.peak !== false }} figure={o.figure !== false} legend={o.legend !== false}
        />
      );
      case "fans": return (
        <FansCard
          fans={pc.fans} trend={week?.fans ?? null} style={w.style as FansStyle} days={Number(o.span)} compact={compact}
          live={o.live !== false} legend={o.legend !== false} off={Array.isArray(o.off) ? o.off : []}
        />
      );
      case "evenings": return (
        <WeekCard
          week={week?.evenings ?? null} recorded={week?.recorded ?? false} name={pc.name} style={w.style as EveningsStyle} days={Number(o.days)} compact={compact}
          background={o.background !== false} total={o.total !== false} legend={o.legend !== false}
        />
      );
    }
  }, [editing, views, week, points, pc.name, pc.fans]);

  const list = mode === "phone";
  // Finishing puts focus back without scrolling: on the widget it was finished from (its handle, the one part of it that
  // takes focus outside customizing), or on Customize Home.
  const refocus = useRef<string | null | undefined>(undefined);
  const done = (from?: string) => { refocus.current = from ?? null; setEditing(false); setPanel(null); announce("Done customizing. Your layout is saved."); };
  // On a phone the list opens up for each tile's buttons when customizing starts, so the tile that was pressed, or the first
  // one on screen, is measured first and the page scrolls by however far it moved, keeping it under the finger.
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const edit = (id?: string, held?: string) => {
    if (list) {
      const tiles = [...document.querySelectorAll<HTMLElement>(".dash .dg")];
      const el = tiles.find((t) => t.dataset.id === (held ?? id)) ?? tiles.find((t) => t.getBoundingClientRect().bottom > 0);
      anchor.current = el ? { id: el.dataset.id!, top: el.getBoundingClientRect().top } : null;
    }
    setEditing(true);
    announce(list ? "Customizing Home. Use the up and down buttons on a widget, or the arrow keys, to change the order." : "Customizing Home. Drag a widget or use the arrow keys to move it.");
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.dw[data-kind="${id}"]`)?.focus({ preventScroll: true }));
  };
  useLayoutEffect(() => {
    const a = anchor.current, from = refocus.current;
    anchor.current = null;
    refocus.current = undefined;
    if (editing && a) {
      const el = document.querySelector<HTMLElement>(`.dash .dg[data-id="${a.id}"]`);
      const by = el ? el.getBoundingClientRect().top - a.top : 0;
      if (Math.abs(by) >= 1) window.scrollBy({ top: by, behavior: "instant" });
    }
    if (!editing && from !== undefined) {
      const tile = from ? document.querySelector<HTMLElement>(`.dash .dg[data-id="${from}"] .dw-grip`) : null;
      (tile ?? document.getElementById("f-customize"))?.focus({ preventScroll: true });
    }
  }, [editing]);
  const hide = (id: string) => {
    const w = shown.find((x) => x.id === id);
    board.hide(id);
    if (panel?.type === "widget") close();
    if (w) changed(`${titleOf(w)} hidden. Add it back from Add widget.`);
  };

  // Escape finishes and Ctrl or Command Z undoes, from anywhere on the page while customizing.
  const keys = useRef({ panel, done, undo });
  keys.current = { panel, done, undo };
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable='true']");
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); keys.current.undo(); }
      else if (e.key === "Escape" && !keys.current.panel) { e.preventDefault(); keys.current.done(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing]);
  const setTones = (tone: Tone | "default") => {
    board.change((d) => ({ ...d, widgets: d.widgets.map((w) => ({ ...w, tone: tone === "default" ? defaultWidget(w.kind).tone : tone })) }));
    changed(TONE_SAID[tone]);
  };

  // A panel stays with what opened it. When that control goes (the empty Home's Add widget button once a widget is back),
  // the panel moves to the same control on the customize bar, or to the tile's own options button, or closes.
  const barAdd = useRef<HTMLButtonElement>(null), barLayout = useRef<HTMLButtonElement>(null), barReset = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!panel || panel.at.isConnected) return;
    const next = panel.type === "widget"
      ? document.querySelector<HTMLElement>(`.dg[data-id="${panel.id}"] .dw-opt`)
      : { add: barAdd, dash: barLayout, reset: barReset }[panel.type].current;
    setPanel(next ? { ...panel, at: next } : null);
  });
  /** The bar's buttons open their panel, and shut it when pressed again. */
  const toggle = (type: "add" | "dash" | "reset", at: HTMLElement) => setPanel((p) => (p?.type === type ? null : { type, at }));
  const current = panel?.type === "widget" ? shown.find((w) => w.id === panel.id) : undefined;

  // On a grid, a widget's options also size and move it, so dragging is never the only way.
  const placeOf = (w: Widget): Place | undefined => {
    if (list) return undefined;
    const bp: Bp = mode === "md" ? "md" : "lg", n = COLS[bp], now = cells[bp];
    const me = now.find((c) => c.i === w.id);
    if (!me) return undefined;
    const title = titleOf(w);
    return {
      size: presetOf(w.kind, me.w, me.h, n) ?? "",
      sizes: (Object.keys(KINDS[w.kind].sizes) as SizeName[]).map((k) => [k, SIZE_LABEL[k]]),
      onSize: (k) => {
        const [pw, ph] = presetCells(w.kind, k as SizeName, n);
        board.setCells(bp, resizeFlow(now, w.id, pw, ph, n));
        changed(`${title} is now ${SIZE_LABEL[k as SizeName]}.`);
      },
      canMove: (dir: Dir) => {
        const to = stepTarget(now, w.id, dir, n);
        const next = to && dragFlow(now, w.id, to.x, to.y, n);
        return !!next && next.some((c) => { const o = now.find((x) => x.i === c.i); return !o || o.x !== c.x || o.y !== c.y || o.w !== c.w || o.h !== c.h; });
      },
      onMove: (dir: Dir) => {
        const to = stepTarget(now, w.id, dir, n);
        const next = to && dragFlow(now, w.id, to.x, to.y, n);
        if (!next) { announce(`${title} can't move further ${dir}.`); return; }
        const order = orderOf(next), got = next.find((c) => c.i === w.id)!;
        board.setCells(bp, next);
        changed(`${title} moved to place ${order.indexOf(w.id) + 1} of ${order.length}.${got.w !== me.w ? ` It's now ${sizeLabel(w.kind, got.w, got.h, n)}.` : ""}`);
      },
    };
  };

  return (
    <div className="page f-home" data-density={look.density}>
      <header className="f-head">
        <div className="f-head-text">
          <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
          <p>{pc.online ? `${known ? `${pc.name} is ${pc.health >= 75 ? "running well" : "not at its best"}.` : `Rig is getting to know ${pc.name}.`} ${status}` : `${pc.name} is offline. ${seenLabel(pc)}.`}</p>
          <button type="button" className="f-check" onClick={() => set({ slowLoud: true })}>Slow or loud? <span>Check now</span></button>
        </div>
        <div className="f-head-tools">
          <div className="f-date"><b>{now.getDate()}</b><span>{now.toLocaleDateString(undefined, { weekday: "short" })},<br />{now.toLocaleDateString(undefined, { month: "long" })}</span></div>
          {top && (
            <button type="button" className="f-cta" onClick={() => openIssue(top)}>
              <span>{open.length ? "Review" : "See what's new"}</span>
              {open.length > 0 && <em>{open.length}</em>}
              <i><Arrow /></i>
            </button>
          )}
          <button type="button" className="f-round" aria-label="Run a checkup" title="Run a checkup" onClick={() => ask(checkupQuestion(pc.name))}><Pulse /></button>
          <button type="button" className="f-round f-mic" aria-label="Ask Rig" title="Ask Rig" onClick={() => set({ palette: true })}><Mic /></button>
          <button type="button" id="f-customize" className="f-round f-custom" aria-label="Customize Home" title="Customize Home" aria-pressed={editing} onClick={() => (editing ? done() : edit())}><Sliders /></button>
        </div>
      </header>

      {shown.length ? (
        <Grid
          widgets={shown} cells={cells} phone={phone} editing={editing} compact={look.density === "compact"} gap={GAPS[dash.spacing]}
          titleOf={titleOf} render={render} announce={announce} onEdit={edit} onDone={done} onMode={setMode}
          onCells={(bp, next, text) => { board.setCells(bp, next); changed(text); }}
          onPhone={(order, text) => { board.setPhone(order); changed(text); }}
          onHide={hide}
          onOptions={(id, at) => setPanel({ type: "widget", id, at })}
        />
      ) : (
        <div className="dash-empty">
          <p>Home is empty. Add a widget to see {pc.name} here again.</p>
          <button type="button" className="dbtn primary" onClick={(e) => { setEditing(true); setPanel({ type: "add", at: e.currentTarget }); }}>Add widget</button>
        </div>
      )}

      <p id="dash-keys" className="sr-only">Arrow keys move this widget. Shift and arrow keys resize it. Delete hides it. Enter or Escape finishes.</p>
      <div className="sr-only" aria-live="polite">{said}</div>

      {/* Floats over the bottom of the window and takes no room, so customizing never moves the page. */}
      <div className="dash-dock">
        <div className="dash-dock-in">
          {undoNote && (
            <div className="dash-toast tone-dark" key={undoNote.n}>
              <span>{undoNote.text}</span>
              <button type="button" onClick={undo}>Undo</button>
            </div>
          )}
          {editing && (
            <div className="dash-bar tone-dark" role="toolbar" aria-label="Customize Home">
              <p><b>Customizing Home</b><span>{list ? "Use the arrows on a widget to move it up or down." : "Drag widgets to move them and pull an edge to resize, or use a widget's options."}</span></p>
              <div className="dash-bar-tools">
                <button type="button" ref={barAdd} className="dbtn" aria-haspopup="dialog" aria-expanded={panel?.type === "add"} onClick={(e) => toggle("add", e.currentTarget)}>Add widget{hidden.length > 0 && <em>{hidden.length}</em>}</button>
                <button type="button" ref={barLayout} className="dbtn" aria-haspopup="dialog" aria-expanded={panel?.type === "dash"} onClick={(e) => toggle("dash", e.currentTarget)}>Layout</button>
                <button type="button" ref={barReset} className="dbtn" aria-haspopup="dialog" aria-expanded={panel?.type === "reset"} onClick={(e) => toggle("reset", e.currentTarget)}>Reset</button>
                <button type="button" className="dbtn primary" onClick={() => done()}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {current && panel?.type === "widget" && (
        <Popover anchor={panel.at} label={`${titleOf(current)} options`} onClose={close}>
          <WidgetOptions
            w={current}
            place={placeOf(current)}
            onChange={(patch) => {
              const text = saidFor(current, patch, { pc });
              board.setWidget(current.id, patch);
              changed(text);
            }}
          />
        </Popover>
      )}
      {panel?.type === "add" && (
        <Popover anchor={panel.at} label="Add widget" onClose={close}>
          <AddWidgets hidden={hidden} onAdd={(id) => { board.add(id); changed(`${KINDS[id as Kind].title} added.`); if (hidden.length <= 1) close(); }} />
        </Popover>
      )}
      {panel?.type === "dash" && (
        <Popover anchor={panel.at} label="Home layout" onClose={close}>
          <DashOptions
            dash={dash} onTone={setTones}
            onSpacing={(spacing) => { board.change((d) => ({ ...d, spacing })); changed(`Spacing is now ${spacing}.`); }}
            onAppearance={() => { close(); setEditing(false); focusSection("appearance"); go("settings"); }}
          />
        </Popover>
      )}
      {panel?.type === "reset" && (
        <Popover anchor={panel.at} label="Reset Home?" onClose={close} width={340}>
          <ResetConfirm onCancel={close} onReset={() => { board.reset(); close(); changed("Home is back to how it started."); }} />
        </Popover>
      )}
    </div>
  );
}
