import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

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

export function Legend({ items, children }: { items: [LegendMark, string][]; children?: ReactNode }) {
  return (
    <div className="pl-legend">
      {items.map(([mark, text]) => <span key={text}><i className={mark} />{text}</span>)}
      {children}
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

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

/** A round axis from `lo` to `hi` with at most `most` steps, so the tick labels read as plain numbers. */
export function scale(lo: number, hi: number, most = 5, floor = true) {
  const step = STEPS.find((s) => (hi - lo) / s <= most) ?? STEPS[STEPS.length - 1];
  const from = floor ? Math.max(0, Math.floor(lo / step) * step - step) : 0;
  const to = Math.max(from + step, Math.ceil(hi / step) * step);
  const ticks = Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
  return { from, to, ticks, at: (v: number) => (v - from) / (to - from) };
}

/** Tick labels up the left of a plot and the matching rules across it. Both are decoration: the chart's own label says the numbers. */
export function YAxis({ ticks, at, format }: { ticks: number[]; at: (v: number) => number; format: (v: number) => string }) {
  return (
    <>
      <div className="pl-y" aria-hidden="true">{ticks.map((t) => <span key={t} style={{ "--y": at(t) } as CSSProperties}>{format(t)}</span>)}</div>
      <div className="pl-rules" aria-hidden="true">{ticks.map((t) => <i key={t} style={{ "--y": at(t) } as CSSProperties} />)}</div>
    </>
  );
}
