import { useEffect, useState } from "react";
import type { Part } from "@rig/core";
import { Sparkline } from "../chart";
import { StageSlot, getStage } from "../components/Stage";
import { useApp } from "../state";
import { pcAccents } from "../themes";

/** The last few readings of a value, kept while the page is open. */
function useTrail(key: string, value: number | undefined, tick: string | undefined, size = 40) {
  const [trail, setTrail] = useState<{ key: string; v: number[] }>({ key, v: [] });
  useEffect(() => {
    if (value == null) return;
    setTrail((t) => ({ key, v: [...(t.key === key ? t.v : []), value].slice(-size) }));
  }, [key, value, tick, size]);
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
  const toggle = (k: "exploded" | "heat" | "airflow") => set({ [k]: !ui[k] });
  return (
    <div className="page">
      <div className="page-head"><div><h1>{pc.name} in 3D</h1><p className="sub">Click any part for temperatures, specs, its manual and drivers. Drag to turn, scroll to zoom.</p></div></div>
      <div className="pc-view">
        <section className="card stage-card">
          <StageSlot id="pc-stage" />
          <div className="stage-top">
            <div className="id-chip">
              <span className="dot" />
              <div><strong>{pc.name}</strong><div className="src">{pc.model?.label}</div></div>
              <button className="btn ghost sm" type="button" onClick={() => setCustomize(!customize)} aria-expanded={customize}>Customize</button>
            </div>
          </div>
          {customize && <Customize onDone={() => setCustomize(false)} />}
          <div className="stage-tools" role="toolbar" aria-label="View">
            <button className="btn sm" type="button" aria-pressed={ui.exploded} onClick={() => toggle("exploded")}>Exploded view</button>
            <button className="btn sm" type="button" aria-pressed={ui.heat} onClick={() => toggle("heat")}>Heat</button>
            <button className="btn sm" type="button" aria-pressed={ui.airflow} onClick={() => toggle("airflow")}>Airflow</button>
            <button className="btn ghost sm" type="button" onClick={() => getStage().scene.resetView()}>Reset view</button>
          </div>
        </section>
        <aside className="card detail"><Detail /></aside>
      </div>
    </div>
  );
}

function Customize({ onDone }: { onDone: () => void }) {
  const { pc, client, toast } = useApp();
  const [name, setName] = useState(pc.name);
  const update = (patch: { name?: string; accent?: string }) => client.rename(pc.id, patch).catch(() => toast("Couldn't save that. Try again."));
  return (
    <div className="card customize" role="dialog" aria-label="Customize">
      <div className="field"><label className="label" htmlFor="pc-name">Name</label><input className="input" id="pc-name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== pc.name && update({ name: name.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></div>
      <div className="field">
        <span className="label">Accent color</span>
        <div className="swatches">
          {pcAccents.map((a) => <button key={a} type="button" className="swatch" style={{ background: a }} aria-label={`Accent ${a}`} aria-pressed={a.toLowerCase() === pc.accent.toLowerCase()} onClick={() => update({ accent: a })} />)}
        </div>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>The accent lights up your case and fans in 3D, and marks this PC everywhere you see it.</p>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><button className="btn primary sm" type="button" onClick={() => { if (name.trim() && name !== pc.name) update({ name: name.trim() }); onDone(); }}>Done</button></div>
    </div>
  );
}

function Detail() {
  const { ui, pc, set } = useApp();
  const parts = pc.parts ?? {};
  const select = (id: string | null) => getStage().scene.select(id);
  if (!ui.selected || !parts[ui.selected]) {
    return (
      <>
        <div className="card-head"><h2>Parts</h2><span className="faint">{Object.keys(parts).length}</span></div>
        <div className="part-list">
          {Object.entries(parts).map(([k, v]) => (
            <button key={k} type="button" onClick={() => select(k)}>
              <span><div className="pt">{v.type}</div>{v.name}</span>
              {v.temp !== undefined && <span className={`num${v.warn ? "" : " faint"}`} style={v.warn ? { color: "var(--warn)" } : undefined}>{v.temp}°C</span>}
            </button>
          ))}
        </div>
      </>
    );
  }
  const id = ui.selected;
  const part = parts[id];
  const tabs: [string, string][] = [["live", "Live"], ["specs", "Specs"], ["manual", "Manual"]];
  if (part.driver) tabs.push(["drivers", part.driver.installed.startsWith("BIOS") ? "BIOS" : "Drivers"]);
  const tab = tabs.some(([t]) => t === ui.tab) ? ui.tab : "live";
  return (
    <>
      <div className="card-head">
        <div><div className="label">{part.type}</div><h2 className="plain-h">{part.name}</h2>{part.sub && <div className="faint">{part.sub}</div>}</div>
        <button className="btn ghost sm" type="button" onClick={() => select(null)} aria-label="Close">✕</button>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => set({ tab: t })}>{l}</button>)}
      </div>
      <div className="detail-body"><DetailTab part={part} id={id} tab={tab} /></div>
    </>
  );
}

function SourceBadge({ part }: { part: Part }) {
  return part.modelSource === "library"
    ? <div className="source-badge"><span className="chip ok no-dot">3D model matched</span>From the model library</div>
    : <div className="source-badge"><span className="chip no-dot">3D shape from size</span>{part.dims ?? "Built from the part's size and color"}</div>;
}

function DetailTab({ part, id, tab }: { part: Part; id: string; tab: string }) {
  const { pc, ask } = useApp();
  const [q, setQ] = useState("");
  const trail = useTrail(`${pc.id}:${id}`, part.temp, pc.seenAt);
  if (tab === "specs") {
    return <><table className="kv"><tbody>{part.specs.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table><SourceBadge part={part} /></>;
  }
  if (tab === "manual") {
    return (
      <>
        {part.manual.length
          ? <table className="kv"><tbody>{part.manual.map(([k, v]) => <tr key={k}><th style={{ width: "auto", color: "var(--text)" }}>{k}</th><td style={{ textAlign: "right", whiteSpace: "nowrap" }}><span className="faint">{v}</span></td></tr>)}</tbody></table>
          : <p className="muted">Ask a question and Rig looks it up in the {part.name} manual from the maker's support site.</p>}
        <form className="ask-inline card" style={{ padding: "6px 6px 6px 12px" }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(`About my ${part.name}: ${q.trim()}`); }}>
          <input id="ask-manual" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask this manual a question" aria-label="Ask this manual a question" />
          <button className="btn sm">Ask</button>
        </form>
        <p className="faint" style={{ fontSize: 12 }}>Answers name the manual and page they came from.</p>
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={() => ask(`Is there a newer ${part.type.toLowerCase()} ${d.installed.startsWith("BIOS") ? "BIOS" : "driver"} for my ${part.name}? I have ${d.installed}.`)}>Ask if there's a newer one</button>
          {maker && <a className="btn ghost" href={driverPages[maker]} target="_blank" rel="noreferrer">{maker} downloads</a>}
        </div>
        <p className="faint" style={{ fontSize: 12 }}>Rig never installs drivers or BIOS updates by itself.</p>
      </>
    );
  }
  const tiles: JSX.Element[] = [];
  if (part.temp !== undefined) tiles.push(<div key="t" className={`live${part.warn ? " warn" : ""}`}><span className="label">Temperature</span><span className="big">{part.temp}°C</span><Sparkline values={trail} w={130} h={26} warn={part.warn} /></div>);
  if (part.tempMax !== undefined) tiles.push(<div key="m" className="live"><span className="label">Highest today</span><span className="big">{part.tempMax}°C</span></div>);
  if (part.load !== undefined) tiles.push(<div key="l" className="live"><span className="label">Load</span><span className="big">{part.load}%</span></div>);
  if (part.clock) tiles.push(<div key="c" className="live"><span className="label">Clock</span><span className="big">{part.clock}</span></div>);
  if (part.fan) tiles.push(<div key="f" className="live"><span className="label">Fan</span><span className="big">{part.fan.toLocaleString()} rpm</span></div>);
  return (
    <>
      {tiles.length
        ? <div className="live-grid">{tiles}</div>
        : <table className="kv"><tbody>{part.specs.slice(0, 3).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>}
      {part.warn && (
        <>
          <div className="callout warn">{part.temp}°C is {part.limit ? `${Math.max(0, part.limit - (part.temp ?? 0))}° under its ${part.limit}°C limit` : "running warm"}. {pc.issues?.find((i) => i.part === id)?.body}</div>
          <a className="btn" href="#chat">Ask what to do</a>
        </>
      )}
      {part.soldered && <div className="callout">Soldered to the board, so it can't be upgraded.</div>}
      <SourceBadge part={part} />
    </>
  );
}
