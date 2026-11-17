import { useEffect, useState, type CSSProperties } from "react";
import { games, history, type PC } from "../../data";
import { extras } from "./shared";

/* ---------- Derived series for the Pulse charts (sample data) ---------- */

export interface DayTemps { d: string; idle: number; typical: number; peak: number }
export interface Session { d: string; label: string; mark: string; start: number; hours: number; kind: "normal" | "hot" | "background" }
export interface StatProps { value: string; unit?: string; label: string; dir: "up" | "down"; tone: "warn" | "ok" | "plain" }

const ex = (pc: PC) => extras[pc.id] ?? extras.atlas;
const week = history(7).slice(0, 7 * 24);

function idleOf(pc: PC) {
  const note = pc.stats?.find((s) => s.label === "CPU")?.note ?? "";
  const m = /idle (\d+)/.exec(note);
  return m ? +m[1] : (pc.parts?.cpu?.temp ?? 58) - 20;
}

/** Per day: processor at idle, graphics card while gaming, graphics card peak. */
export function weekTemps(pc: PC): DayTemps[] {
  const idle = idleOf(pc);
  return ex(pc).week.map((w, i) => ({
    d: w.d,
    idle: idle + ((i * 5) % 3) - 1,
    typical: w.peak - 5 - ((i * 3) % 4),
    peak: w.peak,
  }));
}

export const tempLabels = (pc: PC) => pc.kind === "laptop"
  ? { idle: "Idle processor", typical: "Busy processor", peak: "Peak processor" }
  : { idle: "Idle processor", typical: "Graphics card, gaming", peak: "Graphics card, peak" };

/** Evening sessions, one per day. Start and length in hours after 6 PM. */
const plans: Record<string, [number, string, number, number, Session["kind"]][]> = {
  atlas: [
    [0, "Baldur's Gate 3", 0.5, 3, "normal"],
    [1, "Counter-Strike 2", 1, 2, "normal"],
    [2, "Cyberpunk 2077", 0.5, 4, "hot"],
    [3, "Baldur's Gate 3", 0, 5, "normal"],
    [4, "Windows update", 2, 1, "background"],
    [5, "Counter-Strike 2", 1.5, 2, "normal"],
    [6, "Cyberpunk 2077", 1, 4, "hot"],
  ],
  pebble: [
    [0, "Video call", 0, 1.5, "normal"],
    [1, "Photo export", 0.5, 2, "hot"],
    [2, "Video call", 1, 1, "normal"],
    [3, "Windows update", 2.5, 1, "background"],
    [4, "Browsing", 0, 2.5, "normal"],
    [5, "Photo export", 1, 2.5, "hot"],
    [6, "Video call", 0.5, 1.5, "normal"],
  ],
};

const initials = (name: string) => name.split(/[\s-]+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function weekSessions(pc: PC): Session[] {
  const days = ex(pc).week.map((w) => w.d);
  return (plans[pc.id] ?? plans.atlas).map(([i, label, start, hours, kind]) => ({
    d: days[i], label, start, hours, kind,
    mark: games.some((g) => g.name === label) ? initials(label) : label[0],
  }));
}

/** Six-hour buckets of the week: average processor and graphics card temperature. */
export function healthSeries(): { cpu: number[]; gpu: number[] } {
  const cpu: number[] = [], gpu: number[] = [];
  for (let i = 0; i < week.length; i += 6) {
    const b = week.slice(i, i + 6);
    cpu.push(b.reduce((a, p) => a + p.cpu, 0) / b.length);
    gpu.push(b.reduce((a, p) => a + p.gpu, 0) / b.length);
  }
  return { cpu, gpu };
}

/** Fan load (0 to 1) per six-hour slice over the last four days, from the hottest reading in each slice. */
export function fanColumns(n = 16): number[] {
  const out: number[] = [];
  const from = week.length - n * 6;
  for (let i = 0; i < n; i++) {
    const hot = Math.max(...week.slice(from + i * 6, from + i * 6 + 6).map((p) => p.gpu));
    out.push(Math.min(1, Math.max(0.12, (hot - 30) / 55)));
  }
  return out;
}

export function healthStats(pc: PC): StatProps[] {
  if (pc.kind === "laptop") return [
    { value: "89", unit: "%", label: "Battery", dir: "down", tone: "warn" },
    { value: `${idleOf(pc)}`, unit: "°C", label: "Idle", dir: "down", tone: "ok" },
  ];
  return [
    { value: "+9", unit: "°C", label: "Graphics", dir: "up", tone: "warn" },
    { value: `${idleOf(pc)}`, unit: "°C", label: "Idle", dir: "down", tone: "ok" },
  ];
}

export function fanStats(pc: PC): StatProps[] {
  const fans = [...ex(pc).fans].sort((a, b) => b.rpm / b.max - a.rpm / a.max);
  const k = (rpm: number) => (rpm / 1000).toFixed(1);
  const top = fans[0], low = fans[fans.length - 1];
  return [
    { value: k(top.rpm), unit: "k", label: top.label, dir: "up", tone: top.rpm / top.max > 0.75 ? "warn" : "plain" },
    { value: k(low.rpm), unit: "k", label: low.label, dir: "down", tone: "ok" },
  ];
}

/* ---------- Motion: charts grow in once per session ---------- */

const grown = new Set<string>();
export function useGrowOnce(key: string) {
  const [grow] = useState(() => !grown.has(key));
  useEffect(() => { grown.add(key); }, [key]);
  return grow;
}

/* ---------- Pieces ---------- */

export const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const Check = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17l9-10" /></svg>;

export function Stat({ value, unit, label, dir, tone }: StatProps) {
  return (
    <div className={`pl-stat ${tone}`}>
      <i className={`pl-tri ${dir}`} aria-hidden="true" />
      <b>{value}{unit && <small>{unit}</small>}</b>
      <span>{label}<span className="sr-only">{dir === "up" ? ", going up" : ", going down"}</span></span>
    </div>
  );
}

function smooth(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Two squiggly lines that run off the bottom edge of the card. */
export function Sparkline2({ a, b, label }: { a: number[]; b: number[]; label: string }) {
  const w = 300, h = 90;
  const all = [...a, ...b];
  const min = Math.min(...all), max = Math.max(...all);
  const toPts = (v: number[]) => v.map((x, i): [number, number] => [(i / (v.length - 1)) * w, 8 + (1 - (x - min) / (max - min || 1)) * (h - 8)]);
  return (
    <svg className="pl-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={smooth(toPts(a))} className="pl-spark-a" vectorEffect="non-scaling-stroke" />
      <path d={smooth(toPts(b))} className="pl-spark-b" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Columns of dots. Lit dots are colored by how high they sit: slow, medium, fast. */
export function DotMatrix({ values, rows = 6, label }: { values: number[]; rows?: number; label: string }) {
  const gap = 18, r = 4.6;
  const w = values.length * gap, h = rows * gap;
  return (
    <svg className="pl-dots" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMax meet" role="img" aria-label={label}>
      {values.map((v, c) => {
        const lit = Math.max(1, Math.round(v * rows));
        return Array.from({ length: rows }, (_, k) => {
          const band = k < lit ? (k >= rows - 2 ? "b" : k >= 2 ? "a" : "c") : "off";
          return <circle key={`${c}-${k}`} cx={c * gap + gap / 2} cy={h - k * gap - gap / 2} r={r} className={`pl-dot ${band}`} />;
        });
      })}
    </svg>
  );
}

/** One column per day: a thin track with three stacked capsules (peak, typical, idle). */
export function CapsuleChart({ days, label, grow }: { days: DayTemps[]; label: string; grow: boolean }) {
  const top = Math.max(...days.map((d) => d.peak));
  return (
    <div className={`pl-caps${grow ? " grow" : ""}`} role="img" aria-label={label}>
      {days.map((d, i) => (
        <div key={d.d} className={`pl-cap-col${i === days.length - 1 ? " today" : ""}`} style={{ "--i": i, "--lift": `${(top - d.peak) * 9}px` } as CSSProperties}>
          <div className="pl-cap-stack">
            <span className="pl-cap b">{d.peak}</span><i />
            <span className="pl-cap a">{d.typical}</span><i />
            <span className="pl-cap c">{d.idle}</span>
          </div>
          <small>{d.d}</small>
        </div>
      ))}
    </div>
  );
}

/** One row per day: a capsule bar with an icon at the left end and the hours at the right. */
export function CapsuleTimeline({ rows, max = 6, grow }: { rows: Session[]; max?: number; grow: boolean }) {
  const kindText = { normal: "", hot: ", ran hot", background: ", background task" };
  return (
    <div className={`pl-tl${grow ? " grow" : ""}`} style={{ "--max": max } as CSSProperties}>
      <ul className="pl-tl-rows">
        {rows.map((s, i) => (
          <li key={s.d} className="pl-tl-row" style={{ "--i": i } as CSSProperties}>
            <span className="pl-tl-day">{s.d}</span>
            <span className="pl-tl-lane">
              <span className={`pl-tl-bar ${s.kind}`} style={{ left: `${(s.start / max) * 100}%`, width: `${(s.hours / max) * 100}%` }} title={`${s.label}, ${s.hours} h${kindText[s.kind]}`}>
                <i aria-hidden="true">{s.mark}</i>
                <span className="sr-only">{s.label}{kindText[s.kind]}, </span>
                <b>{s.hours}<span className="sr-only"> hours</span></b>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="pl-tl-axis" aria-hidden="true">
        <span />
        <span className="pl-tl-ticks">{Array.from({ length: max + 1 }, (_, h) => <span key={h}>{h}</span>)}</span>
      </div>
    </div>
  );
}

export function Legend({ items, total }: { items: [string, string][]; total?: [string, string] }) {
  return (
    <div className="pl-legend">
      {items.map(([cls, text]) => <span key={text}><i className={cls} />{text}</span>)}
      {total && <span className="pl-total">{total[0]} <b>{total[1]}</b></span>}
    </div>
  );
}

/* ---------- Dot-matrix figures and capsule bars (Paper and Signature) ---------- */

const glyphs: Record<string, string[]> = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
};

/** A number drawn on a 5 x 7 dot grid per digit. Lit dots are the value, faint dots keep the grid visible. */
export function DotDigits({ value, label, grow }: { value: string; label: string; grow: boolean }) {
  const chars = [...value].filter((c) => glyphs[c]);
  const step = 12, r = 4.4, cols = chars.length * 6 - 1;
  return (
    <svg className={`pl-digits${grow ? " grow" : ""}`} viewBox={`0 0 ${cols * step} ${7 * step}`} role="img" aria-label={label}>
      {chars.map((c, n) => glyphs[c].map((row, y) => [...row].map((on, x) => (
        <circle key={`${n}-${x}-${y}`} cx={(n * 6 + x) * step + step / 2} cy={y * step + step / 2} r={r} className={on === "#" ? "on" : "off"} />
      ))))}
    </svg>
  );
}

export interface DayBar { d: string; v: number; kind: "past" | "peak" | "forecast" }

/** The week's peaks so far, the hottest day marked, then three expected days. */
export function peakBars(pc: PC): DayBar[] {
  const week = ex(pc).week;
  const top = Math.max(...week.map((w) => w.peak));
  const last3 = week.slice(-3).reduce((a, w) => a + w.peak, 0) / 3;
  const peakAt = week.findIndex((w) => w.peak === top);
  const past = week.map((w, i): DayBar => ({ d: w.d, v: w.peak, kind: i === peakAt ? "peak" : "past" }));
  const ahead = [0, 1, 2].map((i): DayBar => ({ d: week[i].d, v: Math.round(last3 + [0, 1, -1][i]), kind: "forecast" }));
  return [...past, ...ahead];
}

/** Rounded vertical bars, one per day, height by value. */
export function CapsuleBars({ bars, label, grow }: { bars: DayBar[]; label: string; grow: boolean }) {
  const vals = bars.map((b) => b.v);
  const lo = Math.min(...vals) - 14, hi = Math.max(...vals);
  return (
    <div className={`pl-vbars${grow ? " grow" : ""}`} role="img" aria-label={label}>
      {bars.map((b, i) => (
        <div key={`${b.d}-${i}`} className={`pl-vbar-col ${b.kind}`} style={{ "--i": i } as CSSProperties}>
          <span className="pl-vbar-track"><span className="pl-vbar" style={{ height: `${Math.max(28, ((b.v - lo) / (hi - lo)) * 100)}%` }}><b>{b.v}</b></span></span>
          <small>{b.d}</small>
        </div>
      ))}
    </div>
  );
}
