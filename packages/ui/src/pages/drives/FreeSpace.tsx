import { useEffect, useState } from "react";
import { freeSpaceWords, freeUpSpace, helperStep, spaceText, type Cleanup, type CleanupRead, type PreviewReply, type StepOutcome, type StorageSenseOffer } from "@rig/core";
import { DayLabel, Row, RowFigure, Rows } from "../../components/Rows";
import { StepCard } from "../../components/change";
import { useActions, useAppSelector } from "../../state";
import { FREE_SPACE_ID } from "../shared";

type Load = { state: "reading" } | { state: "read"; read: CleanupRead } | { state: "failed"; why: string };

/** Where most of the safe ones are cleared, so the person can tick them together. */
const TOGETHER = "Most of these are in Settings > System > Storage > Temporary files, so you can tick them all at once.";

/**
 * What on the PC is safe to clear, how much each frees, and how. Rig reads the sizes but clears none of these itself:
 * each row's Details has the steps in Windows' own tools. The one change it makes is turning on Storage Sense, through
 * its own card: read first, applied only once the person approves, and undone from there or from Changes.
 */
export function FreeSpace() {
  const { client, ask, toast, refreshChanges } = useActions();
  const pc = useAppSelector((c) => ({ id: c.pc.id, name: c.pc.name }));
  const drives = useAppSelector((c) => c.pc.drives, Object.is);
  const [load, setLoad] = useState<Load>({ state: "reading" });
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!client.cleanupSizes) return;
    let live = true;
    setLoad({ state: "reading" });
    client.cleanupSizes(pc.id)
      .then((read) => live && setLoad({ state: "read", read }))
      .catch((e: unknown) => live && setLoad({ state: "failed", why: e instanceof Error ? e.message : "" }));
    return () => { live = false; };
  }, [client, pc.id, tries]);

  const head = <h3 id="fs-h" className="fs-label">Free up space</h3>;
  if (!client.cleanupSizes) {
    return (
      <section className="fs" id={FREE_SPACE_ID} aria-labelledby="fs-h">
        {head}
        <p className="fs-note">
          <span className="faint">Rig sees what's safe to clear only in the Rig app on {pc.name}.</span>
          <button className="btn ghost sm" type="button" onClick={() => ask(`What can I safely remove to free up space on ${pc.name}?`)}>Ask Rig</button>
        </p>
      </section>
    );
  }
  if (load.state !== "read") {
    return (
      <section className="fs" id={FREE_SPACE_ID} aria-labelledby="fs-h" aria-busy={load.state === "reading"}>
        {head}
        {load.state === "reading"
          ? <p className="faint fs-note" aria-live="polite">Checking what's safe to clear…</p>
          : (
            <p className="fs-note">
              <span className="faint">{`Rig couldn't read what's safe to clear. ${load.why}`.trim()}</span>
              <button className="btn ghost sm" type="button" onClick={() => setTries((n) => n + 1)}>Try again</button>
            </p>
          )}
      </section>
    );
  }

  const plan = freeUpSpace(load.read, drives ?? [], Date.now());
  const words = freeSpaceWords(plan);
  const safe = plan.items.filter((i) => i.safety === "safe");
  const look = plan.items.filter((i) => i.safety === "look");
  return (
    <section className="fs" id={FREE_SPACE_ID} aria-labelledby="fs-h">
      {head}
      <p className="sm-room fs-sum"><b>{words.headline}</b><span>{words.detail}</span></p>
      {(safe.length > 0 || plan.storageSense) && (
        <div className="fs-group">
          <DayLabel day="Safe to clear" count={safe.length} one="item" many="items" />
          <Rows label="Safe to clear">
            {safe.map((c) => <CleanupRow key={c.id} c={c} />)}
            {plan.storageSense && <StorageSenseRow offer={plan.storageSense} pc={pc} onChanged={refreshChanges} toast={toast} />}
          </Rows>
          {safe.filter((c) => c.how.steps[0]?.includes("Temporary files")).length > 1 && <p className="faint fs-tip">{TOGETHER}</p>}
        </div>
      )}
      {look.length > 0 && (
        <div className="fs-group">
          <DayLabel day="Look first" count={look.length} one="item" many="items" />
          <Rows label="Look first">
            {look.map((c) => <CleanupRow key={c.id} c={c} />)}
          </Rows>
        </div>
      )}
    </section>
  );
}

/** One thing to clear: what it is, what it frees on the right, and the steps behind Details. */
function CleanupRow({ c }: { c: Cleanup }) {
  const game = c.id.startsWith("game:");
  return (
    <Row name={c.title} title={c.title} meta={c.what}
      figure={<RowFigure value={`${c.partial ? "At least " : ""}${spaceText(c.gb)}`} word={c.where ? `on ${c.where}` : "to clear"} />}
      details={<>
        {c.note && <p className="muted">{c.note}</p>}
        <ol className="fs-steps" aria-label={game ? `How to uninstall ${c.title}` : `How to clear ${c.title}`}>
          {c.how.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        {c.how.storageSense && <p className="faint">Storage Sense clears these by itself once it's on.</p>}
      </>} />
  );
}

/** The one change Rig makes here: Windows' own Storage Sense, through the same card as any change Rig makes. */
function StorageSenseRow({ offer, pc, onChanged, toast }: { offer: StorageSenseOffer; pc: { id: string; name: string }; onChanged: () => Promise<void>; toast: (m: string) => void }) {
  const { client } = useActions();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewReply | null>(null);
  const [outcome, setOutcome] = useState<StepOutcome | null>(null);
  const [steps, setSteps] = useState(false);
  const on = outcome?.apply.outcome === "applied" && outcome.undo?.outcome !== "undone";
  const run = async (what: string, f: () => Promise<void>) => {
    try { await f(); } catch (e) { toast(`Rig couldn't ${what}, so nothing changed. ${e instanceof Error ? e.message : ""}`.replace(/\s+/g, " ").trim()); }
  };
  const step = helperStep(offer.step);
  const read = () => run("read the setting", async () => {
    if (!client.previewStep || typeof step === "string") return;
    setOutcome(null);
    setPreview(await client.previewStep(pc.id, step, false));
  });
  const covers = offer.covers.length ? offer.covers.join(" and ").toLowerCase().replace("recycle bin", "Recycle Bin items older than 30 days") : "temporary files";
  return (
    <>
      <Row name="Storage Sense" title={on ? "Storage Sense is on" : "Let Windows clear these by itself"}
        meta={`Storage Sense clears ${covers} when the drive runs low.`}
        action={!on && !open && <button className="btn sm" type="button" onClick={() => { setOpen(true); setSteps(false); void read(); }}>Turn on…</button>}
        details={<>
          <p className="muted">It's Windows' own cleaner, and it only clears what Windows makes again or what you already deleted. Rig changes one setting in your account, saves the old value first, and Undo puts it back.</p>
        </>} />
      {steps && <li className="fs-card"><p className="muted">To do it yourself: open Settings, go to System &gt; Storage, and turn on Storage Sense.</p></li>}
      {open && (
        <li className="fs-card">
          <StepCard step={offer.step} byPerson preview={preview} outcome={outcome} pcName={pc.name} canApply={client.caps.applyChanges}
            onRead={read}
            onApply={() => run("turn on Storage Sense", async () => {
              if (preview?.outcome !== "ready" || !client.applyStep) return;
              setOutcome({ apply: await client.applyStep(pc.id, preview.nonce, { by: "you", why: "You chose to let Windows free up space by itself." }) });
              await onChanged();
            })}
            onUndo={(force) => run("undo it", async () => {
              if (outcome?.apply.outcome !== "applied" || !client.undoStep) return;
              setOutcome({ ...outcome, undo: await client.undoStep(pc.id, outcome.apply.undo.id, force) });
              await onChanged();
            })}
            onDecline={() => { setOpen(false); setPreview(null); }}
            onSteps={() => { setOpen(false); setSteps(true); }} />
        </li>
      )}
    </>
  );
}
