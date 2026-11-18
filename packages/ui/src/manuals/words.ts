import { kindLabel, manualTargets, type DiagramKind, type Manual, type ManualDiagram, type PC, type PartTarget } from "@rig/core";
import type { Job, ManualsState } from "./useManuals";

export const jobText = (j: Job): string =>
  j.step === "finding" ? "Looking on the maker's site…"
  : j.step === "downloading" ? "Downloading the PDF…"
  : j.step === "reading" ? (j.total ? `Reading page ${j.done} of ${j.total}` : "Opening the PDF…")
  : j.step === "saving" ? "Saving what Rig read…"
  : j.step === "notfound" ? "Couldn't find it"
  : j.message;

export const busy = (j: Job | undefined) => !!j && j.step !== "notfound" && j.step !== "error";

export const chipText = (d: ManualDiagram) => `${d.label} · p. ${d.page}`;

export const pagesText = (m: Manual) => (m.pageCount ? `${m.pageCount} ${m.pageCount === 1 ? "page" : "pages"}` : "Not read yet");

/** The part a manual belongs to, as a target to look it up again. */
export const targetOf = (m: Manual): PartTarget => ({ part: m.part, kind: m.kind, maker: m.maker, model: m.model, source: m.part.startsWith("extra:") ? "added" : "detected", askModel: m.kind === "gpu" || undefined });

export interface Row { target: PartTarget; manual?: Manual; job?: Job }

/** One row per part: the detected parts first, then the parts the person named, each with its newest manual. */
export function manualRows(pc: PC, s: Pick<ManualsState, "manuals" | "jobs" | "extras">): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const push = (target: PartTarget) => {
    if (seen.has(target.part)) return;
    seen.add(target.part);
    rows.push({ target, manual: s.manuals?.find((m) => m.part === target.part), job: s.jobs[target.part] });
  };
  manualTargets(pc).forEach(push);
  (s.manuals ?? []).forEach((m) => push(targetOf(m)));
  s.extras.forEach(push);
  return rows;
}

export const partName = (t: { kind: PartTarget["kind"] }) => kindLabel(t.kind);
export const modelName = (t: { maker: string; model: string }) => (t.model.toLowerCase().startsWith(t.maker.toLowerCase()) ? t.model : `${t.maker} ${t.model}`.trim());

/** Which diagram in the board's manual helps with each part of the PC. */
export const helpsWith: Record<string, DiagramKind[]> = {
  cpu: ["installation", "fan-headers"],
  ram: ["memory-slots"],
  ssd: ["m2-slots"],
  fans: ["fan-headers"],
  psu: ["power-connectors"],
  case: ["front-panel", "usb-headers", "rgb-headers"],
  battery: ["installation", "board-layout"],
  gpu: ["board-layout", "power-connectors"],
};
