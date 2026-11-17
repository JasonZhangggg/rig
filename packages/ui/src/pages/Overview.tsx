import { useCallback, useEffect, useMemo, useState } from "react";
import { fanTrend, insightContext, seenLabel, weekEvenings, weekTemps, type HistoryPoint, type PC } from "@rig/core";
import { getStage } from "../components/Stage";
import { useApp, useHistory } from "../state";
import { FansCard, type FansStyle } from "./overview/FansCard";
import { Grid } from "./overview/Grid";
import { KINDS, SIZE_LABEL, defaultWidget, type Kind, type Tone, type Widget } from "./overview/layout";
import { AddWidgets, DashOptions, ResetConfirm, WidgetOptions } from "./overview/Options";
import { Popover } from "./overview/Popover";
import { TempsCard, type TempsStyle } from "./overview/TempsCard";
import { dashboardKey, useDashboard } from "./overview/useDashboard";
import { WeekCard, type EveningsStyle } from "./overview/WeekCard";
import { Arrow, AsksWidget, HealthWidget, LiveWidget, PCWidget, PartsWidget, StorageWidget, TodoWidget, checkupQuestion, useHomeIssues, useOpenIssue, type TileBox } from "./overview/widgets";
import { firstName, greeting } from "./shared";

const Mic = () => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
const Pulse = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;
const Sliders = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></svg>;

const GAPS = { tight: 14, normal: 24, roomy: 36 } as const;

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

export function Overview() {
  const { pc, data, client, set, ask } = useApp();
  const { issues, open } = useHomeIssues();
  const openIssue = useOpenIssue();
  const top = open[0] ?? issues[0];
  const name = client.kind === "demo" ? null : firstName(data.account?.name);
  const status = open.length === 0 ? "Nothing needs a look." : open.length === 1 ? "One thing needs a look." : `${open.length} things need a look.`;
  const now = new Date();
  const views = useHeroViews();
  const week = useWeekInsights(pc, useHistory("7d"));
  const board = useDashboard(dashboardKey(data.account?.id ?? pc.id));
  const { dash } = board;
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [said, setSaid] = useState("");
  const shown = dash.widgets.filter((w) => !w.hidden);
  const hidden = dash.widgets.filter((w) => w.hidden);
  const titleOf = useCallback((w: Widget) => KINDS[w.kind].title, []);
  const close = useCallback(() => setPanel(null), []);
  const announce = useCallback((text: string) => setSaid(text), []);

  const render = useCallback((w: Widget, box: TileBox) => {
    const props = { style: w.style, opts: w.opts, box, editing };
    const compact = box.size === "s";
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

  const done = () => { setEditing(false); setPanel(null); announce("Done customizing. Your layout is saved."); document.getElementById("f-customize")?.focus(); };
  const edit = (id?: string) => {
    setEditing(true);
    announce("Customizing Home. Drag a tile or use the arrow keys to move it.");
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.dw[data-kind="${id}"]`)?.focus());
  };
  const setTones = (tone: Tone | "default") => board.change((d) => ({ ...d, widgets: d.widgets.map((w) => ({ ...w, tone: tone === "default" ? defaultWidget(w.kind).tone : tone })) }));
  const current = panel?.type === "widget" ? shown.find((w) => w.id === panel.id) : undefined;

  return (
    <div className="page f-home" data-density={dash.density} data-corners={dash.corners}>
      <header className="f-head">
        <div className="f-head-text">
          <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
          <p>{pc.online ? `${pc.name} is ${pc.health >= 75 ? "running well" : "not at its best"}. ${status}` : `${pc.name} is offline. ${seenLabel(pc)}.`}</p>
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

      {editing && (
        <div className="dash-bar tone-dark" role="toolbar" aria-label="Customize Home">
          <p><b>Customizing Home.</b> Drag a tile to move it, drag its corner to resize it.</p>
          <div className="dash-bar-tools">
            <button type="button" className="dbtn" onClick={(e) => setPanel({ type: "add", at: e.currentTarget })}>Add widget{hidden.length > 0 && <em>{hidden.length}</em>}</button>
            <button type="button" className="dbtn" onClick={(e) => setPanel({ type: "dash", at: e.currentTarget })}>Dashboard</button>
            <button type="button" className="dbtn" onClick={(e) => setPanel({ type: "reset", at: e.currentTarget })}>Reset</button>
            <button type="button" className="dbtn primary" onClick={done}>Done</button>
          </div>
        </div>
      )}

      {shown.length ? (
        <Grid
          widgets={shown} editing={editing} compact={dash.density === "compact"} gap={GAPS[dash.spacing]}
          titleOf={titleOf} render={render} announce={announce} onEdit={edit} onDone={done}
          onMove={(id, to, size) => board.move(id, to, size ? { size } : undefined)}
          onResize={(id, size) => board.setWidget(id, { size })}
          onOptions={(id, at) => setPanel({ type: "widget", id, at })}
        />
      ) : (
        <div className="dash-empty">
          <p>Your dashboard is empty. Add a widget to see {pc.name} here again.</p>
          <button type="button" className="dbtn primary" onClick={(e) => { setEditing(true); setPanel({ type: "add", at: e.currentTarget }); }}>Add widget</button>
        </div>
      )}

      <p id="dash-keys" className="sr-only">Arrow keys move this widget. Shift and arrow keys resize it. Enter or Escape finishes.</p>
      <div className="sr-only" aria-live="polite">{said}</div>

      {current && panel?.type === "widget" && (
        <Popover anchor={panel.at} label={`${titleOf(current)} options`} onClose={close}>
          <WidgetOptions
            w={current} index={shown.indexOf(current)} count={shown.length}
            onChange={(patch) => {
              board.setWidget(current.id, patch);
              if (patch.size) announce(`${titleOf(current)} is now ${SIZE_LABEL[patch.size]}.`);
              if (patch.tone) announce(`${titleOf(current)} is now ${patch.tone}.`);
            }}
            onMove={(to) => { board.move(current.id, to); announce(`${titleOf(current)} moved to place ${to + 1} of ${shown.length}.`); }}
            onHide={() => { board.setWidget(current.id, { hidden: true }); close(); announce(`${titleOf(current)} hidden. Add it back from Add widget.`); }}
            onReset={() => { board.resetWidget(current.id); announce(`${titleOf(current)} is back to how it started.`); }}
          />
        </Popover>
      )}
      {panel?.type === "add" && (
        <Popover anchor={panel.at} label="Add widget" onClose={close}>
          <AddWidgets hidden={hidden} onAdd={(id) => { board.add(id); announce(`${KINDS[id as Kind].title} added at the end.`); if (hidden.length <= 1) close(); }} />
        </Popover>
      )}
      {panel?.type === "dash" && (
        <Popover anchor={panel.at} label="Dashboard" onClose={close}>
          <DashOptions dash={dash} onChange={(patch) => board.change((d) => ({ ...d, ...patch }))} onTone={setTones} />
        </Popover>
      )}
      {panel?.type === "reset" && (
        <Popover anchor={panel.at} label="Reset Home?" onClose={close} width={340}>
          <ResetConfirm onCancel={close} onReset={() => { board.reset(); close(); announce("Home is back to how it started."); }} />
        </Popover>
      )}
    </div>
  );
}
