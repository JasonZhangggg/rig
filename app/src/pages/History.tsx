import { useMemo } from "react";
import { history } from "../data";
import { LineChart } from "../chart";
import { useApp } from "../state";

export function History() {
  const { ui, pc, set } = useApp();
  const pts = useMemo(() => history(7), []);
  const laptop = pc.kind === "laptop";
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Temperature history</h1><p className="sub">{pc.name} logs temperatures every minute. Shaded areas are {laptop ? "busy periods" : "gaming sessions"}.</p></div>
        <div className="seg" role="group" aria-label="Range">
          {(["24h", "7d", "30d"] as const).map((r) => <button key={r} type="button" aria-pressed={ui.range === r} onClick={() => set({ range: r })}>{r === "24h" ? "Day" : r === "7d" ? "Week" : "Month"}</button>)}
        </div>
      </div>
      <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="legend hist-legend">
          <span><i className="lg-cpu" />CPU</span>
          <span><i className="lg-gpu" />{laptop ? "Graphics (built in)" : "Graphics card"}</span>
          <span><i className="lg-limit" />Safe limit</span>
        </div>
        <LineChart points={pts} series={[{ key: "cpu", cls: "cpu" }, { key: "gpu", cls: "gpu" }]} limit={{ v: 90, label: "90°C limit" }} bands />
        {ui.range !== "7d" && <p className="faint">This mockup only has a week of sample data.</p>}
      </section>
      <section className="trend">
        <div className="card card-pad"><div className="label">{laptop ? "Processor under load" : "Graphics card while gaming"}</div><p className="num big-figure" style={{ color: "var(--warn)" }}>+9°C</p><p className="muted">over 30 days at the same settings. Points to dust.</p></div>
        <div className="card card-pad"><div className="label">Processor at idle</div><p className="num big-figure">41°C</p><p className="muted">Steady all month. Cooler and paste are fine.</p></div>
        <div className="card card-pad"><div className="label">Slowdowns from heat</div><p className="num big-figure">{laptop ? 3 : 0}</p><p className="muted">{laptop ? "Short ones on battery this week." : "No throttling this week."}</p></div>
      </section>
    </div>
  );
}
