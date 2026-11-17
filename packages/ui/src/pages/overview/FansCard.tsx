import type { CSSProperties } from "react";
import type { FanReading, FanTrend } from "@rig/core";
import { CardHead, EmptyNote, Legend } from "./parts";

/** A fan past this share of its top speed is working hard enough to mark. */
const BUSY = 0.75;

const load = (f: FanReading) => (f.max > 0 ? Math.min(1, f.rpm / f.max) : 0);
const whole = new Intl.NumberFormat();

/** Each fan now, the busiest first, with how close it runs to its own top speed. */
function FanRows({ fans }: { fans: readonly FanReading[] }) {
  const sorted = [...fans].sort((a, b) => load(b) - load(a));
  return (
    <ul className="pl-fans">
      {sorted.map((f, i) => (
        <li key={f.label}>
          <span>{f.label}{sorted.length > 1 && i === 0 && <span className="sr-only">, working hardest</span>}</span>
          <i className="pl-gauge" aria-hidden="true"><i className={load(f) > BUSY ? "b" : "a"} style={{ width: `${load(f) * 100}%` }} /></i>
          <b>{whole.format(Math.round(f.rpm))}<small> rpm</small></b>
        </li>
      ))}
    </ul>
  );
}

/** The top third of the week's range is near the top, the middle third busier, the rest quiet, in sixths. */
const band = (level: number) => { const sixths = Math.max(1, Math.round(level * 6)); return sixths >= 5 ? "b" : sixths >= 3 ? "a" : "c"; };

/** One thin bar per six-hour slice, as tall as its fastest fan. Slices without a reading keep only the baseline. */
function SliceBars({ trend }: { trend: FanTrend }) {
  const days = Math.round(trend.columns.length / 4);
  const label = `Fastest fan every six hours over the last ${days} days, up to ${whole.format(trend.scale ?? 0)} rpm.`;
  return (
    <div className="pl-slices" role="img" aria-label={label} style={{ "--n": trend.columns.length } as CSSProperties}>
      {trend.columns.map((c) => (
        <span key={c.from}>{c.level != null && c.rpm ? <i className={band(c.level)} style={{ height: `${Math.max(4, c.level * 100)}%` }} /> : null}</span>
      ))}
    </div>
  );
}

/** Live speeds of each fan, over the recent trend. `trend` is null while history loads. */
export function FansCard({ fans, trend }: { fans: readonly FanReading[] | undefined; trend: FanTrend | null }) {
  const live = fans ?? [];
  return (
    <section className="f-pane bl-fans">
      <CardHead title="Fans" note="Now, against each fan's top speed" />
      {live.length > 0 && <FanRows fans={live} />}
      {trend && (trend.scale != null
        ? <div className="pl-trend">
          <div className="pl-sub"><span>Fastest fan, every six hours</span><span>Top <b>{whole.format(trend.scale)} rpm</b></span></div>
          <SliceBars trend={trend} />
          <Legend items={[["c", "Quiet"], ["a", "Busier"], ["b", "Near the week's top"]]} />
        </div>
        : <EmptyNote>{live.length ? "Rig is still learning how fast the fans run. Their week shows up here soon." : "This PC doesn't report fan speeds, so there's nothing to show here."}</EmptyNote>)}
    </section>
  );
}
