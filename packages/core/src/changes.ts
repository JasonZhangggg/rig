// What changed on a PC, from the updates and installs Windows logs, and Windows'
// own memory test results. Rig uses these to say when a problem started right
// after a change, which is often the quickest thing to undo.

import type { PCEvent, RawEvent } from "./recordings";

/** A change Windows logged: an update, a driver or an app install. */
export interface PCChange {
  t: number;
  /** In a few words, like "the NVIDIA graphics driver" or "Windows update KB5046617". */
  what: string;
  type: "update" | "driver" | "app";
  /** The graphics driver changed. */
  graphics: boolean;
}

const graphicsInf: [RegExp, string][] = [
  [/^nv_?disp|^nvlt|^nvdm|^nvam|^nvac/i, "NVIDIA"],
  [/^(u\d{6,7}|c\d{6,7}|amdkmdag|atiilhag)$/i, "AMD"],
  [/^(iigd|igdlh|cui_dch)/i, "Intel"],
];

/** What an update or install event says changed, or null when it isn't one or didn't succeed. */
export function describeChange(e: Pick<PCEvent, "t" | "source" | "id" | "message">): PCChange | null {
  const msg = e.message;
  if (/windowsupdateclient/i.test(e.source) && e.id === 19) {
    const title = /following update:\s*(.+?)\s*$/i.exec(msg)?.[1] ?? msg;
    const kb = /\b(KB\d{6,8})\b/i.exec(title)?.[1]?.toUpperCase();
    // Drivers from Windows Update are titled like "NVIDIA - Display - 32.0.15.6094".
    const drv = /^(.+?)\s+-\s+(display|.+?)\s+-\s+[\d.]+/i.exec(title);
    if (drv) {
      const graphics = /display/i.test(drv[2]);
      return { t: e.t, type: "driver", graphics, what: graphics ? `the ${drv[1].replace(/,.*$/, "").trim()} graphics driver (from Windows Update)` : `a ${drv[1].trim()} driver (from Windows Update)` };
    }
    return { t: e.t, type: "update", graphics: false, what: kb ? `Windows update ${kb}` : "a Windows update" };
  }
  if (/userpnp/i.test(e.source) && e.id === 20001) {
    const status = /status:?\s*(0x[0-9a-f]+)/i.exec(msg)?.[1];
    if (status && parseInt(status, 16) !== 0) return null;
    const inf = /install driver\s+(?:[^\s\\]+\\)?([^\s\\]+?\.inf)/i.exec(msg)?.[1] ?? /([\w-]+\.inf)/i.exec(msg)?.[1];
    const base = inf?.replace(/\.inf.*$/i, "").toLowerCase();
    const maker = base ? graphicsInf.find(([re]) => re.test(base))?.[1] : undefined;
    if (maker) return { t: e.t, type: "driver", graphics: true, what: `the ${maker} graphics driver` };
    return base ? { t: e.t, type: "driver", graphics: false, what: `a driver (${base})` } : null;
  }
  if (/^msiinstaller$/i.test(e.source)) {
    const name = /^product:\s*(.+?)\s+--\s+installation completed successfully/i.exec(msg)?.[1] ?? /product name:\s*(.+?)\.\s+product version/i.exec(msg)?.[1];
    if (!name || (e.id === 1033 && /installation success or error status:\s*[1-9]/i.test(msg))) return null;
    return { t: e.t, type: "app", graphics: /nvidia|radeon|amd software|intel.*graphics/i.test(name), what: name.trim().slice(0, 60) };
  }
  return null;
}

/** Windows Memory Diagnostic's verdict, from its result event. */
export function memoryTest(e: Pick<RawEvent, "source" | "message">): "passed" | "failed" | null {
  if (!/memorydiagnostics-results/i.test(e.source)) return null;
  if (/no errors/i.test(e.message)) return "passed";
  return /errors/i.test(e.message) ? "failed" : null;
}

