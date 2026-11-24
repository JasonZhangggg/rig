import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isActive, limitsOf, logTitle, peakOf, recorded, type PCEvent, type Recorded as RecordedData, type Recording, type RecordingInfo } from "@rig/core";
import { RowFigure } from "../components/Rows";
import { Icon } from "../components/common";
import { useActions, useData, useStillPC, useTemp, useUI } from "../state";
import { Detail } from "./logs/Detail";
import { Counters, Events, MINOR, onDay, type EventPick } from "./logs/Events";
import { AllSensors, value, type Band, type ChartMark } from "./logs/Lanes";
import { CustomLogs, NowRecording, Recordings } from "./logs/Recordings";
import { highlights, serious } from "./logs/summary";
import { clock, dayName, isPhone, kindWord, shortDay } from "./logs/words";
import { LogsHead } from "./logs/Head";

type Temp = ReturnType<typeof useTemp>;
type Limits = { cpu?: number; gpu?: number };
const DAY = 864e5;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** The PC's events from the Windows event log, for whichever view needs them. */
function useEvents(): PCEvent[] | null {
  const { client } = useActions();
  const pc = useStillPC();
  const [events, setEvents] = useState<PCEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    setEvents(null);
    client.events(pc.id).then((e) => live && setEvents(e)).catch(() => live && setEvents([]));
    return () => { live = false; };
  }, [client, pc.id]);
  return events;
}

/** A log opened from Logs, shown in place of the page. */
function useOpenLog() {
  const { openRecording } = useActions();
  const ui = useUI();
  const data = useData("recordings");
  const open = data.recordings.find((r) => r.id === ui.recordingId);
  return open ? <Detail info={open} onBack={() => openRecording(null)} /> : null;
}

/** The closer looks the recorder took on a day. */
const dayLooks = (list: RecordingInfo[], from: number, to: number) =>
  list.filter((r) => r.id.startsWith("bg-a-") && r.startedAt != null && Date.parse(r.createdAt) >= from && Date.parse(r.createdAt) < to);

/** Everything Rig recorded on this PC, a day at a time: what happened first, then every sensor, then the recordings. */
export function Logs() {
  const opened = useOpenLog();
  const { client } = useActions();
  const pc = useStillPC();
  const data = useData("recordings");
  const temp = useTemp();
  const events = useEvents();
  const limits = limitsOf(pc);
  const days = useMemo(() => data.recordings.filter((r) => r.id.startsWith("bg-d-")).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)), [data.recordings]);
  const [pick, setPick] = useState(0);
  const info: RecordingInfo | undefined = days[Math.min(pick, days.length - 1)];
  const [rec, setRec] = useState<Recording | null>(null);
  // Fetch the day again as today's grows.
  const version = info ? `${info.id}|${Math.floor(info.sampleCount / 10)}|${info.eventCount}` : "";
  useEffect(() => {
    let live = true;
    if (!info) { setRec(null); return; }
    client.recording(pc.id, info.id).then((r) => live && setRec(r)).catch(() => live && setRec(null));
    return () => { live = false; };
  }, [client, pc.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const day = useMemo(() => (rec && rec.id === info?.id ? recorded(rec) : null), [rec, info?.id]);

  if (opened) return opened;
  const active = data.recordings.find(isActive);
  const from = info?.startedAt != null ? startOfDay(info.startedAt) : 0;
  const to = from + DAY;
  const first = day?.points[0]?.t ?? from, last = day?.points.at(-1)?.t ?? to;
  const looks = dayLooks(data.recordings, from, to);
  const bands: Band[] = looks.map((l) => ({ from: l.startedAt!, to: l.finishedAt ?? l.startedAt!, kind: "look" }));
  const marks: ChartMark[] = looks.map((l) => ({ t: Date.parse(l.createdAt), look: true }));

  return (
    <div className="page lg-page rc-page">
      <LogsHead sub={days.length ? `${pc.name} · every sensor, every 30 seconds` : `Recordings on ${pc.name}`} />
      {active && <NowRecording r={active} pcName={pc.name} />}

      {info ? (
        <>
          <div className="rc-day">
            <button type="button" className="btn ghost sm icon" aria-label="Day before" disabled={pick >= days.length - 1} onClick={() => setPick(pick + 1)}><Icon d="M12 4 6 10l6 6" /></button>
            <h2 className="rc-day-name">{dayName(from)}</h2>
            <button type="button" className="btn ghost sm icon" aria-label="Day after" disabled={pick <= 0} onClick={() => setPick(pick - 1)}><Icon d="M8 4l6 6-6 6" /></button>
          </div>
          <Happened from={from} to={to} day={day} events={events} limits={limits} temp={temp} />
          <section className="rc-readings" aria-labelledby="rc-read-h">
            <div className="rc-sech">
              <h2 id="rc-read-h" className="lg-h">Readings</h2>
              {day && <span className="faint">{clock(first)} to {last >= to - 60_000 ? "midnight" : clock(last)}</span>}
            </div>
            {!day ? <p className="muted">Loading the day…</p>
              : <AllSensors r={day} from={first} to={Math.max(last, first + 36e5)} limits={limits} bands={bands} marks={marks} compact={isPhone()} />}
          </section>
        </>
      ) : (
        <p className="muted rc-none">No background log on {pc.name}. With the background recorder on in Settings on that PC, Rig keeps every sensor here, even while it's closed.</p>
      )}

      <div className="rc-lower">
        <Recordings />
        <CustomLogs />
      </div>
    </div>
  );
}

/** The reading that tells a closer look's story: the graphics card for a driver reset, memory for an app that crashed. */
function figureFor(r: RecordingInfo, day: RecordedData | null, limits: Limits, temp: Temp): ReactNode {
  if (!day || r.startedAt == null) return null;
  const text = `${r.reason} ${r.headline ?? ""}`;
  const part = /graphics|display|nvlddmkm/i.test(text) ? "gpu" : /application (error|hang)|crashed/i.test(text) ? "ram" : "cpu";
  const p = day.parts.find((x) => x.id === part);
  if (!p) return null;
  const top = peakOf(day, p.lead, r.startedAt, r.finishedAt ?? r.endsAt ?? r.startedAt);
  if (!top) return null;
  const limit = part === "gpu" ? limits.gpu : part === "cpu" ? limits.cpu : undefined;
  return <RowFigure value={value(temp, day.sensors[p.lead].type, top.max)} word={part === "ram" ? "memory" : part === "gpu" ? "GPU" : "CPU"} look={limit != null && top.max >= limit - 6} />;
}

interface Item { t: number; key: string; title: string; meta: string; figure?: ReactNode; look: boolean; open?: () => void }

/** The day's closer looks, recordings and serious Windows events, newest first, each opening its own page. */
function Happened({ from, to, day, events, limits, temp }: { from: number; to: number; day: RecordedData | null; events: PCEvent[] | null; limits: Limits; temp: Temp }) {
  const { openRecording } = useActions();
  const data = useData("recordings");
  const looks = dayLooks(data.recordings, from, to);
  const mine = data.recordings.filter((r) => !r.background && r.startedAt != null && r.startedAt >= from && r.startedAt < to);
  const covered = (t: number) => looks.some((l) => t >= l.startedAt! - 60_000 && t <= (l.finishedAt ?? l.startedAt!) + 60_000);
  const loose = (events ?? []).filter((e) => serious(e) && e.t >= from && e.t < to && !covered(e.t));
  const items: Item[] = [
    ...looks.map((l): Item => ({
      t: Date.parse(l.createdAt), key: l.id, title: logTitle(l), meta: `Closer look · ${clock(l.startedAt!)} to ${clock(l.finishedAt ?? l.startedAt!)}`,
      figure: figureFor(l, day, limits, temp), look: true, open: () => openRecording(l.id),
    })),
    ...mine.map((r): Item => ({ t: r.startedAt!, key: r.id, title: r.state === "done" ? logTitle(r) : r.reason, meta: `Recording · ${r.minutes} min`, look: false, open: () => openRecording(r.id) })),
    ...loose.map((e): Item => ({ t: e.t, key: `${e.t}${e.id}`, title: kindWord(e.kind), meta: e.source, look: true })),
  ].sort((a, b) => b.t - a.t);
  return (
    <section className="rc-happened" aria-labelledby="rc-hap-h">
      <h2 id="rc-hap-h" className="lg-h">What happened</h2>
      {items.length === 0 ? <p className="muted">Nothing unusual {dayName(from) === "Today" ? "so far today" : `on ${shortDay(from)}`}.</p> : (
        <ul className="rows timeline">
          {items.map((it) => {
            const body = (
              <>
                <time className="row-time num" dateTime={new Date(it.t).toISOString()}>{clock(it.t)}</time>
                <span className="row-body">
                  <span className="row-title"><span>{it.title}</span></span>
                  <span className="row-meta">{it.meta}</span>
                </span>
                {it.figure}
                {it.open && <Icon d="M8 4l6 6-6 6" />}
              </>
            );
            return (
              <li key={it.key} className={`row has-time${it.look ? " mark-look" : ""}`}>
                {it.open ? <button type="button" className="row-main rc-open" onClick={it.open}>{body}</button> : <div className="row-main">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** What the Windows logs say about this PC lately: a count per thing that went wrong, and the events behind each. */
export function WindowsEvents() {
  const opened = useOpenLog();
  const pc = useStillPC();
  const events = useEvents();
  const [pick, setPick] = useState<EventPick>(null);
  const [day, setDay] = useState<number | null>(null);
  const all = useMemo(() => events ?? [], [events]);
  const groups = useMemo(() => highlights(all, pc.name), [all, pc.name]);
  if (opened) return opened;

  const picked = groups.find((g) => g.key === pick);
  const minor = pick === MINOR;
  const byPick = picked ? picked.events : minor ? all.filter((e) => !serious(e)) : all;
  const shown = day == null ? byPick : byPick.filter((e) => onDay(e, day));
  const pickLabel = picked ? picked.short : minor ? "Minor" : null;
  const hasEvents = all.length > 0;

  return (
    <div className="page lg-page">
      <LogsHead sub={`What went wrong on ${pc.name} in the last 30 days, from the Windows event log.`} />
      {events == null && <p className="muted">Reading the event log…</p>}
      {events != null && !hasEvents && <p className="lg-none">Windows logged no problems on {pc.name} in the last 30 days.</p>}
      {hasEvents && <Counters groups={groups} events={all} pick={picked || minor ? pick : null} onPick={setPick} />}
      {hasEvents && (
        <section className="lg-section lg-events" aria-labelledby="lg-ev-h">
          <div className="lg-ev-head">
            <h2 id="lg-ev-h" className="lg-h">Events <span className="faint num">{shown.length}</span></h2>
            {pickLabel && <button type="button" className="chip no-dot lg-chip" aria-label={`Remove filter: ${pickLabel}`} onClick={() => setPick(null)}>{pickLabel}<span aria-hidden="true">×</span></button>}
            {day != null && <button type="button" className="chip no-dot lg-chip" aria-label={`Remove filter: ${shortDay(day)}`} onClick={() => setDay(null)}>{shortDay(day)}<span aria-hidden="true">×</span></button>}
          </div>
          <Events strip={byPick} events={shown} day={day} onDay={setDay} emptyText={day == null ? "Nothing here." : `${pickLabel ? "None of these" : "Nothing logged"} on ${shortDay(day)}.`} />
        </section>
      )}
    </div>
  );
}
