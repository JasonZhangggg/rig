import { useMemo, useRef, useState, type ReactNode } from "react";
import { eventTitle, isActive, logTitle, type Alert, type PCEvent, type RecordingInfo } from "@rig/core";
import { DayLabel, FreshCtx, Row, Rows } from "../../components/Rows";
import { useActions, useAppSelector, useData, useStillPC } from "../../state";
import { useEvents, useOpenLog } from "../Logs";
import { Counters, dayStart, EventRow, MINOR, Strip, type EventPick } from "./Events";
import { LogsHead } from "./Head";
import { NowRecording } from "./Recordings";
import { highlights, serious } from "./summary";
import { clock, clockSec, dayName, shortDay, stateWord } from "./words";

const DAY = 864e5;
/** How far back the log reaches: as far as Windows keeps its events here. */
const DAYS = 30;
/** Windows' event log is read again this often while the log is open. */
const EVENTS_EVERY_MS = 30_000;
/** How many log entries show before Show more. */
const PAGE = 40;

/** One line of the live log. */
interface Entry { key: string; t: number; problem: boolean; title: string; row: ReactNode; event?: PCEvent }

/** Everything that happened on the PC in the last 30 days, newest first, with new entries added as they're written. */
export function EventLog() {
  const opened = useOpenLog();
  const { openRecording, ask } = useActions();
  const pc = useStillPC();
  const online = useAppSelector((c) => c.pc.online);
  const data = useData("recordings", "answering");
  const alerts = useAppSelector((c) => c.pc.alerts ?? []);
  const events = useEvents(EVENTS_EVERY_MS);
  const [only, setOnly] = useState<"all" | "problems">("all");
  const [pick, setPick] = useState<EventPick>(null);
  const [day, setDay] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  // What was there when the log first loaded; anything after it is new, and says so for a moment.
  const known = useRef<Set<string> | null>(null);

  const since = Date.now() - DAYS * DAY;
  const entries = useMemo(() => {
    const open = (r: RecordingInfo) => <button type="button" className="btn sm" onClick={() => openRecording(r.id)}>Open</button>;
    const out: Entry[] = [];
    for (const e of events ?? []) if (e.t >= since) out.push({ key: `e${e.t}${e.source}${e.id}`, t: e.t, problem: serious(e), title: eventTitle(e), row: null, event: e });
    for (const a of alerts) {
      const t = Date.parse(a.since);
      if (t < since) continue;
      out.push({ key: `a${a.id}`, t, problem: true, title: a.title, row: <AlertRow a={a} onAsk={ask} busy={data.answering} /> });
    }
    for (const r of data.recordings) {
      if (r.id.startsWith("bg-a-") && r.startedAt != null) {
        const t = Date.parse(r.createdAt);
        if (t < since) continue;
        out.push({ key: r.id, t, problem: true, title: logTitle(r), row: <Row name={logTitle(r)} title={logTitle(r)} time={clockSec(t)} at={new Date(t).toISOString()} mark="look"
          meta={`Closer look: Rig read every sensor every 5 seconds, ${clock(r.startedAt)} to ${clock(r.finishedAt ?? r.endsAt ?? r.startedAt)}.`} action={open(r)} /> });
      } else if (r.custom) {
        const c = r.custom;
        for (const n of c.notes) if (n.t >= since) out.push({ key: `${r.id}n${n.t}`, t: n.t, problem: false, title: n.text, row: <Row name={n.text} title={n.text} time={clockSec(n.t)} at={new Date(n.t).toISOString()} mark="dot" meta={`Custom log: ${c.spec.label}.`} action={open(r)} /> });
        const newest = c.rows.reduce<{ t: number; cells: unknown[] } | null>((a, x) => (!a || x.t > a.t ? x : a), null);
        if (newest && newest.t >= since) {
          out.push({ key: `${r.id}r${newest.t}`, t: newest.t, problem: false, title: c.spec.label, row: <Row name={c.spec.label} title={c.spec.label} time={clockSec(newest.t)} at={new Date(newest.t).toISOString()} mark="dot"
            meta={`Custom log, ${c.total} ${c.total === 1 ? "entry" : "entries"} so far.`} action={open(r)} /> });
        }
      } else if (!r.background) {
        const t = r.startedAt ?? Date.parse(r.createdAt);
        if (t < since) continue;
        const title = r.state === "done" ? logTitle(r) : r.reason;
        out.push({ key: r.id, t, problem: r.state === "failed", title, row: <Row name={title} title={title} time={clockSec(t)} at={new Date(t).toISOString()} mark={r.state === "failed" ? "look" : "dot"}
          meta={`Recording, ${stateWord[r.state].toLowerCase()}${r.minutes ? `, ${r.minutes} min` : ""}.`} action={open(r)} /> });
      }
    }
    return out.sort((a, b) => b.t - a.t);
  }, [events, alerts, data.recordings, data.answering]); // eslint-disable-line react-hooks/exhaustive-deps
  const windows = useMemo(() => (events ?? []).filter((e) => e.t >= since), [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => highlights(windows, pc.name), [windows, pc.name]);

  if (events != null && !known.current) known.current = new Set(entries.map((e) => e.key));
  if (opened) return opened;
  const fresh = (key: string) => !!known.current && !known.current.has(key);

  // A tile narrows the log to one thing Windows logged; All or Problems to everything, or what went wrong.
  const group = groups.find((g) => g.key === pick);
  const inGroup = group ? new Set(group.events) : null;
  const byPick = group ? entries.filter((e) => e.event && inGroup!.has(e.event)) : pick === MINOR ? entries.filter((e) => e.event && !e.problem) : entries;
  const problems = byPick.filter((e) => e.problem);
  const byKind = only === "problems" ? problems : byPick;
  const list = day == null ? byKind : byKind.filter((e) => dayStart(e.t) === day);
  const pickLabel = group ? group.short : pick === MINOR ? "Minor" : null;
  const reset = () => setShown(PAGE);

  return (
    <div className="page lg-page lv-page">
      <LogsHead sub={online ? `Everything that happened on ${pc.name}, newest first, as it's logged.` : `${pc.name} is offline. Everything it logged in the last 30 days is below.`}
        right={<span className={`lv-badge${online ? " on" : ""}`}><i aria-hidden="true" />{online ? "Live" : "Offline"}</span>} />
      {data.recordings.find(isActive) && <NowRecording r={data.recordings.find(isActive)!} pcName={pc.name} />}
      {windows.length > 0 && <Counters groups={groups} events={windows} pick={pick} all={false} onPick={(p) => { setPick(p); reset(); }} />}
      <section className="lv-feed" aria-labelledby="lv-feed-h">
        <div className="rc-sech lv-sech">
          <div className="lg-ev-head">
            <h2 id="lv-feed-h" className="lg-h">Log</h2>
            {pickLabel && <button type="button" className="chip no-dot lg-chip" aria-label={`Remove filter: ${pickLabel}`} onClick={() => { setPick(null); reset(); }}>{pickLabel}<span aria-hidden="true">×</span></button>}
            {day != null && <button type="button" className="chip no-dot lg-chip" aria-label={`Remove filter: ${shortDay(day)}`} onClick={() => { setDay(null); reset(); }}>{shortDay(day)}<span aria-hidden="true">×</span></button>}
          </div>
          <div className="lv-tools">
            <div className="counts" role="group" aria-label="Show">
              <button type="button" className="count quiet" aria-pressed={only === "all"} onClick={() => { setOnly("all"); reset(); }}><span className="count-n num">{byPick.length}</span><span className="count-label">All</span></button>
              <button type="button" className="count" aria-pressed={only === "problems"} onClick={() => { setOnly(only === "problems" ? "all" : "problems"); reset(); }}><span className="count-n num">{problems.length}</span><span className="count-label">Problems</span></button>
            </div>
          </div>
        </div>
        {entries.length > 0 && <Strip items={byKind.map((e) => ({ t: e.t, key: e.key, bad: e.problem, title: e.title }))} day={day} onDay={(d) => { setDay(d); reset(); }} />}
        {events == null && !entries.length ? <p className="muted">Reading the logs…</p>
          : list.length === 0 ? <p className="muted lv-none">{day != null ? `Nothing here on ${shortDay(day)}.` : only === "problems" ? `No problems on ${pc.name} in the last 30 days.` : `Nothing logged on ${pc.name} in the last 30 days.`}</p>
          : (
            byDay(list.slice(0, shown)).map((g) => (
              <section key={g.day} className="ev-group" aria-label={g.day}>
                <DayLabel day={g.day} count={g.list.length} one="entry" many="entries" />
                <Rows timeline>
                  {g.list.map((en) => en.event ? <EventRow key={en.key} e={en.event} seconds fresh={fresh(en.key)} /> : <FreshRow key={en.key} fresh={fresh(en.key)}>{en.row}</FreshRow>)}
                </Rows>
              </section>
            ))
          )}
        {list.length > shown && <button type="button" className="btn ghost sm lv-more" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
      </section>
    </div>
  );
}

/** Entries split by day, so last night's don't read as this afternoon's. */
function byDay(list: Entry[]) {
  const out: { day: string; list: Entry[] }[] = [];
  for (const en of list) { const name = dayName(en.t); if (out[out.length - 1]?.day === name) out[out.length - 1].list.push(en); else out.push({ day: name, list: [en] }); }
  return out;
}

/** Marks a row that came in while the page was open, so the eye finds it. */
function FreshRow({ fresh, children }: { fresh: boolean; children: ReactNode }) {
  return <FreshCtx.Provider value={fresh}>{children}</FreshCtx.Provider>;
}

/** A problem Rig is watching that's still going on, like a part running hot. */
function AlertRow({ a, onAsk, busy }: { a: Alert; onAsk: (q: string) => void; busy: boolean }) {
  const t = Date.parse(a.since);
  return (
    <Row name={a.title} title={a.title} time={clockSec(t)} at={a.since} mark="look" markLabel="Still going"
      meta={`Still going. ${a.detail}`}
      action={a.ask ? <button type="button" className="btn sm" disabled={busy} aria-label={`Ask about this: ${a.title}`} onClick={() => onAsk(a.ask!)}>Ask</button> : undefined} />
  );
}
