// Applies a fix to made-up settings, the way the Windows helper applies it
// to real ones, and returns the call that undoes it. The registry values,
// services and power settings the newer fixes change aren't in the facts, so
// each set of made-up facts carries a few of its own beside them.

import { powerSettingOf, powerSettings, registryKeyOf, registryRawOf, type ActionCall, type FixNow, type RegistryRaw, type ServiceStart, type UndoCall } from "../actions";
import type { Inventory, SystemFacts } from "../telemetry";

interface DemoSettings {
  registry: Map<string, RegistryRaw>;
  services: Map<string, { start: ServiceStart; display: string }>;
  power: Map<string, { ac: number; dc: number }>;
}

const demoServices: [string, ServiceStart, string][] = [
  ["SysMain", "automatic", "SysMain"], ["Spooler", "automatic", "Print Spooler"], ["DiagTrack", "automatic", "Connected User Experiences and Telemetry"],
  ["WSearch", "automaticDelayed", "Windows Search"], ["XblGameSave", "manual", "Xbox Live Game Save"], ["Fax", "disabled", "Fax"],
];
const demoPower: Record<string, [number, number]> = {
  usbSelectiveSuspend: [1, 1], pcieLinkState: [0, 2], sleepAfter: [1800, 900], displayOffAfter: [600, 300], hibernateAfter: [0, 10800], processorMin: [5, 5], coolingPolicy: [1, 0],
};

const settings = new WeakMap<SystemFacts, DemoSettings>();
function settingsOf(f: SystemFacts): DemoSettings {
  let s = settings.get(f);
  if (!s) {
    s = {
      registry: new Map([["HKCU\\Control Panel\\Desktop\\MenuShowDelay".toLowerCase(), registryRawOf("string", "400")]]),
      services: new Map(demoServices.map(([name, start, display]) => [name.toLowerCase(), { start, display }])),
      power: new Map(powerSettings.filter((p) => demoPower[p.id]).map((p) => [p.id, { ac: demoPower[p.id][0], dc: demoPower[p.id][1] }])),
    };
    settings.set(f, s);
  }
  return s;
}

const regId = (key: string, name: string) => `${registryKeyOf(key) ?? key}\\${name}`.toLowerCase();

function service(f: SystemFacts, name: string) {
  const s = settingsOf(f).services.get(name.toLowerCase());
  if (!s) throw new Error(`There's no service called ${name} on this PC.`);
  return s;
}

function power(f: SystemFacts, subgroup: string, setting: string) {
  const info = powerSettingOf(subgroup, setting);
  if (!info) throw new Error("That isn't one of Rig's power settings.");
  const now = info.id === "processorMax" ? f.maxProcessorState : settingsOf(f).power.get(info.id);
  if (!now) throw new Error("This PC's power plan doesn't have that setting.");
  return { info, now };
}

/** What a newer fix's target holds in the made-up settings, as the helper's read would say. Undefined for the older fixes. */
export function demoNow(f: SystemFacts, call: ActionCall): FixNow | undefined {
  switch (call.kind) {
    case "registry.set": return { kind: "registry.set", was: settingsOf(f).registry.get(regId(call.key, call.name)) ?? null };
    case "service.startType": { const s = service(f, call.name); return { kind: "service.startType", start: s.start, display: s.display }; }
    case "power.setting": return { kind: "power.setting", ...power(f, call.subgroup, call.setting).now };
    default: return undefined;
  }
}

export function applyToFacts(inv: Inventory, f: SystemFacts, call: UndoCall): UndoCall {
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
    case "registry.set": case "registry.restore": {
      const reg = settingsOf(f).registry, id = regId(call.key, call.name);
      const was = reg.get(id) ?? null;
      const next = call.kind === "registry.set" ? registryRawOf(call.type, call.value) : call.was;
      if (next) reg.set(id, next); else reg.delete(id);
      return { kind: "registry.restore", key: registryKeyOf(call.key) ?? call.key, name: call.name, was };
    }
    case "service.startType": {
      const s = service(f, call.name);
      const was = s.start;
      s.start = call.start;
      return { kind: "service.startType", name: call.name, start: was };
    }
    case "power.setting": {
      const { info, now } = power(f, call.subgroup, call.setting);
      const was = { ...now };
      if (info.id === "processorMax") f.maxProcessorState = { ac: call.ac, dc: call.dc };
      else settingsOf(f).power.set(info.id, { ac: call.ac, dc: call.dc });
      return { kind: "power.setting", subgroup: info.subgroup, setting: info.setting, ...was };
    }
  }
}
