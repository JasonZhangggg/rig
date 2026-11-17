import { useMemo, useState } from "react";
import { eventKinds, eventTitle, type EventKind, type PCEvent } from "@rig/core";
import { clock, dayName, kindWord, shortDay } from "./words";

const DAYS = 30;
const DAY = 864e5;
const serious = (e: PCEvent) => e.kind !== "other" && (e.level !== "warning" || e.kind === "driver");

/** One Windows event: when, what it means, and what Windows wrote. */
export function EventRow({ e, seconds }: { e: PCEvent; seconds?: boolean }) {
  return (
    <li className="ev-row">
      <span className="num faint">{seconds ? new Date(e.t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : clock(e.t)}</span>
      <span className={`chip ${serious(e) ? "warn" : ""}`}>{kindWord(e.kind)}</span>
      <span className="ev-text"><b>{eventTitle(e)}</b><span className="muted">{e.message}</span><span className="faint ev-src">{e.source} · event {e.id}</span></span>
    </li>
  );
}

/** Thirty days at a glance: one column per day, one dot per event. */
function Strip({ events }: { events: PCEvent[] }) {
  const end = new Date(); end.setHours(24, 0, 0, 0);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const from = end.getTime() - (DAYS - i) * DAY;
    return { from, list: events.filter((e) => e.t >= from && e.t < from + DAY) };
  });
  return (
    <div className="ev-strip" role="img" aria-label={`${events.length} events over the last ${DAYS} days`}>
      {days.map((d, i) => (
        <div key={d.from} className="ev-day" title={`${shortDay(d.from)}: ${d.list.length ? d.list.map(eventTitle).join(", ") : "nothing"}`}>
          <span className="ev-dots">{d.list.slice(0, 4).map((e) => <i key={`${e.t}${e.source}`} className={serious(e) ? "bad" : ""} />)}</span>
          <span className="ev-tick">{i === DAYS - 1 ? "Today" : i % 7 === 1 ? shortDay(d.from) : ""}</span>
        </div>
      ))}
    </div>
  );
}

/** The Windows event timeline with its filter. Null while loading. */
export function Events({ events, pcName }: { events: PCEvent[] | null; pcName: string }) {
  const [kind, setKind] = useState<EventKind | "all">("all");
  const shown = useMemo(() => (events ?? []).filter((e) => kind === "all" || e.kind === kind), [events, kind]);
  const groups = useMemo(() => {
    const out: { day: string; list: PCEvent[] }[] = [];
    for (const e of shown) { const day = dayName(e.t); if (out[out.length - 1]?.day === day) out[out.length - 1].list.push(e); else out.push({ day, list: [e] }); }
    return out;
  }, [shown]);
  const count = (k: EventKind) => (events ?? []).filter((e) => e.kind === k).length;

  return (
    <section className="card lg-events">
      <div className="card-head">
        <h2>Windows events</h2>
        <div className="seg lg-filter" role="group" aria-label="Kind of event">
          <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")}>All</button>
          {eventKinds.filter((k) => count(k.kind) > 0 || k.kind !== "other").map((k) => (
            <button key={k.kind} type="button" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>{k.label}{count(k.kind) > 0 && <em className="num">{count(k.kind)}</em>}</button>
          ))}
        </div>
      </div>
      {events == null ? <p className="card-pad muted">Reading the event log…</p> : events.length === 0 ? (
        <p className="card-pad muted">Nothing went wrong on {pcName} in the last {DAYS} days: no crashes, driver resets, hardware errors, unexpected shutdowns or disk problems in the Windows event log.</p>
      ) : (
        <>
          <Strip events={shown} />
          {shown.length === 0 && <p className="card-pad muted">None of these in the last {DAYS} days.</p>}
          {groups.map((g) => (
            <div key={g.day} className="ev-group">
              <div className="label">{g.day}</div>
              <ul className="ev-list">{g.list.map((e) => <EventRow key={`${e.t}${e.source}${e.id}`} e={e} />)}</ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
