// A pretend Windows helper: the same calls as the real one, answered from the
// demo fixtures. The desktop app uses it when it isn't running on Windows,
// and the tests use it to drive LocalClient.

import { validateCall, type ActionCall } from "../actions";
import type { HelperLink } from "../local";
import type { Inventory, Snapshot, SystemFacts } from "../telemetry";
import { applyToFacts } from "./apply";
import { demoEvents, demoProcesses } from "./logs";
import { simulate } from "./simulate";

export class SimulatedLink implements HelperLink {
  private inv: Inventory;
  private f: SystemFacts;
  constructor(inv: Inventory, facts: SystemFacts, private opts: { dust?: number; now?: () => number } = {}) {
    this.inv = structuredClone(inv);
    this.f = structuredClone(facts);
  }
  async hello() { return { version: "simulated", elevated: true }; }
  async inventory() { return structuredClone(this.inv); }
  async facts() { return structuredClone(this.f); }
  async snapshot(): Promise<Snapshot> { return simulate(this.inv, (this.opts.now ?? Date.now)(), { dust: this.opts.dust ?? 0 }); }
  async events(sinceMs: number) { return demoEvents(this.inv.machine.kind, (this.opts.now ?? Date.now)(), sinceMs); }
  async processes() { return demoProcesses(this.inv, (this.opts.now ?? Date.now)()); }
  async apply(call: ActionCall) {
    const bad = validateCall(call);
    if (bad) throw new Error(bad);
    return applyToFacts(this.inv, this.f, call);
  }
}
