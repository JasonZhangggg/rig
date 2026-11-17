// The one interface every screen talks to. The desktop app, the website and
// the demo each provide their own implementation, so the UI never knows where
// the data comes from.

import type { ActionCall } from "./actions";
import type { DiffRow, HistoryPoint, PC, Upgrade, Game } from "./model";

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

  /** Ask Rig. History is the conversation so far, newest last. */
  chat(machineId: string, history: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void>;
}
