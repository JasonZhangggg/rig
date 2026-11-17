// Windows notifications for new alerts on this PC. They're sent only while
// Rig's window isn't in front; when it is, Things to look at already shows them.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { alertsToNotify, shownAlerts, type LocalClient, type NotifyLog } from "@rig/core";
import { alertKindsOff } from "@rig/ui";

const LOG = "rig.alerts.notified";

function readLog(): string {
  try { return localStorage.getItem(LOG) ?? "{}"; } catch { return "{}"; }
}

function parse(raw: string): NotifyLog {
  try { const v: unknown = JSON.parse(raw); return v && typeof v === "object" ? (v as NotifyLog) : {}; } catch { return {}; }
}

async function allowed(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

const focused = () => getCurrentWindow().isFocused().catch(() => document.hasFocus());

/** Watches this PC's alerts and sends a notification for each new one. Returns a stop function. */
export function notifyAlerts(client: LocalClient): () => void {
  let permission: Promise<boolean> | null = null;
  let queue = Promise.resolve();
  return client.watch(client.id, (pc) => {
    queue = queue.then(async () => {
      const before = readLog();
      const { notify, log } = alertsToNotify(shownAlerts(pc.alerts, alertKindsOff()), parse(before), Date.now());
      const after = JSON.stringify(log);
      if (after !== before) { try { localStorage.setItem(LOG, after); } catch { /* storage unavailable */ } }
      if (!notify.length || (await focused())) return;
      if (!(await (permission ??= allowed().catch(() => false)))) return;
      for (const a of notify) sendNotification({ title: a.title, body: a.detail });
    }).catch(() => {});
  });
}
