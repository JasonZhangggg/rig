import { useState } from "react";
import type { Change, DiffRow, Issue } from "@rig/core";
import { DiffTable } from "../../components/common";
import { PageLead } from "../../components/PageLead";
import { ago } from "../games/words";

export type Filter = "all" | "applied" | "undone";

/** The top of the page: the change waiting for a yes when there is one, or else the latest change. */
export function Lead({ fix, more, rows, latest, onReview }: { fix?: Issue; more: number; rows?: DiffRow[]; latest?: Change; onReview: () => void }) {
  const [open, setOpen] = useState(false);
  if (fix) {
    return (
      <PageLead id="ch-lead-h" tone="look" tag="Waiting for you" title={fix.title}
        body={`${fix.body} Nothing changes until you review it.${more ? ` ${more === 1 ? "1 more change waits" : `${more} more changes wait`} below.` : ""}`}>
        <button className="btn primary" type="button" aria-label={`Review: ${fix.title}`} onClick={onReview}>Review</button>
        {rows?.length ? <button className="btn ghost" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide what changes" : "What changes"}</button> : null}
        {open && rows?.length ? <div className="diff-wrap ch-lead-diff"><DiffTable rows={rows} /></div> : null}
      </PageLead>
    );
  }
  if (!latest) return null;
  const by = latest.by === "you" ? "by you" : "by Rig after you said yes";
  return (
    <PageLead id="ch-lead-h" tone="plain" tag="Latest change" title={latest.title}
      body={`${ago(new Date(latest.at).getTime())[0].toUpperCase()}${ago(new Date(latest.at).getTime()).slice(1)}, ${by}. ${latest.status === "applied" ? "The old values are saved, so Undo puts them back." : "Since undone, so the old values are back."}`} />
  );
}

/** A row of counts over the list: every change, those in place and those undone. Each one filters it. */
export function Counts({ changes, filter, onFilter }: { changes: Change[]; filter: Filter; onFilter: (f: Filter) => void }) {
  const applied = changes.filter((c) => c.status === "applied").length;
  const items: [Filter, string, number][] = [["all", "All", changes.length], ["applied", "In place", applied], ["undone", "Undone", changes.length - applied]];
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
