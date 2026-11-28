// Applies a fix to made-up settings, the way the Windows helper applies it
// to real ones, and returns the call that undoes it. Most power settings
// aren't in the facts, so each set of made-up facts carries a few beside them.

import { powerSettingOf, powerSettings, type ActionCall, type FixNow } from "../actions";
import type { Inventory, SystemFacts } from "../telemetry";
import { SAVER_SETTINGS, type PowerNow } from "../battery";

const demoPower: Record<string, [number, number]> = {
  usbSelectiveSuspend: [1, 1], pcieLinkState: [0, 2], sleepAfter: [1800, 900], displayOffAfter: [600, 300], hibernateAfter: [0, 10800], processorMin: [5, 5], coolingPolicy: [1, 0],
};
/**
 * Pebble's battery side was never tuned: the screen stays on 15 minutes and it sleeps after an hour, so the battery page has
 * savers to show. Neither laptop hibernates on its own, so after the gaming laptop's bad night that's offered too.
 */
const laptopPower: Record<string, [number, number]> = { ...demoPower, sleepAfter: [1800, 3600], displayOffAfter: [600, 900], hibernateAfter: [0, 0] };

const settings = new WeakMap<SystemFacts, Map<string, { ac: number; dc: number }>>();
function settingsOf(inv: Inventory, f: SystemFacts) {
  let s = settings.get(f);
  if (!s) {
    const made = inv.machine.kind === "laptop" ? laptopPower : demoPower;
    s = new Map(powerSettings.filter((p) => made[p.id]).map((p) => [p.id, { ac: made[p.id][0], dc: made[p.id][1] }]));
    settings.set(f, s);
  }
  return s;
}

function power(inv: Inventory, f: SystemFacts, subgroup: string, setting: string) {
  const info = powerSettingOf(subgroup, setting);
  if (!info) throw new Error("That isn't one of Rig's power settings.");
  const now = info.id === "processorMax" ? f.maxProcessorState : settingsOf(inv, f).get(info.id);
  if (!now) throw new Error("This PC's power plan doesn't have that setting.");
  return { info, now };
}

/** What a power setting holds in the made-up settings, as the helper's read would say. Undefined for the other fixes. */
export function demoNow(inv: Inventory, f: SystemFacts, call: ActionCall): FixNow | undefined {
  return call.kind === "power.setting" ? { kind: "power.setting", ...power(inv, f, call.subgroup, call.setting).now } : undefined;
}

/** The power settings the battery savers look at, as the helper would read them on a demo laptop. */
export function demoSaverPower(inv: Inventory, f: SystemFacts): PowerNow {
  if (inv.machine.kind !== "laptop") return {};
  return Object.fromEntries(SAVER_SETTINGS.map((id) => [id, { ...settingsOf(inv, f).get(id)! }]));
}

/** Where the demo's games live, for the full path Windows keys an app's graphics preference by. */
const GAME_FOLDERS: Record<string, string> = { "bg3.exe": "Baldurs Gate 3\\bin", "cyberpunk2077.exe": "Cyberpunk 2077\\bin\\x64", "cs2.exe": "Counter-Strike Global Offensive\\game\\bin\\win64" };
const demoAppPath = (app: string) => `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${GAME_FOLDERS[app.toLowerCase()] ?? app.replace(/\.exe$/i, "")}\\${app}`;

export function applyToFacts(inv: Inventory, f: SystemFacts, call: ActionCall): ActionCall {
  switch (call.kind) {
    case "power.plan": {
      const was = f.powerPlans.find((p) => p.active)!;
      f.powerPlans.forEach((p) => (p.active = p.guid === call.guid));
      return { kind: "power.plan", guid: was.guid };
    }
    case "startup.app": {
      const app = f.startupApps.find((a) => a.name === call.name);
      if (!app) throw new Error(`${call.name} isn't a startup app on this PC`);
      const was = app.enabled;
      app.enabled = call.enabled;
      return { kind: "startup.app", name: call.name, enabled: was };
    }
    case "windows.gameMode": { const was = f.gameMode; f.gameMode = call.enabled; return { kind: "windows.gameMode", enabled: was }; }
    case "windows.visualEffects": { const was = f.visualEffects; f.visualEffects = call.mode; return { kind: "windows.visualEffects", mode: was === "custom" ? "auto" : was }; }
    case "power.maxProcessorState": { const was = { ...f.maxProcessorState }; f.maxProcessorState = { ac: call.ac, dc: call.dc }; return { kind: "power.maxProcessorState", ...was }; }
    case "display.refreshRate": {
      const d = inv.displays.find((x) => x.name === call.display);
      if (!d) throw new Error(`No display called ${call.display}`);
      const was = d.refreshHz;
      d.refreshHz = Math.min(call.hz, d.maxRefreshHz);
      return { kind: "display.refreshRate", display: d.name, hz: was };
    }
    case "power.setting": {
      const { info, now } = power(inv, f, call.subgroup, call.setting);
      const was = { ...now };
      if (info.id === "processorMax") f.maxProcessorState = { ac: call.ac, dc: call.dc };
      else settingsOf(inv, f).set(info.id, { ac: call.ac, dc: call.dc });
      return { kind: "power.setting", subgroup: info.subgroup, setting: info.setting, ...was };
    }
    case "display.appGpu": {
      const prefs = (f.gpuPreferences ??= {});
      const key = call.app.toLowerCase(), was = prefs[key] ?? "none";
      if (call.gpu === "none") delete prefs[key];
      else prefs[key] = call.gpu;
      return { kind: "display.appGpu", app: call.app, path: call.path ?? demoAppPath(call.app), gpu: was };
    }
  }
}
