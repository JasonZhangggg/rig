import type { Change } from "@rig/core";
import { useApp } from "../../state";
import { ago } from "../games/words";
import { bySeverity, issueGo } from "../shared";

/** How many changes are in place, how many were undone, and when the last one happened. */
export function Glance({ changes }: { changes: Change[] }) {
  const applied = changes.filter((c) => c.status === "applied").length;
  const latest = changes.reduce((a, b) => (b.at > a.at ? b : a));
  const byRig = changes.filter((c) => c.by === "rig").length;
  return (
    <section className="card card-pad rail-card">
      <h2>At a glance</h2>
      <dl className="ch-glance">
        <div><dt>In place</dt><dd className="num">{applied}</dd></div>
        <div><dt>Undone</dt><dd className="num">{changes.length - applied}</dd></div>
      </dl>
      <p className="muted ch-glance-note">Last change {ago(new Date(latest.at).getTime())}. {byRig === changes.length ? "All made by Rig after you said yes." : byRig === 0 ? "All made by you." : `${byRig} made by Rig after you said yes, ${changes.length - byRig} by you.`}</p>
    </section>
  );
}

/** Things to look at that come with a fix, so the next change is one click away. */
export function NextChanges() {
  const { pc, set, go, ask, review } = useApp();
  const fixes = bySeverity((pc.issues ?? []).filter((i) => i.fix?.length));
  return (
    <section className="card card-pad rail-card">
      <h2>You could change next</h2>
      {fixes.length ? (
        <ul className="rail-list">
          {fixes.map((i) => (
            <li key={i.id}>
              <div><b>{i.title}</b><p className="muted">{i.body}</p></div>
              <button className="btn sm" type="button" aria-label={`Review: ${i.title}`} onClick={() => issueGo(i, pc, { set, go, ask, review })}>Review</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">Nothing waiting on {pc.name}. When Rig spots a setting worth changing, it shows up here for you to review first.</p>}
    </section>
  );
}

const steps: [string, string][] = [
  ["You see the before and after", "Rig shows each setting as it is now and what it would become."],
  ["Nothing changes until you say yes", "Rig asks first, every time."],
  ["Undo puts it back", "The old values are saved, so you can undo any change later."],
];

export function HowChangesWork({ bare }: { bare?: boolean }) {
  const list = <ol className="ch-steps">{steps.map(([t, d], i) => <li key={t}><span className="ch-step-n num" aria-hidden="true">{i + 1}</span><div><b>{t}</b><p className="muted">{d}</p></div></li>)}</ol>;
  if (bare) return list;
  return <section className="card card-pad rail-card"><h2>How changes work</h2>{list}</section>;
}
