// Bridges to the Rust side of the desktop app: the Windows helper, the
// on-disk store and the OS keychain.

import { invoke } from "@tauri-apps/api/core";
import { scriptHash, type ActionCall, Change, HelperLink, HistoryPoint, Inventory, LocalStore, ProcessUse, RawEvent, RecorderCursor, RecorderLink, RecorderStatus, ProbeEdit, ProbeSpec, Snapshot, SystemFacts } from "@rig/core";

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

/** Rig's background recorder: a Windows service that keeps a log while the app is closed (src-tauri/src/recorder.rs). */
export const tauriRecorder: RecorderLink = {
  status: () => invoke<RecorderStatus>("recorder_status"),
  read: (from: number, cursor: RecorderCursor | null) => invoke("recorder_read", { from, cursor }),
  set: (on: boolean) => invoke<void>("recorder_set", { on }),
  probes: (req: ProbeEdit) => call<ProbeSpec[]>("recorder.probes", req),
  // The hash is of the script as shown; the helper refuses it if the text it's handed is any different.
  approveAdmin: async (probe: ProbeSpec) => {
    if (probe.source.kind !== "script") throw new Error("Only scripts are approved.");
    return invoke<ProbeSpec[]>("recorder_approve_script", { probe, hash: await scriptHash(probe.source) });
  },
  readCustom: (from: number, cursor: RecorderCursor | null) => invoke("recorder_read_custom", { from, cursor }),
};

/** Starting with Windows, through Tauri's autostart plugin (a Run entry for this user). */
export const tauriAutostart = {
  get: () => invoke<boolean>("plugin:autostart|is_enabled"),
  set: (on: boolean) => invoke<void>(on ? "plugin:autostart|enable" : "plugin:autostart|disable"),
};
