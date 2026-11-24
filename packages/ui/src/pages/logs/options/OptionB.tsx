import { useState } from "react";
import { useStillPC, useTemp } from "../../../state";
import { byId, clock, day, fmt, games, limits, looks, moments, parts, sensors, span, stat } from "./data";
import { Lanes, Spark, type Lane } from "./Lanes";
import { OptHead, RecorderLine, Seg } from "./Shared";

const colors = ["c-ink", "c-look", "c-brass", "c-grey"];

/** Option B: every recorded sensor in one table, grouped by part, with lowest, average and highest. Ticking rows charts them together. */
export function OptionB() {
  const pc = useStillPC();
  const temp = useTemp();
  const phone = typeof window !== "undefined" && window.innerWidth <= 760;
  const game = games[1];
  const from = game.from, to = game.to;
  const [picked, setPicked] = useState<string[]>(["gpu.temp", "gpu.hot", "cpu.temp"]);
  const [cursor, setCursor] = useState<number | null>(moments[0].t);
  const unit = byId[picked[0]]?.unit ?? "temp";
  const lane: Lane = { title: picked.length ? "Charted" : "Pick sensors below to chart them", unit, h: phone ? 150 : 190, series: picked.filter((id) => byId[id].unit === unit).map((id, i) => ({ id, cls: colors[i % colors.length] })) };
  const [kind, setKind] = useState<string>("All");
  const kinds: Record<string, string> = { Temperatures: "temp", Usage: "percent", Power: "watt", Fans: "rpm" };
  const shownSensor = (u: string) => kind === "All" || kinds[kind] === u;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const say = (id: string, v: number) => fmt(byId[id].unit, v, (c) => temp(c));

  return (
    <div className="page lg-page op-page">
      <OptHead sub={`Every sensor Rig recorded on ${pc.name}, lowest to highest.`} right={!phone && <Seg label="Range" items={["Live", "Day", "Week", "Month"]} on="Day" />} />
      <RecorderLine pcName={pc.name} />

      <div className="op-bar">
        <button type="button" className="btn sm op-pick">{game.title} · Sun {clock(from)} to {clock(to)}<span aria-hidden="true">⌄</span></button>
        <span className="faint op-range">{span(from, to)} · {day.filter((p) => p.t >= from && p.t <= to).length.toLocaleString("en-US")} readings</span>
        {!phone && <input className="input op-find" type="search" placeholder="Find a sensor, like hot spot" aria-label="Find a sensor" />}
      </div>

      <section className="op-chart" aria-label="Charted sensors">
        <Lanes points={day} lanes={[lane]} t0={from} t1={to} cursor={cursor} onCursor={(t) => setCursor(t ?? moments[0].t)} bands={looks} marks={moments.filter((m) => m.t >= from && m.t <= to)} compact={phone} />
      </section>

      <section className="op-table" aria-label="Every sensor">
        <div className="op-kinds">
          <Seg label="Kind of sensor" items={["All", "Temperatures", "Usage", "Power", "Fans"]} on={kind} onPick={setKind} />
        </div>
        <div className="op-tr op-th" aria-hidden="true">
          <span>Sensor</span>{!phone && <span>During the game</span>}<span>Lowest</span>{!phone && <span>Average</span>}<span>Highest</span>
        </div>
        {parts.filter((part) => sensors.some((s) => s.part === part.id && shownSensor(s.unit))).map((part) => (
          <div key={part.id} className="op-group" role="group" aria-label={part.name}>
            <h3 className="op-gh">{part.name}<span className="faint">{part.model}</span></h3>
            {sensors.filter((s) => s.part === part.id && shownSensor(s.unit)).map((s) => {
              const st = stat(s.id, from, to);
              const i = picked.indexOf(s.id);
              const limit = limits[s.id];
              const near = limit != null && st.max >= limit - 5;
              return (
                <button key={s.id} type="button" className="op-tr op-row" aria-pressed={i >= 0} onClick={() => toggle(s.id)}>
                  <span className="op-name"><i className={`ln-sw ${i >= 0 && byId[s.id].unit === unit ? colors[lane.series.findIndex((x) => x.id === s.id) % colors.length] : "off"}`} />{s.name}
                    {phone && <Spark points={day} id={s.id} from={from} to={to} w={120} h={20} cls="op-sp-phone" />}
                  </span>
                  {!phone && <Spark points={day} id={s.id} from={from} to={to} w={260} h={24} />}
                  <span className="num faint">{say(s.id, st.min)}</span>
                  {!phone && <span className="num">{say(s.id, st.avg)}</span>}
                  <span className={`num op-max${near ? " look" : ""}`} title={`At ${clock(st.maxAt)}`}>{say(s.id, st.max)}</span>
                </button>
              );
            })}
          </div>
        ))}
        <p className="faint op-note">Storage temperatures, clocks and voltages aren't in the background recording yet.</p>
      </section>
    </div>
  );
}
