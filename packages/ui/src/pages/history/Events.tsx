import { useState } from "react";
import { HISTORY_WINDOW_MS, insightContext, mostCommon, ranHot, rangeMs, windowRuns, type Change, type HistoryPoint, type PC, type Range } from "@rig/core";
import { Icon } from "../../components/common";
import { useApp, useTemp } from "../../state";
import { day, hours, timeRange } from "../games/words";

type Event =
  | { kind: "busy"; t: number; to: number; name: string; peak: { part: "cpu" | "gpu"; temp: number } | null; hot: boolean }
  | { kind: "change"; t: number; change: Change };

const SHOWN = 6;

/** The part that came closest to its safe limit in the run, and its highest reading. */
function closest(run: HistoryPoint[], limits: Record<"cpu" | "gpu", number>) {
  let best: { part: "cpu" | "gpu"; temp: number } | null = null;
  for (const part of ["gpu", "cpu"] as const) {
    const xs = run.map((p) => p[part]).filter((v): v is number => v != null);
    if (!xs.length) continue;
    const temp = Math.round(Math.max(...xs));
    if (!best || limits[part] - temp < limits[best.part] - best.temp) best = { part, temp };
  }
  return best;
}

/** Games, heavy work and changes in the range, newest first. */
export function events(points: readonly HistoryPoint[], changes: Change[], pc: PC, range: Range, now = Date.now()): Event[] {
  const ctx = insightContext(pc, now);
  const busy = windowRuns(points, (p) => p.busy).map((run): Event => ({
    kind: "busy", t: run[0].t, to: Math.min(run[run.length - 1].t + HISTORY_WINDOW_MS, now),
    name: mostCommon(run.map((p) => p.game)) ?? (pc.kind === "laptop" ? "Busy period" : "Heavy work"),
    peak: closest(run, ctx.limits), hot: ranHot(run, ctx.limits),
  }));
  const made = changes.filter((c) => new Date(c.at).getTime() >= now - rangeMs[range]).map((c): Event => ({ kind: "change", t: new Date(c.at).getTime(), change: c }));
  return [...busy, ...made].sort((a, b) => b.t - a.t);
}

export function Events({ points, range, when }: { points: HistoryPoint[]; range: Range; when: string }) {
  const { pc, data, go } = useApp();
  const temp = useTemp();
  const [all, setAll] = useState(false);
  const list = events(points, data.changes, pc, range);
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <section className="card card-pad hi-card">
      <div className="hi-card-head"><h2>What happened</h2><span className="faint">{when}</span></div>
      {list.length === 0 ? <p className="muted">Nothing heavy ran and nothing was changed in this range. Games, heavy work and changes show up here as they happen.</p> : (
        <ul className="hi-events" aria-label="What happened">
          {shown.map((e) => e.kind === "busy" ? (
            <li key={`b${e.t}`}>
              <span className={`hi-ev-ico${e.hot ? " look" : ""}`} aria-hidden="true"><Icon d="M4 8h12v6H4zM7 10v2M6 11h2M13 11h.01M15 11h.01" /></span>
              <span className="hi-ev-main"><b>{e.name}</b><span className="faint">{day(e.t)}, {timeRange(e.t, e.to)}, {hours((e.to - e.t) / 36e5)}</span></span>
              {e.peak && <span className={`hi-ev-fig${e.hot ? " look" : ""}`}><b className="num">{temp(e.peak.temp)}</b><span>{e.hot ? "Ran hot, " : ""}{e.peak.part === "gpu" ? "graphics card" : "processor"}</span></span>}
            </li>
          ) : (
            <li key={`c${e.change.id}`}>
              <span className="hi-ev-ico" aria-hidden="true"><Icon d="M4 10a6 6 0 1 0 2-4.5M4 4v3h3M10 7v3l2 2" /></span>
              <span className="hi-ev-main"><b>{e.change.title}</b><span className="faint">{day(e.t)}, {new Date(e.t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}, {e.change.status === "applied" ? "in place" : "undone"}</span></span>
              <button type="button" className="btn ghost sm" onClick={() => go("changes")}>See change</button>
            </li>
          ))}
        </ul>
      )}
      {list.length > SHOWN && (
        <button type="button" className="btn sm hi-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${list.length}`}</button>
      )}
    </section>
  );
}
