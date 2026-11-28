import { useEffect, useState } from "react";
import { fixSteps, type AppliedStep, type Change, type CommandStep, type DiffRow, type HelperStep, type Issue, type OpenRevert, type PreviewReply, type StepOutcome } from "@rig/core";
import { DiffTable, StatusChip } from "../components/common";
import { nativeNoUndo, recordRuns, StepCard, StepRecord, undoReach } from "../components/change";
import { TURN_BACK_ON } from "../components/change/native";
import { Countdown } from "../components/change/Revert";
import { DayLabel, Row, Rows } from "../components/Rows";
import { useActions, useAppSelector, useLatest } from "../state";
import { Counts, HowChangesWork, type Filter } from "./changes/Counts";
import { NoChanges } from "./changes/Empty";
import { bySeverity, issueGo } from "./shared";
import { dateText } from "../dateText";
import { whileShown } from "../whileShown";

type CommandApplied = Extract<AppliedStep, { step: CommandStep }>;

const midnight = (t: number | Date) => new Date(t).setHours(0, 0, 0, 0);
const clock = (iso: string) => dateText(new Date(iso), { hour: "numeric", minute: "2-digit" });

/** "Today", "Yesterday", or the date in full. */
export function dayLabel(iso: string, now = new Date()) {
  const days = Math.round((midnight(now) - midnight(new Date(iso))) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return dateText(new Date(iso), { weekday: "long", month: "long", day: "numeric" });
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
      <OffForNow />
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

/**
 * Protections that are off because of a change made here, until each is back on. Keeping one off is a card of its own:
 * read, the typed word, then Windows' own prompt.
 */
function OffForNow() {
  const { openReverts, toggleChange } = useActions();
  const applied = useAppSelector((c) => c.data.changes.filter((x) => x.status === "applied").length);
  const [open, setOpen] = useState<OpenRevert[]>([]);
  const [keeping, setKeeping] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const look = () => void openReverts().then((o) => live && setOpen(o));
    look();
    const stop = whileShown(look, 15_000);
    return () => { live = false; stop(); };
  }, [openReverts, applied]);
  if (!open.length) return null;
  const refresh = () => openReverts().then(setOpen);
  const on = (id: string) => { setBusy(id); setKeeping(null); void toggleChange(id).then(refresh).finally(() => setBusy(null)); };
  return (
    <section className="card ch-next" aria-labelledby="ch-off-h">
      <div className="card-head"><h2 id="ch-off-h">Off for now <span className="faint num">{open.length}</span></h2></div>
      <Rows>
        {open.map((r) => (
          <Row key={r.changeId} name={r.row.name} title={`${r.row.name} is off`} meta={<Countdown dueAt={r.dueAt} kept={r.kept} />}
            action={<>
              {!r.kept && keeping !== r.changeId && <button className="btn ghost sm" type="button" disabled={busy === r.changeId} onClick={() => setKeeping(r.changeId)}>Keep it off…</button>}
              <button className="btn sm" type="button" disabled={busy === r.changeId} onClick={() => on(r.changeId)}>{busy === r.changeId ? "Working…" : TURN_BACK_ON}</button>
            </>} />
        ))}
      </Rows>
      {open.filter((r) => r.changeId === keeping).map((r) => <KeepOff key={r.changeId} revert={r} onClose={() => setKeeping(null)} onDone={refresh} />)}
    </section>
  );
}

/** The person's second choice, as its own step card. Nothing from the chat can ask for it. */
function KeepOff({ revert, onClose, onDone }: { revert: OpenRevert; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { client, toast } = useActions();
  const pc = useAppSelector((c) => ({ id: c.pc.id, name: c.pc.name }));
  const [preview, setPreview] = useState<PreviewReply | null>(null);
  const [outcome, setOutcome] = useState<StepOutcome | null>(null);
  if (!client.previewKeepOff || !client.applyStep) return null;
  const step: HelperStep = { kind: "native", op: { name: "protectionKeep", id: revert.row.id } };
  const run = async (what: string, f: () => Promise<void>) => {
    try { await f(); } catch (e) { toast(`Rig couldn't ${what}, so it still comes back on by itself. ${e instanceof Error ? e.message : ""}`.replace(/\s+/g, " ").trim()); }
  };
  return (
    <div className="ch-keep">
      <StepCard step={step} byPerson preview={preview} outcome={outcome} pcName={pc.name} canApply={client.caps.applyChanges}
        onRead={() => run("read it", async () => { setOutcome(null); setPreview(await client.previewKeepOff!(pc.id, revert.changeId)); })}
        onApply={() => run("keep it off", async () => {
          if (preview?.outcome !== "ready") return;
          setOutcome({ apply: await client.applyStep!(pc.id, preview.nonce, { by: "you", why: "You chose to keep it off after Rig turned it off for a while." }) });
          await onDone();
        })}
        onUndo={() => undefined} onDecline={onClose} onSteps={onClose} />
    </div>
  );
}

const protectionOf = (c: Change) => c.applied.flatMap((a) => (a.step.kind === "native" && (a.step.op.name === "protection" || a.step.op.name === "protectionKeep") ? [a.step.op.name] : []))[0];

function Entry({ c }: { c: Change }) {
  const { toggleChange, client } = useActions();
  const [busy, setBusy] = useState(false);
  const toggle = () => { setBusy(true); void toggleChange(c.id).finally(() => setBusy(false)); };
  const commands = c.applied.filter((a): a is CommandApplied => a.step.kind === "command");
  const word = c.status === "applied" ? (busy ? "Undoing…" : "Undo") : busy ? "Redoing…" : "Redo";
  const fixed = c.applied.some((a) => a.step.kind === "native" && nativeNoUndo(a.step.op));
  const protection = protectionOf(c);
  const canToggle = fixed || protection ? false : commands.length ? c.status === "applied" && commands.some((a) => undoReach(a.step.cmd, a.undo, recordRuns(a.step.cmd)).can) : true;
  const state = protection === "protectionKeep" ? "" : protection ? (c.status === "applied" ? "Off for now. Turn it back on under Off for now." : "Back on.") : commands.length ? (c.status === "applied" ? "Open it to see what Undo can put back." : "Undone.") : c.status === "applied" ? "Old values saved." : "Old values put back.";
  const meta = `By ${c.by === "you" ? "you" : "Rig, after you said yes"}. ${state}`.trim();
  return (
    <Row name={c.title} title={c.title} meta={meta} time={clock(c.at)} at={c.at}
      mark={c.status === "undone" ? "hollow" : "dot"} tag={c.status === "undone" && <StatusChip status="undone" />}
      action={client.caps.applyChanges && canToggle && <button className="btn sm" type="button" disabled={busy} onClick={toggle}>{word}</button>}
      details={<>
        {(c.why || c.result) && <p className="muted">{[c.why, c.result].filter(Boolean).join(" ")}</p>}
        {c.diff.length > 0 && <div className="diff-wrap"><DiffTable rows={c.diff} /></div>}
        {commands.map((a, i) => <StepRecord key={i} applied={a} />)}
      </>} />
  );
}
