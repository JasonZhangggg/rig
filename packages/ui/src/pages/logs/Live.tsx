import { useMemo, useRef, useState, type ReactNode } from "react";
import { isActive, limitsOf, liveRecorded, logTitle, type Alert, type PCEvent, type RecordingInfo } from "@rig/core";
import { ChartNote } from "../../chart";
import { DayLabel, FreshCtx, Row, Rows } from "../../components/Rows";
import { useActions, useAppSelector, useData, useStillPC } from "../../state";
import { useEvents, useOpenLog } from "../Logs";
import { EventRow } from "./Events";
import { LogsHead } from "./Head";
import { AllSensors } from "./Lanes";
import { NowRecording } from "./Recordings";
import { serious } from "./summary";
import { clock, clockSec, dayName, isPhone, stateWord } from "./words";

const DAY = 864e5;
/** How far back the live charts reach, in minutes, up to the hour Rig keeps. */
const spans = [1, 5, 15, 60] as const;
const spanWord = (m: number) => (m === 60 ? "1 hour" : `${m} min`);
/** About this many readings are drawn across a chart, however long it spans. */
const DRAWN = 400;

/**
 * Every reading for a short span; for a long one, the last reading of each slot, so an hour isn't 1,800 points a line.
 * Slots are fixed in time, so a reading stays drawn as the chart slides.
 */
function thin<T extends { t: number }>(list: readonly T[], from: number, span: number): T[] {
  const inRange = list.filter((p) => p.t >= from - span / 10);
  const step = span / DRAWN;
  if (inRange.length <= DRAWN * 1.5) return inRange;
  const out: T[] = [];
  for (const p of inRange) {
    const slot = Math.floor(p.t / step);
    if (out.length && Math.floor(out[out.length - 1].t / step) === slot) out[out.length - 1] = p; else out.push(p);
  }
  return out;
}
/** Windows' event log is read again this often while Live is open. */
const EVENTS_EVERY_MS = 30_000;
/** How many log entries show before Show more. */
const PAGE = 40;

/** What's happening on the PC now: every reading as it comes in, and every log entry as it's written. */
export function LiveLogs() {
  const opened = useOpenLog();
  const pc = useStillPC();
  const data = useData("recordings");
  const online = useAppSelector((c) => c.pc.online);
  if (opened) return opened;
  const active = data.recordings.find(isActive);
  return (
    <div className="page lg-page lv-page">
      <LogsHead sub={online ? `${pc.name} right now: every reading and log entry as it comes in.` : `${pc.name} is offline. Its log entries from the last day are below.`}
        right={<span className={`lv-badge${online ? " on" : ""}`}><i aria-hidden="true" />{online ? "Live" : "Offline"}</span>} />
      {active && <NowRecording r={active} pcName={pc.name} />}
      <LiveReadings />
      <LiveFeed />
    </div>
  );
}

/** Every sensor over the last few minutes, sliding left as each reading arrives. */
function LiveReadings() {
  const pc = useAppSelector((c) => c.pc, Object.is);
  const { live } = useData("live");
  const [span, setSpan] = useState<number>(5);
  const now = Date.now();
  const r = useMemo(() => liveRecorded(pc.readings ?? [], thin(live, now - span * 60_000, span * 60_000)), [pc.readings, live, span]); // eslint-disable-line react-hooks/exhaustive-deps
  const limits = limitsOf(pc);
  // Rig keeps readings from when it opened, so a long span may start partway.
  const since = live[0] && live[0].t > now - span * 60_000 + 30_000 ? live[0].t : null;
  const last = live[live.length - 1];
  const every = live.length > 1 ? Math.max(1, Math.round((last.t - live[live.length - 2].t) / 1000)) : null;
  const status = !pc.online ? (last ? `Last reading at ${clock(last.t)}` : "") : every ? `New reading every ${every} s` : "Waiting for the next reading";
  return (
    <section className="lv-readings" aria-labelledby="lv-read-h">
      <div className="rc-sech lv-sech">
        <h2 id="lv-read-h" className="lg-h">Readings</h2>
        <div className="lv-tools">
          <span className="faint" aria-live="off">{status}</span>
          <div className="seg" role="group" aria-label="How far back">
            {spans.map((m) => <button key={m} type="button" aria-pressed={span === m} onClick={() => setSpan(m)}>{spanWord(m)}</button>)}
          </div>
        </div>
      </div>
      {!pc.online && live.length < 2 ? <ChartNote>{`${pc.name} is offline, so there's nothing live to show. Recorded has what it logged.`}</ChartNote>
        : live.length < 2 || !r.sensors.length ? <ChartNote>Readings draw here as they come in.</ChartNote>
        : <>
          <AllSensors r={r} from={now - span * 60_000} to={now} limits={limits} compact={isPhone()} live={pc.online} />
          {since && <p className="faint lv-since">Readings start at {clock(since)}, when Rig opened. For earlier ones, see <a href="#recorded">Recorded</a>.</p>}
        </>}
    </section>
  );
}

/** One line of the live log. */
interface Entry { key: string; t: number; problem: boolean; row: ReactNode }

/** Everything logged on the PC in the last day, newest first, with new entries added as they're written. */
function LiveFeed() {
  const { openRecording, ask } = useActions();
  const pc = useStillPC();
  const data = useData("recordings", "answering");
  const alerts = useAppSelector((c) => c.pc.alerts ?? []);
  const events = useEvents(EVENTS_EVERY_MS);
  const [only, setOnly] = useState<"all" | "problems">("all");
  const [shown, setShown] = useState(PAGE);
  // What was there when the log first loaded; anything after it is new, and says so for a moment.
  const known = useRef<Set<string> | null>(null);

  const since = Date.now() - DAY;
  const entries = useMemo(() => {
    const open = (r: RecordingInfo) => <button type="button" className="btn sm" onClick={() => openRecording(r.id)}>Open</button>;
    const out: Entry[] = [];
    for (const e of events ?? []) if (e.t >= since) out.push({ key: `e${e.t}${e.source}${e.id}`, t: e.t, problem: serious(e), row: null });
    for (const a of alerts) {
      const t = Date.parse(a.since);
      if (t < since) continue;
      out.push({ key: `a${a.id}`, t, problem: true, row: <AlertRow a={a} onAsk={ask} busy={data.answering} /> });
    }
    for (const r of data.recordings) {
      if (r.id.startsWith("bg-a-") && r.startedAt != null) {
        const t = Date.parse(r.createdAt);
        if (t < since) continue;
        out.push({ key: r.id, t, problem: true, row: <Row name={logTitle(r)} title={logTitle(r)} time={clockSec(t)} at={new Date(t).toISOString()} mark="look"
          meta={`Closer look: Rig read every sensor every 5 seconds, ${clock(r.startedAt)} to ${clock(r.finishedAt ?? r.endsAt ?? r.startedAt)}.`} action={open(r)} /> });
      } else if (r.custom) {
        const c = r.custom;
        for (const n of c.notes) if (n.t >= since) out.push({ key: `${r.id}n${n.t}`, t: n.t, problem: false, row: <Row name={n.text} title={n.text} time={clockSec(n.t)} at={new Date(n.t).toISOString()} mark="dot" meta={`Custom log: ${c.spec.label}.`} action={open(r)} /> });
        const newest = c.rows.reduce<{ t: number; cells: unknown[] } | null>((a, x) => (!a || x.t > a.t ? x : a), null);
        if (newest && newest.t >= since) {
          out.push({ key: `${r.id}r${newest.t}`, t: newest.t, problem: false, row: <Row name={c.spec.label} title={c.spec.label} time={clockSec(newest.t)} at={new Date(newest.t).toISOString()} mark="dot"
            meta={`Custom log, ${c.total} ${c.total === 1 ? "entry" : "entries"} so far.`} action={open(r)} /> });
        }
      } else if (!r.background) {
        const t = r.startedAt ?? Date.parse(r.createdAt);
        if (t < since) continue;
        const title = r.state === "done" ? logTitle(r) : r.reason;
        out.push({ key: r.id, t, problem: r.state === "failed", row: <Row name={title} title={title} time={clockSec(t)} at={new Date(t).toISOString()} mark={r.state === "failed" ? "look" : "dot"}
          meta={`Recording, ${stateWord[r.state].toLowerCase()}${r.minutes ? `, ${r.minutes} min` : ""}.`} action={open(r)} /> });
      }
    }
    return out.sort((a, b) => b.t - a.t);
  }, [events, alerts, data.recordings, data.answering]); // eslint-disable-line react-hooks/exhaustive-deps

  if (events != null && !known.current) known.current = new Set(entries.map((e) => e.key));
  const fresh = (key: string) => !!known.current && !known.current.has(key);
  const problems = entries.filter((e) => e.problem);
  const list = only === "problems" ? problems : entries;
  const byKey = new Map<string, PCEvent>((events ?? []).map((e) => [`e${e.t}${e.source}${e.id}`, e]));

  return (
    <section className="lv-feed" aria-labelledby="lv-feed-h">
      <div className="rc-sech lv-sech">
        <h2 id="lv-feed-h" className="lg-h">Log</h2>
        <div className="lv-tools">
          <span className="faint">Last 24 hours, newest first</span>
          <div className="seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={only === "all"} onClick={() => setOnly("all")}>All <span className="num">{entries.length}</span></button>
            <button type="button" aria-pressed={only === "problems"} onClick={() => setOnly("problems")}>Problems <span className="num">{problems.length}</span></button>
          </div>
        </div>
      </div>
      {events == null && !entries.length ? <p className="muted">Reading the logs…</p>
        : list.length === 0 ? <p className="muted lv-none">{only === "problems" ? `No problems on ${pc.name} in the last 24 hours.` : `Nothing logged on ${pc.name} in the last 24 hours.`}</p>
        : (
          byDay(list.slice(0, shown)).map((g) => (
            <section key={g.day} className="ev-group" aria-label={g.day}>
              <DayLabel day={g.day} count={g.list.length} one="entry" many="entries" />
              <Rows timeline>
                {g.list.map((en) => {
                  const ev = byKey.get(en.key);
                  return ev ? <EventRow key={en.key} e={ev} seconds fresh={fresh(en.key)} /> : <FreshRow key={en.key} fresh={fresh(en.key)}>{en.row}</FreshRow>;
                })}
              </Rows>
            </section>
          ))
        )}
      {list.length > shown && <button type="button" className="btn ghost sm lv-more" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
      <p className="faint lv-older">Older entries are in <a href="#recorded">Recorded</a>, day by day, and <a href="#events">Windows events</a>, for the last 30 days.</p>
    </section>
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
