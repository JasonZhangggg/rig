import { useState } from "react";
import type { ManualKind } from "@rig/core";
import { useApp } from "../state";
import { AddManual } from "./AddManual";
import { ManualCard } from "./ManualCard";
import { AskManual, ManualSections, OpenManualIcon } from "./ManualOutline";
import { openManual } from "./viewerState";
import { useManuals } from "./useManuals";
import { helpsWith, manualRows } from "./words";

/** The kind of manual a part on My PC has of its own, when Windows can't name it. */
const ownKind: Record<string, ManualKind> = { case: "case", psu: "psu", cpu: "cooler", ram: "memory", ssd: "storage" };
/** Parts that need their model typed in before they have a manual: Windows can't see them at all. */
const askFirst = new Set(["case", "psu"]);

/**
 * The Manual tab of a part on My PC: its own manual, the pages of the board's manual about it,
 * and a box at the bottom to ask about the part.
 */
export function PartManual({ id, about }: { id: string; about: string }) {
  const { pc } = useApp();
  const state = useManuals();
  const [adding, setAdding] = useState(false);
  if (state.manuals == null) return <p className="muted" role="status">Loading manuals…</p>;
  const key = pc.kind === "laptop" && id === "board" ? "chassis" : id;
  const part = pc.parts?.[id];
  const row = manualRows(pc, state).find((r) => r.target.part === key);
  const main = state.manuals.find((m) => m.indexed && (m.part === "motherboard" || m.part === "chassis") && m.part !== key);
  const related = main && helpsWith[id] && main.diagrams.some((d) => helpsWith[id].includes(d.kind)) ? main : null;
  const kind = ownKind[id];
  const name = id === "cpu" ? "cooler" : part?.type.toLowerCase() ?? "part";
  const add = kind && !row && (askFirst.has(id) || adding)
    ? <AddManual key={id} part={key} kind={kind} maker={part?.maker} model={part?.model} onDone={adding ? () => setAdding(false) : undefined}
      intro={askFirst.has(id) ? `Windows can't see which ${name} this is. Tell Rig the model and it finds the maker's manual.` : `Tell Rig the model of the ${name} and it finds the maker's manual.`} />
    : null;
  return (
    <div className="mn-part">
      {row && <ManualCard row={row} store={state.store} compact prefer={helpsWith[id]} outline />}
      {add}
      {related && (
        <section className="mn-related" aria-label={`In the ${related.title}`}>
          <div className="mn-title-row">
            <h3 className="mn-rel-title"><button type="button" className="mn-title-link" onClick={() => openManual(related.id)}>In the {related.title}</button></h3>
            <OpenManualIcon manual={related} />
          </div>
          <ManualSections manual={related} only={helpsWith[id]} prefer={helpsWith[id]} />
        </section>
      )}
      {kind && !row && !add && <button type="button" className="linkish mn-add-own" onClick={() => setAdding(true)}>Add this {name}'s own manual</button>}
      {!row && !related && !kind && <p className="muted">Rig doesn't keep a manual for this part.</p>}
      <AskManual about={about} fromManual={!!(row?.manual?.indexed || related)} />
    </div>
  );
}
