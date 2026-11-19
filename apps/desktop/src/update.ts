// Updates: Rig checks the server for a newer release when it starts and every
// few hours, and asks before installing one. Copies run from the code have no
// updater (see src-tauri/src/lib.rs), so check() fails there and nothing happens.

import { ask, message } from "@tauri-apps/plugin-dialog";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { log } from "./log";

const EVERY_MS = 6 * 60 * 60 * 1000;
/** Versions the person chose Later on. Asked again after Rig restarts. */
const later = new Set<string>();
let busy = false;

async function offer(update: Update) {
  const yes = await ask(
    `Rig ${update.version} is ready to install. Rig closes while it updates, and Windows asks once for permission so the background recorder updates too.`,
    { title: "Update Rig", kind: "info", okLabel: "Install now", cancelLabel: "Later" },
  );
  if (!yes) { later.add(update.version); log("info", `update: ${update.version} put off until Rig restarts`); return; }
  try {
    log("info", `update: installing ${update.version}`);
    await update.downloadAndInstall();
  } catch (e) {
    log("error", `update: ${update.version} didn't install: ${String(e)}`);
    await message(`The update didn't install, so Rig stays on this version for now. It will offer the update again later.\n\n${String(e)}`, { title: "Update Rig", kind: "warning" });
  }
}

async function checkOnce() {
  if (busy) return;
  busy = true;
  try {
    const update = await check().catch((e: unknown) => { log("info", `update: no check (${String(e)})`); return null; });
    if (update) log("info", `update: ${update.version} is available`);
    if (update && !later.has(update.version)) await offer(update);
  } finally {
    busy = false;
  }
}

export function watchForUpdates() {
  void checkOnce();
  setInterval(() => void checkOnce(), EVERY_MS);
}
