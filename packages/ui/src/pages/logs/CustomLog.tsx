import { probeWhat, probeWhen, type CustomInfo, type RecordingInfo } from "@rig/core";
import { Icon } from "../../components/common";
import { clockSec, shortDay } from "./words";

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
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button type="button" className="btn ghost sm gm-back" onClick={onBack}><Icon d="M12 4 6 10l6 6" />All logs</button>
          <h1>Custom log</h1>
          <p className="rec-reason">{p.label}</p>
          <p className="sub">
            {p.by === "chat" ? "Asked for by Rig's chat" : "Set up by you"} on {at(p.createdAt)}. Reads {probeWhat(s)} {probeWhen(p)}, {c.active ? "until" : "ran until"} {at(info.finishedAt ?? p.expiresAt)}. Kept only on this PC.
          </p>
        </div>
        <div className="gm-actions">
          <span className={`chip ${tone}`}>{word}</span>
          <a className="btn ghost" href="#settings">{c.active ? "Pause or turn off" : "Settings"}</a>
        </div>
      </div>

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
        <h3>What it logged</h3>
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
