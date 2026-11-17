// The Rig server's HTTP API, shared by the website, the desktop app and the
// server so all three agree on paths and payloads.

import type { Change, ChatEvent, ChatMessage } from "./client";
import type { Game, HistoryPoint, PC } from "./model";
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
}

/** Reply to a sync: the account's identity for this PC, which wins when it was changed on the web later. */
export interface SyncReply { identity: Identity; identityAt?: string }

/** GET /api/config: what this server has turned on. */
export interface ServerConfig { google: boolean; chat: boolean }

/** Body of POST /api/chat. The desktop sends its live view; the web sends only the id. */
export interface ChatRequest {
  machineId: string;
  messages: Pick<ChatMessage, "from" | "text">[];
  view?: PC;
  facts?: SystemFacts;
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
  sync: (id: string) => `/machines/${encodeURIComponent(id)}/sync`,
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
      const e = JSON.parse(data) as ChatEvent;
      onEvent(e);
      if (e.type === "done") return;
    }
  }
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
