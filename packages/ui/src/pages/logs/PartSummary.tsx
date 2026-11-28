import type { CSSProperties } from "react";
import { HOT_MARGIN, type PartsView, type Recorded, type SensorType } from "@rig/core";
import { useTemp } from "../../state";
import { value } from "./Lanes";
import { clock, clockSec } from "./words";
import { dateText } from "../../dateText";

/** What each part does for you, as Home's part-by-part list says it. */
const JOB: Record<string, string> = {
  gpu: "Draws every frame of your games",
  cpu: "Runs your games and Windows",
  ram: "Keeps what's open close at hand",
  ssd: "Holds Windows, your games and files",
  motherboard: "Connects every part and shares out power",
  fans: "Move air through the case",
  battery: "Runs the laptop away from the wall",
};

/** The unit Home's part-by-part list keeps for each kind of reading, so a usual band is only borrowed when it matches. */
const UNIT: Partial<Record<SensorType, string>> = { temperature: "temp", load: "percent", fan: "rpm" };

/** One part over a stretch: its reading at the end, its lowest and highest, and its usual and limit from the week. */
export interface PartLine {
  id: string;
  name: string;
  type: SensorType;
  now: number | null;
  lo: number;
  hi: number;
  /** When it was highest. */
  hiAt: number;
  usual: { lo: number; hi: number } | null;
  limit: number | null;
  scale: { min: number; max: number };
  state: "slowing" | "hot" | "above" | "calm";
}

/**
 * Each part's main reading over a stretch, beside its usual from the week and where it slows itself down. Fans read as
 * the fastest fan at each moment, as Home counts them.
 */
export function partLines(r: Recorded, from: number, to: number, week: PartsView | null, limits: { cpu?: number; gpu?: number }): PartLine[] {
  return r.parts.flatMap((p): PartLine[] => {
    const type = r.sensors[p.lead].type;
    const idx = p.id === "fans" ? p.sensors.filter((i) => r.sensors[i].type === "fan") : [p.lead];
    let lo = Infinity, hi = -Infinity, hiAt = 0, now: number | null = null;
    for (const pt of r.points) {
      if (pt.t < from || pt.t > to) continue;
      let v: number | null = null;
      for (const i of idx) { const x = pt.v[i]; if (x != null && (v == null || x > v)) v = x; }
      if (v == null) continue;
      now = v;
      if (v < lo) lo = v;
      if (v > hi) { hi = v; hiAt = pt.t; }
    }
    if (now == null) return [];
    const row = week?.rows.find((x) => x.id === p.id || (p.id === "motherboard" && x.id === "board"));
    const same = row?.unit != null && row.unit === UNIT[type];
    const usual = same ? row!.usual : null;
    const own = type === "temperature" ? (p.id === "cpu" ? limits.cpu : p.id === "gpu" ? limits.gpu : undefined) : undefined;
    const limit = own ?? (same ? row!.limit : null) ?? null;
    const state: PartLine["state"] = limit != null && now >= limit ? "slowing" : limit != null && now >= limit - HOT_MARGIN ? "hot" : usual && now > usual.hi ? "above" : "calm";
    return [{ id: p.id, name: p.name, type, now, lo, hi, hiAt, usual, limit, state, scale: scaleOf(type, [lo, hi, usual?.lo, usual?.hi], limit, same ? row!.scale : null) }];
  });
}

const up = (v: number, step: number) => Math.ceil(v / step) * step;
const down = (v: number, step: number) => Math.floor(v / step) * step;

/** The ends of a part's track: Home's own scale where there is one, widened to take in the stretch. */
function scaleOf(type: SensorType, seen: (number | undefined)[], limit: number | null, home: { min: number; max: number } | null) {
  const xs = seen.filter((v): v is number => v != null);
  if (type === "load" || type === "level" || type === "control") return { min: 0, max: 100 };
  if (type === "fan") return { min: 0, max: up(Math.max(home?.max ?? 0, ...xs, 1000), 500) };
  const top = Math.max(...xs, limit ?? 0);
  const min = Math.min(home?.min ?? Infinity, 20, down(Math.min(...xs), 10));
  const max = Math.max(home?.max ?? 0, up(limit != null ? Math.max(limit + 10, top + 4) : top + 15, 5));
  return { min, max };
}

const share = (l: PartLine, v: number) => Math.max(0, Math.min(100, ((v - l.scale.min) / (l.scale.max - l.scale.min || 1)) * 100));

function Track({ l }: { l: PartLine }) {
  const pos = (v: number) => `${share(l, v)}%`;
  return (
    <span className="pbp-track" aria-hidden="true">
      {l.limit != null && l.limit < l.scale.max && <i className="pbp-zone" style={{ left: pos(l.limit) }} />}
      {l.usual && <i className="pbp-band" style={{ left: pos(l.usual.lo), width: `max(4px, ${share(l, l.usual.hi) - share(l, l.usual.lo)}%)` } as CSSProperties} />}
      <i className="pbp-span" style={{ left: pos(l.lo), width: `max(2px, ${share(l, l.hi) - share(l, l.lo)}%)` } as CSSProperties} />
      <i className={`pbp-high${l.limit != null && l.hi >= l.limit - HOT_MARGIN ? " look" : ""}`} style={{ left: pos(l.hi) }} />
      {l.now != null && <i className={`pbp-dot${l.state === "hot" || l.state === "slowing" ? " look" : ""}`} style={{ left: pos(l.now) }} />}
    </span>
  );
}

function stateWord(l: PartLine): { text: string; look?: boolean } {
  if (l.state === "slowing") return { text: "Slowing itself down", look: true };
  if (l.state === "hot") return { text: "Running hot", look: true };
  if (l.state === "above") return { text: l.type === "load" ? "Fuller than usual" : l.type === "fan" ? "Faster than usual" : "Warmer than usual" };
  return { text: "Calm" };
}

/**
 * The whole PC over a stretch, a part to a row as on Home: its reading now, a track with its lowest to highest in the
 * stretch against its usual and where it slows down, and how it's doing in plain words. A row opens that part's charts.
 */
export function PartSummary({ lines, span, live, onPick }: { lines: PartLine[]; span: number; live?: boolean; onPick: (id: string) => void }) {
  const temp = useTemp();
  const said = (l: PartLine, v: number) => value(temp, l.type, v);
  const when = (t: number) => (span <= 30 * 60_000 ? clockSec(t) : span <= 864e5 ? clock(t) : dateText(new Date(t), { weekday: "short", hour: "numeric", minute: "2-digit" }));
  const range = (l: PartLine, a: number, b: number) => (Math.round(a) === Math.round(b) ? said(l, b) : `${said(l, a)} to ${said(l, b)}`);
  const anyUsual = lines.some((l) => l.usual);
  return (
    <section className="lp-parts" aria-label="Parts">
      <div className="pbp-cols" aria-hidden="true"><span>Part</span><span>{live ? "Now" : "Last"}</span><span>Lowest to highest</span><span>How it's doing</span></div>
      <ul className="pbp-list">
        {lines.map((l) => {
          const s = stateWord(l);
          const close = l.limit != null && l.hi >= l.limit - HOT_MARGIN;
          return (
            <li key={l.id}>
              <button type="button" className="pbp-row" onClick={() => onPick(l.id)}>
                <span className="pbp-name"><b>{l.name}</b><span>{JOB[l.id] ?? ""}</span></span>
                <span className="pbp-now"><b className="num">{l.now == null ? "–" : said(l, l.now)}</b></span>
                <span className="pbp-week">
                  <Track l={l} />
                  <span>{range(l, l.lo, l.hi)}{l.usual ? `, usual ${range(l, l.usual.lo, l.usual.hi)}` : ""}</span>
                </span>
                <span className="pbp-state">
                  <b className={s.look ? "look" : undefined}>{s.text}</b>
                  <span className={close ? "look" : undefined}>Highest {said(l, l.hi)} at {when(l.hiAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="pbp-key" aria-hidden="true">
        <span><i className="k-now" />{live ? "Now" : "Last reading"}</span>
        <span><i className="k-span" />Lowest to highest</span>
        {anyUsual && <span><i className="k-band" />Its usual this week</span>}
        <span><i className="k-zone" />Where it slows itself down</span>
      </div>
    </section>
  );
}
