import type { FanReading, FanTrend } from "@rig/core";
import { CardHead, EmptyNote, Legend } from "./parts";

/** A fan past this share of its top speed is working hard enough to mark. */
const BUSY = 0.75;
/** Bars are banded in sixths of the week's top speed: the top two near it, the bottom two quiet. */
const STEPS = 6;

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

const thousands = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();

function Stat({ fan, dir, tone }: Headline) {
  const [value, unit] = fan.rpm >= 1000 ? [thousands.format(fan.rpm / 1000), "k"] : [whole.format(Math.round(fan.rpm)), ""];
  return (
    <div className={`pl-stat ${tone}`}>
      {dir && <i className={`pl-tri ${dir}`} aria-hidden="true" />}
      <b>{value}{unit && <small>{unit}</small>}</b>
      <span>{fan.label}{dir && <span className="sr-only">{dir === "up" ? ", working hardest" : ", working least"}</span>}</span>
    </div>
  );
}

/** One bar per six-hour slice, as tall as its fastest fan. Slices without a reading keep only a tick on the baseline. */
function SliceBars({ trend }: { trend: FanTrend }) {
  const gap = 12, h = 96;
  const w = trend.columns.length * gap;
  const days = Math.round(trend.columns.length / 4);
  const label = `Fastest fan every six hours over the last ${days} days, up to ${whole.format(trend.scale ?? 0)} rpm.`;
  return (
    <svg className="pl-bars" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {trend.columns.map((col, c) => {
        const lit = col.level == null || !col.rpm ? 0 : Math.max(1, Math.round(col.level * STEPS));
        const band = !lit ? "off" : lit > STEPS - 2 ? "b" : lit > 2 ? "a" : "c";
        const bh = lit ? Math.max(4, (col.level ?? 0) * h) : 2;
        return <rect key={c} x={c * gap + 2} y={h - bh} width={gap - 4} height={bh} className={`pl-bar ${band}`} />;
      })}
    </svg>
  );
}

/** Live speeds of the busiest and quietest fans, over the recent trend. `trend` is null while history loads. */
export function FansCard({ fans, trend }: { fans: readonly FanReading[] | undefined; trend: FanTrend | null }) {
  const stats = headlines(fans ?? []);
  return (
    <section className="f-pane bl-fans">
      <CardHead title="Fans" note={trend?.scale != null ? "Fastest fan every six hours, rpm" : "rpm"} />
      {stats.length > 0 && <div className="pl-stats">{stats.map((s) => <Stat key={s.fan.label} {...s} />)}</div>}
      {trend && (trend.scale != null
        ? <>
          <SliceBars trend={trend} />
          <Legend items={[["c", "Quiet"], ["a", "Busier"], ["b", "Near the week's top"]]} total={<>Top <b>{whole.format(trend.scale)} rpm</b></>} />
        </>
        : <EmptyNote>{stats.length ? "Rig is still learning how fast the fans run. Their week shows up here soon." : "This PC doesn't report fan speeds, so there's nothing to show here."}</EmptyNote>)}
    </section>
  );
}
