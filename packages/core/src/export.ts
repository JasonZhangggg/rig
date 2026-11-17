// "Download my data": everything Rig keeps for an account, as one JSON file.
// The server, the desktop app (signed out) and the demo all build it here, so
// the file has the same shape wherever it comes from.

import type { Account, Change } from "./client";
import type { Game, HistoryPoint, PC } from "./model";
import type { PCEvent, Recording } from "./recordings";
import type { Inventory, SystemFacts } from "./telemetry";
import type { Identity } from "./view";

export const EXPORT_FORMAT = "rig-export/1";

export interface ExportMachine {
  id: string;
  name: string;
  /** The PC as the screens last showed it. */
  view: PC;
  inventory: Inventory | null;
  facts: SystemFacts | null;
  identity: Identity;
  /** ISO time the PC last uploaded, when it came from the account. */
  syncedAt: string | null;
  changes: Change[];
  games: Game[];
  /** Recorded readings, oldest first. */
  history: HistoryPoint[];
  /** Crash and error events Rig read from Windows, newest first. */
  events: PCEvent[];
  /** Recordings with all their readings, newest first. */
  recordings: Recording[];
}

export interface DataExport {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  /** Null when the desktop app exports this PC while signed out. */
  account: (Account & { createdAt?: string }) | null;
  machines: ExportMachine[];
  /** Questions asked per day (UTC), for the daily allowance. */
  chatUsage: { day: string; count: number }[];
  notes: string[];
}

export interface ExportInput {
  account: DataExport["account"];
  machines: (Omit<ExportMachine, "name" | "identity" | "syncedAt" | "events" | "recordings"> & { identity?: Identity; syncedAt?: string | null; events?: PCEvent[]; recordings?: Recording[] })[];
  chatUsage?: DataExport["chatUsage"];
  notes?: string[];
  now?: Date;
}

/** The export file, with each PC's history sorted oldest first and PCs in name order. */
export function makeExport(input: ExportInput): DataExport {
  const machines = input.machines.map((m): ExportMachine => ({
    id: m.id,
    name: m.identity?.name ?? m.view.name,
    view: m.view,
    inventory: m.inventory ?? null,
    facts: m.facts ?? null,
    identity: m.identity ?? {},
    syncedAt: m.syncedAt ?? null,
    changes: m.changes,
    games: m.games,
    history: [...m.history].sort((a, b) => a.t - b.t),
    events: m.events ?? [],
    recordings: [...(m.recordings ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    format: EXPORT_FORMAT,
    exportedAt: (input.now ?? new Date()).toISOString(),
    account: input.account,
    machines,
    chatUsage: [...(input.chatUsage ?? [])].sort((a, b) => a.day.localeCompare(b.day)),
    notes: ["Temperatures are in °C and times (t) are milliseconds since 1970 (UTC).", ...(input.notes ?? [])],
  };
}

/** rig-data-2026-11-17.json, in the viewer's local date. */
export function exportFileName(at = new Date()): string {
  const d = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return `rig-data-${d}.json`;
}
