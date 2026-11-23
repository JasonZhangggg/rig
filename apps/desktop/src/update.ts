// Updates: Rig checks the server for a newer release when it starts and every
// few hours, quietly. When one is ready, the app shows a small notice and an
// Update button in Settings; nothing installs until the person picks Update.
// Copies run from the code have no updater (see src-tauri/src/lib.rs), so
// check() fails there and Settings says the check didn't work.

import { check, type Update } from "@tauri-apps/plugin-updater";
import type { UpdateState, UpdatesHost } from "@rig/ui";
import { log } from "./log";

const EVERY_MS = 6 * 60 * 60 * 1000;
/** Wait a moment after Rig opens, so the first check never competes with the first screen. */
const FIRST_MS = 5_000;

let state: UpdateState = { kind: "idle" };
let ready: Update | null = null;
const fans = new Set<() => void>();
const put = (s: UpdateState) => { state = s; fans.forEach((f) => f()); };

async function checkNow() {
  if (state.kind === "checking" || state.kind === "installing") return;
  const before = state;
  put({ kind: "checking" });
  try {
    const update = await check();
    ready = update;
    if (update) {
      if (before.kind !== "ready" || before.version !== update.version) log("info", `update: ${update.version} is available`);
      put({ kind: "ready", version: update.version, checkedAt: Date.now() });
    } else {
      put({ kind: "current", checkedAt: Date.now() });
    }
  } catch (e) {
    log("info", `update: no check (${String(e)})`);
    // A failed check keeps an update that was already found, so its button stays.
    put(ready ? { kind: "ready", version: ready.version, checkedAt: Date.now() } : { kind: "failed", step: "check", error: String(e) });
  }
}

async function installNow() {
  const update = ready;
  if (!update || state.kind === "installing") return;
  put({ kind: "installing", version: update.version });
  try {
    log("info", `update: installing ${update.version}`);
    // On Windows the installer closes Rig, updates it and the background recorder, then opens it again.
    await update.downloadAndInstall();
  } catch (e) {
    log("error", `update: ${update.version} didn't install: ${String(e)}`);
    put({ kind: "failed", step: "install", version: update.version, error: String(e) });
  }
}

/** Handed to the screens as host.updates. */
export const tauriUpdates: UpdatesHost = {
  get: () => state,
  subscribe: (fn) => { fans.add(fn); return () => { fans.delete(fn); }; },
  check: checkNow,
  install: installNow,
};

export function watchForUpdates() {
  setTimeout(() => void checkNow(), FIRST_MS);
  setInterval(() => void checkNow(), EVERY_MS);
}
