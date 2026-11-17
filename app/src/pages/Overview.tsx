import { useMemo, useState } from "react";
import { history, sparkData, user, type Severity } from "../data";
import { LineChart } from "../chart";
import { Ring, StatusChip } from "../components/common";
import { StageSlot } from "../components/Stage";
import { useApp } from "../state";

const sevLabel = { warn: "Needs a look", info: "Suggestion", ok: "Good news", bad: "Problem" };
const suggestions = ["Why is my PC loud?", "Can I add more RAM?", "Is my driver up to date?"];

// How the health score breaks down, per PC (sample data for the mockup).
const breakdown: Record<string, { label: string; value: number; note: string; sev: Severity }[]> = {
  atlas: [
    { label: "Temperatures", value: 64, note: "Graphics card 9°C warmer than usual", sev: "warn" },
    { label: "Drivers and updates", value: 86, note: "1 driver update ready", sev: "info" },
    { label: "Storage", value: 92, note: "39% free, drive health good", sev: "ok" },
    { label: "Startup and speed", value: 95, note: "Boots in 18 s", sev: "ok" },
  ],
  pebble: [
    { label: "Temperatures", value: 80, note: "Short slowdowns on battery", sev: "info" },
    { label: "Battery", value: 89, note: "89% of original capacity", sev: "ok" },
    { label: "Drivers and updates", value: 84, note: "BIOS 310 ready", sev: "info" },
    { label: "Storage", value: 94, note: "57% free", sev: "ok" },
  ],
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function AreaSpark({ values, warn }: { values: number[]; warn?: boolean }) {
  const w = 200, h = 44;
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 10);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg className={`area-spark${warn ? " warn" : ""}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${w},${h} L0,${h} Z`} className="fill" />
      <path d={d} className="line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Overview() {
  const { ui, pc, set, go, ask } = useApp();
  const [q, setQ] = useState("");
  const issues = pc.issues ?? [];
  const needs = issues.filter((i) => i.severity !== "ok").length;
  const pts = useMemo(() => history(7), []);
  const parts = Object.entries(pc.parts ?? {});
  const hot = parts.filter(([, p]) => p.temp !== undefined).slice(0, 4);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="page dash">
      <header className="dash-head">
        <div>
          <div className="faint">{today}</div>
          <h1>{greeting()}, {user.name}</h1>
        </div>
        <form className="command" onSubmit={(e) => { e.preventDefault(); ask(q); setQ(""); }}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask anything about ${pc.name}`} aria-label="Ask a question" />
          <kbd>Ctrl K</kbd>
        </form>
      </header>

      <div className="bento">
        <section className="card b-hero">
          <StageSlot id="hero-stage" />
          <div className="hero-over top">
            <div className="identity"><span className="dot" /><div><h2 className="plain-h">{pc.name}</h2><div className="muted">{pc.nickname} · {pc.os}</div></div></div>
            <span className="chip ok">{pc.lastSync}</span>
          </div>
          <div className="hero-over bottom">
            <div className="part-pills">
              {hot.map(([id, p]) => (
                <button key={id} type="button" className={`pill${p.warn ? " warn" : ""}`} onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
                  <span>{p.type}</span><b className="num">{p.temp}°</b>
                </button>
              ))}
            </div>
            <a className="btn primary" href="#pc">Open 3D view</a>
          </div>
        </section>

        <section className="card b-health">
          <div className="health-top">
            <Ring value={pc.health} />
            <div><div className="label">Health</div><p className="health-sum">{pc.summary}</p></div>
          </div>
          <div className="meters">
            {(breakdown[pc.id] ?? []).map((m) => (
              <div key={m.label} className="meter">
                <div className="meter-head"><span>{m.label}</span><span className="num faint">{m.value}</span></div>
                <div className={`meter-bar ${m.sev}`}><i style={{ width: `${m.value}%` }} /></div>
                <div className="faint meter-note">{m.note}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card b-needs">
          <div className="card-head"><h2>Worth a look</h2>{needs > 0 && <span className="count">{needs}</span>}</div>
          <div className="issues compact">
            {issues.map((i) => (
              <button key={i.id} type="button" className={`issue ${i.severity}`} onClick={() => {
                if (i.part && i.go === "pc") set({ selected: i.part, tab: pc.parts?.[i.part]?.driver ? "drivers" : "live" });
                go(i.go);
              }}>
                <span className={`sev ${i.severity}`} />
                <span className="issue-text"><span className="label">{sevLabel[i.severity]}</span><b>{i.title}</b><span className="muted">{i.body}</span></span>
                <span className="issue-go">{i.action} ›</span>
              </button>
            ))}
          </div>
        </section>

        {(pc.stats ?? []).map((s, i) => (
          <section key={s.label} className={`card b-metric${s.warn ? " warn" : ""}`}>
            <div className="metric-top">
              <span className="label">{s.label}</span>
              {s.warn && <span className="chip warn">High</span>}
            </div>
            <div className="big num">{s.value}<small>{s.unit}</small></div>
            <div className="faint metric-note">{s.note}</div>
            <AreaSpark values={sparkData(s.value, 36, 3 + i, s.unit === "%" ? 3 : 8)} warn={s.warn} />
          </section>
        ))}

        <section className="card b-temps">
          <div className="card-head">
            <h2>Temperatures this week</h2>
            <div className="legend">
              <span><i style={{ background: "var(--info)" }} />CPU</span>
              <span><i style={{ background: "var(--warn)" }} />{pc.kind === "laptop" ? "Graphics" : "Graphics card"}</span>
              <a className="btn ghost sm" href="#history">History</a>
            </div>
          </div>
          <div className="temps-body"><LineChart points={pts} series={[{ key: "cpu", cls: "cpu" }, { key: "gpu", cls: "gpu" }]} w={900} h={230} limit={{ v: 90, label: "90° limit" }} bands /></div>
        </section>

        <section className="card b-changes">
          <div className="card-head"><h2>Recent changes</h2><a className="btn ghost sm" href="#changes">See all</a></div>
          {ui.changes.slice(0, 3).map((c) => (
            <div key={c.id} className="list-row"><div><h3>{c.title}</h3><div className="faint">{c.when}</div></div><StatusChip status={c.status} /></div>
          ))}
          <div className="suggest tight">{suggestions.map((s) => <button key={s} type="button" onClick={() => ask(s)}>{s}</button>)}</div>
        </section>
      </div>
    </div>
  );
}
