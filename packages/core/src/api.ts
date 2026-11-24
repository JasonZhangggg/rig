// The Rig server's HTTP API, shared by the website, the desktop app and the
// server so all three agree on paths and payloads.

import type { Change, ChatEvent, ChatMessage } from "./client";
import type { Game, HistoryPoint, PC } from "./model";
import type { BoardLayout } from "./boardLayout";
import type { ManualDiagram, ManualPage, ManualTarget } from "./manuals";
import type { PCEvent, RecordingRequest } from "./recordings";
import type { ProbeStatus } from "./probes";
import type { PcReadResult } from "./reads";
import { fixSteps } from "./change";
import type { Inventory, SystemFacts } from "./telemetry";
import type { Identity } from "./view";

/** What the desktop app uploads for its PC every few minutes and after a change. */
export interface MachineSync {
  at: string;
  view: PC;
  inventory: Inventory;
  facts: SystemFacts;
  /** Hourly points since the last upload (the server keeps 30 days). */
  history: HistoryPoint[];
  /** The newest 200 changes, so the web shows the same log. */
  changes: Change[];
  games: Game[];
  /** Name, color and dust-clean date, with when they last changed here. */
  identity: Identity;
  identityAt?: string;
  /** Windows events from the last 30 days, newest first. Missing from apps that don't read them yet. */
  events?: PCEvent[];
}

/** Reply to a sync: the account's identity for this PC, which wins when it was changed on the web later. */
export interface SyncReply {
  identity: Identity;
  identityAt?: string;
  /** Recordings asked for on the web that this PC should start, and ones it should stop. */
  recordings?: { start: RecordingRequest[]; stop: string[] };
}

/** GET /api/config: what this server has turned on. */
export interface ServerConfig { google: boolean; chat: boolean }

/** Body of POST /api/chat. The desktop sends its live view; the web sends only the id. */
export interface ChatRequest {
  machineId: string;
  messages: Pick<ChatMessage, "from" | "text" | "seal">[];
  view?: PC;
  facts?: SystemFacts;
  /** The person's time zone, like "Europe/Berlin", so Rig can say when to check back. */
  tz?: string;
  /** The desktop's custom logs, when its background recorder is on. Missing means the chat can't set them up from here. */
  probes?: ProbeStatus[];
  /** The desktop can run live reads through its helper (the `reads` event). */
  reads?: boolean;
  /** Going on with an answer after its reads: the `resume` from the `reads` event, and what each read found. */
  resume?: string;
  results?: PcReadResult[];
}

export const paths = {
  me: "/me",
  exportData: "/me/export",
  machines: "/machines",
  machine: (id: string) => `/machines/${encodeURIComponent(id)}`,
  history: (id: string, range: string) => `/machines/${encodeURIComponent(id)}/history?range=${range}`,
  changes: (id: string) => `/machines/${encodeURIComponent(id)}/changes`,
  games: (id: string) => `/machines/${encodeURIComponent(id)}/games`,
  upgrades: (id: string) => `/machines/${encodeURIComponent(id)}/upgrades`,
  shop: (id: string) => `/machines/${encodeURIComponent(id)}/shop`,
  sync: (id: string) => `/machines/${encodeURIComponent(id)}/sync`,
  events: (id: string) => `/machines/${encodeURIComponent(id)}/events`,
  recordings: (id: string) => `/machines/${encodeURIComponent(id)}/recordings`,
  recording: (id: string, rid: string) => `/machines/${encodeURIComponent(id)}/recordings/${encodeURIComponent(rid)}`,
  recordingStop: (id: string, rid: string) => `/machines/${encodeURIComponent(id)}/recordings/${encodeURIComponent(rid)}/stop`,
  manuals: (id: string) => `/machines/${encodeURIComponent(id)}/manuals`,
  manualFind: (id: string) => `/machines/${encodeURIComponent(id)}/manuals/find`,
  manualSearch: (id: string, q: string, manualId?: string, limit?: number) => `/machines/${encodeURIComponent(id)}/manuals/search?q=${encodeURIComponent(q)}${manualId ? `&manual=${encodeURIComponent(manualId)}` : ""}${limit ? `&limit=${limit}` : ""}`,
  manual: (id: string, mid: string) => `/machines/${encodeURIComponent(id)}/manuals/${encodeURIComponent(mid)}`,
  manualPdf: (id: string, mid: string) => `/machines/${encodeURIComponent(id)}/manuals/${encodeURIComponent(mid)}/pdf`,
  manualPages: (id: string, mid: string) => `/machines/${encodeURIComponent(id)}/manuals/${encodeURIComponent(mid)}/pages`,
  manualPage: (id: string, mid: string, n: number) => `/machines/${encodeURIComponent(id)}/manuals/${encodeURIComponent(mid)}/pages/${n}`,
  boardLayout: (id: string, maker: string, model: string) => `/machines/${encodeURIComponent(id)}/board-layout?maker=${encodeURIComponent(maker)}&model=${encodeURIComponent(model)}`,
  manualLayout: (id: string, mid: string) => `/machines/${encodeURIComponent(id)}/manuals/${encodeURIComponent(mid)}/layout`,
  chat: "/chat",
  config: "/config",
  // Better Auth
  signInEmail: "/auth/sign-in/email",
  signUpEmail: "/auth/sign-up/email",
  signInSocial: "/auth/sign-in/social",
  signOut: "/auth/sign-out",
  deviceCode: "/auth/device/code",
  deviceToken: "/auth/device/token",
  deviceCheck: (code: string) => `/auth/device?user_code=${encodeURIComponent(code)}`,
  deviceApprove: "/auth/device/approve",
  deviceDeny: "/auth/device/deny",
} as const;

/**
 * Manuals on the server (all need an account, and the PC must be on it):
 * - GET    manuals(id)                -> Manual[]
 * - POST   manualFind(id)             body ManualTarget -> { manual: Manual | null } (counts against the daily chat allowance)
 * - POST   manuals(id)                body AddManualRequest -> Manual (a file the person added; no PDF is sent)
 * - GET    manualPdf(id, mid)         -> the PDF bytes, fetched from the maker's address on the manual (404 for an added file)
 * - PUT    manualPages(id, mid)       body SaveManualPagesRequest -> Manual
 * - GET    manualPage(id, mid, n)     -> ManualPage (404 when not read)
 * - GET    manualSearch(id, q, mid?)  -> ManualHit[]
 * - DELETE manual(id, mid)            -> 204
 * - GET    boardLayout(id, maker, model) -> BoardLayoutReply (the board model's shared layout, read once for everyone)
 * - POST   manualLayout(id, mid)      body ReadLayoutRequest -> BoardLayoutReply (reads the drawing unless it's read or being read)
 */
export interface AddManualRequest { target: ManualTarget; name: string; bytes: number }
export interface SaveManualPagesRequest { pages: ManualPage[]; diagrams: ManualDiagram[] }

/** Where a board model's layout stands: read (with it), being read by another PC, failed, or never tried. */
export interface BoardLayoutReply { status: "done" | "reading" | "failed" | "none"; layout?: BoardLayout }
/** The manual's layout page as a picture, rendered by the app, with that page's and the next page's text. */
export interface ReadLayoutRequest { page: number; image: string; mediaType: "image/png" | "image/jpeg"; width: number; height: number; text?: string }

/** Body of DELETE /api/me. The person types this word to confirm. */
export interface DeleteAccountRequest { confirm: typeof DELETE_WORD }
export const DELETE_WORD = "DELETE";

/** The desktop app's client id for the device sign-in flow. */
export const desktopClientId = "rig-desktop";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Reads a server-sent event stream of ChatEvents. */
export async function readChatStream(res: Response, onEvent: (e: ChatEvent) => void): Promise<void> {
  if (!res.ok || !res.body) throw new ApiError(res.status, await errorText(res));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      const e = olderProposal(JSON.parse(data) as ChatEvent);
      onEvent(e);
      if (e.type === "done") return;
    }
  }
}

/** A server from before steps sends a proposal's fixes only as `calls`. */
function olderProposal(e: ChatEvent): ChatEvent {
  if (e.type !== "proposal" || Array.isArray(e.proposal.steps) || !Array.isArray(e.proposal.calls)) return e;
  return { ...e, proposal: { ...e.proposal, steps: fixSteps(e.proposal.calls), tier: e.proposal.tier ?? 1 } };
}

/** Shown when the request never reached the server. */
export const unreachableText = "Rig can't reach its server. Check your internet connection and try again.";
/** Shown when the server failed without saying why. */
export const serverDownText = "Rig's server isn't answering right now. Try again in a minute.";

/** Shown when a web page came back where the server's data should be, so Rig is pointed at the wrong address. */
export const wrongServerText = "Rig got a web page back instead of its server's answer, so this copy of Rig points at the wrong address. Install the latest version of Rig and try again.";

/** Reads a JSON body, or says plainly that the answer wasn't from Rig's server. */
export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { throw new ApiError(res.status, wrongServerText); }
}

export async function errorText(res: Response): Promise<string> {
  const fallback = res.status >= 500 ? serverDownText : res.statusText || `Error ${res.status}`;
  try {
    const body = await res.json() as { message?: string; error?: string };
    return body.message ?? body.error ?? fallback;
  } catch { return fallback; }
}
