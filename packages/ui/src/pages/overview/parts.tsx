import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

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

const MEASURING = Infinity;

/**
 * How many of a list's items fit in its box whole, so a small tile drops a row rather than cut one in half.
 * The list's parent should keep its size whatever the list holds (the tile does). Every item shows where nothing
 * measures (a phone's natural height list, or no ResizeObserver). `reserve` keeps room, in CSS pixels, for a "more" row.
 */
export function useFit<T extends HTMLElement>(count: number, { on = true, reserve = 0, min = 1, watch = "" }: { on?: boolean; reserve?: number; min?: number; watch?: string } = {}) {
  const ref = useRef<T>(null);
  const [fit, setFit] = useState(MEASURING);
  const can = on && typeof ResizeObserver !== "undefined";
  const again = useCallback(() => setFit(MEASURING), []);
  useLayoutEffect(again, [count, watch, can, again]);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!can || !host) return;
    let w = -1, h = -1;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width === w && height === h) return;
      w = width; h = height;
      flushSync(again);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [can, again]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (fit !== MEASURING || !el || !can) return;
    const box = el.getBoundingClientRect();
    // Rects are in zoomed pixels under Settings' text size; the reserve is in CSS pixels.
    const zoom = el.offsetHeight ? box.height / el.offsetHeight : 1;
    const rects = [...el.children].filter((c) => !(c as HTMLElement).dataset.more).map((c) => c.getBoundingClientRect());
    // The room is the list's box inside its parent's. A list set to the bottom overflows at the top, so then it counts from the first item.
    const host = el.parentElement?.getBoundingClientRect() ?? box;
    const top = Math.max(box.top, host.top), bottom = Math.min(box.bottom, host.bottom);
    const start = rects.length && rects[0].top < top ? rects[0].top : top;
    const room = (r: DOMRect, keep: number) => r.bottom - start <= bottom - top - keep * zoom + 1;
    if (rects.every((r) => room(r, 0))) { setFit(count); return; }
    let k = 0;
    while (k < rects.length && room(rects[k], reserve)) k++;
    setFit(Math.max(Math.min(min, count), k));
  }, [fit, can, count, reserve, min]);
  return [ref, fit === MEASURING || !can ? count : Math.min(fit, count)] as const;
}
