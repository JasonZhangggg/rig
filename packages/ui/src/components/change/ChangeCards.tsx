import type { PreviewReply, Proposal, StepOutcome } from "@rig/core";
import { FixCard } from "./FixCard";
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

/** The cards for one proposal: Rig's own fixes as rows, and each command step as its own card for its tier. */
export function ChangeCards({ proposal: p, previews = [], outcomes = [], pcName, canApply, tainted, onReviewFixes, onDecline, onCommandStep, onSteps }: ChangeCardsProps) {
  const fixes = p.steps.filter((s) => s.kind === "fix").length;
  const fixCard = fixes > 0 && <FixCard title={p.title} rows={p.rows} count={fixes} status={p.status} onReview={onReviewFixes} onDecline={onDecline} />;
  if (fixes === p.steps.length) return fixCard || null;
  const commands = p.steps.length - fixes;
  let n = 0;
  return (
    <div className="step-cards">
      {fixCard}
      {p.steps.map((s, i) => s.kind === "command" && (
        <StepCard key={i} cmd={s.cmd} preview={previews[i]} outcome={outcomes[i]} pcName={pcName} canApply={canApply} tainted={tainted}
          declined={p.status === "declined"} place={commands > 1 ? `${++n} of ${commands}` : undefined}
          onRead={() => onCommandStep(i, "read")} onApply={() => onCommandStep(i, "apply")} onUndo={() => onCommandStep(i, "undo")} onDecline={onDecline} onSteps={() => onSteps(i)} />
      ))}
    </div>
  );
}
