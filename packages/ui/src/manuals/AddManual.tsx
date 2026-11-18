import { useState } from "react";
import { extraPartKey, manualKinds, type ManualKind, type PartTarget } from "@rig/core";
import { useApp } from "../state";
import { PickPdf } from "./ManualCard";
import { useManuals } from "./useManuals";

/** Maker and model of a part Windows can't name, then Rig finds its manual (or the person adds a PDF). */
export function AddManual({ part, kind: fixed, kinds, maker: knownMaker = "", model: knownModel = "", intro, onDone }: {
  /** The part on My PC it belongs to, like "case". Without one, the manual is kept as one of the PC's other manuals. */
  part?: string;
  kind?: ManualKind;
  /** Kinds to pick from when the part isn't fixed. */
  kinds?: ManualKind[];
  maker?: string;
  model?: string;
  intro: string;
  onDone?: () => void;
}) {
  const { store } = useManuals();
  const { client } = useApp();
  const [kind, setKind] = useState<ManualKind>(fixed ?? kinds?.[0] ?? "other");
  const [maker, setMaker] = useState(knownMaker);
  const [model, setModel] = useState(knownModel);
  const id = `am-${part ?? "other"}`;
  const target = (m = model.trim()): PartTarget => ({ part: part ?? extraPartKey(kind, maker.trim(), m), kind, maker: maker.trim(), model: m, source: "added" });
  const ok = model.trim().length > 1;
  const done = () => { setMaker(knownMaker); setModel(knownModel); onDone?.(); };
  return (
    <form className="mn-form" aria-label="Add a manual" onSubmit={(e) => { e.preventDefault(); if (!ok) return; const t = target(); store.addExtra(t); void store.find(t); done(); }}>
      <p className="muted">{intro}</p>
      <div className={`mn-fields${kinds ? " three" : ""}`}>
        {kinds && (
          <div className="field">
            <label className="label" htmlFor={`${id}-kind`}>Kind</label>
            <select className="input" id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as ManualKind)}>
              {manualKinds.filter((k) => kinds.includes(k.kind)).map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </div>
        )}
        <div className="field"><label className="label" htmlFor={`${id}-maker`}>Maker</label><input className="input" id={`${id}-maker`} value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="Like Corsair" /></div>
        <div className="field"><label className="label" htmlFor={`${id}-model`}>Model</label><input className="input" id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Like RM850x" /></div>
      </div>
      <p className="faint mn-hint">The model is on the box, a sticker on the part, or your order.</p>
      <div className="mn-actions">
        {client.findManual && <button type="submit" className="btn primary sm" disabled={!ok}>Find manual</button>}
        <PickPdf className={client.findManual ? "btn ghost sm" : "btn sm"} onPick={(f) => { const t = target(model.trim() || f.name.replace(/\.pdf$/i, "")); store.addExtra(t); void store.addFile(t, f); done(); }}>Add a PDF instead</PickPdf>
        {onDone && <button type="button" className="btn ghost sm" onClick={done}>Cancel</button>}
      </div>
    </form>
  );
}
