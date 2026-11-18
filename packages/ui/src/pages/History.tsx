import { useRef, useState } from "react";
import { historySummary, HOT_MARGIN, STEADY_MARGIN, type BusySummary, type HistoryPoint, type HistorySummary, type Range, type TempFormat } from "@rig/core";
import { ChartNote, LineChart } from "../chart";
import { useApp, useHistory, useTemp } from "../state";
import { Events } from "./history/Events";
import { Ranges } from "./history/Ranges";
import { LogsHead } from "./logs/Head";

type Temp = (celsius: number | null | undefined, opts?: TempFormat) => string;
/** A difference between two temperatures, like "6° warmer": scaled to the unit, not offset. */
const diff = (temp: Temp, celsius: number) => temp(celsius, { delta: true, mark: "degree" });
const rangeIn: Record<Range, string> = { "24h": "in the last day", "7d": "this week", "30d": "this month" };

/** The answer in one line: are temperatures OK in this range. */
function answer(peak: NonNullable<HistorySummary["peak"]>, part: string, range: Range, temp: Temp) {
  return peak.headroom < 0 ? `Your ${part} went ${diff(temp, -peak.headroom)} over its safe limit ${rangeIn[range]}.`
    : peak.headroom === 0 ? `Your ${part} reached its safe limit ${rangeIn[range]}.`
    : peak.headroom < HOT_MARGIN ? `Temperatures are fine ${rangeIn[range]}, though your ${part} came within ${diff(temp, peak.headroom)} of its safe limit.`
    : `Temperatures look good ${rangeIn[range]}, well under the safe limit.`;
}

function busyNote(b: BusySummary | null, laptop: boolean, temp: Temp) {
  if (!b) return "Nothing heavy ran in this range.";
  if (b.change == null) return `Typical during ${laptop ? "busy periods" : "games and heavy work"}.`;
  if (b.change >= STEADY_MARGIN) return `${diff(temp, b.change)} warmer than earlier in this range. Dust is the usual cause.`;
  if (b.change <= -STEADY_MARGIN) return `${diff(temp, -b.change)} cooler than earlier in this range.`;
  return "About the same as earlier in this range.";
}

/** When the hottest moment was, what was running, and how close it came to the limit. */
function peakNote(peak: NonNullable<HistorySummary["peak"]>, points: readonly HistoryPoint[], range: Range, laptop: boolean, temp: Temp) {
  const when = new Date(peak.t).toLocaleString(undefined, range === "30d"
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : range === "24h" ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
  const at = points.find((p) => p.t === peak.t);
  const doing = at?.game ? `during ${at.game}` : at?.busy ? `during ${laptop ? "a busy period" : "heavy work"}` : "while nothing heavy was running";
  const margin = peak.headroom > 0 ? `${diff(temp, peak.headroom)} under the limit` : peak.headroom < 0 ? `${diff(temp, -peak.headroom)} over the limit` : "Right at the limit";
  return `${when}, ${doing}. ${margin[0].toUpperCase()}${margin.slice(1)}.`;
}

/** What the chart is showing besides the lines: a pinned moment, or the busy periods picked out. Keyed so a second click lets go. */
interface Focus { key: string; pin?: number }

const reduceMotion = () => document.documentElement.dataset.motion === "reduce" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function History() {
  const { ui, pc, set, ask } = useApp();
  const temp = useTemp();
  const pts = useHistory(ui.range);
  const laptop = pc.kind === "laptop";
  const main: "gpu" | "cpu" = pc.parts?.gpu ? "gpu" : "cpu";
  const limit = pc.parts?.[main]?.limit ?? 90;
  const { busy, idleCpu, peak } = historySummary(pts ?? [], main, limit);
  const warmer = busy?.change != null && busy.change >= STEADY_MARGIN;
  const partName = main === "gpu" ? "Graphics card" : "Processor";
  const [view, setView] = useState<"events" | "ranges">("events");
  const [focus, setFocus] = useState<Focus | null>(null);
  const chartRef = useRef<HTMLElement>(null);
  const has = !!pts && pts.length > 1;

  const said = peak && has ? answer(peak, partName.toLowerCase(), ui.range, temp) : null;
  /** Shows a moment, or the busy periods, on the chart; the same one again lets go. */
  const toggle = (key: string, pin?: number) => {
    if (focus?.key === key) return setFocus(null);
    setFocus({ key, pin });
    if (pin != null) chartRef.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  };
  const pick = (r: Range) => { set({ range: r }); setFocus(null); };
  const pinned = focus?.pin != null ? focus.key : null;

  return (
    <div className="page hi-page">
      <LogsHead sub={`${pc.name}'s temperatures, logged every minute while Rig runs.`} right={
        <div className="seg" role="group" aria-label="Range">
          {(["24h", "7d", "30d"] as const).map((r) => <button key={r} type="button" aria-pressed={ui.range === r} onClick={() => pick(r)}>{r === "24h" ? "Day" : r === "7d" ? "Week" : "Month"}</button>)}
        </div>
      } />
      {said && <section className="hi-lede" aria-label="Summary"><p className="hi-lede-text">{said}</p></section>}
      {(pts == null || has) && (
        <section ref={chartRef} className={`card hi-chart${focus?.key === "busy" ? " busy" : ""}`} aria-label="Temperatures">
          <div className="legend">
            <span><i className={pc.parts?.gpu ? "lg-cpu" : "lg-gpu"} />Processor</span>
            {pc.parts?.gpu && <span><i className="lg-gpu" />Graphics card</span>}
            <span><i className="lg-limit" />Safe limit</span>
            <span><i className="hi-lg-band" />{laptop ? "Busy periods" : "Games and heavy work"}</span>
          </div>
          {pts == null ? <ChartNote busy>Loading…</ChartNote> : (
            <LineChart points={pts} series={pc.parts?.gpu ? [{ key: "cpu", cls: "cpu" }, { key: "gpu", cls: "gpu" }] : [{ key: "cpu", cls: "gpu" }]}
              limit={{ v: limit, label: `${temp(limit)} limit` }} bands pin={focus?.pin ?? null} onUnpin={() => setFocus(null)} />
          )}
          {pts && has && (
            <div className="hi-stats">
              <Stat label={`${partName} when busy`} figure={temp(busy?.typical)} warn={warmer} note={busyNote(busy, laptop, temp)}
                pressed={busy ? focus?.key === "busy" : undefined} onClick={() => toggle("busy")} />
              <Stat label="Processor at rest" figure={temp(idleCpu)} note={idleCpu != null ? "Typical when nothing heavy is running." : "Nothing quiet was recorded in this range."} />
              <Stat label="Hottest moment" figure={temp(peak?.temp)} warn={!!peak && peak.headroom <= 0} note={peak ? peakNote(peak, pts, ui.range, laptop, temp) : "No readings in this range."}
                pressed={peak ? focus?.key === "peak" : undefined} onClick={() => peak && toggle("peak", peak.t)} />
            </div>
          )}
        </section>
      )}
      {pts && has && (
        <section className="hi-detail" aria-label="Details">
          <div className="seg hi-switch" role="group" aria-label="Details">
            <button type="button" aria-pressed={view === "events"} onClick={() => setView("events")}>What happened</button>
            <button type="button" aria-pressed={view === "ranges"} onClick={() => setView("ranges")}>Ranges</button>
          </div>
          {view === "events"
            ? <Events key={ui.range} points={pts} range={ui.range} pinned={pinned} onPin={toggle} />
            : <Ranges points={pts} pc={pc} pinned={pinned} onPin={toggle} />}
        </section>
      )}
      {pts && pts.length < 2 && (
        <section className="card hi-empty">
          <div className="hi-empty-text">
            <h2 className="plain-h">Your history fills in as Rig runs</h2>
            <p className="muted">Leave Rig open and {pc.name}'s temperatures land here every minute. After a day you can see the pattern; after a week, whether it's running warmer than it used to.</p>
            <div><button className="btn" type="button" onClick={() => ask(`What temperatures are normal for ${pc.name}?`)}>Ask what's normal</button></div>
          </div>
          <ul className="hi-empty-list" aria-label="What shows up here">
            <li><b>Every part, minute by minute</b><span className="muted">The processor{pc.parts?.gpu ? " and graphics card" : ""} on one chart, against the safe limit.</span></li>
            <li><b>{laptop ? "Busy periods" : "Games and heavy work"}, shaded</b><span className="muted">So you can see what made it warm.</span></li>
            <li><b>Lowest, typical and highest</b><span className="muted">With the hottest moment and how close it came to the limit.</span></li>
          </ul>
        </section>
      )}
    </div>
  );
}

/** One figure under the chart. With onClick it's a button that shows what it refers to on the chart. */
function Stat({ label, figure, note, warn, pressed, onClick }: { label: string; figure: string; note: string; warn?: boolean; pressed?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className="label">{label}</span>
      <span className={`num hi-figure${warn ? " warn" : ""}`}>{figure}</span>
      <span className="muted">{note}</span>
    </>
  );
  return pressed == null || !onClick ? <div className="hi-stat">{inner}</div>
    : <button type="button" className="hi-stat" aria-pressed={pressed} onClick={onClick}>{inner}</button>;
}
