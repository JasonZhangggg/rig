import { useEffect, useState, type ReactNode } from "react";
import type { Change, DiffRow, Issue } from "@rig/core";
import { DiffTable, Icon, StatusChip } from "../components/common";
import { useApp } from "../state";
import { HowChangesWork, Lead } from "./changes/Lead";
import { bySeverity, issueGo } from "./shared";

type Filter = "all" | "applied" | "undone";

const midnight = (t: number | Date) => new Date(t).setHours(0, 0, 0, 0);
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today", "Yesterday", or the date in full. */
export function dayLabel(iso: string, now = new Date()) {
  const days = Math.round((midnight(now) - midnight(new Date(iso))) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Newest day first, each day's changes newest first. */
function byDay(list: Change[]) {
  const days = new Map<number, Change[]>();
  for (const c of [...list].sort((a, b) => b.at.localeCompare(a.at))) {
    const k = midnight(new Date(c.at));
    days.set(k, [...(days.get(k) ?? []), c]);
  }
  return [...days.values()];
}

export function Changes() {
  const { data, pc } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const any = data.changes.length > 0;
  const mixed = new Set(data.changes.map((c) => c.status)).size > 1;
  const list = data.changes.filter((c) => filter === "all" || c.status === filter);
  const fixes = bySeverity((pc.issues ?? []).filter((i) => i.fix?.length));
  useEffect(() => { if (!mixed) setFilter("all"); }, [mixed]);
  return (
    <div className="page pg-focus">
      <div className="page-head">
        <div><h1>Changes</h1><p className="sub">Everything Rig or you changed on {pc.name}, with what it was before.</p></div>
      </div>
      {any ? <Lead changes={data.changes} pc={pc.name} /> : <NoChanges quiet={fixes.length > 0} />}
      {fixes.length > 0 && <UpNext fixes={fixes} />}
      {any && (
        <section className="card ch-log" aria-labelledby="ch-log-h">
          <div className="card-head">
            <h2 id="ch-log-h">Recent changes</h2>
            {mixed && (
              <div className="seg" role="group" aria-label="Filter">
                {(["all", "applied", "undone"] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
              </div>
            )}
          </div>
          {byDay(list).map((day) => <Day key={day[0].at} changes={day} />)}
        </section>
      )}
      <HowChangesWork />
    </div>
  );
}

function Day({ changes }: { changes: Change[] }) {
  const label = dayLabel(changes[0].at);
  return (
    <section className="ch-day" aria-label={label}>
      <p className="ch-day-label">{label}<span>{changes.length === 1 ? "1 change" : `${changes.length} changes`}</span></p>
      <ol className={`ch-timeline${changes.length > 1 ? " ch-line" : ""}`}>{changes.map((c) => <Entry key={c.id} c={c} />)}</ol>
    </section>
  );
}

/** Fixes Rig found but hasn't made. Each opens the review sheet; the before and after wait behind Details. */
function UpNext({ fixes }: { fixes: Issue[] }) {
  const { pc, set, go, ask, review, client } = useApp();
  const [rows, setRows] = useState<Record<string, DiffRow[]>>({});
  // The PC object is replaced on every live reading, so the preview keys on the fixes themselves.
  const ids = fixes.map((i) => i.id).join(" ");
  useEffect(() => {
    let live = true;
    for (const i of fixes) client.preview(pc.id, i.fix!).then((r) => live && setRows((m) => ({ ...m, [i.id]: r }))).catch(() => {});
    return () => { live = false; };
  }, [client, pc.id, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card ch-next" aria-labelledby="ch-next-h">
      <div className="card-head"><h2 id="ch-next-h">Waiting for you</h2><span className="faint">{fixes.length === 1 ? "1 change to review" : `${fixes.length} changes to review`}</span></div>
      <ul className="ch-next-list">
        {fixes.map((i) => (
          <Row key={i.id} title={i.title} meta="Found by Rig. Nothing changes until you review it."
            action={<button className="btn sm primary" type="button" aria-label={`Review: ${i.title}`} onClick={() => issueGo(i, pc, { set, go, ask, review })}>Review</button>}>
            <p className="muted">{i.body}</p>
            {rows[i.id]?.length ? <div className="diff-wrap"><DiffTable rows={rows[i.id]} /></div> : null}
          </Row>
        ))}
      </ul>
    </section>
  );
}

/** One line with its button, and the rest behind Details. */
function Row({ title, meta, time, status, action, children }: { title: string; meta: string; time?: string; status?: Change["status"]; action?: JSX.Element | false; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`ch-entry${status ? ` ${status}` : ""}`}>
      {time && <time className="ch-time num" dateTime={time}>{clock(time)}</time>}
      <div className="ch-body">
        <div className="change-name"><h3>{title}</h3>{status === "undone" && <StatusChip status="undone" />}</div>
        <p className="faint ch-meta">{meta}</p>
        {open && <div className="change">{children}</div>}
      </div>
      <div className="ch-acts">
        <button type="button" className="btn ghost sm" aria-expanded={open} aria-label={`Details: ${title}`} onClick={() => setOpen(!open)}>{open ? "Hide" : "Details"}</button>
        {action}
      </div>
    </li>
  );
}

function Entry({ c }: { c: Change }) {
  const { toggleChange, client } = useApp();
  const meta = `By ${c.by === "you" ? "you" : "Rig, after you said yes"}. ${c.status === "applied" ? "Old values saved." : "Old values put back."}`;
  return (
    <Row title={c.title} meta={meta} time={c.at} status={c.status}
      action={client.caps.applyChanges && <button className="btn sm" type="button" onClick={() => toggleChange(c.id)}>{c.status === "applied" ? "Undo" : "Redo"}</button>}>
      {(c.why || c.result) && <p className="muted">{[c.why, c.result].filter(Boolean).join(" ")}</p>}
      {c.diff.length > 0 && <div className="diff-wrap"><DiffTable rows={c.diff} /></div>}
    </Row>
  );
}

function NoChanges({ quiet }: { quiet: boolean }) {
  const { go, pc } = useApp();
  return (
    <section className="card ch-empty">
      <span className="ch-empty-icon" aria-hidden="true"><Icon d="M4 10a6 6 0 1 0 2-4.5M4 4v3h3M10 7v3l2 2" /></span>
      <div className="ch-empty-text">
        <h2 className="plain-h">No changes yet</h2>
        <p className="muted">Every change Rig makes on {pc.name} shows up here with the before and after, and an Undo button that puts the old values back.</p>
      </div>
      <div><button className={`btn${quiet ? "" : " primary"}`} type="button" onClick={() => go("chat")}>Ask Rig what to fix</button></div>
    </section>
  );
}
