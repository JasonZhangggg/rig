// Upgrade ideas worked out from the parts list. No prices yet: those need a
// shop feed, and a made-up price is worse than none.

import type { Upgrade } from "./model";
import type { Inventory } from "./telemetry";

export function suggestUpgrades(inv: Inventory): Upgrade[] {
  const out: Upgrade[] = [];
  const laptop = inv.machine.kind === "laptop";
  const m = inv.memory;
  const gb = (mb: number) => Math.round(mb / 1024);

  // Memory
  if (m.slotsTotal && m.modules.length < m.slotsTotal) {
    const first = m.modules[0];
    const free = m.slotsTotal - m.modules.length;
    out.push({
      part: "Memory", fit: "fits",
      title: `Add ${free} × ${gb(first?.capacityMb ?? 8192)} GB${first?.speedMhz ? ` at ${first.speedMhz} MT/s` : ""}`,
      detail: `${free} of ${m.slotsTotal} slots are free.${first?.partNumber ? ` Matching your current kit (${first.partNumber}) keeps it stable.` : ""}`,
      gain: gb(m.totalMb) < 32 ? "Helps with heavy multitasking and newer games" : "Only worth it for big projects or virtual machines",
      price: "",
    });
  } else if (laptop && m.modules.length <= 1) {
    out.push({ part: "Memory", fit: "check", title: "Memory may be soldered", detail: "Most thin laptops have memory built into the board. Rig will check your model's service guide.", gain: "", price: "" });
  }

  // Storage
  const total = inv.volumes.reduce((n, v) => n + v.sizeGb, 0);
  const free = inv.volumes.reduce((n, v) => n + v.freeGb, 0);
  if (total > 0) {
    const freePct = free / total;
    out.push({
      part: "Storage", fit: laptop ? "check" : "fits",
      title: laptop ? "Swap to a bigger NVMe SSD" : "Add another NVMe SSD",
      detail: laptop ? "Most laptops have one M.2 slot, so this is a swap. Back up first; Rig can walk you through cloning." : "Check your board's manual for a free M.2 slot. Rig can look it up for you.",
      gain: freePct < 0.25 ? `Only ${Math.round(free)} GB free now` : "More room for games and files",
      price: "",
    });
  }

  // Battery
  const b = inv.battery;
  if (b?.designWh && b.fullWh) {
    const wear = Math.round((b.fullWh / b.designWh) * 100);
    out.push(wear < 75
      ? { part: "Battery", fit: "fits", title: "Replace the battery", detail: `It holds ${wear}% of its original charge.`, gain: "Back to full battery life", price: "" }
      : { part: "Battery", fit: "later", title: "Battery replacement", detail: `At ${wear}% there's no need yet. Most people replace it around 70 to 75%.`, gain: "", price: "" });
  }

  // Cooling for towers with a warm GPU is suggested by the health check, not here.
  if (!laptop) out.push({ part: "Cooling", fit: "check", title: "Another case fan", detail: "More intake usually cools the graphics card by a few degrees. Rig can check your case for a free mount and your board for a free fan header.", gain: "A few degrees cooler while gaming", price: "" });

  return out;
}
