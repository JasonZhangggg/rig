import type { Change } from "@rig/core";
import { ago } from "../games/words";

const count = (n: number) => (n === 1 ? "1 change" : `${n} changes`);

/** What changed lately and what's still in place, in a sentence, with the counts beside it. */
export function Lead({ changes, pc }: { changes: Change[]; pc: string }) {
  const applied = changes.filter((c) => c.status === "applied").length;
  const undone = changes.length - applied;
  const latest = changes.reduce((a, b) => (b.at > a.at ? b : a));
  const by = latest.by === "you" ? "by you" : "by Rig after you said yes";
  const title = applied ? `${count(applied)} in place on ${pc}` : `Every change on ${pc} is undone`;
  const body = [
    `The latest, ${ago(new Date(latest.at).getTime())}: ${latest.title}, ${by}${latest.status === "undone" ? ", since undone" : ""}.`,
    applied ? "If anything feels off since then, undo it below and the old values come back." : `${pc} is back the way it was before.`,
  ].join(" ");
  return (
    <section className="card pg-lead good" aria-labelledby="ch-lead-h">
      <div className="pg-lead-text">
        <span className="pg-lead-tag">{applied ? "Old values saved" : "Nothing in place"}</span>
        <h2 id="ch-lead-h" className="pg-lead-h">{title}</h2>
        <p className="pg-lead-body">{body}</p>
      </div>
      <dl className="pg-lead-fig ch-counts">
        <div><dt>In place</dt><dd className="num">{applied}</dd></div>
        <div><dt>Undone</dt><dd className="num">{undone}</dd></div>
      </dl>
    </section>
  );
}

export function HowChangesWork() {
  return (
    <section className="ch-how" aria-labelledby="ch-how-h">
      <h2 id="ch-how-h" className="pg-section-h">How changes work</h2>
      <p className="muted">Rig shows each setting as it is now and what it would become, and changes nothing until you say yes. The old values are saved, so Undo puts them back any time.</p>
    </section>
  );
}
