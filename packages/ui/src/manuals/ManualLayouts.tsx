// Three ways to lay out a part's Manual tab on My PC, to pick one from. Each keeps its buttons in one place:
// Outline and Step in put opening and asking at the top, Contents puts them at the bottom.

import { useState } from "react";
import type { DiagramKind, Manual } from "@rig/core";
import { useApp } from "../state";
import { openManual } from "./viewerState";
import { groupedJumps, jumpGroups, jumpPages, manualJumps, type Jump } from "./words";

export type ManualLayout = "outline" | "contents" | "steps";
export const manualLayouts: ManualLayout[] = ["outline", "contents", "steps"];
const KEY = "rig.manualLayout";

/** The layout being tried: ?manualLayout= in the address, then the last one picked, then Outline. */
export function manualLayout(): ManualLayout {
  try {
    const q = new URLSearchParams(location.search).get("manualLayout") as ManualLayout | null;
    if (q && manualLayouts.includes(q)) { localStorage.setItem(KEY, q); return q; }
    const saved = localStorage.getItem(KEY) as ManualLayout | null;
    if (saved && manualLayouts.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return "outline";
}

const Chevron = ({ open }: { open?: boolean }) => (
  <svg className={`mn-chev${open ? " open" : ""}`} viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** One section: its name, and the page it opens at. */
function Section({ manual, jump, toc }: { manual: Manual; jump: Jump; toc?: boolean }) {
  return (
    <li>
      <button type="button" className={`mn-sec${toc ? " toc" : ""}`} aria-label={`${jump.label}, ${jump.pages.length > 1 ? "pages" : "page"} ${jump.pages.join(" and ")}`} onClick={() => openManual(manual.id, jump.pages[0])}>
        <span className="mn-sec-name">{jump.label}</span>
        {toc && <i className="mn-leader" aria-hidden="true" />}
        <span className="mn-sec-p">{toc ? jump.pages.join(", ") : jumpPages(jump)}</span>
      </button>
    </li>
  );
}

const groupOf = (kind: DiagramKind | undefined) => jumpGroups.find(([, kinds]) => kind && kinds.includes(kind))?.[0];

/** Outline: each group folds open to its sections. The group this part needs most starts open. */
function Outline({ manual, groups, prefer }: { manual: Manual; groups: [string, Jump[]][]; prefer?: DiagramKind[] }) {
  const first = groupOf(prefer?.find((k) => groups.some(([, l]) => l.some((j) => j.kind === k)))) ?? groups[0][0];
  const [open, setOpen] = useState<Set<string>>(() => new Set([first]));
  const flip = (g: string) => setOpen((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  return (
    <div className="mn-outline">
      {groups.map(([g, list]) => {
        const on = open.has(g) || groups.length === 1;
        return (
          <div key={g} className="mn-og">
            {groups.length > 1 && (
              <button type="button" className="mn-og-head" aria-expanded={on} onClick={() => flip(g)}>
                <Chevron open={on} /><span>{g}</span><span className="mn-count">{list.length}</span>
              </button>
            )}
            {on && <ul className="mn-secs indent" aria-label={`${g}, in the ${manual.title}`}>{list.map((j) => <Section key={`${j.kind}-${j.label}`} manual={manual} jump={j} />)}</ul>}
          </div>
        );
      })}
    </div>
  );
}

/** Contents: like the contents page of a book, every group and section at once, page numbers on the right. */
function Contents({ manual, groups }: { manual: Manual; groups: [string, Jump[]][] }) {
  return (
    <div className="mn-contents">
      {groups.map(([g, list]) => (
        <div key={g} className="mn-cg">
          {groups.length > 1 && <h4 className="mn-cg-h">{g}</h4>}
          <ul className="mn-secs" aria-label={`${g}, in the ${manual.title}`}>{list.map((j) => <Section key={`${j.kind}-${j.label}`} manual={manual} jump={j} toc />)}</ul>
        </div>
      ))}
    </div>
  );
}

/** Step in: pick a group first, then a section in it, with a path back at the top. */
function Steps({ manual, groups }: { manual: Manual; groups: [string, Jump[]][] }) {
  const [at, setAt] = useState<string | null>(groups.length === 1 ? groups[0][0] : null);
  const here = groups.find(([g]) => g === at);
  if (here) {
    return (
      <div className="mn-steps">
        {groups.length > 1 && (
          <nav className="mn-crumbs" aria-label="Where you are in the manual">
            <button type="button" className="mn-crumb" onClick={() => setAt(null)}>All sections</button>
            <Chevron /><span aria-current="page">{here[0]}</span>
          </nav>
        )}
        <ul className="mn-secs" aria-label={`${here[0]}, in the ${manual.title}`}>{here[1].map((j) => <Section key={`${j.kind}-${j.label}`} manual={manual} jump={j} />)}</ul>
      </div>
    );
  }
  return (
    <ul className="mn-steps mn-sg-list" aria-label={`Sections of the ${manual.title}`}>
      {groups.map(([g, list]) => (
        <li key={g}>
          <button type="button" className="mn-sg" onClick={() => setAt(g)}>
            <span className="mn-sg-txt"><b>{g}</b><small>{list.map((j) => j.label).join(", ")}</small></span>
            <span className="mn-count">{list.length}</span><Chevron />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The manual's sections in the picked layout. Nothing when the manual has none. */
export function ManualSections({ manual, layout, only, prefer }: { manual: Manual; layout: ManualLayout; only?: DiagramKind[]; prefer?: DiagramKind[] }) {
  const jumps = manualJumps(manual.diagrams.filter((d) => !only || only.includes(d.kind)));
  if (!jumps.length) return null;
  const groups = groupedJumps(jumps);
  return layout === "contents" ? <Contents manual={manual} groups={groups} />
    : layout === "steps" ? <Steps manual={manual} groups={groups} />
    : <Outline manual={manual} groups={groups} prefer={prefer} />;
}

/** Ask the manual a question: the answer comes in the chat, naming the page. */
export function AskManual({ about, autoFocus }: { about: string; autoFocus?: boolean }) {
  const { ask } = useApp();
  const [q, setQ] = useState("");
  return (
    <form className="ask-inline" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(`About my ${about}: ${q.trim()}`); }}>
      <input id="ask-manual" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} placeholder="Ask this manual a question" aria-label="Ask this manual a question" title="Answers name the manual and page they came from." />
      <button className="btn sm">Ask</button>
    </form>
  );
}

/** Outline's row at the top: open the manual, and ask it something beside it. */
export function OpenAndAsk({ manual, about }: { manual?: Manual; about: string }) {
  return (
    <div className="mn-top">
      {manual && <button type="button" className="btn primary mn-open" onClick={() => openManual(manual.id)}>Open manual</button>}
      <AskManual about={about} />
    </div>
  );
}

/** Step in's two buttons, side by side; asking opens the question box in their place. */
export function OpenOrAsk({ manual, about }: { manual?: Manual; about: string }) {
  const [asking, setAsking] = useState(false);
  if (asking || !manual) return <AskManual about={about} autoFocus={asking} />;
  return (
    <div className="mn-two">
      <button type="button" className="btn primary" onClick={() => openManual(manual.id)}>Open manual</button>
      <button type="button" className="btn" onClick={() => setAsking(true)}>Ask a question</button>
    </div>
  );
}

/** Contents' bar at the bottom: open the manual or ask it something, in one place. */
export function ManualFooter({ manual, about }: { manual?: Manual; about: string }) {
  return (
    <div className="mn-foot">
      {manual && <button type="button" className="btn primary" onClick={() => openManual(manual.id)}>Open manual</button>}
      <AskManual about={about} />
    </div>
  );
}

