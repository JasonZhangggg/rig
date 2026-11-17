import { useState } from "react";
import type { Change } from "@rig/core";
import { DiffTable, Icon, StatusChip } from "../components/common";
import { useApp } from "../state";
import { Glance, HowChangesWork, NextChanges } from "./changes/Rail";

type Filter = "all" | "applied" | "undone";

const midnight = (t: number | Date) => new Date(t).setHours(0, 0, 0, 0);
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Today", "Yesterday", or the date in full. */
export function dayLabel(iso: string, now = new Date()) {
  const days = Math.round((midnight(now) - midnight(new Date(iso))) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Newest day first, each day's changes newest first. */
function byDay(list: Change[]) {
  const days = new Map<number, Change[]>();
  for (const c of [...list].sort((a, b) => b.at.localeCompare(a.at))) {
    const k = midnight(new Date(c.at));
    days.set(k, [...(days.get(k) ?? []), c]);
  }
  return [...days.values()];
}

export function Changes() {
  const { data, pc } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const any = data.changes.length > 0;
  const list = data.changes.filter((c) => filter === "all" || c.status === filter);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Changes</h1><p className="sub">Everything Rig or you changed on {pc.name}, with what it was before. Undo puts the old values back.</p></div>
        {any && (
          <div className="seg" role="group" aria-label="Filter">
            {(["all", "applied", "undone"] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
          </div>
        )}
      </div>
      <div className="pg-split">
        <div className="ch-main">
          {!any ? <NoChanges /> : list.length === 0 ? (
            <section className="card card-pad empty">
              <p className="muted">No {filter} changes on {pc.name}.</p>
              <button className="btn sm" type="button" onClick={() => setFilter("all")}>Show all changes</button>
            </section>
          ) : byDay(list).map((day) => <Day key={day[0].at} changes={day} />)}
        </div>
        <aside className="pg-rail" aria-label="About your changes">
          {any && <Glance changes={data.changes} />}
          <NextChanges />
          {any && <HowChangesWork />}
        </aside>
      </div>
    </div>
  );
}

function Day({ changes }: { changes: Change[] }) {
  const label = dayLabel(changes[0].at);
  return (
    <section className="ch-day" aria-label={label}>
      <h2 className="ch-day-label">{label}<span>{changes.length === 1 ? "1 change" : `${changes.length} changes`}</span></h2>
      <ol className="ch-timeline">{changes.map((c) => <Entry key={c.id} c={c} />)}</ol>
    </section>
  );
}

function Entry({ c }: { c: Change }) {
  const { toggleChange, client } = useApp();
  return (
    <li className={`ch-entry ${c.status}`}>
      <time className="ch-time num" dateTime={c.at}>{clock(c.at)}</time>
      <article className={`card change ${c.status}`}>
        <div className="change-title">
          <div className="change-name"><h3>{c.title}</h3><StatusChip status={c.status} /></div>
          {client.caps.applyChanges && <button className="btn sm" type="button" onClick={() => toggleChange(c.id)}>{c.status === "applied" ? "Undo" : "Redo"}</button>}
        </div>
        {(c.why || c.result) && <p className="muted">{[c.why, c.result].filter(Boolean).join(" ")}</p>}
        {c.diff.length > 0 && <div className="diff-wrap"><DiffTable rows={c.diff} /></div>}
        <div className="change-meta"><span>By {c.by === "you" ? "you" : "Rig, after you said yes"}</span><span>{c.status === "applied" ? "Old values saved" : "Old values put back"}</span></div>
      </article>
    </li>
  );
}

function NoChanges() {
  const { go, pc } = useApp();
  return (
    <section className="card ch-empty">
      <span className="ch-empty-icon" aria-hidden="true"><Icon d="M4 10a6 6 0 1 0 2-4.5M4 4v3h3M10 7v3l2 2" /></span>
      <div className="ch-empty-text">
        <h2 className="plain-h">No changes yet</h2>
        <p className="muted">Every change Rig makes on {pc.name} shows up here with the before and after, and an Undo button that puts the old values back.</p>
      </div>
      <HowChangesWork bare />
      <div><button className="btn primary" type="button" onClick={() => go("chat")}>Ask Rig what to fix</button></div>
    </section>
  );
}
