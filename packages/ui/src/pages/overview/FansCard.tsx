import type { CSSProperties } from "react";
import type { FanColumn, FanReading, FanTrend } from "@rig/core";
import { CardHead, EmptyNote, Legend, YAxis, scale, weekday } from "./parts";

/** A fan past this share of its top speed is working hard enough to mark. */
const BUSY = 0.75;

interface Headline { fan: FanReading; dir?: "up" | "down"; tone: "warn" | "ok" | "plain" }

const load = (f: FanReading) => f.rpm / f.max;

/** The fan working hardest and the one working least, against each one's own top speed. */
function headlines(fans: readonly FanReading[]): Headline[] {
  const sorted = [...fans].sort((a, b) => load(b) - load(a));
  if (!sorted.length) return [];
  const top: Headline = { fan: sorted[0], tone: load(sorted[0]) > BUSY ? "warn" : "plain" };
  if (sorted.length === 1) return [top];
  return [{ ...top, dir: "up" }, { fan: sorted[sorted.length - 1], dir: "down", tone: "ok" }];
}

const whole = new Intl.NumberFormat();

function Stat({ fan, dir, tone }: Headline) {
  return (
    <div className={`pl-stat ${tone}`}>
      <b>{whole.format(Math.round(fan.rpm))}</b>
      <span>{dir && <i className={`pl-tri ${dir}`} aria-hidden="true" />}{fan.label}{dir && <span className="sr-only">{dir === "up" ? ", working hardest" : ", working least"}</span>}</span>
    </div>
  );
}

/** Thirds of the week's top speed: quiet, busier, near the top. */
const band = (level: number) => (level > 2 / 3 ? "b" : level > 1 / 3 ? "a" : "c");

/** A slice starts a day when it is the first six hours after local midnight, or the first slice shown. */
const startsDay = (col: FanColumn, i: number) => i === 0 || new Date(col.from).getHours() < 6;

/** One thin bar per six-hour slice, up to the fastest fan's speed. Slices without a reading stay empty. */
function Columns({ trend }: { trend: FanTrend }) {
  const top = trend.scale ?? 0;
  const axis = scale(0, top, 4, false);
  const days = Math.round(trend.columns.length / 4);
  const label = `Fastest fan every six hours over the last ${days} days, up to ${whole.format(top)} rpm.`;
  return (
    <div className="pl-plot" style={{ "--n": trend.columns.length } as CSSProperties}>
      <YAxis ticks={axis.ticks} at={axis.at} format={(t) => (t >= 1000 ? `${whole.format(t / 1000)}k` : whole.format(t))} />
      <div className="pl-field pl-cols" role="img" aria-label={label}>
        {trend.columns.map((col, i) => (
          <span key={col.from} className={col.rpm ? `pl-bar ${band(col.level ?? 0)}` : "pl-bar off"} style={{ "--h": col.rpm ? axis.at(col.rpm) : 0, "--i": i } as CSSProperties} />
        ))}
      </div>
      <div className="pl-x pl-x-cols" aria-hidden="true">
        {trend.columns.map((col, i) => <span key={col.from}>{startsDay(col, i) ? weekday(col.from) : ""}</span>)}
      </div>
    </div>
  );
}

/** Live speeds of the busiest and quietest fans, over the recent trend. `trend` is null while history loads. */
export function FansCard({ fans, trend }: { fans: readonly FanReading[] | undefined; trend: FanTrend | null }) {
  const stats = headlines(fans ?? []);
  return (
    <section className="f-pane bl-fans">
      <CardHead title="Fans" note="rpm, now and every six hours" />
      {stats.length > 0 && <div className="pl-stats">{stats.map((s) => <Stat key={s.fan.label} {...s} />)}</div>}
      {trend && (trend.scale != null
        ? <>
          <Columns trend={trend} />
          <Legend items={[["c", "Quiet"], ["a", "Busier"], ["b", "Near the top"]]}><span className="pl-total">Top <b>{whole.format(trend.scale)}</b></span></Legend>
        </>
        : <EmptyNote>{stats.length ? "Rig is still learning how fast the fans run. Their week shows up here soon." : "This PC doesn't report fan speeds, so there's nothing to show here."}</EmptyNote>)}
    </section>
  );
}
