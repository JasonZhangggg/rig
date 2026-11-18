// The one interface every screen talks to. The desktop app, the website and
// the demo each provide their own implementation, so the UI never knows where
// the data comes from.

import type { ActionCall } from "./actions";
import type { DataExport } from "./export";
import type { DiffRow, HistoryPoint, PC, Upgrade, Game } from "./model";
import type { Manual, ManualDiagram, ManualHit, ManualPage, ManualTarget } from "./manuals";
import type { PCEvent, Recording, RecordingInfo, RecordingRequest } from "./recordings";
import type { ProbeSpec } from "./probes";

export interface Proposal {
  id: string;
  title: string;
  why?: string;
  calls: ActionCall[];
  rows: DiffRow[];
  status: "waiting" | "applied" | "declined";
  changeId?: string;
}

export interface Source { label: string; kind: "Manual" | "Maker" | "Your PC" | "Web"; url?: string }

export interface ChatMessage {
  id: string;
  from: "you" | "rig";
  text: string;
  sources?: Source[];
  steps?: string[];
  proposal?: Proposal;
  /** A recording Rig started with this answer. Its card follows the recording's live state. */
  recording?: RecordingRequest;
  /** A custom log Rig set up or turned off with this answer, and whether that worked on the PC. */
  probe?: { op: "add" | "remove"; id: string; label?: string; error?: string };
  /** A script Rig proposed. It runs only once the person approves it, here in Rig. */
  script?: { probe: ProbeSpec; status: "waiting" | "approved" | "declined"; error?: string };
  pending?: boolean;
  error?: boolean;
}

export interface AppliedCall { call: ActionCall; undo: ActionCall; row: DiffRow }

export interface Change {
  id: string;
  machineId: string;
  /** ISO time. */
  at: string;
  title: string;
  by: "you" | "rig";
  status: "applied" | "undone";
  why: string;
  diff: DiffRow[];
  result: string;
  applied: AppliedCall[];
}

export interface Account { id: string; name: string; email: string }

export type Range = "24h" | "7d" | "30d";
export const rangeMs: Record<Range, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };

/** Streamed while Rig answers. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "steps"; steps: string[] }
  | { type: "proposal"; proposal: Proposal }
  /** Rig started a recording. `queued` means the PC picks it up the next time its app checks in. */
  | { type: "recording"; request: RecordingRequest; queued: boolean }
  /** Rig set up or turned off a custom log on this PC. The Rig app on the PC applies it; `error` is set when that failed. */
  | { type: "probe"; op: "add"; probe: ProbeSpec; error?: string }
  | { type: "probe"; op: "remove"; id: string; error?: string }
  /** Rig proposed a script for the background recorder. Nothing runs until the person approves it. */
  | { type: "script"; probe: ProbeSpec }
  | { type: "error"; message: string }
  | { type: "done" };

export interface Capabilities {
  /** This client is running on the PC itself and can read sensors live. */
  local: boolean;
  /** Changes can be applied and undone from here. */
  applyChanges: boolean;
}

export interface RigClient {
  readonly kind: "desktop" | "web" | "demo";
  readonly caps: Capabilities;

  account(): Promise<Account | null>;
  signOut(): Promise<void>;
  /** Website: sign in with email, or make an account when `create` is given. */
  signInEmail?(email: string, password: string, create?: { name: string }): Promise<Account>;
  /** Website: go to Google and come back signed in. */
  signInGoogle?(): Promise<void>;
  /** Desktop: show a code, open the website, and finish when the person approves there. */
  signInWithBrowser?(): Promise<{ code: string; url: string; done: Promise<Account> }>;
  /** Website: approve or refuse a desktop sign-in code (from the link the desktop opened). */
  approveDevice?(userCode: string, approve: boolean): Promise<void>;
  /** Deletes the account with all its PCs, their history and chat use. Missing where it can't be done (signed out, the demo). */
  deleteAccount?(): Promise<void>;
  /** Everything kept for the account: its PCs, their settings and recorded history. */
  exportData?(): Promise<DataExport>;

  /** Every PC on the account (or just this one when signed out on the desktop). */
  machines(): Promise<PC[]>;
  /** Live view of one PC. Calls back now and on every change; returns a stop function. */
  watch(machineId: string, cb: (pc: PC) => void): () => void;
  /** Name, color and the date of the last dust clean. */
  rename(machineId: string, patch: { name?: string; accent?: string; cleanedAt?: string }): Promise<void>;

  history(machineId: string, range: Range): Promise<HistoryPoint[]>;
  upgrades(machineId: string): Promise<Upgrade[]>;
  games(machineId: string): Promise<Game[]>;

  changes(machineId: string): Promise<Change[]>;
  /** Fills in the current values so the person sees exactly what will change. */
  preview(machineId: string, calls: ActionCall[]): Promise<DiffRow[]>;
  apply(machineId: string, calls: ActionCall[], meta: { title?: string; why?: string; by: "you" | "rig" }): Promise<Change>;
  undo(machineId: string, changeId: string): Promise<Change>;
  redo(machineId: string, changeId: string): Promise<Change>;

  /** Windows crash, driver, hardware, shutdown and disk events from the last 30 days, newest first. */
  events(machineId: string): Promise<PCEvent[]>;
  /** The PC's recordings, newest first. Calls back now and whenever one changes; returns a stop function. */
  watchRecordings(machineId: string, cb: (list: RecordingInfo[]) => void): () => void;
  /** One recording with its readings and events. */
  recording(machineId: string, id: string): Promise<Recording | null>;
  /** Starts a recording. It only collects readings, so it needs no review. On the web it waits for the PC's app to pick it up. */
  startRecording(machineId: string, req: { reason: string; minutes: number; question?: string }): Promise<RecordingInfo>;
  /** Stops a recording early. What it collected so far is kept. */
  stopRecording(machineId: string, id: string): Promise<void>;
  /** Desktop: reads the background recorder again now, after a custom log was approved, paused or turned off. */
  refreshBackground?(): Promise<unknown>;

  /** The PC's manuals, newest first. */
  manuals(machineId: string): Promise<Manual[]>;
  /** Looks up the maker's manual for a part and adds it, unread. Null when Rig couldn't find one. Needs the server (signed in), except in the demo. */
  findManual?(machineId: string, target: ManualTarget): Promise<Manual | null>;
  /** Adds a PDF the person picked. Its file stays on this device (the screens keep a copy); read it next with saveManualPages. */
  addManualFile(machineId: string, target: ManualTarget, file: { name: string; bytes: number }): Promise<Manual>;
  /** The PDF of a found manual, downloaded through Rig's server. Throws for an added file (only the device it was added on has it). */
  manualFile(machineId: string, manualId: string): Promise<ArrayBuffer>;
  /** Saves the text read from each page and the diagram pages found, so search and the chat can use them. */
  saveManualPages(machineId: string, manualId: string, pages: ManualPage[], diagrams: ManualDiagram[]): Promise<Manual>;
  /** Searches the PC's manuals (or one of them). Best matches first, at most `limit` (default 20). */
  searchManuals(machineId: string, query: string, opts?: { manualId?: string; limit?: number }): Promise<ManualHit[]>;
  /** The saved text of one page, for showing next to the drawn page. Null when it wasn't read. */
  manualPage(machineId: string, manualId: string, page: number): Promise<ManualPage | null>;
  removeManual(machineId: string, manualId: string): Promise<void>;

  /** The PC's manuals, newest first. */
  manuals(machineId: string): Promise<Manual[]>;
  /** Looks up the maker's manual for a part and adds it, unread. Null when Rig couldn't find one. Needs the server (signed in), except in the demo. */
  findManual?(machineId: string, target: ManualTarget): Promise<Manual | null>;
  /** Adds a PDF the person picked. Its file stays on this device (the screens keep a copy); read it next with saveManualPages. */
  addManualFile(machineId: string, target: ManualTarget, file: { name: string; bytes: number }): Promise<Manual>;
  /** The PDF of a found manual, downloaded through Rig's server. Throws for an added file (only the device it was added on has it). */
  manualFile(machineId: string, manualId: string): Promise<ArrayBuffer>;
  /** Saves the text read from each page and the diagram pages found, so search and the chat can use them. */
  saveManualPages(machineId: string, manualId: string, pages: ManualPage[], diagrams: ManualDiagram[]): Promise<Manual>;
  /** Searches the PC's manuals (or one of them). Best matches first, at most `limit` (default 20). */
  searchManuals(machineId: string, query: string, opts?: { manualId?: string; limit?: number }): Promise<ManualHit[]>;
  /** The saved text of one page, for showing next to the drawn page. Null when it wasn't read. */
  manualPage(machineId: string, manualId: string, page: number): Promise<ManualPage | null>;
  removeManual(machineId: string, manualId: string): Promise<void>;

  /** A conversation to open the chat with (the demo's example). */
  conversation?(machineId: string): ChatMessage[];
  /** Ask Rig. History is the conversation so far, newest last. */
  chat(machineId: string, history: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void>;
}
