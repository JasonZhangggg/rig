import type { CSSProperties } from "react";
import { tempMark, toUnit, type DayTemps, type TempSubject, type WeekTemps } from "@rig/core";
import { useTemp, useTempUnit } from "../../state";
import { CardHead, EmptyNote, Legend, longWeekday, useGrowOnce, weekday } from "./parts";

const labels: Record<TempSubject, { idle: string; typical: string; peak: string }> = {
  gpu: { idle: "Idle processor", typical: "Graphics card, gaming", peak: "Graphics card, peak" },
  cpu: { idle: "Idle processor", typical: "Busy processor", peak: "Peak processor" },
};

const columns: Record<TempSubject, [string, string, string]> = { gpu: ["Idle", "Gaming", "Peak"], cpu: ["Idle", "Busy", "Peak"] };

/** Gridlines every this many degrees of the viewer's unit. */
const STEP = 10;

const hasReadings = (d: DayTemps) => d.idle != null || d.typical != null || d.peak != null;

function describe(w: WeekTemps, temp: ReturnType<typeof useTemp>) {
  const l = labels[w.subject];
  return w.days.map((d) => {
    const figures = ([[l.idle, d.idle], [l.typical, d.typical], [l.peak, d.peak]] as const).filter(([, v]) => v != null).map(([k, v]) => `${k} ${temp(v)}`);
    return `${longWeekday(d.day)}: ${figures.length ? figures.join(", ") : "no readings"}`;
  }).join(". ");
}

/** One row per day: a line from idle to peak on a shared scale, with the three figures in columns beside it. Missing figures leave a gap. */
function RangeRows({ temps, grow }: { temps: WeekTemps; grow: boolean }) {
  const temp = useTemp();
  const unit = useTempUnit();
  const bare = (v: number | null) => (v == null ? "" : temp(v, { mark: "none" }));
  const all = temps.days.flatMap((d) => [d.idle, d.typical, d.peak]).filter((v): v is number => v != null).map((v) => toUnit(v, unit));
  const lo = Math.floor((Math.min(...all) - 1) / STEP) * STEP;
  const hi = Math.ceil((Math.max(...all) + 1) / STEP) * STEP;
  const at = (c: number) => ((toUnit(c, unit) - lo) / (hi - lo)) * 100;
  const ticks = Array.from({ length: (hi - lo) / STEP + 1 }, (_, k) => lo + k * STEP);
  const [idle, typical, peak] = columns[temps.subject];
  const last = temps.days.length - 1;
  return (
    <div className={`pl-rt${grow ? " grow" : ""}`} role="img" aria-label={describe(temps, temp)} style={{ "--ticks": ticks.length - 1 } as CSSProperties}>
      <div className="pl-rt-row pl-rt-head">
        <span />
        <span className="pl-rt-scale">{ticks.map((t) => <span key={t}>{t}°</span>)}</span>
        <span>{idle}</span><span>{typical}</span><span>{peak}</span>
      </div>
      {temps.days.map((d, i) => {
        const marks = [d.idle, d.typical, d.peak].filter((v): v is number => v != null);
        const from = Math.min(...marks), to = Math.max(...marks);
        return (
          <div key={d.day} className={`pl-rt-row${i === last ? " today" : ""}`} style={{ "--i": i } as CSSProperties}>
            <span className="pl-rt-day">{weekday(d.day)}</span>
            <span className="pl-rt-plot">
              {marks.length > 1 && <i className="pl-rt-range" style={{ left: `${at(from)}%`, width: `${at(to) - at(from)}%` }} />}
              {d.idle != null && <i className="pl-rt-mark c" style={{ left: `${at(d.idle)}%` }} />}
              {d.typical != null && <i className="pl-rt-mark a" style={{ left: `${at(d.typical)}%` }} />}
              {d.peak != null && <i className="pl-rt-mark b" style={{ left: `${at(d.peak)}%` }} />}
            </span>
            <span className="pl-rt-n">{bare(d.idle)}</span>
            <span className="pl-rt-n">{bare(d.typical)}</span>
            <span className={`pl-rt-n b${d.peak != null && d.peak === temps.peak ? " top" : ""}`}>{bare(d.peak)}</span>
          </div>
        );
      })}
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
          <RangeRows temps={temps} grow={grow} />
          <Legend items={[["c", l.idle], ["a", l.typical], ["b", l.peak]]} />
        </>
      ) : (
        <EmptyNote>Rig is still learning this week. Each day's temperatures show up here once {name} has run for a while.</EmptyNote>
      ))}
    </section>
  );
}
