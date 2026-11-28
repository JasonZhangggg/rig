import type { CSSProperties } from "react";
import { HOT_MARGIN, cpuLimitByDesign, type BatteryView, type PCKind, type PartsView, type Recorded, type SensorType } from "@rig/core";
import { useTemp } from "../../state";
import { ASLEEP, bandAt, batteryWord, partJob } from "../overview/PartByPart";
import { value } from "./Lanes";
import { clock, clockSec } from "./words";
import { dateText } from "../../dateText";

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
  /** When it was highest, and lowest. */
  hiAt: number;
  loAt: number;
  /** The first reading in the stretch, so a battery can say whether it ran down or charged. */
  first: number;
  usual: { lo: number; hi: number } | null;
  limit: number | null;
  scale: { min: number; max: number };
  /** "design": a processor at its limit under load, as it's built to run (Home's cpuLimitByDesign). */
  state: "slowing" | "hot" | "design" | "above" | "calm";
  /** Its highest came close to where it slows down, and not as built: the highest is said in rust. */
  hiHot: boolean;
}

/** The processor, so one built to run at its limit reads as Home reads it: its name, the machine's kind, and whether Things to look at flags its heat. */
export interface CpuInfo { name: string; kind?: PCKind; hot?: boolean }

/**
 * Each part's main reading over a stretch, beside its usual from the week and where it slows itself down. Fans read as
 * the fastest fan at each moment, as Home counts them.
 */
export function partLines(r: Recorded, from: number, to: number, week: PartsView | null, limits: { cpu?: number; gpu?: number }, cpu?: CpuInfo): PartLine[] {
  // The processor's load at a moment, for whether its limit was reached as built.
  const cpuPart = r.parts.find((p) => p.id === "cpu");
  const loadIdx = cpuPart?.sensors.filter((i) => r.sensors[i].type === "load") ?? [];
  const load = loadIdx.find((i) => /total|usage/i.test(r.sensors[i].name)) ?? loadIdx[0];
  const loadAt = (t: number) => (load == null ? null : r.points.find((pt) => pt.t === t)?.v[load] ?? null);
  const byDesign = (t: number) => !!cpu && !cpu.hot && cpuLimitByDesign(cpu.name, cpu.kind, loadAt(t));
  return r.parts.flatMap((p): PartLine[] => {
    const type = r.sensors[p.lead].type;
    const idx = p.id === "fans" ? p.sensors.filter((i) => r.sensors[i].type === "fan") : [p.lead];
    let lo = Infinity, hi = -Infinity, hiAt = 0, loAt = 0, now: number | null = null, nowAt = 0, first: number | null = null;
    for (const pt of r.points) {
      if (pt.t < from || pt.t > to) continue;
      let v: number | null = null;
      for (const i of idx) { const x = pt.v[i]; if (x != null && (v == null || x > v)) v = x; }
      if (v == null) continue;
      now = v;
      nowAt = pt.t;
      first ??= v;
      if (v < lo) { lo = v; loAt = pt.t; }
      if (v > hi) { hi = v; hiAt = pt.t; }
    }
    if (now == null) return [];
    const row = week?.rows.find((x) => x.id === p.id || (p.id === "motherboard" && x.id === "board"));
    const same = row?.unit != null && row.unit === UNIT[type];
    const usual = same ? row!.usual : null;
    const own = type === "temperature" ? (p.id === "cpu" ? limits.cpu : p.id === "gpu" ? limits.gpu : undefined) : undefined;
    const limit = own ?? (same ? row!.limit : null) ?? null;
    const asBuilt = p.id === "cpu" && type === "temperature";
    const state: PartLine["state"] = limit != null && now >= limit - HOT_MARGIN && asBuilt && byDesign(nowAt) ? "design"
      : limit != null && now >= limit ? "slowing" : limit != null && now >= limit - HOT_MARGIN ? "hot" : usual && now > usual.hi ? "above" : "calm";
    const hiHot = limit != null && hi >= limit - HOT_MARGIN && !(asBuilt && byDesign(hiAt));
    return [{ id: p.id, name: p.name, type, now, lo, hi, hiAt, loAt, first: first!, usual, limit, state, hiHot, scale: scaleOf(type, [lo, hi, usual?.lo, usual?.hi], limit, same ? row!.scale : null) }];
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

/**
 * The kind of PC the rows are about, for a laptop's words, its battery now, and the parts asleep now (a laptop's
 * graphics chip switched off to save power) when the stretch runs up to now.
 */
export interface Device { laptop: boolean; battery?: BatteryView; asleep?: readonly string[]; cpu?: CpuInfo }

const share = (l: PartLine, v: number) => Math.max(0, Math.min(100, ((v - l.scale.min) / (l.scale.max - l.scale.min || 1)) * 100));

function Track({ l }: { l: PartLine }) {
  const pos = (v: number) => `${share(l, v)}%`;
  return (
    <span className="pbp-track" aria-hidden="true">
      {l.limit != null && l.limit < l.scale.max && <i className="pbp-zone" style={{ left: pos(l.limit) }} />}
      {l.usual && <i className="pbp-band" style={bandAt(share(l, l.usual.lo), share(l, l.usual.hi))} />}
      <i className="pbp-span" style={{ left: pos(l.lo), width: `max(2px, ${share(l, l.hi) - share(l, l.lo)}%)` } as CSSProperties} />
      {l.id !== "battery" && <i className={`pbp-high${l.hiHot ? " look" : ""}`} style={{ left: pos(l.hi) }} />}
      {l.now != null && <i className={`pbp-dot${l.state === "hot" || l.state === "slowing" ? " look" : ""}`} style={{ left: pos(l.now) }} />}
    </span>
  );
}

function stateWord(l: PartLine): { text: string; look?: boolean } {
  if (l.state === "slowing") return { text: "Slowing itself down", look: true };
  if (l.state === "hot") return { text: "Running hot", look: true };
  if (l.state === "design") return { text: "At its limit, as built" };
  if (l.state === "above") return { text: l.type === "load" ? "Fuller than usual" : l.type === "fan" ? "Faster than usual" : "Warmer than usual" };
  return { text: "Calm" };
}

/**
 * The whole PC over a stretch, a part to a row as on Home: its reading now, a track with its lowest to highest in the
 * stretch against its usual and where it slows down, and how it's doing in plain words. A row opens that part's charts.
 */
export function PartSummary({ lines, span, live, device, onPick }: { lines: PartLine[]; span: number; live?: boolean; device?: Device; onPick: (id: string) => void }) {
  const temp = useTemp();
  const laptop = device?.laptop ?? false;
  const said = (l: PartLine, v: number) => value(temp, l.type, v);
  const when = (t: number) => (span <= 30 * 60_000 ? clockSec(t) : span <= 864e5 ? clock(t) : dateText(new Date(t), { weekday: "short", hour: "numeric", minute: "2-digit" }));
  const range = (l: PartLine, a: number, b: number) => (Math.round(a) === Math.round(b) ? said(l, b) : `${said(l, a)} to ${said(l, b)}`);
  const anyUsual = lines.some((l) => l.usual);
  /** How it's doing, in a word, and the line under it. A battery says whether it's on battery and its drain, or how low it ran. */
  const doing = (l: PartLine): { head: { text: string; look?: boolean }; line: string; look?: boolean } => {
    if (l.id !== "battery") return { head: stateWord(l), line: `Highest ${said(l, l.hi)} at ${when(l.hiAt)}`, look: l.hiHot };
    const b = live ? device?.battery : undefined;
    const lowest = `Lowest ${said(l, l.lo)} at ${when(l.loAt)}`;
    const head = b?.state ? batteryWord[b.state] : Math.round(l.now!) < Math.round(l.first) ? "Ran down" : Math.round(l.now!) > Math.round(l.first) ? "Charged up" : "Held steady";
    return { head: { text: head }, line: b?.state === "discharging" && b.watts != null ? `Drawing ${b.watts} W` : lowest };
  };
  return (
    <section className="lp-parts" aria-label="Parts">
      <div className="pbp-cols" aria-hidden="true"><span>Part</span><span>{live ? "Now" : "Last"}</span><span>Lowest to highest</span><span>How it's doing</span></div>
      <ul className="pbp-list">
        {lines.map((line0) => {
          // Asleep now, a part has no reading now: its last one is from before it slept, so it keeps only its stretch.
          const asleep = !!device?.asleep?.includes(line0.id);
          const l: PartLine = asleep ? { ...line0, now: null, state: "calm" } : line0;
          const { head, line, look } = doing(line0);
          const s = asleep ? { text: ASLEEP } : head;
          const [num, unit] = l.now == null ? ["–", ""] : l.type === "fan" ? [Math.round(l.now).toLocaleString("en-US"), " rpm"] : [said(l, l.now), ""];
          return (
            <li key={l.id}>
              <button type="button" className="pbp-row" onClick={() => onPick(l.id)}>
                <span className="pbp-name"><b>{l.name}</b><span>{partJob(l.id, laptop)}</span></span>
                <span className="pbp-now"><b className="num">{num}{unit && <small>{unit}</small>}</b></span>
                <span className="pbp-week">
                  <Track l={l} />
                  <span>{range(l, l.lo, l.hi)}{l.usual ? `, usual ${range(l, l.usual.lo, l.usual.hi)}` : ""}</span>
                </span>
                <span className="pbp-state">
                  <b className={s.look ? "look" : undefined}>{s.text}</b>
                  <span className={look ? "look" : undefined}>{line}</span>
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
