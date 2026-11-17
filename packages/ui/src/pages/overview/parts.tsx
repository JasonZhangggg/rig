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

export function Legend({ items, total }: { items: [LegendMark, string][]; total?: [string, string] }) {
  return (
    <div className="pl-legend">
      {items.map(([mark, text]) => <span key={text}><i className={mark} />{text}</span>)}
      {total && <span className="pl-total">{total[0]} <b>{total[1]}</b></span>}
    </div>
  );
}

export const CardHead = ({ title, note }: { title: string; note?: string }) => (
  <div className="f-card-head"><span>{title}</span>{note && <span className="f-faint">{note}</span>}</div>
);

export const EmptyNote = ({ children }: { children: ReactNode }) => <p className="bl-empty">{children}</p>;
