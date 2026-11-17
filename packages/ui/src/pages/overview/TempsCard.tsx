import type { CSSProperties } from "react";
import { tempMark, type DayTemps, type TempSubject, type WeekTemps } from "@rig/core";
import { useTemp, useTempUnit } from "../../state";
import { CardHead, EmptyNote, Legend, longWeekday, useGrowOnce, weekday } from "./parts";

const labels: Record<TempSubject, { idle: string; typical: string; peak: string }> = {
  gpu: { idle: "Idle processor", typical: "Graphics card, gaming", peak: "Graphics card, peak" },
  cpu: { idle: "Idle processor", typical: "Busy processor", peak: "Peak processor" },
};

/** Cooler days sit lower, 9 px per °C, squeezed so the coolest day drops no more than this. */
const MAX_LIFT = 90;
const PX_PER_DEG = 9;

const hasReadings = (d: DayTemps) => d.idle != null || d.typical != null || d.peak != null;

function describe(w: WeekTemps, temp: ReturnType<typeof useTemp>) {
  const l = labels[w.subject];
  return w.days.map((d) => {
    const figures = ([[l.idle, d.idle], [l.typical, d.typical], [l.peak, d.peak]] as const).filter(([, v]) => v != null).map(([k, v]) => `${k} ${temp(v)}`);
    return `${longWeekday(d.day)}: ${figures.length ? figures.join(", ") : "no readings"}`;
  }).join(". ");
}

/** One column per day: a thin track holding peak, typical and idle, the cooler days lower. Missing figures leave a gap. */
function CapsuleChart({ temps, grow }: { temps: WeekTemps; grow: boolean }) {
  const temp = useTemp();
  const bare = (v: number) => temp(v, { mark: "none" });
  const peaks = temps.days.map((d) => d.peak).filter((v): v is number => v != null);
  const top = temps.peak ?? 0;
  const low = peaks.length ? Math.min(...peaks) : top;
  const perDeg = Math.min(PX_PER_DEG, MAX_LIFT / Math.max(1, top - low));
  const last = temps.days.length - 1;
  return (
    <div className={`pl-caps${grow ? " grow" : ""}`} role="img" aria-label={describe(temps, temp)}>
      {temps.days.map((d, i) => {
        const caps = [
          d.peak != null && <span key="b" className={`pl-cap b${d.peak === temps.peak ? " top" : ""}`}>{bare(d.peak)}</span>,
          d.typical != null && <span key="a" className="pl-cap a">{bare(d.typical)}</span>,
          d.idle != null && <span key="c" className="pl-cap c">{bare(d.idle)}</span>,
        ].filter(Boolean);
        const lift = (top - (d.peak ?? low)) * perDeg;
        return (
          <div key={d.day} className={`pl-cap-col${i === last ? " today" : ""}`} style={{ "--i": i, "--lift": `${lift}px` } as CSSProperties}>
            {hasReadings(d) && <div className="pl-cap-stack">{caps.flatMap((c, k) => (k ? [<i key={`dot${k}`} />, c] : [c]))}</div>}
            <small>{weekday(d.day)}</small>
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
          <CapsuleChart temps={temps} grow={grow} />
          <Legend items={[["c", l.idle], ["a", l.typical], ["b", l.peak]]} />
        </>
      ) : (
        <EmptyNote>Rig is still learning this week. Each day's temperatures show up here once {name} has run for a while.</EmptyNote>
      ))}
    </section>
  );
}
