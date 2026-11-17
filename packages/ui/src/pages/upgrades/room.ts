import type { PC } from "@rig/core";

/** How much room a part has left, read from what Rig found in the PC. */
export interface Room {
  key: "ram" | "ssd" | "battery";
  label: string;
  /** The part as Rig found it, like "2 × 16 GB Corsair". */
  part: string;
  figure: string;
  unit: string;
  note: string;
  /** Slots draw as one block each; a share draws as a bar. */
  meter?: { kind: "slots"; used: number; total: number } | { kind: "share"; value: number; of: number };
}

const spec = (pc: PC, part: string, name: string) => pc.parts?.[part]?.specs.find(([k]) => k === name)?.[1];
const size = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${Math.round(gb)} GB`);

export function roomIn(pc: PC): Room[] {
  const out: Room[] = [];

  const ram = pc.parts?.ram;
  if (ram) {
    const slots = spec(pc, "ram", "Slots used")?.match(/(\d+) of (\d+)/);
    const total = spec(pc, "ram", "Total");
    const speed = spec(pc, "ram", "Speed");
    const kit = [total, speed && `at ${speed}`].filter(Boolean).join(" ");
    if (slots) {
      const used = Number(slots[1]), all = Number(slots[2]), free = all - used;
      out.push({ key: "ram", label: "Memory", part: ram.name, figure: String(free), unit: free === 1 ? "slot free" : "slots free", note: `${used} of ${all} used${kit ? `, ${kit}` : ""}.`, meter: { kind: "slots", used, total: all } });
    } else if (total) {
      out.push({ key: "ram", label: "Memory", part: ram.name, figure: total, unit: "in all", note: "Rig couldn't read how many slots the board has." });
    }
  }

  const st = pc.storage;
  if (st && st.totalGb > 0) {
    const free = st.slices.find((s) => s.label === "Free")?.gb ?? 0;
    out.push({ key: "ssd", label: "Storage", part: pc.parts?.ssd?.name ?? "Your drives", figure: size(free), unit: "free", note: `${size(st.totalGb - free)} of ${size(st.totalGb)} used.`, meter: { kind: "share", value: st.totalGb - free, of: st.totalGb } });
  }

  const charge = spec(pc, "battery", "Capacity now")?.match(/(\d+)%/);
  if (pc.parts?.battery && charge) {
    const pct = Number(charge[1]);
    out.push({ key: "battery", label: "Battery", part: pc.parts.battery.name, figure: `${pct}%`, unit: "of original capacity", note: pct < 75 ? "Most people replace it around 70 to 75%." : "No need to replace it yet.", meter: { kind: "share", value: pct, of: 100 } });
  }

  return out;
}
