import { useEffect, useState } from "react";
import { fixSteps, type AppliedStep, type Change, type CommandStep, type DiffRow, type Issue, type NativeStep, type PreviewReply, type StepOutcome } from "@rig/core";
import { DiffTable, StatusChip } from "../components/common";
import { BACK_ON, recordRuns, StepCard, stepHeadline, StepRecord, undoReach } from "../components/change";
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

/** "42 minutes", "1 hour 5 minutes", "20 seconds": how long until `due`. */
export function timeLeft(due: string, now: number) {
  const s = Math.max(0, Math.ceil((Date.parse(due) - now) / 1000));
  if (s < 60) return s === 1 ? "1 second" : `${s} seconds`;
  const m = Math.ceil(s / 60), h = Math.floor(m / 60);
  const mins = m % 60 === 1 ? "1 minute" : `${m % 60} minutes`;
  return h === 0 ? mins : `${h === 1 ? "1 hour" : `${h} hours`}${m % 60 ? ` ${mins}` : ""}`;
}

/** The time now, by the second while a protection is counting down, and the log read again once its time is up. */
function useCountdown(due: string | null | undefined) {
  const { reloadChanges } = useActions();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!due) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [due]);
  const over = !!due && now > Date.parse(due);
  // The service looks once a second, so the log is read again every few seconds until it says it's back on.
  const round = over ? Math.floor((now - Date.parse(due)) / 5000) : -1;
  useEffect(() => { if (round >= 0) void reloadChanges(); }, [round, reloadChanges]);
  return now;
}

/** The second choice: its own card, typed word and Windows prompt, started only by the button on the change. */
function KeepOff({ id, onClose }: { id: string; onClose: () => void }) {
  const { client, reloadChanges, toast } = useActions();
  const pc = useAppSelector((c) => ({ id: c.pc.id, name: c.pc.name }));
  const [preview, setPreview] = useState<PreviewReply | null>(null);
  const [outcome, setOutcome] = useState<StepOutcome | null>(null);
  const step: NativeStep = { kind: "native", op: { name: "keepOff", id } };
  const run = async (what: string, f: () => Promise<void>) => {
    try { await f(); } catch (e) { toast(`Rig couldn't ${what}. ${e instanceof Error ? e.message : ""} Try again in a moment.`.replace(/\s+/g, " ").trim()); }
  };
  return (
    <StepCard step={step} own preview={preview} outcome={outcome} pcName={pc.name} canApply={client.caps.applyChanges}
      onRead={() => run("read the current settings", async () => { setOutcome(null); setPreview(await client.previewStep!(pc.id, step, false, true)); })}
      onApply={() => run("make this change", async () => {
        if (preview?.outcome !== "ready") return;
        setOutcome({ apply: await client.applyStep!(pc.id, preview.nonce, { title: stepHeadline(step), why: "You chose to keep it off.", by: "you" }) });
        await reloadChanges();
      })}
      onUndo={(force) => run("undo this", async () => {
        if (outcome?.apply.outcome !== "applied") return;
        setOutcome({ ...outcome, undo: await client.undoStep!(pc.id, outcome.apply.undo.id, force) });
        await reloadChanges();
      })}
      onDecline={onClose} onSteps={onClose} />
  );
}

function Entry({ c }: { c: Change }) {
  const { toggleChange, client } = useActions();
  const [busy, setBusy] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const off = c.status === "applied" && c.revert && c.applied[0]?.step.kind === "native" && c.applied[0].step.op.name === "protection" ? { id: c.applied[0].step.op.id, due: c.revert.due } : null;
  const now = useCountdown(off?.due);
  const toggle = () => { setBusy(true); void toggleChange(c.id).finally(() => setBusy(false)); };
  const commands = c.applied.filter((a): a is CommandApplied => a.step.kind === "command");
  const word = off ? (busy ? "Turning it back on…" : BACK_ON) : c.status === "applied" ? (busy ? "Undoing…" : "Undo") : busy ? "Redoing…" : "Redo";
  const helperMade = c.applied.some((a) => a.undo.kind !== "fix");
  // Only a catalog fix can be made again from here; a step the helper made is asked for again in the chat.
  const canToggle = commands.length ? c.status === "applied" && commands.some((a) => undoReach(a.step.cmd, a.undo, recordRuns(a.step.cmd)).can) : c.status === "applied" || !helperMade;
  const state = commands.length ? (c.status === "applied" ? "Open it to see what Undo can put back." : "Undone.") : c.status === "applied" ? "Old values saved." : "Old values put back.";
  const offWords = !off ? null : off.due === null ? "It's off, and it stays off until you turn it back on."
    : now > Date.parse(off.due) ? "Its time is up. Rig is turning it back on." : `It's off. Rig turns it back on in ${timeLeft(off.due, now)}.`;
  const meta = `By ${c.by === "you" ? "you" : "Rig, after you said yes"}. ${offWords ?? state}`;
  return (<>
    <Row name={c.title} title={c.title} meta={meta} time={clock(c.at)} at={c.at}
      mark={c.status === "undone" ? "hollow" : off ? "look" : "dot"} markLabel={off ? "Off for now" : undefined} tag={c.status === "undone" && <StatusChip status="undone" />}
      action={client.caps.applyChanges && canToggle && <>
        {off?.due && client.previewStep && !keeping && <button className="btn ghost sm" type="button" onClick={() => setKeeping(true)}>Keep it off</button>}
        <button className="btn sm" type="button" disabled={busy} onClick={toggle}>{word}</button>
      </>}
      details={<>
        {(c.why || c.result) && <p className="muted">{[c.why, c.result].filter(Boolean).join(" ")}</p>}
        {c.diff.length > 0 && <div className="diff-wrap"><DiffTable rows={c.diff} /></div>}
        {commands.map((a, i) => <StepRecord key={i} applied={a} />)}
      </>} />
    {off && keeping && <li className="row ch-keep"><KeepOff id={off.id} onClose={() => setKeeping(false)} /></li>}
  </>);
}
