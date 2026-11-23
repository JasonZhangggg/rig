// A part's Manual tab on My PC: the manual's sections in groups that fold open, a way to open it by its name
// or the icon beside it, and one box to ask about the part, kept at the bottom.

import { useState } from "react";
import type { DiagramKind, Manual } from "@rig/core";
import { useApp } from "../state";
import { openManual } from "./viewerState";
import { groupedJumps, jumpGroups, jumpPages, manualJumps, type Jump } from "./words";

const Chevron = ({ open }: { open?: boolean }) => (
  <svg className={`mn-chev${open ? " open" : ""}`} viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** One section: its name, and the page it opens at. */
function Section({ manual, jump }: { manual: Manual; jump: Jump }) {
  return (
    <li>
      <button type="button" className="mn-sec" aria-label={`${jump.label}, ${jump.pages.length > 1 ? "pages" : "page"} ${jump.pages.join(" and ")}`} onClick={() => openManual(manual.id, jump.pages[0])}>
        <span className="mn-sec-name">{jump.label}</span>
        <span className="mn-sec-p">{jumpPages(jump)}</span>
      </button>
    </li>
  );
}

const groupOf = (kind: DiagramKind | undefined) => jumpGroups.find(([, kinds]) => kind && kinds.includes(kind))?.[0];

/**
 * The manual's sections, grouped. Each group folds open to its sections, and the group this part needs most
 * starts open. Nothing when the manual has no sections.
 */
export function ManualSections({ manual, only, prefer }: { manual: Manual; only?: DiagramKind[]; prefer?: DiagramKind[] }) {
  const jumps = manualJumps(manual.diagrams.filter((d) => !only || only.includes(d.kind)));
  const groups = groupedJumps(jumps);
  const first = groupOf(prefer?.find((k) => jumps.some((j) => j.kind === k))) ?? groups[0]?.[0];
  const [open, setOpen] = useState<Set<string>>(() => new Set(first ? [first] : []));
  if (!jumps.length) return null;
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
            {on && <ul className="mn-secs" aria-label={`${g}, in the ${manual.title}`}>{list.map((j) => <Section key={`${j.kind}-${j.label}`} manual={manual} jump={j} />)}</ul>}
          </div>
        );
      })}
    </div>
  );
}

/** The small open button that sits beside a manual's name. */
export function OpenManualIcon({ manual }: { manual: Manual }) {
  const label = `Open the ${manual.title}`;
  return (
    <button type="button" className="more-btn mn-open-icon" aria-label={label} title="Open manual" onClick={() => openManual(manual.id)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

/** Grows the question box with what's typed, up to four lines, then it scrolls. */
function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 4 * 22 + 18)}px`;
}

/** Ask about the part: the answer comes in the chat, naming the manual page when one helped. */
export function AskManual({ about, fromManual }: { about: string; fromManual: boolean }) {
  const { ask } = useApp();
  const [q, setQ] = useState("");
  const text = q.trim();
  return (
    <div className="mn-ask-bar">
      <form className="mn-ask" onSubmit={(e) => { e.preventDefault(); if (text) { ask(`About my ${about}: ${text}`); setQ(""); const ta = e.currentTarget.querySelector("textarea"); if (ta) ta.style.height = ""; } }}>
        <textarea id="ask-manual" rows={1} value={q} placeholder={fromManual ? "Ask about this part or its manual" : "Ask about this part"} aria-label="Ask a question about this part"
          title={fromManual ? "Answers say which page of the manual they came from." : "Rig answers from what it knows about this part."}
          onChange={(e) => { setQ(e.target.value); grow(e.target); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <button type="submit" className="mn-ask-send" aria-label="Ask" disabled={!text}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4M5 9l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </form>
    </div>
  );
}
