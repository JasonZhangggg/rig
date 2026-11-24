import { useState } from "react";
import { Icon } from "../../../components/common";
import { DayLabel, Row, RowFigure, Rows } from "../../../components/Rows";
import { useStillPC, useTemp } from "../../../state";
import { clock, DAY0, day, games, limits, looks, moments, span, stat } from "./data";
import { Lanes, Spark, type Lane } from "./Lanes";
import { OptHead, partLanes, RecorderLine } from "./Shared";
import { parts, type PartId } from "./data";

const H = 36e5;

interface Session { id: string; title: string; meta: string; from: number; to: number; look?: boolean; kind: string }

/** Sunday's stretches as the recorder split them, plus earlier days and the recordings people started. */
const sunday: Session[] = [
  { id: "late", title: "Discord crashed", meta: "11:07 to 11:15 PM · closer look", from: looks[1].from, to: looks[1].to, look: true, kind: "look" },
  { id: "cs-eve", title: "Counter-Strike 2", meta: `${clock(games[1].from)} to ${clock(games[1].to)} · ${span(games[1].from, games[1].to)}`, from: games[1].from, to: games[1].to, look: true, kind: "game" },
  { id: "evening", title: "Light use", meta: "4:04 to 7:31 PM", from: games[0].to, to: games[1].from, kind: "use" },
  { id: "cs-aft", title: "Counter-Strike 2", meta: `${clock(games[0].from)} to ${clock(games[0].to)} · ${span(games[0].from, games[0].to)}`, from: games[0].from, to: games[0].to, kind: "game" },
  { id: "day", title: "Work", meta: "8:30 AM to 2:02 PM", from: DAY0 + 8.5 * H, to: games[0].from, kind: "use" },
];
const earlier: { day: string; rows: { title: string; meta: string }[] }[] = [
  { day: "Saturday, Nov 21", rows: [{ title: "Baldur's Gate 3", meta: "9:00 PM to 1:30 AM · 4 h 30 min" }, { title: "Light use", meta: "10:12 AM to 9:00 PM" }] },
  { day: "Wednesday, Nov 18", rows: [{ title: "Your recording: temperatures while you play", meta: "8:10 to 8:55 PM · 45 min · found a driver reset" }] },
];

/** Option C: the recording split into stretches, like a game or a closer look. Pick one to see what it came to and its charts. */
export function OptionC() {
  const pc = useStillPC();
  const temp = useTemp();
  const phone = typeof window !== "undefined" && window.innerWidth <= 760;
  const [sel, setSel] = useState("cs-eve");
  const s = sunday.find((x) => x.id === sel)!;
  const hot = stat("gpu.hot", s.from, s.to), core = stat("gpu.temp", s.from, s.to), cpu = stat("cpu.temp", s.from, s.to), power = stat("gpu.power", s.from, s.to);
  const marks = moments.filter((m) => m.t >= s.from && m.t <= s.to);
  const [part, setPart] = useState(new URLSearchParams(location.search).get("part") ?? "all");
  const whole: Lane[] = [
    { title: "Temperatures", unit: "temp", series: [{ id: "gpu.temp", cls: "c-look", name: "Graphics card" }, { id: "gpu.hot", cls: "c-grey" }, { id: "cpu.temp", cls: "c-brass", name: "Processor" }], h: 120 },
    { title: "Usage", unit: "percent", series: [{ id: "gpu.load", cls: "c-ink", name: "Graphics card" }, { id: "cpu.load", cls: "c-brass", name: "Processor" }], h: 120 },
    { title: "Power", unit: "watt", series: [{ id: "gpu.power", cls: "c-ink", name: "Graphics card" }, { id: "cpu.power", cls: "c-brass", name: "Processor" }], h: 120 },
    { title: "Fans", unit: "rpm", series: [{ id: "gpu.fan", cls: "c-ink" }, { id: "fans.cpu", cls: "c-brass" }], h: 120 },
  ];
  const tiles = part === "all" ? whole : partLanes(part as PartId, 120).map((l) => ({ ...l, h: 120 }));
  const figs = [
    { label: "Graphics card, highest", v: temp(core.max), note: `At ${clock(core.maxAt)}. Limit ${temp(limits["gpu.temp"])}.`, look: core.max >= limits["gpu.temp"] - 5 },
    { label: "Hot spot, highest", v: temp(hot.max), note: `Limit ${temp(limits["gpu.hot"])}.` },
    { label: "Processor, highest", v: temp(cpu.max), note: `${temp(cpu.avg)} on average.` },
    { label: "Graphics card power", v: `${Math.round(power.avg)} W`, note: `Up to ${Math.round(power.max)} W.` },
  ];

  const list = (
    <aside className="op-sessions" aria-label="Recorded stretches">
      <div className="op-start">
        <button type="button" className="btn sm">Start a recording</button>
        <span className="faint">Or pick a stretch Rig already kept.</span>
      </div>
      <DayLabel day="Sunday, Nov 22" count={sunday.length} one="stretch" many="stretches" />
      <ul className="op-slist">
        {sunday.map((x) => (
          <li key={x.id}>
            <button type="button" className="op-srow" aria-pressed={x.id === sel} onClick={() => setSel(x.id)}>
              <span className="op-stitle">{x.look && <i className="op-lookdot" aria-label="Something to look at" />}{x.title}</span>
              <span className="op-smeta">{x.meta}</span>
              <Spark points={day} id="gpu.temp" from={x.from} to={x.to} w={90} h={22} cls="op-ssp" />
            </button>
          </li>
        ))}
      </ul>
      {earlier.map((d) => (
        <div key={d.day}>
          <DayLabel day={d.day} count={d.rows.length} one="stretch" many="stretches" />
          <ul className="op-slist">
            {d.rows.map((r) => <li key={r.title}><button type="button" className="op-srow"><span className="op-stitle">{r.title}</span><span className="op-smeta">{r.meta}</span></button></li>)}
          </ul>
        </div>
      ))}
    </aside>
  );

  const detail = (
    <section className="op-detail" aria-labelledby="op-d-h">
      {phone && <button type="button" className="btn ghost sm gm-back"><Icon d="M12 4 6 10l6 6" />All stretches</button>}
      <div className="op-dhead">
        <div>
          <h2 id="op-d-h" className="op-dtitle">{s.title}</h2>
          <p className="faint">Sunday, Nov 22 · {clock(s.from)} to {clock(s.to)} · {span(s.from, s.to)} · readings every 30 seconds, every 5 around 9:40 PM</p>
        </div>
        {!phone && <div className="gm-actions"><button type="button" className="btn ghost sm">Export CSV</button><button type="button" className="btn primary sm">Ask about this</button></div>}
      </div>
      <p className="lg-lede-text op-lede">The graphics card reached {temp(core.max)} at {clock(core.maxAt)}, {temp(limits["gpu.temp"] - Math.round(core.max), { delta: true, mark: "degree" })} under its limit. Everything else stayed in its usual range.</p>
      <dl className="op-figs">
        {figs.map((f) => <div key={f.label}><dt>{f.label}</dt><dd className={`num op-fig${f.look ? " look" : ""}`}>{f.v}</dd><dd className="faint">{f.note}</dd></div>)}
      </dl>
      <nav className="lg-views op-parts" aria-label="Sensors to chart">
        {[{ id: "all", name: "Whole PC" }, ...parts].map((p) => <a key={p.id} href="#logs" aria-current={part === p.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); setPart(p.id); }}>{p.name}</a>)}
      </nav>
      <div className="op-tiles">
        {tiles.map((t) => <div key={t.title} className="op-tile"><Lanes points={day} lanes={[t]} t0={s.from} t1={s.to} cursor={null} onCursor={() => {}} bands={looks} marks={marks} compact /></div>)}
      </div>
      <div className="op-two">
        <section className="op-sub">
          <h3 className="lg-h">What happened</h3>
          <Rows timeline>
            <Row time={clock(marks[0].t)} mark="look" title={`Graphics card reached ${temp(core.max)}`} meta={`Rig took a closer look for ${span(looks[0].from, looks[0].to)}.`} name="Graphics card" />
            <Row time={clock(s.from)} mark="dot" title="Counter-Strike 2 started" meta="cs2.exe, in front the whole time." name="Game" />
          </Rows>
        </section>
        <section className="op-sub">
          <h3 className="lg-h">Busiest apps</h3>
          <Rows>
            <Row title="cs2.exe" meta="38% of the processor, up to 5.1 GB" figure={<RowFigure value="94%" word="graphics card" />} name="cs2.exe" />
            <Row title="Discord" meta="4% of the processor, up to 1.2 GB" figure={<RowFigure value="3%" word="graphics card" />} name="Discord" />
            <Row title="Steam" meta="1% of the processor, up to 640 MB" name="Steam" />
          </Rows>
        </section>
      </div>
    </section>
  );

  return (
    <div className="page lg-page op-page">
      <OptHead sub={`What Rig recorded on ${pc.name}, one stretch at a time.`} />
      <RecorderLine pcName={pc.name} />
      {phone ? (new URLSearchParams(location.search).has("list") ? list : detail) : <div className="op-split">{list}{detail}</div>}
    </div>
  );
}
