import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { arrowKeys } from "../components/modal";
import {
  coreLoad, coresOf, findReadings, HOT_MARGIN, historySummary, keyReadings, livePoint, sensorGroups, sensorKinds, STEADY_MARGIN,
  type BusySummary, type SensorType, type Core, type HistoryKey, type HistoryPoint, type HistorySummary, type PC, type Range, type Reading, type ReadingUnit, type TempFormat,
} from "@rig/core";
import { calm, ChartNote, LineChart } from "../chart";
import { Figure } from "../components/Figure";
import { useApp, useData, useHistory, useTemp, type LivePoint } from "../state";
import { Events } from "./history/Events";
import { LogsHead } from "./logs/Head";

type Temp = (celsius: number | null | undefined, opts?: TempFormat) => string;
/** A difference between two temperatures, like "6° warmer": scaled to the unit, not offset. */
const diff = (temp: Temp, celsius: number) => temp(celsius, { delta: true, mark: "degree" });

/** One line a part's charts draw: the reading, its unit and what the chart is called. */
interface Metric { key: HistoryKey; unit: ReadingUnit; title: string }

/** A part in the list down the side, with the readings it charts. The first reading leads: its figures and its sparkline. */
interface PartLine { id: string; name: string; model: string; metrics: Metric[]; limit?: number }

/** The parts this PC has, in the order Task Manager would list them, each with what Rig logs for it. */
export function partLines(pc: PC): PartLine[] {
  const p = pc.parts ?? {};
  const has = (id: string) => (pc.readings ?? []).some((r) => r.part === id);
  const out: PartLine[] = [];
  const temp = (key: HistoryKey): Metric => ({ key, unit: "temp", title: "Temperature" });
  if (p.cpu) out.push({ id: "cpu", name: "Processor", model: p.cpu.name, limit: p.cpu.limit, metrics: [temp("cpu"), { key: "cpuLoad", unit: "percent", title: "Usage" }] });
  if (p.gpu) out.push({ id: "gpu", name: "Graphics card", model: p.gpu.name, limit: p.gpu.limit, metrics: [temp("gpu"), { key: "gpuLoad", unit: "percent", title: "Usage" }] });
  if (p.ram) out.push({ id: "ram", name: "Memory", model: p.ram.name, metrics: [{ key: "mem", unit: "percent", title: "In use" }] });
  if (p.ssd) out.push({ id: "ssd", name: "Storage", model: p.ssd.name, metrics: [temp("drive")] });
  const board = p.motherboard ? "motherboard" : p.board ? "board" : null;
  if (board) out.push({ id: board, name: "Motherboard", model: p[board].name, metrics: [temp("board")] });
  if (p.fans) out.push({ id: "fans", name: "Fans", model: p.fans.name, metrics: [{ key: "fan", unit: "rpm", title: "Fastest fan" }] });
  if (p.battery && has("battery")) out.push({ id: "battery", name: "Battery", model: p.battery.name, metrics: [] });
  return out;
}

/** A history reading in its unit: a temperature in the viewer's unit, a share, or a fan speed. */
function show(temp: Temp, unit: ReadingUnit, v: number | null | undefined) {
  if (v == null) return "–";
  return unit === "temp" ? temp(v) : unit === "percent" ? `${Math.round(v)}%` : `${Math.round(v).toLocaleString("en-US")} rpm`;
}

function busyNote(b: BusySummary | null, unit: ReadingUnit, temp: Temp) {
  if (!b) return "Nothing heavy ran in this range.";
  if (unit !== "temp" || b.change == null) return "Typical when busy.";
  if (b.change >= STEADY_MARGIN) return `${diff(temp, b.change)} warmer than before.`;
  if (b.change <= -STEADY_MARGIN) return `${diff(temp, -b.change)} cooler than before.`;
  return "Same as before.";
}

/** When the highest moment was, what was running, and how close it came to the limit. */
function peakNote(peak: NonNullable<HistorySummary["peak"]>, points: readonly HistoryPoint[], range: Range, laptop: boolean, temp: Temp) {
  const when = new Date(peak.t).toLocaleString(undefined, range === "30d"
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : range === "24h" ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
  const at = points.find((p) => p.t === peak.t);
  const doing = at?.game ? `during ${at.game}` : at?.busy ? `during ${laptop ? "a busy period" : "heavy work"}` : "while nothing heavy was running";
  if (peak.headroom == null) return `${when}, ${doing}.`;
  const margin = peak.headroom > 0 ? `${diff(temp, peak.headroom)} under the limit` : peak.headroom < 0 ? `${diff(temp, -peak.headroom)} over the limit` : "Right at the limit";
  return `${when}, ${doing}. ${margin[0].toUpperCase()}${margin.slice(1)}.`;
}

const highestLabel: Record<ReadingUnit, string> = { temp: "Hottest moment", percent: "Busiest moment", rpm: "Fastest" };

/** What the charts are showing besides the lines: a pinned moment, or the busy periods picked out. Keyed so a second click lets go. */
interface Focus { key: string; pin?: number }

const reduceMotion = () => document.documentElement.dataset.motion === "reduce" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** How far back the live charts reach. */
const LIVE_MS = 5 * 60_000;

/** The last few minutes of the PC's live readings, kept since Rig opened, so the live charts are full the first time you look. */
function useLive(): LivePoint[] {
  const { live } = useData("live");
  const from = (live[live.length - 1]?.t ?? 0) - LIVE_MS;
  return useMemo(() => (live.length && live[0].t < from ? live.filter((p) => p.t >= from) : live), [live, from]);
}

/** Each part's own charts and readings, the way Task Manager's Performance tab and HWMonitor lay them out. */
export function History() {
  const { ui, pc, set, ask } = useApp();
  const temp = useTemp();
  const pts = useHistory(ui.range);
  const recent = useLive();
  const [live, setLive] = useState(false);
  const lines = partLines(pc);
  // The graphics card leads where there is one, as it's what heats up in games.
  const [sel, setSel] = useState(pc.parts?.gpu ? "gpu" : lines[0]?.id);
  const part = lines.find((l) => l.id === sel) ?? lines[0];
  const [focus, setFocus] = useState<Focus | null>(null);
  // The kind of sensor shown under the charts, kept as you move between parts when the next one has it too.
  const [kind, setKind] = useState<SensorType | null>(null);
  // One sensor picked to chart on its own, like the hot spot or core 3; null charts the whole kind.
  const [one, setOne] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const paneRef = useRef<HTMLElement>(null);
  const has = !!pts && pts.length > 1;
  const now = livePoint(pc, Date.now());
  const limited = !!pc.issues?.some((i) => i.id === "needs-admin" || i.id === "needs-driver");

  /** Shows a moment, or the busy periods, on the charts; the same one again lets go. */
  const toggle = (key: string, pin?: number) => {
    if (focus?.key === key) return setFocus(null);
    setFocus({ key, pin });
    if (pin != null) paneRef.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  };
  const pick = (r: Range | "live") => {
    setFocus(null);
    if (r === "live") return setLive(true);
    setLive(false);
    set({ range: r });
  };
  const choose = (id: string) => { setSel(id); setFocus(null); setQ(""); };
  const searching = q.trim() !== "";
  const mine = (pc.readings ?? []).filter((r) => r.part === part?.id);
  const views = part ? viewsOf(part, mine) : [];
  const view = views.find((v) => v.type === kind) ?? views[0];
  const sensor = mine.find((r) => r.id === one && r.type === view?.type) ?? null;
  const metric = sensor ? undefined : part?.metrics.find((m) => metricKind[m.unit] === view?.type);
  const ofKind = mine.filter((r) => r.type === view?.type);
  const shown = live ? recent : pts ?? [];

  return (
    <div className="page hi-page">
      <LogsHead sub={`Each part's temperature and usage on ${pc.name}, logged while Rig runs.`} right={
        <div className="seg" role="group" aria-label="Range">
          <button type="button" aria-pressed={live} onClick={() => pick("live")}>Live</button>
          {(["24h", "7d", "30d"] as const).map((r) => <button key={r} type="button" aria-pressed={!live && ui.range === r} onClick={() => pick(r)}>{r === "24h" ? "Day" : r === "7d" ? "Week" : "Month"}</button>)}
        </div>
      } />

      {!live && pts && pts.length < 2 && (
        <section className="card hi-empty">
          <div className="hi-empty-text">
            <h2 className="plain-h">Your history fills in as Rig runs</h2>
            <p className="muted">Leave Rig open and each part's readings land here as {pc.name} runs. After a day you can see the pattern; after a week, whether it's running warmer than it used to.</p>
            <div><button className="btn" type="button" onClick={() => ask(`What temperatures are normal for ${pc.name}?`)}>Ask what's normal</button></div>
          </div>
          <ul className="hi-empty-list" aria-label="What shows up here">
            <li><b>A chart for every part</b><span className="muted">Temperature and use for the processor{pc.parts?.gpu ? ", graphics card" : ""}, memory, drive and fans.</span></li>
            <li><b>Busy times, shaded</b><span className="muted">So you can see what made it warm.</span></li>
            <li><b>Every sensor, lowest to highest</b><span className="muted">What each one reads now, and the range it has run in.</span></li>
          </ul>
        </section>
      )}

      {part && (
        <div className="pf-grid">
          <div className="pf-side">
          <input className="input pf-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
            placeholder="Find a reading, like core 3" aria-label="Find a reading" aria-controls="pf-pane" />
          <div className="pf-rail" role="group" aria-label="Parts">
            {lines.map((l) => {
              const lead = l.metrics[0];
              const second = l.metrics[1];
              const v = lead ? now[lead.key] : null;
              const hot = lead?.unit === "temp" && l.limit != null && v != null && v >= l.limit - HOT_MARGIN;
              return (
                <button key={l.id} type="button" className="pf-part" aria-pressed={!searching && l.id === part.id} onClick={() => choose(l.id)}>
                  <span className="pf-part-name">{l.name}</span>
                  {lead && (
                    <span className="pf-part-now">
                      <b className={`num${hot ? " look" : ""}`}>{show(temp, lead.unit, v)}</b>
                      {second && now[second.key] != null && <span className="faint num">{show(temp, second.unit, now[second.key])}</span>}
                    </span>
                  )}
                  {lead && <Spark points={shown} m={lead} />}
                </button>
              );
            })}
          </div>
          </div>

          {searching ? (
            <Found query={q} readings={pc.readings ?? []} lines={lines} onOpen={(id, type, sensor) => { choose(id); setKind(type); setOne(sensor); }} />
          ) : (
          <section id="pf-pane" ref={paneRef} className={`pf-pane${focus?.key === "busy" ? " busy" : ""}`} aria-labelledby="pf-h">
            <div className="pf-head">
              <h2 id="pf-h" className="pf-title">{part.name}</h2>
              <span className="muted">{part.model}</span>
              {views.length > 0 && (
                <Picker views={views} kind={view.type} sensor={sensor}
                  onPick={(k) => { setKind(k); setOne(null); setFocus(null); }} />
              )}
            </div>
            <KeyReadings part={part.id} readings={pc.readings ?? []} />
            {limited && ["cpu", "motherboard", "fans"].includes(part.id) && (
              <p className="callout pf-limited">{pc.issues?.some((i) => i.id === "needs-driver")
                ? "Processor and per-core temperatures, board voltages and case fans come through PawnIO, a small driver that installs with Rig. It isn't on this PC yet, so some sensors are missing."
                : "Windows only shares processor temperatures, board voltages and case fans with apps that have admin permission, so some sensors are missing."}</p>
            )}
            {!live && has && metric && <Figures part={part} metric={metric} points={pts!} focus={focus} onToggle={toggle} />}
            {metric && (live || has) && (
              <div className="pf-chart">
                <div className="pf-chart-head">
                  <h3 className="label">{metric.title}</h3>
                  <div className="legend">
                    {metric.unit === "temp" && part.limit != null && <span><i className="lg-limit" />Safe limit</span>}
                    {!live && <span><i className="hi-lg-band" />Busy</span>}
                  </div>
                </div>
                {live && recent.length < 2
                  ? <ChartNote>{pc.online ? "Live readings draw here as they come in." : `${pc.name} is offline, so there's nothing live to show.`}</ChartNote>
                  : <LineChart points={shown} series={[{ key: metric.key, cls: "gpu", name: metric.unit === "rpm" ? metric.title : part.name }]} unit={metric.unit}
                      h={240} label={`${part.name}, ${metric.title.toLowerCase()}`}
                      limit={metric.unit === "temp" && part.limit != null ? { v: part.limit, label: `${temp(part.limit)} limit` } : undefined}
                      bands={!live} pin={live ? null : focus?.pin ?? null} onUnpin={() => setFocus(null)} />}
              </div>
            )}
            {!metric && view && (
              <div className="pf-chart">
                <div className="pf-chart-head">
                  <h3 className="label">{sensor ? sensor.name : `All ${view.title.toLowerCase()}`}</h3>
                  <span className="faint">The last five minutes</span>
                </div>
                <SensorChart readings={sensor ? [sensor] : ofKind} recent={recent} online={!!pc.online} label={`${part.name}, ${sensor ? sensor.name : view.title.toLowerCase()}`} />
              </div>
            )}
            {metric && !live && pts == null && <ChartNote busy>Loading…</ChartNote>}
            {metric && live && <p className="faint pf-live-note">The last five minutes. Day, Week and Month show what Rig logged.</p>}
            {part.id === "cpu" && view?.type === "load" && <Cores readings={mine} recent={recent} />}
            {view && <Readings part={part} title={view.title} readings={ofKind} logged={!!metric} picked={sensor?.id ?? null}
              onPick={(id) => { setOne(id); setFocus(null); if (id) paneRef.current?.querySelector(".pf-chart")?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" }); }} />}
          </section>
          )}
        </div>
      )}

      {!live && has && (
        <div className="hi-detail">
          <h2 className="lg-h">Busy times</h2>
          <Events key={ui.range} points={pts!} range={ui.range} pinned={focus?.pin != null ? focus.key : null} onPin={toggle} />
        </div>
      )}
    </div>
  );
}

/** The part's highest moment, what it reads when busy, and at rest, over the range. */
function Figures({ part, metric: m, points, focus, onToggle }: { part: PartLine; metric: Metric; points: HistoryPoint[]; focus: Focus | null; onToggle: (key: string, pin?: number) => void }) {
  const { ui, pc } = useApp();
  const temp = useTemp();
  const { busy, idle, peak } = historySummary(points, m.key, m.unit === "temp" ? part.limit : undefined);
  const warmer = m.unit === "temp" && busy?.change != null && busy.change >= STEADY_MARGIN;
  return (
    <div className="figs" role="group" aria-label="Key figures">
      {peak && <Figure label={highestLabel[m.unit]} figure={show(temp, m.unit, peak.value)} warn={peak.headroom != null && peak.headroom <= 0}
        note={peakNote(peak, points, ui.range, pc.kind === "laptop", temp)} pressed={focus?.key === "peak"} onClick={() => onToggle("peak", peak.t)} />}
      <Figure label="When busy" figure={show(temp, m.unit, busy?.typical)} warn={warmer} note={busyNote(busy, m.unit, temp)}
        pressed={busy ? focus?.key === "busy" : undefined} onClick={() => onToggle("busy")} />
      <Figure label="At rest" figure={show(temp, m.unit, idle)} note={idle != null ? "Typical when idle." : "No idle time logged."} />
    </div>
  );
}

/** The smallest spread a sparkline draws across its height, so a degree or two of drift stays a flat line. */
const sparkSpan: Record<ReadingUnit, number> = { temp: 12, percent: 20, rpm: 400 };

/** A small line of one reading across the range, for the list of parts. */
function Spark({ points, m }: { points: HistoryPoint[]; m: Metric }) {
  const w = 120, h = 28, k = m.key;
  const pts = calm(points, [k], 40).filter((p) => p[k] != null);
  if (pts.length < 2) return <span className="pf-spark" aria-hidden="true" />;
  const vs = pts.map((p) => p[k]!);
  const mid = (Math.min(...vs) + Math.max(...vs)) / 2, half = Math.max(Math.max(...vs) - Math.min(...vs), sparkSpan[m.unit]) / 2;
  const lo = mid - half, hi = mid + half, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(((p.t - t0) / (t1 - t0 || 1)) * w).toFixed(1)},${(h - 2 - ((p[k]! - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`).join("");
  return <svg className="pf-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={d} vectorEffect="non-scaling-stroke" /></svg>;
}

/** A sensor reading in its unit, as a hardware monitor shows it. */
function reading(temp: Temp, type: Reading["type"], v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "–";
  switch (type) {
    case "temperature": return temp(v);
    case "load": case "level": case "control": return `${Math.round(v)}%`;
    case "fan": return `${Math.round(v).toLocaleString("en-US")} rpm`;
    case "clock": return v >= 1000 ? `${(v / 1000).toFixed(2)} GHz` : `${Math.round(v)} MHz`;
    case "power": return `${v.toFixed(1)} W`;
    case "voltage": return `${v.toFixed(3)} V`;
    case "data": return v >= 1000 ? `${(v / 1000).toFixed(1)} TB` : `${v.toFixed(1)} GB`;
    case "throughput": return v >= 1e9 ? `${(v / 1e9).toFixed(2)} GB/s` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB/s` : `${Math.round(v / 1e3)} KB/s`;
    case "current": return `${v.toFixed(2)} A`;
  }
}

/** The part's sensors of the kind picked at the top, each with now, lowest and highest. */
function Readings({ part, title, readings, logged, picked, onPick }: {
  part: PartLine; title: string; readings: Reading[]; logged: boolean; picked: string | null; onPick: (id: string | null) => void;
}) {
  if (!readings.length) return null;
  return (
    <section className="pf-readings" aria-labelledby="pf-r-h">
      <div className="pf-chart-head">
        <h3 className="label" id="pf-r-h">{logged ? "Sensors" : title} <span className="faint num">{readings.length}</span></h3>
        <span className="faint">{picked ? "Pick it again to chart them all." : readings.length > 1 ? "Pick one to chart it on its own." : "Lowest and highest since Rig started."}</span>
      </div>
      <SensorTable label={`${part.name}, ${title.toLowerCase()}`} groups={[{ key: "all", rows: readings }]} picked={picked}
        onPick={readings.length > 1 ? (r) => onPick(r.id === picked ? null : r.id) : undefined} />
    </section>
  );
}

/** Focuses the picked item of a menu as it opens, else the first. */
const focusCurrent = (el: HTMLElement | null) => {
  (el?.querySelector<HTMLElement>('[role="menuitem"][aria-current="true"]') ?? el?.querySelector<HTMLElement>('[role="menuitem"]'))?.focus();
};

/**
 * What to chart: one kind of sensor at a time (temperatures, usage, speeds…). A single sensor, like the hot spot or
 * core 3, is picked from its row in the table below, so this list stays short however many sensors the part reports.
 */
function Picker({ views, kind, sensor, onPick }: {
  views: View[]; kind: SensorType; sensor: Reading | null;
  onPick: (kind: SensorType) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => { setOpen(false); btn.current?.focus(); };
  const title = views.find((v) => v.type === kind)?.title ?? "";
  return (
    <div className="pf-pick" ref={box} onKeyDown={(e) => {
      if (e.key === "Escape" && open) { e.stopPropagation(); close(); }
      if (e.key === "Tab" && open) setOpen(false);
    }}>
      <button ref={btn} type="button" className="input pf-pick-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`What to chart: ${sensor ? `${title}, ${sensor.name}` : title}`}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>
        {sensor ? <><span className="pf-pick-kind">{title}</span><span className="pf-pick-one">{sensor.name}</span></> : title}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && (
        <div className="pf-pick-pop" role="menu" aria-label="What to chart" ref={focusCurrent} onKeyDown={arrowKeys("menuitem")}>
          {views.map((v) => (
            <button key={v.type} type="button" role="menuitem" aria-current={kind === v.type ? "true" : undefined} onClick={() => { onPick(v.type); close(); }}>
              {v.title}<span className="faint num">{v.count || ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One sensor, or every sensor of a kind, drawn from the readings that came in while the page was open. */
function SensorChart({ readings, recent, online, label }: { readings: Reading[]; recent: LivePoint[]; online: boolean; label: string }) {
  const temp = useTemp();
  const pts = recent.filter((p) => readings.some((r) => p.vals[r.id] != null));
  if (!readings.length || pts.length < 2) {
    return <ChartNote>{online ? "This draws as readings come in." : "This PC is offline, so there's nothing live to chart."}</ChartNote>;
  }
  const w = 860, h = 200, type = readings[0].type;
  const vs = pts.flatMap((p) => readings.map((r) => p.vals[r.id])).filter((v): v is number => v != null);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < Math.abs(hi) * 0.1 || hi === lo) { const pad = Math.max(Math.abs(hi) * 0.05, 1); lo -= pad; hi += pad; }
  if (type === "load" || type === "level" || type === "control") { lo = 0; hi = Math.max(100, hi); }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w, y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h;
  const path = (id: string) => pts.filter((p) => p.vals[id] != null).map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.vals[id]).toFixed(1)}`).join("");
  const one = readings.length === 1;
  return (
    <div className="pf-schart">
      <div className="pf-schart-axis faint num" aria-hidden="true"><span>{reading(temp, type, hi)}</span><span>{reading(temp, type, (hi + lo) / 2)}</span><span>{reading(temp, type, lo)}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {[0, h / 2, h].map((gy) => <line key={gy} x1={0} x2={w} y1={gy} y2={gy} className="pf-schart-grid" vectorEffect="non-scaling-stroke" />)}
        {readings.map((r) => <path key={r.id} d={path(r.id)} className={`chart-line ${one ? "gpu" : "cpu"}`} vectorEffect="non-scaling-stroke" />)}
      </svg>
    </div>
  );
}

/** Which sensor kind each chart belongs to, so picking a kind shows its chart. */
const metricKind: Record<ReadingUnit, SensorType> = { temp: "temperature", percent: "load", rpm: "fan" };

/** What the dropdown at the top of a part offers: every kind of sensor it reports, and any chart Rig logs for it even with no sensor of that kind. */
function viewsOf(part: PartLine, readings: Reading[]): View[] {
  const kinds: View[] = sensorKinds(readings);
  for (const m of part.metrics) if (!kinds.some((k) => k.type === metricKind[m.unit])) kinds.unshift({ type: metricKind[m.unit], title: m.title, count: 0 });
  return kinds;
}
type View = { type: SensorType; title: string; count: number };

/**
 * Sensors with now, lowest and highest, as HWMonitor lists them; a group can carry a heading row.
 * With onPick, each sensor's name charts it on its own, and the picked one again goes back to the whole kind.
 */
function SensorTable({ label, groups, picked = null, onPick }: {
  label: string; groups: { key: string; head?: ReactNode; rows: Reading[] }[]; picked?: string | null; onPick?: (r: Reading) => void;
}) {
  const temp = useTemp();
  return (
    <table className={`pf-table${onPick ? " pickable" : ""}`} aria-label={label}>
      <thead><tr><th scope="col">Sensor</th><th scope="col">Now</th><th scope="col">Lowest</th><th scope="col">Highest</th></tr></thead>
      {groups.map((g) => (
        <tbody key={g.key}>
          {g.head && <tr className="pf-group"><th scope="rowgroup" colSpan={4}>{g.head}</th></tr>}
          {g.rows.map((r) => (
            <tr key={r.id} className={r.id === picked ? "pf-picked" : undefined} onClick={onPick ? () => onPick(r) : undefined}>
              <th scope="row">{onPick
                ? <button type="button" className="pf-row-btn" aria-pressed={r.id === picked} onClick={(e) => { e.stopPropagation(); onPick(r); }}>{r.name}</button>
                : r.name}</th>
              <td className="num">{reading(temp, r.type, r.value)}</td>
              <td className="num faint">{reading(temp, r.type, r.min)}</td>
              <td className="num faint">{reading(temp, r.type, r.max)}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

/** What a search finds across every part, grouped by part, each part a click from its own page. */
function Found({ query, readings, lines, onOpen }: { query: string; readings: Reading[]; lines: PartLine[]; onOpen: (part: string, kind: SensorType, sensor: string | null) => void }) {
  const found = findReadings(readings, query);
  const order = (t: SensorType) => sensorGroups.findIndex(([g]) => g === t);
  const groups = lines.map((l) => ({ line: l, rows: found.filter((r) => r.part === l.id).sort((a, b) => order(a.type) - order(b.type)) })).filter((g) => g.rows.length);
  return (
    <section id="pf-pane" className="pf-pane" aria-labelledby="pf-h">
      <div className="pf-head">
        <h2 id="pf-h" className="pf-title">{found.length ? `${found.length} ${found.length === 1 ? "reading" : "readings"}` : "No readings"}</h2>
        <span className="muted">matching “{query.trim()}”</span>
      </div>
      {groups.length ? (
        <SensorTable label={`Readings matching ${query.trim()}`} onPick={(r) => onOpen(r.part, r.type, r.id)} groups={groups.map(({ line, rows }) => ({
          key: line.id, rows,
          head: <span className="pf-found-head">{line.name}<button type="button" className="btn ghost sm" onClick={() => onOpen(line.id, rows[0].type, null)}>Open {line.name.toLowerCase()}</button></span>,
        }))} />
      ) : <p className="muted pf-none">Try a part, like processor, a kind, like voltage, or a sensor, like core 3 or hot spot.</p>}
    </section>
  );
}

/** The few readings worth a glance on this part, now, with the highest since Rig started under each. */
function KeyReadings({ part, readings }: { part: string; readings: Reading[] }) {
  const temp = useTemp();
  const keys = keyReadings(part, readings);
  if (!keys.length) return null;
  return (
    <dl className="pf-keys" aria-label="Now">
      {keys.map((k) => (
        <div key={k.label}>
          <dt>{k.label}</dt>
          <dd className="num">{reading(temp, k.type, k.value)}</dd>
          <dd className="faint">{k.note ? `${k.note.replace(/#/g, "")}, ` : ""}{k.max != null ? `highest ${reading(temp, k.type, k.max)}` : ""}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Each core side by side, as Task Manager shows logical processors: how busy it is, a line of the last few minutes, and its clock and temperature. */
function Cores({ readings, recent }: { readings: Reading[]; recent: LivePoint[] }) {
  const temp = useTemp();
  const cores = coresOf(readings);
  if (cores.length < 2) return null;
  const perCoreTemp = cores.some((c) => c.temp);
  const anyTemp = readings.some((r) => r.part === "cpu" && r.type === "temperature");
  return (
    <section className="pf-cores-wrap" aria-labelledby="pf-cores-h">
      <div className="pf-chart-head">
        <h3 className="label" id="pf-cores-h">Cores <span className="faint num">{cores.length}</span></h3>
        <span className="faint">{anyTemp && !perCoreTemp ? "This processor reports one temperature for each group of cores, not for each core." : "Now, and the last few minutes."}</span>
      </div>
      <ul className="pf-cores">
        {cores.map((c) => {
          const load = coreLoad(c);
          return (
            <li key={c.label} className="pf-core">
              <div className="pf-core-head"><b>{c.label}</b><span className="num">{load == null ? "–" : `${Math.round(load)}%`}</span></div>
              <CoreLine core={c} recent={recent} />
              <div className="pf-core-threads" aria-hidden="true">
                {(c.threads.length ? c.threads : c.load ? [c.load] : []).map((t) => <i key={t.id}><b style={{ width: `${Math.max(0, Math.min(100, t.value ?? 0))}%` }} /></i>)}
              </div>
              <span className="faint num pf-core-facts">
                {[c.clock?.value != null ? reading(temp, "clock", c.clock.value) : null, c.temp?.value != null ? reading(temp, "temperature", c.temp.value) : null, c.power?.value != null ? reading(temp, "power", c.power.value) : null].filter(Boolean).join(" · ")}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One core's load over the live readings, on a fixed 0 to 100 scale so cores compare. */
function CoreLine({ core, recent }: { core: Core; recent: LivePoint[] }) {
  const ids = core.threads.length ? core.threads.map((t) => t.id) : core.load ? [core.load.id] : [];
  const vs = recent.map((p) => {
    const xs = ids.map((id) => p.vals[id]).filter((v): v is number => v != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });
  const w = 100, h = 32, n = vs.length;
  if (n < 2) return <span className="pf-core-line" aria-hidden="true" />;
  let d = "";
  vs.forEach((v, i) => { if (v != null) d += `${d ? "L" : "M"}${((i / (n - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`; });
  return <svg className="pf-core-line" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={`${d}L${w},${h}L0,${h}Z`} className="fill" /><path d={d} vectorEffect="non-scaling-stroke" /></svg>;
}
