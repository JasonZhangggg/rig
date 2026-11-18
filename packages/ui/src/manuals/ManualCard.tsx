import { useRef, useState, type ReactNode } from "react";
import type { Manual, PartTarget } from "@rig/core";
import { useApp } from "../state";
import { openManual } from "./viewerState";
import type { ManualStore } from "./useManuals";
import { busy, chipText, jobText, modelName, pagesText, partName, type Row } from "./words";

/** A button that picks a PDF from the person's files. */
export function PickPdf({ onPick, children, className = "btn sm" }: { onPick: (f: File) => void; children: ReactNode; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>{children}</button>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
    </>
  );
}

/** Maker and model to look up, prefilled with what Rig knows. */
export function ModelForm({ target, intro, cta = "Find manual", onFind, onCancel }: { target: PartTarget; intro: string; cta?: string; onFind: (t: PartTarget) => void; onCancel: () => void }) {
  const [maker, setMaker] = useState(target.maker);
  const [model, setModel] = useState(target.model);
  const id = `mf-${target.part.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <form className="mn-form" onSubmit={(e) => { e.preventDefault(); if (model.trim()) onFind({ ...target, maker: maker.trim(), model: model.trim() }); }}>
      <p className="muted">{intro}</p>
      <div className="mn-fields">
        <div className="field"><label className="label" htmlFor={`${id}-maker`}>Maker</label><input className="input" id={`${id}-maker`} value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="Like ASUS or Corsair" /></div>
        <div className="field"><label className="label" htmlFor={`${id}-model`}>Model</label><input className="input" id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} autoFocus /></div>
      </div>
      <div className="mn-actions">
        <button className="btn primary sm" type="submit" disabled={!model.trim()}>{cta}</button>
        <button className="btn ghost sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Opens the manual at a diagram's page. */
export function DiagramChips({ manual, only }: { manual: Manual; only?: string[] }) {
  const list = manual.diagrams.filter((d) => !only || only.includes(d.kind));
  if (!list.length) return null;
  return (
    <ul className="mn-chips" aria-label={`Diagrams in the ${manual.title}`}>
      {list.map((d) => <li key={`${d.kind}-${d.page}`}><button type="button" className="mn-chip" onClick={() => openManual(manual.id, d.page)}>{chipText(d)}</button></li>)}
    </ul>
  );
}

/** One part and its manual: what's happening and the one thing to do next. */
export function ManualCard({ row, store, compact }: { row: Row; store: ManualStore; compact?: boolean }) {
  const { client } = useApp();
  const { target, manual: m, job } = row;
  const [form, setForm] = useState<null | "exact" | "again">(null);
  const [confirm, setConfirm] = useState(false);
  const onDevice = store.get().onDevice;
  const find = (t: PartTarget) => { setForm(null); void store.find(t); };
  const add = (f: File, replacing?: string) => { setForm(null); void store.addFile(target, f, replacing); };
  const fileElsewhere = m?.source === "added" && !onDevice.includes(m.id);
  const maker = target.maker || "the maker";

  let state: ReactNode;
  if (busy(job)) {
    const j = job!;
    state = (
      <div className="mn-progress" role="status">
        <span>{jobText(j)}</span>
        {j.step === "reading" && j.total > 0 && <div className="bar"><i style={{ width: `${(j.done / j.total) * 100}%` }} /></div>}
      </div>
    );
  } else if (form) {
    state = <ModelForm target={target} onFind={find} onCancel={() => setForm(null)}
      intro={form === "exact"
        ? "Windows only knows the chip, and each card maker writes its own manual. The exact model is on the card's box or the sticker on the card, like ASUS DUAL RTX 4070 SUPER OC."
        : "Check the model on the box, the sticker on the part or the order, then search again."} />;
  } else if (confirm && m) {
    state = (
      <div className="mn-confirm" role="group" aria-label="Remove this manual?">
        <p>Remove the {m.title}? Its pages leave search and the chat{m.source === "added" ? ", and the copy of the file on this device is deleted" : ""}.</p>
        <div className="mn-actions">
          <button type="button" className="btn sm danger" onClick={() => { setConfirm(false); void store.remove(m.id); }}>Remove</button>
          <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>Keep it</button>
        </div>
      </div>
    );
  } else if (job?.step === "notfound" || job?.step === "error") {
    state = (
      <>
        <p className={job.step === "error" ? "callout warn" : "muted"}>{job.step === "notfound" ? `Rig couldn't find this manual on ${maker}'s site.` : job.message}</p>
        <div className="mn-actions">
          <PickPdf onPick={(f) => add(f, m?.id)}>Add a PDF you have</PickPdf>
          {job.step === "notfound" || !m ? <button type="button" className="btn ghost sm" onClick={() => setForm("again")}>Search again with a different model name</button>
            : <button type="button" className="btn ghost sm" onClick={() => { store.clearJob(target.part); void store.read(m); }}>Try again</button>}
        </div>
      </>
    );
  } else if (m) {
    state = (
      <>
        <p className="mn-meta">
          <span>{pagesText(m)}</span>
          <span>{m.source === "added" ? "Added from a file" : m.host ? `From ${m.host}` : "From the maker"}</span>
        </p>
        {fileElsewhere && <p className="mn-note">The file is on the device it was added on. {m.indexed ? "Search and the chat still use it." : "Open Rig there to read it."}</p>}
        <DiagramChips manual={m} />
        <div className="mn-actions">
          {m.indexed || !fileElsewhere ? <button type="button" className="btn primary sm" onClick={() => openManual(m.id, m.diagrams[0]?.page)}>Open</button> : null}
          {!m.indexed && !fileElsewhere && <button type="button" className="btn sm" onClick={() => void store.read(m)}>Read it</button>}
          <PickPdf className="btn ghost sm" onPick={(f) => add(f, m.id)}>Replace</PickPdf>
          <button type="button" className="btn ghost sm" onClick={() => setConfirm(true)}>Remove</button>
        </div>
      </>
    );
  } else {
    const canFind = !!client.findManual;
    state = (
      <>
        <p className="muted">{target.askModel ? `Rig needs the card's exact model to find its manual.` : `Rig hasn't looked for this one yet.`}</p>
        <div className="mn-actions">
          {canFind && <button type="button" className="btn primary sm" onClick={() => (target.askModel ? setForm("exact") : find(target))}>Find manual</button>}
          <PickPdf className={canFind ? "btn ghost sm" : "btn sm"} onPick={(f) => add(f)}>Add a PDF you have</PickPdf>
          {target.source === "added" && <button type="button" className="btn ghost sm" onClick={() => store.dropExtra(target.part)}>Remove</button>}
        </div>
      </>
    );
  }

  const title = m && !compact ? m.title : modelName(target);
  return (
    <article className={`mn-card${compact ? " compact" : " card"}`} aria-label={`${partName(target)}: ${modelName(target)}`}>
      {!compact && (
        <div className="mn-card-head">
          <span className="label">{partName(target)}</span>
          {m?.indexed && !busy(job) && <span className="chip ok">Ready</span>}
          {job?.step === "notfound" && <span className="chip warn">Not found</span>}
          {busy(job) && <span className="chip info">Working</span>}
        </div>
      )}
      <h3 className="mn-title">{title}</h3>
      {m && !compact && m.title !== modelName(target) && <p className="faint mn-model">{modelName(target)}</p>}
      {state}
    </article>
  );
}
