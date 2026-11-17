import type { ActionCall } from "../actions";
import { describeCall, titleFor } from "../actions";
import { rangeMs, type Change, type ChatEvent, type ChatMessage, type RigClient, type Range } from "../client";
import { HISTORY_WINDOW_MS, type DiffRow, type Game, type HistoryPoint, type PC } from "../model";
import type { Inventory, SystemFacts } from "../telemetry";
import { buildPC, type DayMax, type Identity } from "../view";
import { suggestUpgrades } from "../upgrades";
import { simulate } from "./simulate";
import { HistoryWindow } from "../history";
import { emptyAlertState, stepAlerts, USUAL, withAlerts, type AlertState } from "../alerts";
import { applyToFacts } from "./apply";
import atlasInv from "./fixtures/atlas.inventory.json";
import pebbleInv from "./fixtures/pebble.inventory.json";
import atlasFacts from "./fixtures/atlas.facts.json";
import pebbleFacts from "./fixtures/pebble.facts.json";

export { simulate } from "./simulate";
export { activityAt, type Activity } from "./schedule";
export { applyToFacts } from "./apply";
export { SimulatedLink } from "./link";
export const fixtures = { atlas: { inv: atlasInv as Inventory, facts: atlasFacts as SystemFacts }, pebble: { inv: pebbleInv as Inventory, facts: pebbleFacts as SystemFacts } };

interface DemoPC { inv: Inventory; facts: SystemFacts; id: Identity; dust: number; dayMax: DayMax; changes: Change[]; alerts: AlertState; recent?: { at: number; points: HistoryPoint[] } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

const demoGames: Game[] = [
  { id: "cp2077", name: "Cyberpunk 2077", res: "2560 × 1440", now: { avg: 78, low: 61 }, tuned: { avg: 96, low: 74 }, settings: [["DLSS", "Off", "Quality"], ["Ray tracing", "Ultra", "Medium"], ["Crowd density", "High", "Medium"]], measured: "Sample numbers in the demo" },
  { id: "cs2", name: "Counter-Strike 2", res: "2560 × 1440", now: { avg: 312, low: 168 }, tuned: { avg: 341, low: 205 }, settings: [["NVIDIA Reflex", "On", "On + Boost"], ["Shader detail", "High", "Low"]], measured: "Sample numbers in the demo" },
];

/** A whole Rig backend in memory, for the website's demo and for development. */
export class DemoClient implements RigClient {
  readonly kind = "demo" as const;
  readonly caps = { local: true, applyChanges: true };
  private pcs: Record<string, DemoPC>;
  private listeners = new Map<string, Set<(pc: PC) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const mk = (inv: Inventory, facts: SystemFacts, id: Identity, dust: number): DemoPC => ({ inv: structuredClone(inv), facts: structuredClone(facts), id, dust, dayMax: {}, changes: [], alerts: emptyAlertState() });
    this.pcs = {
      "demo-atlas": mk(fixtures.atlas.inv, fixtures.atlas.facts, { name: "Atlas", accent: "#E8692E" }, 1),
      "demo-pebble": mk(fixtures.pebble.inv, fixtures.pebble.facts, { name: "Pebble", accent: "#3C7BF0" }, 0),
    };
    const day = 864e5;
    this.pcs["demo-atlas"].changes.push({
      id: "seed1", machineId: "demo-atlas", at: new Date(Date.now() - 5 * day).toISOString(), title: "Turned off NVIDIA Broadcast at startup", by: "rig", status: "applied",
      why: "It started with Windows but you never use it.", result: "", diff: [["NVIDIA Broadcast", "Starts with Windows", "Off"]],
      applied: [{ call: { kind: "startup.app", name: "NVIDIA Broadcast", enabled: false }, undo: { kind: "startup.app", name: "NVIDIA Broadcast", enabled: true }, row: ["NVIDIA Broadcast", "Starts with Windows", "Off"] }],
    });
  }

  private view(id: string): PC {
    const p = this.pcs[id];
    const now = Date.now();
    const snap = simulate(p.inv, now, { dust: p.dust });
    for (const s of snap.sensors) if (s.type === "temperature" && s.value != null) p.dayMax[s.id] = Math.max(p.dayMax[s.id] ?? 0, s.value);
    if (!p.recent || now - p.recent.at > HISTORY_WINDOW_MS) p.recent = { at: now, points: this.points(p, now - USUAL.baselineFrom * 864e5, now) };
    const { state, alerts } = stepAlerts(p.alerts, { inv: p.inv, snap, history: p.recent.points, now });
    p.alerts = state;
    const { findings: _f, ...pc } = buildPC(p.inv, snap, p.facts, p.id, p.dayMax);
    return withAlerts({ ...pc, lastSync: "Demo PC" }, alerts);
  }

  private emit(id: string) { this.listeners.get(id)?.forEach((cb) => cb(this.view(id))); }

  async account() { return { id: "demo", name: "You", email: "demo@rig.app" }; }
  async signOut() {}

  async machines(): Promise<PC[]> {
    const live = Object.keys(this.pcs).map((id) => this.view(id));
    const den: PC = { id: "demo-den", name: "Den PC", kind: "tower", accent: "#2E9E6B", nickname: "Family desktop", os: "Windows 10 Home 22H2", health: 64, lastSync: "Last seen 3 days ago", online: false, summary: "Windows 10 no longer gets security updates." };
    return [...live, den];
  }

  watch(id: string, cb: (pc: PC) => void) {
    if (!this.pcs[id]) return () => {};
    const set = this.listeners.get(id) ?? new Set();
    set.add(cb);
    this.listeners.set(id, set);
    cb(this.view(id));
    this.timer ??= setInterval(() => this.listeners.forEach((_, k) => this.emit(k)), 2000);
    return () => {
      set.delete(cb);
      if ([...this.listeners.values()].every((s) => s.size === 0) && this.timer) { clearInterval(this.timer); this.timer = null; }
    };
  }

  async rename(id: string, patch: Identity) { Object.assign(this.pcs[id].id, patch); this.emit(id); }

  /** Ten-minute windows over the range, recorded the way the desktop app records them. Dust builds up over the month. */
  async history(id: string, range: Range): Promise<HistoryPoint[]> {
    const p = this.pcs[id];
    if (!p) return [];
    const now = Date.now();
    return this.points(p, now - rangeMs[range], now);
  }

  private points(p: DemoPC, since: number, now: number): HistoryPoint[] {
    const out: HistoryPoint[] = [];
    for (let from = Math.ceil(since / HISTORY_WINDOW_MS) * HISTORY_WINDOW_MS; from + HISTORY_WINDOW_MS <= now; from += HISTORY_WINDOW_MS) {
      const dust = p.dust * (1 - (now - from) / rangeMs["30d"]);
      const w = new HistoryWindow(from);
      for (const at of [from, from + HISTORY_WINDOW_MS / 2]) w.add(simulate(p.inv, at, { dust }));
      out.push(w.point());
    }
    return out;
  }

  async upgrades(id: string) { return suggestUpgrades(this.pcs[id].inv); }
  async games(id: string) { return this.pcs[id].inv.gpus.some((g) => !g.integrated) ? demoGames : []; }

  async changes(id: string) { return [...(this.pcs[id]?.changes ?? [])].sort((a, b) => b.at.localeCompare(a.at)); }

  async preview(id: string, calls: ActionCall[]): Promise<DiffRow[]> {
    const p = this.pcs[id];
    return calls.map((c) => describeCall(c, p.facts, p.inv.displays));
  }

  async apply(id: string, calls: ActionCall[], meta: { title?: string; why?: string; by: "you" | "rig" }): Promise<Change> {
    const p = this.pcs[id];
    const rows = await this.preview(id, calls);
    await sleep(400);
    const applied = calls.map((call, i) => ({ call, undo: applyToFacts(p.inv, p.facts, call), row: rows[i] }));
    const change: Change = { id: uid(), machineId: id, at: new Date().toISOString(), title: meta.title ?? titleFor(calls), by: meta.by, status: "applied", why: meta.why ?? "", result: "", diff: rows, applied };
    p.changes.unshift(change);
    this.emit(id);
    return change;
  }

  async undo(id: string, changeId: string) {
    const p = this.pcs[id];
    const c = p.changes.find((x) => x.id === changeId)!;
    [...c.applied].reverse().forEach((a) => applyToFacts(p.inv, p.facts, a.undo));
    c.status = "undone";
    this.emit(id);
    return { ...c };
  }

  async redo(id: string, changeId: string) {
    const p = this.pcs[id];
    const c = p.changes.find((x) => x.id === changeId)!;
    c.applied = c.applied.map((a) => ({ ...a, undo: applyToFacts(p.inv, p.facts, a.call) }));
    c.status = "applied";
    this.emit(id);
    return { ...c };
  }

  async chat(id: string, history: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
    const p = this.pcs[id];
    const q = history[history.length - 1]?.text.toLowerCase() ?? "";
    const say = async (text: string) => {
      for (const w of text.split(/(?<= )/)) { if (signal?.aborted) return; onEvent({ type: "text", text: w }); await sleep(18); }
    };
    const display = p.inv.displays.find((d) => d.refreshHz < d.maxRefreshHz);
    if (/startup|slow|boot/.test(q)) {
      const on = p.facts.startupApps.filter((a) => a.enabled && !/onedrive|teams/i.test(a.name)).slice(0, 4);
      await say(`${on.length} apps start with Windows that you can open yourself when you need them. Turning them off makes startup faster and frees memory. You can still open each one normally.`);
      const calls: ActionCall[] = on.map((a) => ({ kind: "startup.app", name: a.name, enabled: false }));
      onEvent({ type: "proposal", proposal: { id: uid(), title: titleFor(calls), calls, rows: await this.preview(id, calls), status: "waiting" } });
    } else if (display && /screen|monitor|smooth|hz|refresh|fps|stutter/.test(q)) {
      await say(`Your ${display.name} can run at ${display.maxRefreshHz} Hz, but Windows has it at ${display.refreshHz} Hz. That's a common default after a new cable or driver. Switching makes games and scrolling look smoother and changes nothing else.`);
      const calls: ActionCall[] = [{ kind: "display.refreshRate", display: display.name, hz: display.maxRefreshHz }];
      onEvent({ type: "proposal", proposal: { id: uid(), title: `Run ${display.name} at ${display.maxRefreshHz} Hz`, calls, rows: await this.preview(id, calls), status: "waiting" } });
    } else if (/loud|hot|fan|temp|noise|dust/.test(q)) {
      await say("Some noise while gaming is normal. A steady rise in graphics card temperature at the same settings usually means dust on the intake filters, and cleaning them takes about five minutes.");
      onEvent({ type: "steps", steps: ["Shut down and unplug the PC.", "Take off the front panel; most pull off from the bottom edge.", "Slide the mesh filter out and rinse or vacuum it.", "Let it dry fully, then put it back."] });
      onEvent({ type: "sources", sources: [{ label: "Your temperature history, 30 days", kind: "Your PC" }] });
    } else {
      await say("This is the demo, so I'm answering from sample data. On your own PC I read your parts' manuals and live readings, and I can make fixes after you say yes. Try asking why it's loud, why startup is slow, or whether the screen could look smoother.");
    }
    onEvent({ type: "done" });
  }
}
