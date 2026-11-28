// A laptop's battery on its part page: the charge and how long it lasts as
// big figures, then a tab with today's story on battery, how much each recent
// sleep used, and the few changes that would stretch it, each through the
// usual review. Desktops have none.

import { useState } from "react";
import { fixSteps, perHourText, sleepCause, sleepMeta, sleepTitle, sleepWhen, type BatterySaver, type BatteryView, type ChargeOffer, type HelperStep, type PreviewReply, type SleepView, type StepOutcome } from "@rig/core";
import { StepCard } from "../../components/change";
import { Row, Rows } from "../../components/Rows";
import { useActions, useApp, useAppSelector, useMachineWord } from "../../state";

/** The battery's figures for the top of its page: the charge, and the time left or until full. */
export function batteryTiles(b: BatteryView): JSX.Element[] {
  const tiles: JSX.Element[] = [];
  if (b.level != null) {
    const how = b.state === "discharging" && b.watts != null ? `Drawing ${b.watts} W`
      : b.state === "charging" && b.watts != null ? `Charging at ${Math.round(b.watts)} W`
      // The charge is the figure above, so held short of full it says what Windows says, not the number again.
      : b.state === "plugged" ? (b.level < 99 ? "Plugged in, not charging" : b.time?.text) : undefined;
    tiles.push(
      <div key="charge" className="live">
        <span className="label">Charge</span>
        <span key={b.level} className="big live-tick">{b.level}%</span>
        <span className="bar live-load" aria-hidden="true"><i style={{ transform: `translateX(${b.level - 100}%)` }} /></span>
        {how && <span className="faint batt-how">{how}</span>}
      </div>,
    );
  }
  if (b.time?.figure) {
    tiles.push(
      <div key="time" className="live">
        <span className="label">{b.time.label}</span>
        <span className="big">{b.time.figure}</span>
        {b.time.basis && <span className="faint batt-how">{b.time.basis}</span>}
      </div>,
    );
  }
  return tiles;
}

/** The Battery life tab: what drained it today, and ways to make it last longer. */
export function BatteryLife({ battery }: { battery: BatteryView }) {
  const story = [battery.story, battery.time?.note && `${battery.time.note}.`].filter(Boolean).join(" ");
  const offer = battery.charge?.offer;
  return (
    <div className="batt">
      {(story || battery.charge) && (
        <div className="batt-top">
          {story && <p className="batt-story">{story}</p>}
          {battery.charge && <p className="batt-cap">{battery.charge.line}.</p>}
        </div>
      )}
      {battery.sleeps?.length ? <Sleeps sleeps={battery.sleeps} /> : null}
      <section className="batt-savers" aria-labelledby="batt-savers-h">
        <h3 id="batt-savers-h" className="label">Make it last longer</h3>
        {battery.savers.length || offer ? (
          <Rows label="Ways to make the battery last longer">
            {battery.savers.map((s) => <Saver key={s.id} saver={s} />)}
            {offer && <ChargeRow offer={offer} />}
          </Rows>
        ) : <p className="muted batt-none">Nothing to change. The settings Rig can change already go easy on the battery.</p>}
        {(battery.savers.length > 0 || offer?.op) && <p className="faint batt-foot">{offer && !offer.op ? `Each one you review can be undone from Changes.` : "Each one can be undone from Changes."}</p>}
      </section>
    </div>
  );
}

function Saver({ saver }: { saver: BatterySaver }) {
  const { review } = useActions();
  const [reading, setReading] = useState(false);
  const open = () => { setReading(true); void review(fixSteps(saver.fix), { by: "you", why: saver.title }).finally(() => setReading(false)); };
  return (
    <Row name={saver.title} title={saver.title} meta={saver.meta}
      action={<button className="btn ghost sm" type="button" aria-label={`Review: ${saver.title}`} disabled={reading} onClick={open}>{reading ? "Reading settings…" : "Review"}</button>} />
  );
}

/**
 * Stopping charging short of full, for a laptop that sits on the charger at 100%. On a Dell or HP where Rig may, Review
 * opens the firmware step's own card under the row: read first, approved at Windows' prompt, undone from there or from
 * Changes. Anywhere else the maker's own app sets it, and the row asks about it instead.
 */
function ChargeRow({ offer }: { offer: ChargeOffer }) {
  const { ask } = useApp();
  if (!offer.op) {
    return (
      <Row name={offer.title} title={offer.title} meta={offer.meta}
        action={<button className="btn ghost sm" type="button" aria-label={`Ask about it: ${offer.title}`} onClick={() => ask(offer.ask)}>Ask about it</button>} />
    );
  }
  return <ChargeStep offer={offer} step={{ kind: "native", op: offer.op }} />;
}

function ChargeStep({ offer, step }: { offer: ChargeOffer; step: HelperStep }) {
  const { client, toast, ask, refreshChanges } = useActions();
  const pc = useAppSelector((c) => ({ id: c.pc.id, name: c.pc.name }));
  const word = useMachineWord();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewReply | null>(null);
  const [outcome, setOutcome] = useState<StepOutcome | null>(null);
  const run = async (what: string, f: () => Promise<void>) => {
    try { await f(); } catch (e) { toast(`Rig couldn't ${what}, so nothing changed. ${e instanceof Error ? e.message : ""}`.replace(/\s+/g, " ").trim()); }
  };
  const read = () => run("read the setting", async () => {
    if (!client.previewStep) return;
    setOutcome(null);
    setPreview(await client.previewStep(pc.id, step, false));
  });
  const review = () => {
    if (!client.caps.applyChanges || !client.previewStep || !client.applyStep) { toast(`Changes can only be made in the Rig app on ${pc.name}.`); return; }
    setOpen(true);
    void read();
  };
  return (
    <>
      <Row name={offer.title} title={offer.title} meta={offer.meta}
        action={!open && <button className="btn ghost sm" type="button" aria-label={`Review: ${offer.title}`} onClick={review}>Review</button>} />
      {open && (
        <li className="batt-card">
          <StepCard step={step} byPerson preview={preview} outcome={outcome} pcName={pc.name} word={word} canApply={client.caps.applyChanges}
            onRead={read}
            onApply={() => run("set the charge limit", async () => {
              if (preview?.outcome !== "ready" || !client.applyStep) return;
              const apply = await client.applyStep(pc.id, preview.nonce, { title: offer.title, by: "you", why: "You chose to stop charging short of full, since it's plugged in at 100% most of the time." });
              setOutcome({ apply });
              // Once it's set, the offer leaves the list, so the toast says what happened and where it's undone.
              if (apply.outcome === "applied") toast("Charge limit set. It applies at the next restart, and you can undo it from Changes.");
              await refreshChanges();
            })}
            onUndo={(force) => run("undo it", async () => {
              if (outcome?.apply.outcome !== "applied" || !client.undoStep) return;
              setOutcome({ ...outcome, undo: await client.undoStep(pc.id, outcome.apply.undo.id, force) });
              await refreshChanges();
            })}
            onDecline={() => { setOpen(false); setPreview(null); setOutcome(null); }}
            onSteps={() => { setOpen(false); ask(offer.ask); }} />
        </li>
      )}
    </>
  );
}

/** The last week's sleeps on battery, newest first: how long, how much each used, and for one that used a lot, what woke it. */
function Sleeps({ sleeps }: { sleeps: SleepView[] }) {
  const now = Date.now();
  return (
    <section className="batt-sleeps" aria-labelledby="batt-sleeps-h">
      <h3 id="batt-sleeps-h" className="label">While asleep</h3>
      <Rows label="Recent sleeps on battery" timeline>
        {sleeps.map((s) => <SleepRow key={s.from} sleep={s} now={now} />)}
      </Rows>
    </section>
  );
}

function SleepRow({ sleep: s, now }: { sleep: SleepView; now: number }) {
  const { ask } = useApp();
  const word = useMachineWord();
  const when = sleepWhen(s, now);
  const title = sleepTitle(s);
  const cause = s.heavy ? sleepCause(s, word) : null;
  return (
    <Row name={`${when}, ${title}`} time={when} at={new Date(s.from).toISOString()} mark={s.heavy ? "look" : "dot"}
      title={title} tag={s.heavy && <span className="chip warn">Used a lot</span>} meta={sleepMeta(s)}
      details={s.heavy ? (
        <>
          <p>That's {perHourText(s.perHour)}, where under 1% is usual.{cause ? ` ${cause.what}` : ""}</p>
          {cause && <p className="muted">{cause.next}</p>}
          {cause && <button className="btn ghost sm batt-ask" type="button" onClick={() => ask(cause.ask)}>Ask about it</button>}
        </>
      ) : undefined} />
  );
}
