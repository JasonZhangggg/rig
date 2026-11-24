import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { peakOf, sensorGroups, type Recorded, type RecordedPoint, type SensorType } from "@rig/core";
import { useTemp } from "../../state";
import { clock, clockSec } from "./words";

type Temp = ReturnType<typeof useTemp>;

export function useWidth<T extends HTMLElement>(fallback: number) {
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

export interface LaneSeries { i: number; cls: string; name: string }
/** A custom log can chart things no sensor reads: memory in MB, or a plain count. */
export type LaneType = SensorType | "mb" | "plain";
export interface Lane { title: string; type: LaneType; series: LaneSeries[]; limit?: number; h?: number }
/** A stretch to shade: a closer look, or a game. */
export interface Band { from: number; to: number; kind: "look" | "game" }
/** A moment to number on the chart, matching a list beside it. */
export interface ChartMark { t: number; look?: boolean; /** Numbers the flag, to match a numbered list beside the chart. */ n?: number }

const percent = (t: LaneType) => t === "load" || t === "level" || t === "control";

/** A reading in its unit, short enough for a chart's head. */
export function value(temp: Temp, type: LaneType, v: number | null | undefined): string {
  if (v == null) return "–";
  if (type === "mb") return v >= 1000 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`;
  if (type === "temperature") return temp(v);
  if (percent(type)) return `${Math.round(v)}%`;
  if (type === "fan") return `${Math.round(v).toLocaleString("en-US")} rpm`;
  if (type === "power") return `${Math.round(v)} W`;
  return `${Math.round(v * 10) / 10}`;
}

/** The reading nearest a time. */
function nearest(t: number, points: readonly RecordedPoint[]) {
  let best: RecordedPoint | null = null;
  for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}

/** One sensor's line, bucketed to about two pixels so a day of readings stays light. Spikes keep their peak; a stretch with no readings is a gap. */
function pathOf(points: readonly RecordedPoint[], i: number, x: (t: number) => number, y: (v: number) => number, t0: number, t1: number, w: number, gapMs: number) {
  const n = Math.max(20, Math.round(w / 2));
  const b: { t: number; v: number; gap: boolean }[] = [];
  let last = -Infinity;
  for (const p of points) {
    if (p.t < t0 || p.t > t1) continue;
    const v = p.v[i];
    if (v == null) continue;
    const k = Math.min(n - 1, Math.floor(((p.t - t0) / (t1 - t0 || 1)) * n));
    const gap = last > -Infinity && p.t - last > gapMs;
    last = p.t;
    const cur = b[k];
    if (!cur) b[k] = { t: p.t, v, gap };
    else { if (gap) cur.gap = true; if (v > cur.v) { cur.v = v; cur.t = p.t; } }
  }
  let d = "";
  for (const p of b) if (p) d += `${d && !p.gap ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
  return d;
}

function scale(type: LaneType, vals: number[], limit?: number) {
  const top = Math.max(0, ...vals, limit ?? 0);
  if (type === "mb") { const step = top > 1500 ? 1024 : top > 400 ? 256 : 64; return { lo: 0, hi: Math.ceil(top / step) * step || step, step }; }
  if (type === "plain") { const step = top <= 10 ? Math.max(1, Math.ceil(top / 3)) : 10 ** Math.floor(Math.log10(top)); return { lo: 0, hi: Math.ceil(top / step) * step || step, step }; }
  if (percent(type)) return top < 20 ? { lo: 0, hi: Math.max(5, Math.ceil(top / 5) * 5), step: 5 } : { lo: 0, hi: 100, step: 50 };
  if (type === "fan") { const step = top > 2000 ? 1000 : 500; return { lo: 0, hi: Math.ceil(top / step) * step || step, step }; }
  if (type === "power") { const step = top > 150 ? 100 : top > 40 ? 50 : 10; return { lo: 0, hi: Math.ceil(top / step) * step || step, step }; }
  const lo = Math.floor(Math.min(...vals, top) / 20) * 20;
  return { lo, hi: Math.max(lo + 20, Math.ceil((top + 2) / 20) * 20), step: 20 };
}

function gridLabel(type: LaneType, v: number) {
  if (type === "mb") return v >= 1024 ? `${Math.round(v / 1024 * 10) / 10} GB` : `${v} MB`;
  if (type === "plain") return `${v}`;
  if (percent(type)) return `${v}%`;
  if (type === "fan") return v >= 1000 ? `${v / 1000}k` : `${v}`;
  if (type === "power") return `${v} W`;
  return `${v}°`;
}

function ticksFor(t0: number, t1: number, w: number) {
  const M = 60_000, H = 36e5;
  const want = (t1 - t0) / Math.max(2, Math.floor(w / 90));
  const every = [M, 2 * M, 5 * M, 10 * M, 15 * M, 30 * M, H, 2 * H, 3 * H, 6 * H].find((e) => e >= want) ?? 6 * H;
  const zone = new Date(t0).getTimezoneOffset() * M;
  const out: number[] = [];
  for (let t = Math.ceil((t0 - zone) / every) * every + zone; t <= t1; t += every) out.push(t);
  return out;
}
const tickLabel = (t: number, span: number) => (span > 4 * 36e5 && new Date(t).getMinutes() === 0 ? new Date(t).toLocaleTimeString(undefined, { hour: "numeric" }) : clock(t));

/** How many lines a lane names in its head; the rest are drawn faint. */
const NAMED = 4;

/**
 * Sensor lanes on one time axis, as the live view shows them: a lane per kind of reading, and one crosshair through them
 * all, with each named line's value at that moment in its lane's head.
 */
export function Lanes({ points, lanes, t0, t1, cursor, onCursor, bands = [], marks = [], compact, gapMs = 90_000 }: {
  points: readonly RecordedPoint[]; lanes: Lane[]; t0: number; t1: number; cursor: number | null; onCursor: (t: number | null) => void;
  bands?: Band[]; marks?: ChartMark[]; compact?: boolean; gapMs?: number;
}) {
  const temp = useTemp();
  const [ref, w] = useWidth<HTMLDivElement>(900);
  const pad = { l: compact ? 34 : 42, r: 8 };
  const iw = Math.max(40, w - pad.l - pad.r);
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const at = cursor != null ? nearest(cursor, points) : null;
  const shown = marks.filter((m) => m.t >= t0 && m.t <= t1);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    if (px >= 0 && px <= iw) onCursor(t0 + (px / iw) * (t1 - t0));
  };

  // Readings further apart than a few of their usual steps (the PC was off or asleep) leave a gap.
  const gap = useMemo(() => {
    const steps = points.slice(1, 400).map((p, i) => p.t - points[i].t).sort((a, b) => a - b);
    return Math.max(gapMs, 3 * (steps[steps.length >> 1] ?? 0));
  }, [points, gapMs]);
  const drawn = useMemo(() => lanes.map((lane) => {
    const h = lane.h ?? (compact ? 76 : 96);
    const vals: number[] = [];
    for (const p of points) if (p.t >= t0 && p.t <= t1) for (const s of lane.series) { const v = p.v[s.i]; if (v != null) vals.push(v); }
    const sc = scale(lane.type, vals, lane.limit);
    const y = (v: number) => 6 + (h - 12) * (1 - (v - sc.lo) / (sc.hi - sc.lo || 1));
    const grid: number[] = [];
    for (let v = sc.lo; v <= sc.hi; v += sc.step) grid.push(v);
    const paths = lane.series.map((s) => ({ ...s, d: pathOf(points, s.i, x, y, t0, t1, iw, gap) }));
    return { lane, h, y, grid, paths };
  }), [points, lanes, t0, t1, w, compact, gap]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!points.length) return null;
  return (
    <div ref={ref} className="ln" onPointerMove={move} onPointerDown={move} onPointerLeave={() => onCursor(null)}>
      {drawn.map(({ lane, h, y, grid, paths }, li) => (
        <div key={lane.title} className="ln-lane">
          <div className="ln-head" style={{ paddingLeft: pad.l }}>
            <span className="ln-title">{lane.title}</span>
            <span className="ln-keys">
              {lane.series.slice(0, NAMED).map((s) => (
                <span key={s.i} className="ln-key">
                  <i className={`ln-sw ${s.cls}`} />{s.name}
                  {at && <b className="num">{value(temp, lane.type, at.v[s.i])}</b>}
                </span>
              ))}
              {lane.series.length > NAMED && <span className="ln-key faint">and {lane.series.length - NAMED} more</span>}
            </span>
          </div>
          <svg width={w} height={h} className="ln-svg" role="img" aria-label={lane.title}>
            {bands.filter((b) => b.to > t0 && b.from < t1).map((b) => (
              <rect key={`${b.kind}${b.from}`} x={x(Math.max(b.from, t0))} width={Math.max(2, x(Math.min(b.to, t1)) - x(Math.max(b.from, t0)))} y={0} height={h} className={`ln-band ${b.kind}`} />
            ))}
            {grid.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
                <text x={pad.l - 6} y={y(v) + 4} className="chart-tick" textAnchor="end">{gridLabel(lane.type, v)}</text>
              </g>
            ))}
            {lane.limit != null && <line x1={pad.l} x2={w - pad.r} y1={y(lane.limit)} y2={y(lane.limit)} className="chart-limit" />}
            {shown.map((m) => <line key={m.t} x1={x(m.t)} x2={x(m.t)} y1={0} y2={h} className={`ln-mark${m.look ? " look" : ""}`} />)}
            {[...paths].reverse().map((p) => <path key={p.i} d={p.d} className={`ln-line ${p.cls}`} />)}
            {at && <line x1={x(at.t)} x2={x(at.t)} y1={0} y2={h} className="ln-cross" />}
            {at && paths.slice(0, NAMED).map((p) => at.v[p.i] != null && <circle key={p.i} cx={x(at.t)} cy={y(at.v[p.i]!)} r={3.5} className={`ln-dot ${p.cls}`} />)}
            {li === 0 && shown.filter((m) => m.n != null).map((m) => (
              <g key={`n${m.t}`} className={`ln-flag${m.look ? " look" : ""}`}>
                <circle cx={x(m.t)} cy={9} r={8} /><text x={x(m.t)} y={13} textAnchor="middle">{m.n}</text>
              </g>
            ))}
          </svg>
        </div>
      ))}
      <svg width={w} height={22} className="ln-axis" aria-hidden="true">
        {ticksFor(t0, t1, iw).map((t) => <text key={t} x={x(t)} y={14} className="chart-tick" textAnchor="middle">{tickLabel(t, t1 - t0)}</text>)}
        {at && <g className="ln-when"><rect x={x(at.t) - 42} y={0} width={84} height={20} rx={10} /><text x={x(at.t)} y={14} textAnchor="middle">{t1 - t0 < 30 * 60_000 ? clockSec(at.t) : clock(at.t)}</text></g>}
      </svg>
    </div>
  );
}

/** A small line for a part in the rail. */
function Spark({ points, i, from, to }: { points: readonly RecordedPoint[]; i: number; from: number; to: number }) {
  const w = 200, h = 26;
  const vals = points.filter((p) => p.t >= from && p.t <= to).map((p) => p.v[i]).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (t: number) => ((t - from) / (to - from || 1)) * w;
  const y = (v: number) => 2 + (h - 4) * (1 - (v - lo) / (hi - lo || 1));
  return <svg className="pf-spark ln-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={pathOf(points, i, x, y, from, to, w / 2, Infinity)} vectorEffect="non-scaling-stroke" /></svg>;
}

const cycle = ["c-ink", "c-brass", "c-grey"];
const colour = (j: number) => (j < cycle.length ? cycle[j] : "c-faint");

/** The lanes for the whole PC: each part's main temperature and usage, power and fans. */
function wholeLanes(r: Recorded, limits: { cpu?: number; gpu?: number }, h?: number): Lane[] {
  const part = (id: string) => r.parts.find((p) => p.id === id);
  const pick = (type: SensorType, test: (name: string, part: string) => boolean) =>
    r.parts.flatMap((p) => {
      const i = p.sensors.find((k) => r.sensors[k].type === type && test(r.sensors[k].name, p.id));
      return i == null ? [] : [{ i, name: p.name }];
    });
  const temps = ["gpu", "cpu", "motherboard"].flatMap((id) => { const p = part(id); return p && r.sensors[p.lead].type === "temperature" ? [{ i: p.lead, name: p.name }] : []; });
  const loads = pick("load", (n, p) => p === "cpu" ? /total|^usage$/i.test(n) : p === "gpu" ? /core|^usage$/i.test(n) : p === "ram" ? /^memory$|^in use$/i.test(n) : false);
  const power = pick("power", (n, p) => (p === "cpu" || p === "gpu") && /package/i.test(n));
  const fans = r.sensors.map((s, i) => [s, i] as const).filter(([s]) => s.type === "fan").map(([s, i]) => ({ i, name: s.name }));
  const lanes: Lane[] = [];
  if (temps.length) lanes.push({ title: "Temperatures", type: "temperature", h, series: temps.map((s, j) => ({ ...s, cls: colour(j) })), limit: temps[0] && r.sensors[temps[0].i].part === "gpu" ? limits.gpu : limits.cpu });
  if (loads.length) lanes.push({ title: "Usage", type: "load", series: loads.map((s, j) => ({ ...s, cls: colour(j) })) });
  if (power.length) lanes.push({ title: "Power", type: "power", series: power.map((s, j) => ({ ...s, cls: colour(j) })) });
  if (fans.length) lanes.push({ title: "Fans", type: "fan", series: fans.map((s, j) => ({ ...s, cls: colour(j) })) });
  return lanes;
}

/** The lanes for one part: one per kind of sensor it has, every sensor of that kind in it. */
export function lanesFor(r: Recorded, pick: string, limits: { cpu?: number; gpu?: number }, h?: number): Lane[] {
  if (pick === "all") return wholeLanes(r, limits, h);
  const p = r.parts.find((x) => x.id === pick);
  if (!p) return [];
  const limit = pick === "gpu" ? limits.gpu : pick === "cpu" ? limits.cpu : undefined;
  return sensorGroups.flatMap(([type, title]): Lane[] => {
    const idx = p.sensors.filter((i) => r.sensors[i].type === type);
    if (!idx.length) return [];
    // The part's lead first, then the rest as the recorder listed them.
    idx.sort((a, b) => (a === p.lead ? -1 : b === p.lead ? 1 : 0));
    return [{ title, type, limit: type === "temperature" ? limit : undefined, series: idx.map((i, j) => ({ i, name: r.sensors[i].name, cls: colour(j) })) }];
  }).map((l, j) => ({ ...l, h: j === 0 ? h : undefined }));
}

/** The parts down the side, as in the live view: what each part's main reading reached in the stretch, and its line. */
export function PartRail({ r, pick, onPick, from, to, limits }: {
  r: Recorded; pick: string; onPick: (id: string) => void; from: number; to: number; limits: { cpu?: number; gpu?: number };
}) {
  const temp = useTemp();
  return (
    <div className="pf-rail ln-rail" role="group" aria-label="Parts">
      <button type="button" className="pf-part" aria-pressed={pick === "all"} onClick={() => onPick("all")}>
        <span className="pf-part-name">Whole PC</span>
        <span className="pf-part-now faint">{r.sensors.length} {r.sensors.length === 1 ? "sensor" : "sensors"}</span>
      </button>
      {r.parts.map((p) => {
        const s = r.sensors[p.lead];
        const top = peakOf(r, p.lead, from, to);
        const limit = p.id === "gpu" ? limits.gpu : p.id === "cpu" ? limits.cpu : undefined;
        const near = top && limit != null && s.type === "temperature" && top.max >= limit - 6;
        return (
          <button key={p.id} type="button" className="pf-part" aria-pressed={pick === p.id} onClick={() => onPick(p.id)}>
            <span className="pf-part-name">{p.name}</span>
            <span className="pf-part-now"><b className={`num${near ? " look" : ""}`}>{value(temp, s.type, top?.max)}</b><span className="faint">highest</span></span>
            <Spark points={r.points} i={p.lead} from={from} to={to} />
          </button>
        );
      })}
    </div>
  );
}

/** Every sensor over a stretch: the parts down the side and their lanes. */
export function AllSensors({ r, from, to, limits, bands, marks, compact }: {
  r: Recorded; from: number; to: number; limits: { cpu?: number; gpu?: number }; bands?: Band[]; marks?: ChartMark[]; compact?: boolean;
}) {
  const [pick, setPick] = useState("all");
  const [cursor, setCursor] = useState<number | null>(null);
  const lanes = useMemo(() => lanesFor(r, pick, limits, compact ? 110 : 140), [r, pick, limits.cpu, limits.gpu, compact]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ln-grid">
      <PartRail r={r} pick={pick} onPick={setPick} from={from} to={to} limits={limits} />
      <Lanes points={r.points} lanes={lanes} t0={from} t1={to} cursor={cursor} onCursor={setCursor} bands={bands} marks={marks} compact={compact} />
    </div>
  );
}
