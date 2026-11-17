import { useEffect, useState, type ReactNode } from "react";

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** A day's short name in the viewer's language, from the local midnight that starts it. */
export const weekday = (day: number) => weekdayFmt.format(day);
export const longWeekday = (day: number) => longDayFmt.format(day);
export const hours = (h: number) => oneDecimal.format(h);

const grown = new Set<string>();

/** True the first time a chart shows in this session, so it grows in once and then just appears. */
export function useGrowOnce(key: string) {
  const [grow] = useState(() => !grown.has(key));
  useEffect(() => { grown.add(key); }, [key]);
  return grow;
}

export type LegendMark = "a" | "b" | "c";

export function Legend({ items, total }: { items: [LegendMark, string][]; total?: ReactNode }) {
  return (
    <div className="pl-legend">
      {items.map(([mark, text]) => <span key={text}><i className={mark} />{text}</span>)}
      {total && <span className="pl-total">{total}</span>}
    </div>
  );
}

/** A pane's title and note, with its headline number large on the right when there is one. */
export const CardHead = ({ title, note, figure }: { title: string; note?: string; figure?: { value: string; label: string; tone?: "look" } }) => (
  <div className="pl-head">
    <div><h3>{title}</h3>{note && <span className="f-faint">{note}</span>}</div>
    {figure && <div className={`pl-figure${figure.tone ? ` ${figure.tone}` : ""}`}><b>{figure.value}</b><span>{figure.label}</span></div>}
  </div>
);

export const EmptyNote = ({ children }: { children: ReactNode }) => <p className="bl-empty">{children}</p>;
