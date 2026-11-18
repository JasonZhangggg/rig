import { useState } from "react";
import type { ManualKind } from "@rig/core";
import { useApp } from "../state";
import { AddManual } from "./AddManual";
import { ManualCard } from "./ManualCard";
import { useManuals } from "./useManuals";
import { manualRows } from "./words";

/** Kinds the person can add for things that aren't one of the parts on My PC. */
const addable: ManualKind[] = ["monitor", "cooler", "case", "psu", "memory", "storage", "other"];

/** Under the parts on My PC: manuals for things Rig can't see, like the monitor, and a way to add one. */
export function OtherManuals() {
  const { pc } = useApp();
  const state = useManuals();
  const [adding, setAdding] = useState(false);
  if (state.manuals == null) return null;
  const rows = manualRows(pc, state).filter((r) => r.target.part.startsWith("extra:"));
  return (
    <section className="mn-other" aria-labelledby="mn-other-h">
      <h3 id="mn-other-h" className="label">Other manuals</h3>
      {rows.map((r) => <ManualCard key={r.target.part} row={r} store={state.store} compact />)}
      {adding
        ? <AddManual kinds={addable} intro="A monitor, a cooler or anything else. Tell Rig the model and it finds the maker's manual." onDone={() => setAdding(false)} />
        : <button type="button" className="linkish" onClick={() => setAdding(true)}>Add a manual for something else, like your monitor</button>}
    </section>
  );
}
