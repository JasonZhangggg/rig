// Small SVG charts drawn with theme colors (CSS variables), no chart library.
import { useLayoutEffect, useRef, useState } from "react";
import type { HistoryPoint } from "./data";

export function Sparkline({ values, w = 120, h = 32, warn = false }: { values: number[]; w?: number; h?: number; warn?: boolean }) {
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
  w?: number; h?: number; yMin?: number; yMax?: number;
  limit?: { v: number; label: string };
  bands?: boolean;
}

const dayNames = ["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Today"];

// Multi-series line chart over hourly points, with shaded gaming sessions.
export function LineChart({ points, series, w = 860, h = 280, yMin = 30, yMax = 95, limit, bands }: LineChartProps) {
  const pad = { l: 40, r: 16, t: 14, b: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const n = points.length - 1;
  const x = (i: number) => pad.l + (i / n) * iw;
  const y = (v: number) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const bandRects: [number, number][] = [];
  if (bands) {
    let start: number | null = null;
    points.forEach((p, i) => {
      if (p.gaming && start === null) start = i;
      if ((!p.gaming || i === n) && start !== null) { bandRects.push([start, i]); start = null; }
    });
  }
  const grid: number[] = [];
  for (let v = Math.ceil(yMin / 10) * 10; v <= yMax; v += 10) grid.push(v);
  const days = Math.round(n / 24);

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Temperature history">
      {bandRects.map(([a, b]) => <rect key={a} x={x(a)} y={pad.t} width={Math.max(2, x(b) - x(a))} height={ih} className="chart-band" />)}
      {grid.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
          <text x={pad.l - 8} y={y(v) + 4} className="chart-tick" textAnchor="end">{v}°</text>
        </g>
      ))}
      {Array.from({ length: days + 1 }, (_, d) => (
        <text key={d} x={x(d * 24)} y={h - 8} className="chart-tick" textAnchor={d === 0 ? "start" : d === days ? "end" : "middle"}>
          {dayNames[d + (7 - days)] ?? ""}
        </text>
      ))}
      {limit && (
        <>
          <line x1={pad.l} x2={w - pad.r} y1={y(limit.v)} y2={y(limit.v)} className="chart-limit" />
          <text x={w - pad.r - 4} y={y(limit.v) - 6} className="chart-tick chart-limit-label" textAnchor="end">{limit.label}</text>
        </>
      )}
      {series.map((s) => (
        <path key={s.key} d={points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join("")} className={`chart-line ${s.cls}`} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

// Smooth path through points (Catmull-Rom turned into cubic Beziers).
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

interface WeekChartProps {
  points: HistoryPoint[];
  names: { cpu: string; gpu: string };
  w?: number; h?: number; bucket?: number; limit?: number;
}

// Week of temperatures as soft areas, with a callout on the hottest moment.
// Fills its box: measures it and draws at true pixel size so text never stretches.
export function WeekChart(props: WeekChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([1000, 320]);
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setSize(([pw, ph]) => (pw === w && ph === h ? [pw, ph] : [w, Math.max(h, 220)]));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div className="wchart-box" ref={ref}><WeekChartSvg {...props} w={size[0]} h={size[1]} /></div>;
}

function WeekChartSvg({ points, names, w = 1000, h = 320, bucket = 2, limit = 90 }: WeekChartProps) {
  const b: { cpu: number; gpu: number; h: number }[] = [];
  for (let i = 0; i < points.length; i += bucket) {
    const s = points.slice(i, i + bucket);
    b.push({ h: s[0].h, cpu: s.reduce((a, p) => a + p.cpu, 0) / s.length, gpu: s.reduce((a, p) => a + p.gpu, 0) / s.length });
  }
  const pad = { l: 36, r: 12, t: 58, b: 30 };
  const yMin = 30, yMax = 95;
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / (b.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const line = (k: "cpu" | "gpu") => smooth(b.map((p, i) => [x(i), y(p[k])]));
  const area = (k: "cpu" | "gpu") => `${line(k)} L${x(b.length - 1)},${pad.t + ih} L${pad.l},${pad.t + ih} Z`;
  const days = Math.round((points.length - 1) / 24);
  // Hottest moment in the last day
  const lastDay = b.filter((p) => p.h >= (days - 1) * 24);
  const peak = lastDay.reduce((a, p) => (p.gpu > a.gpu ? p : a), lastDay[0]);
  const pi = b.indexOf(peak);
  const px = x(pi), py = y(peak.gpu);
  const tipW = 168, tipX = Math.min(Math.max(px - tipW / 2, pad.l), w - pad.r - tipW);
  const hour = peak.h % 24;
  const when = `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
  return (
    <svg className="wchart" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Temperatures this week">
      <defs>
        <linearGradient id="wg-gpu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="wg-gpu-a" /><stop offset="1" className="wg-gpu-b" /></linearGradient>
        <linearGradient id="wg-cpu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="wg-cpu-a" /><stop offset="1" className="wg-cpu-b" /></linearGradient>
      </defs>
      {[40, 60, 80].map((v) => (
        <g key={v}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="wc-grid" /><text x={pad.l - 10} y={y(v) + 4} textAnchor="end" className="wc-tick">{v}°</text></g>
      ))}
      <line x1={pad.l} x2={w - pad.r} y1={y(limit)} y2={y(limit)} className="wc-limit" />
      <text x={w - pad.r} y={y(limit) - 7} textAnchor="end" className="wc-tick">{limit}° limit</text>
      <path d={area("gpu")} fill="url(#wg-gpu)" />
      <path d={area("cpu")} fill="url(#wg-cpu)" />
      <path d={line("gpu")} className="wc-line gpu" />
      <path d={line("cpu")} className="wc-line cpu" />
      {Array.from({ length: days }, (_, d) => (
        <text key={d} x={x((d * 24 + 12) / bucket)} y={h - 8} textAnchor="middle" className={`wc-tick${d === days - 1 ? " today" : ""}`}>{dayNames[d + (8 - days)]}</text>
      ))}
      <line x1={px} x2={px} y1={py} y2={pad.t + ih} className="wc-guide" />
      <circle cx={px} cy={py} r={6} className="wc-dot" />
      <g transform={`translate(${tipX},${Math.max(py - 50, 2)})`}>
        <rect width={tipW} height={38} rx={10} className="wc-tip" />
        <text x={12} y={16} className="wc-tip-a">Today, {when}</text>
        <text x={12} y={31} className="wc-tip-b">{names.gpu} {Math.round(peak.gpu)}°</text>
      </g>
    </svg>
  );
}
