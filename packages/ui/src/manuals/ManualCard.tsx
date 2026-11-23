import { useRef, useState, type ReactNode } from "react";
import type { DiagramKind, Manual, PartTarget } from "@rig/core";
import { useApp } from "../state";
import { MoreMenu } from "../components/MoreMenu";
import { openManual } from "./viewerState";
import { OpenAndAsk, ManualSections, OpenOrAsk, type ManualLayout } from "./ManualLayouts";
import type { ManualStore } from "./useManuals";
import { busy, groupedJumps, jobText, jumpPages, keyJumps, manualJumps, modelName, pagesText, partName, type Jump, type Row } from "./words";

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

/** One section of a manual: its name, and the page it opens at. */
function JumpRow({ manual, jump }: { manual: Manual; jump: Jump }) {
  return (
    <li>
      <button type="button" className="mn-jump" aria-label={`${jump.label}, ${jump.pages.length > 1 ? "pages" : "page"} ${jump.pages.join(" and ")}`} onClick={() => openManual(manual.id, jump.pages[0])}>
        <span>{jump.label}</span><span className="mn-jump-p">{jumpPages(jump)}</span>
      </button>
    </li>
  );
}

/**
 * The manual's sections to jump to: the few this part needs first, and every other one,
 * grouped, a click away. Each section shows once, even when it's on two pages.
 */
export function ManualJumps({ manual, only, prefer, count = 4, heading = "Jump to a section" }: { manual: Manual; only?: DiagramKind[]; prefer?: DiagramKind[]; count?: number; heading?: string | null }) {
  const [all, setAll] = useState(false);
  const jumps = manualJumps(manual.diagrams.filter((d) => !only || only.includes(d.kind)));
  if (!jumps.length) return null;
  const more = jumps.length > count;
  const name = `Sections of the ${manual.title}`;
  return (
    <div className="mn-jumps">
      {all && more ? groupedJumps(jumps).map(([group, list]) => (
        <div key={group} className="mn-jump-group">
          <span className="mn-jump-h">{group}</span>
          <ul className="mn-jump-list" aria-label={`${group}, in the ${manual.title}`}>{list.map((j) => <JumpRow key={`${j.kind}-${j.label}`} manual={manual} jump={j} />)}</ul>
        </div>
      )) : (
        <>
          {heading && <span className="mn-jump-h">{heading}</span>}
          <ul className="mn-jump-list" aria-label={name}>{keyJumps(jumps, prefer, count).map((j) => <JumpRow key={`${j.kind}-${j.label}`} manual={manual} jump={j} />)}</ul>
        </>
      )}
      {more && <button type="button" className="linkish mn-jump-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show fewer" : `All ${jumps.length} sections`}</button>}
    </div>
  );
}

/** One part and its manual: what's happening and the one thing to do next. */
export function ManualCard({ row, store, compact, prefer, layout, about }: { row: Row; store: ManualStore; compact?: boolean; prefer?: DiagramKind[]; layout?: ManualLayout; about?: string }) {
  const { client } = useApp();
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
          <button type="button" className="btn ghost sm" autoFocus onClick={() => setConfirm(false)}>Keep it</button>
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
    const canOpen = m.indexed || !fileElsewhere;
    menu = <MoreMenu label={`More for the ${m.title}`} items={[{ label: "Replace with another PDF", run: pickReplacement }, { label: "Remove this manual", run: () => setConfirm(true), danger: true }]} />;
    state = (
      <>
        <p className="mn-meta">
          <span>{pagesText(m)}</span>
          <span>{m.source === "added" ? "Added from a file" : m.host ? `From ${m.host}` : "From the maker"}</span>
        </p>
        {fileElsewhere && <p className="mn-note">The file is on the device it was added on. {m.indexed ? "Search and the chat still use it." : "Open Rig there to read it."}</p>}
        {!m.indexed && !fileElsewhere && layout && <button type="button" className="btn sm mn-read" onClick={() => void store.read(m)}>Read it so search and the chat can use it</button>}
        {layout === "outline" ? <OpenAndAsk manual={canOpen ? m : undefined} about={about ?? modelName(target)} />
        : layout === "steps" ? <OpenOrAsk manual={canOpen ? m : undefined} about={about ?? modelName(target)} />
        : layout ? null : (canOpen || !m.indexed) && (
          <div className="mn-open-row">
            {canOpen && <button type="button" className="btn primary mn-open" onClick={() => openManual(m.id)}>Open manual</button>}
            {!m.indexed && !fileElsewhere && <button type="button" className="btn" onClick={() => void store.read(m)}>Read it</button>}
          </div>
        )}
        {layout ? <ManualSections manual={m} layout={layout} prefer={prefer} /> : <ManualJumps manual={m} prefer={prefer} />}
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
      <div className="mn-title-row"><h3 className="mn-title">{title}</h3>{menu}</div>
      {m && !compact && m.title !== modelName(target) && <p className="faint mn-model">{modelName(target)}</p>}
      {state}
      {replaceInput}
    </article>
  );
}
