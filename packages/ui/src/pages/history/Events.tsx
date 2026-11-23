import { useState } from "react";
import { HISTORY_WINDOW_MS, insightContext, mostCommon, ranHot, rangeMs, windowRuns, type Change, type HistoryPoint, type PC, type Range } from "@rig/core";
import { DayLabel, Row, RowFigure, Rows } from "../../components/Rows";
import { useApp, useTemp } from "../../state";
import { hours } from "../games/words";
import { clock, dayName } from "../logs/words";

type Event =
  | { kind: "busy"; t: number; to: number; name: string; peak: { part: "cpu" | "gpu"; temp: number; at: number } | null; hot: boolean }
  | { kind: "change"; t: number; change: Change };

const SHOWN = 6;

/** The part that came closest to its safe limit in the run, its highest reading, and when that was. */
function closest(run: HistoryPoint[], limits: Record<"cpu" | "gpu", number>) {
  let best: { part: "cpu" | "gpu"; temp: number; at: number } | null = null;
  for (const part of ["gpu", "cpu"] as const) {
    const top = run.reduce<HistoryPoint | null>((a, p) => (p[part] != null && (!a || p[part]! > a[part]!) ? p : a), null);
    if (!top) continue;
    const temp = Math.round(top[part]!);
    if (!best || limits[part] - temp < limits[best.part] - best.temp) best = { part, temp, at: top.t };
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

/** The list under the chart, a day at a time. A row with a moment shows it on the chart; picking it again lets go. */
export function Events({ points, range, pinned, onPin }: { points: HistoryPoint[]; range: Range; pinned: string | null; onPin: (key: string, t: number) => void }) {
  const { pc, data, go } = useApp();
  const temp = useTemp();
  const [all, setAll] = useState(false);
  const list = events(points, data.changes, pc, range);
  const shown = all ? list : list.slice(0, SHOWN);
  const days: { day: string; list: Event[] }[] = [];
  for (const e of shown) { const name = dayName(e.t); if (days[days.length - 1]?.day === name) days[days.length - 1].list.push(e); else days.push({ day: name, list: [e] }); }
  return (
    <section className="hi-panel" aria-label="Busy times">
      {list.length === 0 ? <p className="muted">Nothing heavy ran and nothing was changed in this range.</p> : days.map((d) => (
        <section key={d.day} aria-label={d.day}>
          <DayLabel day={d.day} count={d.list.length} one="entry" many="entries" />
          <Rows timeline>
            {d.list.map((e) => {
              const key = e.kind === "busy" ? `b${e.t}` : `c${e.change.id}`;
              return e.kind === "busy" ? (
                <Row key={key} name={e.name} title={e.name} time={clock(e.t)} at={new Date(e.t).toISOString()}
                  mark={e.hot ? "look" : "dot"}
                  meta={`${hours((e.to - e.t) / 36e5)}, until ${clock(e.to)}.`} tag={e.hot && <span className="chip warn">Ran hot</span>}
                  figure={e.peak && <RowFigure value={temp(e.peak.temp)} word={e.peak.part === "gpu" ? "graphics card" : "processor"} />}
                  pick={{ pressed: pinned === key, onPick: () => onPin(key, e.peak?.at ?? e.t) }} />
              ) : (
                <Row key={key} name={e.change.title} title={e.change.title} time={clock(e.t)} at={e.change.at}
                  mark={e.change.status === "applied" ? "dot" : "hollow"}
                  meta={e.change.status === "applied" ? "A change, still in place." : "A change, since undone."}
                  pick={{ pressed: pinned === key, onPick: () => onPin(key, e.t) }}
                  action={<button type="button" className="btn sm" onClick={() => go("changes")}>See change</button>} />
              );
            })}
          </Rows>
        </section>
      ))}
      {list.length > SHOWN && (
        <button type="button" className="btn ghost sm hi-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${list.length}`}</button>
      )}
    </section>
  );
}
