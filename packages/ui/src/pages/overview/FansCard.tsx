import type { FanReading, FanTrend } from "@rig/core";
import { CardHead, EmptyNote, Legend } from "./parts";

export type FansStyle = "dots" | "bars" | "rings";

export interface FansOptions {
  style?: FansStyle;
  /** Days of history to chart, four six-hour slices a day. */
  days?: number;
  live?: boolean;
  legend?: boolean;
  /** Fans left out, by label. */
  off?: readonly string[];
  compact?: boolean;
}

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
const rpmParts = (rpm: number): [string, string] => (rpm >= 1000 ? [thousands.format(rpm / 1000), "k"] : [whole.format(Math.round(rpm)), ""]);

/** The last `slices` columns of a trend, scaled again to the fastest of them. */
export function recent(trend: FanTrend, slices: number): FanTrend {
  const columns = trend.columns.slice(-slices);
  const rpms = columns.map((c) => c.rpm).filter((v): v is number => v != null);
  const scale = rpms.length ? Math.max(...rpms) : null;
  return { scale, columns: columns.map((c) => ({ ...c, level: c.rpm == null || !scale ? null : c.rpm / scale })) };
}

function Stat({ fan, dir, tone }: Headline) {
  const [value, unit] = rpmParts(fan.rpm);
  return (
    <div className={`pl-stat ${tone}`}>
      {dir && <i className={`pl-tri ${dir}`} aria-hidden="true" />}
      <b>{value}{unit && <small>{unit}</small>}</b>
      <span>{fan.label}{dir && <span className="sr-only">{dir === "up" ? ", working hardest" : ", working least"}</span>}</span>
    </div>
  );
}

const describe = (trend: FanTrend) => `Fastest fan every six hours over the last ${Math.round(trend.columns.length / 4)} days, up to ${whole.format(trend.scale ?? 0)} rpm.`;
const lit = (level: number | null, rpm: number | null) => (level == null || !rpm ? 0 : Math.max(1, Math.round(level * ROWS)));

/** One column of dots per six-hour slice, lit up to its fan speed. Slices without a reading stay dark. */
function DotMatrix({ trend }: { trend: FanTrend }) {
  const gap = 18, r = 4.6;
  const w = trend.columns.length * gap, h = ROWS * gap;
  return (
    <svg className="pl-dots" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMax meet" role="img" aria-label={describe(trend)}>
      {trend.columns.map((col, c) => {
        const on = lit(col.level, col.rpm);
        return Array.from({ length: ROWS }, (_, k) => {
          const band = k >= on ? "off" : k >= ROWS - 2 ? "b" : k >= 2 ? "a" : "c";
          return <circle key={`${c}-${k}`} cx={c * gap + gap / 2} cy={h - k * gap - gap / 2} r={r} className={`pl-dot ${band}`} />;
        });
      })}
    </svg>
  );
}

/** One bar per six-hour slice, as tall as its fastest fan. Slices without a reading keep only a tick on the baseline. */
function SliceBars({ trend }: { trend: FanTrend }) {
  const gap = 12, h = 96;
  const w = trend.columns.length * gap;
  return (
    <svg className="pl-bars" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={describe(trend)}>
      {trend.columns.map((col, c) => {
        const on = lit(col.level, col.rpm);
        const band = !on ? "off" : on > ROWS - 2 ? "b" : on > 2 ? "a" : "c";
        const bh = on ? Math.max(4, (col.level ?? 0) * h) : 2;
        return <rect key={c} x={c * gap + 2} y={h - bh} width={gap - 4} height={bh} className={`pl-bar ${band}`} />;
      })}
    </svg>
  );
}

/** A ring per fan, filled to its share of its own top speed. */
function Rings({ fans }: { fans: readonly FanReading[] }) {
  const c = 2 * Math.PI * 30;
  return (
    <ul className="pl-rings">
      {fans.map((f) => {
        const share = Math.min(1, load(f));
        const [value, unit] = rpmParts(f.rpm);
        return (
          <li key={f.label} className={share > BUSY ? "warn" : undefined}>
            <span className="pl-ring">
              <svg viewBox="0 0 72 72" aria-hidden="true">
                <circle cx="36" cy="36" r="30" className="tr" />
                <circle cx="36" cy="36" r="30" className="vl" strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 36 36)" />
              </svg>
              <b>{value}{unit && <small>{unit}</small>}</b>
            </span>
            <span>{f.label}<span className="sr-only">, {whole.format(f.rpm)} of {whole.format(f.max)} rpm</span></span>
          </li>
        );
      })}
    </ul>
  );
}

/** Live speeds of the busiest and quietest fans, over the recent trend. `trend` is null while history loads. */
export function FansCard({ fans, trend: full, style = "dots", days = 4, live = true, legend = true, off = [], compact = false }: { fans: readonly FanReading[] | undefined; trend: FanTrend | null } & FansOptions) {
  const shown = (fans ?? []).filter((f) => !off.includes(f.label));
  const stats = headlines(shown);
  const trend = full && recent(full, days * 4);
  const rings = style === "rings" && !compact;
  const note = rings ? "Each fan against its top speed" : trend?.scale != null && !compact ? "Fastest fan every six hours, rpm" : "rpm";
  const empty = <EmptyNote>{fans?.length ? "Rig is still learning how fast the fans run. Their week shows up here soon." : "This PC doesn't report fan speeds, so there's nothing to show here."}</EmptyNote>;
  return (
    <section className={`f-pane bl-fans${compact ? " compact" : ""}`}>
      <CardHead title="Fans" note={note} />
      {(live || compact) && !rings && stats.length > 0 && <div className="pl-stats">{stats.map((s) => <Stat key={s.fan.label} {...s} />)}</div>}
      {rings
        ? (shown.length ? <Rings fans={shown} /> : empty)
        : !compact && trend && (trend.scale != null
          ? <>
            {style === "bars" ? <SliceBars trend={trend} /> : <DotMatrix trend={trend} />}
            {legend && <Legend items={[["c", "Quiet"], ["a", "Busier"], ["b", "Near the top"]]} total={<>Top <b>{whole.format(trend.scale)} rpm</b></>} />}
          </>
          : empty)}
      {compact && (stats.length ? full && recent(full, 8).scale != null && <SliceBars trend={recent(full, 8)} /> : empty)}
    </section>
  );
}
