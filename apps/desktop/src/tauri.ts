// Bridges to the Rust side of the desktop app: the Windows helper, the
// on-disk store and the OS keychain.

import { invoke } from "@tauri-apps/api/core";
import type { ActionCall, Change, HelperLink, HistoryPoint, Inventory, LocalStore, ProcessUse, RawEvent, Snapshot, SystemFacts } from "@rig/core";

export const inTauri = "__TAURI_INTERNALS__" in window;

const call = <T>(method: string, params?: unknown) => invoke<T>("helper_call", { method, params: params ?? null });

/** The elevated helper, started by the Rust side on first use. */
export const tauriLink: HelperLink = {
  hello: () => call("hello"),
  inventory: () => call<Inventory>("inventory"),
  facts: () => call<SystemFacts>("facts"),
  snapshot: () => call<Snapshot>("snapshot"),
  apply: (c: ActionCall) => call<{ undo: ActionCall }>("apply", { call: c }).then((r) => r.undo),
  events: (sinceMs: number) => call<RawEvent[]>("events", { sinceMs }),
  processes: () => call<ProcessUse[]>("processes", { top: 8 }),
};

/**
 * A notification outside Rig's window. The app has no native notification
 * plugin yet, so this uses the web view's own; clicking it opens the page.
 */
export function notify({ title, body, route }: { title: string; body: string; route: string }) {
  if (!("Notification" in window)) return;
  const show = () => {
    const n = new Notification(title, { body });
    n.onclick = () => { window.focus(); location.hash = route; };
  };
  if (Notification.permission === "granted") show();
  else if (Notification.permission !== "denied") void Notification.requestPermission().then((p) => { if (p === "granted") show(); });
}

/** SQLite file in the app's data folder. */
export const tauriStore: LocalStore = {
  get: <T>(key: string) => invoke<T | null>("kv_get", { key }),
  set: (key, value) => invoke("kv_set", { key, value }),
  addHistory: (point) => invoke("history_add", { point }),
  history: (since) => invoke<HistoryPoint[]>("history_since", { since }),
  changes: () => invoke<Change[]>("changes_list"),
  putChange: (change) => invoke("change_put", { change }),
};

/** The sign-in token lives in Windows Credential Manager, not in a file. */
export const tauriToken = {
  get: () => invoke<string | null>("token_get"),
  set: (token: string | null) => invoke<void>("token_set", { token }),
};
