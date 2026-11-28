// A pretend Windows helper: the same calls as the real one, answered from the
// demo fixtures. The desktop app uses it when it isn't running on Windows,
// and the tests use it to drive LocalClient.

import { validateCall, type ActionCall, type FixApplied, type FixNow } from "../actions";
import type { HelperLink } from "../local";
import type { Inventory, Snapshot, SystemFacts } from "../telemetry";
import { applyToFacts, demoNow } from "./apply";
import { demoEvents, demoProcesses } from "./logs";
import { simulate } from "./simulate";
import { demoScan } from "./storage";

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
  /** The folder scan: finished an hour ago, or just now when asked for a fresh one. */
  async storage(fresh?: boolean) { const now = (this.opts.now ?? Date.now)(); return demoScan(this.inv, fresh ? now : now - 36e5); }
  /** Calls are checked as the server checks them, undo calls included. */
  async apply(call: ActionCall): Promise<FixApplied> {
    const bad = validateCall(call);
    if (bad) throw new Error(bad);
    return { undo: applyToFacts(this.inv, this.f, call), verify: { ok: true } };
  }
  async readFix(call: ActionCall): Promise<FixNow> {
    const now = demoNow(this.inv, this.f, call);
    if (!now) throw new Error("The facts already hold this one.");
    return now;
  }
}
