// The Manuals tab of My PC: search every manual, one card per part, and the
// drivers and BIOS Rig read, with the maker's download page.

import { useState } from "react";
import type { ManualKind } from "@rig/core";
import { useApp } from "../state";
import { AddManual } from "./AddManual";
import { ManualCard } from "./ManualCard";
import { HitList, useManualSearch } from "./Search";
import { useManuals } from "./useManuals";
import { openManual } from "./viewerState";
import { manualRows } from "./words";
import { Row, Rows } from "../components/Rows";

const driverPages: Record<string, string> = {
  NVIDIA: "https://www.nvidia.com/en-us/drivers/",
  AMD: "https://www.amd.com/en/support/download/drivers.html",
  Intel: "https://www.intel.com/content/www/us/en/support/detect.html",
};

const addable: ManualKind[] = ["monitor", "cooler", "case", "psu", "memory", "storage", "other"];

export function ManualsTab() {
  const { pc } = useApp();
  const state = useManuals();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const { hits, error } = useManualSearch(q);
  const rows = state.manuals ? manualRows(pc, state) : [];
  const ready = state.manuals?.filter((m) => m.indexed).length ?? 0;
  return (
    <div className="mt">
      <section className="mt-search" aria-label="Search the manuals">
        <input className="input mt-q" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={ready ? 'Like "front panel" or "M.2"' : "Search the manuals"} aria-label="Search the manuals" />
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
          <div className="mt-grid">
            {state.loadError && <p className="callout warn">{state.loadError}</p>}
            {rows.map((r) => <ManualCard key={r.target.part} row={r} store={state.store} />)}
            <div className="mt-add">
              {adding
                ? <AddManual kinds={addable} intro="A monitor, a cooler or anything else Windows can't see. Tell Rig the model and it finds the maker's manual." onDone={() => setAdding(false)} />
                : <button type="button" className="mt-add-btn" onClick={() => setAdding(true)}><b>Add a manual</b><span className="muted">For your monitor, case, cooler or anything else</span></button>}
            </div>
          </div>
        )}
      </section>

      <Drivers />
    </div>
  );
}

/** Each part with a driver or BIOS: what's installed, whether there's newer, and where to get it. */
function Drivers() {
  const { pc, ask } = useApp();
  const list = Object.entries(pc.parts ?? {}).filter(([, p]) => p.driver);
  if (!list.length) return null;
  return (
    <section aria-labelledby="mt-drv-h">
      <h2 id="mt-drv-h" className="mt-h">Drivers and BIOS</h2>
      <Rows>
        {list.map(([id, p]) => {
          const d = p.driver!;
          const bios = d.installed.startsWith("BIOS");
          const maker = Object.keys(driverPages).find((k) => d.installed.startsWith(k) || p.name.includes(k));
          const newer = !!d.latest && d.latest !== d.installed;
          return (
            <Row key={id} name={p.name} title={p.name}
              meta={bios ? `${d.installed}.` : `${p.type} driver, ${d.installed}.`}
              tag={newer ? <span className="chip warn">{d.latest} is out</span> : d.latest ? <span className="chip ok">Up to date</span> : null}
              action={maker ? <a className="btn sm" href={driverPages[maker]} target="_blank" rel="noreferrer">{maker} downloads</a>
                : <button type="button" className="btn sm" onClick={() => ask(`Is there a newer ${bios ? "BIOS" : "driver"} for my ${p.name}? I have ${d.installed}.`)}>Ask if there's a newer one</button>} />
          );
        })}
      </Rows>
      <p className="faint mt-note">Rig never installs drivers or BIOS updates by itself.</p>
    </section>
  );
}
