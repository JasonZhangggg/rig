import { useMemo, useState } from "react";
import { probeWhen, type CustomInfo, type RecordedPoint, type RecordingInfo } from "@rig/core";
import { Icon } from "../../components/common";
import { useTemp } from "../../state";
import { Lanes, value, type Lane, type LaneType } from "./Lanes";
import { clockSec, isPhone, shortDay } from "./words";

/** How a column a custom log wrote is charted: memory in MB, a share, or a plain number. */
function columnLane(name: string, i: number, who?: string): Lane {
  const line = who ?? name;
  if (/mem|mb$/i.test(name)) return { title: "Memory", type: "mb", series: [{ i, cls: "c-look", name: line }] };
  if (/^cpu|load|percent|pct/i.test(name)) return { title: name === "cpu" ? "Processor" : name, type: "load", series: [{ i, cls: "c-ink", name: line }] };
  if (/temp/i.test(name)) return { title: "Temperature", type: "temperature", series: [{ i, cls: "c-ink", name: line }] };
  return { title: name === "count" ? "Processes" : name, type: "plain" as LaneType, series: [{ i, cls: "c-ink", name: line }] };
}

/** The numbers a custom log wrote, as lines: one per column that holds numbers. */
function useChart(c: CustomInfo, who?: string) {
  return useMemo(() => {
    const cols = c.columns.map((name, i) => ({ name, i })).filter(({ i }) => c.rows.some((r) => typeof r.cells[i] === "number"));
    const points: RecordedPoint[] = c.rows.map((r) => ({ t: r.t, v: cols.map(({ i }) => (typeof r.cells[i] === "number" ? r.cells[i] as number : null)) }));
    const lanes = cols.map((col, k) => columnLane(col.name, k, who)).sort((a, b) => (a.type === "mb" ? -1 : b.type === "mb" ? 1 : 0));
    return { points, lanes };
  }, [c.columns, c.rows, who]);
}

const at = (t: number) => `${shortDay(t)}, ${clockSec(t)}`;
const stateText: Record<CustomInfo["state"], [string, string]> = {
  on: ["Logging", "info"], waiting: ["Waiting for its condition", "info"], paused: ["Paused", ""], error: ["Not working", "warn"], ended: ["Ended", "ok"],
};

/** A custom log: what it reads and why, who asked for it and when, and what it wrote, newest last. */
export function CustomLogDetail({ info, onBack }: { info: RecordingInfo; onBack: () => void }) {
  const c = info.custom!;
  const p = c.spec;
  const [word, tone] = stateText[c.state];
  const s = p.source;
  const temp = useTemp();
  const { points, lanes } = useChart(c, s.kind === "process" ? s.name : undefined);
  const [cursor, setCursor] = useState<number | null>(null);
  const t0 = points[0]?.t ?? p.createdAt, t1 = points.at(-1)?.t ?? t0;
  const figs = lanes.map((l) => {
    const i = l.series[0].i;
    const vals = points.map((x) => x.v[i]).filter((v): v is number => v != null);
    return { label: l.title, max: vals.length ? Math.max(...vals) : null, last: vals.length ? vals[vals.length - 1] : null, type: l.type };
  });
  return (
    <div className="page rc-log">
      <div className="page-head">
        <div>
          <button type="button" className="btn ghost sm gm-back" onClick={onBack}><Icon d="M12 4 6 10l6 6" />Logs</button>
          <h1>{p.label}</h1>
          <p className="rc-when">Custom log · {p.by === "chat" ? "set up in chat" : "set up by you"} {at(p.createdAt)} · {s.kind === "process" ? `${s.name} ` : ""}{probeWhen(p)} · {c.active ? "until" : "ran until"} {shortDay(info.finishedAt ?? p.expiresAt)}</p>
        </div>
        <div className="gm-actions">
          <span className={`chip ${tone}`}>{word}</span>
          <a className="btn ghost" href="#settings">{c.active ? "Pause or turn off" : "Settings"}</a>
        </div>
      </div>

      {figs.length > 0 && (
        <dl className="rc-figs" aria-label="Key readings">
          {figs.map((f, k) => (
            <div key={f.label}><dt>{f.label}, highest</dt><dd className={`num rc-fig${k === 0 ? " look" : ""}`}>{value(temp, f.type, f.max)}</dd><dd className="faint">now {value(temp, f.type, f.last)}</dd></div>
          ))}
          <div><dt>Entries</dt><dd className="num rc-fig">{c.total.toLocaleString("en-US")}</dd></div>
        </dl>
      )}
      {points.length > 1 && (
        <section className="rc-lead" aria-label="What it logged, charted">
          <Lanes points={points} lanes={lanes.map((l, k) => (k === 0 ? { ...l, h: isPhone() ? 130 : 170 } : l))} t0={t0} t1={t1} cursor={cursor} onCursor={setCursor} gapMs={Math.max(90_000, p.every * 3000)} compact={isPhone()} />
        </section>
      )}

      {info.error && <div className="callout warn">{info.error}</div>}
      {s.kind === "script" && (
        <section className="card card-pad">
          <h3>The script</h3>
          <p className="faint">Runs {s.admin ? "as admin" : "as you"}, approved {p.approvedAt ? at(p.approvedAt) : ""}. If its text changed, it would need approving again.</p>
          <pre className="script-text">{s.text}</pre>
        </section>
      )}
      {c.notes.length > 0 && (
        <section className="card card-pad">
          <h3>Notes</h3>
          <table className="kv rec-table"><tbody>{c.notes.slice(-20).map((n, i) => <tr key={i}><td>{at(n.t)}</td><td>{n.text}</td></tr>)}</tbody></table>
        </section>
      )}
      <section className="card card-pad custom-rows">
        <h3>Every entry</h3>
        {!c.rows.length ? <p className="muted">Nothing yet.</p> : (
          <>
            {c.total > c.rows.length && <p className="faint">The last {c.rows.length} of {c.total} entries.</p>}
            <div className="custom-scroll">
              <table className="kv rec-table">
                <thead><tr><th>Time</th>{c.columns.map((x) => <th key={x}>{x}</th>)}</tr></thead>
                <tbody>{[...c.rows].reverse().map((r, i) => (
                  <tr key={i}><td>{at(r.t)}</td>{r.cells.map((x, j) => <td key={j} className={typeof x === "string" && x.includes("\n") ? "pre" : undefined}>{x == null ? "–" : String(x)}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
