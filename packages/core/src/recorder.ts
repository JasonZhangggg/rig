// Runs recordings on the PC itself. The desktop client feeds it every sensor
// reading; it keeps a sample per interval, saves as it goes (the PC may crash
// mid-recording, which is often the point), and when time is up it collects
// the Windows events that landed in between. It changes nothing on the PC.

import {
  MAX_SAMPLES, cleanEvents, cleanRecording, isActive, newRecording, sampleFrom, summarise, toInfo,
  type Limits, type ProcessUse, type RawEvent, type Recording, type RecordingInfo, type RecordingRequest,
} from "./recordings";
import type { Snapshot } from "./telemetry";

export interface RecorderOptions {
  pcId: () => string;
  /** The helper's read-only calls. Either may be missing on an older helper. */
  source: { events?(sinceMs: number): Promise<RawEvent[]>; processes?(): Promise<ProcessUse[]> };
  store: { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<void> };
  now: () => number;
  limits?: () => Limits;
  /** A recording started, stopped, finished or grew. */
  onChange?: (r: Recording) => void;
  onFinish?: (r: Recording) => void;
}

/** Finished recordings kept on the PC. */
export const KEEP_RECORDINGS = 20;
const SAVE_EVERY_MS = 30_000;
const INDEX = "recordings";
const key = (id: string) => `recording:${id}`;

export class Recorder {
  private infos: RecordingInfo[] = [];
  private live: Recording | null = null;
  private savedAt = 0;
  private working = false;
  private loaded: Promise<void> | null = null;

  constructor(private o: RecorderOptions) {}

  /** Reads what's on disk. A recording that was running when the app closed carries on, or finishes if its time has passed. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      this.infos = (await this.o.store.get<RecordingInfo[]>(INDEX)) ?? [];
      const open = this.infos.find((r) => r.state === "recording");
      if (!open) return;
      const saved = cleanRecording(await this.o.store.get(key(open.id)), open.pcId);
      if (!saved) { this.infos = this.infos.filter((r) => r.id !== open.id); return; }
      this.live = saved;
      if (this.o.now() >= (saved.endsAt ?? 0)) await this.finish("done");
    })();
    return this.loaded;
  }

  /** Newest first. */
  list(): RecordingInfo[] { return this.infos.map((r) => (this.live?.id === r.id ? toInfo(this.live) : r)); }
  active(): RecordingInfo | null { return this.live ? toInfo(this.live) : null; }

  async get(id: string): Promise<Recording | null> {
    if (this.live?.id === id) return structuredClone(this.live);
    const info = this.infos.find((r) => r.id === id);
    return info ? cleanRecording(await this.o.store.get(key(id)), info.pcId) : null;
  }

  /** Every recording with its readings, newest first, for the data export. */
  async all(): Promise<Recording[]> {
    await this.load();
    const list = await Promise.all(this.list().map((r) => this.get(r.id)));
    return list.filter((r): r is Recording => r != null);
  }

  /** Starts recording now. Starting one that already exists, or while another runs, changes nothing. */
  async start(req: RecordingRequest): Promise<RecordingInfo> {
    await this.load();
    const known = this.infos.find((r) => r.id === req.id);
    if (known) return known;
    if (this.live) throw new Error("Rig is already recording. Stop that one first, or wait for it to finish.");
    const now = this.o.now();
    this.live = { ...newRecording(req, this.o.pcId()), state: "recording", startedAt: now, endsAt: now + req.minutes * 60_000 };
    this.infos = [toInfo(this.live), ...this.infos];
    await this.save(true);
    this.o.onChange?.(this.live);
    return toInfo(this.live);
  }

  /** Stops early and keeps what was recorded so far. */
  async stop(id: string): Promise<void> {
    await this.load();
    if (this.live?.id === id) await this.finish("cancelled");
  }

  /** Call with every sensor reading. Adds a sample when one is due and finishes when time is up. */
  async tick(snap: Snapshot | null): Promise<void> {
    const r = this.live;
    if (!r || this.working) return;
    this.working = true;
    try {
      const now = this.o.now();
      const last = r.samples[r.samples.length - 1];
      if (snap && r.samples.length < MAX_SAMPLES && (!last || now - last.t >= r.intervalMs)) {
        const top = r.capture.includes("processes") ? await this.o.source.processes?.().catch(() => undefined) : undefined;
        r.samples.push({ ...sampleFrom(snap, r.capture, top), t: now });
        this.o.onChange?.(r);
      }
      if (now >= (r.endsAt ?? 0)) await this.finish("done");
      else await this.save(false);
    } finally { this.working = false; }
  }

  private async finish(state: "done" | "cancelled") {
    const r = this.live;
    if (!r) return;
    const now = this.o.now();
    const end = Math.min(now, r.endsAt ?? now);
    if (r.capture.includes("events") && r.startedAt != null) {
      try {
        const raw = await this.o.source.events?.(r.startedAt) ?? [];
        // A minute of slack: Windows writes some events a little after the fact.
        r.events = cleanEvents(raw.filter((e) => e.t >= r.startedAt! && e.t <= end + 60_000));
      } catch (e) { r.error = `Rig couldn't read the Windows event log. ${e instanceof Error ? e.message : ""}`.trim(); }
    }
    r.state = !r.samples.length && !r.events.length ? (state === "cancelled" ? "cancelled" : "failed") : state;
    if (r.state === "failed") r.error ??= "No readings came in while it ran.";
    r.finishedAt = end;
    r.headline = summarise(r, this.o.limits?.() ?? {}).headline;
    this.live = null;
    this.infos = this.infos.map((x) => (x.id === r.id ? toInfo(r) : x));
    await this.o.store.set(key(r.id), r);
    await this.saveIndex();
    this.o.onChange?.(r);
    this.o.onFinish?.(r);
  }

  private async save(force: boolean) {
    const r = this.live;
    if (!r || (!force && this.o.now() - this.savedAt < SAVE_EVERY_MS)) return;
    this.savedAt = this.o.now();
    await this.o.store.set(key(r.id), r);
    await this.saveIndex();
  }

  private async saveIndex() {
    const drop = this.infos.filter((r) => !isActive(r)).slice(KEEP_RECORDINGS);
    for (const r of drop) await this.o.store.set(key(r.id), null);
    this.infos = this.infos.filter((r) => !drop.includes(r));
    await this.o.store.set(INDEX, this.list());
  }
}
