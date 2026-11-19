// Rig's debug log. In the app it goes to Rig.log through Tauri's log plugin
// (Settings > About > Open logs folder), and to the terminal under `pnpm desktop`.
// In a plain browser it goes to the console.

import { error, info, warn } from "@tauri-apps/plugin-log";
import type { Log } from "@rig/core";
import { inTauri } from "./tauri";

const write = { info, warn, error };

export const log: Log = (level, message) => {
  if (!inTauri) { console[level](message); return; }
  void write[level](message).catch(() => {});
};

/** Puts errors nothing else caught in the log, so a stuck screen leaves a trace. */
export function logUncaught() {
  window.addEventListener("error", (e) => log("error", `page: ${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => log("error", `page: unhandled ${e.reason instanceof Error ? e.reason.stack ?? e.reason.message : String(e.reason)}`));
}
