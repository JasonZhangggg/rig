// The desktop app's client. It reads this PC through the Windows helper,
// keeps temperature history and the change log on disk, makes changes only
// from the fix catalog (saving the undo first), and, when signed in, uploads
// the view so the website shows it and reaches the other PCs on the account.

import { describeCall, titleFor, validateCall, type ActionCall } from "./actions";
import type { MachineSync } from "./api";
import type { CloudClient } from "./cloud";
import type { AppliedCall, Change, ChatEvent, ChatMessage, Range, RigClient } from "./client";
import { cpuTemp, gpuTemp } from "./health";
import { HISTORY_WINDOW_MS, type DiffRow, type Game, type HistoryPoint, type PC } from "./model";
import { findSensor, type Inventory, type Snapshot, type SystemFacts } from "./telemetry";
import { suggestUpgrades } from "./upgrades";
import { buildPC, type DayMax, type Identity } from "./view";

/** The elevated Windows helper (or a stand-in), one call at a time. */
export interface HelperLink {
  hello(): Promise<{ version: string; elevated: boolean }>;
  inventory(): Promise<Inventory>;
  facts(): Promise<SystemFacts>;
  snapshot(): Promise<Snapshot>;
  /** Makes one catalog change and returns the call that puts it back. */
  apply(call: ActionCall): Promise<ActionCall>;
}

/** Small on-disk store kept by the desktop shell (SQLite). */
export interface LocalStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  addHistory(p: HistoryPoint): Promise<void>;
  history(sinceMs: number): Promise<HistoryPoint[]>;
  changes(): Promise<Change[]>;
  putChange(c: Change): Promise<void>;
}

export interface LocalOptions {
  /** How often to read sensors. */
  tickMs?: number;
  /** One history point per this many milliseconds (highest temperatures in the window). */
  historyEveryMs?: number;
  /** Upload to the account this often while signed in. */
  syncEveryMs?: number;
  /** Settings are re-read this often, and right after every change. */
  factsEveryMs?: number;
  now?: () => number;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const rangeMs: Record<Range, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };
const dayKey = (t: number) => new Date(t).toDateString();
const max = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
const round = (v: number | null) => (v == null ? null : Math.round(v));
const fastestFan = (s: Snapshot | null) =>
  s?.sensors.reduce<number | null>((top, x) => (x.type === "fan" && x.value != null && x.value > 0 ? max(top, x.value) : top), null) ?? null;
const mostSeen = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

export class LocalClient implements RigClient {
  readonly kind = "desktop" as const;
  readonly caps = { local: true, applyChanges: true };

  private inv: Inventory | null = null;
  private facts: SystemFacts | null = null;
  private factsAt = 0;
  private snap: Snapshot | null = null;
  private identity: Identity & { at?: string } = {};
  private dayMax: DayMax = {};
  private day = "";
  private window: { cpu: number | null; gpu: number | null; fan: number | null; busy: boolean; games: Map<string, number>; from: number } | null = null;
  private unsynced: HistoryPoint[] = [];
  private listeners = new Set<(pc: PC) => void>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private ready: Promise<void> | null = null;
  private busy = false;
  private lastError: string | null = null;
  private o: Required<LocalOptions>;

  constructor(private link: HelperLink, private store: LocalStore, private cloud: CloudClient | null, opts: LocalOptions = {}) {
    this.o = { tickMs: 2000, historyEveryMs: HISTORY_WINDOW_MS, syncEveryMs: 5 * 60_000, factsEveryMs: 30_000, now: Date.now, ...opts };
    if (!cloud?.signInWithBrowser) (this as Partial<Record<"signInWithBrowser", unknown>>).signInWithBrowser = undefined;
  }

  /** This PC's id, from the helper's inventory (a hash of Windows' machine id). */
  get id() { return this.inv?.machine.id ?? "this-pc"; }

  /** Reads the PC and starts the sensor, history and sync timers. Safe to call more than once. */
  start(): Promise<void> {
    this.ready ??= (async () => {
      [this.inv, this.facts, this.identity] = await Promise.all([
        this.link.inventory(), this.link.facts(), this.store.get<Identity>("identity").then((v) => v ?? {}),
      ]);
      this.factsAt = this.o.now();
      this.unsynced = await this.store.get<HistoryPoint[]>("unsynced") ?? [];
      await this.tick();
      this.timers.push(setInterval(() => void this.tick(), this.o.tickMs));
      if (this.cloud) {
        this.timers.push(setInterval(() => void this.sync(), this.o.syncEveryMs));
        void this.sync();
      }
    })();
    return this.ready;
  }

  stop() { this.timers.forEach(clearInterval); this.timers = []; this.ready = null; }

  /** One sensor read: updates the live view, today's highs and the history window. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.o.now();
      if (now - this.factsAt > this.o.factsEveryMs) { this.facts = await this.link.facts(); this.factsAt = now; }
      this.snap = await this.link.snapshot();
      this.lastError = null;
      if (dayKey(now) !== this.day) { this.day = dayKey(now); this.dayMax = {}; }
      for (const s of this.snap.sensors) if (s.type === "temperature" && s.value != null) this.dayMax[s.id] = Math.max(this.dayMax[s.id] ?? 0, s.value);
      await this.record(now);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
    this.emit();
  }

  private async record(now: number) {
    const cpu = cpuTemp(this.snap)?.value ?? null;
    const gpu = gpuTemp(this.snap)?.value ?? null;
    const fan = fastestFan(this.snap);
    const game = this.snap?.game || null;
    const busy = !!game || (findSensor(this.snap, "gpu", "load", /core|d3d 3d/i)?.value ?? 0) > 70 || (findSensor(this.snap, "cpu", "load", /total/i)?.value ?? 0) > 70;
    const w = this.window ??= { cpu: null, gpu: null, fan: null, busy: false, games: new Map(), from: now };
    w.cpu = max(w.cpu, cpu); w.gpu = max(w.gpu, gpu); w.fan = max(w.fan, fan); w.busy ||= busy;
    if (game) w.games.set(game, (w.games.get(game) ?? 0) + 1);
    if (now - w.from >= this.o.historyEveryMs) {
      const p: HistoryPoint = { t: w.from, cpu: round(w.cpu), gpu: round(w.gpu), busy: w.busy, fan: round(w.fan), game: mostSeen(w.games) };
      this.window = null;
      await this.store.addHistory(p);
      this.unsynced.push(p);
      await this.store.set("unsynced", this.unsynced.slice(-720));
    }
  }

  /** The live view of this PC. */
  view(): PC {
    if (!this.inv) throw new Error("Rig hasn't read this PC yet.");
    const { findings: _f, ...pc } = buildPC(this.inv, this.snap, this.facts, this.identity, this.dayMax);
    pc.id = this.id;
    if (this.lastError && !this.snap) pc.summary = `Rig can't read the sensors right now. ${this.lastError}`;
    return pc;
  }

  private emit() { if (this.inv) { const pc = this.view(); this.listeners.forEach((cb) => cb(pc)); } }
  private isLocal(id: string) { return id === this.id; }
  private signedIn() { return this.cloud?.signedIn() ?? Promise.resolve(false); }

  /** Uploads this PC to the account so the website shows it. Quietly does nothing when signed out. */
  async sync() {
    if (!this.cloud || !this.inv || !this.facts || !(await this.signedIn())) return;
    const payload: MachineSync = {
      at: new Date(this.o.now()).toISOString(), view: this.view(), inventory: this.inv, facts: this.facts,
      history: this.unsynced, changes: (await this.changes(this.id)).slice(0, 200), games: await this.games(this.id),
      identity: { name: this.identity.name, accent: this.identity.accent, cleanedAt: this.identity.cleanedAt }, identityAt: this.identity.at,
    };
    const sent = payload.history.length;
    try {
      const reply = await this.cloud.sync(this.id, payload);
      this.unsynced = this.unsynced.slice(sent);
      await this.store.set("unsynced", this.unsynced);
      // Renamed on the website since this PC last changed it: take the website's version.
      if (reply?.identityAt && (!this.identity.at || reply.identityAt > this.identity.at)) {
        this.identity = { ...reply.identity, at: reply.identityAt };
        await this.store.set("identity", this.identity);
        this.emit();
      }
    } catch { /* try again on the next round */ }
  }

  // ----- Account -----
  async account() { return this.cloud ? this.cloud.account().catch(() => null) : null; }
  async signOut() { await this.cloud?.signOut(); }
  async signInWithBrowser() {
    const r = await this.cloud!.signInWithBrowser!();
    return { ...r, done: r.done.then(async (a) => { await this.sync(); return a; }) };
  }

  // ----- PCs -----
  async machines(): Promise<PC[]> {
    await this.start();
    const others = (await this.signedIn()) ? await this.cloud!.machines().catch(() => []) : [];
    return [this.view(), ...others.filter((p) => p.id !== this.id)];
  }

  watch(id: string, cb: (pc: PC) => void) {
    if (!this.isLocal(id)) return this.cloud?.watch(id, cb) ?? (() => {});
    this.listeners.add(cb);
    void this.start().then(() => this.listeners.has(cb) && cb(this.view()));
    return () => { this.listeners.delete(cb); };
  }

  async rename(id: string, patch: Identity) {
    if (!this.isLocal(id)) return this.cloud?.rename(id, patch);
    this.identity = { ...this.identity, ...patch, at: new Date(this.o.now()).toISOString() };
    await this.store.set("identity", this.identity);
    this.emit();
    void this.sync();
  }

  async history(id: string, range: Range): Promise<HistoryPoint[]> {
    if (!this.isLocal(id)) return this.cloud?.history(id, range) ?? [];
    return this.store.history(this.o.now() - rangeMs[range]);
  }

  async upgrades(id: string) {
    if (!this.isLocal(id)) return this.cloud?.upgrades(id) ?? [];
    await this.start();
    return suggestUpgrades(this.inv!);
  }

  async games(id: string): Promise<Game[]> {
    if (!this.isLocal(id)) return this.cloud?.games(id) ?? [];
    return (await this.store.get<Game[]>("games")) ?? [];
  }

  async changes(id: string): Promise<Change[]> {
    if (!this.isLocal(id)) return this.cloud?.changes(id) ?? [];
    return (await this.store.changes()).sort((a, b) => b.at.localeCompare(a.at));
  }

  // ----- Changes -----
  private local(id: string) {
    if (!this.isLocal(id)) throw new Error("Changes are made from the Rig app on that PC.");
  }

  private async freshFacts() {
    this.facts = await this.link.facts();
    this.factsAt = this.o.now();
    return this.facts;
  }

  async preview(id: string, calls: ActionCall[]): Promise<DiffRow[]> {
    this.local(id);
    await this.start();
    for (const c of calls) { const bad = validateCall(c); if (bad) throw new Error(bad); }
    const facts = await this.freshFacts();
    return calls.map((c) => describeCall(c, facts, this.inv!.displays));
  }

  /** Runs calls in order. If one fails, the ones before it are put back and nothing is left half done. */
  private async run(pairs: { call: ActionCall; row: DiffRow }[]): Promise<AppliedCall[]> {
    const done: AppliedCall[] = [];
    try {
      for (const { call, row } of pairs) done.push({ call, undo: await this.link.apply(call), row });
      return done;
    } catch (e) {
      for (const a of [...done].reverse()) await this.link.apply(a.undo).catch(() => {});
      throw new Error(`${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
    } finally {
      await this.freshFacts().catch(() => {});
      this.inv = await this.link.inventory().catch(() => this.inv);
      this.emit();
    }
  }

  async apply(id: string, calls: ActionCall[], meta: { title?: string; why?: string; by: "you" | "rig" }): Promise<Change> {
    const rows = await this.preview(id, calls);
    const applied = await this.run(calls.map((call, i) => ({ call, row: rows[i] })));
    const change: Change = {
      id: uid(), machineId: this.id, at: new Date(this.o.now()).toISOString(), title: meta.title ?? titleFor(calls),
      by: meta.by, status: "applied", why: meta.why ?? "", result: "", diff: rows, applied,
    };
    await this.store.putChange(change);
    void this.sync();
    return change;
  }

  private async change(id: string, changeId: string) {
    this.local(id);
    const c = (await this.store.changes()).find((x) => x.id === changeId);
    if (!c) throw new Error("That change isn't in the log.");
    return c;
  }

  async undo(id: string, changeId: string): Promise<Change> {
    const c = await this.change(id, changeId);
    if (c.status !== "applied") return c;
    await this.run([...c.applied].reverse().map((a) => ({ call: a.undo, row: a.row })));
    const next: Change = { ...c, status: "undone" };
    await this.store.putChange(next);
    void this.sync();
    return next;
  }

  async redo(id: string, changeId: string): Promise<Change> {
    const c = await this.change(id, changeId);
    if (c.status === "applied") return c;
    const applied = await this.run(c.applied.map((a) => ({ call: a.call, row: a.row })));
    const next: Change = { ...c, status: "applied", applied };
    await this.store.putChange(next);
    void this.sync();
    return next;
  }

  // ----- Chat -----
  async chat(id: string, history: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
    if (!this.cloud || !(await this.signedIn())) {
      onEvent({ type: "error", message: "Sign in to ask Rig. Answers come from Rig's servers, which read your parts' manuals." });
      onEvent({ type: "done" });
      return;
    }
    const live = this.isLocal(id) && this.inv && this.facts ? { view: this.view(), facts: this.facts } : undefined;
    await this.cloud.chat(id, history, onEvent, signal, live);
  }
}

/** A LocalStore in memory, for tests and for running the desktop UI in a browser. */
export class MemoryStore implements LocalStore {
  private kv = new Map<string, unknown>();
  private points: HistoryPoint[] = [];
  private log = new Map<string, Change>();
  async get<T>(k: string) { return (this.kv.has(k) ? structuredClone(this.kv.get(k)) : null) as T | null; }
  async set(k: string, v: unknown) { this.kv.set(k, structuredClone(v)); }
  async addHistory(p: HistoryPoint) { this.points.push(p); }
  async history(since: number) { return this.points.filter((p) => p.t >= since); }
  async changes() { return [...this.log.values()].map((c) => structuredClone(c)); }
  async putChange(c: Change) { this.log.set(c.id, structuredClone(c)); }
}
