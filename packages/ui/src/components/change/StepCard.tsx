import { useId, useState, type ReactNode } from "react";
import type { Allowed, Command, PreviewReply, Refused, StepOutcome } from "@rig/core";
import { ClaudeSays, CommandList, Fact, Printed, Scripts, TouchList } from "./parts";
import { ResultView } from "./Result";
import { CONFIRM_WORD, headline, undoPlan } from "./words";

export interface StepCardProps {
  cmd: Command;
  /** What the helper read and checked. Missing while Rig is still reading. */
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

function Frame({ tone, title, chips, place, children }: { tone: "t2" | "t3" | "refused" | "plain"; title: string; chips: ReactNode; place?: string; children: ReactNode }) {
  return (
    <section className={`proposal step-card ${tone}`} aria-label={title}>
      <div className="proposal-head">
        <h3>{title}</h3>
        <span className="cc-chips">{place && <span className="faint cc-place">{place}</span>}{chips}</span>
      </div>
      {children}
    </section>
  );
}

const OutsideText = () => (
  <p className="cc-note cc-outside">Rig suggested this after reading text from outside this PC, like a web page or a manual. Check that it's what you asked for.</p>
);

const ElsewhereFoot = ({ pcName }: { pcName: string }) => (
  <div className="proposal-foot"><span className="faint">Changes are made in the Rig app on {pcName}. Open Rig there to apply this.</span></div>
);

/** Everything Rig read and checked about one command, under Claude's sentence. */
export function StepFacts({ cmd, preview, pcName }: { cmd: Command; preview: Ready; pcName: string }) {
  const plan = undoPlan(cmd);
  return (
    <div className="cc-facts">
      <ClaudeSays text={cmd.does} />
      <Fact label="Now" note={`read by Rig on ${pcName}`}><Printed text={preview.read} label="Now" /></Fact>
      <Fact label="What it runs" note="found by Rig's checker"><CommandList commands={preview.verdict.commands} /></Fact>
      <Fact label="What it changes" note="current values read by Rig"><TouchList rows={preview.touches.map((t) => ({ touch: t.touch, now: t.value }))} /></Fact>
      <p className={`cc-undo-line ${plan.kind}`}>{plan.line}</p>
      {preview.verdict.admin && <p className="cc-note">This runs as admin, so Windows will ask for permission when you apply.</p>}
    </div>
  );
}

const chipFor = (v: Allowed) => (
  <>
    {v.admin && <span className="chip no-dot">Admin</span>}
    {v.tier === 3 ? <span className="chip tier-red">Can't be undone</span> : <span className="chip tier-amber">Check before you apply</span>}
  </>
);

/** Tier 2: look, then Review, then Apply. */
function AmberCard(p: StepCardProps & { preview: Ready }) {
  const [reviewing, setReviewing] = useState(false);
  const [busy, run] = useBusy();
  return (
    <Frame tone="t2" title={headline(p.cmd, p.preview.verdict.commands)} place={p.place} chips={chipFor(p.preview.verdict)}>
      {p.tainted && <OutsideText />}
      <StepFacts cmd={p.cmd} preview={p.preview} pcName={p.pcName} />
      <Scripts cmd={p.cmd} open={reviewing} />
      {!p.canApply ? <ElsewhereFoot pcName={p.pcName} /> : reviewing ? (
        <div className="proposal-foot">
          <span className="faint">These scripts are exactly what runs on {p.pcName}.</span>
          <button className="btn ghost sm" type="button" disabled={busy} onClick={() => setReviewing(false)}>Back</button>
          <button className="btn primary sm" type="button" disabled={busy} onClick={() => run(p.onApply)}>{busy ? "Applying…" : "Apply"}</button>
        </div>
      ) : (
        <div className="proposal-foot">
          <span className="faint">Nothing changes until you apply.</span>
          <button className="btn ghost sm" type="button" onClick={p.onDecline}>Not now</button>
          <button className="btn primary sm" type="button" onClick={() => setReviewing(true)}>Review</button>
        </div>
      )}
    </Frame>
  );
}

/** Tier 3: what can't be undone comes first, and Apply works only once the word is typed. */
function RedCard(p: StepCardProps & { preview: Ready }) {
  const [typed, setTyped] = useState("");
  const [busy, run] = useBusy();
  const id = useId();
  const v = p.preview.verdict;
  const ok = typed.trim().toLowerCase() === CONFIRM_WORD;
  return (
    <Frame tone="t3" title={headline(p.cmd, v.commands)} place={p.place} chips={chipFor(v)}>
      <div className="cc-first" role="note">
        <b>{undoPlan(p.cmd).kind === "none" ? "This can't be undone." : "Rig can't promise to undo this."}</b>
        <ul className="cc-plain">{[...new Set(v.reasons)].map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
      {p.tainted && <OutsideText />}
      <StepFacts cmd={p.cmd} preview={p.preview} pcName={p.pcName} />
      <Scripts cmd={p.cmd} />
      {!p.canApply ? <ElsewhereFoot pcName={p.pcName} /> : (
        <>
          <div className="cc-confirm">
            <label htmlFor={id}>Type <b>{CONFIRM_WORD}</b> to turn on Apply.</label>
            <input id={id} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy} />
          </div>
          <div className="proposal-foot">
            <span className="faint">Nothing changes until you apply.</span>
            <button className="btn ghost sm" type="button" disabled={busy} onClick={p.onDecline}>Not now</button>
            <button className="btn danger sm" type="button" disabled={!ok || busy} onClick={() => run(p.onApply)}>{busy ? "Applying…" : "Apply"}</button>
          </div>
        </>
      )}
    </Frame>
  );
}

/** Rig said no. There is nothing to apply; the person can ask for steps to do it themselves. */
export function RefusedCard({ cmd, verdict, pcName, place, onSteps }: { cmd: Command; verdict: Refused; pcName: string; place?: string; onSteps: () => void }) {
  return (
    <Frame tone="refused" title="Rig won't make this change" place={place} chips={<span className="chip">Nothing changed</span>}>
      <div className="cc-facts">
        <p className="cc-refused">{verdict.refused}</p>
        <p className="cc-note">Nothing changed on {pcName}.</p>
        <ClaudeSays text={cmd.does} />
        {verdict.commands.length > 0 && <Fact label="What it would have run" note="found by Rig's checker"><CommandList commands={verdict.commands} /></Fact>}
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
  if (p.outcome) return <DoneCard {...p} outcome={p.outcome} />;
  if (!p.preview) {
    return (
      <Frame tone="plain" title="Reading the current values" place={p.place} chips={<span className="chip info">One moment</span>}>
        <div className="cc-facts"><ClaudeSays text={p.cmd.does} /><p className="cc-note">Rig is reading {p.pcName}'s current values before it shows this change.</p></div>
        <Scripts cmd={p.cmd} />
      </Frame>
    );
  }
  if (p.preview.outcome === "refused") return <RefusedCard cmd={p.cmd} verdict={p.preview.verdict} pcName={p.pcName} place={p.place} onSteps={p.onSteps} />;
  if (p.declined) {
    return (
      <Frame tone="plain" title={headline(p.cmd, p.preview.verdict.commands)} place={p.place} chips={<span className="chip">Not now</span>}>
        <div className="cc-facts"><ClaudeSays text={p.cmd.does} /><p className="cc-note">Nothing changed on {p.pcName}.</p></div>
        <Scripts cmd={p.cmd} />
      </Frame>
    );
  }
  return p.preview.verdict.tier === 3 ? <RedCard {...p} preview={p.preview} /> : <AmberCard {...p} preview={p.preview} />;
}
