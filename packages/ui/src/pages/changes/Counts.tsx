import type { Change } from "@rig/core";

export type Filter = "all" | "applied" | "undone";

/** A row of counts over the list: every change, those in place and those undone. Each one filters it. */
export function Counts({ changes, filter, onFilter }: { changes: Change[]; filter: Filter; onFilter: (f: Filter) => void }) {
  const applied = changes.filter((c) => c.status === "applied").length;
  const items: [Filter, string, number][] = [["all", "All", changes.length], ["applied", "Applied", applied], ["undone", "Undone", changes.length - applied]];
  return (
    <div className="counts" role="group" aria-label="Show only">
      {items.filter(([f, , n]) => n > 0 || f === filter).map(([f, label, n]) => (
        <button key={f} type="button" className={`count${f === "all" ? " quiet" : ""}`} aria-pressed={filter === f} onClick={() => onFilter(filter === f && f !== "all" ? "all" : f)}>
          <span className="count-n num">{n}</span><span className="count-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function HowChangesWork() {
  return (
    <section className="ch-how" aria-labelledby="ch-how-h">
      <h2 id="ch-how-h" className="ch-how-h">How changes work</h2>
      <p className="faint">Rig shows each setting as it is now and what it would become, and changes nothing until you say yes. The old values are saved, so Undo puts them back any time.</p>
    </section>
  );
}
