import type { CSSProperties } from "react";
import type { EveningSession, SessionKind, WeekEvenings } from "@rig/core";
import { CardHead, EmptyNote, Legend, hours, useGrowOnce, weekday } from "./parts";

/** The axis shows at least six hours after 6 PM and stretches to the latest session, up to 6 AM. */
const MIN_HOURS = 6;
const MAX_HOURS = 12;

const kindText: Record<SessionKind, string> = { played: "", hot: ", ran hot", background: ", background task" };

const sixPm = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, 18));

/** A game's initials ("BG" for Baldur's Gate 3), so the badge stays two letters at most. */
export const initials = (game: string) => game.split(/[\s-]+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const Task = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;

function Bar({ s, axis }: { s: EveningSession; axis: number }) {
  const what = s.game ?? (s.kind === "background" ? "Background task" : "Busy");
  return (
    <span className={`pl-tl-bar ${s.kind}`} style={{ left: `${(s.start / axis) * 100}%`, width: `${(s.hours / axis) * 100}%` }} title={`${what}, ${hours(s.hours)} h${kindText[s.kind]}`}>
      <i aria-hidden="true">{s.game ? initials(s.game) || s.game[0] : <Task />}</i>
      <span className="sr-only">{what}{kindText[s.kind]}, </span>
      <b>{hours(s.hours)}<span className="sr-only"> hours</span></b>
    </span>
  );
}

/** One row per day with a bar for each session after 6 PM: where it started on the evening and how long it ran. */
function Timeline({ week, grow }: { week: WeekEvenings; grow: boolean }) {
  const end = Math.max(0, ...week.days.flatMap((d) => d.sessions.map((s) => s.start + s.hours)));
  const axis = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.ceil(end)));
  return (
    <div className={`pl-tl${grow ? " grow" : ""}`} style={{ "--max": axis } as CSSProperties}>
      <ul className="pl-tl-rows">
        {week.days.map((d, i) => (
          <li key={d.day} className="pl-tl-row" style={{ "--i": i } as CSSProperties}>
            <span className="pl-tl-day">{weekday(d.day)}</span>
            <span className="pl-tl-lane">
              {d.sessions.map((s) => <Bar key={s.from} s={s} axis={axis} />)}
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

/** The week's evenings. `week` is null while history loads; `recorded` says whether the PC has any history this week. */
export function WeekCard({ week, recorded, name }: { week: WeekEvenings | null; recorded: boolean; name: string }) {
  const grow = useGrowOnce("home-week");
  const any = !!week?.days.some((d) => d.sessions.length);
  return (
    <section className="f-card bl-week">
      <CardHead title="This week" note={`Hours after ${sixPm}`} />
      {week && (any ? (
        <>
          <Timeline week={week} grow={grow} />
          <Legend items={[["a", "Played"], ["b", "Ran hot"], ["c", "Background task"]]} total={["Total", `${hours(week.hours)} h`]} />
        </>
      ) : (
        <EmptyNote>{recorded
          ? `Nothing ran on ${name} after ${sixPm} this week.`
          : `Rig is still learning this week. Evenings you play or leave ${name} working show up here.`}</EmptyNote>
      ))}
    </section>
  );
}
