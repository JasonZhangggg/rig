import { useRef, useState, type ReactNode } from "react";
import type { DiagramKind, Manual, PartTarget } from "@rig/core";
import { useActions } from "../state";
import { MoreMenu } from "../components/MoreMenu";
import { openManual } from "./viewerState";
import { ManualSections, OpenManualIcon } from "./ManualOutline";
import type { ManualStore } from "./useManuals";
import { busy, jobText, modelName, pagesText, partName, type Row } from "./words";

/** A hidden file input for PDFs, and a way to open it from any button or menu item. */
function usePdfPicker(onPick: (f: File) => void): [() => void, ReactNode] {
  const input = useRef<HTMLInputElement>(null);
  const el = (
    <input ref={input} type="file" accept="application/pdf,.pdf" hidden aria-hidden="true" tabIndex={-1}
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
  );
  return [() => input.current?.click(), el];
}

/** A button that picks a PDF from the person's files. */
export function PickPdf({ onPick, children, className = "btn sm" }: { onPick: (f: File) => void; children: ReactNode; className?: string }) {
  const [pick, input] = usePdfPicker(onPick);
  return <><button type="button" className={className} onClick={pick}>{children}</button>{input}</>;
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

/**
 * One part and its manual: what's happening and the one thing to do next. With outline (a part's Manual tab),
 * the manual opens from its name or the icon beside it, and its sections fold open in groups.
 */
export function ManualCard({ row, store, compact, prefer, outline }: { row: Row; store: ManualStore; compact?: boolean; prefer?: DiagramKind[]; outline?: boolean }) {
  const { client } = useActions();
  const { target, manual: m, job } = row;
  const [form, setForm] = useState<null | "exact" | "again">(null);
  const [confirm, setConfirm] = useState(false);
  const onDevice = store.get().onDevice;
  const find = (t: PartTarget) => { setForm(null); void store.find(t); };
  const add = (f: File, replacing?: string) => { setForm(null); void store.addFile(target, f, replacing); };
  const fileElsewhere = m?.source === "added" && !onDevice.includes(m.id);
  const maker = target.maker || "the maker";
  const [pickReplacement, replaceInput] = usePdfPicker((f) => add(f, m?.id));
  let menu: ReactNode = null;
  let openable: Manual | null = null;

  // Each state of the card, in four pieces: one line saying where things stand, an aside under it,
  // the buttons, and what goes below. The Manuals tab lays them out as a row of a list; a part's Manual tab stacks them.
  let line: ReactNode = null;
  let aside: ReactNode = null;
  let actions: ReactNode = null;
  let below: ReactNode = null;
  if (busy(job)) {
    const j = job!;
    line = jobText(j);
    if (j.step === "reading" && j.total > 0) below = <div className="bar mn-bar" aria-hidden="true"><i style={{ transform: `translateX(${(j.done / j.total) * 100 - 100}%)` }} /></div>;
  } else if (form) {
    below = <ModelForm target={target} onFind={find} onCancel={() => setForm(null)}
      intro={form === "exact"
        ? "Windows only knows the chip, and each card maker writes its own manual. The exact model is on the card's box or the sticker on the card, like ASUS DUAL RTX 4070 SUPER OC."
        : "Check the model on the box, the sticker on the part or the order, then search again."} />;
  } else if (confirm && m) {
    below = (
      <div className="mn-confirm" role="group" aria-label="Remove this manual?">
        <p>Remove the {m.title}? Its pages leave search and the chat{m.source === "added" ? ", and the copy of the file on this device is deleted" : ""}.</p>
        <div className="mn-actions">
          <button type="button" className="btn sm danger" onClick={() => { setConfirm(false); void store.remove(m.id); }}>Remove</button>
          <button type="button" className="btn ghost sm" autoFocus onClick={() => setConfirm(false)}>Keep it</button>
        </div>
      </div>
    );
  } else if (job?.step === "notfound" || job?.step === "error") {
    if (job.step === "notfound") line = `Rig couldn't find this manual on ${maker}'s site.`;
    else aside = <p className="callout warn">{job.message}</p>;
    actions = (
      <>
        <PickPdf className={compact ? "btn sm" : "btn ghost sm"} onPick={(f) => add(f, m?.id)}>Add a PDF you have</PickPdf>
        {job.step === "notfound" || !m ? <button type="button" className="btn ghost sm" onClick={() => setForm("again")}>Search again with a different model name</button>
          : <button type="button" className="btn ghost sm" onClick={() => { store.clearJob(target.part); void store.read(m); }}>Try again</button>}
      </>
    );
  } else if (m) {
    const canOpen = m.indexed || !fileElsewhere;
    if (canOpen) openable = m;
    menu = <MoreMenu label={`More for the ${m.title}`} items={[{ label: "Replace with another PDF", run: pickReplacement }, { label: "Remove this manual", run: () => setConfirm(true), danger: true }]} />;
    line = <><span>{pagesText(m)}</span><span>{m.source === "added" ? "Added from a file" : m.host ? `From ${m.host}` : "From the maker"}</span></>;
    if (fileElsewhere) aside = <p className="mn-note">The file is on the device it was added on. {m.indexed ? "Search and the chat still use it." : "Open Rig there to read it."}</p>;
    if (outline) {
      if (!m.indexed && !fileElsewhere) actions = <button type="button" className="btn sm mn-read" onClick={() => void store.read(m)}>Read it so search and the chat can use it</button>;
      below = <ManualSections manual={m} prefer={prefer} />;
    } else {
      actions = (canOpen || !m.indexed) && (
        <>
          {canOpen && <button type="button" className="btn primary sm" onClick={() => openManual(m.id)}>Open manual</button>}
          {!m.indexed && !fileElsewhere && <button type="button" className="btn ghost sm" onClick={() => void store.read(m)}>Read it</button>}
        </>
      );
    }
  } else {
    const canFind = !!client.findManual;
    line = target.askModel ? `Rig needs the card's exact model to find its manual.` : `Rig hasn't looked for this one yet.`;
    actions = (
      <>
        {canFind && <button type="button" className={compact ? "btn primary sm" : "btn ghost sm"} onClick={() => (target.askModel ? setForm("exact") : find(target))}>Find manual</button>}
        <PickPdf className={canFind || !compact ? "btn ghost sm" : "btn sm"} onPick={(f) => add(f)}>Add a PDF you have</PickPdf>
        {target.source === "added" && <button type="button" className="btn ghost sm" onClick={() => store.dropExtra(target.part)}>Remove</button>}
      </>
    );
  }

  if (!compact) {
    // The Manuals tab: a row like the Drivers and BIOS rows under it. The part's name in bold, one grey line with
    // what kind of part it is and where its manual stands, the buttons on the right, and the sections under it.
    const status = busy(job);
    return (
      <li className="mn-row">
        <article className="mn-card" aria-label={`${partName(target)}: ${modelName(target)}`} aria-busy={status || undefined}>
          <div className="mn-row-main">
            <div className="mn-row-body">
              <h3 className="mn-title">{modelName(target)}</h3>
              <p className="mn-meta" role={status ? "status" : undefined}><span>{partName(target)}</span>{line && (typeof line === "string" ? <span>{line}</span> : line)}</p>
            </div>
            {(actions || menu) && <div className="mn-row-acts">{actions}{menu}</div>}
          </div>
          {aside}
          {below}
          {replaceInput}
        </article>
      </li>
    );
  }

  const state = (
    <>
      {line != null && (busy(job) ? <div className="mn-progress" role="status"><span>{line}</span>{below}</div>
        : m && !job ? <p className="mn-meta">{line}</p> : <p className="muted">{line}</p>)}
      {aside}
      {actions && <div className="mn-actions">{actions}</div>}
      {!busy(job) && below}
    </>
  );

  return (
    <article className="mn-card compact" aria-label={`${partName(target)}: ${modelName(target)}`}>
      <div className="mn-title-row">
        <h3 className="mn-title">{outline && openable ? <button type="button" className="mn-title-link" onClick={() => openManual(openable!.id)}>{modelName(target)}</button> : modelName(target)}</h3>
        {(outline && openable) || menu ? <div className="mn-head-tools">{outline && openable && <OpenManualIcon manual={openable} />}{menu}</div> : null}
      </div>
      {state}
      {replaceInput}
    </article>
  );
}
