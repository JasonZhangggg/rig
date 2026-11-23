import { useEffect, useState, type ReactNode } from "react";
import type { Change, DiffRow, Issue } from "@rig/core";
import { DiffTable, StatusChip } from "../components/common";
import { useApp } from "../state";
import { Counts, HowChangesWork, type Filter } from "./changes/Counts";
import { NoChanges } from "./changes/Empty";
import { bySeverity, issueGo } from "./shared";

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
  return [...days.entries()];
}

export function Changes() {
  const { data, pc } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const any = data.changes.length > 0;
  const list = data.changes.filter((c) => filter === "all" || c.status === filter);
  const fixes = bySeverity((pc.issues ?? []).filter((i) => i.fix?.length));
  const rows = usePreviews(fixes);
  // A filter that would leave the list empty, like Undone after the last undo is redone, falls back to everything.
  useEffect(() => { if (filter !== "all" && !list.length) setFilter("all"); }, [filter, list.length]);
  return (
    <div className={`page pg-focus${!any && !fixes.length ? " ch-is-empty" : ""}`}>
      <div className="page-head">
        <div><h1>Changes</h1><p className="sub">Everything changed on {pc.name}, with the old values saved.</p></div>
      </div>
      {fixes.length > 0 && <Waiting fixes={fixes} rows={rows} />}
      {!any && <NoChanges quiet={fixes.length > 0} />}
      {any && (
        <section className="card ch-log" aria-labelledby="ch-log-h">
          <div className="card-head">
            <h2 id="ch-log-h">{filter === "applied" ? "Applied" : filter === "undone" ? "Undone" : "Recent changes"}</h2>
            <Counts changes={data.changes} filter={filter} onFilter={setFilter} />
          </div>
          {/* Keyed by the date, so an entry moving in or out of a day doesn't close what's open in it. */}
          {byDay(list).map(([date, day]) => <Day key={date} changes={day} />)}
        </section>
      )}
      {any && <HowChangesWork />}
    </div>
  );
}

/** What each waiting fix would change, fetched once per set of fixes. */
function usePreviews(fixes: Issue[]) {
  const { pc, client } = useApp();
  const [rows, setRows] = useState<Record<string, DiffRow[]>>({});
  // The PC object is replaced on every live reading, so the preview keys on the fixes themselves.
  const ids = fixes.map((i) => i.id).join(" ");
  useEffect(() => {
    let live = true;
    for (const i of fixes) client.preview(pc.id, i.fix!).then((r) => live && setRows((m) => ({ ...m, [i.id]: r }))).catch(() => {});
    return () => { live = false; };
  }, [client, pc.id, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
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
function Waiting({ fixes, rows }: { fixes: Issue[]; rows: Record<string, DiffRow[]> }) {
  const { pc, set, go, ask, review } = useApp();
  const [reading, setReading] = useState<string | null>(null);
  const open = (i: Issue) => {
    if (!i.fix) { issueGo(i, pc, { set, go, ask, review }); return; }
    setReading(i.id);
    void review(i.fix, { by: "you", why: i.title }).finally(() => setReading(null));
  };
  return (
    <section className="card ch-next" aria-labelledby="ch-next-h">
      <div className="card-head"><h2 id="ch-next-h">Waiting for review <span className="faint num">{fixes.length}</span></h2></div>
      <ul className="ch-next-list">
        {fixes.map((i) => (
          <Row key={i.id} title={i.title} meta="Nothing changes until you say yes."
            action={<button className="btn sm" type="button" aria-label={`Review: ${i.title}`} disabled={reading === i.id} onClick={() => open(i)}>{reading === i.id ? "Reading settings…" : "Review"}</button>}>
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
  const [busy, setBusy] = useState(false);
  const toggle = () => { setBusy(true); void toggleChange(c.id).finally(() => setBusy(false)); };
  const word = c.status === "applied" ? (busy ? "Undoing…" : "Undo") : busy ? "Redoing…" : "Redo";
  const meta = `By ${c.by === "you" ? "you" : "Rig, after you said yes"}. ${c.status === "applied" ? "Old values saved." : "Old values put back."}`;
  return (
    <Row title={c.title} meta={meta} time={c.at} status={c.status}
      action={client.caps.applyChanges && <button className="btn sm" type="button" disabled={busy} onClick={toggle}>{word}</button>}>
      {(c.why || c.result) && <p className="muted">{[c.why, c.result].filter(Boolean).join(" ")}</p>}
      {c.diff.length > 0 && <div className="diff-wrap"><DiffTable rows={c.diff} /></div>}
    </Row>
  );
}
