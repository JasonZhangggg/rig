import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { checkStep, type Allowed, type Command, type FoundCommand, type PreviewReply, type Refused, type StepOutcome, type Touch } from "@rig/core";
import { stale } from "./order";
import { ClaudeSays, CommandList, Fact, Glance, Printed, Scripts, Untied } from "./parts";
import { ResultView } from "./Result";
import { headline, redBack, redKind, redReasons, redWords, riskLine, runCommands, touchName, undoPlan } from "./words";

export interface StepCardProps {
  cmd: Command;
  /** What the helper read and checked. Missing until Rig has read the current settings. */
  preview?: PreviewReply | null;
  /** Set once the person has applied it. */
  outcome?: StepOutcome | null;
  pcName: string;
  /** False on the website, where changes can't be made. */
  canApply: boolean;
  /** Rig read text from outside this PC earlier in the conversation. */
  tainted?: boolean;
  declined?: boolean;
  /** "1 of 2", when the answer has more than one step. */
  place?: string;
  /** The earlier step this one waits for: steps run in order. `failed` means that step was put back, so this one won't run. */
  waitsFor?: { label: string; failed: boolean };
  /** Asks the helper to read the current settings and check the step, when there's no preview yet or it got too old to run. */
  onRead: () => Promise<void> | void;
  onApply: () => Promise<void> | void;
  /** `force` puts it back even though something else changed those places since. */
  onUndo: (force?: boolean) => Promise<void> | void;
  onDecline: () => void;
  /** The person asked for steps to do it themselves. */
  onSteps: () => void;
}

type Ready = Extract<PreviewReply, { outcome: "ready" }>;

function useBusy(): [boolean, (f: () => Promise<void> | void) => void] {
  const [busy, setBusy] = useState(false);
  return [busy, (f) => { setBusy(true); void (async () => f())().catch(() => {}).finally(() => setBusy(false)); }];
}

/** True once the helper's preview has passed its expiry time. The card redraws when it does. */
function useStale(expiresAt?: string): boolean {
  const [, redraw] = useState(0);
  const old = expiresAt ? stale(expiresAt) : false;
  useEffect(() => {
    if (!expiresAt || old) return;
    const t = setTimeout(() => redraw((n) => n + 1), Math.min(Math.max(Date.parse(expiresAt) - Date.now(), 0) + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [expiresAt, old]);
  return old;
}

function Frame({ tone, title, chips, place, lead, focus, children }: { tone: "t2" | "t3" | "refused" | "plain"; title: string; chips: ReactNode; place?: string; lead?: ReactNode; focus?: boolean; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) box.current?.focus({ preventScroll: true }); }, [focus]);
  return (
    <section ref={box} className={`proposal step-card ${tone}`} aria-label={title} tabIndex={focus ? -1 : undefined}>
      {lead}
      <div className="proposal-head">
        <h3>{title}</h3>
        <span className="cc-chips">{place && <span className="faint cc-place">{place}</span>}{chips}</span>
      </div>
      {children}
    </section>
  );
}

const OutsideText = () => (
  <p className="cc-note cc-outside">Rig suggested this after reading outside text, like a web page. Check it's what you asked for.</p>
);

const ElsewhereFoot = ({ pcName }: { pcName: string }) => (
  <div className="proposal-foot"><span className="faint">Changes are made in the Rig app on {pcName}. Open Rig there to apply this.</span></div>
);

function WaitFoot({ waitsFor, onDecline }: { waitsFor: NonNullable<StepCardProps["waitsFor"]>; onDecline: () => void }) {
  return (
    <div className="proposal-foot">
      <span className="faint">{waitsFor.failed ? `${waitsFor.label} didn't go through, so this one won't run.` : `Apply ${waitsFor.label} first.`}</span>
      <button className="btn ghost sm" type="button" onClick={onDecline}>Not now</button>
    </div>
  );
}

interface TierProps extends StepCardProps { verdict: Allowed; ready?: Ready; retry?: string; runs: FoundCommand[] }

const key = (t: Touch) => `${t.kind}|${touchName(t)}`.toLowerCase();

/** What Rig read and checked about one command: the glance, Claude's sentence, what the read script printed and the commands Rig found. */
function Body({ cmd, ready, tainted, retry, runs, pcName, risk, undo, noUndo }: TierProps & { risk: string; undo: ReactNode; noUndo: boolean }) {
  const read = new Map(ready?.touches.map((t) => [key(t.touch), t.value]));
  return (
    <>
      <Glance touches={cmd.touches.map((touch) => ({ touch, now: !ready ? undefined : read.has(key(touch)) ? read.get(key(touch))! : false }))} risk={risk} undo={undo} noUndo={noUndo} />
      {tainted && <OutsideText />}
      <div className="cc-facts">
        <ClaudeSays text={cmd.does} />
        {ready && <Printed label={`The read script printed (on ${pcName})`} text={ready.read} />}
        {runs.length > 0 && <Fact label="What it runs" note="found by Rig"><CommandList commands={runs} /></Fact>}
        {retry && <p className="cc-note" role="status">{retry}</p>}
      </div>
    </>
  );
}

function ReadFirst({ busy, again, onRead }: { busy: boolean; again: boolean; onRead: () => void }) {
  return <button className="btn primary sm" type="button" disabled={busy} onClick={onRead}>{busy ? "Reading settings…" : again ? "Read again" : "Read current settings"}</button>;
}

/** Tier 2: look, then Review, then Apply. Apply wakes up a moment after Review, so a double press can't apply. */
function AmberCard(p: TierProps) {
  const [reviewing, setReviewing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, run] = useBusy();
  const foot = useRef<HTMLDivElement>(null);
  const review = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  useEffect(() => { if (!p.ready) setReviewing(false); }, [p.ready]);
  useEffect(() => {
    if (!reviewing) {
      setArmed(false);
      if (back.current) review.current?.focus();
      back.current = false;
      return;
    }
    foot.current?.focus({ preventScroll: true });
    const t = setTimeout(() => setArmed(true), 500);
    return () => clearTimeout(t);
  }, [reviewing]);
  const plan = undoPlan(p.cmd, p.runs);
  return (
    <Frame tone="t2" title={headline(p.cmd, p.verdict.commands)} place={p.place} chips={<span className="chip warn">Check first</span>}>
      <Body {...p} risk={riskLine(p.runs, p.verdict.admin)} undo={<>{plan.line}<Untied names={plan.untied} /></>} noUndo={plan.kind === "none"} />
      <Scripts cmd={p.cmd} open={reviewing} />
      {!p.canApply ? <ElsewhereFoot pcName={p.pcName} /> : p.waitsFor ? <WaitFoot waitsFor={p.waitsFor} onDecline={p.onDecline} /> : reviewing && p.ready ? (
        <div className="proposal-foot" ref={foot} tabIndex={-1} role="group" aria-label="Apply this change?">
          <span className="faint">These scripts are exactly what runs on {p.pcName}.</span>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => { back.current = true; setReviewing(false); }}>Back</button>
          <button className="btn primary sm" type="button" disabled={!armed || busy} onClick={() => run(p.onApply)}>{busy ? "Applying…" : "Apply"}</button>
        </div>
      ) : (
        <div className="proposal-foot">
          <span className="faint">Nothing changes until you apply.</span>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={p.onDecline}>Not now</button>
          {p.ready ? <button ref={review} className="btn primary sm" type="button" onClick={() => setReviewing(true)}>Review</button> : <ReadFirst busy={busy} again={!!p.retry} onRead={() => run(p.onRead)} />}
        </div>
      )}
    </Frame>
  );
}

/** Tier 3: what can't be undone comes first, and Apply works only once the card's word is typed. */
function RedCard(p: TierProps) {
  const [typed, setTyped] = useState("");
  const [busy, run] = useBusy();
  const id = useId();
  const kind = redKind(p.cmd, p.verdict);
  const words = redWords(kind);
  const plan = undoPlan(p.cmd, p.runs);
  const reasons = redReasons(p.verdict);
  const ok = typed.trim().toLowerCase() === words.word;
  const lead = (
    <div className="cc-first" role="note">
      <b>{words.head}</b>
      {reasons.length > 0 && <ul className="cc-plain">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
    </div>
  );
  return (
    <Frame tone="t3" title={headline(p.cmd, p.verdict.commands)} place={p.place} lead={lead} chips={<span className="chip tier-red">{words.chip}</span>}>
      <Body {...p} risk={`High. Read it slowly.${p.verdict.admin ? " Needs admin, so Windows asks first." : ""}`} undo={<>{redBack(kind, plan)}{kind !== "none" && <Untied names={plan.untied} />}</>} noUndo={words.word === "permanent"} />
      <Scripts cmd={p.cmd} />
      {!p.canApply ? <ElsewhereFoot pcName={p.pcName} /> : p.waitsFor ? <WaitFoot waitsFor={p.waitsFor} onDecline={p.onDecline} /> : p.ready ? (
        <>
          <div className="cc-confirm">
            <label id={`${id}-word`} htmlFor={id}>Type <b>{words.word}</b> to turn on Apply.</label>
            <input id={id} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy} />
          </div>
          <div className="proposal-foot">
            <span className="faint">Nothing changes until you apply.</span>
            <button className="btn ghost sm" type="button" disabled={busy} onClick={p.onDecline}>Not now</button>
            <button className="btn danger sm" type="button" disabled={!ok || busy} aria-describedby={ok ? undefined : `${id}-word`} onClick={() => run(p.onApply)}>{busy ? "Applying…" : "Apply"}</button>
          </div>
        </>
      ) : (
        <div className="proposal-foot">
          <span className="faint">Nothing changes until you apply.</span>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={p.onDecline}>Not now</button>
          <ReadFirst busy={busy} again={!!p.retry} onRead={() => run(p.onRead)} />
        </div>
      )}
    </Frame>
  );
}

/** Rig said no. There is nothing to apply; the person can ask for steps to do it themselves. */
export function RefusedCard({ cmd, verdict, place, onSteps }: { cmd: Command; verdict: Refused; place?: string; onSteps: () => void }) {
  return (
    <Frame tone="refused" title="Rig won't make this change" place={place} chips={<span className="chip">Nothing changed</span>}>
      <div className="cc-facts">
        <p className="cc-refused">{verdict.refused}{verdict.why === "never" && " Rig never makes this change, whoever asks."}</p>
        <ClaudeSays text={cmd.does} />
      </div>
      <Scripts cmd={cmd} />
      <div className="proposal-foot">
        <span className="faint">You can still do this yourself.</span>
        <button className="btn sm" type="button" onClick={onSteps}>Show me the steps</button>
      </div>
    </Frame>
  );
}

function resultChip(o: StepOutcome) {
  const a = o.apply.outcome;
  if (a === "applied") return o.undo?.outcome === "undone" ? <span className="chip">Undone</span> : <span className="chip ok">Applied</span>;
  return <span className="chip">{a === "rolledBack" ? "Put back" : "Nothing changed"}</span>;
}

function DoneCard(p: StepCardProps & { outcome: StepOutcome; focus: boolean }) {
  const [busy, run] = useBusy();
  const commands = p.preview?.verdict.commands ?? [];
  const a = p.outcome.apply.outcome;
  return (
    <Frame tone="plain" title={headline(p.cmd, commands)} place={p.place} chips={resultChip(p.outcome)} focus={p.focus}>
      <div className="cc-facts">
        <ClaudeSays text={p.cmd.does} />
        <ResultView cmd={p.cmd} outcome={p.outcome} runs={runCommands(p.cmd, commands)} pcName={p.pcName} canApply={p.canApply} busy={busy} onUndo={(force) => run(() => p.onUndo(force))} />
      </div>
      <Scripts cmd={p.cmd} />
      {p.canApply && (a === "limit" || a === "declined") && (
        <div className="proposal-foot">
          {a === "declined" && <span className="faint">Nothing changes until you apply.</span>}
          <button className="btn ghost sm" type="button" disabled={busy} onClick={p.onDecline}>Not now</button>
          {a === "declined" && <button className="btn primary sm" type="button" disabled={busy} onClick={() => run(p.onApply)}>{busy ? "Applying…" : "Apply again"}</button>}
        </div>
      )}
    </Frame>
  );
}

const tooOld = "This waited too long to run, so Rig needs to read the settings again. Nothing changed.";

/** One command step: the card for its tier, a refusal, or what happened after Apply. An apply that came back expired or refused goes back to the card, to read again. */
export function StepCard(p: StepCardProps) {
  const pressed = useRef(false);
  const a = p.outcome?.apply;
  const fresh = p.preview?.outcome === "ready" ? p.preview : undefined;
  const old = useStale(fresh?.expiresAt);
  const back = a?.outcome === "expired" || a?.outcome === "refused" || (a?.outcome === "declined" && (!fresh || old));
  const nothingRan = a?.outcome === "limit" || a?.outcome === "declined";
  if (p.outcome && !back && !(p.declined && nothingRan)) return <DoneCard {...p} outcome={p.outcome} focus={pressed.current} />;
  const verdict = p.preview?.verdict ?? checkStep({ kind: "command", cmd: p.cmd }, { tainted: !!p.tainted });
  if (verdict.status === "refused") return <RefusedCard cmd={p.cmd} verdict={verdict} place={p.place} onSteps={p.onSteps} />;
  if (p.declined) {
    return (
      <Frame tone="plain" title={headline(p.cmd, verdict.commands)} place={p.place} chips={<span className="chip">Not now</span>}>
        <div className="cc-facts"><ClaudeSays text={p.cmd.does} /><p className="cc-note">This step didn't run, so it changed nothing on {p.pcName}.</p></div>
        <Scripts cmd={p.cmd} />
      </Frame>
    );
  }
  const ready = back || old ? undefined : fresh;
  const retry = a?.outcome === "refused" ? `Rig didn't run this, so nothing changed. ${a.verdict.refused} Read again to check it fresh.` : back || (fresh && old) ? tooOld : undefined;
  const Card = verdict.tier === 3 ? RedCard : AmberCard;
  return <Card {...p} verdict={verdict} ready={ready} retry={retry} runs={runCommands(p.cmd, verdict.commands)} onApply={() => { pressed.current = true; return p.onApply(); }} />;
}
