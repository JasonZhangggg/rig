import type { CSSProperties } from "react";
import { tempMark, type DayTemps, type TempSubject, type WeekTemps } from "@rig/core";
import { useTemp, useTempUnit } from "../../state";
import { CardHead, EmptyNote, Legend, longWeekday, useGrowOnce, weekday } from "./parts";

const labels: Record<TempSubject, { idle: string; typical: string; peak: string }> = {
  gpu: { idle: "Idle processor", typical: "Graphics card, gaming", peak: "Graphics card, peak" },
  cpu: { idle: "Idle processor", typical: "Busy processor", peak: "Peak processor" },
};

/** The strips share a scale from the week's coolest to its hottest figure, in steps of ten degrees. */
const STEP = 10;

const hasReadings = (d: DayTemps) => d.idle != null || d.typical != null || d.peak != null;

function describe(w: WeekTemps, temp: ReturnType<typeof useTemp>) {
  const l = labels[w.subject];
  return w.days.map((d) => {
    const figures = ([[l.idle, d.idle], [l.typical, d.typical], [l.peak, d.peak]] as const).filter(([, v]) => v != null).map(([k, v]) => `${k} ${temp(v)}`);
    return `${longWeekday(d.day)}: ${figures.length ? figures.join(", ") : "no readings"}`;
  }).join(". ");
}

/** A day's warmth as a strip: idle where it starts, brass up to the usual busy temperature, rust on to the peak. */
function Strip({ d, lo, hi }: { d: DayTemps; lo: number; hi: number }) {
  const from = d.idle ?? d.typical ?? d.peak;
  if (from == null) return <span className="pl-strip" />;
  const mid = d.typical ?? d.peak ?? from;
  const to = d.peak ?? mid;
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const span = (a: number, b: number) => ({ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` });
  return (
    <span className="pl-strip">
      {mid > from && <i className="a" style={span(from, mid)} />}
      {to > mid && <i className="b" style={span(mid, to)} />}
      {d.idle != null && <i className="c" style={{ left: `${pct(d.idle)}%` }} />}
    </span>
  );
}

/** One row per day: the day, its strip on a shared scale, then idle, typical and peak as numbers. Missing figures leave a gap. */
function DayRows({ temps, grow }: { temps: WeekTemps; grow: boolean }) {
  const temp = useTemp();
  const bare = (v: number | null) => (v == null ? "" : temp(v, { mark: "none" }));
  const all = temps.days.flatMap((d) => [d.idle, d.typical, d.peak]).filter((v): v is number => v != null);
  const lo = Math.floor(Math.min(...all) / STEP) * STEP;
  const hi = Math.max(lo + STEP, Math.ceil(Math.max(...all) / STEP) * STEP);
  const last = temps.days.length - 1;
  return (
    <div className={`pl-days${grow ? " grow" : ""}`}>
      <div className="pl-day pl-scale" aria-hidden="true">
        <span />
        <span className="pl-scale-ends"><span>{temp(lo, { mark: "degree" })}</span><span>{temp(hi, { mark: "degree" })}</span></span>
        <span>Idle</span><span>Busy</span><span>Peak</span>
      </div>
      <div role="img" aria-label={describe(temps, temp)}>
        {temps.days.map((d, i) => (
          <div key={d.day} className={`pl-day${i === last ? " today" : ""}`} style={{ "--i": i } as CSSProperties}>
            <span className="pl-day-name">{weekday(d.day)}</span>
            <Strip d={d} lo={lo} hi={hi} />
            <span className="pl-num c">{bare(d.idle)}</span>
            <span className="pl-num a">{bare(d.typical)}</span>
            <span className={`pl-num b${d.peak != null && d.peak === temps.peak ? " top" : ""}`}>{bare(d.peak)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The week's temperatures per day. `temps` is null while history loads. */
export function TempsCard({ temps, name }: { temps: WeekTemps | null; name: string }) {
  const grow = useGrowOnce("home-temps");
  const temp = useTemp();
  const unit = useTempUnit();
  const l = labels[temps?.subject ?? "gpu"];
  return (
    <section className="f-pane bl-temps">
      <CardHead title="Temperatures" note={`Each day, ${tempMark(unit)}`} figure={temps?.peak != null ? { value: temp(temps.peak), label: "Hottest", tone: "look" } : undefined} />
      {temps && (temps.days.some(hasReadings) ? (
        <>
          <DayRows temps={temps} grow={grow} />
          <Legend items={[["c", l.idle], ["a", l.typical], ["b", l.peak]]} />
        </>
      ) : (
        <EmptyNote>Rig is still learning this week. Each day's temperatures show up here once {name} has run for a while.</EmptyNote>
      ))}
    </section>
  );
}
