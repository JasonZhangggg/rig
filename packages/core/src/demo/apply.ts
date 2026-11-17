// Applies a fix to made-up settings, the way the Windows helper applies it
// to real ones, and returns the call that undoes it.

import type { ActionCall } from "../actions";
import type { Inventory, SystemFacts } from "../telemetry";

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
  }
}

