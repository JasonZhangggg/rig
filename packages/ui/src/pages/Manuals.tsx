import { useState } from "react";
import { extraPartKey, manualKinds, type ManualKind, type PartTarget } from "@rig/core";
import { useApp } from "../state";
import { ManualCard, PickPdf } from "../manuals/ManualCard";
import { HitList, useManualSearch } from "../manuals/Search";
import { useManuals } from "../manuals/useManuals";
import { openManual } from "../manuals/viewer";
import { manualRows } from "../manuals/words";

/** Kinds the person can add: the parts Windows can't name. */
const addable: ManualKind[] = ["case", "psu", "cooler", "memory", "monitor", "storage", "other"];

/** The maker's manual for each part, searchable, with the diagram pages marked. */
export function Manuals() {
  const { pc, client } = useApp();
  const state = useManuals();
  const rows = manualRows(pc, state);
  const ready = (state.manuals ?? []).filter((m) => m.indexed).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Manuals for {pc.name}</h1>
          <p className="sub">The maker's own guides for {pc.name}'s parts, with the useful diagrams marked. Search them here, and Rig quotes them by page when you ask.</p>
        </div>
      </div>

      <SearchCard disabled={ready === 0} />

      {state.loadError && <div className="callout warn" role="alert">{state.loadError}</div>}
      {state.manuals == null ? <p className="card card-pad muted" role="status">Loading manuals…</p> : (
        <section aria-labelledby="mn-parts-h" className="mn-section">
          <h2 id="mn-parts-h" className="up-section-h">Parts</h2>
          <div className="mn-grid">
            {rows.map((r) => <ManualCard key={r.target.part} row={r} store={state.store} />)}
            <AddPart />
          </div>
          {client.kind === "web" && !pc.online && <p className="faint mn-foot">{pc.name} is offline. Manuals are kept with your account, so they all work from here.</p>}
        </section>
      )}
    </div>
  );
}

function SearchCard({ disabled }: { disabled: boolean }) {
  const { pc } = useApp();
  const [q, setQ] = useState("");
  const { hits, error } = useManualSearch(q);
  return (
    <section className="card card-pad mn-search" aria-labelledby="mn-search-h">
      <h2 id="mn-search-h">Search all manuals</h2>
      <div className="mn-search-box">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search all manuals"
          placeholder={disabled ? `Search works once a manual for ${pc.name} is read` : "Try F_PANEL, memory slots or fan header"} />
      </div>
      {error && <p className="muted">{error}</p>}
      {hits && hits.length === 0 && !error && <p className="muted">Nothing in {pc.name}'s manuals matches "{q.trim()}". Try a header name or a shorter phrase, or ask Rig.</p>}
      {hits && hits.length > 0 && <HitList hits={hits} onOpen={(h) => openManual(h.manualId, h.page)} />}
    </section>
  );
}

/** For parts Rig can't detect: the case, power supply, cooler and the rest. */
function AddPart() {
  const { store } = useManuals();
  const { client } = useApp();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ManualKind>("case");
  const [maker, setMaker] = useState("");
  const [model, setModel] = useState("");
  const target = (): PartTarget => ({ part: extraPartKey(kind, maker.trim(), model.trim()), kind, maker: maker.trim(), model: model.trim(), source: "added" });
  const reset = () => { setOpen(false); setMaker(""); setModel(""); };
  if (!open) {
    return (
      <div className="card mn-card mn-add">
        <span className="label">Something else</span>
        <h3 className="mn-title">Add a part</h3>
        <p className="muted">Rig can't see the case, power supply, cooler or monitor from Windows. Tell it the model and it finds the manual.</p>
        <div className="mn-actions"><button type="button" className="btn sm" onClick={() => setOpen(true)}>Add a part</button></div>
      </div>
    );
  }
  const ok = model.trim().length > 1;
  return (
    <form className="card mn-card mn-add" aria-label="Add a part" onSubmit={(e) => { e.preventDefault(); if (!ok) return; const t = target(); store.addExtra(t); void store.find(t); reset(); }}>
      <span className="label">Something else</span>
      <h3 className="mn-title">Add a part</h3>
      <div className="mn-fields three">
        <div className="field">
          <label className="label" htmlFor="mn-kind">Kind</label>
          <select className="input" id="mn-kind" value={kind} onChange={(e) => setKind(e.target.value as ManualKind)}>
            {manualKinds.filter((k) => addable.includes(k.kind)).map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </div>
        <div className="field"><label className="label" htmlFor="mn-maker">Maker</label><input className="input" id="mn-maker" value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="Like Corsair" /></div>
        <div className="field"><label className="label" htmlFor="mn-model">Model</label><input className="input" id="mn-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Like RM850x" autoFocus /></div>
      </div>
      <p className="faint mn-hint">The model is on the box, a sticker on the part, or your order.</p>
      <div className="mn-actions">
        {client.findManual && <button type="submit" className="btn primary sm" disabled={!ok}>Find manual</button>}
        <PickPdf className={client.findManual ? "btn ghost sm" : "btn sm"} onPick={(f) => { const t = { ...target(), model: model.trim() || f.name.replace(/\.pdf$/i, "") }; t.part = extraPartKey(kind, t.maker, t.model); store.addExtra(t); void store.addFile(t, f); reset(); }}>Add a PDF instead</PickPdf>
        <button type="button" className="btn ghost sm" onClick={reset}>Cancel</button>
      </div>
    </form>
  );
}
