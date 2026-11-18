import type { Change } from "@rig/core";
import { ago } from "../games/words";

const count = (n: number) => (n === 1 ? "1 change" : `${n} changes`);
export type Filter = "all" | "applied" | "undone";

/** The counts that sum up the page, each one a filter for the list under it, and the latest change in one line. */
export function Lead({ changes, pc, waiting, filter, onFilter }: { changes: Change[]; pc: string; waiting: number; filter: Filter; onFilter: (f: Filter) => void }) {
  const applied = changes.filter((c) => c.status === "applied").length;
  const undone = changes.length - applied;
  const latest = changes.reduce((a, b) => (b.at > a.at ? b : a));
  const by = latest.by === "you" ? "by you" : "by Rig after you said yes";
  const title = applied ? `${count(applied)} in place on ${pc}` : `Every change on ${pc} is undone`;
  const pick = (f: Filter) => onFilter(filter === f ? "all" : f);
  return (
    <section className="ch-lead" aria-label={title}>
      <div className="stats" role="group" aria-label="Show">
        <button type="button" className="stat" aria-pressed={filter === "applied"} onClick={() => pick("applied")}><span>In place</span><b className="num">{applied}</b></button>
        <button type="button" className="stat" aria-pressed={filter === "undone"} onClick={() => pick("undone")}><span>Undone</span><b className="num">{undone}</b></button>
        {waiting > 0 && <a className="stat look" href="#ch-next" onClick={(e) => { e.preventDefault(); document.getElementById("ch-next")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><span>Waiting for you</span><b className="num">{waiting}</b></a>}
      </div>
      <p className="muted ch-latest">Latest, {ago(new Date(latest.at).getTime())}: <b>{latest.title}</b>, {by}{latest.status === "undone" ? ", since undone" : ""}.</p>
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
