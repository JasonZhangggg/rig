import { useLayoutEffect, useRef, useState } from "react";
import type { Part, PC } from "../../data";
import { StageSlot } from "../../components/Stage";
import { useApp } from "../../state";
import { extras, partIcon, shortType } from "./shared";

const sides = (pc: PC): [string[], string[]] =>
  pc.kind === "laptop" ? [["cpu", "ram", "ssd"], ["battery", "fans", "board"]] : [["cpu", "ram", "ssd"], ["gpu", "fans", "psu"]];

function rows(id: string, p: Part, pc: PC): [string, string, boolean?][] {
  const st = (l: string) => pc.stats?.find((s) => s.label === l);
  const out: [string, string, boolean?][] = [];
  if (p.temp !== undefined) out.push(["Temp", `${p.temp}°C`, p.warn]);
  if (p.load !== undefined) out.push(["Load", `${p.load}%`]);
  if (p.clock) out.push(["Clock", p.clock]);
  if (p.fan && id !== "fans") out.push(["Fan", `${p.fan.toLocaleString()} rpm`]);
  if (id === "ram" && st("Memory")) out.push(["In use", `${st("Memory")!.value}%`]);
  if (id === "ssd" && st("Storage")) out.push(["Used", `${st("Storage")!.value}%`]);
  if (id === "fans" && p.fan) out.push(["Speed", `${p.fan.toLocaleString()} rpm`]);
  if (id === "battery" && st("Battery")) out.push(["Capacity", `${st("Battery")!.value}%`]);
  for (const [k, v] of p.specs) { if (out.length >= 3) break; if (v.length <= 18) out.push([k, v]); }
  return out.slice(0, 3);
}

const dotFor = (p: Part) => (p.warn ? "warn" : p.driver && p.driver.installed !== p.driver.latest ? "info" : "ok");

export function CanvasHome() {
  const { ui, pc, set, go, ask } = useApp();
  const wrap = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<{ id: string; d: string; tone: string; a: [number, number]; b: [number, number] }[]>([]);
  const [spin, setSpin] = useState(true);
  const [q, setQ] = useState("");
  const [L, R] = sides(pc);
  const parts = pc.parts ?? {};
  const ex = extras[pc.id] ?? extras.atlas;
  const warnIssue = (pc.issues ?? []).find((i) => i.severity === "warn");

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const calc = () => {
      const r = el.getBoundingClientRect();
      const hubEl = el.querySelector(".c-hub");
      if (!hubEl || getComputedStyle(el).getPropertyValue("--wires").trim() === "off") { setWires([]); return; }
      const hub = hubEl.getBoundingClientRect();
      const out: typeof wires = [];
      el.querySelectorAll<HTMLElement>("[data-node]").forEach((n) => {
        const b = n.getBoundingClientRect();
        const left = n.dataset.side === "l";
        const i = Number(n.dataset.i);
        const x1 = (left ? b.right : b.left) - r.left;
        const y1 = b.top - r.top + 27;
        const x2 = (left ? hub.left + 2 : hub.right - 2) - r.left;
        const y2 = hub.top - r.top + 70 + i * ((hub.height - 140) / 2);
        const dx = (x2 - x1) * 0.55;
        out.push({ id: n.dataset.node!, tone: n.dataset.tone!, a: [x1, y1], b: [x2, y2], d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` });
      });
      setWires(out);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pc.id]);

  const node = (id: string, side: "l" | "r", i: number) => {
    const p = parts[id];
    if (!p) return null;
    const tone = dotFor(p);
    const sel = ui.selected === id;
    return (
      <div key={id} className={`c-node ${tone}${sel ? " sel" : ""}`} data-node={id} data-side={side} data-i={i} data-tone={tone}>
        <button type="button" className="c-node-head" onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
          <i className={`c-node-ico k-${id}`}>{partIcon[id]}</i>
          <span className="c-node-title"><b>{shortType(p.type)}</b><small>{p.name}</small></span>
          <span className={`c-led ${tone}`} aria-label={tone === "warn" ? "Needs a look" : tone === "info" ? "Update ready" : "Good"} />
        </button>
        <dl className="c-fields">
          {rows(id, p, pc).map(([k, v, w]) => <div key={k}><dt>{k}</dt><dd className={w ? "hot" : ""}>{v}</dd></div>)}
        </dl>
        {p.warn && warnIssue && (
          <div className="c-node-foot">
            <span>{warnIssue.title.replace("Graphics card runs ", "")}</span>
            <a className="c-fixit" href="#chat">Fix it</a>
          </div>
        )}
        {!p.warn && p.driver && p.driver.installed !== p.driver.latest && (
          <div className="c-node-foot"><span>{p.driver.latest} is ready</span><button type="button" className="c-ghost-sm" onClick={() => { set({ selected: id, tab: "drivers" }); go("pc"); }}>Review</button></div>
        )}
        {p.warn && (
          <div className="c-cursor" aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M2 1.5 14 7l-5.2 1.6L6.5 14z" /></svg>
            <span>Rig</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="c-home">
      <h1 className="sr-only">{pc.name} and its parts</h1>
      <div className="c-canvas" ref={wrap}>
        <svg className="c-wires" aria-hidden="true">
          {wires.map((w) => (
            <g key={w.id} className={`c-wire ${w.tone}`}>
              <path d={w.d} className="base" />
              {w.tone === "warn" && <path d={w.d} className="flow" />}
              <circle cx={w.a[0]} cy={w.a[1]} r="4" /><circle cx={w.b[0]} cy={w.b[1]} r="4" />
            </g>
          ))}
        </svg>
        <div className="c-col l">{L.map((id, i) => node(id, "l", i))}</div>
        <section className="c-hub" style={{ ["--pc" as string]: pc.accent }}>
          <header className="c-hub-head">
            <span className="sh-dot" /><b>{pc.name}</b><span className="c-live"><i />Live</span>
            <span className="c-hub-sub">{pc.model?.label.split(",")[0]}</span>
          </header>
          <div className="c-hub-stage"><StageSlot id="hero-stage" zoom={false} spin={spin} /></div>
          <footer className="c-hub-foot">
            <div><small>Health</small><b>{pc.health}</b></div>
            <div><small>Peak draw</small><b>{ex.power.reduce((a, p) => a + p.w, 0)} W</b></div>
            <div><small>Boot</small><b>{ex.boot}</b></div>
            <div><small>Uptime</small><b>{ex.uptime}</b></div>
          </footer>
        </section>
        <div className="c-col r">{R.map((id, i) => node(id, "r", i))}</div>

        <div className="c-side" role="toolbar" aria-label="View">
          <button type="button" aria-pressed={spin} title="Turntable" onClick={() => setSpin(!spin)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-2-4.5M14 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <button type="button" aria-pressed={ui.airflow} title="Airflow" onClick={() => set({ airflow: !ui.airflow })}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h9a2.5 2.5 0 1 0-2.5-2.5M3 11h12a2.5 2.5 0 1 1-2.5 2.5M3 15h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
          <span className="c-side-gap" />
          <a href="#pc" title="Open the full 3D view"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8V4h4M16 12v4h-4M4 4l5 5M16 16l-5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
        </div>
      </div>

      <form className="c-prompt" onSubmit={(e) => { e.preventDefault(); ask(q || `Why is ${pc.name}'s graphics card hotter than last month?`); }}>
        <div className="c-prompt-in">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask Rig about ${pc.name}…  e.g. why is the graphics card hotter?`} aria-label={`Ask Rig about ${pc.name}`} />
        </div>
        <div className="c-prompt-row">
          <button type="button" className="c-chipbtn" onClick={() => setQ("Is it safe to clean the front filter myself?")}>Clean the filter</button>
          <button type="button" className="c-chipbtn" onClick={() => setQ("Will the RTX 4080 SUPER fit, and is my power supply enough?")}>Check an upgrade</button>
          <button type="button" className="c-chipbtn" onClick={() => setQ("Make Cyberpunk 2077 run smoother")}>Tune a game</button>
          <button type="submit" className="c-send" aria-label="Send"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
      </form>
    </div>
  );
}
