// The one interface every screen talks to. The desktop app, the website and
// the demo each provide their own implementation, so the UI never knows where
// the data comes from.

import type { ActionCall } from "./actions";
import type { AppliedStep, ApplyReply, HelperStep, PreviewReply, Step, Tier, UndoReply } from "./change";
import type { Identity } from "./view";
import type { DataExport } from "./export";
import type { DiffRow, HistoryPoint, PC, Upgrade, Game } from "./model";
import type { Shop } from "./shop";
import type { Manual, ManualDiagram, ManualHit, ManualPage, ManualTarget } from "./manuals";
import type { BoardLayoutReply, ReadLayoutRequest } from "./api";
import type { PCEvent, Recording, RecordingInfo, RecordingRequest } from "./recordings";
import type { ProbeSpec } from "./probes";
import type { PcRead } from "./reads";
import type { ScreenLook } from "./screen";

export interface Proposal {
  id: string;
  title: string;
  why?: string;
  steps: Step[];
  /** The same changes as `steps`, for desktop apps from before steps (0.1.9 and older). Sent only when every step is a fix. */
  calls?: ActionCall[];
  /** The riskiest step's tier, worked out by Rig. */
  tier: Tier;
  rows: DiffRow[];
  status: "waiting" | "applied" | "declined";
  changeId?: string;
  /** What the helper read and checked for each step when the card was made. A fix step has none. */
  previews?: (PreviewReply | null)[];
  /** What happened to each command step once the person applied it. */
  outcomes?: (StepOutcome | null)[];
  /** Rig read text from outside this PC earlier in the conversation. */
  tainted?: boolean;
  /** The looks its screen steps came from, as the helper answered them: the app, the path and the value, all in the app's own words. */
  looks?: ScreenLook[];
}

/** One command step after the person pressed Apply, and after Undo if they pressed that too. */
export interface StepOutcome { apply: ApplyReply; undo?: UndoReply }

export interface Source { label: string; kind: "Manual" | "Maker" | "Your PC" | "Web"; url?: string }

export interface ChatMessage {
  id: string;
  from: "you" | "rig";
  text: string;
  sources?: Source[];
  steps?: string[];
  /** The steps are done in firmware setup: the app offers a button that restarts into it. */
  firmwareSetup?: boolean;
  /** The app's own restart into firmware setup, offered under those steps: Rig's read, then what happened when the person pressed it. */
  restart?: { preview?: PreviewReply; outcome?: StepOutcome; /** ISO time the restart was set. */ at?: string };
  proposal?: Proposal;
  /** A recording Rig started with this answer. Its card follows the recording's live state. */
  recording?: RecordingRequest;
  /** A custom log Rig set up or turned off with this answer, and whether that worked on the PC. */
  probe?: { op: "add" | "remove"; id: string; label?: string; error?: string };
  /** A script Rig proposed. It runs only once the person approves it, here in Rig. */
  script?: { probe: ProbeSpec; status: "waiting" | "approved" | "declined"; error?: string };
  pending?: boolean;
  error?: boolean;
  /**
   * The server's signed note on this answer: whether it, or an answer before it, read outside text.
   * Sent back with the history. An answer of Rig's without a valid one counts as having read outside text.
   */
  seal?: string;
}

/** The chat answer a change came from. */
export interface Provenance { proposalId: string; /** The chat message that showed the card. */ messageId?: string }

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
  tier: Tier;
  applied: AppliedStep[];
  from?: Provenance;
}

export interface ApplyMeta { title?: string; why?: string; by: "you" | "rig"; from?: Provenance }

export interface Account { id: string; name: string; email: string }

export type Range = "24h" | "7d" | "30d";
export const rangeMs: Record<Range, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };

/** Streamed while Rig answers. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "sources"; sources: Source[] }
  /** `firmwareSetup`: the steps are done in firmware setup, so the app offers to restart into it. */
  | { type: "steps"; steps: string[]; firmwareSetup?: true }
  | { type: "proposal"; proposal: Proposal }
  /** Rig started a recording. `queued` means the PC picks it up the next time its app checks in. */
  | { type: "recording"; request: RecordingRequest; queued: boolean }
  /** Rig set up or turned off a custom log on this PC. The Rig app on the PC applies it; `error` is set when that failed. */
  | { type: "probe"; op: "add"; probe: ProbeSpec; error?: string }
  | { type: "probe"; op: "remove"; id: string; error?: string }
  /** Rig proposed a script for the background recorder. Nothing runs until the person approves it. */
  | { type: "script"; probe: ProbeSpec }
  /**
   * Desktop only: Rig wants to look at the PC before it goes on. The app runs each read through the helper and asks again
   * with `resume` and the results. The stream ends after this event, without `done`.
   */
  | { type: "reads"; reads: PcRead[]; resume: string }
  /** Keep this on the answer (ChatMessage.seal) and send it back with the history. */
  | { type: "seal"; seal: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface Capabilities {
  /** This client is running on the PC itself and can read sensors live. */
  local: boolean;
  /** Changes can be applied and undone from here. */
  applyChanges: boolean;
}

/** Where the app writes its debug log. The desktop app keeps a file; elsewhere it's the console. */
export type Log = (level: "info" | "warn" | "error", message: string) => void;

export interface RigClient {
  readonly kind: "desktop" | "web" | "demo";
  readonly caps: Capabilities;

  account(): Promise<Account | null>;
  /** Desktop: what the first read of this PC is waiting on, while it's still going. */
  loadingStep?(): string | null;
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
  /** Name, color, the date of the last dust clean, and the models picked for parts Windows can't name. */
  rename(machineId: string, patch: Identity): Promise<void>;

  history(machineId: string, range: Range): Promise<HistoryPoint[]>;
  upgrades(machineId: string): Promise<Upgrade[]>;
  /** Parts that could go in the PC, to check against it. Null before Rig has read its parts. Prices are demo data while Shop.demo is true. */
  shop(machineId: string): Promise<Shop | null>;
  games(machineId: string): Promise<Game[]>;

  changes(machineId: string): Promise<Change[]>;
  /** Fills in the current values so the person sees exactly what will change. */
  preview(machineId: string, steps: Step[]): Promise<DiffRow[]>;
  apply(machineId: string, steps: Step[], meta: ApplyMeta): Promise<Change>;
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
  /** Desktop and demo: measures what fills each drive again now, in the background. Only for this PC; the storage map shows it while it runs. */
  measureDrives?(machineId: string): Promise<void>;

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
  /** A board model's layout, read once from its manual for everyone. Needs the server (signed in). */
  boardLayout?(machineId: string, maker: string, model: string): Promise<BoardLayoutReply>;
  /** Has the server read the layout drawing on a page of a found motherboard manual, unless it's read or being read. */
  readBoardLayout?(machineId: string, manualId: string, page: ReadLayoutRequest): Promise<BoardLayoutReply>;

  /** A conversation to open the chat with (the demo's example). */
  conversation?(machineId: string): ChatMessage[];
  /** Has the helper read the current state for a command or native step and check it, so its card can show it. Only where changes can be made. */
  previewStep?(machineId: string, step: HelperStep, tainted: boolean): Promise<PreviewReply>;
  /** Runs a step the helper previewed, by the nonce from its preview. Only where changes can be made. */
  applyStep?(machineId: string, nonce: string, meta: ApplyMeta): Promise<ApplyReply>;
  /** Puts a step back, by the id in its undo record. With `force`, even when something else changed those places since. */
  undoStep?(machineId: string, undoId: string, force?: boolean): Promise<UndoReply>;
  /** Ask Rig. History is the conversation so far, newest last. */
  chat(machineId: string, history: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void>;
}
