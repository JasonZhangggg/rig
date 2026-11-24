import type { ReactNode } from "react";
import { useTemp } from "../../../state";
import { day, fmt, limits, parts, recorder, sensors, stat, type PartId, type Unit } from "./data";
import { Spark, type Lane } from "./Lanes";
import "./options.css";

/** The Logs head for the previews: the recorded view leads, Windows events are the second view. */
export function OptHead({ sub, right }: { sub: string; right?: ReactNode }) {
  return (
    <div className="lg-head">
      <div className="page-head">
        <div><h1>Logs</h1><p className="sub">{sub}</p></div>
        {right}
      </div>
      <nav className="lg-views" aria-label="Logs">
        <a href="#logs" aria-current="page">Recorded</a>
        <a href="#logs">Windows events</a>
      </nav>
    </div>
  );
}

/** One quiet line on the recorder itself: on, how often, how much it keeps. */
export function RecorderLine({ pcName }: { pcName: string }) {
  return (
    <p className="op-rec"><i aria-hidden="true" />Recording {pcName} in the background<span className="faint"> · every {recorder.every}, every {recorder.close} around anything unusual · {recorder.days} days kept, {recorder.size}</span></p>
  );
}

export function Seg({ items, on, label, onPick }: { items: string[]; on: string; label: string; onPick?: (i: string) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map((i) => <button key={i} type="button" aria-pressed={i === on} onClick={() => onPick?.(i)}>{i}</button>)}
    </div>
  );
}

export function DayStep({ label }: { label: string }) {
  return (
    <div className="op-day">
      <button type="button" className="btn ghost sm icon" aria-label="Day before">‹</button>
      <span>{label}</span>
      <button type="button" className="btn ghost sm icon" aria-label="Day after">›</button>
    </div>
  );
}

const kindTitle: Record<Unit, string> = { temp: "Temperatures", percent: "Usage", watt: "Power", rpm: "Fans", mb: "Memory" };
const cycle = ["c-ink", "c-brass", "c-grey"];

/** The live view's kinds, for recorded readings: one lane per kind of sensor the part has, every sensor of that kind in it. */
export function partLanes(part: PartId, h?: number): Lane[] {
  const mine = sensors.filter((s) => s.part === part && s.id !== "gpu.fanpct");
  const units = [...new Set(mine.map((s) => s.unit))];
  return units.map((u, i) => ({
    title: kindTitle[u], unit: u, h: i === 0 ? h : undefined,
    series: mine.filter((s) => s.unit === u).map((s, j) => ({ id: s.id, cls: s.id === "gpu.temp" ? "c-look" : cycle[j % cycle.length] })),
  }));
}

/** The parts down the side, as in the live view: what each part reached in this stretch, and its line. */
export function PartRail({ pick, onPick, from, to, whole }: { pick: string; onPick: (id: string) => void; from: number; to: number; whole?: boolean }) {
  const temp = useTemp();
  return (
    <div className="pf-rail op-rail" role="group" aria-label="Parts">
      {whole && (
        <button type="button" className="pf-part" aria-pressed={pick === "all"} onClick={() => onPick("all")}>
          <span className="pf-part-name">Whole PC</span>
          <span className="pf-part-now faint">{sensors.length} sensors</span>
        </button>
      )}
      {parts.map((p) => {
        const lead = sensors.find((s) => s.part === p.id && s.lead)!;
        const st = stat(lead.id, from, to);
        const near = limits[lead.id] != null && st.max >= limits[lead.id] - 10;
        return (
          <button key={p.id} type="button" className="pf-part" aria-pressed={pick === p.id} onClick={() => onPick(p.id)}>
            <span className="pf-part-name">{p.name}</span>
            <span className="pf-part-now"><b className={`num${near ? " look" : ""}`}>{fmt(lead.unit, st.max, (c) => temp(c))}</b><span className="faint">highest</span></span>
            <Spark points={day} id={lead.id} from={from} to={to} w={200} h={26} cls="pf-spark" />
          </button>
        );
      })}
    </div>
  );
}
