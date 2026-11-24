// What fills the demo PCs' drives, as the helper's folder scan would report it.
// Made up, but sized to fit each fixture's volumes.

import type { FillKind, Inventory, StorageScan } from "../telemetry";

type Fill = [FillKind, number, [string, number][]?];

const byLetter: Record<string, Record<string, Fill[]>> = {
  tower: {
    "C:": [
      ["windows", 41],
      ["apps", 168, [["Adobe", 38], ["NVIDIA Corporation", 14], ["Microsoft Office", 9]]],
      ["games", 236, [["Baldur's Gate 3", 148], ["Counter-Strike 2", 61], ["Rocket League", 27]]],
      ["files", 512, [["Videos", 286], ["Downloads", 121], ["Pictures", 64], ["Documents", 23]]],
      ["system", 36],
    ],
    "D:": [
      ["games", 1702, [["Call of Duty", 238], ["Microsoft Flight Simulator", 186], ["Cyberpunk 2077", 78], ["Red Dead Redemption 2", 121], ["Forza Horizon 5", 132]]],
      ["files", 64, [["Backups", 64]]],
    ],
  },
  laptop: {
    "C:": [
      ["windows", 33],
      ["apps", 92, [["Microsoft Office", 9], ["Zoom", 1]]],
      ["games", 21, [["Minecraft", 12], ["Stardew Valley", 2]]],
      ["files", 208, [["Pictures", 96], ["Documents", 54], ["Downloads", 41]]],
      ["system", 22],
    ],
  },
};

/** The demo's folder scan, as if it finished at `at`. */
export function demoScan(inv: Inventory, at: number, running = false): StorageScan {
  const table = byLetter[inv.machine.kind === "laptop" ? "laptop" : "tower"];
  return {
    at,
    running,
    volumes: inv.volumes.filter((v) => table[v.letter]).map((v) => ({
      letter: v.letter,
      fills: table[v.letter].map(([kind, gb, top]) => ({ kind, gb, ...(top ? { top: top.map(([name, g]) => ({ name, gb: g })) } : {}) })),
    })),
  };
}
