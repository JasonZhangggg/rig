import type { Manual, ManualDiagram, ManualHit, ManualPage, ManualTarget } from "../manuals";
import { describeCall } from "../actions";
import { suggestedOff } from "../startup";
import { appliedHelperStep, cardTier, fixSteps, runRows, stepsTitle, type AppliedStep, type ApplyReply, type FixStep, type HelperStep, type PreviewReply, type Step, type UndoReply } from "../change";
import { demoApply, demoCards, demoCardByNonce, demoCardByStep, demoCardByUndo, demoCardFor, demoPreview, demoProposal, demoStep, demoUndo } from "./cards";
import { rangeMs, type ApplyMeta, type Change, type ChatEvent, type ChatMessage, type RigClient, type Range } from "../client";
import { HISTORY_WINDOW_MS, type DiffRow, type Game, type HistoryPoint, type PC } from "../model";
import type { Inventory, Sensor, StorageScan, SystemFacts } from "../telemetry";
import { buildPC, type DayMax, type Identity } from "../view";
import { suggestUpgrades } from "../upgrades";
import { shopFor } from "../shop";
import { makeExport, type DataExport } from "../export";
import { simulate } from "./simulate";
import { HistoryWindow } from "../history";
import { emptyAlertState, stepAlerts, USUAL, withAlerts, type AlertState } from "../alerts";
import { applyToFacts, demoNow } from "./apply";
import { MemoryStore } from "../local";
import { Recorder } from "../recorder";
import { checkRequest, cleanEvents, limitsOf, toInfo, toRequest, type Recording, type RecordingInfo } from "../recordings";
import { demoBackground } from "./background";
import { isBackground } from "../background";
import { DEMO_RECORDING_ID, demoConversation, demoEvents, demoProcesses, demoRecording } from "./logs";
import { demoScan } from "./storage";
import { DemoManuals } from "./manualShelf";
import { makerName } from "../manualParts";
import atlasInv from "./fixtures/atlas.inventory.json";
import pebbleInv from "./fixtures/pebble.inventory.json";
import atlasFacts from "./fixtures/atlas.facts.json";
import pebbleFacts from "./fixtures/pebble.facts.json";

export { simulate } from "./simulate";
export { activityAt, type Activity } from "./schedule";
export { applyToFacts } from "./apply";
export { SimulatedLink } from "./link";
export { DEMO_RECORDING_ID, demoEvents, demoProcesses, demoRecording } from "./logs";
export { DemoManuals } from "./manualShelf";
export { demoScan } from "./storage";
export { demoApply, demoCards, demoNativeCards, demoPreview, demoProposal, demoStep, demoUndo, demoUndoRecord, type AnyDemoCard, type DemoCard, type DemoNativeCard } from "./cards";
export { sampleBoardManual, sampleLaptopGuide, render as renderSampleManual } from "./manuals";
export { writePdf, PdfPage } from "./pdf";
export const fixtures = { atlas: { inv: atlasInv as Inventory, facts: atlasFacts as SystemFacts }, pebble: { inv: pebbleInv as Inventory, facts: pebbleFacts as SystemFacts } };

interface DemoPC { inv: Inventory; facts: SystemFacts; id: Identity; dust: number; dayMax: DayMax; seen?: Record<string, [number, number]>; changes: Change[]; alerts: AlertState; recent?: { at: number; points: HistoryPoint[] }; windows?: Map<number, HistoryPoint>; recorder: Recorder; recListeners: Set<(list: RecordingInfo[]) => void>; scan: StorageScan; bg?: { at: number; recs: Recording[] }; making?: Promise<Recording[]> }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

const demoGames: Game[] = [
  { id: "cp2077", name: "Cyberpunk 2077", res: "2560 × 1440", now: { avg: 78, low: 61 }, tuned: { avg: 96, low: 74 }, settings: [["DLSS", "Off", "Quality"], ["Ray tracing", "Ultra", "Medium"], ["Crowd density", "High", "Medium"]], measured: "Sample numbers in the demo" },
  { id: "cs2", name: "Counter-Strike 2", res: "2560 × 1440", now: { avg: 312, low: 168 }, tuned: { avg: 341, low: 205 }, settings: [["NVIDIA Reflex", "On", "On + Boost"], ["Shader detail", "High", "Low"]], measured: "Sample numbers in the demo" },
];

/** A whole Rig backend in memory, for the website's demo and for development. */
function see(seen: Record<string, [number, number]>, s: Sensor) {
  if (s.value == null) return;
  const [lo, hi] = seen[s.id] ?? [s.value, s.value];
  seen[s.id] = [Math.min(lo, s.value), Math.max(hi, s.value)];
}

function fixesOnly(steps: Step[]): FixStep[] {
  return steps.map((s) => { if (s.kind !== "fix") throw new Error("A command step runs from its own card."); return s; });
}

export class DemoClient implements RigClient {
  /** How long approval steps pretend to take, as a share of the website's pace. Tests set 0. */
  static pace = 1;
  readonly kind = "demo" as const;
  readonly caps = { local: true, applyChanges: true };
  private pcs: Record<string, DemoPC>;
  private listeners = new Map<string, Set<(pc: PC) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** When the demo started: dust builds up over the month before it. */
  private readonly born = Date.now();
  /** Manuals per PC, in memory. Atlas starts with its board manual found and read. */
  readonly shelf = new DemoManuals();
  /** Nonces work once, as they do in the helper. */
  private used = new Set<string>();

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
        onChange: () => { const p = this.pcs[inv.machine.id]; if (p) recListeners.forEach((cb) => cb(this.recordingList(p))); },
      });
      return { inv: structuredClone(inv), facts: structuredClone(facts), id, dust, dayMax: {}, changes: [], alerts: emptyAlertState(), recorder, recListeners, scan: demoScan(inv, Date.now() - 3 * 36e5) };
    };
    this.pcs = {
      // Atlas's owner already told Rig which graphics card it is, since Windows' ids don't name it.
      "demo-atlas": mk(fixtures.atlas.inv, fixtures.atlas.facts, { name: "Atlas", accent: "#E8692E", picks: { gpu: "msi-ventus2x-4070s-oc" } }, 1),
      "demo-pebble": mk(fixtures.pebble.inv, fixtures.pebble.facts, { name: "Pebble", accent: "#3C7BF0" }, 0),
    };
    const board = this.pcs["demo-atlas"].inv.board;
    this.shelf.seed("demo-atlas", { part: "motherboard", kind: "motherboard", maker: makerName(board.manufacturer), model: board.product, source: "detected" });
    const day = 864e5;
    this.pcs["demo-atlas"].changes.push({
      id: "seed1", machineId: "demo-atlas", at: new Date(Date.now() - 5 * day).toISOString(), title: "Turned off NVIDIA Broadcast at startup", by: "rig", status: "applied",
      why: "It started with Windows but you never use it.", result: "", diff: [["NVIDIA Broadcast", "Starts with Windows", "Off"]],
      tier: 1, applied: [{ step: { kind: "fix", call: { kind: "startup.app", name: "NVIDIA Broadcast", enabled: false } }, undo: { kind: "fix", call: { kind: "startup.app", name: "NVIDIA Broadcast", enabled: true } }, rows: [["NVIDIA Broadcast", "Starts with Windows", "Off"]] }],
    });
  }

  private view(id: string): PC {
    const p = this.pcs[id];
    const now = Date.now();
    const snap = simulate(p.inv, now, { dust: p.dust });
    for (const s of snap.sensors) if (s.type === "temperature" && s.value != null) p.dayMax[s.id] = Math.max(p.dayMax[s.id] ?? 0, s.value);
    // Lowest and highest of each sensor since Rig started, as the hardware monitor keeps them. The demo "started" six hours ago.
    if (!p.seen) {
      p.seen = {};
      for (let t = now - 6 * 36e5; t < now; t += HISTORY_WINDOW_MS / 2) for (const s of simulate(p.inv, t, { dust: p.dust }).sensors) see(p.seen, s);
    }
    for (const s of snap.sensors) { see(p.seen, s); [s.min, s.max] = p.seen[s.id] ?? [null, null]; }
    if (!p.recent || now - p.recent.at > HISTORY_WINDOW_MS) p.recent = { at: now, points: this.points(p, now - USUAL.baselineFrom * 864e5, now) };
    const { state, alerts } = stepAlerts(p.alerts, { inv: p.inv, snap, history: p.recent.points, now });
    p.alerts = state;
    const { findings: _f, ...pc } = buildPC(p.inv, snap, p.facts, p.id, p.dayMax, { scan: p.scan });
    return withAlerts({ ...pc, lastSync: "Demo PC" }, alerts);
  }

  private emit(id: string) { this.listeners.get(id)?.forEach((cb) => cb(this.view(id))); }

  /** Measures the demo drives again: running for a few seconds, then the same sizes, measured just now. */
  async measureDrives(machineId: string) {
    const p = this.pcs[machineId];
    if (!p) throw new Error("Open Rig on that PC to measure its drives.");
    if (p.scan.running) return;
    p.scan = { ...p.scan, running: true };
    this.emit(machineId);
    await sleep(4000);
    p.scan = demoScan(p.inv, Date.now());
    this.emit(machineId);
  }

  async account() { return { id: "demo", name: "You", email: "demo@rig.app" }; }
  async signOut() {}

  /** The demo PCs and a month of their made-up history, so the download can be tried. Deleting the demo account isn't offered. */
  async exportData(): Promise<DataExport> {
    const machines = await Promise.all(Object.entries(this.pcs).map(async ([id, p]) => ({
      id, view: this.view(id), inventory: p.inv, facts: p.facts, identity: { ...p.id },
      changes: await this.changes(id), games: await this.games(id), history: await this.history(id, "30d"),
      events: await this.events(id), recordings: [...await p.recorder.all(), ...await this.background(p)],
    })));
    return makeExport({ account: await this.account(), machines, notes: ["Made-up data from Rig's demo."] });
  }

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
    return this.points(p, now - rangeMs[range], now);
  }

  /** Each window is worked out once and kept, since a closed window never changes: a month is thousands of them. */
  private points(p: DemoPC, since: number, now: number): HistoryPoint[] {
    const kept = p.windows ??= new Map();
    const first = Math.ceil(since / HISTORY_WINDOW_MS) * HISTORY_WINDOW_MS;
    const out: HistoryPoint[] = [];
    for (let from = first; from + HISTORY_WINDOW_MS <= now; from += HISTORY_WINDOW_MS) {
      let point = kept.get(from);
      if (!point) {
        const dust = p.dust * Math.max(0, 1 - (this.born - from) / rangeMs["30d"]);
        const w = new HistoryWindow(from);
        for (const at of [from, from + HISTORY_WINDOW_MS / 2]) w.add(simulate(p.inv, at, { dust }));
        kept.set(from, point = w.point());
      }
      out.push(point);
    }
    for (const from of kept.keys()) if (from < now - rangeMs["30d"] - HISTORY_WINDOW_MS) kept.delete(from);
    return out;
  }

  async upgrades(id: string) { return suggestUpgrades(this.pcs[id].inv); }
  async shop(id: string) { const p = this.pcs[id]; return p ? shopFor(p.inv) : null; }
  async games(id: string) { return this.pcs[id].inv.gpus.some((g) => !g.integrated) ? demoGames : []; }

  async events(id: string) { const p = this.pcs[id]; return p ? cleanEvents(demoEvents(p.inv.machine.kind, Date.now())) : []; }

  watchRecordings(id: string, cb: (list: RecordingInfo[]) => void) {
    const p = this.pcs[id];
    if (!p) return () => {};
    p.recListeners.add(cb);
    void p.recorder.load().then(() => p.recListeners.has(cb) && cb(this.recordingList(p)));
    return () => { p.recListeners.delete(cb); };
  }

  /** Atlas's background log, made again every few minutes so today's day log keeps up. It's made in the background, and
   * whoever watches the recordings hears again once it's there. */
  private background(p: DemoPC): Promise<Recording[]> {
    const now = Date.now();
    if (p.bg && Math.abs(now - p.bg.at) <= 5 * 60_000) return Promise.resolve(p.bg.recs);
    if (!p.making) {
      p.making = demoBackground(p.inv, now, p.dust, limitsOf(this.view(p.inv.machine.id))).then((recs) => {
        p.bg = { at: now, recs };
        p.making = undefined;
        p.recListeners.forEach((cb) => cb(this.recordingList(p)));
        return recs;
      }, (e) => { p.making = undefined; throw e; });
    }
    return p.making;
  }

  /** Recordings started by the person or the chat, then the background recorder's, newest first; one that's running stays on top. */
  private recordingList(p: DemoPC): RecordingInfo[] {
    const mine = p.recorder.list();
    if (!p.bg || Math.abs(Date.now() - p.bg.at) > 5 * 60_000) void this.background(p).catch(() => {});
    const bg = (p.bg?.recs ?? []).map(toInfo);
    const at = (r: RecordingInfo) => r.startedAt ?? Date.parse(r.createdAt);
    const live = (r: RecordingInfo) => r.state === "pending" || r.state === "recording";
    return [...mine.filter(live), ...[...mine.filter((r) => !live(r)), ...bg].sort((a, b) => at(b) - at(a))];
  }

  async recording(id: string, rid: string) {
    const p = this.pcs[id];
    if (!p) return null;
    if (isBackground(rid)) { const r = (await this.background(p)).find((x) => x.id === rid); return r ? structuredClone(r) : null; }
    await p.recorder.load();
    return p.recorder.get(rid) ?? null;
  }

  async startRecording(id: string, req: { reason: string; minutes: number; question?: string }, by: "you" | "rig" = "you"): Promise<RecordingInfo> {
    const checked = checkRequest(req, { id: uid(), by, now: new Date() });
    if (typeof checked === "string") throw new Error(checked);
    return this.pcs[id].recorder.start(checked);
  }

  async stopRecording(id: string, rid: string) { await this.pcs[id]?.recorder.stop(rid); }

  conversation(id: string) { return id === "demo-atlas" ? demoConversation(this.pcs[id].inv, Date.now()) : []; }

  async changes(id: string) { return [...(this.pcs[id]?.changes ?? [])].sort((a, b) => b.at.localeCompare(a.at)); }

  async preview(id: string, steps: Step[]): Promise<DiffRow[]> {
    const p = this.pcs[id];
    return fixesOnly(steps).map((s) => describeCall(s.call, p.facts, p.inv.displays, demoNow(p.facts, s.call)));
  }

  async apply(id: string, steps: Step[], meta: ApplyMeta): Promise<Change> {
    const p = this.pcs[id];
    const rows = await this.preview(id, steps);
    await sleep(400 * DemoClient.pace);
    const applied: AppliedStep[] = fixesOnly(steps).map((step, i) => ({ step, undo: { kind: "fix", call: applyToFacts(p.inv, p.facts, step.call) }, rows: [rows[i]] }));
    const tier = cardTier(steps);
    const change: Change = { id: uid(), machineId: id, at: new Date().toISOString(), title: meta.title ?? stepsTitle(steps), by: meta.by, status: "applied", why: meta.why ?? "", result: "", diff: rows, tier: tier === "refused" ? 3 : tier, applied, from: meta.from };
    p.changes.unshift(change);
    this.emit(id);
    return change;
  }

  /** Reads the way the helper would for one of the demo's example changes. */
  async previewStep(id: string, step: HelperStep, tainted = false): Promise<PreviewReply> {
    const card = demoCardByStep(step);
    if (!this.pcs[id] || !card) throw new Error("The demo can only read its own example changes.");
    await sleep(300 * DemoClient.pace);
    return demoPreview(card, tainted);
  }

  /** Answers the way the helper would for one of the demo's example changes. Nothing on the demo PC changes. */
  async applyStep(id: string, nonce: string, meta: ApplyMeta): Promise<ApplyReply> {
    const p = this.pcs[id];
    const card = demoCardByNonce(nonce);
    if (!p || !card || this.used.has(nonce)) return { outcome: "expired" };
    this.used.add(nonce);
    await sleep(400 * DemoClient.pace);
    const reply = demoApply(card);
    if (reply.outcome !== "applied") return reply;
    const step = demoStep(card);
    const rows = runRows(reply.result, step);
    const tier = cardTier([step]);
    p.changes.unshift({
      id: uid(), machineId: id, at: new Date().toISOString(), title: meta.title ?? card.title, by: meta.by, status: "applied", why: meta.why ?? "", result: "", diff: rows,
      tier: tier === "refused" ? 3 : tier, applied: [appliedHelperStep(step, reply.undo, rows, { before: reply.result.before, after: reply.result.after })], from: meta.from,
    });
    this.emit(id);
    return reply;
  }

  async undoStep(id: string, undoId: string, force?: boolean): Promise<UndoReply> {
    const card = demoCardByUndo(undoId);
    const c = this.pcs[id]?.changes.find((x) => x.applied.some((a) => a.undo.kind !== "fix" && a.undo.id === undoId));
    if (!card || !c || c.status === "undone") return { outcome: "unknown" };
    await sleep(300 * DemoClient.pace);
    if (card.drifts && !force) return { outcome: "drifted", changed: card.drifts };
    c.status = "undone";
    this.emit(id);
    return demoUndo(card);
  }

  async undo(id: string, changeId: string) {
    const p = this.pcs[id];
    const c = p.changes.find((x) => x.id === changeId)!;
    [...c.applied].reverse().forEach((a) => { if (a.undo.kind === "fix") applyToFacts(p.inv, p.facts, a.undo.call); });
    c.status = "undone";
    this.emit(id);
    return { ...c };
  }

  async redo(id: string, changeId: string) {
    const p = this.pcs[id];
    const c = p.changes.find((x) => x.id === changeId)!;
    c.applied = c.applied.map((a) => (a.step.kind === "fix" ? { ...a, step: a.step, undo: { kind: "fix", call: applyToFacts(p.inv, p.facts, a.step.call) } } : a));
    c.status = "applied";
    this.emit(id);
    return { ...c };
  }

  // ----- Manuals -----
  async manuals(id: string): Promise<Manual[]> { return this.shelf.list(id); }
  async findManual(id: string, target: ManualTarget): Promise<Manual | null> { return this.shelf.find(id, target); }
  /** The file itself stays with the screens (their copy on this device); the demo only records that it was added. */
  async addManualFile(id: string, target: ManualTarget, file: { name: string; bytes: number }): Promise<Manual> { return this.shelf.add(id, target, file); }
  async manualFile(id: string, mid: string): Promise<ArrayBuffer> { await sleep(300); return this.shelf.file(id, mid); }
  async saveManualPages(id: string, mid: string, pages: ManualPage[], diagrams: ManualDiagram[]): Promise<Manual> { return this.shelf.save(id, mid, pages, diagrams); }
  async searchManuals(id: string, q: string, opts?: { manualId?: string; limit?: number }): Promise<ManualHit[]> { return this.shelf.search(id, q, opts); }
  async manualPage(id: string, mid: string, n: number): Promise<ManualPage | null> { return this.shelf.page(id, mid, n); }
  async removeManual(id: string, mid: string): Promise<void> { return this.shelf.remove(id, mid); }

  async chat(id: string, history: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
    const p = this.pcs[id];
    const q = history[history.length - 1]?.text.toLowerCase() ?? "";
    const say = async (text: string) => {
      for (const w of text.split(/(?<= )/)) { if (signal?.aborted) return; onEvent({ type: "text", text: w }); await sleep(18); }
    };
    const display = p.inv.displays.find((d) => d.refreshHz < d.maxRefreshHz);
    const card = demoCardFor(q);
    const refused = /steps to do this myself/.test(q) && demoCards.find((c) => c.steps);
    if (refused) {
      await say("Here's how to do it yourself in Windows Security. Rig doesn't change anything.");
      onEvent({ type: "steps", steps: refused.steps! });
    } else if (card?.key === "restartToFirmware") {
      await say(card.says);
      onEvent({ type: "steps", steps: card.steps!, firmwareSetup: true });
    } else if (card) {
      await say(card.says);
      onEvent({ type: "proposal", proposal: demoProposal(card, uid()) });
    } else if (/recording|what did (it|rig) find/.test(q)) {
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
    } else if (DemoManuals.asksManual(q)) {
      await this.shelf.answer(id, p.id.name ?? "your PC", q, say, onEvent);
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
      const on = suggestedOff(p.facts.startupApps);
      await say(`${on.length} apps start with Windows that you can open yourself when you need them. Turning them off makes startup faster and frees memory. You can still open each one normally.`);
      const steps = fixSteps(on.map((a) => ({ kind: "startup.app", name: a.name, enabled: false })));
      onEvent({ type: "proposal", proposal: { id: uid(), title: stepsTitle(steps), steps, tier: 1, rows: await this.preview(id, steps), status: "waiting" } });
    } else if (display && /screen|monitor|smooth|hz|refresh|fps|stutter/.test(q)) {
      await say(`Your ${display.name} can run at ${display.maxRefreshHz} Hz, but Windows has it at ${display.refreshHz} Hz. That's a common default after a new cable or driver. Switching makes games and scrolling look smoother and changes nothing else.`);
      const steps = fixSteps([{ kind: "display.refreshRate", display: display.name, hz: display.maxRefreshHz }]);
      onEvent({ type: "proposal", proposal: { id: uid(), title: `Run ${display.name} at ${display.maxRefreshHz} Hz`, steps, tier: 1, rows: await this.preview(id, steps), status: "waiting" } });
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
