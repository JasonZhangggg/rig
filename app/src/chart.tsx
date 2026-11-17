// Small SVG charts drawn with theme colors (CSS variables), no chart library.
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
