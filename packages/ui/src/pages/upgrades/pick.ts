import type { PC, Upgrade } from "@rig/core";
import type { Room } from "./room";

/** The part a room reading or an issue belongs to, by the upgrade's part name. */
export const roomPart: Record<Room["key"], string> = { ram: "Memory", ssd: "Storage", battery: "Battery" };
const issuePart: Record<string, string> = { cpu: "Cooling", gpu: "Cooling", ram: "Memory", ssd: "Storage", battery: "Battery" };

const gbOf = (s?: string) => {
  const m = s?.match(/([\d.]+)\s*(GB|TB)/i);
  return m ? Number(m[1]) * (m[2].toUpperCase() === "TB" ? 1000 : 1) : null;
};

/** Why an idea matters on this PC now, from what Rig already read. Empty when nothing presses. */
function need(u: Upgrade, pc: PC, room: Room[]): string {
  const flagged = [...(pc.alerts ?? []), ...(pc.issues ?? [])];
  const issue = flagged.find((i) => i.severity !== "ok" && (issuePart[i.part ?? ""] === u.part || (u.part === "Storage" && i.id.startsWith("vol-"))));
  if (issue) return `${issue.title}.`;
  const r = room.find((x) => roomPart[x.key] === u.part);
  // Wanting more room only makes a pick when the part fits as it is.
  if (u.fit !== "fits") return "";
  if (u.part === "Storage" && r?.meter?.kind === "share" && r.meter.value / r.meter.of >= 0.75) return `${pc.name} has ${r.figure} free and is filling up.`;
  if (u.part === "Battery") return `${u.detail} Most people replace it around this point.`;
  const ram = gbOf(pc.parts?.ram?.specs.find(([k]) => k === "Total")?.[1]);
  if (u.part === "Memory" && ram != null && ram < 32) return `${pc.name} has ${ram} GB, and newer games and heavy multitasking like more.`;
  return "";
}

export interface Pick { idea: Upgrade; why: string; pressing: boolean }

/** The idea Rig would start with: one that answers something it read on the PC, then one that fits as it is. */
export function bestPick(list: Upgrade[], pc: PC, room: Room[]): Pick | null {
  const scored = list
    .filter((u) => u.fit === "fits" || u.fit === "check")
    .map((u, i) => {
      const why = need(u, pc, room);
      // Memory with no need behind it is only worth it for big projects, so it goes last.
      const score = (why ? 4 : 0) + (u.fit === "fits" ? 2 : 1) - (u.part === "Memory" && !why ? 2 : 0);
      return { u, why, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const top = scored[0];
  if (!top) return null;
  const gain = top.u.gain ? `${top.u.gain[0].toLowerCase()}${top.u.gain.slice(1)}` : "";
  return {
    idea: top.u,
    pressing: !!top.why,
    why: top.why || `Nothing on ${pc.name} needs upgrading right now. If you want one thing, start here${gain ? `: ${gain}` : ""}.`,
  };
}
