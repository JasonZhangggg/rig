// What fills the demo PCs' drives, as the helper's folder scan would report it.
// Made up, but sized to fit each fixture's volumes.

import type { FillKind, Inventory, StorageScan } from "../telemetry";
import type { CleanupRead, SpotKind } from "../freeSpace";

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

type Spot = [SpotKind, number, string, number?];

/** What the demo PCs' safe-to-clear places hold, as the helper's `cleanup.sizes` would answer. Atlas has about 38 GB to clear. */
const spotsBy: Record<"tower" | "laptop", Spot[]> = {
  tower: [
    ["windowsOld", 18, "C:"], ["userTemp", 4.4, "C:"], ["windowsTemp", 1.6, "C:"], ["updateCache", 4.1, "C:"],
    ["deliveryOptimization", 3.9, "C:"], ["recycleBin", 2.2, "C:"], ["recycleBin", 0.8, "D:"], ["crashDumps", 2.3, "C:"],
    ["thumbnails", 0.7, "C:"], ["oldDownloads", 14.2, "C:", 212],
  ],
  laptop: [
    ["userTemp", 1.9, "C:"], ["windowsTemp", 0.6, "C:"], ["updateCache", 2.8, "C:"], ["deliveryOptimization", 1.2, "C:"],
    ["recycleBin", 0.4, "C:"], ["thumbnails", 0.3, "C:"], ["oldDownloads", 6.5, "C:", 48],
  ],
};

/** Games on Atlas that the demo's history last saw months ago. */
const longAgo: Record<"tower" | "laptop", [string, number][]> = {
  tower: [["Microsoft Flight Simulator", 152], ["Red Dead Redemption 2", 214]],
  laptop: [],
};

/** The demo's answer to "what's safe to clear": the sizes, and when each game last played over the 90 days of history a PC keeps. */
export function demoCleanup(inv: Inventory, now: number, storageSense: boolean): CleanupRead {
  const kind = inv.machine.kind === "laptop" ? "laptop" : "tower";
  const day = 864e5;
  const recent = kind === "tower" ? ["Cyberpunk 2077", "Counter-Strike 2", "Baldur's Gate 3", "Rocket League", "Call of Duty", "Forza Horizon 5"] : ["Minecraft", "Stardew Valley"];
  return {
    sizes: { at: now, storageSense, spots: spotsBy[kind].map(([k, gb, drive, files]) => ({ kind: k, gb, drive, ...(files ? { files } : {}) })) },
    played: [...recent.map((name, i) => ({ name, lastPlayed: now - (i + 1) * 2 * day })), ...longAgo[kind].map(([name, days]) => ({ name, lastPlayed: now - days * day }))],
    historyFrom: now - 90 * day,
  };
}
