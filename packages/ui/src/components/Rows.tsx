import { createContext, useContext, useId, useState, type ReactNode } from "react";

/** Set around a row that arrived while its list was on screen, like a new entry in the live log, so it shows as new for a moment. */
export const FreshCtx = createContext(false);

/**
 * Lists, the way the Changes page shows them: one item per line, with a time on the left, a bold title and one grey
 * line under it, a figure or the buttons on the right, and the rest behind Details. The rules are in docs/design.md.
 */

/** The heading over one day's rows: the day, then how many. */
export function DayLabel({ day, count, one, many }: { day: string; count: number; one: string; many: string }) {
  return <p className="rows-day">{day}<span>{count === 1 ? `1 ${one}` : `${count} ${many}`}</span></p>;
}

/** The dot beside a row on a timeline: a filled dot, one that needs a look, or an empty one for something undone. */
export type Mark = "dot" | "look" | "hollow";
const markClass: Record<Mark, string> = { dot: "", look: " mark-look", hollow: " mark-hollow" };

export interface RowProps {
  /** On the left, in a column of its own. */
  time?: ReactNode;
  /** The `datetime` for the time, when there is one. */
  at?: string;
  mark?: Mark;
  /** What a screen reader says the mark means. */
  markLabel?: string;
  title: ReactNode;
  /** A chip after the title, for the one thing that's out of the ordinary. */
  tag?: ReactNode;
  /** The one grey line: who, how long, or what happened. */
  meta?: ReactNode;
  /** A figure on the right, like a temperature, with its word under it: a RowFigure. */
  figure?: ReactNode;
  /** The row's own button, after Details. */
  action?: ReactNode;
  /** What Details opens in place. */
  details?: ReactNode;
  /** Names the row in its Details button, "Details: <name>". */
  name: string;
  /** A row that shows its item somewhere else on the page, like on a chart: pressing it picks it. */
  pick?: { pressed: boolean; onPick: () => void };
  /** It just arrived in a list that's on screen. */
  fresh?: boolean;
}

export function Row({ time, at, mark, markLabel, title, tag, meta, figure, action, details, name, pick, fresh: freshProp }: RowProps) {
  const [open, setOpen] = useState(false);
  const fresh = useContext(FreshCtx) || freshProp;
  const id = useId();
  const main = (
    <>
      {time != null && <time className="row-time num" dateTime={at}>{time}</time>}
      <span className="row-body">
        <span className="row-title"><span>{title}</span>{tag}</span>
        {meta != null && <span className="row-meta">{meta}</span>}
      </span>
      {figure}
    </>
  );
  return (
    <li className={`row${mark ? markClass[mark] : ""}${time != null ? " has-time" : ""}${open ? " open" : ""}${fresh ? " row-new" : ""}`}>
      {mark && markLabel && <span className="sr-only">{markLabel}</span>}
      {pick
        ? <button type="button" className="row-main row-pick" aria-pressed={pick.pressed} onClick={pick.onPick}>{main}</button>
        : <div className="row-main">{main}</div>}
      {(details != null || action) && (
        <div className="row-acts">
          {details != null && <button type="button" className="btn ghost sm" aria-expanded={open} aria-controls={id} aria-label={`Details: ${name}`} onClick={() => setOpen(!open)}>{open ? "Hide" : "Details"}</button>}
          {action}
        </div>
      )}
      {details != null && <div id={id} className="row-more" hidden={!open}>{details}</div>}
    </li>
  );
}

/** A figure on the right of a row, with its word under it. */
export function RowFigure({ value, word, look }: { value: ReactNode; word: ReactNode; look?: boolean }) {
  return <span className={`row-fig${look ? " look" : ""}`}><b className="num">{value}</b><span>{word}</span></span>;
}

/** The rows themselves. A timeline draws a dot per row and a line joining them. */
export function Rows({ label, timeline, children }: { label?: string; timeline?: boolean; children: ReactNode }) {
  return <ul className={`rows${timeline ? " timeline" : ""}`} aria-label={label}>{children}</ul>;
}
