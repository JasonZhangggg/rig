import { useApp } from "../state";
import { DiagramChips, ManualCard } from "./ManualCard";
import { useManuals } from "./useManuals";
import { helpsWith, manualRows } from "./words";

/** The Manual tab of a part on My PC: its own manual, and the pages of the board's manual about it. */
export function PartManual({ id }: { id: string }) {
  const { pc } = useApp();
  const state = useManuals();
  if (state.manuals == null) return <p className="muted" role="status">Loading manuals…</p>;
  const key = pc.kind === "laptop" && id === "board" ? "chassis" : id;
  const row = manualRows(pc, state).find((r) => r.target.part === key);
  const main = state.manuals.find((m) => m.indexed && (m.part === "motherboard" || m.part === "chassis") && m.part !== key);
  const related = main && helpsWith[id] && main.diagrams.some((d) => helpsWith[id].includes(d.kind)) ? main : null;
  return (
    <div className="mn-part">
      {row && <ManualCard row={row} store={state.store} compact />}
      {related && (
        <div className="mn-related">
          <span className="label">In the {related.title}</span>
          <DiagramChips manual={related} only={helpsWith[id]} />
        </div>
      )}
      {!row && !related && <p className="muted">Rig finds manuals for the motherboard, laptops and graphics cards by itself. For this part, <a href="#manuals">add it on the Manuals page</a> with its model.</p>}
    </div>
  );
}
