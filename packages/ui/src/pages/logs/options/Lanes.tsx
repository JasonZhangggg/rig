import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useTemp } from "../../../state";
import { byId, clock, fmt, nearest, type Moment, type Point, type Span, type Unit } from "./data";

export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { if (el.clientWidth) setW(el.clientWidth); };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface LaneSeries { id: string; cls: string; name?: string }
export interface Lane { title: string; unit: Unit; series: LaneSeries[]; limit?: number; h?: number }

/** One line per sensor as an SVG path, bucketed to about two pixels so a day of readings stays light. Spikes keep their peak. */
export function pathOf(points: readonly Point[], id: string, x: (t: number) => number, y: (v: number) => number, t0: number, t1: number, w: number, peak = true) {
  const n = Math.max(20, Math.round(w / 2));
  const b: { t: number; v: number; c: number; gap?: boolean }[] = [];
  let last = -Infinity;
  for (const p of points) {
    if (p.t < t0 || p.t > t1) continue;
    const v = p.v[id];
    if (v == null) continue;
    const i = Math.min(n - 1, Math.floor(((p.t - t0) / (t1 - t0)) * n));
    const cur = b[i];
    // A stretch with no readings (the program wasn't running) is left as a gap, not joined.
    const gap = p.t - last > 60_000 && last > -Infinity;
    last = p.t;
    if (!cur) b[i] = { t: p.t, v, c: 1, gap };
    else if (peak) { if (v > cur.v) { cur.v = v; cur.t = p.t; } }
    else { cur.v = (cur.v * cur.c + v) / (cur.c + 1); cur.c++; }
  }
  let d = "";
  for (const p of b) if (p) d += `${d && !p.gap ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
  return d;
}

function scale(unit: Unit, vals: number[], limit?: number) {
  const top = Math.max(...vals, limit ?? 0);
  if (unit === "percent") return top < 20 ? { lo: 0, hi: Math.ceil(top / 5) * 5, step: 5 } : { lo: 0, hi: 100, step: 50 };
  if (unit === "rpm") { const step = top > 2000 ? 1000 : 500; return { lo: 0, hi: Math.ceil(top / step) * step || step, step }; }
  if (unit === "watt") { const step = top > 150 ? 100 : 50; return { lo: 0, hi: Math.ceil(top / step) * step, step }; }
  if (unit === "mb") { const step = top > 1500 ? 1000 : 500; return { lo: 0, hi: Math.ceil(top / step) * step, step }; }
  const lo = Math.floor(Math.min(...vals) / 20) * 20;
  return { lo, hi: Math.ceil((top + 2) / 20) * 20, step: 20 };
}

export function ticksFor(t0: number, t1: number, w = 900) {
  const span = t1 - t0, H = 36e5, M = 60_000;
  const want = span / Math.max(2, Math.floor(w / 90));
  const every = [5 * M, 10 * M, 15 * M, 30 * M, H, 2 * H, 3 * H, 6 * H].find((e) => e >= want) ?? 6 * H;
  const out: number[] = [];
  for (let t = Math.ceil(t0 / every) * every; t <= t1; t += every) out.push(t);
  return out;
}
const tickLabel = (t: number, t0: number, t1: number) => (t1 - t0 > 4 * 36e5 ? new Date(t).toLocaleTimeString("en-US", { hour: "numeric" }) : clock(t));

/**
 * Sensor lanes on one time axis: each lane is a kind of reading (temperatures, usage, power, fans), and one
 * crosshair runs through all of them, with each lane's values at that moment in its head.
 */
export function Lanes({ points, lanes, t0, t1, cursor, onCursor, bands = [], marks = [], compact }: {
  points: readonly Point[]; lanes: Lane[]; t0: number; t1: number; cursor: number | null; onCursor: (t: number | null) => void;
  bands?: Span[]; marks?: Moment[]; compact?: boolean;
}) {
  const temp = useTemp();
  const [ref, w] = useWidth<HTMLDivElement>(900);
  const pad = { l: compact ? 30 : 40, r: 8 };
  const iw = w - pad.l - pad.r;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * iw;
  const at = cursor != null ? nearest(cursor, points) : null;
  const visMarks = marks.filter((m) => m.t >= t0 && m.t <= t1);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    if (px < 0 || px > iw) return;
    onCursor(t0 + (px / iw) * (t1 - t0));
  };

  const drawn = useMemo(() => lanes.map((lane) => {
    const h = lane.h ?? (compact ? 76 : 92);
    const vals = points.filter((p) => p.t >= t0 && p.t <= t1).flatMap((p) => lane.series.map((s) => p.v[s.id])).filter((v) => v != null);
    const sc = scale(lane.unit, vals, lane.limit);
    const y = (v: number) => 6 + (h - 12) * (1 - (v - sc.lo) / (sc.hi - sc.lo));
    const grid: number[] = [];
    for (let v = sc.lo; v <= sc.hi; v += sc.step) grid.push(v);
    const paths = lane.series.map((s) => ({ ...s, d: pathOf(points, s.id, x, y, t0, t1, iw, lane.unit === "temp" || lane.unit === "rpm") }));
    return { lane, h, y, grid, paths };
  }), [points, lanes, t0, t1, w]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridLabel = (u: Unit, v: number) => u === "percent" ? `${v}%` : u === "rpm" ? (v >= 1000 ? `${v / 1000}k` : `${v}`) : u === "watt" ? `${v}W` : u === "mb" ? (v >= 1000 ? `${v / 1000} GB` : `${v} MB`) : `${v}°`;

  return (
    <div ref={ref} className="ln" onPointerMove={move} onPointerLeave={() => onCursor(null)}>
      {drawn.map(({ lane, h, y, grid, paths }, li) => (
        <div key={lane.title} className="ln-lane">
          <div className="ln-head" style={{ paddingLeft: pad.l }}>
            <span className="ln-title">{lane.title}</span>
            <span className="ln-keys">
              {lane.series.map((s) => (
                <span key={s.id} className="ln-key">
                  <i className={`ln-sw ${s.cls}`} />{s.name ?? byId[s.id].name}
                  {at && <b className="num">{fmt(lane.unit, at.v[s.id], (c) => temp(c))}</b>}
                </span>
              ))}
            </span>
          </div>
          <svg width={w} height={h} className="ln-svg" role="img" aria-label={lane.title}>
            {bands.filter((b) => b.to > t0 && b.from < t1).map((b) => (
              <rect key={`${b.from}`} x={x(Math.max(b.from, t0))} width={Math.max(2, x(Math.min(b.to, t1)) - x(Math.max(b.from, t0)))} y={0} height={h} className={`ln-band ${b.kind}`} />
            ))}
            {grid.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
                <text x={pad.l - 6} y={y(v) + 4} className="chart-tick" textAnchor="end">{gridLabel(lane.unit, v)}</text>
              </g>
            ))}
            {lane.limit != null && <line x1={pad.l} x2={w - pad.r} y1={y(lane.limit)} y2={y(lane.limit)} className="chart-limit" />}
            {visMarks.map((m) => <line key={m.t} x1={x(m.t)} x2={x(m.t)} y1={0} y2={h} className={`ln-mark${m.look ? " look" : ""}`} />)}
            {[...paths].reverse().map((p) => <path key={p.id} d={p.d} className={`ln-line ${p.cls}`} />)}
            {at && <line x1={x(at.t)} x2={x(at.t)} y1={0} y2={h} className="ln-cross" />}
            {at && paths.map((p) => at.v[p.id] != null && <circle key={p.id} cx={x(at.t)} cy={y(at.v[p.id])} r={3.5} className={`ln-dot ${p.cls}`} />)}
            {li === 0 && visMarks.map((m, i) => (
              <g key={`n${m.t}`} className={`ln-flag${m.look ? " look" : ""}`}>
                <circle cx={x(m.t)} cy={9} r={8} /><text x={x(m.t)} y={13} textAnchor="middle">{marks.indexOf(m) + 1 || i + 1}</text>
              </g>
            ))}
          </svg>
        </div>
      ))}
      <svg width={w} height={22} className="ln-axis" aria-hidden="true">
        {ticksFor(t0, t1, iw).map((t) => <text key={t} x={x(t)} y={14} className="chart-tick" textAnchor="middle">{tickLabel(t, t0, t1)}</text>)}
        {at && <g className="ln-when"><rect x={x(at.t) - 38} y={0} width={76} height={20} rx={10} /><text x={x(at.t)} y={14} textAnchor="middle">{clock(at.t, at.detail)}</text></g>}
      </svg>
    </div>
  );
}

/** The whole day, small, with the stretch the lanes show framed: drag it to move. */
export function Overview({ points, id, from, to, t0, t1, bands = [], marks = [], children }: {
  points: readonly Point[]; id: string; from: number; to: number; t0: number; t1: number; bands?: Span[]; marks?: Moment[]; children?: ReactNode;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(900);
  const h = 44, padL = 40, padR = 8, iw = w - padL - padR;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * iw;
  const vals = points.map((p) => p.v[id]).filter((v) => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const y = (v: number) => 4 + (h - 8) * (1 - (v - lo) / (hi - lo || 1));
  return (
    <div ref={ref} className="ov">
      <svg width={w} height={h + 18} role="img" aria-label="The whole day">
        {bands.map((b) => <rect key={b.from} x={x(b.from)} width={Math.max(2, x(b.to) - x(b.from))} y={0} height={h} className={`ln-band ${b.kind}`} />)}
        <path d={pathOf(points, id, x, y, t0, t1, iw)} className="ov-line" />
        {marks.map((m) => <circle key={m.t} cx={x(m.t)} cy={h - 4} r={3} className={`ov-mark${m.look ? " look" : ""}`} />)}
        <rect x={x(from)} y={0.5} width={x(to) - x(from)} height={h - 1} rx={6} className="ov-win" />
        <rect x={padL} y={0} width={Math.max(0, x(from) - padL)} height={h} className="ov-shade" />
        <rect x={x(to)} y={0} width={Math.max(0, w - padR - x(to))} height={h} className="ov-shade" />
        {ticksFor(t0, t1, iw).map((t) => <text key={t} x={x(t)} y={h + 14} className="chart-tick" textAnchor={t >= t1 ? "end" : "middle"}>{new Date(t).toLocaleTimeString("en-US", { hour: "numeric" })}</text>)}
      </svg>
      {children}
    </div>
  );
}

/** A small line, for a table row or a part. */
export function Spark({ points, id, w = 160, h = 28, from, to, cls = "" }: { points: readonly Point[]; id: string; w?: number; h?: number; from: number; to: number; cls?: string }) {
  const vals = points.filter((p) => p.t >= from && p.t <= to).map((p) => p.v[id]).filter((v) => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (t: number) => ((t - from) / (to - from)) * w;
  const y = (v: number) => 2 + (h - 4) * (1 - (v - lo) / (hi - lo || 1));
  return <svg className={`sp ${cls}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={pathOf(points, id, x, y, from, to, w / 2, ["temp", "rpm"].includes(byId[id]?.unit))} vectorEffect="non-scaling-stroke" /></svg>;
}
