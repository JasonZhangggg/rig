import type { FanReading, FanTrend } from "@rig/core";
import { CardHead, EmptyNote, Legend } from "./parts";

/** A fan past this share of its top speed is working hard enough to mark. */
const BUSY = 0.75;
const ROWS = 6;

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

/** One column of dots per six-hour slice, lit up to its fan speed. Slices without a reading stay dark. */
function DotMatrix({ trend }: { trend: FanTrend }) {
  const gap = 18, r = 4.6;
  const w = trend.columns.length * gap, h = ROWS * gap;
  const days = Math.round(trend.columns.length / 4);
  const label = `Fastest fan every six hours over the last ${days} days, up to ${whole.format(trend.scale ?? 0)} rpm.`;
  return (
    <svg className="pl-dots" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMax meet" role="img" aria-label={label}>
      {trend.columns.map((col, c) => {
        const lit = col.level == null || !col.rpm ? 0 : Math.max(1, Math.round(col.level * ROWS));
        return Array.from({ length: ROWS }, (_, k) => {
          const band = k >= lit ? "off" : k >= ROWS - 2 ? "b" : k >= 2 ? "a" : "c";
          return <circle key={`${c}-${k}`} cx={c * gap + gap / 2} cy={h - k * gap - gap / 2} r={r} className={`pl-dot ${band}`} />;
        });
      })}
    </svg>
  );
}

/** Live speeds of the busiest and quietest fans, over the recent trend. `trend` is null while history loads. */
export function FansCard({ fans, trend }: { fans: readonly FanReading[] | undefined; trend: FanTrend | null }) {
  const stats = headlines(fans ?? []);
  return (
    <section className="f-pane bl-fans">
      <CardHead title="Fans" note="rpm" />
      {stats.length > 0 && <div className="pl-stats">{stats.map((s) => <Stat key={s.fan.label} {...s} />)}</div>}
      {trend && (trend.scale != null
        ? <>
          <DotMatrix trend={trend} />
          <Legend items={[["c", "Quiet"], ["a", "Busier"], ["b", "Near the week's top"]]} />
          <div className="pl-legend" aria-hidden="true"><span>Fastest fan, every six hours</span><span className="pl-total">Top <b>{whole.format(trend.scale)} rpm</b></span></div>
        </>
        : <EmptyNote>{stats.length ? "Rig is still learning how fast the fans run. Their week shows up here soon." : "This PC doesn't report fan speeds, so there's nothing to show here."}</EmptyNote>)}
    </section>
  );
}
