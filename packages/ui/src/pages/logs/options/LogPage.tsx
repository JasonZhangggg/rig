import { useState } from "react";
import { Icon } from "../../../components/common";
import { useTemp } from "../../../state";
import { clock, day, discordLog, games, limits, looks, moments, sensors, stat, watch, type PartId } from "./data";
import { Lanes, type Lane } from "./Lanes";
import { PartRail, partLanes } from "./Shared";
import "./options.css";

const M = 60_000;

/**
 * One log's own page. What happened and the readings that matter come first, then the chart of them,
 * then every sensor over the same stretch.
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

/** The few readings that matter, big, with a short label each. */
function Figures({ items }: { items: { label: string; v: string; note?: string; look?: boolean }[] }) {
  return (
    <dl className="op-figs op-keyfigs">
      {items.map((f) => <div key={f.label}><dt>{f.label}</dt><dd className={`num op-fig${f.look ? " look" : ""}`}>{f.v}</dd>{f.note && <dd className="faint">{f.note}</dd>}</div>)}
    </dl>
  );
}

/** A closer look the recorder started on its own. */
function CloserLook() {
  const temp = useTemp();
  const phone = typeof window !== "undefined" && window.innerWidth <= 760;
  const look = looks[0], trigger = moments[0], game = games[1];
  const core = stat("gpu.temp", look.from, look.to), hot = stat("gpu.hot", look.from, look.to), fan = stat("gpu.fanpct", look.from, look.to), power = stat("gpu.power", look.from, look.to);
  const [cursor, setCursor] = useState<number | null>(core.maxAt);
  const from = look.from - 8 * M, to = look.to + 8 * M;
  const lead: Lane[] = [
    { title: "Temperature", unit: "temp", limit: watch["gpu.temp"], h: phone ? 130 : 170, series: [{ id: "gpu.temp", cls: "c-look", name: "GPU core" }, { id: "gpu.hot", cls: "c-grey" }] },
    { title: "Usage and fans", unit: "percent", series: [{ id: "gpu.load", cls: "c-ink", name: "GPU usage" }, { id: "gpu.fanpct", cls: "c-brass", name: "GPU fans" }] },
    { title: "Power", unit: "watt", series: [{ id: "gpu.power", cls: "c-ink", name: "Graphics card" }] },
  ];

  return (
    <div className="page lg-page op-page op-log">
      <div className="op-loghead">
        <Back />
        <h1 className="op-logtitle">Graphics card hit {temp(core.max)}</h1>
        <p className="op-when">Sunday, {clock(core.maxAt)} · {game.title} · no crash</p>
      </div>

      <Figures items={[
        { label: "GPU core", v: temp(core.max), note: `limit ${temp(limits["gpu.temp"])}`, look: true },
        { label: "Hot spot", v: temp(hot.max), note: `limit ${temp(limits["gpu.hot"])}` },
        { label: "GPU fans", v: `${Math.round(fan.max)}%` },
        { label: "Power", v: `${Math.round(power.max)} W` },
        { label: "Busiest app", v: "cs2.exe", note: "98% GPU" },
      ]} />

      <section className="op-lead" aria-label="Graphics card">
        <Lanes points={day} lanes={lead} t0={from} t1={to} cursor={cursor} onCursor={(t) => setCursor(t ?? core.maxAt)} bands={[look]} marks={[trigger]} compact={phone} />
        <p className="faint op-src"><i className="op-limitkey" aria-hidden="true" />{temp(watch["gpu.temp"])} starts a closer look · every 5 s from {clock(look.from)} to {clock(look.to)} · {sensors.length} sensors</p>
      </section>

      <Everything from={look.from} to={look.to} h="All sensors" />
    </div>
  );
}

/** A custom log Rig's chat set up: one thing, chosen to answer one question. */
function CustomLog() {
  const phone = typeof window !== "undefined" && window.innerWidth <= 760;
  const log = discordLog;
  const crash = moments[1];
  const from = games[1].from - 150 * M, to = log.points.at(-1)!.t;
  const before = log.points.filter((p) => p.t >= from && p.t < crash.t);
  const after = log.points.filter((p) => p.t > crash.t);
  const memStart = before[0].v.mem, memPeak = Math.max(...before.map((p) => p.v.mem)), memNow = after.at(-1)!.v.mem;
  const [cursor, setCursor] = useState<number | null>(crash.t - 30_000);
  const lanes: Lane[] = [
    { title: "Memory", unit: "mb", h: phone ? 130 : 170, series: [{ id: "mem", cls: "c-look", name: "Discord.exe" }] },
    { title: "Processor", unit: "percent", series: [{ id: "cpu", cls: "c-ink", name: "Discord.exe" }] },
  ];
  const gb = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`);

  return (
    <div className="page lg-page op-page op-log">
      <div className="op-loghead">
        <Back />
        <h1 className="op-logtitle">Discord crashed at {gb(memPeak)} of memory</h1>
        <p className="op-when">Sunday, {clock(crash.t)} · likely a memory leak in Discord</p>
      </div>

      <Figures items={[
        { label: "Memory before crash", v: gb(memPeak), note: `from ${gb(memStart)} at ${clock(from)}`, look: true },
        { label: "Memory now", v: gb(memNow), note: "climbing again" },
        { label: "Processor", v: `${Math.max(...log.points.map((p) => p.v.cpu))}%`, note: "highest" },
        { label: "Crashes", v: "1", note: clock(crash.t) },
      ]} />

      <section className="op-lead" aria-label="Discord">
        <Lanes points={log.points} lanes={lanes} t0={from} t1={to} cursor={cursor} onCursor={(t) => setCursor(t ?? crash.t - 30_000)} bands={games} marks={[crash]} compact={phone} />
        <p className="faint op-src">Custom log, set up in chat · Discord.exe only · every {log.every} s while open · until Dec 6</p>
      </section>

      <Everything from={from} to={to} h="All sensors" bands={[...games, ...looks]} />
    </div>
  );
}
