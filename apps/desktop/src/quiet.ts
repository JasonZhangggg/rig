// While Rig's window can't be seen (minimised, or hidden by Windows), the app reads the PC less often and stops
// redrawing its screens; alerts still reach the notifications. Showing the window again catches up at once.

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LocalClient } from "@rig/core";

export function quietWhenHidden(client: LocalClient) {
  const win = getCurrentWindow();
  let asked = 0;
  const check = async () => {
    const n = ++asked;
    const [minimised, visible] = await Promise.all([win.isMinimized().catch(() => false), win.isVisible().catch(() => true)]);
    // A newer check started while this one waited: it has the latest answer.
    if (n === asked) client.setQuiet(document.hidden || minimised || !visible);
  };
  document.addEventListener("visibilitychange", () => void check());
  // Windows reports minimising and restoring as a resize.
  void win.onResized(() => void check());
  void win.onFocusChanged(() => void check());
  void check();
}
