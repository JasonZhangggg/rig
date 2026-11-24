import { useState } from "react";
import { Row, RowFigure, Rows } from "../../../components/Rows";
import { useStillPC, useTemp } from "../../../state";
import { clock, DAY0, DAY1, day, games, limits, looks, moments, span, stat } from "./data";
import { Lanes, Overview, type Lane } from "./Lanes";
import { DayStep, OptHead, PartRail, partLanes, Seg } from "./Shared";
import type { PartId } from "./data";

const H = 36e5;

/** Option A: everything the recorder kept on one timeline. Lanes of sensors share one time axis and one crosshair. */
export function OptionA() {
  const pc = useStillPC();
  const temp = useTemp();
  const phone = typeof window !== "undefined" && window.innerWidth <= 760;
  const from = DAY0 + 19 * H, to = DAY1;
  const [cursor, setCursor] = useState<number | null>(moments[0].t);
  const marks = moments.filter((m) => m.t >= from);
  const [part, setPart] = useState(new URLSearchParams(location.search).get("part") ?? "all");
  const whole: Lane[] = [
    { title: "Temperatures", unit: "temp", series: [{ id: "gpu.temp", cls: "c-look", name: "Graphics card" }, { id: "gpu.hot", cls: "c-grey" }, { id: "cpu.temp", cls: "c-brass", name: "Processor" }], h: phone ? 110 : 132 },
    { title: "Usage", unit: "percent", series: [{ id: "gpu.load", cls: "c-ink", name: "Graphics card" }, { id: "cpu.load", cls: "c-brass", name: "Processor" }] },
    { title: "Power", unit: "watt", series: [{ id: "gpu.power", cls: "c-ink", name: "Graphics card" }, { id: "cpu.power", cls: "c-brass", name: "Processor" }] },
    { title: "Fans", unit: "rpm", series: [{ id: "gpu.fan", cls: "c-ink" }, { id: "fans.cpu", cls: "c-brass" }, { id: "fans.sys1", cls: "c-grey" }] },
    { title: "Memory", unit: "percent", series: [{ id: "ram.load", cls: "c-ink" }, { id: "gpu.vram", cls: "c-grey" }] },
  ];
  const lanes = part === "all" ? whole : partLanes(part as PartId, phone ? 110 : 132);
  const hot = stat("gpu.temp", from, to);
  const game = games[1];

  const crashMem = "1.9 GB";
  return (
    <div className="page lg-page op-page">
      <OptHead sub={`${pc.name} · every sensor, every 30 s`} right={!phone && <Seg label="Range" items={["Live", "Day", "Week", "Month"]} on="Day" />} />

      <div className="op-bar">
        <DayStep label="Sunday, Nov 22" />
        <span className="op-bar-end">
          {!phone && <button type="button" className="btn ghost sm">Export CSV</button>}
        </span>
      </div>

      <section className="op-in" aria-labelledby="op-in-h">
        <h2 id="op-in-h" className="lg-h">What happened</h2>
        <Rows timeline>
          <Row time={clock(marks[1].t)} mark="look" title="Discord crashed" meta="Memory leak likely" figure={<RowFigure value={crashMem} word="memory" look />} name="Discord crash" pick={{ pressed: false, onPick: () => setCursor(marks[1].t) }} />
          <Row time={clock(hot.maxAt)} mark="look" title={`Graphics card hit ${temp(hot.max)}`} meta={`${game.title} · limit ${temp(limits["gpu.temp"])}`} figure={<RowFigure value={temp(hot.max)} word="GPU core" look />} name="Graphics card" pick={{ pressed: true, onPick: () => setCursor(marks[0].t) }} />
          <Row time={clock(game.from)} mark="dot" title={game.title} meta={span(game.from, game.to)} figure={<RowFigure value={temp(stat("gpu.temp", game.from, game.to).max)} word="GPU peak" />} name={game.title} />
          <Row time={clock(games[0].from)} mark="dot" title={games[0].title} meta={span(games[0].from, games[0].to)} figure={<RowFigure value={temp(stat("gpu.temp", games[0].from, games[0].to).max)} word="GPU peak" />} name="Afternoon game" />
        </Rows>
      </section>

      <section className="op-tl" aria-label="Recorded readings">
        <span className="faint op-range">{clock(from)} to midnight</span>
        <Overview points={day} id="gpu.temp" from={from} to={to} t0={DAY0} t1={DAY1} bands={[...games, ...looks]} marks={moments} />
        <div className="op-tl-grid">
          <PartRail pick={part} onPick={setPart} from={from} to={to} whole />
          <Lanes points={day} lanes={lanes} t0={from} t1={to} cursor={cursor} onCursor={(t) => setCursor(t ?? moments[0].t)} bands={[...games, ...looks]} marks={marks} compact={phone} />
        </div>
      </section>
    </div>
  );
}
