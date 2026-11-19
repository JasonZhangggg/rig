import { useEffect, useRef, useState } from "react";
import {
  HOT_MARGIN, historySummary, livePoint, STEADY_MARGIN,
  type BusySummary, type HistoryKey, type HistoryPoint, type HistorySummary, type PC, type Range, type Reading, type ReadingUnit, type TempFormat,
} from "@rig/core";
import { calm, ChartNote, LineChart } from "../chart";
import { Figure } from "../components/Figure";
import { useApp, useHistory, useTemp } from "../state";
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

/** The PC's readings as they arrive while this page is open, the last few minutes of them, for the live charts. */
function useLive(pc: PC): HistoryPoint[] {
  const [pts, setPts] = useState<HistoryPoint[]>([]);
  const id = useRef(pc.id);
  useEffect(() => {
    if (id.current !== pc.id) { id.current = pc.id; setPts([]); }
    if (!pc.online || !pc.parts) return;
    const t = pc.seenAt ? Date.parse(pc.seenAt) : Date.now();
    setPts((prev) => (prev.length && prev[prev.length - 1].t >= t ? prev : [...prev.filter((p) => p.t > t - LIVE_MS), livePoint(pc, t)]));
  }, [pc]);
  return pts;
}

/** Each part's own charts and readings, the way Task Manager's Performance tab and HWMonitor lay them out. */
export function History() {
  const { ui, pc, set, ask } = useApp();
  const temp = useTemp();
  const pts = useHistory(ui.range);
  const recent = useLive(pc);
  const [live, setLive] = useState(false);
  const lines = partLines(pc);
  // The graphics card leads where there is one, as it's what heats up in games.
  const [sel, setSel] = useState(pc.parts?.gpu ? "gpu" : lines[0]?.id);
  const part = lines.find((l) => l.id === sel) ?? lines[0];
  const [focus, setFocus] = useState<Focus | null>(null);
  const paneRef = useRef<HTMLElement>(null);
  const has = !!pts && pts.length > 1;
  const now = livePoint(pc, Date.now());

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
  const choose = (id: string) => { setSel(id); setFocus(null); };
  const shown = live ? recent : pts ?? [];

  return (
    <div className="page hi-page">
      <LogsHead sub={`Each part's temperature and use on ${pc.name}, logged while Rig runs.`} right={
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
          <div className="pf-rail" role="group" aria-label="Parts">
            {lines.map((l) => {
              const lead = l.metrics[0];
              const second = l.metrics[1];
              const v = lead ? now[lead.key] : null;
              const hot = lead?.unit === "temp" && l.limit != null && v != null && v >= l.limit - HOT_MARGIN;
              return (
                <button key={l.id} type="button" className="pf-part" aria-pressed={l.id === part.id} onClick={() => choose(l.id)}>
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

          <section ref={paneRef} className={`pf-pane${focus?.key === "busy" ? " busy" : ""}`} aria-labelledby="pf-h">
            <div className="pf-head">
              <h2 id="pf-h" className="pf-title">{part.name}</h2>
              <span className="muted">{part.model}</span>
            </div>
            {!live && has && part.metrics[0] && <Figures part={part} points={pts!} focus={focus} onToggle={toggle} />}
            {(live || has) && part.metrics.map((m) => (
              <div key={m.key} className="pf-chart">
                <div className="pf-chart-head">
                  <h3 className="label">{m.title}</h3>
                  <div className="legend">
                    {m.unit === "temp" && part.limit != null && <span><i className="lg-limit" />Safe limit</span>}
                    {!live && <span><i className="hi-lg-band" />Busy</span>}
                  </div>
                </div>
                {live && recent.length < 2
                  ? <ChartNote>{pc.online ? "Live readings draw here as they come in." : `${pc.name} is offline, so there's nothing live to show.`}</ChartNote>
                  : <LineChart points={shown} series={[{ key: m.key, cls: "gpu", name: m.unit === "rpm" ? m.title : part.name }]} unit={m.unit}
                      h={m === part.metrics[0] ? 220 : 150} label={`${part.name}, ${m.title.toLowerCase()}`}
                      limit={m.unit === "temp" && part.limit != null ? { v: part.limit, label: `${temp(part.limit)} limit` } : undefined}
                      bands={!live} pin={live ? null : focus?.pin ?? null} onUnpin={() => setFocus(null)} />}
              </div>
            ))}
            {!live && pts == null && <ChartNote busy>Loading…</ChartNote>}
            {live && <p className="faint pf-live-note">The last few minutes, since you opened this page. Day, Week and Month show what Rig logged.</p>}
            <Readings part={part} readings={(pc.readings ?? []).filter((r) => r.part === part.id)} />
          </section>
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
function Figures({ part, points, focus, onToggle }: { part: PartLine; points: HistoryPoint[]; focus: Focus | null; onToggle: (key: string, pin?: number) => void }) {
  const { ui, pc } = useApp();
  const temp = useTemp();
  const m = part.metrics[0];
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

const groups: [Reading["type"], string][] = [
  ["temperature", "Temperatures"], ["load", "Usage"], ["clock", "Speeds"], ["fan", "Fans"], ["power", "Power"],
  ["voltage", "Voltages"], ["data", "Data"], ["level", "Levels"], ["control", "Fan control"],
];

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
    case "data": return `${v.toFixed(1)} GB`;
  }
}

/** Every sensor on the part: now, lowest and highest, grouped by what it measures. */
function Readings({ part, readings }: { part: PartLine; readings: Reading[] }) {
  const temp = useTemp();
  if (!readings.length) return <p className="muted pf-none">{part.name} reports no sensors.</p>;
  return (
    <div className="pf-readings">
      <div className="pf-chart-head">
        <h3 className="label" id="pf-r-h">Sensors</h3>
        <span className="faint">Lowest and highest since Rig started.</span>
      </div>
      <table className="pf-table" aria-labelledby="pf-r-h">
        <thead><tr><th scope="col">Sensor</th><th scope="col">Now</th><th scope="col">Lowest</th><th scope="col">Highest</th></tr></thead>
        {groups.map(([type, title]) => {
          const rows = readings.filter((r) => r.type === type);
          return rows.length > 0 && (
            <tbody key={type}>
              <tr className="pf-group"><th scope="rowgroup" colSpan={4}>{title}</th></tr>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.name}</th>
                  <td className="num">{reading(temp, r.type, r.value)}</td>
                  <td className="num faint">{reading(temp, r.type, r.min)}</td>
                  <td className="num faint">{reading(temp, r.type, r.max)}</td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
