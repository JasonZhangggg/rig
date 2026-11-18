import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fanTrend, insightContext, seenLabel, weekEvenings, weekTemps, type HistoryPoint, type PC } from "@rig/core";
import { getStage } from "../components/Stage";
import { useApp, useAppearance, useHistory } from "../state";
import { FansCard, type FansStyle } from "./overview/FansCard";
import { Grid, type Mode } from "./overview/Grid";
import { KINDS, cellsFor, defaultWidget, fullRows, phoneOrder, type Kind, type Tone, type Widget } from "./overview/layout";
import { AddWidgets, DashOptions, ResetConfirm, WidgetOptions } from "./overview/Options";
import { Popover } from "./overview/Popover";
import { TempsCard, type TempsStyle } from "./overview/TempsCard";
import { dashboardKey, useDashboard } from "./overview/useDashboard";
import { WeekCard, type EveningsStyle } from "./overview/WeekCard";
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
  const week = useWeekInsights(pc, useHistory("7d"));
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
      case "pc": return <PCWidget {...props} views={views} />;
      case "health": return <HealthWidget {...props} />;
      case "todo": return <TodoWidget {...props} />;
      case "asks": return <AsksWidget {...props} />;
      case "storage": return <StorageWidget {...props} />;
      case "live": return <LiveWidget {...props} />;
      case "parts": return <PartsWidget {...props} />;
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
  }, [editing, views, week, pc.name, pc.fans]);

  const list = mode === "phone";
  const done = () => { setEditing(false); setPanel(null); announce("Done customizing. Your layout is saved."); document.getElementById("f-customize")?.focus(); };
  const edit = (id?: string) => {
    setEditing(true);
    announce(list ? "Customizing Home. Use the up and down buttons on a tile, or the arrow keys, to change the order." : "Customizing Home. Drag a tile or use the arrow keys to move it.");
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.dw[data-kind="${id}"]`)?.focus({ preventScroll: true }));
  };
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
  const current = panel?.type === "widget" ? shown.find((w) => w.id === panel.id) : undefined;

  return (
    <div className="page f-home" data-density={look.density}>
      <header className="f-head">
        <div className="f-head-text">
          <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
          <p>{pc.online ? `${known ? `${pc.name} is ${pc.health >= 75 ? "running well" : "not at its best"}.` : `Rig is getting to know ${pc.name}.`} ${status}` : `${pc.name} is offline. ${seenLabel(pc)}.`}</p>
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
              <p><b>Customizing Home</b><span>{list ? "Use the arrows on a tile to move it up or down." : "Drag tiles to move them. Pull an edge to resize."}</span></p>
              <div className="dash-bar-tools">
                <button type="button" ref={barAdd} className="dbtn" onClick={(e) => setPanel({ type: "add", at: e.currentTarget })}>Add widget{hidden.length > 0 && <em>{hidden.length}</em>}</button>
                <button type="button" ref={barLayout} className="dbtn" onClick={(e) => setPanel({ type: "dash", at: e.currentTarget })}>Layout</button>
                <button type="button" ref={barReset} className="dbtn" onClick={(e) => setPanel({ type: "reset", at: e.currentTarget })}>Reset</button>
                <button type="button" className="dbtn primary" onClick={done}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {current && panel?.type === "widget" && (
        <Popover anchor={panel.at} label={`${titleOf(current)} options`} onClose={close}>
          <WidgetOptions
            w={current}
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
