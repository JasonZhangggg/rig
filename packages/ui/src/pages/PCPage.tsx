import { useEffect, useRef, useState } from "react";
import { formatTemp, type ActionCall, type Part, type TempUnit } from "@rig/core";
import { Sparkline } from "../chart";
import { StageSlot, getStage, hoverPart, useStageHover } from "../components/Stage";
import { useApp, useTemp, useTempText, useTempUnit } from "../state";
import { OtherManuals } from "../manuals/OtherManuals";
import { PartManual } from "../manuals/PartManual";
import { pcAccents } from "../themes";
import { CLEAN_EVERY, daysSince } from "./shared";
import { PartUpgrade, UpgradesCard, partOf, useUpgrades, type PCUpgrades } from "./upgrades/PCUpgrades";

/** The last few readings of a value, kept while the page is open, after any earlier readings it starts from. */
function useTrail(key: string, value: number | undefined, tick: string | undefined, size = 40, seed: number[] = []) {
  const [trail, setTrail] = useState<{ key: string; v: number[] }>({ key, v: [] });
  useEffect(() => {
    if (value == null) return;
    setTrail((t) => ({ key, v: [...(t.key === key ? t.v : seed), value].slice(-size) }));
    // The seed only matters when the trail starts.
  }, [key, value, tick, size]);
  useEffect(() => {
    if (seed.length) setTrail((t) => (t.key === key && t.v.length > 1 ? t : { key, v: [...seed, ...(t.key === key ? t.v : [])].slice(-size) }));
  }, [key, seed, size]);
  const v = trail.key === key ? trail.v : [];
  return v.length > 1 ? v : value != null ? [value, value] : [];
}

const driverPages: Record<string, string> = {
  NVIDIA: "https://www.nvidia.com/en-us/drivers/",
  AMD: "https://www.amd.com/en/support/download/drivers.html",
  Intel: "https://www.intel.com/content/www/us/en/support/detect.html",
};

export function PCPage() {
  const { ui, pc, set } = useApp();
  const [customize, setCustomize] = useState(false);
  const customizeBtn = useRef<HTMLButtonElement>(null);
  const closeCustomize = () => { setCustomize(false); customizeBtn.current?.focus(); };
  // Escape closes the open panel: Customize first, then the part's details.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || ui.palette || ui.review) return;
      if (customize) closeCustomize();
      else if (ui.selected) getStage().scene.select(null);
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });
  const toggle = (k: "exploded" | "heat" | "airflow") => set({ [k]: !ui[k] });
  const ups = useUpgrades();
  return (
    <div className="page">
      <div className="page-head"><div><h1>{pc.name} in 3D</h1><p className="sub">Point at a part to find it, pick it for details. Drag to turn, scroll to zoom.</p></div></div>
      <div className="pc-view">
        <section className="card stage-card">
          <StageSlot id="pc-stage" />
          <div className="stage-top">
            {pc.model?.label ? <span className="stage-src">{pc.model.label}</span> : <span />}
            <button ref={customizeBtn} className="btn sm stage-btn" type="button" onClick={() => setCustomize(!customize)} aria-expanded={customize}>Customize</button>
          </div>
          {customize && <Customize onDone={closeCustomize} />}
          <div className="stage-tools" role="toolbar" aria-label="View">
            <button className="btn sm" type="button" aria-pressed={ui.exploded} onClick={() => toggle("exploded")}>Exploded view</button>
            <button className="btn sm" type="button" aria-pressed={ui.heat} onClick={() => toggle("heat")}>Heat</button>
            <button className="btn sm" type="button" aria-pressed={ui.airflow} onClick={() => toggle("airflow")}>Airflow</button>
            <button className="btn ghost sm" type="button" onClick={() => getStage().scene.resetView()}>Reset view</button>
          </div>
        </section>
        <div className="pc-side">
          <aside className="card detail"><Detail ups={ups} /></aside>
          <QuickSwitches />
        </div>
      </div>
      <UpgradesCard ups={ups} />
    </div>
  );
}

function Customize({ onDone }: { onDone: () => void }) {
  const { pc, client, toast } = useApp();
  const [name, setName] = useState(pc.name);
  const update = (patch: { name?: string; accent?: string }) => client.rename(pc.id, patch).catch(() => toast("Couldn't save that. Try again."));
  return (
    <div className="card customize" role="dialog" aria-label="Customize">
      <div className="field"><label className="label" htmlFor="pc-name">Name</label><input className="input" id="pc-name" autoFocus value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== pc.name && update({ name: name.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></div>
      <div className="field">
        <span className="label">Accent color</span>
        <div className="swatches">
          {pcAccents.map((a) => <button key={a} type="button" className="swatch" style={{ background: a }} aria-label={`Accent ${a}`} aria-pressed={a.toLowerCase() === pc.accent.toLowerCase()} onClick={() => update({ accent: a })} />)}
        </div>
      </div>
      <p className="faint customize-note">The accent marks this PC in your list of PCs.</p>
      <div className="customize-foot"><button className="btn primary sm" type="button" onClick={() => { if (name.trim() && name !== pc.name) update({ name: name.trim() }); onDone(); }}>Done</button></div>
    </div>
  );
}

/** Windows settings that are one tap away, each shown for review before it changes. */
function QuickSwitches() {
  const { pc, client, review } = useApp();
  const s = pc.settings;
  const high = s?.powerPlans.find((p) => /high performance/i.test(p.name));
  const balanced = s?.powerPlans.find((p) => /balanced/i.test(p.name));
  const switches: { key: string; title: string; body: string; on: boolean; flip: ActionCall | null }[] = s ? [
    { key: "game", title: "Game Mode", body: "Windows puts games first while they run", on: s.gameMode, flip: { kind: "windows.gameMode", enabled: !s.gameMode } },
    { key: "power", title: "High performance", body: "Full speed all the time. Warmer at idle.", on: !!high?.active, flip: high && balanced ? { kind: "power.plan", guid: high.active ? balanced.guid : high.guid } : null },
    { key: "fx", title: "Fewer animations", body: "Snappier windows on slower PCs", on: s.visualEffects === "performance", flip: { kind: "windows.visualEffects", mode: s.visualEffects === "performance" ? "auto" : "performance" } },
  ] : [];
  return (
    <section className="card switches">
      <div className="card-head"><h2>Quick switches</h2></div>
      <div className="switch-list">
        {switches.length ? switches.map((w) => (
          <button key={w.key} type="button" className="switch" role="switch" aria-checked={w.on} disabled={!w.flip}
            onClick={() => w.flip && review([w.flip], { by: "you", title: `Turn ${w.title} ${w.on ? "off" : "on"}`, cta: w.on ? "Turn off" : "Turn on" })}>
            <span><b>{w.title}</b><small>{w.body}</small></span><i />
          </button>
        )) : <p className="muted">{client.caps.local ? "Reading Windows settings…" : `Switches work in the Rig app on ${pc.name}.`}</p>}
      </div>
    </section>
  );
}

/** One line that says what the parts list means: what needs a look, or that nothing does. */
export function partsSummary(parts: Part[], name: string, online: boolean) {
  if (!parts.length) return `Rig hasn't read ${name}'s parts yet. They show up here once the Rig app on ${name} sends its first reading.`;
  const hot = parts.filter((p) => p.warn);
  if (hot.length === 1) return `Your ${hot[0].type.toLowerCase()} needs a look.`;
  if (hot.length > 1) return `${hot.length} parts need a look.`;
  if (parts.some((p) => p.temp != null)) return online ? "Nothing is running hot right now." : "Nothing was running hot at the last reading.";
  return "Pick one for its specs, manual and drivers.";
}

/** The last hour of processor and graphics card readings, so their sparklines have a shape from the start. */
function useRecent() {
  const { client, pc } = useApp();
  const [got, setGot] = useState<{ id: string; cpu: number[]; gpu: number[] } | null>(null);
  useEffect(() => {
    let live = true;
    client.history(pc.id, "day").then((pts) => {
      const hour = pts.filter((p) => p.t >= Date.now() - 36e5);
      const of = (k: "cpu" | "gpu") => hour.map((p) => p[k]).filter((v): v is number => v != null).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 30)) === 0);
      if (live) setGot({ id: pc.id, cpu: of("cpu"), gpu: of("gpu") });
    }).catch(() => {});
    return () => { live = false; };
  }, [client, pc.id]);
  return got?.id === pc.id ? got : null;
}

const none: number[] = [];

/** One part in the list: what it is, its temperature as it moves, and a light on it in the 3D view while pointed at. */
function PartRow({ id, part, lit, seed }: { id: string; part: Part; lit: boolean; seed?: number[] }) {
  const { pc } = useApp();
  const temp = useTemp();
  const trail = useTrail(`${pc.id}:${id}`, part.temp, pc.seenAt, 30, seed ?? none);
  return (
    <li>
      <button type="button" className={lit ? "is-lit" : undefined} onClick={() => getStage().scene.select(id)}
        onPointerEnter={() => hoverPart(id)} onPointerLeave={() => hoverPart(null)} onFocus={() => hoverPart(id)} onBlur={() => hoverPart(null)}>
        <span className="part-txt"><span className="pt">{part.type}</span><span className="pn">{part.name}</span></span>
        {part.temp !== undefined && (
          <span className="part-live">
            <Sparkline values={trail} w={48} h={18} warn={part.warn} />
            <span key={Math.round(part.temp)} className={`num part-temp${part.warn ? " look" : ""}`}>{temp(part.temp)}</span>
          </span>
        )}
      </button>
    </li>
  );
}

function Detail({ ups }: { ups: PCUpgrades }) {
  const { ui, pc, set } = useApp();
  const parts = pc.parts ?? {};
  const lit = useStageHover();
  const recent = useRecent();
  // Leaving the page or opening a part takes the light off whatever row was pointed at.
  useEffect(() => () => hoverPart(null), [ui.selected]);
  const select = (id: string | null) => getStage().scene.select(id);
  if (!ui.selected || !parts[ui.selected]) {
    const list = Object.entries(parts);
    return (
      <>
        <div className="parts-head">
          <div className="parts-title"><h2>Parts</h2>{list.length > 0 && <span className="faint num">{list.length}</span>}</div>
          <p className="parts-sum">{partsSummary(list.map(([, v]) => v), pc.name, pc.online)}</p>
        </div>
        {list.length > 0 && (
          <ul className="part-list" aria-label="Parts">
            {list.map(([k, v]) => <PartRow key={k} id={k} part={v} lit={lit === k} seed={k === "cpu" || k === "gpu" ? recent?.[k] : undefined} />)}
          </ul>
        )}
        <OtherManuals />
      </>
    );
  }
  const id = ui.selected;
  const part = parts[id];
  const ideas = ups.list?.filter((u) => partOf(u, pc) === id) ?? [];
  const tabs: [string, string][] = [["live", "Live"], ["specs", "Specs"], ["manual", "Manual"]];
  if (ideas.length) tabs.push(["upgrade", "Upgrade"]);
  if (part.driver) tabs.push(["drivers", part.driver.installed.startsWith("BIOS") ? "BIOS" : "Drivers"]);
  const tab = tabs.some(([t]) => t === ui.tab) ? ui.tab : "live";
  return (
    <>
      <div className="detail-head">
        <button className="detail-back" type="button" onClick={() => select(null)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          All parts
        </button>
        <div className="pt">{part.type}</div>
        <h2>{part.name}</h2>
        {part.sub && <div className="faint">{part.sub}</div>}
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => set({ tab: t })}>{l}</button>)}
      </div>
      <div className="detail-body">{tab === "upgrade" ? <PartUpgrade ideas={ideas} ups={ups} /> : <DetailTab part={part} id={id} tab={tab} />}</div>
    </>
  );
}

/** How a temperature sits against the part's safe limit, in words. */
/** "8° under its 88°C limit", in the viewer's unit; the gap is a difference, so it's scaled but not offset. */
export function limitWords(temp: number | undefined, limit: number | undefined, unit: TempUnit = "c") {
  if (temp == null || !limit) return "running warm";
  const d = Math.round(limit - temp);
  const gap = formatTemp(Math.abs(limit - temp), unit, { delta: true, mark: "degree" });
  const lim = formatTemp(limit, unit);
  return d > 0 ? `${gap} under its ${lim} limit` : d < 0 ? `${gap} over its ${lim} limit` : `right at its ${lim} limit`;
}

const size = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb} GB`);

/** How full the drives are, by what's using the space. */
function Space() {
  const { pc } = useApp();
  const st = pc.storage;
  if (!st) return <p className="muted">Reading drives…</p>;
  return (
    <div className="space">
      <div className="space-head"><span className="label">Space</span><span className="faint">{size(st.totalGb)}</span></div>
      <div className="space-bar" aria-hidden="true">
        {st.slices.map((x) => <i key={x.label} className={x.label === "Free" ? "free" : undefined} style={{ flexGrow: x.gb }} />)}
      </div>
      <table className="kv"><tbody>{st.slices.map((x) => <tr key={x.label}><th>{x.label}</th><td className="num">{size(x.gb)}</td></tr>)}</tbody></table>
    </div>
  );
}

/** When the dust was last cleaned out, so Rig can remind you when it's due. */
function DustClean() {
  const { pc, client, toast } = useApp();
  const days = daysSince(pc.cleanedAt);
  const cleaned = () => client.rename(pc.id, { cleanedAt: new Date().toISOString() }).catch(() => toast("Couldn't save that. Try again."));
  return (
    <div className="callout dust">
      <p>{days == null ? "Tell Rig when you clean the dust out and it will remind you when it's due." : days === 0 ? `Cleaned today. Rig will remind you in ${CLEAN_EVERY} days.` : `Last cleaned ${days} ${days === 1 ? "day" : "days"} ago. Rig suggests every ${CLEAN_EVERY} days.`}</p>
      {days !== 0 && <button type="button" className="btn sm" onClick={cleaned}>I cleaned it today</button>}
    </div>
  );
}

function SourceBadge({ part }: { part: Part }) {
  return part.modelSource === "library"
    ? <div className="source-badge"><span className="chip ok no-dot">3D model matched</span>From the model library</div>
    : <div className="source-badge"><span className="chip no-dot">3D shape from size</span>{part.dims ?? "Built from the part's size and color"}</div>;
}

function DetailTab({ part, id, tab }: { part: Part; id: string; tab: string }) {
  const { pc, ask } = useApp();
  const temp = useTemp();
  const unit = useTempUnit();
  const inUnit = useTempText();
  const [q, setQ] = useState("");
  const trail = useTrail(`${pc.id}:${id}`, part.temp, pc.seenAt);
  if (tab === "specs") {
    return <><table className="kv"><tbody>{part.specs.map(([k, v]) => <tr key={k}><th>{k}</th><td>{inUnit(v)}</td></tr>)}</tbody></table><SourceBadge part={part} /></>;
  }
  if (tab === "manual") {
    return (
      <>
        <PartManual id={id} />
        <form className="ask-inline" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(`About my ${part.name}: ${q.trim()}`); }}>
          <input id="ask-manual" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask this manual a question" aria-label="Ask this manual a question" />
          <button className="btn sm">Ask</button>
        </form>
        <p className="faint detail-note">Answers name the manual and page they came from.</p>
      </>
    );
  }
  if (tab === "drivers" && part.driver) {
    const d = part.driver;
    const maker = Object.keys(driverPages).find((k) => d.installed.startsWith(k) || part.name.includes(k));
    return (
      <>
        <table className="kv"><tbody><tr><th>Installed</th><td className="num">{d.installed}</td></tr>{d.latest && <tr><th>Latest</th><td className="num">{d.latest}</td></tr>}</tbody></table>
        {d.note && <p className="muted">{d.note}</p>}
        <div className="detail-actions">
          <button className="btn" type="button" onClick={() => ask(`Is there a newer ${part.type.toLowerCase()} ${d.installed.startsWith("BIOS") ? "BIOS" : "driver"} for my ${part.name}? I have ${d.installed}.`)}>Ask if there's a newer one</button>
          {maker && <a className="btn ghost" href={driverPages[maker]} target="_blank" rel="noreferrer">{maker} downloads</a>}
        </div>
        <p className="faint detail-note">Rig never installs drivers or BIOS updates by itself.</p>
      </>
    );
  }
  const tiles: JSX.Element[] = [];
  if (part.temp !== undefined) {
    tiles.push(
      <div key="t" className={`live live-wide${part.warn ? " warn" : ""}`}>
        <span className="label">Temperature</span>
        <span className="live-row"><span key={Math.round(part.temp)} className="big live-tick">{temp(part.temp)}</span><Sparkline values={trail} w={150} h={30} warn={part.warn} /></span>
        {part.limit ? (
          <span className="live-meter" role="img" aria-label={limitWords(part.temp, part.limit, unit)}>
            <i style={{ width: `${Math.min(100, (part.temp / part.limit) * 100)}%` }} /><span className="faint">{limitWords(part.temp, part.limit, unit)}</span>
          </span>
        ) : null}
      </div>,
    );
  }
  if (part.tempMax !== undefined) tiles.push(<div key="m" className="live"><span className="label">Highest today</span><span className="big">{temp(part.tempMax)}</span></div>);
  if (part.load !== undefined) tiles.push(<div key="l" className="live"><span className="label">Load</span><span key={part.load} className="big live-tick">{part.load}%</span><span className="bar live-load" aria-hidden="true"><i style={{ width: `${part.load}%` }} /></span></div>);
  if (part.clock) tiles.push(<div key="c" className="live"><span className="label">Clock</span><span className="big">{part.clock}</span></div>);
  if (part.fan) tiles.push(<div key="f" className="live"><span className="label">Fan</span><span className="big">{part.fan.toLocaleString()} rpm</span></div>);
  return (
    <>
      {tiles.length
        ? <div className="live-grid">{tiles}</div>
        : <table className="kv"><tbody>{part.specs.slice(0, 3).map(([k, v]) => <tr key={k}><th>{k}</th><td>{inUnit(v)}</td></tr>)}</tbody></table>}
      {part.warn && (
        <>
          <div className="callout warn">{temp(part.temp)} is {limitWords(part.temp, part.limit, unit)}. {inUnit(pc.issues?.find((i) => i.part === id)?.body ?? "")}</div>
          <a className="btn" href="#chat">Ask what to do</a>
        </>
      )}
      {part.soldered && <div className="callout">Soldered to the board, so it can't be upgraded.</div>}
      {id === "ssd" && <Space />}
      {id === "fans" && <DustClean />}
      <SourceBadge part={part} />
    </>
  );
}
