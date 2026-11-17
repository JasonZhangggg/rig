import type { CSSProperties } from "react";
import { tempMark, toUnit, type DayTemps, type TempSubject, type WeekTemps } from "@rig/core";
import { useTemp, useTempUnit } from "../../state";
import { CardHead, EmptyNote, Legend, YAxis, longWeekday, scale, useGrowOnce, weekday } from "./parts";

const labels: Record<TempSubject, { idle: string; typical: string; peak: string }> = {
  gpu: { idle: "Idle processor", typical: "Graphics card, gaming", peak: "Graphics card, peak" },
  cpu: { idle: "Idle processor", typical: "Busy processor", peak: "Peak processor" },
};

/** The axis always spans at least this many degrees, so a quiet week doesn't fill the plot with one reading. */
const MIN_SPAN = 20;

const hasReadings = (d: DayTemps) => d.idle != null || d.typical != null || d.peak != null;

function describe(w: WeekTemps, temp: ReturnType<typeof useTemp>) {
  const l = labels[w.subject];
  return w.days.map((d) => {
    const figures = ([[l.idle, d.idle], [l.typical, d.typical], [l.peak, d.peak]] as const).filter(([, v]) => v != null).map(([k, v]) => `${k} ${temp(v)}`);
    return `${longWeekday(d.day)}: ${figures.length ? figures.join(", ") : "no readings"}`;
  }).join(". ");
}

/** Three thin bars a day, idle, typical and peak, on a degree scale. Missing figures leave a gap. */
function BarChart({ temps, grow }: { temps: WeekTemps; grow: boolean }) {
  const temp = useTemp();
  const unit = useTempUnit();
  const shown = temps.days.flatMap((d) => [d.idle, d.typical, d.peak]).filter((v): v is number => v != null).map((v) => toUnit(v, unit));
  const lo = Math.min(...shown), hi = Math.max(...shown, lo + MIN_SPAN);
  const axis = scale(lo, hi);
  const last = temps.days.length - 1;
  const bar = (v: number | null, mark: "a" | "b" | "c", top = false) => v != null && (
    <span key={mark} className={`pl-bar ${mark}${top ? " top" : ""}`} style={{ "--h": axis.at(toUnit(v, unit)) } as CSSProperties}>
      <em>{temp(v, { mark: "none" })}</em>
    </span>
  );
  return (
    <div className={`pl-plot${grow ? " grow" : ""}`}>
      <YAxis ticks={axis.ticks} at={axis.at} format={(t) => `${t}°`} />
      <div className="pl-field pl-days" role="img" aria-label={describe(temps, temp)}>
        {temps.days.map((d, i) => (
          <div key={d.day} className="pl-day" style={{ "--i": i } as CSSProperties}>
            {bar(d.idle, "c")}{bar(d.typical, "a")}{bar(d.peak, "b", d.peak === temps.peak)}
          </div>
        ))}
      </div>
      <div className="pl-x" aria-hidden="true">
        {temps.days.map((d, i) => <span key={d.day} className={i === last ? "today" : undefined}>{weekday(d.day)}</span>)}
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
          <BarChart temps={temps} grow={grow} />
          <Legend items={[["c", l.idle], ["a", l.typical], ["b", l.peak]]} />
        </>
      ) : (
        <EmptyNote>Rig is still learning this week. Each day's temperatures show up here once {name} has run for a while.</EmptyNote>
      ))}
    </section>
  );
}
