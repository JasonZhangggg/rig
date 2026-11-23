import type { CSSProperties } from "react";
import type { EveningDay, EveningSession, SessionKind, WeekEvenings } from "@rig/core";
import { CardHead, EmptyNote, Legend, hours, useGrowOnce, weekday, type LegendMark } from "./parts";

export type EveningsStyle = "pills" | "thin";

export interface EveningsOptions {
  style?: EveningsStyle;
  days?: number;
  background?: boolean;
  total?: boolean;
  legend?: boolean;
  /** A small tile: the hours in all and the games that took them. */
  compact?: boolean;
}

/** The axis shows at least six hours after 6 PM and stretches to the latest session, up to 6 AM. */
const MIN_HOURS = 6;
const MAX_HOURS = 12;

const kindText: Record<SessionKind, string> = { played: "", hot: ", ran hot", background: ", background task" };

const sixPm = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, 18));

/** A game's initials ("BG" for Baldur's Gate 3), so the badge stays two letters at most. */
export const initials = (game: string) => game.split(/[\s-]+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const Task = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;

const whatRan = (s: EveningSession) => s.game ?? (s.kind === "background" ? "Background task" : "Busy");

/** The original pill: the game's initials in a dark badge and the hours at its end. */
function Pill({ s, axis }: { s: EveningSession; axis: number }) {
  const what = whatRan(s);
  return (
    <span className={`pl-tl-pill ${s.kind}`} style={{ left: `${(s.start / axis) * 100}%`, width: `${(s.hours / axis) * 100}%` }} title={`${what}, ${hours(s.hours)} h${kindText[s.kind]}`}>
      <i aria-hidden="true">{s.game ? initials(s.game) || s.game[0] : <Task />}</i>
      <span className="sr-only">{what}{kindText[s.kind]}, </span>
      <b>{hours(s.hours)}<span className="sr-only"> hours</span>{s.kind === "hot" && <span className="warm-mark" aria-hidden="true"><svg viewBox="0 0 10 10" width="8" height="8"><path d="M5 1.5 9 8.5H1z" fill="currentColor" /></svg></span>}</b>
    </span>
  );
}

/** A thin bar per session with its game named above it. */
function Bar({ s, axis }: { s: EveningSession; axis: number }) {
  const what = whatRan(s);
  return (
    <span className={`pl-tl-bar ${s.kind}`} style={{ left: `${(s.start / axis) * 100}%`, width: `${(s.hours / axis) * 100}%` }} title={`${what}, ${hours(s.hours)} h${kindText[s.kind]}`}>
      <span className="pl-tl-label"><b>{hours(s.hours)} h</b> {what}{s.kind === "hot" && <span className="warm-mark" aria-hidden="true"><svg viewBox="0 0 10 10" width="8" height="8"><path d="M5 1.5 9 8.5H1z" fill="currentColor" /></svg></span>}<span className="sr-only">{kindText[s.kind]}</span></span>
    </span>
  );
}

/** One row per day with a mark for each session after 6 PM: where it started on the evening and how long it ran. */
function Timeline({ days, style, grow }: { days: EveningDay[]; style: EveningsStyle; grow: boolean }) {
  const end = Math.max(0, ...days.flatMap((d) => d.sessions.map((s) => s.start + s.hours)));
  const axis = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.ceil(end)));
  const Mark = style === "pills" ? Pill : Bar;
  return (
    <div className={`pl-tl${grow ? " grow" : ""}`} data-style={style} style={{ "--max": axis } as CSSProperties}>
      <ul className="pl-tl-rows">
        {days.map((d, i) => (
          <li key={d.day} className="pl-tl-row" style={{ "--i": i } as CSSProperties}>
            <span className="pl-tl-day">{weekday(d.day)}</span>
            <span className="pl-tl-lane">
              {d.sessions.map((s) => <Mark key={s.from} s={s} axis={axis} />)}
              {!d.sessions.length && <span className="sr-only">Nothing ran</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="pl-tl-axis" aria-hidden="true">
        <span />
        <span className="pl-tl-ticks">{Array.from({ length: axis + 1 }, (_, h) => <span key={h}>{h}</span>)}</span>
      </div>
    </div>
  );
}

/** The games that took the evenings, longest first. */
function Games({ days }: { days: EveningDay[] }) {
  const by = new Map<string, number>();
  for (const s of days.flatMap((d) => d.sessions)) if (s.kind !== "background") by.set(whatRan(s), (by.get(whatRan(s)) ?? 0) + s.hours);
  const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <ul className="pl-games">
      {top.map(([game, h]) => <li key={game}><i aria-hidden="true">{initials(game) || game[0]}</i><span>{game}</span><b>{hours(h)} h</b></li>)}
    </ul>
  );
}

/** The week's evenings. `week` is null while history loads; `recorded` says whether the PC has any history this week. */
export function WeekCard({ week, recorded, name, style = "pills", days: count = 7, background = true, total = true, legend = true, compact = false }: { week: WeekEvenings | null; recorded: boolean; name: string } & EveningsOptions) {
  const grow = useGrowOnce(`home-week-${style}`);
  const days = (week?.days ?? []).slice(-Math.max(1, count)).map((d) => (background ? d : { ...d, sessions: d.sessions.filter((s) => s.kind !== "background") }));
  const any = days.some((d) => d.sessions.length);
  const sum = days.flatMap((d) => d.sessions).filter((s) => s.kind !== "background").reduce((n, s) => n + s.hours, 0);
  const key: [LegendMark, string][] = [["a", "Played"], ["b", "Ran hot"], ...(background ? [["c", "Background task"] as [LegendMark, string]] : [])];
  return (
    <section className={`f-pane bl-week${compact ? " compact" : ""}`} aria-busy={!week || undefined}>
      <CardHead title="Evenings" note={count === 7 ? `Hours after ${sixPm}` : `Hours after ${sixPm}, last ${count} days`} figure={(total || compact) && any ? { value: `${hours(sum)} h`, label: "In all" } : undefined} />
      {!week && <div className="pl-wait" aria-hidden="true" />}
      {week && (any ? (
        compact ? <Games days={days} /> : (
          <>
            <Timeline days={days} style={style} grow={grow} />
            {legend && <Legend items={key} />}
          </>
        )
      ) : (
        <EmptyNote>{recorded
          ? `Nothing ran on ${name} after ${sixPm} ${count === 7 ? "this week" : "these days"}.`
          : `Rig is still learning this week. Evenings you play or leave ${name} working show up here.`}</EmptyNote>
      ))}
    </section>
  );
}
