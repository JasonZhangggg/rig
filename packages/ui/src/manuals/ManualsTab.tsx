// The Manuals tab of My PC: search every manual, one card per part, and the
// drivers and BIOS Rig read, with the maker's download page.

import { memo, useState } from "react";
import { driverRows, laptopDriverNote, type ManualKind } from "@rig/core";
import { useActions, useStillPC } from "../state";
import { AddManual } from "./AddManual";
import { ManualCard } from "./ManualCard";
import { HitList, useManualSearch } from "./Search";
import { useManuals } from "./useManuals";
import { openManual } from "./viewerState";
import { manualRows } from "./words";
import { Row, Rows } from "../components/Rows";

const addable: ManualKind[] = ["monitor", "cooler", "case", "psu", "memory", "storage", "other"];
/** A laptop has no case, cooler or power supply to add; a dock, mouse or charger goes under Other. */
const laptopAddable: ManualKind[] = ["monitor", "other", "storage"];

/** Drawn again only when the manuals or the PC's parts change, not on every reading of the page around it. */
export const ManualsTab = memo(function ManualsTab() {
  const pc = useStillPC();
  const state = useManuals();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const { hits, error } = useManualSearch(q);
  const rows = state.manuals ? manualRows(pc, state) : [];
  const ready = state.manuals?.filter((m) => m.indexed).length ?? 0;
  const laptop = pc.kind === "laptop";
  const addHint = laptop ? "For your dock, monitor, mouse or charger" : "For your monitor, case, cooler or anything else";
  return (
    <div className="mt">
      <section className="mt-search" aria-label="Search the manuals">
        <input className="input mt-q" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={ready ? (laptop ? 'Like "battery" or "M.2"' : 'Like "front panel" or "M.2"') : "Search the manuals"} aria-label="Search the manuals" />
        {q.trim().length >= 2 && (
          <div className="mt-results" role="region" aria-live="polite" aria-label="Pages that match">
            {error ? <p className="callout warn">{error}</p>
              : hits == null ? <p className="muted" role="status">Searching…</p>
              : hits.length ? <HitList hits={hits} onOpen={(h) => openManual(h.manualId, h.page)} />
              : <p className="muted">No page mentions "{q.trim()}". Try other words, or ask Rig.</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="mt-h">
        <h2 id="mt-h" className="mt-h">Manuals</h2>
        {state.manuals == null ? <p className="muted" role="status">Loading manuals…</p> : (
          <>
            {state.loadError && <p className="callout warn mt-error">{state.loadError}</p>}
            <ul className="mt-list">
              {rows.map((r) => <ManualCard key={r.target.part} row={r} store={state.store} />)}
              <li className="mn-row mt-add">
                {adding
                  ? <AddManual kinds={laptop ? laptopAddable : addable} onDone={() => setAdding(false)}
                      intro={laptop ? "A dock, a monitor, a mouse or anything else you use with it. Tell Rig the model and it finds the maker's manual." : "A monitor, a cooler or anything else Windows can't see. Tell Rig the model and it finds the maker's manual."} />
                  : <button type="button" className="btn ghost sm mt-add-btn" onClick={() => setAdding(true)}>Add a manual<span className="sr-only">, {addHint.toLowerCase()}</span></button>}
                {!adding && <span className="mt-add-hint" aria-hidden="true">{addHint}</span>}
              </li>
            </ul>
          </>
        )}
      </section>

      <Drivers />
    </div>
  );
});

/** Each driver and BIOS Rig read, whether there's newer, and where to get it. A laptop leads with its maker's support site. */
function Drivers() {
  const { ask } = useActions();
  const pc = useStillPC();
  const rows = driverRows(pc);
  if (!rows.length) return null;
  const note = laptopDriverNote(pc);
  return (
    <section aria-labelledby="mt-drv-h">
      <h2 id="mt-drv-h" className="mt-h">Drivers and BIOS</h2>
      <Rows>
        {rows.map((r) => {
          const newer = !!r.latest && r.latest !== r.installed;
          return (
            <Row key={r.id} name={r.name} title={r.name}
              meta={<span className="mn-meta"><span>{r.what}</span>{r.installed && <span>{r.installed}</span>}</span>}
              tag={newer ? <span className="chip warn">{r.latest} is out</span> : null}
              action={<>
                {/* Unless Rig already knows a newer one is out, the first question is whether there is one, so that's always offered. */}
                {r.ask && !newer && <button type="button" className="btn sm" onClick={() => ask(r.ask!.question)}>{r.ask.label}</button>}
                {r.link && <a className="btn sm" href={r.link.href} target="_blank" rel="noreferrer">{r.link.label}</a>}
              </>} />
          );
        })}
      </Rows>
      {note && <p className="faint mt-note">{note}</p>}
      <p className="faint mt-note">Rig never installs drivers or BIOS updates by itself.</p>
    </section>
  );
}
