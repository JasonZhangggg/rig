import { useState } from "react";
import { sparkData } from "../data";
import { Sparkline } from "../chart";
import { Ring, StatusChip } from "../components/common";
import { StageSlot } from "../components/Stage";
import { useApp } from "../state";

const sevLabel = { warn: "Needs a look", info: "Suggestion", ok: "Good news", bad: "Problem" };
const suggestions = ["Why is my PC loud?", "Can I add more RAM?", "Is my driver up to date?", "Why did my PC restart last night?"];

export function Overview() {
  const { ui, pc, set, go, ask } = useApp();
  const [q, setQ] = useState("");
  const issues = pc.issues ?? [];
  return (
    <div className="page">
      <section className="card hero">
        <div className="hero-info">
          <div className="identity"><span className="dot" /><div><h1>{pc.name}</h1><div className="muted">{pc.nickname} · {pc.os}</div></div></div>
          <div className="health"><Ring value={pc.health} /><div><div className="label">Health</div><p style={{ fontSize: "1.08em", fontWeight: 500 }}>{pc.summary}</p></div></div>
          <div className="meta-row"><span>{pc.lastSync}</span><span>{Object.keys(pc.parts ?? {}).length} parts detected</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn primary" href="#pc">Open 3D view</a>
            <a className="btn" href="#chat">Ask about this PC</a>
          </div>
        </div>
        <div className="hero-stage"><StageSlot id="hero-stage" /></div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Worth a look</h2><span className="faint">{issues.length} items</span></div>
        <div className="issues">
          {issues.map((i) => (
            <div key={i.id} className={`issue ${i.severity}`}>
              <span className={`sev ${i.severity}`} />
              <div><div className="label">{sevLabel[i.severity]}</div><h3>{i.title}</h3><p>{i.body}</p></div>
              <button className="btn sm" type="button" onClick={() => {
                if (i.part && i.go === "pc") set({ selected: i.part, tab: pc.parts?.[i.part]?.driver ? "drivers" : "live" });
                go(i.go);
              }}>{i.action}</button>
            </div>
          ))}
        </div>
      </section>

      <section className="stats">
        {(pc.stats ?? []).map((s, i) => (
          <div key={s.label} className={`card stat${s.warn ? " warn" : ""}`}>
            <div className="label">{s.label}</div>
            <div className="big num">{s.value}<small>{s.unit}</small></div>
            <div className="stat-foot"><span>{s.note}</span><Sparkline values={sparkData(s.value, 24, 3 + i, s.unit === "%" ? 3 : 8)} w={84} h={28} warn={s.warn} /></div>
          </div>
        ))}
      </section>

      <div className="cols">
        <section className="card">
          <div className="card-head"><h2>Recent changes</h2><a className="btn ghost sm" href="#changes">See all</a></div>
          {ui.changes.slice(0, 3).map((c) => (
            <div key={c.id} className="list-row"><div><h3>{c.title}</h3><div className="faint">{c.when}</div></div><StatusChip status={c.status} /></div>
          ))}
        </section>
        <section className="card">
          <div className="card-head"><h2>Ask about {pc.name}</h2></div>
          <form className="ask-inline" onSubmit={(e) => { e.preventDefault(); ask(q); setQ(""); }}>
            <input id="ask-overview" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why is my PC loud when gaming?" aria-label="Ask a question" />
            <button className="btn primary sm">Ask</button>
          </form>
          <div className="suggest">{suggestions.map((s) => <button key={s} type="button" onClick={() => ask(s)}>{s}</button>)}</div>
        </section>
      </div>
    </div>
  );
}
