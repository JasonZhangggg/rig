import type { CSSProperties } from "react";
import { tempMark, toUnit, type DayTemps, type TempSubject, type WeekTemps } from "@rig/core";
import { useTemp, useTempUnit } from "../../state";
import { CardHead, EmptyNote, Legend, longWeekday, useGrowOnce, weekday, type LegendMark } from "./parts";

export type TempsStyle = "caps" | "rows" | "big";
type Series = "idle" | "typical" | "peak";

export interface TempsOptions {
  style?: TempsStyle;
  /** Days to show, the newest last. */
  days?: number;
  show?: Partial<Record<Series, boolean>>;
  figure?: boolean;
  legend?: boolean;
  /** A small tile: the hottest figure over a strip of the days' peaks. */
  compact?: boolean;
}

const labels: Record<TempSubject, Record<Series, string>> = {
  gpu: { idle: "Idle processor", typical: "Graphics card, gaming", peak: "Graphics card, peak" },
  cpu: { idle: "Idle processor", typical: "Busy processor", peak: "Peak processor" },
};

const columns: Record<TempSubject, Record<Series, string>> = { gpu: { idle: "Idle", typical: "Gaming", peak: "Peak" }, cpu: { idle: "Idle", typical: "Busy", peak: "Peak" } };
const marks: Record<Series, LegendMark> = { idle: "c", typical: "a", peak: "b" };
const ALL: Series[] = ["idle", "typical", "peak"];

/** Gridlines every this many degrees of the viewer's unit. */
const STEP = 10;
/** Cooler days sit lower, 9 px per degree, squeezed so the coolest day drops no more than this. The stylesheet scales it to the tile. */
const MAX_LIFT = 90;
const PX_PER_DEG = 9;

const hasReadings = (d: DayTemps, series: Series[]) => series.some((s) => d[s] != null);
const leadOf = (series: Series[]): Series => (series.includes("peak") ? "peak" : series.includes("typical") ? "typical" : "idle");

function describe(days: DayTemps[], subject: TempSubject, series: Series[], temp: ReturnType<typeof useTemp>) {
  const l = labels[subject];
  return days.map((d) => {
    const figures = series.filter((s) => d[s] != null).map((s) => `${l[s]} ${temp(d[s])}`);
    return `${longWeekday(d.day)}: ${figures.length ? figures.join(", ") : "no readings"}`;
  }).join(". ");
}

interface ChartProps { days: DayTemps[]; subject: TempSubject; series: Series[]; peak: number | null; grow: boolean }

/** One column per day: a thin track holding peak, typical and idle as capsules, the cooler days lower. Missing figures leave a gap. */
function CapsuleChart({ days, subject, series, peak, grow }: ChartProps) {
  const temp = useTemp();
  const bare = (v: number) => temp(v, { mark: "none" });
  const lead = leadOf(series);
  const tops = days.map((d) => d[lead]).filter((v): v is number => v != null);
  const top = tops.length ? Math.max(...tops) : 0;
  const low = tops.length ? Math.min(...tops) : top;
  const perDeg = Math.min(PX_PER_DEG, MAX_LIFT / Math.max(1, top - low));
  const last = days.length - 1;
  const order = (["peak", "typical", "idle"] as Series[]).filter((s) => series.includes(s));
  return (
    <div className={`pl-caps${grow ? " grow" : ""}`} role="img" aria-label={describe(days, subject, series, temp)} style={{ "--n": days.length } as CSSProperties}>
      {days.map((d, i) => {
        const caps = order.flatMap((s) => (d[s] != null ? [<span key={s} className={`pl-cap ${marks[s]}${s === "peak" && d.peak === peak ? " top" : ""}`}>{bare(d[s]!)}</span>] : []));
        const lift = ((top - (d[lead] ?? low)) * perDeg) / MAX_LIFT;
        return (
          <div key={d.day} className={`pl-cap-col${i === last ? " today" : ""}`} style={{ "--i": i, "--lift": lift.toFixed(3) } as CSSProperties}>
            {hasReadings(d, series) && <div className="pl-cap-stack">{caps.flatMap((c, k) => (k ? [<i key={`dot${k}`} />, c] : [c]))}</div>}
            <small>{weekday(d.day)}</small>
          </div>
        );
      })}
    </div>
  );
}

/** One row per day: a line from idle to peak on a shared scale, with the figures in columns beside it. */
function RangeRows({ days, subject, series, peak, grow }: ChartProps) {
  const temp = useTemp();
  const unit = useTempUnit();
  const bare = (v: number | null) => (v == null ? "" : temp(v, { mark: "none" }));
  const all = days.flatMap((d) => series.map((s) => d[s])).filter((v): v is number => v != null).map((v) => toUnit(v, unit));
  const lo = Math.floor((Math.min(...all) - 1) / STEP) * STEP;
  const hi = Math.ceil((Math.max(...all) + 1) / STEP) * STEP;
  const at = (c: number) => ((toUnit(c, unit) - lo) / (hi - lo)) * 100;
  const ticks = Array.from({ length: (hi - lo) / STEP + 1 }, (_, k) => lo + k * STEP);
  const last = days.length - 1;
  return (
    <div className={`pl-rt${grow ? " grow" : ""}`} role="img" aria-label={describe(days, subject, series, temp)} style={{ "--ticks": ticks.length - 1, "--cols": series.length } as CSSProperties}>
      <div className="pl-rt-row pl-rt-head">
        <span />
        <span className="pl-rt-scale">{ticks.map((t) => <span key={t}>{t}°</span>)}</span>
        {series.map((s) => <span key={s}>{columns[subject][s]}</span>)}
      </div>
      {days.map((d, i) => {
        const shown = series.map((s) => d[s]).filter((v): v is number => v != null);
        const from = Math.min(...shown), to = Math.max(...shown);
        return (
          <div key={d.day} className={`pl-rt-row${i === last ? " today" : ""}`} style={{ "--i": i } as CSSProperties}>
            <span className="pl-rt-day">{weekday(d.day)}</span>
            <span className="pl-rt-plot">
              {shown.length > 1 && <i className="pl-rt-range" style={{ left: `${at(from)}%`, width: `${at(to) - at(from)}%` }} />}
              {series.map((s) => d[s] != null && <i key={s} className={`pl-rt-mark ${marks[s]}`} style={{ left: `${at(d[s]!)}%` }} />)}
            </span>
            {series.map((s) => <span key={s} className={`pl-rt-n${s === "peak" ? " b" : ""}${s === "peak" && d.peak != null && d.peak === peak ? " top" : ""}`}>{bare(d[s])}</span>)}
          </div>
        );
      })}
    </div>
  );
}

/** Each day's lead figure large, with the others small under it. */
function BigNumbers({ days, subject, series, peak, grow }: ChartProps) {
  const temp = useTemp();
  const lead = leadOf(series);
  const rest = series.filter((s) => s !== lead);
  const last = days.length - 1;
  const vals = days.map((d) => d[lead]).filter((v): v is number => v != null);
  const lo = Math.min(...vals) - 10, hi = Math.max(...vals);
  return (
    <div className={`pl-big${grow ? " grow" : ""}`} role="img" aria-label={describe(days, subject, series, temp)} style={{ "--n": days.length } as CSSProperties}>
      {days.map((d, i) => (
        <div key={d.day} className={`pl-big-day${i === last ? " today" : ""}`} style={{ "--i": i } as CSSProperties}>
          <small>{weekday(d.day)}</small>
          <i className={`pl-big-bar${lead === "peak" && d.peak != null && d.peak === peak ? " top" : ""}`}><i style={{ height: d[lead] == null ? 0 : `${Math.max(6, ((d[lead]! - lo) / Math.max(1, hi - lo)) * 100)}%` }} /></i>
          <b className={lead === "peak" && d.peak != null && d.peak === peak ? "top" : undefined}>{d[lead] == null ? "" : temp(d[lead], { mark: "degree" })}</b>
          {rest.map((s) => <span key={s}><i className={marks[s]} />{d[s] == null ? "" : temp(d[s], { mark: "degree" })}</span>)}
        </div>
      ))}
    </div>
  );
}

/** A strip of the days' lead figures for a small tile, the hottest day marked. */
function PeakStrip({ days, subject, series, peak }: ChartProps) {
  const temp = useTemp();
  const lead = leadOf(series);
  const vals = days.map((d) => d[lead]).filter((v): v is number => v != null);
  const lo = Math.min(...vals) - 8, hi = Math.max(...vals);
  return (
    <div className="pl-strip" role="img" aria-label={describe(days, subject, [lead], temp)}>
      {days.map((d) => (
        <span key={d.day} className={d[lead] != null && d[lead] === peak ? "top" : undefined}>
          <i style={{ height: d[lead] == null ? 0 : `${Math.max(8, ((d[lead]! - lo) / Math.max(1, hi - lo)) * 100)}%` }} />
          <small>{weekday(d.day).slice(0, 2)}</small>
        </span>
      ))}
    </div>
  );
}

const charts: Record<TempsStyle, (p: ChartProps) => JSX.Element> = { caps: CapsuleChart, rows: RangeRows, big: BigNumbers };

/** The week's temperatures per day. `temps` is null while history loads. */
export function TempsCard({ temps, name, style = "caps", days: count = 7, show, figure = true, legend = true, compact = false }: { temps: WeekTemps | null; name: string } & TempsOptions) {
  const grow = useGrowOnce(`home-temps-${style}`);
  const temp = useTemp();
  const unit = useTempUnit();
  const subject = temps?.subject ?? "gpu";
  const picked = ALL.filter((s) => show?.[s] !== false);
  const series = picked.length ? picked : ["peak" as Series];
  const days = temps ? temps.days.slice(-Math.max(1, count)) : [];
  const peaks = days.map((d) => d.peak).filter((v): v is number => v != null);
  const peak = peaks.length ? Math.max(...peaks) : null;
  const any = days.some((d) => hasReadings(d, series));
  const Chart = compact ? PeakStrip : charts[style];
  const note = compact ? `${columns[subject][leadOf(series)]} each day, ${tempMark(unit)}` : count === 7 ? `Each day, ${tempMark(unit)}` : `Last ${count} days, ${tempMark(unit)}`;
  return (
    <section className={`f-pane bl-temps${compact ? " compact" : ""}`} aria-busy={!temps || undefined}>
      <CardHead title="Temperatures" note={note} figure={figure && any && peak != null ? { value: temp(peak), label: "Hottest", tone: "look" } : undefined} />
      {!temps && <div className="pl-wait" aria-hidden="true" />}
      {temps && (any ? (
        <>
          <Chart days={days} subject={subject} series={series} peak={peak} grow={grow} />
          {legend && !compact && <Legend items={series.map((s) => [marks[s], labels[subject][s]])} />}
        </>
      ) : (
        <EmptyNote>Rig is still learning this week. Each day's temperatures show up here once {name} has run for a while.</EmptyNote>
      ))}
    </section>
  );
}
