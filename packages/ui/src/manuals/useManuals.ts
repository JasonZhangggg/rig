// The manuals of the PC on screen and the work on them: finding one on the
// maker's site, downloading it, reading its pages and saving what was read.
// Kept in a small store per client and PC, so the Manuals page, the part
// panel, Upgrades and the viewer share it and a read keeps going while the
// person moves around the app.

import { useEffect, useSyncExternalStore } from "react";
import { findDiagrams, MANUAL_MAX_BYTES, type Manual, type ManualTarget, type RigClient } from "@rig/core";
import { useApp } from "../state";
import { dropCopy, getCopy, putCopy } from "./cache";
import { readPdf } from "./pdf";

export type Job =
  | { step: "finding" }
  | { step: "downloading" }
  | { step: "reading"; done: number; total: number }
  | { step: "saving" }
  | { step: "notfound" }
  | { step: "error"; message: string };

export interface ManualsState {
  /** Null until the list has loaded. */
  manuals: Manual[] | null;
  loadError: string | null;
  /** What's happening for each part, by ManualTarget.part. */
  jobs: Record<string, Job>;
  /** Parts the person named that have no manual yet. */
  extras: ManualTarget[];
  /** Manuals whose PDF this device keeps. */
  onDevice: string[];
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export class ManualStore {
  private state: ManualsState = { manuals: null, loadError: null, jobs: {}, extras: [], onDevice: [] };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;

  constructor(private client: RigClient, private pcId: string) {}

  get = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private patch(p: Partial<ManualsState> | ((s: ManualsState) => Partial<ManualsState>)) {
    this.state = { ...this.state, ...(typeof p === "function" ? p(this.state) : p) };
    this.listeners.forEach((f) => f());
  }
  private job(part: string, job: Job | null) {
    this.patch((s) => {
      const jobs = { ...s.jobs };
      if (job) jobs[part] = job; else delete jobs[part];
      return { jobs };
    });
  }
  private upsert(m: Manual) {
    this.patch((s) => ({ manuals: [m, ...(s.manuals ?? []).filter((x) => x.id !== m.id)], extras: s.extras.filter((x) => x.part !== m.part) }));
  }

  /** Loads the list again. Safe to call often: calls made while one is loading share it. */
  load(): Promise<void> {
    this.loading ??= this.client.manuals(this.pcId).then(async (manuals) => {
      const added = manuals.filter((m) => m.source === "added");
      const here = (await Promise.all(added.map(async (m) => ((await getCopy(m.id)) ? m.id : null)))).filter((x): x is string => !!x);
      this.patch((s) => ({ manuals, loadError: null, onDevice: [...new Set([...s.onDevice, ...here])] }));
    }, (e) => this.patch({ loadError: message(e, "Rig couldn't load the manuals just now."), manuals: this.state.manuals ?? [] }))
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Remembers a part only the person named, until it has a manual. */
  addExtra(t: ManualTarget) {
    this.patch((s) => ({ extras: [...s.extras.filter((x) => x.part !== t.part), t] }));
  }
  dropExtra(part: string) {
    this.patch((s) => ({ extras: s.extras.filter((x) => x.part !== part) }));
    this.job(part, null);
  }

  /** Looks the manual up on the maker's site, then downloads and reads it. */
  async find(t: ManualTarget): Promise<void> {
    if (!this.client.findManual) { this.job(t.part, { step: "error", message: "Rig can't look up manuals from here. Add a PDF you have instead." }); return; }
    this.job(t.part, { step: "finding" });
    try {
      const m = await this.client.findManual(this.pcId, t);
      if (!m) { this.job(t.part, { step: "notfound" }); return; }
      this.upsert(m);
      await this.read(m);
    } catch (e) {
      this.job(t.part, { step: "error", message: message(e, "Rig couldn't look for the manual just now.") });
    }
  }

  /** Adds a PDF the person picked, keeps it on this device and reads it. Replaces `replacing` once it's in. */
  async addFile(t: ManualTarget, file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }, replacing?: string): Promise<void> {
    if (file.size > MANUAL_MAX_BYTES) { this.job(t.part, { step: "error", message: `That file is over ${Math.round(MANUAL_MAX_BYTES / 1048576)} MB, which is more than Rig reads.` }); return; }
    if (!/\.pdf$/i.test(file.name)) { this.job(t.part, { step: "error", message: "That isn't a PDF. Pick the manual's .pdf file." }); return; }
    this.job(t.part, { step: "reading", done: 0, total: 0 });
    try {
      const bytes = await file.arrayBuffer();
      const m = await this.client.addManualFile(this.pcId, t, { name: file.name, bytes: file.size });
      await putCopy(m.id, bytes);
      this.patch((s) => ({ onDevice: [...s.onDevice, m.id] }));
      this.upsert(m);
      if (replacing && replacing !== m.id) await this.remove(replacing);
      await this.read(m, bytes);
    } catch (e) {
      this.job(t.part, { step: "error", message: message(e, "Rig couldn't add that file.") });
    }
  }

  /** Downloads (or takes the kept copy), reads every page, marks the diagrams and saves the text. */
  async read(m: Manual, bytes?: ArrayBuffer): Promise<void> {
    const part = m.part;
    try {
      if (!bytes) {
        this.job(part, { step: "downloading" });
        bytes = (await getCopy(m.id)) ?? undefined;
        if (!bytes) {
          bytes = await this.client.manualFile(this.pcId, m.id);
          await putCopy(m.id, bytes);
        }
      }
      this.job(part, { step: "reading", done: 0, total: m.pageCount ?? 0 });
      const { pages } = await readPdf(bytes, (done, total) => this.job(part, { step: "reading", done, total }));
      if (!pages.some((p) => p.text.trim())) throw new Error("This PDF has no text Rig can read. It may be scanned pictures of pages. You can still open it.");
      this.job(part, { step: "saving" });
      const saved = await this.client.saveManualPages(this.pcId, m.id, pages, findDiagrams(pages));
      this.upsert(saved);
      this.job(part, null);
    } catch (e) {
      this.job(part, { step: "error", message: message(e, "Rig couldn't read this manual.") });
    }
  }

  async remove(id: string): Promise<void> {
    await this.client.removeManual(this.pcId, id);
    await dropCopy(id);
    this.patch((s) => ({ manuals: (s.manuals ?? []).filter((m) => m.id !== id), onDevice: s.onDevice.filter((x) => x !== id) }));
  }

  clearJob(part: string) { this.job(part, null); }
}

const stores = new WeakMap<RigClient, Map<string, ManualStore>>();

/** The store for one PC of a client. */
export function manualStore(client: RigClient, pcId: string): ManualStore {
  let byPc = stores.get(client);
  if (!byPc) stores.set(client, (byPc = new Map()));
  let s = byPc.get(pcId);
  if (!s) byPc.set(pcId, (s = new ManualStore(client, pcId)));
  return s;
}

/** The on-screen PC's manuals and what's happening to them. Loads the list when first used on a screen. */
export function useManuals(): ManualsState & { store: ManualStore } {
  const { client, pc } = useApp();
  const store = manualStore(client, pc.id);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => { void store.load(); }, [store]);
  return { ...state, store };
}
