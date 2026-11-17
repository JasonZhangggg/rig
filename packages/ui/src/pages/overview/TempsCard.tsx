import type { CSSProperties } from "react";
import type { DayTemps, TempSubject, WeekTemps } from "@rig/core";
import { CardHead, EmptyNote, Legend, longWeekday, useGrowOnce, weekday } from "./parts";

const labels: Record<TempSubject, { idle: string; typical: string; peak: string }> = {
  gpu: { idle: "Idle processor", typical: "Graphics card, gaming", peak: "Graphics card, peak" },
  cpu: { idle: "Idle processor", typical: "Busy processor", peak: "Peak processor" },
};

/** Cooler days sit lower, 9 px per °C, squeezed so the coolest day drops no more than this. */
const MAX_LIFT = 90;
const PX_PER_DEG = 9;

const hasReadings = (d: DayTemps) => d.idle != null || d.typical != null || d.peak != null;

function describe(w: WeekTemps) {
  const l = labels[w.subject];
  return w.days.map((d) => {
    const figures = ([[l.idle, d.idle], [l.typical, d.typical], [l.peak, d.peak]] as const).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}°C`);
    return `${longWeekday(d.day)}: ${figures.length ? figures.join(", ") : "no readings"}`;
  }).join(". ");
}

/** One column per day: a thin track holding peak, typical and idle, the cooler days lower. Missing figures leave a gap. */
function CapsuleChart({ temps, grow }: { temps: WeekTemps; grow: boolean }) {
  const peaks = temps.days.map((d) => d.peak).filter((v): v is number => v != null);
  const top = temps.peak ?? 0;
  const low = peaks.length ? Math.min(...peaks) : top;
  const perDeg = Math.min(PX_PER_DEG, MAX_LIFT / Math.max(1, top - low));
  const last = temps.days.length - 1;
  return (
    <div className={`pl-caps${grow ? " grow" : ""}`} role="img" aria-label={describe(temps)}>
      {temps.days.map((d, i) => {
        const caps = [
          d.peak != null && <span key="b" className={`pl-cap b${d.peak === temps.peak ? " top" : ""}`}>{d.peak}</span>,
          d.typical != null && <span key="a" className="pl-cap a">{d.typical}</span>,
          d.idle != null && <span key="c" className="pl-cap c">{d.idle}</span>,
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
  const l = labels[temps?.subject ?? "gpu"];
  return (
    <section className="f-card bl-temps tone-dark">
      <CardHead title="Temperatures" note="This week, °C" />
      {temps && (temps.days.some(hasReadings) ? (
        <>
          <CapsuleChart temps={temps} grow={grow} />
          <Legend items={[["c", l.idle], ["a", l.typical], ["b", l.peak]]} total={temps.peak != null ? ["Peak", `${temps.peak}°C`] : undefined} />
        </>
      ) : (
        <EmptyNote>Rig is still learning this week. Each day's temperatures show up here once {name} has run for a while.</EmptyNote>
      ))}
    </section>
  );
}
