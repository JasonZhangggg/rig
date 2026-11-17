import type { HistoryPoint } from "@rig/core";
import { LineChart } from "../chart";
import { useApp, useHistory, useTemp } from "../state";

const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function History() {
  const { ui, pc, set } = useApp();
  const temp = useTemp();
  const pts = useHistory(ui.range);
  const laptop = pc.kind === "laptop";
  const main: "gpu" | "cpu" = pc.parts?.gpu ? "gpu" : "cpu";
  const limit = pc.parts?.[main]?.limit ?? 90;
  const busy = (pts ?? []).filter((p) => p.busy && p[main] != null).map((p) => p[main]!);
  const idleCpu = (pts ?? []).filter((p) => !p.busy && p.cpu != null).map((p) => p.cpu!);
  const half = Math.floor(busy.length / 2);
  const trend = busy.length > 20 ? avg(busy.slice(half))! - avg(busy.slice(0, half))! : null;
  const peak = (pts ?? []).reduce<HistoryPoint | null>((b, p) => (p[main] != null && (!b || p[main]! > b[main]!) ? p : b), null);
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
          <span><i className="lg-cpu" />Processor</span>
          {pc.parts?.gpu && <span><i className="lg-gpu" />Graphics card</span>}
          <span><i className="lg-limit" />Safe limit</span>
        </div>
        {pts == null ? <p className="muted">Loading…</p> : <LineChart points={pts} series={pc.parts?.gpu ? [{ key: "cpu", cls: "cpu" }, { key: "gpu", cls: "gpu" }] : [{ key: "cpu", cls: "gpu" }]} limit={{ v: limit, label: `${temp(limit)} limit` }} bands />}
      </section>
      {pts && pts.length > 1 && (
        <section className="trend">
          <div className="card card-pad">
            <div className="label">{partName} when busy</div>
            <p className="num big-figure" style={trend != null && trend >= 3 ? { color: "var(--warn)" } : undefined}>{trend == null ? "–" : temp(trend, { delta: true, sign: true, mark: "degree" })}</p>
            <p className="muted">{trend == null ? "Needs a few busy sessions to compare." : trend >= 3 ? "Warmer than earlier in this range. Dust is the usual cause." : "Steady across this range."}</p>
          </div>
          <div className="card card-pad">
            <div className="label">Processor at rest</div>
            <p className="num big-figure">{temp(avg(idleCpu))}</p>
            <p className="muted">Average when nothing heavy is running.</p>
          </div>
          <div className="card card-pad">
            <div className="label">Hottest moment</div>
            <p className="num big-figure">{temp(peak?.[main])}</p>
            <p className="muted">{peak ? new Date(peak.t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}{peak && peak[main]! < limit ? `, ${temp(limit - peak[main]!, { delta: true, mark: "degree" })} under the limit.` : "."}</p>
          </div>
        </section>
      )}
    </div>
  );
}
