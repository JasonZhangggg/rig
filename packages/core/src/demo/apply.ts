// Applies a fix to made-up settings, the way the Windows helper applies it
// to real ones, and returns the call that undoes it. Most power settings
// aren't in the facts, so each set of made-up facts carries a few beside them.

import { powerSettingOf, powerSettings, type ActionCall, type FixNow } from "../actions";
import type { Inventory, SystemFacts } from "../telemetry";

const demoPower: Record<string, [number, number]> = {
  usbSelectiveSuspend: [1, 1], pcieLinkState: [0, 2], sleepAfter: [1800, 900], displayOffAfter: [600, 300], hibernateAfter: [0, 10800], processorMin: [5, 5], coolingPolicy: [1, 0],
};

const settings = new WeakMap<SystemFacts, Map<string, { ac: number; dc: number }>>();
function settingsOf(f: SystemFacts) {
  let s = settings.get(f);
  if (!s) {
    s = new Map(powerSettings.filter((p) => demoPower[p.id]).map((p) => [p.id, { ac: demoPower[p.id][0], dc: demoPower[p.id][1] }]));
    settings.set(f, s);
  }
  return s;
}

function power(f: SystemFacts, subgroup: string, setting: string) {
  const info = powerSettingOf(subgroup, setting);
  if (!info) throw new Error("That isn't one of Rig's power settings.");
  const now = info.id === "processorMax" ? f.maxProcessorState : settingsOf(f).get(info.id);
  if (!now) throw new Error("This PC's power plan doesn't have that setting.");
  return { info, now };
}

/** What a power setting holds in the made-up settings, as the helper's read would say. Undefined for the other fixes. */
export function demoNow(f: SystemFacts, call: ActionCall): FixNow | undefined {
  return call.kind === "power.setting" ? { kind: "power.setting", ...power(f, call.subgroup, call.setting).now } : undefined;
}

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
      const { info, now } = power(f, call.subgroup, call.setting);
      const was = { ...now };
      if (info.id === "processorMax") f.maxProcessorState = { ac: call.ac, dc: call.dc };
      else settingsOf(f).set(info.id, { ac: call.ac, dc: call.dc });
      return { kind: "power.setting", subgroup: info.subgroup, setting: info.setting, ...was };
    }
  }
}
