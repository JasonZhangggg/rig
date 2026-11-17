import { useState } from "react";
import { DiffTable, StatusChip } from "../components/common";
import { useApp } from "../state";

export function Changes() {
  const { ui, pc, toggleChange } = useApp();
  const [filter, setFilter] = useState<"all" | "applied" | "undone">("all");
  const list = ui.changes.filter((c) => filter === "all" || c.status === filter);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Changes</h1><p className="sub">Everything Rig or you changed on {pc.name}, with what it was before. Undo puts back the old values from the restore point.</p></div>
        <div className="seg" role="group" aria-label="Filter">
          {(["all", "applied", "undone"] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
        </div>
      </div>
      <section className="card">
        {list.length === 0 && <p className="card-pad muted">Nothing here yet.</p>}
        {list.map((c) => (
          <div key={c.id} className={`change ${c.status}`}>
            <div className="change-when num">{c.when}</div>
            <div className="change-main">
              <div className="change-title">
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><h3>{c.title}</h3><StatusChip status={c.status} /></div>
                <button className="btn sm" type="button" onClick={() => toggleChange(c.id)}>{c.status === "applied" ? "Undo" : "Redo"}</button>
              </div>
              {(c.why || c.result) && <p className="muted">{c.why} {c.result}</p>}
              <div className="diff-wrap"><DiffTable rows={c.diff} /></div>
              <div className="change-meta"><span>By {c.by}</span><span>{c.restore}</span></div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
