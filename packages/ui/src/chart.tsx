// Small SVG charts drawn with theme colors (CSS variables), no chart library.
import { useLayoutEffect, useRef, useState } from "react";
import type { HistoryPoint } from "@rig/core";

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

interface LineChartProps {
  points: HistoryPoint[];
  series: { key: "cpu" | "gpu"; cls: string }[];
  w?: number; h?: number;
  limit?: { v: number; label: string };
  bands?: boolean;
}

/** A message in the chart's place, the same size, so the page doesn't jump when the chart arrives. */
export function ChartNote({ children, busy }: { children: string; busy?: boolean }) {
  return <div className="chart chart-empty" role="status" aria-busy={busy || undefined}><p className="muted">{children}</p></div>;
}

/** Temperatures over time with shaded busy periods. Gaps where the PC was off stay empty. */
export function LineChart(props: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>(props.w ?? 860);
  return (
    <div ref={ref}>
      {props.points.length < 2 ? <ChartNote>Not enough readings yet. Rig logs temperatures every minute while it runs.</ChartNote> : <LineChartSvg {...props} w={width} />}
    </div>
  );
}

function LineChartSvg({ points, series, w = 860, h = 300, limit, bands }: LineChartProps) {
  const pad = { l: 40, r: 16, t: 14, b: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const vals = points.flatMap((p) => series.map((s) => p[s.key])).filter((v): v is number => v != null);
  const yMin = Math.min(30, Math.floor(Math.min(...vals) / 10) * 10);
  const yMax = Math.max(limit ? limit.v + 5 : 0, Math.ceil(Math.max(...vals) / 10) * 10 + 5);
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
  for (let v = Math.ceil(yMin / 10) * 10; v <= yMax; v += 10) grid.push(v);
  const span = t1 - t0;
  const day = 864e5;
  const ticks: { t: number; label: string }[] = [];
  if (span <= 8 * 36e5) {
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
  const path = (k: "cpu" | "gpu") => {
    let d = "", prev: HistoryPoint | null = null;
    for (const p of points) {
      const v = p[k];
      if (v == null) { prev = null; continue; }
      d += `${!prev || p.t - prev.t > gap ? "M" : "L"}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      prev = p;
    }
    return d;
  };

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Temperature history">
      {bandRects.map(([a, b]) => <rect key={a} x={x(a)} y={pad.t} width={Math.max(2, x(b) - x(a))} height={ih} className="chart-band" />)}
      {grid.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
          <text x={pad.l - 8} y={y(v) + 4} className="chart-tick" textAnchor="end">{v}°</text>
        </g>
      ))}
      {ticks.map((k) => <text key={k.t} x={x(k.t)} y={h - 8} className="chart-tick" textAnchor="middle">{k.label}</text>)}
      {limit && (
        <>
          <line x1={pad.l} x2={w - pad.r} y1={y(limit.v)} y2={y(limit.v)} className="chart-limit" />
          <text x={w - pad.r - 4} y={y(limit.v) - 6} className="chart-tick chart-limit-label" textAnchor="end">{limit.label}</text>
        </>
      )}
      {series.map((s) => <path key={s.key} d={path(s.key)} className={`chart-line ${s.cls}`} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}
