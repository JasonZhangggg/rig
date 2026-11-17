import { historySummary, STEADY_MARGIN, type BusySummary, type HistorySummary, type Range, type TempFormat } from "@rig/core";
import { ChartNote, LineChart } from "../chart";
import { useApp, useHistory, useTemp } from "../state";

type Temp = (celsius: number | null | undefined, opts?: TempFormat) => string;
/** A difference between two temperatures, like "6° warmer": scaled to the unit, not offset. */
const diff = (temp: Temp, celsius: number) => temp(celsius, { delta: true, mark: "degree" });

function busyNote(b: BusySummary | null, laptop: boolean, temp: Temp) {
  if (!b) return "Nothing heavy ran in this range.";
  if (b.change == null) return `Typical during ${laptop ? "busy periods" : "games and heavy work"}.`;
  if (b.change >= STEADY_MARGIN) return `${diff(temp, b.change)} warmer than earlier in this range. Dust is the usual cause.`;
  if (b.change <= -STEADY_MARGIN) return `${diff(temp, -b.change)} cooler than earlier in this range.`;
  return "About the same as earlier in this range.";
}

function peakNote(peak: NonNullable<HistorySummary["peak"]>, range: Range, temp: Temp) {
  const when = new Date(peak.t).toLocaleString(undefined, range === "30d"
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { weekday: "short", hour: "numeric", minute: "2-digit" });
  const margin = peak.headroom > 0 ? `${diff(temp, peak.headroom)} under the limit` : peak.headroom < 0 ? `${diff(temp, -peak.headroom)} over the limit` : "right at the limit";
  return `${when}, ${margin}.`;
}

export function History() {
  const { ui, pc, set } = useApp();
  const temp = useTemp();
  const pts = useHistory(ui.range);
  const laptop = pc.kind === "laptop";
  const main: "gpu" | "cpu" = pc.parts?.gpu ? "gpu" : "cpu";
  const limit = pc.parts?.[main]?.limit ?? 90;
  const { busy, idleCpu, peak } = historySummary(pts ?? [], main, limit);
  const warmer = busy?.change != null && busy.change >= STEADY_MARGIN;
  const partName = main === "gpu" ? "Graphics card" : "Processor";

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Temperature history</h1><p className="sub">{pc.name} logs temperatures every minute while Rig runs. Shaded areas are {laptop ? "busy periods" : "games and heavy work"}.</p></div>
        <div className="seg" role="group" aria-label="Range">
          {(["24h", "7d", "30d"] as const).map((r) => <button key={r} type="button" aria-pressed={ui.range === r} onClick={() => set({ range: r })}>{r === "24h" ? "Day" : r === "7d" ? "Week" : "Month"}</button>)}
        </div>
      </div>
      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="legend">
          <span><i className={pc.parts?.gpu ? "lg-cpu" : "lg-gpu"} />Processor</span>
          {pc.parts?.gpu && <span><i className="lg-gpu" />Graphics card</span>}
          <span><i className="lg-limit" />Safe limit</span>
        </div>
        {pts == null ? <ChartNote busy>Loading…</ChartNote> : <LineChart points={pts} series={pc.parts?.gpu ? [{ key: "cpu", cls: "cpu" }, { key: "gpu", cls: "gpu" }] : [{ key: "cpu", cls: "gpu" }]} limit={{ v: limit, label: `${temp(limit)} limit` }} bands />}
      </section>
      {pts && pts.length > 1 && (
        <section className="trend">
          <div className="card card-pad">
            <div className="label">{partName} when busy</div>
            <p className="num big-figure" style={warmer ? { color: "var(--warn)" } : undefined}>{temp(busy?.typical)}</p>
            <p className="muted">{busyNote(busy, laptop, temp)}</p>
          </div>
          <div className="card card-pad">
            <div className="label">Processor at rest</div>
            <p className="num big-figure">{temp(idleCpu)}</p>
            <p className="muted">{idleCpu != null ? "Typical when nothing heavy is running." : "Nothing quiet was recorded in this range."}</p>
          </div>
          <div className="card card-pad">
            <div className="label">Hottest moment</div>
            <p className="num big-figure" style={peak && peak.headroom <= 0 ? { color: "var(--warn)" } : undefined}>{temp(peak?.temp)}</p>
            <p className="muted">{peak ? peakNote(peak, ui.range, temp) : "No readings in this range."}</p>
          </div>
        </section>
      )}
    </div>
  );
}
