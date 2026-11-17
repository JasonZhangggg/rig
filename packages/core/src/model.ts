// The PC as the screens see it. Built from real readings by view.ts on the
// desktop, received from the server on the web, or taken from demo data.

import type { ActionCall } from "./actions";

export type Severity = "warn" | "info" | "ok" | "bad";
export type Route = "overview" | "pc" | "chat" | "changes" | "upgrades" | "games" | "history" | "web" | "signin" | "settings";

/** One row of a before and after table: [setting, now, after]. */
export type DiffRow = [string, string, string];

export interface Driver { installed: string; latest?: string; note: string; url?: string }

export interface Part {
  name: string;
  type: string;
  sub?: string;
  modelSource: "library" | "generic";
  dims?: string;
  temp?: number;
  /** Highest temperature seen today. */
  tempMax?: number;
  /** The maker's safe limit, when known. */
  limit?: number;
  load?: number;
  clock?: string;
  fan?: number;
  warn?: boolean;
  soldered?: boolean;
  specs: [string, string][];
  manual: [string, string][];
  driver?: Driver;
}

export interface Issue {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  action: string;
  part?: string;
  go: Route;
  /** A question to start the chat with when the issue is opened. */
  ask?: string;
  /** A change that fixes it, shown for review before anything happens. */
  fix?: ActionCall[];
}

export interface Stat { label: string; value: number; unit: string; note: string; warn?: boolean }

export interface HealthPart { label: string; value: number; note: string; sev: Severity }

export interface FanReading { label: string; rpm: number; max: number }
export interface StorageSlice { label: string; gb: number }

export interface PC {
  id: string;
  name: string;
  kind: "tower" | "laptop";
  accent: string;
  nickname: string;
  os: string;
  health: number;
  /** ISO time of the last reading or sync. */
  seenAt?: string;
  lastSync: string;
  online: boolean;
  summary: string;
  stats?: Stat[];
  issues?: Issue[];
  breakdown?: HealthPart[];
  fans?: FanReading[];
  storage?: { slices: StorageSlice[]; totalGb: number };
  model?: { source: "library" | "generic"; label: string };
  parts?: Record<string, Part>;
  /** Windows settings Rig can switch, as they are now. */
  settings?: PCSettings;
  /** ISO date the person last cleaned the dust out, if they told Rig. */
  cleanedAt?: string;
}

export interface PCSettings {
  gameMode: boolean;
  visualEffects: "auto" | "appearance" | "performance" | "custom";
  powerPlans: { guid: string; name: string; active: boolean }[];
  startupOn: number;
}

/** How long one HistoryPoint covers. The desktop records one per window; insights read them back on this grid. */
export const HISTORY_WINDOW_MS = 10 * 60_000;

/** One window of a PC's history: the highest readings in it and what it was doing. */
export interface HistoryPoint {
  /** Milliseconds since epoch. */
  t: number;
  cpu: number | null;
  gpu: number | null;
  /** A game or heavy load was running. */
  busy: boolean;
  /** The fastest fan in the window, in rpm. Null when no fan reported a speed; missing on points recorded before Rig kept it. */
  fan?: number | null;
  /** The game in the foreground for most of the window. Null when none ran; missing on points recorded before Rig kept it. */
  game?: string | null;
}

export interface Upgrade { part: string; title: string; fit: "fits" | "check" | "no" | "later"; detail: string; gain: string; price: string }

export interface Game {
  id: string;
  name: string;
  res: string;
  /** Measured frame rates, if the game has been played with Rig open. */
  now?: { avg: number; low: number };
  tuned?: { avg: number; low: number };
  settings: DiffRow[];
  measured: string;
}
