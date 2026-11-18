// Small SVG charts drawn with theme colors (CSS variables), no chart library.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatTemp, toUnit, type HistoryPoint } from "@rig/core";
import { useTempUnit } from "./state";

/** The element's width in CSS pixels, so a chart draws at its real size and its text isn't stretched. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { if (el.clientWidth) setW(el.clientWidth); };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Sparkline({ values, w = 120, h = 32, warn = false }: { values: number[]; w?: number; h?: number; warn?: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg className={`spark${warn ? " warn" : ""}`} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`${d} L${w},${h} L0,${h} Z`} className="spark-fill" />
      <path d={d} className="spark-line" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} className="spark-dot" />
    </svg>
  );
}

const clock = (t: number, seconds = false) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });

interface LineChartProps {
  points: HistoryPoint[];
  /** Each line: the reading it draws, its color class, and its name in the readout (Processor or Graphics card by default). */
  series: { key: "cpu" | "gpu"; cls: string; name?: string }[];
  w?: number; h?: number;
  limit?: { v: number; label: string };
  bands?: boolean;
  /** Load in percent rather than temperatures in Celsius. */
  percent?: boolean;
  label?: string;
  /** Moments to point out: a numbered line, or a shaded stretch when it has an end. */
  marks?: { t: number; until?: number; n: number; strong?: boolean }[];
  /** A moment to hold the readout at, until the pointer or keys move it. */
  pin?: number | null;
  /** Escape dismissed the readout, so whatever pinned it can let go. */
  onUnpin?: () => void;
}

const seriesName = (k: "cpu" | "gpu") => (k === "gpu" ? "Graphics card" : "Processor");

/** The index of the reading nearest to t, in points sorted by time. */
function nearest(points: readonly HistoryPoint[], t: number) {
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid; else hi = mid;
  }
  return Math.abs(points[hi].t - t) < Math.abs(points[lo].t - t) ? hi : lo;
}

/** A message in the chart's place, the same size, so the page doesn't jump when the chart arrives. */
export function ChartNote({ children, busy }: { children: string; busy?: boolean }) {
  return <div className="chart chart-empty" role="status" aria-busy={busy || undefined}><p className="muted">{children}</p></div>;
}

/** Temperatures (in the viewer's unit) or load over time, with shaded busy periods. Gaps where the PC was off stay empty. */
export function LineChart(props: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>(props.w ?? 860);
  return (
    <div ref={ref}>
      {props.points.length < 2 ? <ChartNote>Not enough readings yet. Rig logs temperatures every minute while it runs.</ChartNote> : <LineChartSvg {...props} w={width} />}
    </div>
  );
}

function LineChartSvg({ points, series, w = 860, h = 300, limit, bands, percent = false, label = "Temperature history", marks = [], pin = null, onUnpin }: LineChartProps) {
  const unit = useTempUnit();
  // The moment the readout shows: where the pointer or keys put it, else the pinned moment, else none.
  const [at, setAt] = useState<number | null>(pin);
  useEffect(() => setAt(pin), [pin]);
  const cv = (c: number) => (percent ? c : toUnit(c, unit));
  const step = percent ? 25 : unit === "f" ? 20 : 10;
  const pad = { l: 40, r: 16, t: 14, b: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const vals = points.flatMap((p) => series.map((s) => p[s.key])).filter((v): v is number => v != null).map(cv);
  const yMin = percent ? 0 : Math.min(Math.floor(cv(30) / step) * step, Math.floor(Math.min(...vals) / step) * step);
  const yMax = percent ? 104 : Math.max(limit ? cv(limit.v) + 5 : 0, Math.ceil(Math.max(...vals) / step) * step + 5);
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const gap = ((t1 - t0) / points.length) * 3;

  const bandRects: [number, number][] = [];
  if (bands) {
    let start: number | null = null;
    points.forEach((p, i) => {
      if (p.busy && start === null) start = p.t;
      if ((!p.busy || i === points.length - 1) && start !== null) { bandRects.push([start, p.t]); start = null; }
    });
  }
  const grid: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) grid.push(v);
  // Numbers of moments that sit close together step down so each stays readable.
  let lastX = -Infinity, row = 0;
  const labelled = [...marks].filter((m) => m.t >= t0 && m.t <= t1).sort((a, b) => a.t - b.t).map((m) => {
    row = x(m.t) - lastX < 18 ? row + 1 : 0;
    lastX = x(m.t);
    return { ...m, row };
  });
  const span = t1 - t0;
  const day = 864e5;
  const ticks: { t: number; label: string }[] = [];
  if (span <= 2 * 36e5) {
    const every = (span <= 20 * 60_000 ? 5 : span <= 70 * 60_000 ? 10 : 30) * 60_000;
    for (let t = Math.ceil(t0 / every) * every; t <= t1; t += every) ticks.push({ t, label: clock(t) });
  } else if (span <= 8 * 36e5) {
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    if (first.getTime() < t0) first.setHours(first.getHours() + 1);
    for (let t = first.getTime(); t <= t1; t += 36e5) ticks.push({ t, label: new Date(t).toLocaleTimeString(undefined, { hour: "numeric" }) });
  } else if (span <= 1.5 * day) {
    for (let t = Math.ceil(t0 / (6 * 36e5)) * 6 * 36e5; t <= t1; t += 6 * 36e5) ticks.push({ t, label: new Date(t).toLocaleTimeString(undefined, { hour: "numeric" }) });
  } else {
    const every = span > 10 * day ? 5 : 1;
    const first = new Date(t0); first.setHours(24, 0, 0, 0);
    for (let t = first.getTime(), i = 0; t <= t1; t += day, i++) if (i % every === 0) ticks.push({ t, label: new Date(t).toLocaleDateString(undefined, every === 1 ? { weekday: "short" } : { month: "short", day: "numeric" }) });
  }
  // A short stretch with few readings may hold no round times, so its start and end are labelled instead.
  if (ticks.length < 2) ticks.splice(0, ticks.length, { t: t0, label: clock(t0, span < 10 * 60_000) }, { t: t1, label: clock(t1, span < 10 * 60_000) });
  const path = (k: "cpu" | "gpu") => {
    let d = "", prev: HistoryPoint | null = null;
    for (const p of points) {
      const v = p[k];
      if (v == null) { prev = null; continue; }
      d += `${!prev || p.t - prev.t > gap ? "M" : "L"}${x(p.t).toFixed(1)},${y(cv(v)).toFixed(1)}`;
      prev = p;
    }
    return d;
  };

  const fmt = (v: number | null | undefined) => (v == null ? "–" : percent ? `${Math.round(v)}%` : formatTemp(v, unit));
  const whenText = (t: number) => span < 10 * 60_000 ? clock(t, true) : span <= 1.5 * day ? clock(t)
    : new Date(t).toLocaleString(undefined, span > 10 * day ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
  const cur = at == null ? null : points[nearest(points, at)];
  const cx = cur ? x(cur.t) : 0;
  const readout = cur ? `${whenText(cur.t)}: ${series.map((s) => `${s.name ?? seriesName(s.key)} ${fmt(cur[s.key])}`).join(", ")}` : "";

  /** The moment under the pointer, from where it sits across the plot. */
  const pointerT = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return null;
    const px = (e.clientX - r.left) * (w / r.width);
    return t0 + ((px - pad.l) / (iw || 1)) * (t1 - t0);
  };
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const t = pointerT(e);
    if (t != null) setAt(t);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = points.length - 1, by = e.shiftKey ? 10 : 1;
    const i = at == null ? null : nearest(points, at);
    let next: number;
    if (e.key === "ArrowRight") next = i == null ? 0 : Math.min(last, i + by);
    else if (e.key === "ArrowLeft") next = i == null ? last : Math.max(0, i - by);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape" && at != null) { e.preventDefault(); setAt(null); onUnpin?.(); return; }
    else return;
    e.preventDefault();
    setAt(points[next].t);
  };

  return (
    <div className="chart-box">
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} style={{ height: h }} role="img" aria-label={label} tabIndex={0}
        onPointerMove={onPointer} onPointerDown={onPointer}
        onPointerLeave={(e) => { if (e.pointerType !== "touch") setAt(pin); }}
        onBlur={() => setAt(pin)} onKeyDown={onKey}>
        {marks.filter((m) => m.until != null).map((m) => <rect key={`s${m.n}`} x={x(m.t)} y={pad.t} width={Math.max(2, x(m.until!) - x(m.t))} height={ih} className="chart-band chart-span" />)}
        {bandRects.map(([a, b]) => <rect key={a} x={x(a)} y={pad.t} width={Math.max(2, x(b) - x(a))} height={ih} className="chart-band" />)}
        {grid.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={pad.l - 8} y={y(v) + 4} className="chart-tick" textAnchor="end">{v}{percent ? "%" : "°"}</text>
          </g>
        ))}
        {ticks.map((k) => <text key={k.t} x={x(k.t)} y={h - 8} className="chart-tick" textAnchor={k.t === t0 ? "start" : k.t === t1 ? "end" : "middle"}>{k.label}</text>)}
        {limit && (
          <>
            <line x1={pad.l} x2={w - pad.r} y1={y(cv(limit.v))} y2={y(cv(limit.v))} className="chart-limit" />
            <text x={w - pad.r - 4} y={y(cv(limit.v)) - 6} className="chart-tick chart-limit-label" textAnchor="end">{limit.label}</text>
          </>
        )}
        {series.map((s) => <path key={s.key} d={path(s.key)} className={`chart-line ${s.cls}`} vectorEffect="non-scaling-stroke" />)}
        {labelled.map((m) => (
          <g key={m.n} className={`chart-mark${m.strong ? " strong" : ""}`}>
            {m.until == null && <line x1={x(m.t)} x2={x(m.t)} y1={pad.t} y2={pad.t + ih} vectorEffect="non-scaling-stroke" />}
            <text x={x(m.t)} y={pad.t + 12 + m.row * 15} textAnchor={m.until == null ? "middle" : "start"} dx={m.until == null ? 0 : 5}>{m.n}</text>
          </g>
        ))}
        {cur && (
          <g className="chart-cross" aria-hidden="true">
            <line x1={cx} x2={cx} y1={pad.t} y2={pad.t + ih} vectorEffect="non-scaling-stroke" />
            {series.map((s) => cur[s.key] != null && <circle key={s.key} cx={cx} cy={y(cv(cur[s.key]!))} r={4} className={`chart-dot ${s.cls}`} />)}
          </g>
        )}
      </svg>
      {cur && (
        <div className={`chart-tip${cx > w * .6 ? " flip" : ""}`} style={{ left: `${(cx / w) * 100}%`, top: pad.t }} aria-hidden="true">
          <span className="chart-tip-when">{whenText(cur.t)}</span>
          {series.map((s) => (
            <span key={s.key} className="chart-tip-row">
              <svg width={14} height={4} aria-hidden="true"><line x1={1} x2={13} y1={2} y2={2} className={`chart-line ${s.cls}`} /></svg>
              {s.name ?? seriesName(s.key)}<b className="num">{fmt(cur[s.key])}</b>
            </span>
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{readout}</p>
    </div>
  );
}
