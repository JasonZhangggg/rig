import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react";
import { findReadings, peakOf, sensorGroups, type Recorded, type RecordedPoint, type SensorType } from "@rig/core";
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
/** A lane draws its key lines; `more` are the rest of its sensors, drawn only when you ask to see them all. */
export interface Lane { title: string; type: LaneType; series: LaneSeries[]; more?: LaneSeries[]; limit?: number; h?: number }
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
  if (type === "clock") return v >= 1000 ? `${(v / 1000).toFixed(2)} GHz` : `${Math.round(v)} MHz`;
  if (type === "voltage") return `${v.toFixed(2)} V`;
  if (type === "current") return `${v.toFixed(1)} A`;
  return `${Math.round(v * 10) / 10}`;
}

/** A reading in its unit, as precise as a hardware monitor shows it, for the rows under a chart. */
export function reading(temp: Temp, type: LaneType, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (type === "fan") return `${Math.round(v).toLocaleString("en-US")} rpm`;
  if (type === "power") return `${v.toFixed(1)} W`;
  if (type === "voltage") return `${v.toFixed(3)} V`;
  if (type === "current") return `${v.toFixed(2)} A`;
  if (type === "data") return v >= 1000 ? `${(v / 1000).toFixed(1)} TB` : `${v.toFixed(1)} GB`;
  if (type === "throughput") return v >= 1e9 ? `${(v / 1e9).toFixed(2)} GB/s` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB/s` : `${Math.round(v / 1e3)} KB/s`;
  return value(temp, type, v);
}

/** A sensor's newest, lowest and highest reading over a stretch. */
export interface SensorStat { last: number | null; min: number | null; max: number | null }

/** Each sensor's newest, lowest and highest reading between two times. */
export function statsOf(points: readonly RecordedPoint[], count: number, from: number, to: number): SensorStat[] {
  const out = Array.from({ length: count }, () => ({ last: null as number | null, min: Infinity, max: -Infinity }));
  for (const p of points) {
    if (p.t < from || p.t > to) continue;
    p.v.forEach((v, i) => {
      if (v == null || i >= count) return;
      const s = out[i];
      s.last = v;
      if (v < s.min) s.min = v;
      if (v > s.max) s.max = v;
    });
  }
  return out.map((s) => (s.last == null ? { last: null, min: null, max: null } : s));
}

/** The reading nearest a time. */
function nearest(t: number, points: readonly RecordedPoint[]) {
  let best: RecordedPoint | null = null;
  for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}

/**
 * One sensor's line, bucketed to about five pixels so a day of readings draws as a calm line, not a scribble. Each bucket
 * keeps its peak, so a spike still shows, and a stretch with no readings is a gap. Buckets are fixed in time, so as a live
 * chart slides, a reading stays in its bucket and the line doesn't shimmer.
 */
function pathOf(points: readonly RecordedPoint[], i: number, x: (t: number) => number, y: (v: number) => number, t0: number, t1: number, w: number, gapMs: number) {
  const size = (t1 - t0) / Math.max(20, Math.round(w / 5)) || 1;
  const b: { k: number; t: number; v: number; gap: boolean }[] = [];
  let last = -Infinity;
  for (const p of points) {
    if (p.t < t0 || p.t > t1) continue;
    const v = p.v[i];
    if (v == null) continue;
    const k = Math.floor(p.t / size);
    const gap = last > -Infinity && p.t - last > gapMs;
    last = p.t;
    const cur = b[b.length - 1];
    if (!cur || cur.k !== k) b.push({ k, t: p.t, v, gap });
    else { if (gap) cur.gap = true; if (v > cur.v) { cur.v = v; cur.t = p.t; } }
  }
  let d = "";
  for (const p of b) d += `${d && !p.gap ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
  return d;
}

/** The least a lane spans, so a steady reading still draws as a line with room around it, not a scribble. */
const leastSpan: Record<LaneType, number> = {
  temperature: 6, load: 10, level: 10, control: 10, fan: 300, power: 10, clock: 200, voltage: 0.05, current: 0.5, data: 1, throughput: 1e5, mb: 64, plain: 2,
};

/** A round step that cuts a span into about this many parts. */
function niceStep(span: number, parts: number) {
  const raw = span / parts, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/**
 * The values a lane spans: fitted to its readings, with a little room, so small changes show. A limit just above the
 * readings is taken in, so you can see how close they came to it. The edges snap to a quarter of a grid step, so a live
 * chart doesn't shift with every reading.
 */
export function scale(type: LaneType, vals: number[], limit?: number, parts = 4) {
  if (!vals.length) return { lo: 0, hi: 1, step: 1 };
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const least = leastSpan[type];
  if (limit != null && limit > hi && limit - hi <= least * 1.5) hi = limit;
  if (hi - lo < least) { const mid = (lo + hi) / 2; lo = mid - least / 2; hi = mid + least / 2; }
  const room = (hi - lo) * 0.1;
  lo -= room; hi += room;
  if (lo < 0) { hi -= lo; lo = 0; }
  if (percent(type) && hi > 100) { lo = Math.max(0, lo - (hi - 100)); hi = 100; }
  const step = niceStep(hi - lo, parts), snap = step / 4;
  return { lo: Math.floor(lo / snap) * snap, hi: Math.min(percent(type) ? 100 : Infinity, Math.ceil(hi / snap) * snap), step };
}

/** The values a lane draws grid lines at: the round steps inside it. */
function gridOf(sc: { lo: number; hi: number; step: number }) {
  const first = Math.ceil(sc.lo / sc.step - 1e-9), last = Math.floor(sc.hi / sc.step + 1e-9);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, k) => Number(((first + k) * sc.step).toPrecision(6)));
}

/** A tidy number, without the float noise from dividing a grid value. */
const tidy = (x: number) => Number(x.toPrecision(4));

function gridLabel(temp: Temp, type: LaneType, v: number) {
  if (type === "mb") return v >= 1024 ? `${Math.round(v / 1024 * 10) / 10} GB` : `${v} MB`;
  if (type === "temperature") return temp(v, { mark: "degree" });
  if (percent(type)) return `${v}%`;
  if (type === "fan") return v >= 1000 ? `${tidy(v / 1000)}k` : `${v}`;
  if (type === "power") return `${v} W`;
  if (type === "clock") return v >= 1000 ? `${tidy(v / 1000)} GHz` : `${v} MHz`;
  if (type === "voltage") return `${v} V`;
  if (type === "current") return `${v} A`;
  if (type === "data") return v >= 1000 ? `${tidy(v / 1000)} TB` : `${v} GB`;
  if (type === "throughput") return v >= 1e9 ? `${tidy(v / 1e9)} GB/s` : v >= 1e6 ? `${tidy(v / 1e6)} MB/s` : `${tidy(v / 1e3)} KB/s`;
  return `${v}`;
}

/** Times along the axis; `fine` allows ticks every 15 or 30 seconds, for the live view, where labels carry seconds. */
function ticksFor(t0: number, t1: number, w: number, fine = false) {
  const M = 60_000, H = 36e5;
  // Over days, one tick a day, named by the day.
  const want = t1 - t0 > 2 * 864e5 ? 24 * H : (t1 - t0) / Math.max(2, Math.floor(w / (fine ? 70 : 90)));
  const every = [...(fine ? [15_000, 30_000] : []), M, 2 * M, 5 * M, 10 * M, 15 * M, 30 * M, H, 2 * H, 3 * H, 6 * H, 12 * H, 24 * H].find((e) => e >= want) ?? 24 * H;
  const zone = new Date(t0).getTimezoneOffset() * M;
  const out: number[] = [];
  for (let t = Math.ceil((t0 - zone) / every) * every + zone; t <= t1; t += every) out.push(t);
  // Over weeks, a day a week or so, so the dates don't run together.
  if (t1 - t0 > 10 * 864e5) { const k = Math.ceil(out.length / Math.max(2, Math.floor(w / 80))); return out.filter((_, i) => (out.length - 1 - i) % k === 0); }
  return out;
}
const tickLabel = (t: number, span: number) => (span > 10 * 864e5 ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  : span > 2 * 864e5 ? new Date(t).toLocaleDateString(undefined, { weekday: "short" })
  : span > 4 * 36e5 && new Date(t).getMinutes() === 0 ? new Date(t).toLocaleTimeString(undefined, { hour: "numeric" }) : clock(t));

const reduceMotion = () => typeof window !== "undefined" && (document.documentElement.dataset.motion === "reduce" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * Slides live lines left as time passes, so between readings they glide rather than jump: each frame moves the lines
 * by however long it's been since they were drawn. Nothing moves with reduced motion; the lines step with each reading.
 */
function useGlide(box: RefObject<HTMLElement>, on: boolean, drawnAt: number, pxPerMs: number) {
  // Before paint, so freshly drawn lines never show a frame at the old offset.
  useLayoutEffect(() => {
    const groups = box.current ? [...box.current.querySelectorAll<SVGGElement>(".ln-move")] : [];
    const put = (dx: number) => groups.forEach((g) => g.setAttribute("transform", `translate(${(-dx).toFixed(2)},0)`));
    put(0);
    if (!on || reduceMotion() || typeof requestAnimationFrame === "undefined") return;
    let frame = 0;
    // Never further than a few readings' worth, so a stalled PC doesn't slide its lines out of view.
    const step = () => { put(Math.min(Date.now() - drawnAt, 8000) * pxPerMs); frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [box, on, drawnAt, pxPerMs]);
}

/** How many lines a lane names in its head; the rest are drawn faint. */
const NAMED = 4;

/**
 * Sensor lanes on one time axis, as the live view shows them: a lane per kind of reading, and one crosshair through them
 * all, with each named line's value at that moment in its lane's head.
 */
export function Lanes({ points, lanes, t0: start, t1: end, cursor, onCursor, bands = [], marks = [], compact, gapMs = 90_000, live, rows }: {
  points: readonly RecordedPoint[]; lanes: Lane[]; t0: number; t1: number; cursor: number | null; onCursor: (t: number | null) => void;
  bands?: Band[]; marks?: ChartMark[]; compact?: boolean; gapMs?: number;
  /** The last few minutes up to now: the lines slide left as new readings come in, and the newest value shows in each lane's head. */
  live?: boolean;
  /**
   * Each sensor's lowest and highest over the stretch. With these, a lane lists its sensors as rows under its chart, like
   * a hardware monitor: the reading now, or at the pointer, and its lowest and highest. Pointing at a row picks out its
   * line, and clicking keeps it picked out.
   */
  rows?: readonly SensorStat[];
}) {
  const temp = useTemp();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [pinned, setPinned] = useState<ReadonlySet<number>>(() => new Set());
  const [hover, setHover] = useState<number | null>(null);
  const pin = (i: number) => setPinned((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const toggle = (title: string) => setOpen((o) => { const n = new Set(o); if (n.has(title)) n.delete(title); else n.add(title); return n; });
  // The usual time between readings.
  const every = useMemo(() => {
    const steps = points.slice(1, 400).map((p, i) => p.t - points[i].t).sort((a, b) => a - b);
    return steps[steps.length >> 1] ?? 0;
  }, [points]);
  // Live, the chart runs a couple of readings behind now. Each new reading is then drawn before the line slides to it,
  // so the right edge never shows a gap that fills in when the reading arrives.
  const lag = live ? Math.min(10_000, Math.max(1000, 2 * every)) : 0;
  const t0 = start - lag, t1 = end - lag;
  const [ref, w] = useWidth<HTMLDivElement>(900);
  const clip = `ln-clip${useId().replace(/[^\w-]/g, "")}`;
  const pad = { l: compact ? 34 : 42, r: 8 };
  const iw = Math.max(40, w - pad.l - pad.r);
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const at = cursor != null ? nearest(cursor, points) : null;
  // Live, the heads show the newest reading until the pointer picks a moment.
  const latest = live && !at ? points[points.length - 1] ?? null : null;
  const head = at ?? latest;
  useGlide(ref, !!live, end, iw / (t1 - t0 || 1));
  const shown = marks.filter((m) => m.t >= t0 && m.t <= t1);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    // Over the rows, they show the reading now, not at a moment on the chart.
    if ((e.target as Element).closest?.(".ln-rows")) { if (cursor != null) onCursor(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    if (px >= 0 && px <= iw) onCursor(t0 + (px / iw) * (t1 - t0));
  };

  // Readings further apart than a few of their usual steps (the PC was off or asleep) leave a gap.
  const gap = Math.max(gapMs, 3 * every);
  const drawn = useMemo(() => lanes.map((lane) => {
    const h = lane.h ?? (compact ? 76 : 96);
    // The rest of a lane's lines, when it's open, drawn faint behind its key ones. A row picked out stays drawn.
    const all = open.has(lane.title) && lane.more ? [...lane.series, ...lane.more]
      : [...lane.series, ...(lane.more ?? []).filter((s) => pinned.has(s.i)).map((s) => ({ ...s, cls: "c-look" }))];
    const vals: number[] = [];
    for (const p of points) if (p.t >= t0 && p.t <= end) for (const s of all) { const v = p.v[s.i]; if (v != null) vals.push(v); }
    // A short lane gets fewer grid lines, so their labels don't crowd.
    const sc = scale(lane.type, vals, lane.limit, h >= 100 ? 4 : 3);
    const y = (v: number) => 6 + (h - 12) * (1 - (v - sc.lo) / (sc.hi - sc.lo || 1));
    const grid = gridOf(sc);
    // Live lines start a little before the left edge, so sliding left never shows an empty strip there.
    const from = live ? t0 - (t1 - t0) / 10 : t0;
    const paths = all.map((s) => ({ ...s, d: pathOf(points, s.i, x, y, from, end, iw, gap) }));
    return { lane, h, y, grid, paths, sc };
  }), [points, lanes, t0, t1, w, compact, gap, open, pinned]); // eslint-disable-line react-hooks/exhaustive-deps

  // The time along the bottom; with rows, under each lane's chart, so each one reads on its own.
  const axisAt = (key: string) => (
    <svg width={w} height={22} className="ln-axis" aria-hidden="true">
        {live && <defs><clipPath id={`${clip}-${key}`}><rect x={pad.l - 30} y={0} width={iw + 38} height={22} /></clipPath></defs>}
        <g clipPath={live ? `url(#${clip}-${key})` : undefined}>
          <g className="ln-move">{ticksFor(live ? t0 - (t1 - t0) / 10 : t0, t1, iw, live).map((t) => <text key={t} x={x(t)} y={14} className="chart-tick" textAnchor="middle">{live ? (t1 - t0 > 5 * 60_000 ? clock(t) : clockSec(t)).replace(/\s?[AP]M$/i, "") : tickLabel(t, t1 - t0)}</text>)}</g>
        </g>
        {at && <g className="ln-when"><rect x={x(at.t) - 42} y={0} width={84} height={20} rx={10} /><text x={x(at.t)} y={14} textAnchor="middle">{t1 - t0 < 30 * 60_000 ? clockSec(at.t) : clock(at.t)}</text></g>}
      </svg>
  );
  // Pointing at a row, or picking rows out, draws their lines over the others.
  const picked = (i: number) => (hover != null ? hover === i : pinned.has(i));
  const focus = (paths: { i: number }[]) => paths.some((p) => picked(p.i));
  if (!points.length) return null;
  return (
    <div ref={ref} className="ln" onPointerMove={move} onPointerDown={move} onPointerLeave={() => onCursor(null)}>
      {drawn.map(({ lane, h, y, grid, paths, sc }, li) => (
        <div key={lane.title} className="ln-lane">
          <div className="ln-head" style={{ paddingLeft: pad.l }}>
            <span className="ln-title">{lane.title}</span>
            <span className="ln-keys">
              {!rows && lane.series.slice(0, NAMED).map((s) => (
                <span key={s.i} className="ln-key">
                  <i className={`ln-sw ${s.cls}`} />{s.name}
                  {head && <b className="num">{value(temp, lane.type, head.v[s.i])}</b>}
                </span>
              ))}
              {!rows && lane.series.length > NAMED && <span className="ln-key faint">and {lane.series.length - NAMED} more</span>}
              {!!lane.more?.length && (
                <button type="button" className="ln-more" aria-expanded={open.has(lane.title)} onClick={() => toggle(lane.title)} onPointerDown={(e) => e.stopPropagation()}>
                  {open.has(lane.title) ? "Show fewer" : `Show all ${lane.series.length + lane.more.length}${rows ? " sensors" : ""}`}
                </button>
              )}
            </span>
          </div>
          <svg width={w} height={h} className="ln-svg" role="img" aria-label={lane.title}>
            {live && <defs><clipPath id={`${clip}-${li}`}><rect x={pad.l} y={-2} width={iw} height={h + 4} /></clipPath></defs>}
            {bands.filter((b) => b.to > t0 && b.from < t1).map((b) => (
              <rect key={`${b.kind}${b.from}`} x={x(Math.max(b.from, t0))} width={Math.max(2, x(Math.min(b.to, t1)) - x(Math.max(b.from, t0)))} y={0} height={h} className={`ln-band ${b.kind}`} />
            ))}
            {grid.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
                <text x={pad.l - 6} y={y(v) + 4} className="chart-tick" textAnchor="end">{gridLabel(temp, lane.type, v)}</text>
              </g>
            ))}
            {lane.limit != null && lane.limit >= sc.lo && lane.limit <= sc.hi && <line x1={pad.l} x2={w - pad.r} y1={y(lane.limit)} y2={y(lane.limit)} className="chart-limit" />}
            {shown.map((m) => <line key={m.t} x1={x(m.t)} x2={x(m.t)} y1={0} y2={h} className={`ln-mark${m.look ? " look" : ""}`} />)}
            <g clipPath={live ? `url(#${clip}-${li})` : undefined}>
              <g className="ln-move">{[...paths].reverse().map((p) => <path key={p.i} d={p.d} className={`ln-line ${p.cls}${focus(paths) ? (picked(p.i) ? " on" : " dim") : ""}`} />)}</g>
            </g>
            {at && <line x1={x(at.t)} x2={x(at.t)} y1={0} y2={h} className="ln-cross" />}
            {at && paths.slice(0, NAMED).map((p) => at.v[p.i] != null && <circle key={p.i} cx={x(at.t)} cy={y(at.v[p.i]!)} r={3.5} className={`ln-dot ${p.cls}`} />)}
            {li === 0 && shown.filter((m) => m.n != null).map((m) => (
              <g key={`n${m.t}`} className={`ln-flag${m.look ? " look" : ""}`}>
                <circle cx={x(m.t)} cy={9} r={8} /><text x={x(m.t)} y={13} textAnchor="middle">{m.n}</text>
              </g>
            ))}
          </svg>
          {rows && axisAt(`a${li}`)}
          {rows && <SensorRows lane={lane} list={paths} rows={rows} sc={sc}
            at={at} live={live} compact={compact} pinned={pinned} onPin={pin} onHover={setHover} />}
        </div>
      ))}
      {!rows && axisAt("axis")}
    </div>
  );
}

/**
 * A lane's sensors as rows under its chart: each one's reading now, or at the pointer's moment, its lowest and highest,
 * and a small track of that span on the chart's own scale, so a row that ran hotter than the rest stands out.
 */
function SensorRows({ lane, list, rows, sc, at, live, compact, pinned, onPin, onHover }: {
  lane: Lane; list: { i: number; name: string; cls: string }[]; rows: readonly SensorStat[]; sc: { lo: number; hi: number };
  at: RecordedPoint | null; live?: boolean; compact?: boolean; pinned: ReadonlySet<number>; onPin: (i: number) => void; onHover: (i: number | null) => void;
}) {
  const temp = useTemp();
  const word = at ? clock(at.t) : live ? "Now" : "Last";
  const near = (v: number | null) => lane.type === "temperature" && v != null && lane.limit != null && v >= lane.limit - 6;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - sc.lo) / (sc.hi - sc.lo || 1)) * 100));
  return (
    <table className="ln-rows" aria-label={`${lane.title}, every sensor`} onPointerLeave={() => onHover(null)}>
      <thead><tr>
        <th scope="col"><span className="sr-only">Sensor</span></th>
        <th scope="col">{word}</th><th scope="col">Lowest</th><th scope="col">Highest</th>
        {!compact && <td aria-hidden="true" />}
      </tr></thead>
      <tbody>
        {list.map((s) => {
          const st = rows[s.i] ?? { last: null, min: null, max: null };
          const now = at ? at.v[s.i] ?? null : st.last;
          return (
            <tr key={s.i} className={pinned.has(s.i) ? "on" : undefined} onPointerEnter={() => onHover(s.i)}>
              <th scope="row">
                <button type="button" aria-pressed={pinned.has(s.i)} onClick={() => onPin(s.i)}><i className={`ln-sw ${s.cls}`} />{s.name}</button>
              </th>
              <td className="num">{reading(temp, lane.type, now)}</td>
              <td className="num faint">{reading(temp, lane.type, st.min)}</td>
              <td className={`num${near(st.max) ? " look" : " faint"}`}>{reading(temp, lane.type, st.max)}</td>
              {!compact && (
                <td className="ln-track" aria-hidden="true">
                  {st.min != null && st.max != null && <span className={near(st.max) ? "look" : undefined}>
                    <i className="ln-span" style={{ left: `${pos(st.min)}%`, width: `${Math.max(0.5, pos(st.max) - pos(st.min))}%` }} />
                    {now != null && <i className="ln-now" style={{ left: `${pos(now)}%` }} />}
                  </span>}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
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

/** Sensors that sum up the rest of their kind: a package, a total, the highest or the average. */
const summary = /package|total|\bmax\b|average|\bavg\b|highest|^usage$|^memory$|^in use$|^cpu core$/i;
/** A part's lane draws at most this many lines until you ask to see them all. */
const KEY = 3;

/**
 * A part's readings, with a Highest and an Average line added for any kind of sensor that has many and none that sums
 * them up, like a clock speed per core. Those two then stand in for the rest until you show them all.
 */
export function withSummaries(r: Recorded, pick: string): Recorded {
  const p = r.parts.find((x) => x.id === pick);
  if (!p) return r;
  const add: { type: SensorType; how: "max" | "avg"; of: number[] }[] = [];
  for (const [type] of sensorGroups) {
    const idx = p.sensors.filter((i) => r.sensors[i].type === type);
    if (idx.length > KEY + 1 && !idx.some((i) => summary.test(r.sensors[i].name))) add.push({ type, how: "max", of: idx }, { type, how: "avg", of: idx });
  }
  if (!add.length) return r;
  const base = r.sensors.length;
  const sensors = [...r.sensors, ...add.map((a) => ({ ...r.sensors[a.of[0]], id: `${pick}-${a.type}-${a.how}`, name: a.how === "max" ? "Highest" : "Average" }))];
  const points = r.points.map((pt) => ({
    t: pt.t,
    v: [...pt.v, ...add.map((a) => {
      let n = 0, sum = 0, top = -Infinity;
      for (const i of a.of) { const v = pt.v[i]; if (v == null) continue; n++; sum += v; if (v > top) top = v; }
      return n ? (a.how === "max" ? top : sum / n) : null;
    })],
  }));
  const parts = r.parts.map((x) => (x.id === pick ? { ...x, sensors: [...x.sensors, ...add.map((_, k) => base + k)] } : x));
  return { ...r, sensors, parts, points };
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
    // The part's lead first, then the lines that sum up the rest, like a package, total, highest or average.
    const keyed = idx.filter((i) => i === p.lead || summary.test(r.sensors[i].name)).sort((a, b) => (a === p.lead ? -1 : b === p.lead ? 1 : 0));
    const key = idx.length <= KEY + 1 ? idx.sort((a, b) => (a === p.lead ? -1 : b === p.lead ? 1 : 0)) : (keyed.length ? keyed : idx).slice(0, KEY);
    const more = idx.filter((i) => !key.includes(i));
    return [{
      title, type, limit: type === "temperature" ? limit : undefined,
      series: key.map((i, j) => ({ i, name: r.sensors[i].name, cls: colour(j) })),
      more: more.map((i) => ({ i, name: r.sensors[i].name, cls: "c-faint" })),
    }];
  }).map((l, j) => ({ ...l, h: j === 0 ? h : undefined }));
}

/** The parts down the side, as in the live view: what each part's main reading reached in the stretch, and its line. */
export function PartRail({ r, pick, onPick, from, to, limits, live }: {
  r: Recorded; pick: string; onPick: (id: string) => void; from: number; to: number; limits: { cpu?: number; gpu?: number };
  /** Show each part's reading now, not its highest. */
  live?: boolean;
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
        const newest = live ? r.points[r.points.length - 1]?.v[p.lead] : null;
        const top = live ? (newest == null ? null : { max: newest }) : peakOf(r, p.lead, from, to);
        const limit = p.id === "gpu" ? limits.gpu : p.id === "cpu" ? limits.cpu : undefined;
        const near = top && limit != null && s.type === "temperature" && top.max >= limit - 6;
        return (
          <button key={p.id} type="button" className="pf-part" aria-pressed={pick === p.id} onClick={() => onPick(p.id)}>
            <span className="pf-part-name">{p.name}</span>
            <span className="pf-part-now"><b className={`num${near ? " look" : ""}`}>{value(temp, s.type, top?.max)}</b><span className="faint">{live ? "now" : "highest"}</span></span>
            <Spark points={r.points} i={p.lead} from={from} to={to} />
          </button>
        );
      })}
    </div>
  );
}

/** The sensors that match a search, a lane for each part and kind they're in, every match drawn. */
function foundLanes(r: Recorded, query: string, limits: { cpu?: number; gpu?: number }): Lane[] {
  const found = new Set(findReadings(r.sensors.map((s, i) => ({ ...s, i })), query).map((s) => s.i));
  return r.parts.flatMap((p) => sensorGroups.flatMap(([type, title]): Lane[] => {
    const idx = p.sensors.filter((i) => found.has(i) && r.sensors[i].type === type);
    if (!idx.length) return [];
    const limit = type !== "temperature" ? undefined : p.id === "gpu" ? limits.gpu : p.id === "cpu" ? limits.cpu : undefined;
    return [{ title: p.name.toLowerCase() === title.toLowerCase() ? p.name : `${p.name}, ${title.toLowerCase()}`, type, limit, series: idx.map((i, j) => ({ i, name: r.sensors[i].name, cls: colour(j) })) }];
  }));
}

/**
 * Every sensor over a stretch, as a chart and a table in one: the parts down the side, a lane per kind of reading, and
 * under each lane its sensors with their reading now and their lowest and highest. A search finds any sensor on the PC.
 */
export function AllSensors({ r, whole, from, to, limits, bands, marks, compact, live }: {
  r: Recorded; /** Every reading, not thinned, so the lowest and highest are exact. */ whole?: Recorded | null;
  from: number; to: number; limits: { cpu?: number; gpu?: number }; bands?: Band[]; marks?: ChartMark[]; compact?: boolean; live?: boolean;
}) {
  const [pick, setPick] = useState("all");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const finding = query.trim();
  // Live lanes are kept short, so the log under them is in view too.
  const first = live ? (compact ? 96 : 116) : compact ? 110 : 140;
  // A part's own view adds a Highest and Average line where its sensors have nothing that sums them up.
  const shown = useMemo(() => (pick === "all" || finding ? r : withSummaries(r, pick)), [r, pick, finding]);
  const stats = useMemo(() => {
    const src = whole ?? r;
    const all = pick === "all" || finding ? src : withSummaries(src, pick);
    return statsOf(all.points, all.sensors.length, from, to);
  }, [whole, r, pick, finding, from, to]);
  const lanes = useMemo(() => (finding ? foundLanes(r, finding, limits)
    : lanesFor(shown, pick, limits, first).map((l, j) => (live && j > 0 ? { ...l, h: l.h ?? (compact ? 64 : 78) } : l))),
    [shown.sensors, shown.parts, pick, finding, limits.cpu, limits.gpu, first, live, compact]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = lanes.reduce((n, l) => n + l.series.length, 0);
  return (
    <div className="ln-grid">
      <PartRail r={r} pick={finding ? "" : pick} onPick={(id) => { setPick(id); setQuery(""); }} from={from} to={to} limits={limits} live={live} />
      <div className="ln-main">
        <div className="ln-find">
          <input type="search" className="input" placeholder="Find a sensor, like core 3" aria-label="Find a sensor" value={query} onChange={(e) => setQuery(e.target.value)} />
          {finding && <span className="faint num" aria-live="polite">{count} of {r.sensors.length}</span>}
        </div>
        {finding && !lanes.length ? <p className="muted ln-none">No sensor matches “{finding}”. Try a part, like processor, a kind, like voltage, or a sensor, like core 3.</p>
          : <Lanes key={finding ? "find" : pick} points={shown.points} lanes={lanes} t0={from} t1={to} cursor={cursor} onCursor={setCursor} bands={bands} marks={marks} compact={compact} live={live} gapMs={live ? 20_000 : undefined} rows={stats} />}
      </div>
    </div>
  );
}
