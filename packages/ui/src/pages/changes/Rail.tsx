import type { Change } from "@rig/core";
import { ago } from "../games/words";

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

const steps: [string, string][] = [
  ["You see the before and after", "Rig shows each setting as it is now and what it would become."],
  ["Nothing changes until you say yes", "Rig asks first, every time."],
  ["Undo puts it back", "The old values are saved, so you can undo any change later."],
];

export function HowChangesWork() {
  return (
    <section className="card card-pad rail-card">
      <h2>How changes work</h2>
      <ol className="ch-steps">{steps.map(([t, d], i) => <li key={t}><span className="ch-step-n num" aria-hidden="true">{i + 1}</span><div><b>{t}</b><p className="muted">{d}</p></div></li>)}</ol>
    </section>
  );
}
