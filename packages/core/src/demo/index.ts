import type { ActionCall } from "../actions";
import { describeCall, titleFor } from "../actions";
import { rangeMs, type Change, type ChatEvent, type ChatMessage, type RigClient, type Range } from "../client";
import { HISTORY_WINDOW_MS, type DiffRow, type Game, type HistoryPoint, type PC } from "../model";
import type { Inventory, SystemFacts } from "../telemetry";
import { buildPC, type DayMax, type Identity } from "../view";
import { suggestUpgrades } from "../upgrades";
import { simulate } from "./simulate";
import { HistoryWindow } from "../history";
import { applyToFacts } from "./apply";
import { MemoryStore } from "../local";
import { Recorder } from "../recorder";
import { checkRequest, cleanEvents, limitsOf, toInfo, toRequest, type Recording, type RecordingInfo } from "../recordings";
import { DEMO_RECORDING_ID, demoConversation, demoEvents, demoProcesses, demoRecording } from "./logs";
import atlasInv from "./fixtures/atlas.inventory.json";
import pebbleInv from "./fixtures/pebble.inventory.json";
import atlasFacts from "./fixtures/atlas.facts.json";
import pebbleFacts from "./fixtures/pebble.facts.json";

export { simulate } from "./simulate";
export { activityAt, type Activity } from "./schedule";
export { applyToFacts } from "./apply";
export { SimulatedLink } from "./link";
export { DEMO_RECORDING_ID, demoEvents, demoProcesses, demoRecording } from "./logs";
export const fixtures = { atlas: { inv: atlasInv as Inventory, facts: atlasFacts as SystemFacts }, pebble: { inv: pebbleInv as Inventory, facts: pebbleFacts as SystemFacts } };

interface DemoPC { inv: Inventory; facts: SystemFacts; id: Identity; dust: number; dayMax: DayMax; changes: Change[]; recorder: Recorder; recListeners: Set<(list: RecordingInfo[]) => void> }

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
    const mk = (inv: Inventory, facts: SystemFacts, id: Identity, dust: number): DemoPC => {
      const store = new MemoryStore();
      const recListeners = new Set<(list: RecordingInfo[]) => void>();
      // Atlas starts with the recording its example conversation asked for.
      const seed: Recording[] = inv.machine.kind === "tower" ? [demoRecording(inv, Date.now())] : [];
      void store.set("recordings", seed.map(toInfo));
      for (const r of seed) void store.set(`recording:${r.id}`, r);
      const recorder: Recorder = new Recorder({
        pcId: () => inv.machine.id, store, now: Date.now, limits: () => limitsOf(this.view(inv.machine.id)),
        source: { events: async (since) => demoEvents(inv.machine.kind, Date.now(), since), processes: async () => demoProcesses(inv, Date.now()) },
        onChange: () => recListeners.forEach((cb) => cb(recorder.list())),
      });
      return { inv: structuredClone(inv), facts: structuredClone(facts), id, dust, dayMax: {}, changes: [], recorder, recListeners };
    };
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
    const snap = simulate(p.inv, Date.now(), { dust: p.dust });
    for (const s of snap.sensors) if (s.type === "temperature" && s.value != null) p.dayMax[s.id] = Math.max(p.dayMax[s.id] ?? 0, s.value);
    const { findings: _f, ...pc } = buildPC(p.inv, snap, p.facts, p.id, p.dayMax);
    return { ...pc, lastSync: "Demo PC" };
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
    this.timer ??= setInterval(() => this.listeners.forEach((_, k) => {
      this.emit(k);
      void this.pcs[k].recorder.tick(simulate(this.pcs[k].inv, Date.now(), { dust: this.pcs[k].dust }));
    }), 2000);
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
    const out: HistoryPoint[] = [];
    for (let from = Math.ceil((now - rangeMs[range]) / HISTORY_WINDOW_MS) * HISTORY_WINDOW_MS; from + HISTORY_WINDOW_MS <= now; from += HISTORY_WINDOW_MS) {
      const dust = p.dust * (1 - (now - from) / rangeMs["30d"]);
      const w = new HistoryWindow(from);
      for (const at of [from, from + HISTORY_WINDOW_MS / 2]) w.add(simulate(p.inv, at, { dust }));
      out.push(w.point());
    }
    return out;
  }

  async upgrades(id: string) { return suggestUpgrades(this.pcs[id].inv); }
  async games(id: string) { return this.pcs[id].inv.gpus.some((g) => !g.integrated) ? demoGames : []; }

  async events(id: string) { const p = this.pcs[id]; return p ? cleanEvents(demoEvents(p.inv.machine.kind, Date.now())) : []; }

  watchRecordings(id: string, cb: (list: RecordingInfo[]) => void) {
    const p = this.pcs[id];
    if (!p) return () => {};
    p.recListeners.add(cb);
    void p.recorder.load().then(() => p.recListeners.has(cb) && cb(p.recorder.list()));
    return () => { p.recListeners.delete(cb); };
  }

  async recording(id: string, rid: string) { await this.pcs[id]?.recorder.load(); return this.pcs[id]?.recorder.get(rid) ?? null; }

  async startRecording(id: string, req: { reason: string; minutes: number; question?: string }, by: "you" | "rig" = "you"): Promise<RecordingInfo> {
    const checked = checkRequest(req, { id: uid(), by, now: new Date() });
    if (typeof checked === "string") throw new Error(checked);
    return this.pcs[id].recorder.start(checked);
  }

  async stopRecording(id: string, rid: string) { await this.pcs[id]?.recorder.stop(rid); }

  conversation(id: string) { return id === "demo-atlas" ? demoConversation(this.pcs[id].inv, Date.now()) : []; }

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
    if (/recording|what did (it|rig) find/.test(q)) {
      await p.recorder.load();
      const done = p.recorder.list().find((r) => r.state === "done" || r.state === "cancelled");
      if (done?.id === DEMO_RECORDING_ID) {
        const rec = (await p.recorder.get(done.id))!;
        const reset = rec.events[0];
        const gpu = rec.samples.filter((s) => s.t < reset.t).at(-1)?.gpu ?? 85;
        const limit = limitsOf(this.view(id)).gpu ?? 88;
        const at = new Date(reset.t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        await say(`Found it. At ${at} Windows logged that the graphics driver stopped responding and recovered. That's the black screen.\n\nIt wasn't random: the graphics card had been climbing for half an hour and was at ${gpu}°C, ${limit - gpu}° under its ${limit}°C limit, running flat out in Cyberpunk 2077. Its load fell to 4% for about twenty seconds, then the game carried on. The same reset is in the log from a week earlier, also on a Cyberpunk evening.\n\nA card that runs this close to its limit at the same settings usually has dust in the way. Clean the intake filters first; if it still happens, a clean install of the graphics driver is the next step.`);
        onEvent({ type: "steps", steps: ["Shut down and unplug the PC.", "Take off the front panel and rinse or vacuum the mesh filter.", "Blow the dust out of the graphics card's fans with short bursts of air.", "Play again and check Logs: the card should stay under 80°C."] });
        onEvent({ type: "sources", sources: [{ label: "Recording, 45 minutes", kind: "Your PC" }, { label: "Windows event log", kind: "Your PC" }] });
      } else if (done) {
        await say(`${done.headline ?? "Nothing unusual happened while Rig recorded."} This is the demo, so the readings are made up. Open Logs to see the recording's charts.`);
      } else {
        await say("There's no finished recording yet. When one finishes, I'll go through it here.");
      }
    } else if (/crash|black|freez|restart|blue ?screen|reboot|shut ?down|flicker/.test(q)) {
      await p.recorder.load();
      if (p.recorder.active()) {
        await say("I'm already recording. Check back when it finishes and I'll go through what it caught.");
      } else {
        const info = await this.startRecording(id, { reason: "Watch temperatures, load and Windows events to catch it happening.", minutes: 1, question: history[history.length - 1]?.text }, "rig");
        const back = new Date(info.endsAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        await say(`I can't tell from the latest readings alone, so I've started recording: temperatures, how hard each part works, the busiest apps and anything Windows logs. Nothing on the PC changes.\n\nOn your own PC I'd record for half an hour or more. This is the demo, so it's one minute: check back at ${back}.`);
        onEvent({ type: "recording", request: toRequest(info), queued: false });
      }
    } else if (/startup|slow|boot/.test(q)) {
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
