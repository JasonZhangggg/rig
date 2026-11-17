import { useState } from "react";
import { DiffTable, StatusChip } from "../components/common";
import { useApp } from "../state";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Changes() {
  const { data, pc, toggleChange, client } = useApp();
  const [filter, setFilter] = useState<"all" | "applied" | "undone">("all");
  const list = data.changes.filter((c) => filter === "all" || c.status === filter);
  return (
    <div className="page mid">
      <div className="page-head">
        <div><h1>Changes</h1><p className="sub">Everything Rig or you changed on {pc.name}, with what it was before. Undo puts the old values back.</p></div>
        <div className="seg" role="group" aria-label="Filter">
          {(["all", "applied", "undone"] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
        </div>
      </div>
      <section className="card">
        {list.length === 0 && <p className="card-pad muted">{data.changes.length ? "Nothing here." : "No changes yet. When Rig fixes something, it shows up here with an Undo button."}</p>}
        {list.map((c) => (
          <div key={c.id} className={`change ${c.status}`}>
            <div className="change-when num">{when(c.at)}</div>
            <div className="change-main">
              <div className="change-title">
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><h3>{c.title}</h3><StatusChip status={c.status} /></div>
                {client.caps.applyChanges && <button className="btn sm" type="button" onClick={() => toggleChange(c.id)}>{c.status === "applied" ? "Undo" : "Redo"}</button>}
              </div>
              {(c.why || c.result) && <p className="muted">{c.why} {c.result}</p>}
              <div className="diff-wrap"><DiffTable rows={c.diff} /></div>
              <div className="change-meta"><span>By {c.by === "you" ? "you" : "Rig, after you said yes"}</span><span>Old values saved</span></div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
