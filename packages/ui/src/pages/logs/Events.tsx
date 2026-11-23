import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { eventTitle, type PCEvent } from "@rig/core";
import { Icon } from "../../components/common";
import { useApp } from "../../state";
import { serious, type Highlight } from "./summary";
import { clock, clockSec, dayName, kindWord, shortDay } from "./words";

const DAYS = 30;

/** Midnight at the start of a moment's day, and of the day after. */
export const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const nextDay = (t: number) => { const d = new Date(t); d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const onDay = (e: PCEvent, day: number) => e.t >= day && e.t < nextDay(day);

/** What the counts can pick: one thing that went wrong (its key), the minor entries, or everything (null). */
export type EventPick = string | null;
export const MINOR = "minor";

/** The page at a glance: one big count per thing that went wrong and when it last happened, then the minor entries and all of them. Each is a filter over the list. */
export function Counters({ groups, events, pick, onPick }: { groups: Highlight[]; events: PCEvent[]; pick: EventPick; onPick: (p: EventPick) => void }) {
  const minor = events.filter((e) => !serious(e));
  const items = [
    ...groups.map((g) => ({ key: g.key as EventPick, n: g.events.length, label: g.short, last: g.last, tone: g.key.startsWith("app:") ? "" : " look" })),
    ...(minor.length ? [{ key: MINOR as EventPick, n: minor.length, label: "Minor", last: Math.max(...minor.map((e) => e.t)), tone: " quiet" }] : []),
    { key: null as EventPick, n: events.length, label: "All", last: null, tone: " quiet" },
  ];
  return (
    <div className="lg-tiles" role="group" aria-label="Show only">
      {items.map((it) => (
        <button key={it.key ?? "all"} type="button" className={`lg-tile${it.tone}`} aria-pressed={pick === it.key} onClick={() => onPick(pick === it.key ? null : it.key)}>
          <span className="lg-tile-n num">{it.n}</span>
          <span className="lg-tile-label">{it.label}</span>
          {it.last != null && <span className="lg-tile-when">Last {lastWhen(it.last)}</span>}
        </button>
      ))}
    </div>
  );
}

/** "today", "yesterday" or "Nov 10": when a kind of event last happened. */
const lastWhen = (t: number) => { const d = dayName(t); return d === "Today" || d === "Yesterday" ? d.toLowerCase() : shortDay(t); };

/** One Windows event: when and what, opening in place to what Windows wrote. */
export function EventRow({ e, seconds }: { e: PCEvent; seconds?: boolean }) {
  const { pc, ask, data } = useApp();
  const [open, setOpen] = useState(false);
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  // A closed row keeps its words away from the keyboard and screen readers while it can still animate shut.
  useLayoutEffect(() => { const el = body.current!; if (open) el.removeAttribute("inert"); else el.setAttribute("inert", ""); }, [open]);
  const question = `Windows logged "${eventTitle(e)}" on ${pc.name} on ${shortDay(e.t)} at ${clock(e.t)} (${e.source}, event ${e.id}). What does it mean, and should I do anything?`;
  return (
    <li className={`ev-row${open ? " open" : ""}`}>
      <button type="button" className="ev-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <i className={`ev-dot${serious(e) ? " bad" : ""}`} aria-label={kindWord(e.kind)} role="img" />
        <span className="ev-title">{eventTitle(e)}</span>
        <span className="num faint ev-time">{seconds ? clockSec(e.t) : clock(e.t)}</span>
        <Icon d="M8 4l6 6-6 6" />
      </button>
      <div id={id} ref={body} className="ev-more">
        <div className="ev-more-in">
          {e.message && <p className="muted">{e.message}</p>}
          <p className="faint ev-src">{e.source} · event {e.id}</p>
          <button type="button" className="linkish ev-ask" disabled={data.answering} onClick={() => ask(question)}>Ask about this event</button>
        </div>
      </div>
    </li>
  );
}

/** Thirty days at a glance: one column per day, one dot per event. Each day is a button that filters the list to it. */
function Strip({ events, day, onDay: pickDay }: { events: PCEvent[]; day: number | null; onDay: (d: number | null) => void }) {
  const days = useMemo(() => {
    const today = dayStart(Date.now());
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - (DAYS - 1 - i));
      const from = d.getTime();
      return { from, list: events.filter((e) => onDay(e, from)) };
    });
  }, [events]);
  const selected = days.findIndex((d) => d.from === day);
  const [cursor, setCursor] = useState<number | null>(null);
  const [tip, setTip] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // A tap is a pick, not a hover: on touch the tip would stick after the finger lifts, and the scrolling strip clips it.
  const touched = useRef(false);
  const tabbable = cursor ?? (selected >= 0 ? selected : DAYS - 1);
  const tipId = useId();

  // One tab stop for the whole strip; the arrow keys walk the days.
  const move = (ev: KeyboardEvent, i: number) => {
    const to = ev.key === "ArrowLeft" ? i - 1 : ev.key === "ArrowRight" ? i + 1 : ev.key === "Home" ? 0 : ev.key === "End" ? DAYS - 1 : null;
    if (to == null) return;
    ev.preventDefault();
    const n = Math.max(0, Math.min(DAYS - 1, to));
    setCursor(n);
    refs.current[n]?.focus();
  };
  const shown = tip != null ? days[tip] : null;

  return (
    <div className={`ev-strip${selected >= 0 ? " picked" : ""}`} role="group" aria-label="Last 30 days" ref={(el) => { if (el && !el.dataset.scrolled) { el.dataset.scrolled = "1"; el.scrollLeft = el.scrollWidth; } }}>
      {days.map((d, i) => {
        const n = d.list.length;
        return (
          <button
            key={d.from}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            className="ev-day"
            tabIndex={i === tabbable ? 0 : -1}
            aria-pressed={i === selected}
            aria-label={`${shortDay(d.from)}, ${n === 0 ? "nothing logged" : n === 1 ? `1 event: ${eventTitle(d.list[0])}` : `${n} events`}`}
            aria-describedby={tip === i ? tipId : undefined}
            onClick={() => pickDay(i === selected ? null : d.from)}
            onKeyDown={(ev) => move(ev, i)}
            onPointerDown={(ev) => { touched.current = ev.pointerType !== "mouse"; }}
            onFocus={() => { setCursor(i); if (!touched.current) setTip(i); }}
            onBlur={() => { touched.current = false; setTip(null); }}
            onPointerEnter={(ev) => { if (ev.pointerType === "mouse") setTip(i); }}
            onPointerLeave={(ev) => { if (ev.pointerType === "mouse") setTip(null); }}
          >
            <span className="ev-dots">{d.list.slice(0, 4).map((e) => <i key={`${e.t}${e.source}${e.id}`} className={serious(e) ? "bad" : ""} />)}</span>
            <span className="ev-tick">{i === DAYS - 1 ? "Today" : i % 7 === 1 ? shortDay(d.from) : ""}</span>
          </button>
        );
      })}
      {shown && tip != null && (
        <div id={tipId} role="tooltip" className={`ev-tip${tip < 5 ? " start" : tip > DAYS - 6 ? " end" : ""}`} style={{ left: `${((tip + 0.5) / DAYS) * 100}%` }}>
          <b>{new Date(shown.from).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b>
          {shown.list.length === 0 ? <span className="faint">Nothing logged</span>
            : shown.list.slice(0, 3).map((e) => <span key={`${e.t}${e.source}${e.id}`}>{eventTitle(e)}</span>)}
          {shown.list.length > 3 && <span className="faint">and {shown.list.length - 3} more</span>}
        </div>
      )}
    </div>
  );
}

/** The strip and the events under it, day by day. `strip` is what the strip shows, `events` what the list shows. */
export function Events({ strip, events, day, onDay: pickDay, emptyText }: { strip: PCEvent[]; events: PCEvent[]; day: number | null; onDay: (d: number | null) => void; emptyText: string }) {
  const groups = useMemo(() => {
    const out: { day: string; list: PCEvent[] }[] = [];
    for (const e of events) { const name = dayName(e.t); if (out[out.length - 1]?.day === name) out[out.length - 1].list.push(e); else out.push({ day: name, list: [e] }); }
    return out;
  }, [events]);

  return (
    <div className="lg-events-body">
      <Strip events={strip} day={day} onDay={pickDay} />
      {groups.length === 0 ? <p className="muted lg-none">{emptyText}</p> : groups.map((g) => (
        <div key={g.day} className="ev-group">
          <div className="label">{g.day}</div>
          <ul className="ev-list">{g.list.map((e) => <EventRow key={`${e.t}${e.source}${e.id}`} e={e} />)}</ul>
        </div>
      ))}
    </div>
  );
}
