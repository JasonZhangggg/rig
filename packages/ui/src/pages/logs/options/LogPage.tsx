import { useState } from "react";
import { Icon } from "../../../components/common";
import { Row, RowFigure, Rows } from "../../../components/Rows";
import { useStillPC, useTemp } from "../../../state";
import { clock, day, discordLog, games, limits, looks, moments, sensors, span, stat, watch, type PartId } from "./data";
import { Lanes, type Lane } from "./Lanes";
import { PartRail, partLanes } from "./Shared";
import "./options.css";

const M = 60_000;

/**
 * One log's own page. It leads with why the log exists and what it captured, charts the readings it was about,
 * then shows everything else Rig recorded over the same stretch, with the same parts and kinds as the live view.
 */
export function LogPage() {
  const custom = new URLSearchParams(location.search).get("kind") === "custom";
  return custom ? <CustomLog /> : <CloserLook />;
}

function Back() {
  return <a href="#logs" className="btn ghost sm gm-back op-back"><Icon d="M12 4 6 10l6 6" />Logs</a>;
}

/** The full timeline, as in option A, for the log's stretch. */
function Everything({ from, to, h, bands = [] }: { from: number; to: number; h: string; bands?: typeof looks }) {
  const phone = typeof window !== "undefined" && window.innerWidth <= 760;
  const [part, setPart] = useState("all");
  const [cursor, setCursor] = useState<number | null>(null);
  const whole: Lane[] = [
    { title: "Temperatures", unit: "temp", series: [{ id: "gpu.temp", cls: "c-ink", name: "Graphics card" }, { id: "cpu.temp", cls: "c-brass", name: "Processor" }, { id: "board.sys", cls: "c-grey", name: "Motherboard" }] },
    { title: "Usage", unit: "percent", series: [{ id: "gpu.load", cls: "c-ink", name: "Graphics card" }, { id: "cpu.load", cls: "c-brass", name: "Processor" }, { id: "ram.load", cls: "c-grey", name: "Memory" }] },
    { title: "Power", unit: "watt", series: [{ id: "gpu.power", cls: "c-ink", name: "Graphics card" }, { id: "cpu.power", cls: "c-brass", name: "Processor" }] },
    { title: "Fans", unit: "rpm", series: [{ id: "gpu.fan", cls: "c-ink" }, { id: "fans.cpu", cls: "c-brass" }, { id: "fans.sys1", cls: "c-grey" }] },
  ];
  const lanes = part === "all" ? whole : partLanes(part as PartId);
  return (
    <section className="lg-section op-all" aria-labelledby="op-all-h">
      <div className="op-sech">
        <h2 id="op-all-h" className="lg-h">{h}</h2>
        {!phone && <button type="button" className="btn ghost sm">Export CSV</button>}
      </div>
      <div className="op-tl-grid">
        <PartRail pick={part} onPick={setPart} from={from} to={to} whole />
        <Lanes points={day} lanes={lanes} t0={from} t1={to} cursor={cursor} onCursor={setCursor} bands={bands} marks={moments} compact={phone} />
      </div>
    </section>
  );
}

/** A closer look the recorder started on its own. */
function CloserLook() {
  const pc = useStillPC();
  const temp = useTemp();
  const phone = typeof window !== "undefined" && window.innerWidth <= 760;
  const look = looks[0], trigger = moments[0], game = games[1];
  const core = stat("gpu.temp", look.from, look.to), hot = stat("gpu.hot", look.from, look.to), fan = stat("gpu.fan", look.from, look.to), power = stat("gpu.power", look.from, look.to);
  const readings = day.filter((p) => p.t >= look.from && p.t <= look.to).length;
  const lastHot = [...day].reverse().find((p) => p.t <= look.to && p.v["gpu.temp"] >= watch["gpu.temp"])!.t;
  const [cursor, setCursor] = useState<number | null>(trigger.t);
  // Chart a little either side, so the switch from every 30 seconds to every 5 shows.
  const from = look.from - 8 * M, to = look.to + 8 * M;
  const lead: Lane[] = [
    { title: "Graphics card temperature", unit: "temp", limit: watch["gpu.temp"], h: phone ? 130 : 170, series: [{ id: "gpu.temp", cls: "c-look", name: "GPU core" }, { id: "gpu.hot", cls: "c-grey" }] },
    { title: "What it was doing", unit: "percent", series: [{ id: "gpu.load", cls: "c-ink", name: "GPU usage" }, { id: "gpu.fanpct", cls: "c-brass", name: "GPU fans" }] },
    { title: "Power", unit: "watt", series: [{ id: "gpu.power", cls: "c-ink", name: "Graphics card" }] },
  ];

  return (
    <div className="page lg-page op-page op-log">
      <div className="op-loghead">
        <Back />
        <p className="op-kind"><i className="op-lookdot" aria-hidden="true" />Closer look · started by Rig's recorder</p>
        <h1 className="op-logtitle">Graphics card reached {temp(watch["gpu.temp"])}</h1>
        <p className="faint op-when">{pc.name} · Sunday, Nov 22 · {clock(look.from)} to {clock(look.to)} · {span(look.from, look.to)}</p>
      </div>

      <section className="op-why" aria-labelledby="op-why-h">
        <h2 id="op-why-h" className="lg-h">Why Rig kept this</h2>
        <p className="op-verdict">During {game.title}, the graphics card read {temp(watch["gpu.temp"])} or more twice in a row at {clock(trigger.t)}. Rig watches for that, so it switched from a reading every 30 seconds to one every 5, kept the minutes before it, and stopped 3 minutes after it cooled.</p>
      </section>

      <section className="op-cap" aria-labelledby="op-cap-h">
        <h2 id="op-cap-h" className="lg-h">What it captured</h2>
        <Rows>
          <Row title="The reading that started it" meta={`GPU core temperature. ${temp(watch["gpu.temp"])} or more from ${clock(trigger.t)} to ${clock(lastHot)}.`} figure={<RowFigure value={temp(core.max)} word="highest" look />} name="Trigger" />
          <Row title="Every sensor, every 5 seconds" meta="Temperatures, usage, power and fans on every part. Not clocks or voltages." figure={<RowFigure value={sensors.length} word="sensors" />} name="Sensors" />
          <Row title="Busiest apps, every minute" meta="cs2.exe the whole time, then Discord and Steam." figure={<RowFigure value="5" word="apps" />} name="Apps" />
          <Row title="Windows errors and warnings" meta="Crashes, driver resets, hardware and power events. None in this stretch." figure={<RowFigure value="0" word="events" />} name="Events" />
        </Rows>
        <p className="faint op-note-sm">{readings} readings of each sensor in {span(look.from, look.to)}, where the usual log keeps {Math.round((look.to - look.from) / 30_000)}.</p>
      </section>

      <section className="op-lead" aria-labelledby="op-lead-h">
        <div className="op-sech">
          <h2 id="op-lead-h" className="lg-h">The graphics card around it</h2>
          <span className="faint op-legend"><i className="op-limitkey" aria-hidden="true" />{temp(watch["gpu.temp"])}, what Rig watches for</span>
        </div>
        <Lanes points={day} lanes={lead} t0={from} t1={to} cursor={cursor} onCursor={(t) => setCursor(t ?? trigger.t)} bands={[look]} marks={[trigger]} compact={phone} />
      </section>

      <section className="op-came" aria-labelledby="op-came-h">
        <h2 id="op-came-h" className="lg-h">What it came to</h2>
        <p className="op-verdict">The card peaked at {temp(core.max)} at {clock(core.maxAt)}, {temp(limits["gpu.temp"] - Math.round(core.max), { delta: true, mark: "degree" })} under its limit, and the hot spot at {temp(hot.max)}. The fans were up to {Math.round(fan.max).toLocaleString("en-US")} rpm and power to {Math.round(power.max)} W, so it was working hard, not failing. Nothing crashed or reset.</p>
      </section>

      <Everything from={look.from} to={look.to} h="Everything else it recorded" />
    </div>
  );
}

/** A custom log Rig's chat set up: one thing, chosen to answer one question. */
function CustomLog() {
  const pc = useStillPC();
  const phone = typeof window !== "undefined" && window.innerWidth <= 760;
  const log = discordLog;
  const crash = moments[1];
  const from = games[1].from - 150 * M, to = log.points.at(-1)!.t;
  const before = log.points.filter((p) => p.t >= from && p.t < crash.t);
  const after = log.points.filter((p) => p.t > crash.t);
  const memStart = before[0].v.mem, memPeak = Math.max(...before.map((p) => p.v.mem)), memAfter = after[0].v.mem;
  const [cursor, setCursor] = useState<number | null>(crash.t - 30_000);
  const lanes: Lane[] = [
    { title: "Discord's memory", unit: "mb", h: phone ? 130 : 170, series: [{ id: "mem", cls: "c-look", name: "Discord.exe" }] },
    { title: "Discord's share of the processor", unit: "percent", series: [{ id: "cpu", cls: "c-ink", name: "Discord.exe" }] },
  ];
  const gb = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`);

  return (
    <div className="page lg-page op-page op-log">
      <div className="op-loghead">
        <Back />
        <p className="op-kind">Custom log · set up by Rig in chat on Saturday at {clock(log.started)}</p>
        <h1 className="op-logtitle">Discord's memory and processor use</h1>
        <p className="faint op-when">{pc.name} · every {log.every} seconds while Discord is open · runs until Dec 6</p>
      </div>

      <section className="op-why" aria-labelledby="op-why-h">
        <h2 id="op-why-h" className="lg-h">Why Rig kept this</h2>
        <p className="op-verdict">Discord crashed on Saturday night while nothing else was busy. You asked why, and Rig set this up to check one thing: whether Discord's memory keeps climbing until it crashes. That would be a leak in Discord, not a problem with the PC.</p>
      </section>

      <section className="op-cap" aria-labelledby="op-cap-h">
        <h2 id="op-cap-h" className="lg-h">What it captures</h2>
        <Rows>
          <Row title="Discord.exe memory" meta="How much memory Discord holds, every 10 seconds." figure={<RowFigure value={gb(memPeak)} word="highest" look />} name="Memory" />
          <Row title="Discord.exe processor use" meta="Its share of the processor, every 10 seconds." figure={<RowFigure value={`${Math.max(...log.points.map((p) => p.v.cpu))}%`} word="highest" />} name="Processor" />
          <Row title="Whether Discord is open" meta="Gaps in the lines are when it wasn't. Nothing else is read." figure={<RowFigure value="1" word="gap" />} name="Running" />
        </Rows>
      </section>

      <section className="op-lead" aria-labelledby="op-lead-h">
        <div className="op-sech"><h2 id="op-lead-h" className="lg-h">Sunday evening</h2></div>
        <Lanes points={log.points} lanes={lanes} t0={from} t1={to} cursor={cursor} onCursor={(t) => setCursor(t ?? crash.t - 30_000)} bands={games} marks={[{ ...crash, title: "Discord crashed" }]} compact={phone} />
      </section>

      <section className="op-came" aria-labelledby="op-came-h">
        <h2 id="op-came-h" className="lg-h">What it came to</h2>
        <p className="op-verdict">It points to a leak in Discord. Its memory climbed from {gb(memStart)} at {clock(from)} to {gb(memPeak)} just before it crashed at {clock(crash.t)}, while its processor use stayed low. It reopened at {gb(memAfter)} and has started climbing again.</p>
      </section>

      <Everything from={from} to={to} h="The rest of the PC at the time" bands={[...games, ...looks]} />
    </div>
  );
}
