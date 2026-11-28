import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as KeyEvent, type MutableRefObject, type PointerEvent, type RefObject } from "react";
import { findReadings, machineWord, sensorGroups, type PartsView, type Recorded, type RecordedPoint, type SensorType } from "@rig/core";
import { useTemp } from "../../state";
import { clock, clockSec } from "./words";
import { dateText } from "../../dateText";
import { PartSummary, partLines, type Device } from "./PartSummary";

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

/** The space between two charts side by side. */
const COL_GAP = 32;

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

/** A point a line is drawn through; `gap` starts a new stretch, after a time with no readings. */
interface Vert { t: number; v: number; gap: boolean }

/**
 * One sensor's line, bucketed to about five pixels so a day of readings draws as a calm line, not a scribble. Each bucket
 * keeps its peak, so a spike still shows, or with `calm`, wider buckets draw their average, so readings a couple of
 * seconds apart don't jitter. A stretch with no readings is a gap.
 */
function lineOf(points: readonly RecordedPoint[], i: number, t0: number, t1: number, w: number, gapMs: number, calm?: { px: number; least: number }): Vert[] {
  const size = Math.max(calm?.least ?? 0, (t1 - t0) / Math.max(20, Math.round(w / (calm?.px ?? 5)))) || 1;
  // Too few readings yet to smooth: draw them as they are, so there is a line at all.
  if (calm) {
    let first = Infinity, last = -Infinity;
    for (const p of points) if (p.t >= t0 && p.t <= t1 && p.v[i] != null) { first = Math.min(first, p.t); last = Math.max(last, p.t); }
    if (last - first < 4 * size) return lineOf(points, i, t0, t1, w, gapMs);
  }
  const b: { k: number; t: number; v: number; sum: number; st: number; n: number; gap: boolean }[] = [];
  let last = -Infinity;
  for (const p of points) {
    if (p.t < t0 || p.t > t1) continue;
    const v = p.v[i];
    if (v == null) continue;
    const k = Math.floor(p.t / size);
    const gap = last > -Infinity && p.t - last > gapMs;
    last = p.t;
    const cur = b[b.length - 1];
    if (!cur || cur.k !== k) b.push({ k, t: p.t, v, sum: v, st: p.t, n: 1, gap });
    else { if (gap) cur.gap = true; cur.sum += v; cur.st += p.t; cur.n++; if (v > cur.v) { cur.v = v; cur.t = p.t; } }
  }
  // Calm, each bucket draws the average of its readings, eased with its neighbours so a reading that flips between two
  // values draws flat rather than as a zigzag; otherwise its peak, so a spike still shows.
  const avg = b.map((p) => p.sum / p.n);
  return b.map((p, j) => {
    if (!calm) return { t: p.t, v: p.v, gap: p.gap };
    const prev = j > 0 && !p.gap ? avg[j - 1] : null, next = j + 1 < b.length && !b[j + 1].gap ? avg[j + 1] : null;
    const v = prev != null && next != null ? (prev + 2 * avg[j] + next) / 4 : (avg[j] + (prev ?? next ?? avg[j])) / 2;
    return { t: p.st / p.n, v, gap: p.gap };
  });
}

/**
 * A live line: every reading, each eased toward the ones before it over about `ease` ms, so jitter between readings
 * draws calm. Each point depends only on the readings before it, so once drawn it never moves: a new reading only adds
 * to the right end, and the line slides rather than reshaping.
 */
function liveLineOf(points: readonly RecordedPoint[], i: number, t0: number, t1: number, gapMs: number, ease: number): Vert[] {
  const out: Vert[] = [];
  let last = -Infinity, e = 0;
  for (const p of points) {
    if (p.t < t0 || p.t > t1) continue;
    const v = p.v[i];
    if (v == null) continue;
    const gap = last > -Infinity && p.t - last > gapMs;
    e = out.length && !gap ? e + (v - e) * (1 - Math.exp(-(p.t - last) / ease)) : v;
    last = p.t;
    out.push({ t: p.t, v: e, gap });
  }
  return out;
}

const dOf = (vs: readonly Vert[], x: (t: number) => number, y: (v: number) => number) =>
  vs.map((p, j) => `${j && !p.gap ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");

/** Where a drawn line is at a time, so a dot sits on the line rather than off it; null in a gap or past its ends. */
export function lineAt(vs: readonly Vert[], t: number): number | null {
  for (let j = 1; j < vs.length; j++) {
    const a = vs[j - 1], b = vs[j];
    if (t < a.t) return null;
    if (t <= b.t) return b.gap ? null : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1);
  }
  return vs.length === 1 && Math.abs(vs[0].t - t) < 1 ? vs[0].v : null;
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
const tickLabel = (t: number, span: number) => (span > 10 * 864e5 ? dateText(new Date(t), { month: "short", day: "numeric" })
  : span > 2 * 864e5 ? dateText(new Date(t), { weekday: "short" })
  : span > 4 * 36e5 && new Date(t).getMinutes() === 0 ? dateText(new Date(t), { hour: "numeric" }) : clock(t));

const reduceMotion = () => typeof window !== "undefined" && (document.documentElement.dataset.motion === "reduce" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** How long a lane takes to ease to a new scale. */
const EASE_MS = 450;

/**
 * Moves live charts every frame, so they glide rather than jump. Lines are drawn as of the newest reading; each frame
 * maps them onto the stretch as it is now, sliding left as time passes or, while the chart still fills from when Rig
 * opened, closing up from the right. When a lane's scale changes, its lines ease to the new one rather than snapping.
 * With reduced motion, nothing moves between readings.
 */
function useGlide(box: RefObject<HTMLElement>, g: { on: boolean; t0: number; t1: number; drawnAt: number; win: (ms: number) => { t0: number; t1: number }; l: number; iw: number }, now: MutableRefObject<{ t0: number; t1: number }>) {
  const { on, t0, t1, drawnAt, win, l, iw } = g;
  // Before paint, so freshly drawn lines never show a frame at the old offset.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const moving = on && !reduceMotion() && typeof requestAnimationFrame !== "undefined";
    let frame = 0;
    const draw = () => {
      // Never further than a few readings' worth, so a stalled PC doesn't slide its lines out of view.
      const e = moving ? Math.max(0, Math.min(Date.now() - drawnAt, 8000)) : 0;
      const { t0: c0, t1: c1 } = e ? win(drawnAt + e) : { t0, t1 };
      const span = c1 - c0 || 1;
      now.current = { t0: c0, t1: c1 };
      const a = (t1 - t0 || 1) / span, b = l - l * a - ((c0 - t0) / span) * iw;
      const at = (t: number) => l + ((t - c0) / span) * iw;
      const ms = typeof performance === "undefined" ? Date.now() : performance.now();
      el.querySelectorAll<SVGGElement>(".ln-move").forEach((g) => {
        let c = 1, d = 0;
        const was = g.dataset.was?.split(",").map(Number);
        if (moving && was) {
          const [plo, phi, lo, hi, h, since] = was;
          const u = Math.min(1, Math.max(0, (ms - since) / EASE_MS));
          if (u < 1) {
            const k = 1 - (1 - u) ** 3, los = plo + (lo - plo) * k, his = phi + (hi - phi) * k, r = his - los || 1, kh = h - 12;
            c = (hi - lo) / r;
            d = 6 + kh - (kh * (hi - los)) / r - 6 * c;
          }
        }
        g.setAttribute("transform", `matrix(${a.toFixed(5)},0,0,${c.toFixed(5)},${b.toFixed(2)},${d.toFixed(2)})`);
      });
      el.querySelectorAll<HTMLElement | SVGElement>("[data-t]").forEach((n) => {
        const px = at(Number(n.dataset.t));
        if (n instanceof HTMLElement) n.style.left = `${px.toFixed(1)}px`;
        else if (n.tagName === "text") n.setAttribute("x", px.toFixed(1));
        else n.setAttribute("transform", `translate(${px.toFixed(1)},0)`);
      });
    };
    draw();
    if (!moving) return;
    const step = () => { draw(); frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  });
}

/** How many lines a lane names in its head; the rest are drawn faint. */
const NAMED = 4;

/**
 * Sensor lanes on one time axis, as the live view shows them: a lane per kind of reading, and one crosshair through them
 * all, with each named line's value at that moment in its lane's head.
 */
export function Lanes({ points, lanes, t0: start, t1: end, cursor, onCursor, bands = [], marks = [], compact, gapMs = 90_000, live, liveSpan, rows }: {
  points: readonly RecordedPoint[]; lanes: Lane[]; t0: number; t1: number; cursor: number | null; onCursor: (t: number | null) => void;
  bands?: Band[]; marks?: ChartMark[]; compact?: boolean; gapMs?: number;
  /** The last few minutes up to now: the lines slide left as new readings come in, and the newest value shows in each lane's head. */
  live?: boolean;
  /**
   * Live, how far back the chart reaches. Until the readings reach that far back, as just after Rig opens, the chart
   * starts where they do and fills in from the right; then it slides. Both are one rule, so the change never jumps.
   */
  liveSpan?: number;
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
  // The lane the pointer is over, which shows the readings at that moment beside the pointer.
  const [over, setOver] = useState<number | null>(null);
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
  const first = points[0]?.t ?? start;
  // The stretch on screen at a moment: it ends a little behind that moment, and, live, starts at the first reading until
  // the readings reach back the whole span, never less than 20 seconds.
  const win = (ms: number) => {
    const t1 = ms - lag;
    if (!live || !liveSpan) return { t0: start - lag + (ms - end), t1 };
    return { t0: Math.min(Math.max(first, t1 - liveSpan), t1 - 20_000), t1 };
  };
  const { t0, t1 } = win(end);
  const [ref, full] = useWidth<HTMLDivElement>(900);
  // With rows, a wide screen sets the charts two to a row, so each keeps a shape you can read rather than a long thin strip.
  const cols = rows && lanes.length > 1 && full >= 1100 ? 2 : 1;
  const w = cols === 2 ? Math.floor((full - COL_GAP) / 2) : full;
  const clip = `ln-clip${useId().replace(/[^\w-]/g, "")}`;
  const pad = { l: compact ? 34 : 42, r: 8 };
  const iw = Math.max(40, w - pad.l - pad.r);
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const at = cursor != null ? nearest(cursor, points) : null;
  // Live, the heads show the newest reading until the pointer picks a moment.
  const latest = live && !at ? points[points.length - 1] ?? null : null;
  const head = at ?? latest;
  // The stretch on screen this frame, which a live chart moves on between readings.
  const view = useRef({ t0, t1 });
  useGlide(ref, { on: !!live, t0, t1, drawnAt: end, win, l: pad.l, iw }, view);
  const shown = marks.filter((m) => m.t >= t0 && m.t <= t1);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    // Over the rows, they show the reading now, not at a moment on the chart.
    if ((e.target as Element).closest?.(".ln-rows")) { if (cursor != null) onCursor(null); setOver(null); return; }
    const lane = (e.target as Element).closest?.<HTMLElement>(".ln-lane");
    const r = (lane ?? e.currentTarget).getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    const v = view.current;
    setOver(lane ? Number(lane.dataset.li) : null);
    if (px >= 0 && px <= iw) onCursor(v.t0 + (px / iw) * (v.t1 - v.t0));
  };

  // Readings further apart than a few of their usual steps (the PC was off or asleep) leave a gap.
  const gap = Math.max(gapMs, 3 * every);
  // Live, each lane keeps its scale while the readings fit it, and eases to a new one when they don't.
  const kept = useRef(new Map<string, { lo: number; hi: number; step: number; was?: string }>());
  const drawn = useMemo(() => lanes.map((lane) => {
    const h = lane.h ?? (rows ? Math.round(Math.min(230, Math.max(compact ? 130 : 150, w * 0.3))) : compact ? 76 : 96);
    // The rest of a lane's lines, when it's open, drawn faint behind its key ones. With rows, a group of like sensors
    // that's open draws its members faint, and a row picked out is drawn.
    const fams = familiesOf(lane.more ?? []);
    const all = !rows ? (open.has(lane.title) && lane.more ? [...lane.series, ...lane.more] : lane.series) : [
      ...lane.series,
      ...fams.groups.flatMap((g) => (open.has(`${lane.title}|${g.key}`) ? g.members.map((s) => (pinned.has(s.i) ? { ...s, cls: "c-look" } : s)) : [])),
      ...fams.singles.filter((s) => pinned.has(s.i)).map((s) => ({ ...s, cls: "c-look" })),
    ];
    const vals: number[] = [];
    for (const p of points) if (p.t >= t0 && p.t <= end) for (const s of all) { const v = p.v[s.i]; if (v != null) vals.push(v); }
    // A short lane gets fewer grid lines, so their labels don't crowd.
    let sc: { lo: number; hi: number; step: number; was?: string } = scale(lane.type, vals, lane.limit, h >= 100 ? 4 : 3);
    const before = kept.current.get(lane.title);
    if (live && before) {
      const fits = vals.every((v) => v >= before.lo && v <= before.hi) && before.hi - before.lo <= 1.5 * (sc.hi - sc.lo);
      if (fits) sc = before;
      else if (before.lo !== sc.lo || before.hi !== sc.hi) sc = { ...sc, was: [before.lo, before.hi, sc.lo, sc.hi, h, typeof performance === "undefined" ? 0 : performance.now()].join(",") };
    }
    kept.current.set(lane.title, sc);
    const y = (v: number) => 6 + (h - 12) * (1 - (v - sc.lo) / (sc.hi - sc.lo || 1));
    const grid = gridOf(sc);
    // Live lines start a little before the left edge, so sliding left never shows an empty strip there.
    const from = live ? t0 - (t1 - t0) / 10 : t0;
    // Live, each reading is eased toward the ones before it, so the line is calm and never reshapes as it slides; with
    // rows, readings a few seconds apart are averaged, so the line shows the trend. The rows keep the exact highest.
    const paths = all.map((s) => {
      const vs = live ? liveLineOf(points, s.i, from, end, gap, Math.max(3 * every, (t1 - t0) / 200)) : lineOf(points, s.i, from, end, iw, gap, rows ? { px: 8, least: 5 * every } : undefined);
      return { ...s, vs, d: dOf(vs, x, y) };
    });
    return { lane, h, y, grid, paths, sc, fams };
  }), [points, lanes, t0, t1, w, compact, gap, open, pinned, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // The time along the bottom; with rows, under each lane's chart, so each one reads on its own.
  const axisAt = (key: string) => (
    <svg width={w} height={22} className="ln-axis" aria-hidden="true">
        {live && <defs><clipPath id={`${clip}-${key}`}><rect x={pad.l - 30} y={0} width={iw + 38} height={22} /></clipPath></defs>}
        <g clipPath={live ? `url(#${clip}-${key})` : undefined}>
          {ticksFor(live ? t0 - (t1 - t0) / 10 : t0, t1, iw, live).map((t) => <text key={t} x={x(t)} y={14} data-t={live ? t : undefined} className="chart-tick" textAnchor="middle">{live ? (t1 - t0 > 5 * 60_000 ? clock(t) : clockSec(t)).replace(/\s?[AP]M$/i, "") : tickLabel(t, t1 - t0)}</text>)}
        </g>
        {at && <g className="ln-when" transform={`translate(${x(at.t)},0)`} data-t={live ? at.t : undefined}><rect x={-42} y={0} width={84} height={20} rx={10} /><text x={0} y={14} textAnchor="middle">{t1 - t0 < 30 * 60_000 ? clockSec(at.t) : clock(at.t)}</text></g>}
      </svg>
  );
  // Pointing at a row, or picking rows out, draws their lines over the others.
  const picked = (i: number) => (hover != null ? hover === i : pinned.has(i));
  const focus = (paths: { i: number }[]) => paths.some((p) => picked(p.i));
  if (!points.length) return null;
  return (
    <div ref={ref} className={`ln${cols === 2 ? " two" : ""}`} onPointerMove={move} onPointerDown={move} onPointerLeave={() => { onCursor(null); setOver(null); }}>
      {drawn.map(({ lane, h, y, grid, paths, sc, fams }, li) => {
        // The lines the readout beside the pointer names: the lane's key lines, and any picked out.
        const told = at ? paths.filter((p, k) => (k < NAMED || pinned.has(p.i)) && at.v[p.i] != null) : [];
        const tipX = at ? x(at.t) : 0;
        return (
        <div key={lane.title} className="ln-lane" data-li={li}>
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
              {!rows && !!lane.more?.length && (
                <button type="button" className="ln-more" aria-expanded={open.has(lane.title)} onClick={() => toggle(lane.title)} onPointerDown={(e) => e.stopPropagation()}>
                  {open.has(lane.title) ? "Show fewer" : `Show all ${lane.series.length + lane.more.length}${rows ? " sensors" : ""}`}
                </button>
              )}
            </span>
          </div>
          <div className="ln-plot">
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
              <g className="ln-move" data-was={sc.was}>
                {[...paths].reverse().map((p) => <path key={p.i} d={p.d} className={`ln-line ${p.cls}${focus(paths) ? (picked(p.i) ? " on" : " dim") : ""}`} />)}
                {at && <line x1={x(at.t)} x2={x(at.t)} y1={0} y2={h} className="ln-cross" />}
                {at && told.map((p) => {
                  const v = lineAt(p.vs, at.t) ?? at.v[p.i]!;
                  return <circle key={p.i} cx={x(at.t)} cy={y(v)} r={3.5} className={`ln-dot ${p.cls}`} />;
                })}
              </g>
            </g>
            {li === 0 && shown.filter((m) => m.n != null).map((m) => (
              <g key={`n${m.t}`} className={`ln-flag${m.look ? " look" : ""}`}>
                <circle cx={x(m.t)} cy={9} r={8} /><text x={x(m.t)} y={13} textAnchor="middle">{m.n}</text>
              </g>
            ))}
          </svg>
          {at && over === li && told.length > 0 && (
            <div className={`ln-tip${tipX > pad.l + iw * 0.6 ? " left" : ""}`} style={{ left: tipX }} data-t={live ? at.t : undefined} role="status">
              <span className="ln-tip-when">{t1 - t0 < 30 * 60_000 ? clockSec(at.t) : clock(at.t)}</span>
              {told.map((p) => (
                <span key={p.i} className="ln-tip-row"><i className={`ln-sw ${p.cls}`} /><span className="ln-tip-name">{p.name}</span><b className="num">{reading(temp, lane.type, at.v[p.i])}</b></span>
              ))}
            </div>
          )}
          </div>
          {rows && axisAt(`a${li}`)}
          {rows && <SensorRows lane={lane} drawn={paths} fams={fams} rows={rows} sc={sc} at={at} live={live} compact={compact} pinned={pinned} onPin={pin} onHover={setHover}
            isOpen={(k) => open.has(`${lane.title}|${k}`)} onOpen={(g) => {
              toggle(`${lane.title}|${g.key}`);
              // Closing a group lets go of the members picked out in it.
              if (open.has(`${lane.title}|${g.key}`)) setPinned((o) => new Set([...o].filter((i) => !g.members.some((m) => m.i === i))));
            }} />}
        </div>
        );
      })}
      {!rows && axisAt("axis")}
    </div>
  );
}

/** Sensors of one kind that differ only by a number, like a core each: listed as one row until opened. */
interface Family { key: string; label: string; members: LaneSeries[] }

/** A lane's other sensors, with three or more that differ only by a number grouped, like "Cores" for Core 1 to Core 8. */
export function familiesOf(more: readonly LaneSeries[]): { groups: Family[]; singles: LaneSeries[] } {
  const by = new Map<string, LaneSeries[]>();
  for (const s of more) { const k = s.name.replace(/\d+/g, "#"); (by.get(k) ?? by.set(k, []).get(k)!).push(s); }
  const groups: Family[] = [], singles: LaneSeries[] = [];
  for (const [key, members] of by) {
    if (members.length < 3 || !key.includes("#")) { singles.push(...members); continue; }
    const name = members[0].name;
    const label = /thread/i.test(name) ? "Threads" : name.replace(/\s?\d+/, "s");
    const n = (x: string) => x.match(/\d+/g)!.map(Number);
    groups.push({ key, label, members: [...members].sort((a, b) => { const p = n(a.name), q = n(b.name); for (let k = 0; k < p.length; k++) if (p[k] !== q[k]) return p[k] - q[k]; return 0; }) });
  }
  return { groups, singles };
}

/**
 * A lane's sensors as rows under its chart: each one's reading now, or at the pointer's moment, its lowest and highest,
 * and a small track of that span on the chart's own scale, so a row that ran hotter than the rest stands out. Sensors
 * that differ only by a number, like a core each, are one row until opened; sensors with no readings are left out.
 */
function SensorRows({ lane, drawn, fams, rows, sc, at, live, compact, pinned, onPin, onHover, isOpen, onOpen }: {
  lane: Lane; drawn: { i: number; cls: string }[]; fams: { groups: Family[]; singles: LaneSeries[] }; rows: readonly SensorStat[];
  sc: { lo: number; hi: number }; at: RecordedPoint | null; live?: boolean; compact?: boolean;
  pinned: ReadonlySet<number>; onPin: (i: number) => void; onHover: (i: number | null) => void;
  isOpen: (key: string) => boolean; onOpen: (g: Family) => void;
}) {
  const temp = useTemp();
  const word = at ? clock(at.t) : live ? "Now" : "Last";
  const stat = (i: number) => rows[i] ?? { last: null, min: null, max: null };
  const nowOf = (i: number) => (at ? at.v[i] ?? null : stat(i).last);
  const read = (i: number) => stat(i).last != null;
  const near = (v: number | null) => lane.type === "temperature" && v != null && lane.limit != null && v >= lane.limit - 6;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - sc.lo) / (sc.hi - sc.lo || 1)) * 100));
  // The scale's ends, rounded, as the grid labels them: they only say which way is higher.
  const endLabel = (v: number) => lane.type === "fan" ? (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v)}`)
    : lane.type === "temperature" ? gridLabel(temp, lane.type, Math.round(v)) : value(temp, lane.type, v);
  const clsOf = (i: number) => drawn.find((d) => d.i === i)?.cls ?? "c-none";
  // Each row's lowest to highest as a bar on the chart's own scale, with a dot where it is now, as the part rows above
  // draw it; the column's head names both ends of the scale, so the bars read as values, not as time.
  const track = (min: number | null, max: number | null, nows: number[]) => !compact && (
    <td className="ln-track" aria-hidden="true">
      {min != null && max != null && <span className={near(max) ? "look" : undefined}
        title={`${reading(temp, lane.type, min)} to ${reading(temp, lane.type, max)}${nows.length ? `, ${word.toLowerCase() === "now" ? "now" : word === "Last" ? "last" : `at ${word}`} ${reading(temp, lane.type, Math.max(...nows))}` : ""}`}>
        <i className="ln-span" style={{ left: `${pos(min)}%`, width: `${Math.max(0.5, pos(max) - pos(min))}%` }} />
        {nows.map((v, k) => <i key={k} className="ln-now" style={{ left: `${pos(v)}%` }} />)}
      </span>}
    </td>
  );
  const row = (s: LaneSeries, sub?: boolean) => {
    const st = stat(s.i), now = nowOf(s.i);
    return (
      <tr key={s.i} className={[pinned.has(s.i) && "on", sub && "sub"].filter(Boolean).join(" ") || undefined} onPointerEnter={() => onHover(s.i)}>
        <th scope="row">
          <button type="button" aria-pressed={pinned.has(s.i)} onClick={() => onPin(s.i)}><i className={`ln-sw ${clsOf(s.i)}`} />{s.name}</button>
        </th>
        <td className="num">{reading(temp, lane.type, now)}</td>
        <td className="num faint">{reading(temp, lane.type, st.min)}</td>
        <td className={`num${near(st.max) ? " look" : " faint"}`}>{reading(temp, lane.type, st.max)}</td>
        {track(st.min, st.max, now == null ? [] : [now])}
      </tr>
    );
  };
  const groups = fams.groups.map((g) => ({ ...g, members: g.members.filter((m) => read(m.i)) })).filter((g) => g.members.length);
  return (
    <table className="ln-rows" aria-label={`${lane.title}, every sensor`} onPointerLeave={() => onHover(null)}>
      <thead><tr>
        <th scope="col"><span className="sr-only">Sensor</span></th>
        <th scope="col">{word}</th><th scope="col">Lowest</th><th scope="col">Highest</th>
        {!compact && <th scope="col" className="ln-track-h" aria-hidden="true"><div>
          <span className="num">{endLabel(sc.lo)}</span>
          <span className="ln-track-key"><i className="ln-key-span" />Lowest to highest<i className="ln-key-now" />{word === "Now" || word === "Last" ? word : `At ${word}`}</span>
          <span className="num">{endLabel(sc.hi)}</span>
        </div></th>}
      </tr></thead>
      <tbody>
        {lane.series.filter((s) => read(s.i)).map((s) => row(s))}
        {groups.map((g) => {
          const open = isOpen(g.key);
          const nows = g.members.map((m) => nowOf(m.i)).filter((v): v is number => v != null);
          const mins = g.members.map((m) => stat(m.i).min).filter((v): v is number => v != null);
          const maxs = g.members.map((m) => stat(m.i).max).filter((v): v is number => v != null);
          const min = mins.length ? Math.min(...mins) : null, max = maxs.length ? Math.max(...maxs) : null;
          return [
            <tr key={g.key} className="ln-group">
              <th scope="row">
                <button type="button" aria-expanded={open} onClick={() => onOpen(g)}>
                  <svg className="ln-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5 7.5 6 4 9.5" /></svg>
                  {g.label}{" "}<span className="faint">{g.members.length}</span>
                </button>
              </th>
              <td className="num" title="The highest of them">{nows.length ? reading(temp, lane.type, Math.max(...nows)) : "–"}</td>
              <td className="num faint">{reading(temp, lane.type, min)}</td>
              <td className={`num${near(max) ? " look" : " faint"}`}>{reading(temp, lane.type, max)}</td>
              {track(min, max, nows)}
            </tr>,
            ...(open ? g.members.map((m) => row(m, true)) : []),
          ];
        })}
        {fams.singles.filter((s) => read(s.i)).map((s) => row(s))}
      </tbody>
    </table>
  );
}

/** A small line for a part in the rail. */
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

/**
 * A sensor's name as a part's own view shows it: without the part it's already under, "#" before numbers dropped and
 * in sentence case, so "CPU Core #3 Thread #2" reads "Core 3, thread 2" and "GPU Hot Spot" reads "Hot spot".
 */
export function shortName(name: string, part: string) {
  let n = name;
  if (part === "cpu") n = n.replace(/^CPU\s+(?=\S)/, "");
  if (part === "gpu") n = n.replace(/^GPU\s+(?=\S)/, "");
  n = n.replace(/#\s*(\d+)/g, "$1").replace(/\s+Thread\s+(\d+)/, ", thread $1");
  let inside = false;
  return n.split(" ").map((w, k) => {
    const was = inside;
    if (w.startsWith("(")) inside = true;
    if (w.endsWith(")")) inside = false;
    if (was || w.startsWith("(")) return w;
    return w.split("-").map((x, j) => ((k > 0 || j > 0) && /^[A-Z][a-z]+,?$/.test(x) ? x.toLowerCase() : x)).join("-");
  }).join(" ");
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
      series: key.map((i, j) => ({ i, name: shortName(r.sensors[i].name, p.id), cls: colour(j) })),
      more: more.map((i) => ({ i, name: shortName(r.sensors[i].name, p.id), cls: "c-faint" })),
    }];
  }).map((l, j) => ({ ...l, h: j === 0 ? h : undefined }));
}

/** Some sensors, a lane for each part and kind they're in, every one drawn: the ones a search found, or the ones picked. */
function foundLanes(r: Recorded, found: ReadonlySet<number>, limits: { cpu?: number; gpu?: number }): Lane[] {
  return r.parts.flatMap((p) => sensorGroups.flatMap(([type, title]): Lane[] => {
    const idx = p.sensors.filter((i) => found.has(i) && r.sensors[i].type === type);
    if (!idx.length) return [];
    const limit = type !== "temperature" ? undefined : p.id === "gpu" ? limits.gpu : p.id === "cpu" ? limits.cpu : undefined;
    return [{ title: p.name.toLowerCase() === title.toLowerCase() ? p.name : `${p.name}, ${title.toLowerCase()}`, type, limit, series: idx.map((i, j) => ({ i, name: shortName(r.sensors[i].name, p.id), cls: colour(j) })) }];
  }));
}

/** The sensors a search finds, or every sensor with no search, in part order. */
function matchesOf(r: Recorded, query: string): number[] {
  const found = query ? new Set(findReadings(r.sensors.map((s, i) => ({ ...s, i })), query).map((s) => s.i)) : null;
  return r.parts.flatMap((p) => p.sensors.filter((i) => !found || found.has(i)));
}

/**
 * The search box, with a list under it of the sensors it finds, a part at a time, each with its reading now and a box
 * to tick, so you can chart a few side by side; one box ticks every sensor found. Ticked sensors stay ticked as you
 * search again, so you can gather them from different searches.
 */
function SensorFind({ r, query, onQuery, chosen, onChosen, nowOf }: {
  r: Recorded; query: string; onQuery: (q: string) => void;
  chosen: ReadonlySet<number>; onChosen: (c: ReadonlySet<number>) => void;
  nowOf: (i: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const all = useRef<HTMLInputElement>(null);
  const id = useId();
  const finding = query.trim();
  const matches = useMemo(() => matchesOf(r, finding), [r.sensors, r.parts, finding]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticked = matches.filter((i) => chosen.has(i)).length;
  useEffect(() => { if (all.current) all.current.indeterminate = ticked > 0 && ticked < matches.length; }, [ticked, matches.length]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      input.current?.focus();
    };
    document.addEventListener("click", click);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("click", click); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const flip = (i: number) => { const n = new Set(chosen); if (n.has(i)) n.delete(i); else n.add(i); onChosen(n); };
  const flipAll = () => {
    const n = new Set(chosen);
    if (ticked === matches.length) matches.forEach((i) => n.delete(i)); else matches.forEach((i) => n.add(i));
    onChosen(n);
  };
  const arrows = (e: KeyEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const boxes = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const at = boxes.indexOf(document.activeElement as HTMLInputElement);
    e.preventDefault();
    if (e.key === "ArrowUp" && at <= 0) { input.current?.focus(); return; }
    boxes[Math.max(0, Math.min(boxes.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };
  const groups = r.parts.map((p) => ({ p, items: matches.filter((i) => r.sensors[i].part === p.id) })).filter((g) => g.items.length);
  return (
    <div className="ln-search" ref={box}>
      <input ref={input} type="search" className="input" placeholder="Find sensors, like core 3" aria-label="Find a sensor" role="combobox"
        aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="dialog" value={query}
        onClick={() => setOpen(true)}
        onChange={(e) => { onQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => box.current?.querySelector<HTMLInputElement>('.ln-find-menu input[type="checkbox"]')?.focus());
        }} />
      {chosen.size > 0
        ? <span className="ln-find-picked"><span className="num">{chosen.size}</span> picked<button type="button" className="btn ghost sm" onClick={() => { onChosen(new Set()); input.current?.focus(); }}>Clear</button></span>
        : finding && <span className="faint num" aria-live="polite">{matches.length} of {r.sensors.length}</span>}
      {open && (
        <div className="sh-menu ln-find-menu" role="dialog" aria-label="Sensors" onKeyDown={arrows}>
          {matches.length > 0 ? <>
            <label className="ln-find-all">
              <input ref={all} type="checkbox" checked={ticked === matches.length} onChange={flipAll} />
              <span>{finding ? `Select all ${matches.length} found` : `Select all ${matches.length}`}</span>
            </label>
            <div className="ln-find-list" id={`${id}-list`}>
              {groups.map(({ p, items }) => (
                <fieldset key={p.id}>
                  <legend>{p.name}</legend>
                  {items.map((i) => (
                    <label key={i} className="ln-find-item">
                      <input type="checkbox" checked={chosen.has(i)} onChange={() => flip(i)} />
                      <span className="ln-find-name">{shortName(r.sensors[i].name, p.id)}</span>
                      <span className="ln-find-now num">{nowOf(i)}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </> : <p className="muted ln-find-none" id={`${id}-list`}>Nothing matches “{finding}”.</p>}
        </div>
      )}
    </div>
  );
}

/** One lane per part for a kind of reading, like every part's temperatures, each part's key lines drawn. */
function kindLanes(r: Recorded, kind: SensorType, limits: { cpu?: number; gpu?: number }): Lane[] {
  return r.parts.flatMap((p) => lanesFor(r, p.id, limits).filter((l) => l.type === kind).map((l) => ({ ...l, title: p.name })));
}

/** The kinds of reading that two or more parts chart, in a hardware monitor's order, with how many parts chart each. */
function sharedKinds(r: Recorded, limits: { cpu?: number; gpu?: number }) {
  const parts = new Map<SensorType, number>();
  for (const p of r.parts) for (const t of new Set(lanesFor(r, p.id, limits).map((l) => l.type))) parts.set(t as SensorType, (parts.get(t as SensorType) ?? 0) + 1);
  return sensorGroups.filter(([type]) => (parts.get(type) ?? 0) >= 2).map(([type, title]) => ({ type, title, parts: parts.get(type)! }));
}

type Pick = { part: string } | { kind: SensorType };

const Check = () => <svg className="sh-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Chevron = () => <svg className="ln-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/**
 * One button that opens a menu with two sides: Parts, to see one part with every sensor (or the whole PC), and Readings,
 * to see one kind of reading across every part. It opens on the side of what's shown, and a pick closes it.
 */
function ShowPicker({ pick, onPick, parts, kinds }: {
  pick: Pick; onPick: (p: Pick) => void;
  parts: { id: string; name: string; now?: string }[];
  kinds: { type: SensorType; title: string; parts: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"parts" | "readings">("kind" in pick ? "readings" : "parts");
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("click", click);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("click", click); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const whole = parts.find((p) => p.id === "all")?.name ?? "Whole PC";
  const label = "kind" in pick ? kinds.find((k) => k.type === pick.kind)?.title ?? "Readings" : parts.find((p) => p.id === pick.part)?.name ?? whole;
  const choose = (p: Pick) => { onPick(p); setOpen(false); btn.current?.focus(); };
  const toggle = () => { if (!open) setSide("kind" in pick ? "readings" : "parts"); setOpen(!open); };
  const arrows = (e: KeyEvent<HTMLElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (at + 1) % items.length : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0 || !items.length) return;
    e.preventDefault();
    items[to].focus();
  };
  const tab = (to: "parts" | "readings", text: string) => (
    <button type="button" role="tab" id={`${id}-${to}`} aria-selected={side === to} aria-controls={`${id}-list`} tabIndex={side === to ? 0 : -1} onClick={() => setSide(to)}>{text}</button>
  );
  return (
    <div className="ln-show" ref={box}>
      <button ref={btn} type="button" className="ln-show-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`Show ${label}${"kind" in pick ? ", every part" : ""}`} onClick={toggle}>
        <span className="ln-show-k">Show</span>
        <b>{label}</b>
        {"kind" in pick && <span className="ln-show-k">every part</span>}
        <Chevron />
      </button>
      {open && (
        <div className="sh-menu ln-menu" role="dialog" aria-label="Show">
          <div className="seg ln-sides" role="tablist" aria-label="Show by" onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const to = side === "parts" ? "readings" : "parts";
            setSide(to);
            document.getElementById(`${id}-${to}`)?.focus();
          }}>
            {tab("parts", "Parts")}
            {tab("readings", "Readings")}
          </div>
          <div className="ln-menu-list" role="menu" id={`${id}-list`} aria-labelledby={`${id}-${side}`} onKeyDown={arrows}>
            {side === "parts"
              ? parts.map((p) => {
                const on = "part" in pick && pick.part === p.id;
                return (
                  <button key={p.id} type="button" role="menuitemradio" aria-checked={on} onClick={() => choose({ part: p.id })}>
                    <span className="ln-menu-name">{p.name}</span>
                    {p.now && <span className="ln-menu-hint num">{p.now}</span>}
                    {on ? <Check /> : <i className="ln-menu-pad" aria-hidden="true" />}
                  </button>
                );
              })
              : kinds.map((k) => {
                const on = "kind" in pick && pick.kind === k.type;
                return (
                  <button key={k.type} type="button" role="menuitemradio" aria-checked={on} onClick={() => choose({ kind: k.type })}>
                    <span className="ln-menu-name">{k.title}</span>
                    <span className="ln-menu-hint">{k.parts} parts</span>
                    {on ? <Check /> : <i className="ln-menu-pad" aria-hidden="true" />}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Every sensor over a stretch, as a chart and a table in one. One picker says what to show: the whole PC, which opens
 * on each part's row as on Home over its main charts; one part, with all of its sensors; or one kind of reading across
 * every part. A search finds any sensor on the PC.
 */
export function AllSensors({ r, whole, from, to, limits, bands, marks, compact, live, liveSpan, week, device }: {
  r: Recorded; /** Every reading, not thinned, so the lowest and highest are exact. */ whole?: Recorded | null;
  from: number; to: number; limits: { cpu?: number; gpu?: number }; bands?: Band[]; marks?: ChartMark[]; compact?: boolean; live?: boolean;
  /** Live, how far back the chart reaches. */
  liveSpan?: number;
  /** Each part's usual from the last week, for the part rows. */
  week?: PartsView | null;
  /** A laptop's words and battery for the part rows. */
  device?: Device;
}) {
  const [picked, setPick] = useState<Pick>({ part: "all" });
  const [query, setQuery] = useState("");
  // Sensors ticked in the search's list, charted together in place of what the picker shows.
  const [chosen, setChosen] = useState<ReadonlySet<number>>(() => new Set());
  const [cursor, setCursor] = useState<number | null>(null);
  const finding = query.trim();
  const ticked = chosen.size > 0;
  const kinds = useMemo(() => sharedKinds(r, limits), [r.sensors, r.parts, limits.cpu, limits.gpu]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick: Pick = "kind" in picked && !kinds.some((k) => k.type === picked.kind) ? { part: "all" } : picked;
  const part = "part" in pick ? pick.part : "all";
  const kind = "kind" in pick ? pick.kind : null;
  const one = part !== "all" && !finding && !ticked;
  const shown = useMemo(() => (one ? withSummaries(r, part) : r), [r, part, one]);
  const stats = useMemo(() => {
    const src = whole ?? r;
    return statsOf((one ? withSummaries(src, part) : src).points, shown.sensors.length, from, to);
  }, [whole, r, part, one, shown.sensors.length, from, to]);
  const lanes = useMemo(() => (ticked ? foundLanes(r, chosen, limits) : finding ? foundLanes(r, new Set(matchesOf(r, finding)), limits) : kind ? kindLanes(shown, kind, limits) : lanesFor(shown, part, limits)).map((l) => ({ ...l, h: undefined })),
    [shown.sensors, shown.parts, part, kind, finding, chosen, ticked, limits.cpu, limits.gpu]); // eslint-disable-line react-hooks/exhaustive-deps
  const overview = part === "all" && !kind && !finding && !ticked;
  const lines = useMemo(() => partLines(whole ?? r, from, to, week ?? null, limits), [whole, r, from, to, week, limits.cpu, limits.gpu]); // eslint-disable-line react-hooks/exhaustive-deps
  const temp = useTemp();
  const parts = [{ id: "all", name: `Whole ${machineWord(device?.laptop ? "laptop" : undefined)}` }, ...r.parts.map((p) => {
    const l = lines.find((x) => x.id === p.id);
    return { id: p.id, name: p.name, now: device?.asleep?.includes(p.id) ? "Asleep" : l?.now != null ? value(temp, l.type, l.now) : undefined };
  })];
  const choose = (p: Pick) => { setPick(p); setQuery(""); setChosen(new Set()); };
  const nowOf = (i: number) => reading(temp, r.sensors[i].type, stats[i]?.last);
  return (
    <div className="ln-all">
      <div className="ln-bar">
        <ShowPicker pick={pick} onPick={choose} parts={parts} kinds={kinds} />
        <SensorFind r={r} query={query} onQuery={setQuery} chosen={chosen} onChosen={setChosen} nowOf={nowOf} />
      </div>
      {overview && lines.length > 0 && <PartSummary lines={lines} span={to - from} live={live} device={device} onPick={(id) => choose({ part: id })} />}
      {finding && !ticked && !lanes.length ? <p className="muted ln-none">No sensor matches “{finding}”. Try a part, like processor, a kind, like voltage, or a sensor, like core 3.</p>
        : <Lanes key={finding || ticked ? "find" : kind ?? part} points={shown.points} lanes={lanes} t0={from} t1={to} cursor={cursor} onCursor={setCursor} bands={bands} marks={marks} compact={compact} live={live} liveSpan={liveSpan} gapMs={live ? 20_000 : undefined} rows={stats} />}
    </div>
  );
}
