// The device shorthand: turn one device off or on by its instance id. The run
// stops when the device is already that way, so undo (the opposite) puts back
// exactly what was there, and it won't turn off a part Windows needs to run or
// the last working screen adapter, keyboard or mouse.

import type { Command } from "../change";
import { plain, quote } from "./text";

export interface DeviceShorthand { instanceId: string; enabled: boolean }

/** Kinds of device Windows needs to run. Rig won't turn one off. */
export const NEEDED_CLASSES = ["System", "DiskDrive", "SCSIAdapter", "HDC", "Volume", "Processor", "Computer"];
/** Kinds Rig won't turn off when it is the last working one. */
const LAST_ONE = ["Display", "Keyboard", "Mouse"];
/** Windows' problem code for a device that is turned off. */
const DISABLED = 22;

const list = (xs: string[]) => `@(${xs.map(quote).join(", ")})`;

/** A command that turns one device off or on. */
export function deviceCommand(raw: unknown): Command | string {
  const d = (raw ?? {}) as Partial<DeviceShorthand>;
  const id = d.instanceId;
  if (typeof id !== "string" || id.length < 3 || id.length > 400 || !plain(id) || /[*?[\]`]/.test(id) || id.includes("\\\\") || id !== id.trim() || !/^[A-Za-z][A-Za-z0-9_]*\\./.test(id)) {
    return "instanceId must be the device's instance id from Get-PnpDevice, like USB\\VID_046D&PID_C52B\\5&1A2B3C&0&2, in plain letters with no wildcards";
  }
  if (typeof d.enabled !== "boolean") return "enabled must be true (turn it on) or false (turn it off)";
  const at = quote(id);
  const off = `Disable-PnpDevice -InstanceId ${at} -Confirm:$false`, on = `Enable-PnpDevice -InstanceId ${at} -Confirm:$false`;
  const found = `$d = Get-PnpDevice -InstanceId ${at} -ErrorAction Stop`;
  const run = d.enabled
    ? [found, `if ($d.ConfigManagerErrorCode -ne ${DISABLED}) { throw ${quote("This device isn't turned off, so there is nothing to turn on.")} }`, on]
    : [
        found,
        `if ($d.ConfigManagerErrorCode -eq ${DISABLED}) { throw ${quote("This device is already turned off.")} }`,
        `if ($d.Class -in ${list(NEEDED_CLASSES)}) { throw ${quote("Windows needs this device to run, so Rig won't turn it off.")} }`,
        `if ($d.Class -in ${list(LAST_ONE)} -and -not (Get-PnpDevice -Class $d.Class -PresentOnly -Status OK | Where-Object -Property InstanceId -NE -Value ${at})) { throw ${quote("It is the last working one of its kind on this PC, so Rig won't turn it off.")} }`,
        off,
      ];
  return {
    does: d.enabled ? `Turns on the device ${id}. Undo turns it off again.` : `Turns off the device ${id} until it's turned back on. Undo turns it on again.`,
    read: `Get-PnpDevice -InstanceId ${at} | Format-List -Property FriendlyName, Class, Status, Problem, InstanceId`,
    run: run.join("\n"),
    undo: d.enabled ? off : on,
    touches: [{ kind: "other", name: `Device ${id}` }],
  };
}
