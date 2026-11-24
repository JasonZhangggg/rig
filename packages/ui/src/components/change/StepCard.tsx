import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { checkStep, type Allowed, type Command, type PreviewReply, type Refused, type StepOutcome } from "@rig/core";
import { ClaudeSays, CommandList, Fact, Glance, Printed, Scripts } from "./parts";
import { ResultView } from "./Result";
import { headline, redKind, redReasons, redWords, runCommands, undoPlan } from "./words";

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
  /** Asks the helper to read the current settings and check the step, when there's no preview yet or it got too old to run. */
  onRead: () => Promise<void> | void;
  onApply: () => Promise<void> | void;
  onUndo: () => Promise<void> | void;
  onDecline: () => void;
  /** The person asked for steps to do it themselves. */
  onSteps: () => void;
}

type Ready = Extract<PreviewReply, { outcome: "ready" }>;

function useBusy(): [boolean, (f: () => Promise<void> | void) => void] {
  const [busy, setBusy] = useState(false);
  return [busy, (f) => { setBusy(true); void (async () => f())().catch(() => {}).finally(() => setBusy(false)); }];
}

function Frame({ tone, title, chips, place, lead, children }: { tone: "t2" | "t3" | "refused" | "plain"; title: string; chips: ReactNode; place?: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className={`proposal step-card ${tone}`} aria-label={title}>
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

interface TierProps extends StepCardProps { verdict: Allowed; ready?: Ready; expired: boolean }

const admin = (v: Allowed) => (v.admin ? " Needs admin, so Windows asks first." : "");

/** What Rig read and checked about one command: the glance, Claude's sentence, what `read` printed and the commands it found. */
function Body({ cmd, verdict, ready, tainted, expired, risk, undo, noUndo }: TierProps & { risk: string; undo: string; noUndo: boolean }) {
  const runs = runCommands(cmd, verdict.commands);
  return (
    <>
      <Glance touches={cmd.touches.map((touch, i) => ({ touch, now: ready ? ready.touches[i]?.value ?? null : undefined }))} risk={`${risk}${admin(verdict)}`} undo={undo} noUndo={noUndo} />
      {tainted && <OutsideText />}
      <div className="cc-facts">
        <ClaudeSays text={cmd.does} />
        {ready && <Fact label="Now" note="read by Rig"><Printed text={ready.read} label="Now" /></Fact>}
        {runs.length > 0 && <Fact label="What it runs" note="found by Rig"><CommandList commands={runs} /></Fact>}
        {expired && <p className="cc-note" role="status">This waited too long to run, so Rig needs to read the settings again. Nothing changed.</p>}
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
  useEffect(() => {
    if (!reviewing) { setArmed(false); return; }
    foot.current?.focus({ preventScroll: true });
    const t = setTimeout(() => setArmed(true), 500);
    return () => clearTimeout(t);
  }, [reviewing]);
  const plan = undoPlan(p.cmd);
  return (
    <Frame tone="t2" title={headline(p.cmd, p.verdict.commands)} place={p.place} chips={<span className="chip warn">Check before you apply</span>}>
      <Body {...p} risk="Medium." undo={plan.line} noUndo={plan.kind === "none"} />
      <Scripts cmd={p.cmd} open={reviewing} />
      {!p.canApply ? <ElsewhereFoot pcName={p.pcName} /> : reviewing && p.ready ? (
        <div className="proposal-foot" ref={foot} tabIndex={-1} role="group" aria-label="Apply this change?">
          <span className="faint">These scripts are exactly what runs on {p.pcName}.</span>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setReviewing(false)}>Back</button>
          <button className="btn primary sm" type="button" disabled={!armed || busy} onClick={() => run(p.onApply)}>{busy ? "Applying…" : "Apply"}</button>
        </div>
      ) : (
        <div className="proposal-foot">
          <span className="faint">Nothing changes until you apply.</span>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={p.onDecline}>Not now</button>
          {p.ready ? <button className="btn primary sm" type="button" onClick={() => setReviewing(true)}>Review</button> : <ReadFirst busy={busy} again={p.expired} onRead={() => run(p.onRead)} />}
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
  const words = redWords(redKind(p.cmd, p.verdict));
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
      <Body {...p} risk="High. Read it slowly." undo={words.back} noUndo={words.word === "permanent"} />
      <Scripts cmd={p.cmd} />
      {!p.canApply ? <ElsewhereFoot pcName={p.pcName} /> : p.ready ? (
        <>
          <div className="cc-confirm">
            <label htmlFor={id}>Type <b>{words.word}</b> to turn on Apply.</label>
            <input id={id} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy} />
          </div>
          <div className="proposal-foot">
            <span className="faint">Nothing changes until you apply.</span>
            <button className="btn ghost sm" type="button" disabled={busy} onClick={p.onDecline}>Not now</button>
            <button className="btn danger sm" type="button" disabled={!ok || busy} onClick={() => run(p.onApply)}>{busy ? "Applying…" : "Apply"}</button>
          </div>
        </>
      ) : (
        <div className="proposal-foot">
          <span className="faint">Nothing changes until you apply.</span>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={p.onDecline}>Not now</button>
          <ReadFirst busy={busy} again={p.expired} onRead={() => run(p.onRead)} />
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

function DoneCard(p: StepCardProps & { outcome: StepOutcome }) {
  const [busy, run] = useBusy();
  const commands = p.preview?.verdict.commands ?? [];
  return (
    <Frame tone="plain" title={headline(p.cmd, commands)} place={p.place} chips={resultChip(p.outcome)}>
      <div className="cc-facts">
        <ClaudeSays text={p.cmd.does} />
        <ResultView cmd={p.cmd} outcome={p.outcome} pcName={p.pcName} canApply={p.canApply} busy={busy} onUndo={() => run(p.onUndo)} />
      </div>
      <Scripts cmd={p.cmd} />
    </Frame>
  );
}

/** One command step: the card for its tier, a refusal, or what happened after Apply. */
export function StepCard(p: StepCardProps) {
  const expired = p.outcome?.apply.outcome === "expired";
  if (p.outcome && !expired) return <DoneCard {...p} outcome={p.outcome} />;
  const verdict = p.preview?.verdict ?? checkStep({ kind: "command", cmd: p.cmd }, { tainted: !!p.tainted });
  if (verdict.status === "refused") return <RefusedCard cmd={p.cmd} verdict={verdict} place={p.place} onSteps={p.onSteps} />;
  if (p.declined) {
    return (
      <Frame tone="plain" title={headline(p.cmd, verdict.commands)} place={p.place} chips={<span className="chip">Not now</span>}>
        <div className="cc-facts"><ClaudeSays text={p.cmd.does} /><p className="cc-note">Nothing changed on {p.pcName}.</p></div>
        <Scripts cmd={p.cmd} />
      </Frame>
    );
  }
  const ready = !expired && p.preview?.outcome === "ready" ? p.preview : undefined;
  const Card = verdict.tier === 3 ? RedCard : AmberCard;
  return <Card {...p} verdict={verdict} ready={ready} expired={expired} />;
}
