import type { CSSProperties } from "react";
import type { EveningSession, SessionKind, WeekEvenings } from "@rig/core";
import { CardHead, EmptyNote, Legend, hours, useGrowOnce, weekday } from "./parts";

/** The axis shows at least six hours after 6 PM and stretches to the latest session in steps of two, up to 6 AM. */
const MIN_HOURS = 6;
const MAX_HOURS = 12;

const kindText: Record<SessionKind, string> = { played: "", hot: ", ran hot", background: ", background task" };

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
/** The clock time `h` hours after 6 PM. */
const tick = (h: number) => clock.format(new Date(2000, 0, 1, 18 + h));
const sixPm = tick(0);

/** A game's initials ("BG" for Baldur's Gate 3), so a badge stays two letters at most. */
export const initials = (game: string) => game.split(/[\s-]+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** `room` is how many hours the label may run before the next session or the axis end, so a short session keeps its name. */
function Bar({ s, axis, room }: { s: EveningSession; axis: number; room: number }) {
  const what = s.game ?? (s.kind === "background" ? "Background task" : "Busy");
  return (
    <span className={`pl-tl-bar ${s.kind}`} style={{ left: `${(s.start / axis) * 100}%`, width: `${(s.hours / axis) * 100}%`, "--room": `${(room / s.hours) * 100}%` } as CSSProperties} title={`${what}, ${hours(s.hours)} h${kindText[s.kind]}`}>
      <span className="pl-tl-what">{what}<span className="sr-only">{kindText[s.kind]}, </span> <b>{hours(s.hours)}<span aria-hidden="true"> h</span><span className="sr-only"> hours</span></b></span>
      <i aria-hidden="true" />
    </span>
  );
}

/** One row per day with a thin bar for each session after 6 PM: where it started on the evening and how long it ran. */
function Timeline({ week, grow }: { week: WeekEvenings; grow: boolean }) {
  const end = Math.max(0, ...week.days.flatMap((d) => d.sessions.map((s) => s.start + s.hours)));
  const axis = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.ceil(end / 2) * 2));
  const ticks = Array.from({ length: axis / 2 + 1 }, (_, k) => k * 2);
  return (
    <div className={`pl-tl${grow ? " grow" : ""}`} style={{ "--max": axis / 2 } as CSSProperties}>
      <ul className="pl-tl-rows">
        {week.days.map((d, i) => (
          <li key={d.day} className="pl-tl-row" style={{ "--i": i } as CSSProperties}>
            <span className="pl-tl-day">{weekday(d.day)}</span>
            <span className="pl-tl-lane">
              {d.sessions.map((s, k) => <Bar key={s.from} s={s} axis={axis} room={(d.sessions[k + 1]?.start ?? axis) - s.start} />)}
              {!d.sessions.length && <span className="sr-only">Nothing ran</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="pl-tl-axis" aria-hidden="true">
        <span />
        <span className="pl-tl-ticks">{ticks.map((h) => <span key={h} style={{ left: `${(h / axis) * 100}%` }}>{tick(h)}</span>)}</span>
      </div>
    </div>
  );
}

/** The week's evenings. `week` is null while history loads; `recorded` says whether the PC has any history this week. */
export function WeekCard({ week, recorded, name }: { week: WeekEvenings | null; recorded: boolean; name: string }) {
  const grow = useGrowOnce("home-week");
  const any = !!week?.days.some((d) => d.sessions.length);
  return (
    <section className="f-pane bl-week">
      <CardHead title="Evenings" note={`Hours after ${sixPm}`} figure={any && week ? { value: `${hours(week.hours)} h`, label: "In all" } : undefined} />
      {week && (any ? (
        <>
          <Timeline week={week} grow={grow} />
          <Legend items={[["a", "Played"], ["b", "Ran hot"], ["c", "Background task"]]} />
        </>
      ) : (
        <EmptyNote>{recorded
          ? `Nothing ran on ${name} after ${sixPm} this week.`
          : `Rig is still learning this week. Evenings you play or leave ${name} working show up here.`}</EmptyNote>
      ))}
    </section>
  );
}
