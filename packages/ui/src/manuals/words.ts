import { kindLabel, manualTargets, type DiagramKind, type Manual, type ManualDiagram, type PartTarget, type StillPC } from "@rig/core";
import type { Job, ManualsState } from "./useManuals";

export const jobText = (j: Job): string =>
  j.step === "finding" ? "Looking on the maker's site…"
  : j.step === "downloading" ? "Downloading the PDF…"
  : j.step === "reading" ? (j.total ? `Reading page ${j.done} of ${j.total}` : "Opening the PDF…")
  : j.step === "saving" ? "Saving what Rig read…"
  : j.step === "notfound" ? "Couldn't find it"
  : j.message;

export const busy = (j: Job | undefined) => !!j && j.step !== "notfound" && j.step !== "error";

/** A section of a manual worth jumping to: what it shows and the pages it's on. */
export interface Jump { kind: DiagramKind; label: string; pages: number[] }

/** Sections in the order someone building or fixing a PC reaches for them, in three groups. */
export const jumpGroups: [string, DiagramKind[]][] = [
  ["Plugging things in", ["front-panel", "fan-headers", "power-connectors", "usb-headers", "rgb-headers"]],
  ["Fitting parts", ["memory-slots", "m2-slots", "installation"]],
  ["About the board", ["board-layout", "rear-io", "specs", "dimensions"]],
];

/** What most people open a manual for, first. */
const keyOrder: DiagramKind[] = ["board-layout", "front-panel", "fan-headers", "memory-slots", "power-connectors", "m2-slots", "usb-headers", "rgb-headers", "installation", "rear-io", "specs", "dimensions"];

/** Each section once: diagrams with the same name are one section with all its pages. */
export function manualJumps(diagrams: ManualDiagram[]): Jump[] {
  const out: Jump[] = [];
  for (const d of diagrams) {
    const same = out.find((j) => j.kind === d.kind && j.label.toLowerCase() === d.label.toLowerCase());
    if (same) { if (!same.pages.includes(d.page)) same.pages.push(d.page); }
    else out.push({ kind: d.kind, label: d.label, pages: [d.page] });
  }
  out.forEach((j) => j.pages.sort((a, b) => a - b));
  return out;
}

/** The few sections to show before "All sections": the ones this part needs first, then the usual ones. */
export function keyJumps(jumps: Jump[], prefer: DiagramKind[] = [], count = 4): Jump[] {
  const rank = (k: DiagramKind) => { const p = prefer.indexOf(k); return p >= 0 ? p : prefer.length + keyOrder.indexOf(k); };
  return [...jumps].sort((a, b) => rank(a.kind) - rank(b.kind) || a.pages[0] - b.pages[0]).slice(0, count);
}

/** Every section under its group, in page order within the group. */
export function groupedJumps(jumps: Jump[]): [string, Jump[]][] {
  return jumpGroups
    .map(([name, kinds]): [string, Jump[]] => [name, jumps.filter((j) => kinds.includes(j.kind)).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.pages[0] - b.pages[0])])
    .filter(([, list]) => list.length > 0);
}

/** "p. 12", or "p. 8, 13" when a section is on more than one page. */
export const jumpPages = (j: Jump) => `p. ${j.pages.join(", ")}`;

export const pagesText = (m: Manual) => (m.pageCount ? `${m.pageCount} ${m.pageCount === 1 ? "page" : "pages"}` : "Not read yet");

/** The part a manual belongs to, as a target to look it up again. */
export const targetOf = (m: Manual): PartTarget => ({ part: m.part, kind: m.kind, maker: m.maker, model: m.model, source: m.part.startsWith("extra:") ? "added" : "detected", askModel: m.kind === "gpu" || undefined });

export interface Row { target: PartTarget; manual?: Manual; job?: Job }

/** One row per part: the detected parts first, then the parts the person named, each with its newest manual. */
export function manualRows(pc: StillPC, s: Pick<ManualsState, "manuals" | "jobs" | "extras">): Row[] {
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
