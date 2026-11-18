import { HOT_MARGIN, median, values, type HistoryPoint, type PC } from "@rig/core";
import { useTemp } from "../../state";

interface Spread { key: "cpu" | "gpu" | "fan"; name: string; low: number; typical: number; high: number; highAt: number; limit?: number }

/** Lowest, typical and highest reading of each part over the points, for the parts that reported any. */
export function spreads(points: readonly HistoryPoint[], pc: PC): Spread[] {
  const parts: [Spread["key"], string, number | undefined][] = [
    ["cpu", "Processor", pc.parts?.cpu?.limit],
    ["gpu", "Graphics card", pc.parts?.gpu?.limit],
    ["fan", "Fastest fan", undefined],
  ];
  return parts.flatMap(([key, name, limit]) => {
    const xs = values(points, (p) => p[key]);
    if (!xs.length) return [];
    const top = points.reduce<HistoryPoint | null>((a, p) => (p[key] != null && (!a || p[key]! > a[key]!) ? p : a), null)!;
    return [{ key, name, limit, low: Math.round(Math.min(...xs)), typical: Math.round(median(xs)!), high: Math.round(Math.max(...xs)), highAt: top.t }];
  });
}

/** Each part's spread against its safe limit. A temperature's highest reading shows its moment on the chart. */
export function Ranges({ points, pc, pinned, onPin }: { points: HistoryPoint[]; pc: PC; pinned: string | null; onPin: (key: string, t: number) => void }) {
  const list = spreads(points, pc);
  return (
    <section className="hi-panel" aria-label="Lowest, typical and highest">
      {list.length ? <div className="hi-ranges">{list.map((s) => <Row key={s.key} s={s} pinned={pinned === `high-${s.key}`} onPin={() => onPin(`high-${s.key}`, s.highAt)} />)}</div> : <p className="muted">No readings in this range.</p>}
    </section>
  );
}

function Row({ s, pinned, onPin }: { s: Spread; pinned: boolean; onPin: () => void }) {
  const temp = useTemp();
  const fan = s.key === "fan";
  const show = (v: number) => (fan ? `${v.toLocaleString()} rpm` : temp(v));
  const top = fan ? s.high * 1.1 : Math.max(s.limit ?? 0, s.high) + 5;
  const bottom = fan ? 0 : Math.min(20, s.low - 5);
  const at = (v: number) => `${((v - bottom) / (top - bottom)) * 100}%`;
  const near = s.limit != null && s.high >= s.limit - HOT_MARGIN;
  return (
    <div className="hi-range">
      <div className="hi-range-head"><b>{s.name}</b>{s.limit != null && <span className="faint">Safe limit {temp(s.limit)}</span>}</div>
      <div className="hi-track" aria-hidden="true">
        <i className={`hi-span${near ? " look" : ""}`} style={{ left: at(s.low), width: `calc(${at(s.high)} - ${at(s.low)})` }} />
        <i className="hi-typical" style={{ left: at(s.typical) }} />
        {s.limit != null && <i className="hi-limit" style={{ left: at(s.limit) }} />}
      </div>
      <dl className="hi-figs">
        <div><dt>Lowest</dt><dd className="num">{show(s.low)}</dd></div>
        <div><dt>Typical</dt><dd className="num">{show(s.typical)}</dd></div>
        <div>
          <dt>Highest</dt>
          <dd className={`num${near ? " look" : ""}`}>
            {fan ? show(s.high) : <button type="button" className="hi-fig-btn" aria-pressed={pinned} aria-label={`${s.name} highest, ${show(s.high)}, show on chart`} onClick={onPin}>{show(s.high)}</button>}
          </dd>
        </div>
      </dl>
    </div>
  );
}
