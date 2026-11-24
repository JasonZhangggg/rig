import type { PreviewReply, Proposal, StepOutcome } from "@rig/core";
import { FixCard } from "./FixCard";
import { waitingOn } from "./order";
import { StepCard } from "./StepCard";

/** `read` has the helper read the current settings and check the step; the card shows its preview. */
export type CommandAct = "read" | "apply" | "undo";

export interface ChangeCardsProps {
  proposal: Proposal;
  /** The helper's preview of each step, by the step's place in `proposal.steps`. Fix steps have none. */
  previews?: (PreviewReply | null | undefined)[];
  /** What happened to each command step once it was applied. */
  outcomes?: (StepOutcome | null | undefined)[];
  pcName: string;
  /** False on the website, where changes can't be made. */
  canApply: boolean;
  tainted?: boolean;
  /** Opens the review sheet for the proposal's catalog fixes. */
  onReviewFixes: () => Promise<void> | void;
  onDecline: () => void;
  /** The one way a command step is read, applied or undone. */
  onCommandStep: (index: number, act: CommandAct) => Promise<void> | void;
  /** The person asked for steps to do a refused change themselves. */
  onSteps: (index: number) => void;
}

/** The cards for one proposal: Rig's own fixes as rows, and each command step as its own card for its tier. Each card is keyed by its preview, so a fresh read starts it over. Steps run in order. */
export function ChangeCards({ proposal: p, previews = [], outcomes = [], pcName, canApply, tainted, onReviewFixes, onDecline, onCommandStep, onSteps }: ChangeCardsProps) {
  const fixes = p.steps.filter((s) => s.kind === "fix").length;
  const fixCard = fixes > 0 && <FixCard title={p.title} rows={p.rows} count={fixes} status={p.status} onReview={onReviewFixes} onDecline={onDecline} />;
  if (fixes === p.steps.length) return fixCard || null;
  const commands = p.steps.length - fixes;
  const places = p.steps.map((_, i) => (commands > 1 ? `${p.steps.slice(0, i + 1).filter((s) => s.kind === "command").length} of ${commands}` : undefined));
  const waits = (i: number) => {
    const w = waitingOn({ ...p, outcomes }, i);
    return w && { label: p.steps[w.index].kind === "fix" ? "Rig's fixes above" : places[w.index] ?? "the step before", failed: w.failed };
  };
  const nonce = (i: number) => { const v = previews[i]; return v?.outcome === "ready" ? v.nonce : v ? "refused" : "none"; };
  return (
    <div className="step-cards">
      {fixCard}
      {p.steps.map((s, i) => s.kind === "command" && (
        <StepCard key={`${i}|${nonce(i)}`} cmd={s.cmd} preview={previews[i]} outcome={outcomes[i]} pcName={pcName} canApply={canApply} tainted={tainted}
          declined={p.status === "declined"} place={places[i]} waitsFor={waits(i) ?? undefined}
          onRead={() => onCommandStep(i, "read")} onApply={() => onCommandStep(i, "apply")} onUndo={() => onCommandStep(i, "undo")} onDecline={onDecline} onSteps={() => onSteps(i)} />
      ))}
    </div>
  );
}
