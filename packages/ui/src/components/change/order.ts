import type { Proposal, StepOutcome } from "@rig/core";

type Steps = Pick<Proposal, "steps" | "status"> & { outcomes?: (StepOutcome | null | undefined)[] };

const done = (p: Steps, j: number) => {
  if (p.steps[j].kind === "fix") return p.status === "applied";
  const o = p.outcomes?.[j];
  return o?.apply.outcome === "applied" && o.undo?.outcome !== "undone";
};

/** Steps run in order. The earlier step this one waits for, or null when it can run. `failed` means that step ran and was put back, so this one won't run. */
export function waitingOn(p: Steps, index: number): { index: number; failed: boolean } | null {
  for (let j = 0; j < index; j++) {
    if (done(p, j)) continue;
    const o = p.outcomes?.[j];
    return { index: j, failed: o?.apply.outcome === "rolledBack" || o?.undo?.outcome === "undone" };
  }
  return null;
}

/** How many of a proposal's steps are applied and not undone. */
export const appliedCount = (p: Steps) => p.steps.filter((_, j) => done(p, j)).length;

/** A preview the helper will no longer take, judged by its own expiry time. */
export const stale = (expiresAt: string, now = Date.now()) => !(Date.parse(expiresAt) > now);
