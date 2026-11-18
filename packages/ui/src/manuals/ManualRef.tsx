import type { DiagramKind } from "@rig/core";
import { useManuals } from "./useManuals";
import { openManual } from "./viewer";

const forPart: Record<string, DiagramKind> = { Memory: "memory-slots", Storage: "m2-slots" };

/** A link to the board's manual page about an upgrade, like "Memory slot order in your manual, p. 7". */
export function ManualRef({ part }: { part: string }) {
  const { manuals } = useManuals();
  const kind = forPart[part];
  if (!kind) return null;
  for (const m of manuals ?? []) {
    if (m.part !== "motherboard" && m.part !== "chassis") continue;
    const d = m.diagrams.find((x) => x.kind === kind);
    if (d) return <button type="button" className="linkish mn-ref" onClick={() => openManual(m.id, d.page)}>{d.label} in your manual, p. {d.page}</button>;
  }
  return null;
}
