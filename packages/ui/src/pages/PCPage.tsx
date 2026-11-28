import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { reducedMotion } from "../appearance";
import { formatTemp, type Part, type Route, type TempUnit } from "@rig/core";
import { StageSlot, getStage, hoverPart, useStageHover } from "../components/Stage";
import { useApp, useTemp, useTempText, useTempUnit } from "../state";
import { ManualsTab } from "../manuals/ManualsTab";
import { PartManual } from "../manuals/PartManual";
import { pcAccents } from "../themes";
import { CLEAN_EVERY, daysSince, shopCatOf } from "./shared";
import { PartUpgrade, partOf, useUpgrades, type PCUpgrades } from "./upgrades/PCUpgrades";
import { SafetyTab } from "./safety/SafetyTab";
import { UpgradesTab } from "./upgrades/Shop";
import { arrowKeys } from "../components/modal";
import { Warm } from "../components/common";
import { BoardView } from "./board/BoardView";
import { BoardUsage } from "./board/BoardUsage";
import { BoardCables } from "./board/BoardCables";
import { boardStage } from "./board/boardStage";
import { StorageMap } from "./drives/StorageMap";
import { GpuView } from "./gpu/GpuView";
import { TempRange, rangePart } from "./TempRange";
import { GpuPorts } from "./gpu/GpuPorts";
import { gpuStage } from "./gpu/gpuStage";
import { BatteryLife, batteryTiles } from "./battery/Battery";

/** The tabs of My PC, each its own address so a link opens the right one. */
const pcViews: [Route, string][] = [["pc", "Parts"], ["upgrades", "Upgrades"], ["manuals", "Manuals and drivers"], ["safety", "Safety"]];

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
  // Escape closes the open panel: Customize first, then the part.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || ui.palette || ui.review) return;
      if (customize) closeCustomize();
      else if (ui.selected) getStage().scene.select(null);
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });
  const ups = useUpgrades();
  const unit = useTempUnit();
  const parts = pc.parts ?? {};
  const view = pcViews.some(([r]) => r === ui.route) ? ui.route : "pc";
  const viewRef = useRef<HTMLDivElement>(null);
  useFitStage(viewRef, `${view}:${ui.selected ?? ""}`);
  // A picked part takes over the page: its name is the title and its readings get the room the list had.
  const picked = view === "pc" && ui.selected && parts[ui.selected] ? ui.selected : null;
  // A tower's graphics card opens close up, like the board; a laptop's is soldered in, so there's nothing to show.
  const closeUp = pc.kind === "tower";
  const fade = useCloseUpFade(picked === "motherboard" ? "motherboard" : picked === "gpu" && closeUp ? "gpu" : null);
  const list = Object.entries(parts);
  const sub = view === "upgrades" ? `What would help ${pc.name} most, and parts that fit it.`
    : view === "manuals" ? `Manuals for ${pc.name}'s parts, and its drivers and BIOS.`
    : view === "safety" ? `Windows updates, virus protection, the firewall and backup on ${pc.name}.`
    : partsSummary(list.map(([, v]) => v), pc.name, pc.online, unit);
  return (
    <div className={`page pc-page${picked ? " is-part" : ""}`}>
      {picked ? <PartHead part={parts[picked]} /> : (
        <>
          <div className="page-head">
            <div><h1>{pc.name}</h1><p className="sub">{sub}</p></div>
            {view === "pc" && <button ref={customizeBtn} className="btn ghost sm" type="button" onClick={() => setCustomize(!customize)} aria-expanded={customize}>Customize</button>}
          </div>
          <nav className="lg-views pc-views" aria-label="My PC">
            {pcViews.map(([r, label]) => <a key={r} href={`#${r}`} aria-current={view === r ? "page" : undefined}>{label}</a>)}
          </nav>
        </>
      )}
      {view === "upgrades" ? <UpgradesTab ups={ups} /> : view === "manuals" ? <ManualsTab /> : view === "safety" ? <SafetyTab /> : (
      <div className="pc-view" ref={viewRef}>
        <section className="stage-card" aria-label="3D view">
          {fade.pc && <StageSlot id="pc-stage" />}
          {fade.shown && (
            <div className={`closeup${fade.state === "in" ? " is-in" : fade.state === "out" ? " is-out" : ""}`}>
              {fade.shown === "motherboard" ? <BoardView intro={fade.state === "in"} /> : <GpuView intro={fade.state === "in"} />}
            </div>
          )}
          {customize && !picked && <Customize onDone={closeCustomize} />}
          {picked && (
            <button className="stage-back" type="button" onClick={() => getStage().scene.select(null)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              All parts
            </button>
          )}
          <div className="stage-tools" role="toolbar" aria-label="View">
            {!picked && <button className="btn ghost sm" type="button" aria-pressed={ui.exploded} onClick={() => set({ exploded: !ui.exploded })}>Exploded view</button>}
            <button className="btn ghost sm" type="button" onClick={() => (picked === "motherboard" ? boardStage.reset() : picked === "gpu" && closeUp ? gpuStage.reset() : getStage().scene.resetView())}>Reset view</button>
          </div>
        </section>
        <div className="pc-side">{picked ? <PartDetail id={picked} ups={ups} /> : <PartsList />}</div>
      </div>
      )}
    </div>
  );
}

type CloseUp = "motherboard" | "gpu";
/** How long a close-up takes to fade in over the 3D PC flying in to the part (as in pc.css), and to fade back out. */
const FADE_IN_MS = 680, FADE_OUT_MS = 280;

/**
 * The board and the graphics card open in close-ups of their own, drawn in place of the 3D PC. Rather than cut
 * from one to the other, the PC flies in to the part and the close-up fades in over it, zooming in as it comes;
 * going back, the close-up fades out over the PC flying back out. Says which close-up is on the stage, whether
 * the 3D PC shows (alone, or under a close-up while it fades), and which way it's fading. A page opened on a
 * part, or reduced motion, just shows it.
 */
function useCloseUpFade(id: CloseUp | null) {
  const [prev, setPrev] = useState(id);
  const [fading, setFading] = useState<{ id: CloseUp; state: "in" | "out" } | null>(null);
  if (id !== prev) {
    setPrev(id);
    setFading(reducedMotion() ? null : id ? { id, state: "in" } : prev ? { id: prev, state: "out" } : null);
  }
  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setFading(null), fading.state === "in" ? FADE_IN_MS : FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [fading]);
  const shown = id ?? (fading?.state === "out" ? fading.id : null);
  return { shown, pc: !shown || !!fading, state: fading?.id === shown ? fading.state : null };
}

/** Wide windows only: the 3D view's height is the window's, less what sits above and below it. */
const wideQuery = "(min-width: 1101px)";
const [STAGE_MIN, STAGE_MAX] = [420, 900];

/**
 * Sizes the 3D view to the space left in the window, so the page fits without scrolling.
 * Worked out here, not by stretching it in CSS, so a long side column scrolls the page without making the 3D view taller.
 */
function useFitStage(view: RefObject<HTMLDivElement | null>, page: string) {
  useLayoutEffect(() => {
    const el = view.current;
    if (!el || typeof ResizeObserver === "undefined" || typeof matchMedia !== "function") return;
    const wide = matchMedia(wideQuery);
    const fit = () => {
      if (!wide.matches) { el.style.removeProperty("--fit-h"); return; }
      const main = el.closest("main");
      const shell = main?.parentElement?.parentElement;
      const padBelow = (e: Element | null | undefined) => (e ? parseFloat(getComputedStyle(e).paddingBottom) || 0 : 0);
      const below = padBelow(main) + padBelow(shell);
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = Math.round(Math.min(STAGE_MAX, Math.max(STAGE_MIN, window.innerHeight - top - below)));
      el.style.setProperty("--fit-h", `${h}px`);
    };
    fit();
    // The title above can change height (a long name wraps, the sidebar folds), so watch it as well as the window.
    const ro = new ResizeObserver(fit);
    const head = el.parentElement?.querySelector(".page-head");
    if (head) ro.observe(head);
    window.addEventListener("resize", fit);
    wide.addEventListener("change", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); wide.removeEventListener("change", fit); };
  }, [view, page]);
}

function Customize({ onDone }: { onDone: () => void }) {
  const { pc, client, toast } = useApp();
  const [name, setName] = useState(pc.name);
  // The name last sent, so leaving the field and then pressing Done saves it once.
  const sent = useRef(pc.name);
  const update = (patch: { name?: string; accent?: string }) => client.rename(pc.id, patch).catch(() => { if (patch.name) sent.current = pc.name; toast("Couldn't save that. Try again."); });
  const saveName = () => { const n = name.trim(); if (n && n !== pc.name && n !== sent.current) { sent.current = n; void update({ name: n }); } };
  return (
    <div className="card customize" role="dialog" aria-label="Customize">
      <div className="field"><label className="label" htmlFor="pc-name">Name</label><input className="input" id="pc-name" autoFocus value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></div>
      <div className="field">
        <span className="label">Accent color</span>
        <div className="swatches">
          {pcAccents.map((a) => <button key={a} type="button" className="swatch" style={{ background: a }} aria-label={`Accent ${a}`} aria-pressed={a.toLowerCase() === pc.accent.toLowerCase()} onClick={() => update({ accent: a })} />)}
        </div>
      </div>
      <p className="faint customize-note">The accent marks this PC in your list of PCs.</p>
      <div className="customize-foot"><button className="btn primary sm" type="button" onClick={() => { saveName(); onDone(); }}>Done</button></div>
    </div>
  );
}

/** One line that says what the parts list means: what needs a look, or that nothing does. */
export function partsSummary(parts: Part[], name: string, online: boolean, unit: TempUnit = "c") {
  if (!parts.length) return `Rig hasn't read ${name}'s parts yet. They show up here once the Rig app on ${name} sends its first reading.`;
  const hot = parts.filter((p) => p.warn);
  if (hot.length === 1) {
    const p = hot[0];
    return p.temp != null && p.limit ? `${p.type} is at ${formatTemp(p.temp, unit)}, ${limitWords(p.temp, p.limit, unit)}.` : `${p.type} has a warning. Open it for details.`;
  }
  if (hot.length > 1) return `${hot.length} parts have warnings: ${hot.map((p) => p.type.toLowerCase()).join(", ")}.`;
  if (parts.some((p) => p.temp != null)) return online ? "Nothing is running hot right now." : "Nothing was running hot at the last reading.";
  return "Pick one for its specs, manual and drivers.";
}

/** One part in the list: what it is, its temperature as it moves, and a light on it in the 3D view while pointed at. */
function PartRow({ id, part, lit }: { id: string; part: Part; lit: boolean }) {
  const temp = useTemp();
  return (
    <li>
      <button type="button" className={lit ? "is-lit" : undefined} onClick={() => getStage().scene.select(id)}
        onPointerEnter={() => hoverPart(id)} onPointerLeave={() => hoverPart(null)} onFocus={() => hoverPart(id)} onBlur={() => hoverPart(null)}>
        <span className="part-txt"><span className="pt">{part.type}</span><span className="pn">{part.name}</span></span>
        {part.temp !== undefined && (
          <span key={Math.round(part.temp)} className={`num part-temp${part.warn ? " look" : ""}`}>{temp(part.temp)}{part.warn && <Warm />}</span>
        )}
      </button>
    </li>
  );
}

/** Every part, one row each: what it is, its model under it and how warm it runs. Pointing at a row lights the part in 3D. */
function PartsList() {
  const { ui, pc } = useApp();
  const lit = useStageHover();
  // Leaving the page or opening a part takes the light off whatever row was pointed at.
  useEffect(() => () => hoverPart(null), [ui.selected]);
  const list = Object.entries(pc.parts ?? {});
  return (
    <section className="parts" aria-labelledby="parts-h">
      <h2 id="parts-h" className="parts-h">Parts</h2>
      {list.length > 0 && (
        <ul className="part-list" aria-label="Parts">
          {list.map(([k, v]) => <PartRow key={k} id={k} part={v} lit={lit === k} />)}
        </ul>
      )}
    </section>
  );
}

/** The page title while a part is open: what the part is. The way back to every part sits in the 3D view. */
function PartHead({ part }: { part: Part }) {
  return (
    <div className="page-head part-head">
      <div>
        <p className="part-kind">{part.type}</p>
        <h1>{part.name}</h1>
        {part.sub && <p className="sub">{part.sub}</p>}
      </div>
    </div>
  );
}

/** A part's readings first, big enough to read at a glance, then its specs, manual, drivers and upgrade ideas. */
function PartDetail({ id, ups }: { id: string; ups: PCUpgrades }) {
  const { ui, pc, set } = useApp();
  const part = pc.parts![id];
  const ideas = ups.list?.filter((u) => partOf(u, pc) === id) ?? [];
  // The motherboard opens on what's plugged into it, a tower's graphics card on its outputs and power, storage on what fills each drive.
  const first: [string, string][] = id === "motherboard" ? [["slots", "Slots"], ["cables", "Cables"]]
    : id === "gpu" && pc.kind === "tower" ? [["ports", "Ports"]]
    : id === "ssd" && pc.drives?.length ? [["drives", "Drives"]]
    : id === "battery" && pc.battery ? [["life", "Battery life"]] : [];
  const tabs: [string, string][] = [...first, ["specs", "Specs"], ["manual", "Manual"]];
  if (part.driver) tabs.push(["drivers", part.driver.installed.startsWith("BIOS") ? "BIOS" : "Drivers"]);
  if (ideas.length) tabs.push(["upgrade", "Upgrade"]);
  const tab = tabs.some(([t]) => t === ui.tab) ? ui.tab : tabs[0][0];
  return (
    <div className="part-detail">
      <Readings part={part} id={id} />
      <div className="tabs" role="tablist" aria-label={`${part.name} details`} onKeyDown={arrowKeys("tab")}>
        {tabs.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => set({ tab: t })}>{l}</button>)}
      </div>
      <div className="detail-body">{tab === "upgrade" ? <><PartUpgrade ideas={ideas} ups={ups} />{shopCatOf[id] && <a className="btn sm part-shop" href="#upgrades" onClick={() => set({ shopCat: shopCatOf[id] })}>See parts that fit</a>}</> : <DetailTab part={part} id={id} tab={tab} />}</div>
    </div>
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
      {days !== 0 && <button type="button" className="btn ghost sm" onClick={cleaned}>I cleaned it today</button>}
    </div>
  );
}

function SourceBadge({ part }: { part: Part }) {
  return part.modelSource === "library"
    ? <div className="source-badge"><span className="chip ok no-dot">3D model matched</span>From the model library</div>
    : <div className="source-badge"><span className="chip no-dot">3D shape from size</span>{part.dims ?? "Built from the part's size and color"}</div>;
}

function BatteryTab() {
  const { pc } = useApp();
  return pc.battery ? <BatteryLife battery={pc.battery} /> : null;
}

function DetailTab({ part, id, tab }: { part: Part; id: string; tab: string }) {
  const { ask } = useApp();
  const inUnit = useTempText();
  if (tab === "manual") return <PartManual id={id} about={part.name} />;
  if (tab === "slots") return <BoardUsage />;
  if (tab === "drives") return <StorageMap />;
  if (tab === "cables") return <BoardCables />;
  if (tab === "ports") return <GpuPorts />;
  if (tab === "life") return <BatteryTab />;
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
  return <><table className="kv"><tbody>{part.specs.map(([k, v]) => <tr key={k}><th>{k}</th><td>{inUnit(v)}</td></tr>)}</tbody></table><SourceBadge part={part} /></>;
}

/** What the part is doing now, as numbers you can read from across the room, and anything about it that needs you. */
function Readings({ part, id }: { part: Part; id: string }) {
  const { pc } = useApp();
  const temp = useTemp();
  const unit = useTempUnit();
  const inUnit = useTempText();
  const tiles: JSX.Element[] = [];
  const ranged = rangePart(id);
  if (part.temp !== undefined && part.limit && ranged) {
    // A part with a limit and a history: its temperature on a ribbon from cool to the limit, against where it usually sits.
    tiles.push(<TempRange key="t" part={{ ...part, temp: part.temp, limit: part.limit }} id={ranged} />);
  } else if (part.temp !== undefined) {
    tiles.push(
      <div key="t" className={`live live-wide${part.warn ? " warn" : ""}`}>
        <span className="label">Temperature</span>
        <span key={Math.round(part.temp)} className="big live-tick">{temp(part.temp)}</span>
        {part.limit ? (
          <span className="live-meter" role="img" aria-label={limitWords(part.temp, part.limit, unit)}>
            <i><b style={{ transform: `translateX(${Math.min(100, (part.temp / part.limit) * 100) - 100}%)` }} /></i><span className="faint">{limitWords(part.temp, part.limit, unit)}</span>
          </span>
        ) : null}
      </div>,
    );
  }
  if (part.tempMax !== undefined) tiles.push(<div key="m" className="live"><span className="label">Highest today</span><span className="big">{temp(part.tempMax)}</span></div>);
  if (part.load !== undefined) tiles.push(<div key="l" className="live"><span className="label">Load</span><span key={part.load} className="big live-tick">{part.load}%</span><span className="bar live-load" aria-hidden="true"><i style={{ transform: `translateX(${part.load - 100}%)` }} /></span></div>);
  if (part.clock) tiles.push(<div key="c" className="live"><span className="label">Clock</span><span className="big">{part.clock}</span></div>);
  if (part.fan) tiles.push(<div key="f" className="live"><span className="label">Fan</span><span className="big">{part.fan.toLocaleString()} rpm</span></div>);
  if (id === "battery" && pc.battery) tiles.push(...batteryTiles(pc.battery));
  return (
    <>
      {tiles.length > 0 && <div className="live-grid">{tiles}</div>}
      {part.warn && (
        <div className="callout warn part-warn">
          <span>{inUnit(pc.issues?.find((i) => i.part === id)?.title ?? `${temp(part.temp)}, ${limitWords(part.temp, part.limit, unit)}.`)}</span>
          <a className="btn ghost sm" href="#chat">Ask what to do</a>
        </div>
      )}
      {part.soldered && <div className="callout">Soldered to the board, so it can't be upgraded.</div>}
      {id === "ssd" && !pc.drives?.length && <Space />}
      {id === "fans" && <DustClean />}
    </>
  );
}
