// The desktop app's client. It reads this PC through the Windows helper,
// keeps temperature history and the change log on disk, makes changes only
// from the fix catalog (saving the undo first), and, when signed in, uploads
// the view so the website shows it and reaches the other PCs on the account.

import type { Manual, ManualDiagram, ManualHit, ManualPage, ManualTarget } from "./manuals";
import { searchPages } from "./manualSearch";
import { describeCall, validateCall, type ActionCall } from "./actions";
import { cardTier, changeOf, stepsTitle, type AppliedStep, type FixStep, type FixUndo, type Step, type StoredChange } from "./change";
import { emptyAlertState, stepAlerts, USUAL, withAlerts, type AlertState } from "./alerts";
import type { BoardLayoutReply, MachineSync, ReadLayoutRequest } from "./api";
import type { CloudClient } from "./cloud";
import { makeExport, type DataExport } from "./export";
import { rangeMs, type ApplyMeta, type Change, type ChatEvent, type ChatMessage, type Log, type Range, type RigClient } from "./client";
import { HistoryWindow } from "./history";
import { HISTORY_WINDOW_MS, type Alert, type DiffRow, type Game, type HistoryPoint, type PC } from "./model";
import { Recorder } from "./recorder";
import { BACKGROUND_DAYS, BackgroundLog, backgroundRecordings, isBackground, type RecorderCursor, type RecorderLink } from "./background";
import { CustomLog, customRecordings, type ProbeStatus } from "./probes";
import { checkRequest, cleanEvents, limitsOf, toInfo, type PCEvent, type ProcessUse, type RawEvent, type Recording, type RecordingInfo, type RecordingRequest } from "./recordings";
import type { Inventory, Snapshot, StorageScan, SystemFacts } from "./telemetry";
import { suggestUpgrades } from "./upgrades";
import { shopFor } from "./shop";
import { buildPC, type DayMax, type Identity } from "./view";

/** The elevated Windows helper (or a stand-in), one call at a time. */
export interface HelperLink {
  hello(): Promise<{ version: string; elevated: boolean }>;
  inventory(): Promise<Inventory>;
  facts(): Promise<SystemFacts>;
  snapshot(): Promise<Snapshot>;
  /** Makes one catalog change and returns the call that puts it back. */
  apply(call: ActionCall): Promise<ActionCall>;
  /** Windows crash and error events since a time. Read-only; missing on helpers from before recordings. */
  events?(sinceMs: number): Promise<RawEvent[]>;
  /** The busiest apps right now, by processor and memory use. Read-only. */
  processes?(): Promise<ProcessUse[]>;
  /**
   * What fills each drive, from the helper's last folder scan; it starts another in the background when that's a day old,
   * or now when `fresh`. Answers at once. Read-only; missing on helpers before 0.1.8.
   */
  storage?(fresh?: boolean): Promise<StorageScan>;
}

/** The folder scan is asked for this often, and every few seconds while one runs, so the map fills in when it's done. */
export const SCAN_ASK_MS = 30 * 60_000;
export const SCAN_RUNNING_ASK_MS = 15_000;

/** Small on-disk store kept by the desktop shell (SQLite). */
export interface LocalStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  addHistory(p: HistoryPoint): Promise<void>;
  history(sinceMs: number): Promise<HistoryPoint[]>;
  /** May hold changes stored by older versions; LocalClient reads them through changeOf. */
  changes(): Promise<StoredChange[]>;
  putChange(c: Change): Promise<void>;
}

export interface LocalOptions {
  /** How often to read sensors. */
  tickMs?: number;
  /** How often to read sensors while Rig's window is minimised or hidden (setQuiet), unless a recording runs. */
  quietTickMs?: number;
  /** One history point per this many milliseconds (highest temperatures in the window). */
  historyEveryMs?: number;
  /** Upload to the account this often while signed in. */
  syncEveryMs?: number;
  /** Settings are re-read this often, and right after every change. */
  factsEveryMs?: number;
  /** Drives and the rest of the inventory are re-read this often, so free space stays current. */
  inventoryEveryMs?: number;
  now?: () => number;
  /** Shows a notification outside the app's window when a recording finishes. */
  notify?: (n: { title: string; body: string }) => void;
  /** Rig's background recorder service, which keeps a log while the app is closed. Missing where there's none. */
  recorder?: RecorderLink | null;
  /** How often to read what the background recorder added. */
  backgroundEveryMs?: number;
  /** Debug log: each step of the first read with its timing, and sensor or sync trouble. */
  log?: Log;
}

const EVENTS_DAYS = 30;
/** History points kept for the account while signed out or offline: five days. Older ones were never going to be sent. */
const UNSYNCED_MAX = 720;
const BACKGROUND_PAGES = 30;
const EVENTS_EVERY_MS = 5 * 60_000;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const dayKey = (t: number) => new Date(t).toDateString();

export class LocalClient implements RigClient {
  readonly kind = "desktop" as const;
  readonly caps = { local: true, applyChanges: true };

  private inv: Inventory | null = null;
  private facts: SystemFacts | null = null;
  private factsAt = 0;
  private invAt = 0;
  private alertState: AlertState = emptyAlertState();
  private alerts: Alert[] = [];
  /** History the alerts compare against, oldest first. */
  private recent: HistoryPoint[] = [];
  private snap: Snapshot | null = null;
  private identity: Identity & { at?: string } = {};
  private dayMax: DayMax = {};
  private day = "";
  private window: HistoryWindow | null = null;
  private unsynced: HistoryPoint[] = [];
  private listeners = new Set<(pc: PC) => void>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private ticker: { every: number; timer: ReturnType<typeof setInterval> } | null = null;
  private running = false;
  /** Rig's window is minimised or hidden: read less often, and only tell the screens when the alerts change. */
  private quiet = false;
  private emitted = "";
  private ready: Promise<void> | null = null;
  /** What start() is waiting on, so a stalled first read can say where it's stuck. */
  private step: string | null = null;
  private busy = false;
  private lastError: string | null = null;
  private o: Required<LocalOptions>;
  private recorder: Recorder;
  private recListeners = new Set<(list: RecordingInfo[]) => void>();
  /** Recordings the account hasn't got the latest version of yet. */
  private unsent = new Set<string>();
  private eventLog: { at: number; list: PCEvent[] } | null = null;
  private eventRead: Promise<void> | null = null;
  /** What the background recorder logged, read a little at a time. Kept on this PC only: sync never sends it. */
  private bg = new BackgroundLog();
  private bgCursor: RecorderCursor | null = null;
  private bgAt = -Infinity;
  private bgReading: Promise<void> | null = null;
  private bgRecs: Recording[] = [];
  /** What the custom logs wrote, and what the recorder says about them. Kept on this PC only too. */
  private custom = new CustomLog();
  private customCursor: RecorderCursor | null = null;
  private probeStatus: ProbeStatus[] | null = null;
  /** The helper's last folder scan, and when Rig last asked for it. */
  private scan: StorageScan | null = null;
  private scanAskedAt = -Infinity;
  private scanReading: Promise<void> | null = null;

  constructor(private link: HelperLink, private store: LocalStore, private cloud: CloudClient | null, opts: LocalOptions = {}) {
    this.o = { tickMs: 2000, quietTickMs: 10_000, historyEveryMs: HISTORY_WINDOW_MS, syncEveryMs: 5 * 60_000, factsEveryMs: 30_000, inventoryEveryMs: 10 * 60_000, now: Date.now, notify: () => {}, recorder: null, backgroundEveryMs: 60_000, log: () => {}, ...opts };
    this.recorder = new Recorder({
      pcId: () => this.id, source: link, store, now: () => this.o.now(), limits: () => limitsOf(this.view()),
      onChange: () => this.emitRecordings(),
      onFinish: (r) => {
        this.o.notify({ title: "Rig finished recording", body: r.state === "failed" ? "It couldn't collect readings. Open Rig to see why." : "Open Logs in Rig to see what it found." });
        void this.sendRecording(r.id);
      },
    });
    if (!cloud?.signInWithBrowser) (this as Partial<Record<"signInWithBrowser", unknown>>).signInWithBrowser = undefined;
    if (!cloud) (this as Partial<Record<"deleteAccount", unknown>>).deleteAccount = undefined;
    if (!link.storage) (this as Partial<Record<"measureDrives", unknown>>).measureDrives = undefined;
  }

  /** This PC's id, from the helper's inventory (a hash of Windows' machine id). */
  get id() { return this.inv?.machine.id ?? "this-pc"; }

  /** Reads the PC and starts the sensor, history and sync timers. Safe to call more than once. */
  start(): Promise<void> {
    if (this.ready) return this.ready;
    const ready = this.ready = (async () => {
      const began = performance.now();
      this.o.log("info", "start: reading this PC");
      this.identity = await this.stage("opening Rig's saved data", async () => await this.store.get<Identity>("identity") ?? {});
      this.inv = await this.stage("reading this PC's parts", () => this.link.inventory());
      this.invAt = this.o.now();
      // Settings aren't needed to show the PC, so a slow read doesn't hold it up: the next tick tries again.
      this.facts = await this.stage("reading this PC's settings", () => this.link.facts()).catch(() => null);
      if (this.facts) this.factsAt = this.o.now();
      await this.stage("opening Rig's saved history", async () => {
        this.alertState = await this.store.get<AlertState>("alerts") ?? emptyAlertState();
        this.recent = await this.store.history(this.o.now() - USUAL.baselineFrom * 864e5);
        this.unsynced = await this.store.get<HistoryPoint[]>("unsynced") ?? [];
        this.unsent = new Set(await this.store.get<string[]>("recordingsUnsent") ?? []);
        await this.recorder.load();
      });
      await this.stage("taking the first sensor reading", () => this.tick());
      this.step = null;
      this.o.log("info", `start: done in ${Math.round(performance.now() - began)} ms${this.lastError ? `, but sensors failed: ${this.lastError}` : ""}`);
      this.running = true;
      this.schedule();
      if (this.cloud) {
        this.timers.push(setInterval(() => void this.sync(), this.o.syncEveryMs));
        void this.sync();
      }
    })();
    // A start that failed is tried again on the next call.
    ready.catch(() => { if (this.ready === ready) this.ready = null; });
    return ready;
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (this.ticker) clearInterval(this.ticker.timer);
    this.ticker = null;
    this.running = false;
    this.ready = null;
  }

  /**
   * Rig's window was minimised or hidden (true), or shown again (false). While quiet the sensors are read less often
   * (unless a recording runs), the background log and Windows' event log wait, and the screens hear only of alerts
   * starting or ending, so notifications still go out. Showing again brings the screens up to date at once.
   */
  setQuiet(quiet: boolean) {
    if (quiet === this.quiet) return;
    this.quiet = quiet;
    this.schedule();
    if (!quiet) { this.emit(); void this.tick(); }
  }

  /** The sensor timer at the pace for now: quick while shown or recording, slower while quiet. */
  private schedule() {
    if (!this.running) return;
    const every = this.quiet && !this.recorder.active() ? this.o.quietTickMs : this.o.tickMs;
    if (this.ticker?.every === every) return;
    if (this.ticker) clearInterval(this.ticker.timer);
    this.ticker = { every, timer: setInterval(() => void this.tick(), every) };
  }

  /** One step of the first read: named for a stalled screen, and timed in the log. */
  private async stage<T>(step: string, work: () => Promise<T>): Promise<T> {
    this.step = step;
    const t = performance.now();
    const ms = () => Math.round(performance.now() - t);
    try {
      const v = await work();
      this.o.log("info", `start: ${step} took ${ms()} ms`);
      return v;
    } catch (e) {
      this.o.log("error", `start: ${step} failed after ${ms()} ms: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  /** One sensor read: updates the live view, today's highs and the history window. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.o.now();
      // Settings and parts only feed the screens too: while hidden they wait, and the first read after showing catches up.
      if (!this.quiet && now - this.factsAt > this.o.factsEveryMs) { this.facts = await this.link.facts().catch(() => this.facts); this.factsAt = now; }
      if (!this.quiet && now - this.invAt > this.o.inventoryEveryMs) { this.inv = await this.link.inventory(); this.invAt = now; }
      this.snap = await this.link.snapshot();
      if (this.lastError) this.o.log("info", "sensors: reading again");
      this.lastError = null;
      if (dayKey(now) !== this.day) { this.day = dayKey(now); this.dayMax = {}; }
      for (const s of this.snap.sensors) if (s.type === "temperature" && s.value != null) this.dayMax[s.id] = Math.max(this.dayMax[s.id] ?? 0, s.value);
      await this.record(now);
      await this.watchAlerts(now);
      await this.recorder.tick(this.snap);
      // Both only feed the screens, so they wait while the window is hidden; showing it again catches up.
      if (!this.quiet) {
        void this.readBackground();
        // The crash checks read Windows' event log; it's cached, so this reads it at most every few minutes.
        if (this.link.events) void this.windowsEvents().catch(() => {});
        void this.readStorage(now);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== this.lastError) this.o.log("warn", `sensors: ${msg}`);
      this.lastError = msg;
    } finally {
      this.busy = false;
    }
    this.emit();
    this.schedule();
  }

  private async record(now: number) {
    const w = this.window ??= new HistoryWindow(now);
    if (this.snap) w.add(this.snap);
    if (now - w.from >= this.o.historyEveryMs) {
      const p = w.point();
      this.window = null;
      await this.store.addHistory(p);
      this.recent.push(p);
      const keep = now - USUAL.baselineFrom * 864e5;
      if (this.recent[0]?.t < keep) this.recent = this.recent.filter((x) => x.t >= keep);
      this.unsynced.push(p);
      if (this.unsynced.length > UNSYNCED_MAX) this.unsynced = this.unsynced.slice(-UNSYNCED_MAX);
      await this.store.set("unsynced", this.unsynced);
    }
  }

  /** Moves the alerts on by this reading, and keeps them on disk when one starts or ends so a restart carries on where it left off. */
  private async watchAlerts(now: number) {
    if (!this.inv) return;
    const { state, alerts } = stepAlerts(this.alertState, { inv: this.inv, snap: this.snap, history: this.recent, now });
    this.alertState = state;
    const ids = (xs: Alert[]) => xs.map((a) => `${a.id}@${a.since}`).sort().join();
    const changed = ids(alerts) !== ids(this.alerts);
    this.alerts = alerts;
    if (changed) await this.store.set("alerts", state);
  }

  /** The live view of this PC. */
  view(): PC {
    if (!this.inv) throw new Error("Rig hasn't read this PC yet.");
    const { findings: _f, ...built } = buildPC(this.inv, this.snap, this.facts, this.identity, this.dayMax, { events: this.eventLog?.list, history: this.recent, now: this.o.now(), scan: this.scan });
    const pc = withAlerts({ ...built, id: this.id }, this.alerts);
    if (this.lastError && !this.snap) pc.summary = `Rig can't read the sensors right now. ${this.lastError}`;
    return pc;
  }

  private emit() {
    if (!this.inv) return;
    const alerts = this.alerts.map((a) => `${a.id}@${a.since}`).sort().join();
    // Hidden, nobody sees the readings move: only an alert starting or ending is passed on, for the notifications.
    if (this.quiet && alerts === this.emitted) return;
    this.emitted = alerts;
    const pc = this.view();
    this.listeners.forEach((cb) => cb(pc));
  }
  /** Waits for this PC's parts first: until then its id isn't known, and a saved id would look like another PC's. */
  private async isLocal(id: string) { await this.start().catch(() => {}); return id === this.id; }
  /** Subscribes to this PC or the account's copy of another, once it's known which the id is. */
  private follow(id: string, here: () => () => void, there: () => () => void) {
    let stop: (() => void) | null = null;
    let stopped = false;
    void this.isLocal(id).then((local) => { if (!stopped) stop = local ? here() : there(); });
    return () => { stopped = true; stop?.(); };
  }
  private signedIn() { return this.cloud?.signedIn() ?? Promise.resolve(false); }

  /** Uploads this PC to the account so the website shows it. Quietly does nothing when signed out. */
  async sync() {
    if (!this.cloud || !this.inv || !this.facts || !(await this.signedIn())) return;
    const payload: MachineSync = {
      at: new Date(this.o.now()).toISOString(), view: this.view(), inventory: this.inv, facts: this.facts,
      history: this.unsynced, changes: (await this.changes(this.id)).slice(0, 200), games: await this.games(this.id),
      identity: { name: this.identity.name, accent: this.identity.accent, cleanedAt: this.identity.cleanedAt, picks: this.identity.picks }, identityAt: this.identity.at,
      events: await this.windowsEvents().catch(() => []),
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
      await this.syncRecordings(reply?.recordings);
    } catch (e) {
      this.o.log("warn", `sync: failed, trying again next round: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Starts and stops what was asked for on the web, then uploads recordings the account is behind on. */
  private async syncRecordings(asked?: { start: RecordingRequest[]; stop: string[] }) {
    for (const id of asked?.stop ?? []) { await this.recorder.stop(id); this.unsent.add(id); }
    for (const req of asked?.start ?? []) {
      // One at a time: a request that arrives while another runs waits on the server for a later sync.
      if (this.recorder.active() && this.recorder.active()!.id !== req.id) continue;
      await this.recorder.start(req);
      this.unsent.add(req.id);
    }
    const live = this.recorder.active();
    for (const id of new Set([...this.unsent, ...(live ? [live.id] : [])])) await this.sendRecording(id);
  }

  private async sendRecording(id: string) {
    this.unsent.add(id);
    try {
      const r = await this.recorder.get(id);
      if (r && this.cloud && (await this.signedIn())) {
        await this.cloud.putRecording(this.id, r);
        if (r.state !== "recording") this.unsent.delete(id);
      } else if (!r) this.unsent.delete(id);
    } catch { /* stays in the set for the next sync */ }
    await this.store.set("recordingsUnsent", [...this.unsent]).catch(() => {});
  }

  // ----- Account -----
  async account() { return this.cloud ? this.cloud.account().catch(() => null) : null; }
  async signOut() { await this.cloud?.signOut(); }
  /** Deletes the account on the server. What's kept on this PC stays, so Rig keeps working signed out. */
  async deleteAccount() {
    await this.cloud!.deleteAccount();
    this.unsynced = [];
    await this.store.set("unsynced", []);
  }

  /** The account's data when signed in; otherwise what this PC keeps on disk. */
  async exportData(): Promise<DataExport> {
    if (this.cloud && (await this.signedIn())) return this.cloud.exportData();
    await this.start();
    return makeExport({
      account: null,
      machines: [{
        id: this.id, view: this.view(), inventory: this.inv, facts: this.facts, identity: { name: this.identity.name, accent: this.identity.accent, cleanedAt: this.identity.cleanedAt, picks: this.identity.picks },
        changes: await this.changes(this.id), games: await this.games(this.id), history: await this.store.history(0),
        events: await this.events(this.id), recordings: [...await this.recorder.all(), ...this.bgRecs],
      }],
      notes: ["Exported from the Rig app on this PC while signed out."],
      now: new Date(this.o.now()),
    });
  }

  async signInWithBrowser() {
    const r = await this.cloud!.signInWithBrowser!();
    return { ...r, done: r.done.then(async (a) => { await this.sync(); return a; }) };
  }

  // ----- PCs -----
  loadingStep() { return this.step; }

  async machines(): Promise<PC[]> {
    await this.start();
    this.step = "loading your other PCs";
    try {
      const others = (await this.signedIn())
        ? await this.cloud!.machines().catch((e: unknown) => { this.o.log("warn", `account: couldn't load other PCs: ${e instanceof Error ? e.message : String(e)}`); return []; })
        : [];
      return [this.view(), ...others.filter((p) => p.id !== this.id)];
    } finally {
      this.step = null;
    }
  }

  watch(id: string, cb: (pc: PC) => void) {
    return this.follow(id, () => {
      this.listeners.add(cb);
      if (this.inv) cb(this.view());
      return () => { this.listeners.delete(cb); };
    }, () => this.cloud?.watch(id, cb) ?? (() => {}));
  }

  async rename(id: string, patch: Identity) {
    if (!(await this.isLocal(id))) return this.cloud?.rename(id, patch);
    this.identity = { ...this.identity, ...patch, at: new Date(this.o.now()).toISOString() };
    await this.store.set("identity", this.identity);
    this.emit();
    void this.sync();
  }

  async history(id: string, range: Range): Promise<HistoryPoint[]> {
    if (!(await this.isLocal(id))) return this.cloud?.history(id, range) ?? [];
    return this.store.history(this.o.now() - rangeMs[range]);
  }

  async upgrades(id: string) {
    if (!(await this.isLocal(id))) return this.cloud?.upgrades(id) ?? [];
    await this.start();
    return suggestUpgrades(this.inv!);
  }

  async shop(id: string) {
    if (!this.isLocal(id)) return this.cloud?.shop(id) ?? null;
    await this.start();
    return this.inv ? shopFor(this.inv) : null;
  }

  async games(id: string): Promise<Game[]> {
    if (!(await this.isLocal(id))) return this.cloud?.games(id) ?? [];
    return (await this.store.get<Game[]>("games")) ?? [];
  }

  async changes(id: string): Promise<Change[]> {
    if (!(await this.isLocal(id))) return this.cloud?.changes(id) ?? [];
    return (await this.store.changes()).map(changeOf).sort((a, b) => b.at.localeCompare(a.at));
  }

  // ----- Logs and recordings -----

  /** What Windows' own event log holds. This is what the account gets; the background recorder's log stays here. */
  private async windowsEvents(): Promise<PCEvent[]> {
    const now = this.o.now();
    if (!this.eventLog || now - this.eventLog.at > EVENTS_EVERY_MS) {
      // One read at a time: the sensor loop asks every few seconds while a read can take longer.
      this.eventRead ??= (async () => {
        try {
          // After the first read, only what's newer than the newest event already held (a minute's overlap, which
          // cleanEvents drops as repeats): formatting a month of Windows' events every five minutes is slow.
          const oldest = now - EVENTS_DAYS * 864e5;
          const held = this.eventLog?.list.filter((e) => e.t >= oldest) ?? [];
          const since = held.length ? Math.max(oldest, held[0].t - 60_000) : oldest;
          const raw = await this.link.events?.(since) ?? [];
          this.eventLog = { at: now, list: cleanEvents([...raw, ...held]) };
        } finally { this.eventRead = null; }
      })();
      await this.eventRead;
    }
    return this.eventLog!.list;
  }

  /** Windows' event log, plus what the background recorder caught: power events, and anything Windows has since dropped. */
  async events(id: string): Promise<PCEvent[]> {
    if (!(await this.isLocal(id))) return this.cloud?.events(id) ?? [];
    await this.readBackground();
    const fromWindows = await this.windowsEvents().catch((e) => { if (this.bg.events.length) return []; throw e; });
    const { problems, power } = this.bg.cleanEvents();
    return [...cleanEvents([...fromWindows, ...problems]), ...power].sort((a, b) => b.t - a.t);
  }

  /**
   * Asks the helper what fills each drive. The answer comes at once from its saved scan, so this never holds up a reading;
   * the helper does the slow folder walk on its own thread. Asked every half hour, and every few seconds while a scan runs.
   */
  private readStorage(now: number, fresh = false): Promise<void> {
    if (!this.link.storage) return Promise.resolve();
    if (this.scanReading) return this.scanReading;
    if (!fresh && now - this.scanAskedAt < (this.scan?.running ? SCAN_RUNNING_ASK_MS : SCAN_ASK_MS)) return Promise.resolve();
    this.scanAskedAt = now;
    const was = this.scan;
    return this.scanReading = this.link.storage(fresh)
      .then((s) => {
        this.scan = s;
        if (was?.running && !s.running) this.o.log("info", `storage: folders measured${s.at ? ` at ${new Date(s.at).toISOString()}` : ""}`);
      })
      .catch((e) => this.o.log("warn", `storage: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => { this.scanReading = null; });
  }

  async measureDrives(id: string) {
    if (!(await this.isLocal(id))) throw new Error("Open Rig on that PC to measure its drives.");
    await this.readStorage(this.o.now(), true);
    this.emit();
  }

  /** Reads what the background recorder added since the last read, at most once a minute (on every call while its first read runs). */
  private readBackground(force = false): Promise<void> {
    const rec = this.o.recorder;
    if (!rec) return Promise.resolve();
    if (this.bgReading) return this.bgReading;
    if (!force && this.o.now() - this.bgAt < this.o.backgroundEveryMs) return Promise.resolve();
    this.bgReading = (async () => {
      const now = this.o.now();
      const from = now - BACKGROUND_DAYS * 864e5;
      try {
        let added = 0;
        for (let i = 0; i < BACKGROUND_PAGES; i++) {
          const page = await rec.read(from, this.bgCursor);
          this.bg.ingest(page.records);
          // A week's first read comes in many pages: finished days are thinned as they arrive, so they're never all held in full.
          this.bg.settle(now);
          added += page.records.length;
          this.bgCursor = page.cursor ?? this.bgCursor;
          if (!page.more) break;
        }
        if (rec.readCustom) {
          for (let i = 0; i < BACKGROUND_PAGES; i++) {
            const page = await rec.readCustom(from, this.customCursor).catch(() => null);
            if (!page) break;
            this.custom.ingest(page.records);
            added += page.records.length;
            this.customCursor = page.cursor ?? this.customCursor;
            if (!page.more) break;
          }
          const st = await rec.status().catch(() => null);
          const list = st?.probes?.list ?? null;
          const was = JSON.stringify(this.probeStatus);
          this.probeStatus = list && list.filter((p) => !st?.mine || !p.owner || p.owner === st.mine);
          if (JSON.stringify(this.probeStatus) !== was) added++;
        }
        if (added || this.bgAt === -Infinity) {
          this.bg.trim(from);
          this.custom.trim(from);
          this.bgRecs = this.inv ? [...backgroundRecordings(this.bg, this.id, limitsOf(this.view()), now), ...customRecordings(this.custom, this.id, now, this.probeStatus ?? undefined)] : [];
          this.emitRecordings();
        }
      } catch { /* no recorder here (not Windows), or its log can't be read right now */ }
      this.bgAt = now;
    })().finally(() => { this.bgReading = null; });
    return this.bgReading;
  }

  /** Recordings started by the person or the chat, then the background recorder's, newest first; one that's running stays on top. */
  private recordingList(): RecordingInfo[] {
    const mine = this.recorder.list();
    const bg = this.bgRecs.map(toInfo);
    const at = (r: RecordingInfo) => r.startedAt ?? Date.parse(r.createdAt);
    return [...mine.filter((r) => r.state === "pending" || r.state === "recording"), ...[...mine.filter((r) => r.state !== "pending" && r.state !== "recording"), ...bg].sort((a, b) => at(b) - at(a))];
  }

  private emitRecordings() { const list = this.recordingList(); this.recListeners.forEach((cb) => cb(list)); }

  watchRecordings(id: string, cb: (list: RecordingInfo[]) => void) {
    return this.follow(id, () => {
      this.recListeners.add(cb);
      if (this.inv) cb(this.recordingList());
      return () => { this.recListeners.delete(cb); };
    }, () => this.cloud?.watchRecordings(id, cb) ?? (() => {}));
  }

  /** The custom logs this PC's recorder runs for this Windows account, or null when it can't run any (no recorder, or it's off). */
  private async customLogs(): Promise<ProbeStatus[] | null> {
    const rec = this.o.recorder;
    if (!rec?.probes) return null;
    const st = await rec.status().catch(() => null);
    if (!st?.supported || !st.service) return null;
    const list = st.probes?.list ?? [];
    return list.filter((p) => !st.mine || !p.owner || p.owner === st.mine);
  }

  /** Sets up or turns off a custom log the chat asked for. Scripts never come this way: the person approves them. Returns why it failed, if it did. */
  private async applyProbe(e: Extract<ChatEvent, { type: "probe" }>): Promise<string | undefined> {
    const rec = this.o.recorder;
    if (!rec?.probes) return "This PC's background recorder can't keep custom logs.";
    try {
      if (e.op === "add") {
        if (e.probe.source.kind === "script") return "A script runs only once you approve it.";
        await rec.probes({ op: "add", probe: e.probe });
      } else await rec.probes({ op: "remove", id: e.id });
      // Show it in Logs and Settings without waiting for the next read.
      this.bgAt = -Infinity;
      void this.readBackground(true);
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  /** Reads the recorder again now: after the person approves, pauses or turns off a custom log. */
  refreshBackground() { this.bgAt = -Infinity; return this.readBackground(true); }

  async recording(id: string, rid: string): Promise<Recording | null> {
    if (!(await this.isLocal(id))) return this.cloud?.recording(id, rid) ?? null;
    if (isBackground(rid)) { const r = this.bgRecs.find((x) => x.id === rid); return r ? structuredClone(r) : null; }
    return this.recorder.get(rid);
  }

  async startRecording(id: string, req: { reason: string; minutes: number; question?: string }): Promise<RecordingInfo> {
    if (!(await this.isLocal(id))) {
      if (!this.cloud) throw new Error("Sign in to record on another PC.");
      return this.cloud.startRecording(id, req);
    }
    await this.start();
    const checked = checkRequest(req, { id: uid(), by: "you", now: new Date(this.o.now()) });
    if (typeof checked === "string") throw new Error(checked);
    return this.begin(checked);
  }

  private async begin(req: RecordingRequest): Promise<RecordingInfo> {
    const info = await this.recorder.start(req);
    this.schedule();
    void this.sendRecording(req.id);
    return info;
  }

  async stopRecording(id: string, rid: string): Promise<void> {
    if (!(await this.isLocal(id))) return this.cloud?.stopRecording(id, rid);
    await this.recorder.stop(rid);
  }

  // ----- Changes -----
  private async local(id: string) {
    if (!(await this.isLocal(id))) throw new Error("Changes are made from the Rig app on that PC.");
  }

  private async freshFacts() {
    this.facts = await this.link.facts();
    this.factsAt = this.o.now();
    return this.facts;
  }

  async preview(id: string, steps: Step[]): Promise<DiffRow[]> {
    const calls = fixes(steps).map((s) => s.call);
    await this.local(id);
    await this.start();
    for (const c of calls) { const bad = validateCall(c); if (bad) throw new Error(bad); }
    const facts = await this.freshFacts();
    return calls.map((c) => describeCall(c, facts, this.inv!.displays));
  }

  /** Runs fix steps in order. If one fails, the ones before it are put back and nothing is left half done. */
  private async run(todo: { step: FixStep; rows: DiffRow[] }[]): Promise<AppliedFix[]> {
    const done: AppliedFix[] = [];
    try {
      for (const { step, rows } of todo) done.push({ step, undo: { kind: "fix", call: await this.link.apply(step.call) }, rows });
      return done;
    } catch (e) {
      for (const a of [...done].reverse()) await this.link.apply(a.undo.call).catch(() => {});
      throw new Error(`${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
    } finally {
      await this.freshFacts().catch(() => {});
      this.inv = await this.link.inventory().catch(() => this.inv);
      this.emit();
    }
  }

  async apply(id: string, steps: Step[], meta: ApplyMeta): Promise<Change> {
    const rows = await this.preview(id, steps);
    const tier = cardTier(steps);
    if (tier === "refused") throw new Error("Rig won't make this change.");
    const applied = await this.run(fixes(steps).map((step, i) => ({ step, rows: [rows[i]] })));
    const change: Change = {
      id: uid(), machineId: this.id, at: new Date(this.o.now()).toISOString(), title: meta.title ?? stepsTitle(steps),
      by: meta.by, status: "applied", why: meta.why ?? "", result: "", diff: rows, tier, applied, from: meta.from,
    };
    await this.store.putChange(change);
    void this.sync();
    return change;
  }

  private async change(id: string, changeId: string) {
    await this.local(id);
    const c = (await this.store.changes()).map(changeOf).find((x) => x.id === changeId);
    if (!c) throw new Error("That change isn't in the log.");
    return c;
  }

  async undo(id: string, changeId: string): Promise<Change> {
    const c = await this.change(id, changeId);
    if (c.status !== "applied") return c;
    await this.run(appliedFixes(c.applied).reverse().map((a) => ({ step: { kind: "fix", call: a.undo.call }, rows: a.rows })));
    const next: Change = { ...c, status: "undone" };
    await this.store.putChange(next);
    void this.sync();
    return next;
  }

  async redo(id: string, changeId: string): Promise<Change> {
    const c = await this.change(id, changeId);
    if (c.status === "applied") return c;
    const applied = await this.run(appliedFixes(c.applied).map((a) => ({ step: a.step, rows: a.rows })));
    const next: Change = { ...c, status: "applied", applied };
    await this.store.putChange(next);
    void this.sync();
    return next;
  }

  // ----- Manuals -----
  // Signed in, manuals live on the account, so the website and the chat see
  // them: every call goes to the server. Signed out, this PC keeps its own
  // list and page text on disk and searches it here. Manuals saved while
  // signed out stay on this PC; they aren't uploaded when you sign in later.

  private async localManuals(): Promise<Manual[]> { return (await this.store.get<Manual[]>("manuals")) ?? []; }
  private async putLocalManuals(list: Manual[]) { await this.store.set("manuals", list); }
  private pagesKey(mid: string) { return `manualPages:${mid}`; }
  private async localManual(id: string, mid: string): Promise<Manual> {
    const m = (await this.isLocal(id)) ? (await this.localManuals()).find((x) => x.id === mid) : undefined;
    if (!m) throw new Error("That manual isn't on this PC.");
    return m;
  }

  async manuals(id: string): Promise<Manual[]> {
    if (await this.signedIn()) return this.cloud!.manuals(id);
    return (await this.isLocal(id)) ? (await this.localManuals()).sort((a, b) => b.addedAt.localeCompare(a.addedAt)) : [];
  }

  async findManual(id: string, target: ManualTarget): Promise<Manual | null> {
    // Read through RigClient: the server's lookup is optional on the interface.
    const cloud: RigClient | null = this.cloud;
    if (cloud?.findManual && (await this.signedIn())) return cloud.findManual(id, target);
    throw new Error("Sign in so Rig can look up manuals on the maker's site. You can still add a PDF you have.");
  }

  async addManualFile(id: string, target: ManualTarget, file: { name: string; bytes: number }): Promise<Manual> {
    if (await this.signedIn()) return this.cloud!.addManualFile(id, target, file);
    if (!(await this.isLocal(id))) throw new Error("Sign in to add manuals to your other PCs.");
    const m: Manual = {
      id: `local-${uid()}`, machineId: id, part: target.part, kind: target.kind, maker: target.maker, model: target.model,
      title: file.name.replace(/\.pdf$/i, "").trim() || `${target.maker} ${target.model}`.trim(), source: "added", indexed: false, diagrams: [],
      addedAt: new Date(this.o.now()).toISOString(), bytes: file.bytes,
    };
    await this.putLocalManuals([m, ...(await this.localManuals())]);
    return m;
  }

  async manualFile(id: string, mid: string): Promise<ArrayBuffer> {
    if (await this.signedIn()) return this.cloud!.manualFile(id, mid);
    await this.localManual(id, mid);
    throw new Error("This PDF was added from a file, so only the copy on this PC has it.");
  }

  async saveManualPages(id: string, mid: string, pages: ManualPage[], diagrams: ManualDiagram[]): Promise<Manual> {
    if (await this.signedIn()) return this.cloud!.saveManualPages(id, mid, pages, diagrams);
    const m = await this.localManual(id, mid);
    const next: Manual = { ...m, pageCount: Math.max(m.pageCount ?? 0, pages.length), indexed: true, diagrams };
    await this.store.set(this.pagesKey(mid), pages);
    await this.putLocalManuals((await this.localManuals()).map((x) => (x.id === mid ? next : x)));
    return next;
  }

  async searchManuals(id: string, query: string, opts?: { manualId?: string; limit?: number }): Promise<ManualHit[]> {
    if (await this.signedIn()) return this.cloud!.searchManuals(id, query, opts);
    if (!(await this.isLocal(id))) return [];
    const docs = await Promise.all((await this.localManuals()).map(async (manual) => ({ manual, pages: (await this.store.get<ManualPage[]>(this.pagesKey(manual.id))) ?? [] })));
    return searchPages(docs, query, opts);
  }

  async manualPage(id: string, mid: string, n: number): Promise<ManualPage | null> {
    if (await this.signedIn()) return this.cloud!.manualPage(id, mid, n);
    if (!(await this.isLocal(id))) return null;
    return (await this.store.get<ManualPage[]>(this.pagesKey(mid)))?.find((p) => p.n === n) ?? null;
  }

  async removeManual(id: string, mid: string): Promise<void> {
    if (await this.signedIn()) return this.cloud!.removeManual(id, mid);
    if (!(await this.isLocal(id))) return;
    await this.putLocalManuals((await this.localManuals()).filter((x) => x.id !== mid));
    await this.store.set(this.pagesKey(mid), null);
  }

  // Board layouts are read on the server, once per board model, so they need an account.
  async boardLayout(id: string, maker: string, model: string): Promise<BoardLayoutReply> {
    return this.cloud && (await this.signedIn()) ? this.cloud.boardLayout(id, maker, model) : { status: "none" };
  }
  async readBoardLayout(id: string, mid: string, page: ReadLayoutRequest): Promise<BoardLayoutReply> {
    return this.cloud && (await this.signedIn()) ? this.cloud.readBoardLayout(id, mid, page) : { status: "none" };
  }

  // ----- Chat -----
  async chat(id: string, history: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
    if (!this.cloud || !(await this.signedIn())) {
      onEvent({ type: "error", message: "Sign in to ask Rig. Answers come from Rig's servers, which read your parts' manuals." });
      onEvent({ type: "done" });
      return;
    }
    const here = await this.isLocal(id);
    const probes = here ? await this.customLogs() : null;
    const live = here && this.inv && this.facts ? { view: this.view(), facts: this.facts, ...(probes ? { probes } : {}) } : undefined;
    // Rig reads recordings on the server, so it needs the latest ones before it answers.
    if (live) for (const rid of [...this.unsent]) await this.sendRecording(rid);
    // Custom log changes are made here, on the PC, in the order they came; the answer's events wait for them.
    let applying: Promise<void> = Promise.resolve();
    const send = (f: () => void | Promise<void>) => { applying = applying.then(f).catch(() => {}); };
    await this.cloud.chat(id, history, (e) => {
      // A recording for this PC starts right away instead of waiting for the next sync.
      if (e.type === "recording" && live) {
        this.begin(e.request).catch(() => {});
        send(() => onEvent({ ...e, queued: false }));
      } else if (e.type === "probe" && live) {
        send(async () => onEvent({ ...e, error: await this.applyProbe(e) }));
      } else send(() => onEvent(e));
    }, signal, live);
    await applying;
  }
}

type AppliedFix = Extract<AppliedStep, { undo: FixUndo }>;

const noCommands = () => new Error("This PC's Rig helper can't run commands yet.");

function fixes(steps: Step[]): FixStep[] {
  return steps.map((s) => { if (s.kind !== "fix") throw noCommands(); return s; });
}

function appliedFixes(applied: AppliedStep[]): AppliedFix[] {
  return applied.map((a) => { if (a.step.kind !== "fix") throw noCommands(); return a as AppliedFix; });
}

/** A LocalStore in memory, for tests and for running the desktop UI in a browser. */
export class MemoryStore implements LocalStore {
  private kv = new Map<string, unknown>();
  private points: HistoryPoint[] = [];
  private log = new Map<string, StoredChange>();
  async get<T>(k: string) { return (this.kv.has(k) ? structuredClone(this.kv.get(k)) : null) as T | null; }
  async set(k: string, v: unknown) { this.kv.set(k, structuredClone(v)); }
  async addHistory(p: HistoryPoint) { this.points.push(p); }
  async history(since: number) { return this.points.filter((p) => p.t >= since); }
  async changes() { return [...this.log.values()].map((c) => structuredClone(c)); }
  async putChange(c: StoredChange) { this.log.set(c.id, structuredClone(c)); }
}
