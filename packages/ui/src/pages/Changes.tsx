import { useEffect, useState } from "react";
import { fixSteps, type AppliedStep, type Change, type CommandStep, type DiffRow, type Issue } from "@rig/core";
import { DiffTable, StatusChip } from "../components/common";
import { StepRecord } from "../components/change";
import { DayLabel, Row, Rows } from "../components/Rows";
import { useActions, useAppSelector, useLatest } from "../state";
import { Counts, HowChangesWork, type Filter } from "./changes/Counts";
import { NoChanges } from "./changes/Empty";
import { bySeverity, issueGo } from "./shared";

type CommandApplied = Extract<AppliedStep, { step: CommandStep }>;

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
  // What this page shows changes only when a change is made or a finding comes or goes, not with every reading.
  const { changes, issues, name } = useAppSelector((c) => ({ changes: c.data.changes, issues: c.pc.issues, name: c.pc.name }));
  const data = { changes }, pc = { issues, name };
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
  const { client } = useActions();
  const pc = { id: useAppSelector((c) => c.pc.id) };
  const [rows, setRows] = useState<Record<string, DiffRow[]>>({});
  // The PC object is replaced on every live reading, so the preview keys on the fixes themselves.
  const ids = fixes.map((i) => i.id).join(" ");
  useEffect(() => {
    let live = true;
    for (const i of fixes) client.preview(pc.id, fixSteps(i.fix!)).then((r) => live && setRows((m) => ({ ...m, [i.id]: r }))).catch(() => {});
    return () => { live = false; };
  }, [client, pc.id, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

function Day({ changes }: { changes: Change[] }) {
  const label = dayLabel(changes[0].at);
  return (
    <section className="ch-day" aria-label={label}>
      <DayLabel day={label} count={changes.length} one="change" many="changes" />
      <Rows timeline>{changes.map((c) => <Entry key={c.id} c={c} />)}</Rows>
    </section>
  );
}

/** Fixes Rig found but hasn't made. Each opens the review sheet; the before and after wait behind Details. */
function Waiting({ fixes, rows }: { fixes: Issue[]; rows: Record<string, DiffRow[]> }) {
  const { set, go, ask, review } = useActions();
  const latest = useLatest();
  const [reading, setReading] = useState<string | null>(null);
  const open = (i: Issue) => {
    if (!i.fix) { issueGo(i, latest().pc, { set, go, ask, review }); return; }
    setReading(i.id);
    void review(fixSteps(i.fix), { by: "you", why: i.title }).finally(() => setReading(null));
  };
  return (
    <section className="card ch-next" aria-labelledby="ch-next-h">
      <div className="card-head"><h2 id="ch-next-h">Waiting for review <span className="faint num">{fixes.length}</span></h2></div>
      <Rows>
        {fixes.map((i) => (
          <Row key={i.id} name={i.title} title={i.title} meta="Nothing changes until you say yes."
            action={<button className="btn sm" type="button" aria-label={`Review: ${i.title}`} disabled={reading === i.id} onClick={() => open(i)}>{reading === i.id ? "Reading settings…" : "Review"}</button>}
            details={<>
              <p className="muted">{i.body}</p>
              {rows[i.id]?.length ? <div className="diff-wrap"><DiffTable rows={rows[i.id]} /></div> : null}
            </>} />
        ))}
      </Rows>
    </section>
  );
}

function Entry({ c }: { c: Change }) {
  const { toggleChange, client } = useActions();
  const [busy, setBusy] = useState(false);
  const toggle = () => { setBusy(true); void toggleChange(c.id).finally(() => setBusy(false)); };
  const word = c.status === "applied" ? (busy ? "Undoing…" : "Undo") : busy ? "Redoing…" : "Redo";
  const meta = `By ${c.by === "you" ? "you" : "Rig, after you said yes"}. ${c.status === "applied" ? "Old values saved." : "Old values put back."}`;
  return (
    <Row name={c.title} title={c.title} meta={meta} time={clock(c.at)} at={c.at}
      mark={c.status === "undone" ? "hollow" : "dot"} tag={c.status === "undone" && <StatusChip status="undone" />}
      action={client.caps.applyChanges && <button className="btn sm" type="button" disabled={busy} onClick={toggle}>{word}</button>}
      details={<>
        {(c.why || c.result) && <p className="muted">{[c.why, c.result].filter(Boolean).join(" ")}</p>}
        {c.diff.length > 0 && <div className="diff-wrap"><DiffTable rows={c.diff} /></div>}
        {c.applied.map((a, i) => a.step.kind === "command" && <StepRecord key={i} applied={a as CommandApplied} />)}
      </>} />
  );
}
