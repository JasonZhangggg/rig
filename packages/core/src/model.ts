// The PC as the screens see it. Built from real readings by view.ts on the
// desktop, received from the server on the web, or taken from demo data.

import type { ActionCall } from "./actions";
import type { DisplayConnection, FillKind, SensorType } from "./telemetry";
import type { BuildShape, Picks } from "./build";
import type { SecurityFacts } from "./safety";

export type Severity = "warn" | "info" | "ok" | "bad";
export type Route = "overview" | "pc" | "chat" | "changes" | "upgrades" | "games" | "history" | "logs" | "recorded" | "events" | "manuals" | "safety" | "web" | "signin" | "settings";

/** One row of a before and after table: [setting, now, after]. */
export type DiffRow = [string, string, string];

export interface Driver { installed: string; latest?: string; note: string; url?: string }

export interface Part {
  name: string;
  type: string;
  sub?: string;
  modelSource: "library" | "generic";
  /** Who made it, where the inventory says ("MSI", "ASUS"). Used to look up its manual. */
  maker?: string;
  /** The model as the maker writes it ("MAG B650 TOMAHAWK WIFI"). */
  model?: string;
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
  /** What Rig saw that led here, one plain line each, so the chat (and the person) can check the reasoning. */
  evidence?: string[];
  /** How sure Rig is about the cause: sure when a reading shows it, likely when the signs point to it, possible when it's one of a few causes. */
  confidence?: "sure" | "likely" | "possible";
}

export interface Stat { label: string; value: number; unit: string; note: string; warn?: boolean }

export interface HealthPart { label: string; value: number; note: string; sev: Severity }

export interface FanReading { label: string; rpm: number; max: number }
export interface StorageSlice { label: string; gb: number }

/** One share of a drive: a kind of thing Rig sized, what it couldn't sort (other), or free space. */
export interface DriveFill {
  kind: FillKind | "other" | "free";
  label: string;
  gb: number;
  /** The biggest things in it, largest first. */
  top?: { name: string; gb: number }[];
}

/** One physical drive for the storage map: what fills it and how healthy it is, from drives.ts. */
export interface DriveMap {
  /** The drive's model, or "Other drives" for volumes Rig couldn't place on a drive. */
  model: string;
  media: "nvme" | "ssd" | "hdd" | "unknown";
  sizeGb: number;
  /** Its volumes as Windows names them ("C: Windows"). */
  volumes: string[];
  /** Windows is on it. */
  system: boolean;
  usedGb?: number;
  freeGb?: number;
  /** Largest first, other and free last. Just used and free until a folder scan finishes. */
  fills: DriveFill[];
  /** When the folder sizes were measured (ISO), and whether a measurement is running now. */
  scannedAt?: string;
  scanning?: boolean;
  /** The verdict in a few words and how worried to be. */
  health: { sev: Severity; text: string };
  lifeLeft?: number;
  writtenTb?: number;
  powerOnHours?: number;
  errors?: number;
  temp?: number;
  /** What Windows couldn't tell Rig about this drive, one plain line each. */
  unknown: string[];
}

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
  /** Each drive with what fills it and its health, for the storage map. */
  drives?: DriveMap[];
  model?: { source: "library" | "generic"; label: string };
  parts?: Record<string, Part>;
  /** Windows settings Rig can switch, as they are now. */
  settings?: PCSettings;
  /** What the helper last read about updates, virus protection, the firewall and backup (safety.ts), with when it read it. */
  security?: SecurityFacts;
  /** ISO date the person last cleaned the dust out, if they told Rig. */
  cleanedAt?: string;
  /** The models the person picked for parts Windows can't name, like which graphics card it is (build.ts). */
  picks?: Picks;
  /** Problems that started while Rig was watching and are still going on, from alerts.ts. */
  alerts?: Alert[];
  /** Every sensor the parts report, as they read at seenAt. */
  readings?: Reading[];
  /** The shape of each part for the 3D view, from build.ts. Missing: a typical tower. */
  build?: BuildShape;
  /** What Windows says is plugged into the motherboard, for the board's slot usage (boardUsage.ts). Desktops only. */
  board?: BoardFacts;
  /** The screens Windows shows, with how each one connects, for the graphics card's outputs (gpuPorts.ts). */
  displays?: DisplayLink[];
  /** The graphics card's PCI subsystem vendor and id, which tell its maker and exact model. Missing from older helpers. */
  gpuSubsys?: { vendor: string; id?: string };
}

/** One screen and where it's plugged in, as far as Windows can say. */
export interface DisplayLink {
  name: string;
  width: number; height: number; refreshHz: number;
  /** The kind of plug on the computer's side. Missing: Windows (or an older Rig) didn't say. */
  connection?: DisplayConnection;
  /** True on the graphics card, false on the processor's own graphics (the motherboard's ports). Missing: not known. */
  onCard?: boolean;
}

/** What Windows tells Rig about the things on a motherboard. Anything it can't see (front panel, USB and RGB headers) isn't here. */
export interface BoardFacts {
  /** Memory sticks, each with the slot Windows says it's in ("DIMM_A2"), when it says. */
  memory: { slot?: string; gb: number; mts?: number; maker?: string; partNumber?: string }[];
  /** How many memory slots Windows says the board has. */
  memorySlots?: number;
  /** Drives, by how they connect. */
  drives: { model: string; media: "nvme" | "ssd" | "hdd" | "unknown"; sizeGb: number }[];
  /** The graphics card in a slot; missing with only the processor's own graphics. */
  gpu?: string;
  /** The board's own fan inputs, by sensor id, so a reading shows which are spinning. */
  fans: { id: string; name: string }[];
}

/** What a PC reads moment to moment: these change with nearly every reading. */
export type LivePCKey = "health" | "seenAt" | "lastSync" | "online" | "stats" | "breakdown" | "fans" | "alerts" | "readings" | "drives";
export type LivePartKey = "temp" | "tempMax" | "load" | "clock" | "fan" | "warn";
/** A row of a part's specs that is a live reading (memory in use, power drawn, a fan's speed), not a fact about the part. */
export const liveSpec = ([label, value]: [string, string]) => label === "In use" || label === "Drawing now" || / rpm$/.test(value);
/** A part without its live readings, its specs included. */
export type StillPart = Omit<Part, LivePartKey>;
/** A PC without its live readings: its name, parts, issues and settings, for screens that show nothing live. */
export type StillPC = Omit<PC, LivePCKey | "parts"> & { parts?: Record<string, StillPart> };

/** The kinds of alert Rig raises. Each one can be turned off on a device. */
export type AlertKind = "too-hot" | "fan-stopped" | "drive-full" | "drive-wearing" | "hotter-than-usual";

/** Something that went wrong and is still going on, worth telling the person about even when they aren't looking. */
export interface Alert {
  /** Stable for one source of trouble, such as "too-hot:gpu", so the same problem keeps the same id. */
  id: string;
  kind: AlertKind;
  /** The part it's about, as a key of PC.parts. */
  part: string;
  severity: Extract<Severity, "warn" | "bad">;
  title: string;
  detail: string;
  /** ISO time the problem started. */
  since: string;
  /** A question to start the chat with when the alert is opened. */
  ask?: string;
  /** Ids of issues that say the same thing, left out wherever this alert shows. */
  covers?: string[];
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
  // Each part's own readings. Missing on points recorded before Rig kept them, null when the part didn't report one.
  /** How hard the processor worked, averaged over the window, in percent. */
  cpuLoad?: number | null;
  /** How hard the graphics card worked, averaged over the window, in percent. */
  gpuLoad?: number | null;
  /** Memory in use, averaged over the window, in percent. */
  mem?: number | null;
  /** The warmest drive, in °C. */
  drive?: number | null;
  /** The motherboard, in °C. */
  board?: number | null;
}

/** The readings a HistoryPoint holds, each a line a chart can draw. */
export type HistoryKey = "cpu" | "gpu" | "fan" | "cpuLoad" | "gpuLoad" | "mem" | "drive" | "board";

/** What a reading measures, so it's shown with the right unit and scale. */
export type ReadingUnit = "temp" | "percent" | "rpm";

/** One sensor as it reads now, with the lowest and highest Rig has seen, filed under the part it belongs to. */
export interface Reading {
  id: string;
  /** The part it's about, as a key of PC.parts. */
  part: string;
  name: string;
  type: SensorType;
  value: number | null;
  min?: number | null;
  max?: number | null;
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
