import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { RecorderLink } from "@rig/core";
import { defaultAppearance, parseAppearance, type Appearance } from "./appearance";
import { appliedCount, stale, stepHeadline, undoneLine, waitingOn } from "./components/change";
import { alertRules, formatTemp, helperStep, livePoint, liveSpec, RESTART_WORDS, isTempUnit, tempsInText, stepsTitle, type TempFormat, type TempUnit, type Account, type AlertKind, type Change, type ChatMessage, type DiffRow, type HistoryPoint, type PC, type StillPC, type Range, type RecordingInfo, type RigClient, type Route, type Step, type StepOutcome, type UndoReply, type OpenRevert } from "@rig/core";

export const routes: Route[] = ["overview", "pc", "chat", "changes", "upgrades", "games", "history", "logs", "recorded", "events", "manuals", "safety", "web", "signin", "settings"];

/** What the app around the screens can do beyond the client. The desktop app passes these; the website passes none. */
export interface AppHost {
  /** Start Rig when the person signs in to Windows. */
  autostart?: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  /** The Rig server this app signs in to, shown in Settings. */
  server?: string;
  /** Rig's background recorder, turned on and off in Settings. Windows only. */
  recorder?: Pick<RecorderLink, "status" | "set" | "probes" | "approveAdmin">;
  /** Opens the folder with Rig's debug log. */
  openLogs?: () => Promise<void>;
  /** Rig's own updates: checked quietly in the background, installed only when the person picks Update. */
  updates?: UpdatesHost;
}

/** Where Rig's own update stands. */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; checkedAt: number }
  | { kind: "ready"; version: string; checkedAt: number }
  | { kind: "installing"; version: string }
  | { kind: "failed"; step: "check" | "install"; error: string; version?: string };

export interface UpdatesHost {
  get(): UpdateState;
  /** Calls back whenever the state changes; returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
  check(): Promise<void>;
  /** Downloads and installs the version that's ready. Rig closes while the installer runs. */
  install(): Promise<void>;
}

const idle: UpdateState = { kind: "idle" };
const noUpdates: UpdatesHost = { get: () => idle, subscribe: () => () => {}, check: async () => {}, install: async () => {} };

/** The update state, kept current. Idle when the app has no updater (the website, the demo). */
export function useUpdates(host: AppHost): UpdateState {
  const u = host.updates ?? noUpdates;
  return useSyncExternalStore(u.subscribe, u.get);
}

/** The review sheet shown before any change is made. */
export interface Review {
  title: string;
  body: string;
  rows: DiffRow[];
  steps: Step[];
  cta: string;
  by: "you" | "rig";
  why?: string;
  /** The chat proposal this review came from, so its card can show the result. */
  proposalId?: string;
  busy?: boolean;
  error?: string;
}

export interface ToastState { msg: string; undo?: string }

export interface UI {
  route: Route;
  pcId: string | null;
  exploded: boolean;
  selected: string | null;
  tab: string;
  /** The kind of part open on My PC's Upgrades tab, or the person's list. */
  shopCat: string | null;
  range: Range;
  review: Review | null;
  toast: ToastState | null;
  palette: boolean;
  /** The startup apps dialog is open. */
  startupApps: boolean;
  sideMini: boolean;
  /** The recording open on the Logs page. */
  recordingId: string | null;
  /** Temperatures on screen, saved on this device. */
  tempUnit: TempUnit;
}

export interface Data {
  account: Account | null;
  pcs: PC[];
  pc: PC | null;
  changes: Change[];
  chat: ChatMessage[];
  answering: boolean;
  /** The on-screen PC's recordings, newest first, kept live. */
  recordings: RecordingInfo[];
  /** Changes made on the on-screen PC that you haven't seen: not made in this window, and since you last opened Changes. */
  unseenChanges: number;
  /** The on-screen PC's readings as they came in, oldest first, the last ten minutes of them, for the live charts. */
  live: LivePoint[];
}

/** A live reading of the whole PC: its main readings as a history point, and every sensor's value by id. */
export type LivePoint = HistoryPoint & { vals: Record<string, number> };

/** How far back the live readings reach: an hour, from the moment Rig opened. */
export const LIVE_KEEP_MS = 60 * 60_000;

/**
 * The live readings with the PC's newest one added. Kept from the moment the PC is on screen, not from when a page that
 * charts them opens, so the charts are full the first time you look. The same list when nothing new came in.
 */
export function withLive(prev: LivePoint[], pc: PC): LivePoint[] {
  if (!pc.online || !pc.parts) return prev;
  const t = pc.seenAt ? Date.parse(pc.seenAt) : Date.now();
  if (!Number.isFinite(t) || (prev.length && prev[prev.length - 1].t >= t)) return prev;
  const vals: Record<string, number> = {};
  for (const r of pc.readings ?? []) if (r.value != null) vals[r.id] = r.value;
  const from = t - LIVE_KEEP_MS;
  const keep = prev.length && prev[0].t < from ? prev.filter((p) => p.t >= from) : prev;
  return [...keep, { ...livePoint(pc, t), vals }];
}

const storage = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/**
 * What you've seen of one PC's changes, kept on this device: the newest change there was when you last opened Changes,
 * and the changes made in this window since then. You approved those yourself, so they never count as new.
 */
interface SeenChanges { at: string; ids: string[] }
const seenKey = (pcId: string) => `rig.changesSeen.${pcId}`;
const time = (iso: string) => Date.parse(iso) || 0;
const newestAt = (list: Change[]) => list.reduce((at, c) => (time(c.at) > time(at) ? c.at : at), new Date(0).toISOString());
function readSeen(pcId: string): SeenChanges | null {
  try {
    const s = JSON.parse(storage.get(seenKey(pcId)) ?? "null");
    return s && typeof s.at === "string" && Array.isArray(s.ids) ? { at: s.at, ids: s.ids.filter((x: unknown) => typeof x === "string") } : null;
  } catch { return null; }
}
const unseenOf = (list: Change[], s: SeenChanges) => list.filter((c) => time(c.at) > time(s.at) && !s.ids.includes(c.id)).length;

/** The views of the Logs page, where a log opens in place. */
const logRoutes: Route[] = ["logs", "recorded", "events"];

function routeFromHash(): Route {
  const h = location.hash.replace("#", "") as Route;
  return routes.includes(h) ? h : "overview";
}

const uid = () => Math.random().toString(36).slice(2, 10);

export interface Ctx {
  client: RigClient;
  host: AppHost;
  ui: UI;
  data: Data;
  /** The PC on screen. Pages only render once it has loaded. */
  pc: PC;
  set: (patch: Partial<UI> | ((u: UI) => Partial<UI>)) => void;
  go: (r: Route) => void;
  toast: (msg: string, undo?: string) => void;
  ask: (q: string) => void;
  /** Starts a fresh conversation. Does nothing while Rig is answering. */
  clearChat: () => void;
  /** Opens the review sheet with the current values filled in. Nothing changes until the person confirms. */
  review: (steps: Step[], meta: { title?: string; body?: string; cta?: string; by: "you" | "rig"; why?: string; proposalId?: string }) => Promise<void>;
  confirmReview: () => Promise<void>;
  declineProposal: (proposalId: string) => void;
  /** The one way a card reads, applies or undoes a command step. Rig's own fixes go through `review`. */
  commandStep: (proposalId: string, index: number, act: "read" | "apply" | "undo" | "forceUndo") => Promise<void>;
  /** The person approved a script Rig proposed. Runs as admin only after Windows' own prompt. Never called by the chat. */
  approveScript: (messageId: string) => Promise<void>;
  /** The button under firmware setup steps: read, restart in a minute (after Windows' own prompt), or cancel that restart. Takes nothing from the chat. */
  firmwareRestart: (messageId: string, act: "read" | "apply" | "cancel" | "reset") => Promise<void>;
  declineScript: (messageId: string) => void;
  toggleChange: (id: string) => Promise<void>;
  /** The protections that are off for now because of a change here, after asking the helper which are back on. */
  openReverts: () => Promise<OpenRevert[]>;
  pickPC: (id: string) => void;
  /** Starts recording readings on the PC. Nothing changes there, so there's no review. */
  startRecording: (minutes: number, reason: string) => Promise<void>;
  stopRecording: (id: string) => Promise<void>;
  openRecording: (id: string | null) => void;
}

/** What the screens can do: everything in Ctx but the PC, its data and the screen state. The same functions for as long as the PC on screen is. */
export type Actions = Omit<Ctx, "ui" | "data" | "pc">;

const AppCtx = createContext<Ctx | null>(null);
const ActionsCtx = createContext<Actions | null>(null);
const UICtx = createContext<UI | null>(null);
const StoreCtx = createContext<Store | null>(null);

/** Everything, kept current. A screen that reads it draws again on every reading (every 2 s): use the hooks below where it needn't. */
export const useApp = () => useContext(AppCtx)!;
/** What the screens can do. Never changes while the same PC is on screen, so it doesn't draw a screen again by itself. */
export const useActions = () => useContext(ActionsCtx)!;
/** The screen state (page, tab, what's open). Changes only when the person does something. */
export const useUI = () => useContext(UICtx)!;

interface Store { get(): Ctx; subscribe(fn: () => void): () => void }

/** True when two values are the same, or objects or arrays with the same entries. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Part of the app's state, drawn again only when that part changes (compared entry by entry), not on every reading.
 * Pick what the screen shows, like `(c) => c.pc.name` or `(c) => [c.pc.id, c.data.account] as const`.
 */
export function useAppSelector<T>(pick: (c: Ctx) => T, equal: (a: T, b: T) => boolean = shallowEqual): T {
  const store = useContext(StoreCtx)!;
  const last = useRef<{ value: T } | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const read = useCallback(() => {
    const next = pickRef.current(store.get());
    if (last.current && equal(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  }, [store, equal]);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** Reads the newest state when called, as in a click, without drawing the screen again on every reading. */
export function useLatest(): () => Ctx {
  const store = useContext(StoreCtx)!;
  return store.get;
}

/** Some of the app's data, like `useData("chat", "answering")`, drawn again only when one of those changes. */
export function useData<K extends keyof Ctx["data"]>(...keys: K[]): Pick<Ctx["data"], K> {
  return useAppSelector((c) => {
    const out = {} as Pick<Ctx["data"], K>;
    for (const k of keys) out[k] = c.data[k];
    return out;
  });
}

export type { StillPC };

const stillCache = new WeakMap<PC, StillPC>();
let lastStill: StillPC | null = null;
export function stillOf(pc: PC): StillPC {
  const hit = stillCache.get(pc);
  if (hit) return hit;
  const { health: _h, seenAt: _s, lastSync: _l, online: _o, stats: _st, breakdown: _b, fans: _f, alerts: _a, readings: _r, drives: _d, parts, ...rest } = pc;
  const still: StillPC = { ...rest };
  if (parts) {
    still.parts = {};
    for (const [k, { temp: _t, tempMax: _m, load: _lo, clock: _c, fan: _fa, warn: _w, ...part }] of Object.entries(parts)) still.parts[k] = { ...part, specs: part.specs.filter((row) => !liveSpec(row)) };
  }
  const kept = keepUnchanged(lastStill?.id === pc.id ? lastStill : null, still);
  lastStill = kept;
  stillCache.set(pc, kept);
  return kept;
}

/** The on-screen PC for a screen that shows none of its live readings, drawn again only when its name, parts or issues change. */
export function useStillPC(): StillPC {
  return useAppSelector((c) => stillOf(c.pc), Object.is);
}

/**
 * The new reading of a PC with every part that didn't change kept as the same object as before, so a screen that picks an unchanged
 * part (its issues, its storage, a part's name) isn't drawn again. Only plain data, as the PC is.
 */
export function keepUnchanged<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next) || !prev || !next || typeof prev !== "object" || typeof next !== "object") return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    const out = next.map((x, i) => keepUnchanged(prev[i], x));
    return (out.length === prev.length && out.every((x, i) => x === prev[i]) ? prev : out) as T;
  }
  if (Array.isArray(prev)) return next;
  const p = prev as Record<string, unknown>, n = next as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let same = Object.keys(p).length === Object.keys(n).length;
  for (const k of Object.keys(n)) {
    out[k] = keepUnchanged(p[k], n[k]);
    if (out[k] !== p[k]) same = false;
  }
  return (same ? prev : out) as T;
}

/** The temperature unit picked on this device, for code outside the screens such as notifications. */
export function storedTempUnit(): TempUnit {
  const u = storage.get("rig.tempUnit");
  return isTempUnit(u) ? u : "c";
}

/** The viewer's temperature unit. Outside the app (as in a test of one card) it's °C. */
export const useTempUnit = (): TempUnit => useContext(UICtx)?.tempUnit ?? "c";

/** Formats a Celsius temperature in the viewer's unit. */
export function useTemp() {
  const unit = useTempUnit();
  return useCallback((celsius: number | null | undefined, opts?: TempFormat) => formatTemp(celsius, unit, opts), [unit]);
}

/** Rewrites the °C figures in a sentence from the PC, like a finding's title, into the viewer's unit. */
export function useTempText() {
  const unit = useTempUnit();
  return useCallback((text: string) => tempsInText(text, unit), [unit]);
}

/**
 * The on-screen PC's recorded history over a range. Null while the PC's first range loads, empty when there is none or it
 * couldn't be read. Moving to another range keeps the last one on screen until the new one arrives, so nothing blinks out.
 */
export function useHistory(range: Range): HistoryPoint[] | null {
  const { client } = useActions();
  const pcId = useAppSelector((c) => c.pc.id);
  const pc = { id: pcId };
  const [got, setGot] = useState<{ pc: string; points: HistoryPoint[] } | null>(null);
  useEffect(() => {
    let live = true;
    client.history(pc.id, range).then((p) => live && setGot({ pc: pc.id, points: p })).catch(() => live && setGot({ pc: pc.id, points: [] }));
    return () => { live = false; };
  }, [client, pc.id, range]);
  return got?.pc === pc.id ? got.points : null;
}

/** What shows before a PC is on screen: still reading, no PCs, or the list couldn't be read (with a way to try again). */
export type Pending = "loading" | "empty" | "error";

const noHost: AppHost = {};

/** How long the first read may take before Rig says it's stuck. It keeps waiting behind the message, and carries on if the read finishes. */
export const STALL_MS = 45_000;

export function AppProvider({ client, host = noHost, children, fallback, stallMs = STALL_MS }: { client: RigClient; host?: AppHost; children: ReactNode; fallback: (state: Pending, retry: () => void, reason: string | null) => ReactNode; stallMs?: number }) {
  const [ui, setUI] = useState<UI>(() => ({
    route: routeFromHash(),
    pcId: storage.get("rig.pc"),
    exploded: false, selected: null, tab: "live", shopCat: null, range: "7d",
    review: null, toast: null, palette: false, startupApps: false, sideMini: storage.get("rig.sideMini") === "1", recordingId: null,
    tempUnit: storedTempUnit(),
  }));
  const [data, setData] = useState<Data>({ account: null, pcs: [], pc: null, changes: [], chat: [], answering: false, recordings: [], unseenChanges: 0, live: [] });
  const [loaded, setLoaded] = useState(false);
  /** Why the first read failed or stalled, or null while it hasn't. */
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const set = useCallback((patch: Partial<UI> | ((u: UI) => Partial<UI>)) => {
    setUI((u) => ({ ...u, ...(typeof patch === "function" ? patch(u) : patch) }));
  }, []);

  // Account and the list of PCs
  useEffect(() => {
    let live = true;
    const stalled = setTimeout(() => {
      if (!live) return;
      const step = client.loadingStep?.();
      setFailed(step ? `It's been stuck ${step} for a while.` : "It's taking longer than it should.");
      setLoaded(true);
    }, stallMs);
    Promise.all([client.account(), client.machines()]).then(([account, pcs]) => {
      if (!live) return;
      setData((d) => ({ ...d, account, pcs }));
      setUI((u) => ({ ...u, pcId: pcs.some((p) => p.id === u.pcId && p.parts) ? u.pcId : pcs.find((p) => p.parts)?.id ?? null }));
      setFailed(null);
      setLoaded(true);
    }).catch((e: unknown) => {
      if (live) { setFailed(e instanceof Error && e.message ? e.message : "Something went wrong."); setLoaded(true); }
    }).finally(() => clearTimeout(stalled));
    return () => { live = false; clearTimeout(stalled); };
  }, [client, attempt, stallMs]);

  /**
   * The chosen PC's first read of its changes and the ids in it. Any other change that turns up later was made in this
   * window. Null until that read; `shown` once the list on screen is that read or newer.
   */
  const firstRead = useRef<{ list: Change[]; known: Set<string>; shown?: true } | null>(null);

  // Live view of the chosen PC, its changes and a fresh chat
  useEffect(() => {
    if (!ui.pcId) return;
    storage.set("rig.pc", ui.pcId);
    const id = ui.pcId;
    firstRead.current = null;
    setData((d) => ({ ...d, pc: d.pcs.find((p) => p.id === id && p.parts) ?? null, changes: [], chat: client.conversation?.(id) ?? [], recordings: [], unseenChanges: 0, live: [] }));
    setUI((u) => ({ ...u, recordingId: null }));
    const stop = client.watch(id, (next) => setData((d) => {
      const pc = keepUnchanged(d.pc?.id === next.id ? d.pc : null, next);
      const live = next.id === id ? withLive(d.live, next) : d.live;
      if (pc === d.pc && live === d.live) return d;
      return { ...d, pc, live, pcs: pc === d.pc ? d.pcs : d.pcs.map((p) => (p.id === pc.id ? pc : p)) };
    }));
    const stopRecordings = client.watchRecordings(id, (recordings) => setData((d) => ({ ...d, recordings })));
    let live = true;
    client.changes(id).then((changes) => { if (!live) return; firstRead.current = { list: changes, known: new Set(changes.map((c) => c.id)) }; setData((d) => ({ ...d, changes })); }).catch(() => {});
    return () => { live = false; stop(); stopRecordings(); };
  }, [client, ui.pcId]);

  // The Changes badge counts only what you haven't seen, and opening Changes clears it.
  const onChanges = ui.route === "changes";
  useEffect(() => {
    const id = ui.pcId, read = firstRead.current, list = data.changes;
    if (!id || !read) return;
    if (!read.shown) { if (list !== read.list) return; read.shown = true; }
    const { known } = read;
    // The first time, everything already there is old news.
    let seen = readSeen(id) ?? { at: newestAt(list), ids: [] };
    if (onChanges) seen = { at: newestAt(list), ids: [] };
    else {
      const here = list.filter((c) => !known.has(c.id));
      for (const c of here) known.add(c.id);
      const add = here.filter((c) => time(c.at) > time(seen.at) && !seen.ids.includes(c.id)).map((c) => c.id);
      if (add.length) seen = { ...seen, ids: [...seen.ids, ...add] };
    }
    storage.set(seenKey(id), JSON.stringify(seen));
    const unseen = unseenOf(list, seen);
    setData((d) => (d.unseenChanges === unseen ? d : { ...d, unseenChanges: unseen }));
  }, [data.changes, ui.pcId, onChanges]);
  // The chosen PC can be watched before the list arrives (it's the one opened last), so fill it from the list if its live view hasn't.
  useEffect(() => {
    if (data.pc || !ui.pcId) return;
    const pc = data.pcs.find((p) => p.id === ui.pcId && p.parts);
    if (pc) setData((d) => (d.pc ? d : { ...d, pc }));
  }, [data.pc, data.pcs, ui.pcId]);

  useEffect(() => {
    const on = () => set({ route: routeFromHash() });
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [set]);
  useEffect(() => { storage.set("rig.sideMini", ui.sideMini ? "1" : "0"); }, [ui.sideMini]);
  useEffect(() => { storage.set("rig.tempUnit", ui.tempUnit); }, [ui.tempUnit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]") !== null;
      if (!(((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing))) return;
      // Not over another dialog: Escape would then close the wrong one.
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault(); set({ palette: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  // Actions already under way, by item: a second press while the first is still running does nothing.
  const inFlight = useRef(new Set<string>());
  const once = useCallback(async (key: string, run: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try { await run(); } finally { inFlight.current.delete(key); }
  }, []);
  // Where the Logs list was scrolled to when a recording opened, so going back lands there again.
  const logsScroll = useRef(0);

  const timer = useRef(0);
  const toast = useCallback((msg: string, undo?: string) => {
    set({ toast: { msg, undo } });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set({ toast: null }), undo ? 12000 : 6000);
  }, [set]);

  // Say so when a recording finishes while the person is somewhere else in the app.
  const wasActive = useRef(new Set<string>());
  useEffect(() => {
    for (const r of data.recordings) {
      const active = r.state === "pending" || r.state === "recording";
      if (!active && wasActive.current.has(r.id) && r.state === "done") toast("Rig finished recording. Open Logs or Ask to see what it found.");
      if (active) wasActive.current.add(r.id); else wasActive.current.delete(r.id);
    }
  }, [data.recordings, toast]);

  const chatAbort = useRef<AbortController | null>(null);
  const pcId = ui.pcId;

  // The actions read the newest screen state and data through these, so they stay the same functions from one reading to the next.
  const uiNow = useRef(ui);
  uiNow.current = ui;
  const dataNow = useRef(data);
  dataNow.current = data;

  const actions = useMemo<Actions | null>(() => {
    if (!pcId) return null;
    // Read when an action runs, never when it's made.
    const pcOf = () => dataNow.current.pc!;

    const patchProposal = (proposalId: string, patch: Partial<NonNullable<ChatMessage["proposal"]>>) =>
      setData((d) => ({ ...d, chat: d.chat.map((m) => (m.proposal?.id === proposalId ? { ...m, proposal: { ...m.proposal, ...patch } } : m)) }));

    const patchScript = (messageId: string, patch: Partial<NonNullable<ChatMessage["script"]>>) =>
      setData((d) => ({ ...d, chat: d.chat.map((m) => (m.id === messageId && m.script ? { ...m, script: { ...m.script, ...patch } } : m)) }));

    const ctx: Actions = {
      client, host, set, toast,
      go: (r) => { location.hash = r; },
      pickPC: (id) => set({ pcId: id, selected: null }),

      ask: (q) => {
        if (!q.trim() || dataNow.current.answering) return;
        if (location.hash !== "#chat") location.hash = "chat";
        const mine: ChatMessage = { id: uid(), from: "you", text: q.trim() };
        const reply: ChatMessage = { id: uid(), from: "rig", text: "", pending: true };
        const history = [...dataNow.current.chat.filter((m) => !m.error), mine];
        setData((d) => ({ ...d, chat: [...d.chat, mine, reply], answering: true }));
        chatAbort.current?.abort();
        const ab = new AbortController();
        chatAbort.current = ab;
        const edit = (f: (m: ChatMessage) => ChatMessage) => setData((d) => ({ ...d, chat: d.chat.map((m) => (m.id === reply.id ? f(m) : m)) }));
        client.chat(pcId, history, (e) => {
          if (e.type === "text") edit((m) => ({ ...m, text: m.text + e.text }));
          else if (e.type === "sources") edit((m) => ({ ...m, sources: [...(m.sources ?? []), ...e.sources] }));
          else if (e.type === "steps") edit((m) => ({ ...m, steps: e.steps, ...(e.firmwareSetup ? { firmwareSetup: true } : {}) }));
          else if (e.type === "proposal") edit((m) => ({ ...m, proposal: e.proposal }));
          else if (e.type === "recording") edit((m) => ({ ...m, recording: e.request }));
          else if (e.type === "probe") edit((m) => ({ ...m, probe: e.op === "add" ? { op: "add", id: e.probe.id, label: e.probe.label, error: e.error } : { op: "remove", id: e.id, error: e.error } }));
          else if (e.type === "script") edit((m) => ({ ...m, script: { probe: e.probe, status: "waiting" } }));
          else if (e.type === "seal") edit((m) => ({ ...m, seal: e.seal }));
          else if (e.type === "error") edit((m) => ({ ...m, error: true, text: m.text || e.message }));
        }, ab.signal)
          .catch((err: unknown) => edit((m) => ({ ...m, error: true, text: m.text || `Rig couldn't answer just now. ${err instanceof Error ? err.message : ""} Check your internet connection and send it again.`.replace(/\s+/g, " ").trim() })))
          .finally(() => { edit((m) => ({ ...m, pending: false })); setData((d) => ({ ...d, answering: false })); });
        requestAnimationFrame(() => document.querySelector(".chat-composer")?.scrollIntoView({ block: "end" }));
      },

      clearChat: () => { if (!dataNow.current.answering) setData((d) => ({ ...d, chat: [] })); },

      review: (steps, meta) => once("review", async () => {
        if (!client.caps.applyChanges) { toast(`Changes can only be made in the Rig app on ${pcOf().name}.`); return; }
        let rows: DiffRow[];
        try { rows = await client.preview(pcId, steps); } catch (e) { toast(`Couldn't read the current settings, so nothing was changed. ${e instanceof Error ? e.message : ""} Try again in a moment.`.replace(/\s+/g, " ").trim()); return; }
        const title = meta.title ?? stepsTitle(steps);
        set({ review: { title, body: meta.body ?? "Here's exactly what will change. Nothing happens until you confirm.", rows, steps, cta: meta.cta ?? (steps.length === 1 ? "Make this change" : `Make ${steps.length} changes`), by: meta.by, why: meta.why, proposalId: meta.proposalId } });
      }),

      confirmReview: async () => {
        const r = uiNow.current.review;
        if (!r || r.busy) return;
        set({ review: { ...r, busy: true, error: undefined } });
        try {
          const from = r.proposalId ? { proposalId: r.proposalId, messageId: dataNow.current.chat.find((m) => m.proposal?.id === r.proposalId)?.id } : undefined;
          const change = await client.apply(pcId, r.steps, { title: r.title, why: r.why, by: r.by, from });
          setData((d) => ({ ...d, changes: [change, ...d.changes.filter((c) => c.id !== change.id)] }));
          if (r.proposalId) patchProposal(r.proposalId, { status: "applied", changeId: change.id });
          set({ review: null });
          toast(r.steps.length === 1 ? "Done." : `${r.steps.length} changes made.`, change.id);
        } catch (e) {
          set({ review: { ...r, busy: false, error: e instanceof Error ? e.message : "Rig couldn't make this change, so nothing was changed. Try again, and if it keeps happening, restart Rig." } });
        }
      },

      startRecording: async (minutes, reason) => {
        try {
          const info = await client.startRecording(pcId, { minutes, reason });
          setData((d) => ({ ...d, recordings: [info, ...d.recordings.filter((r) => r.id !== info.id)] }));
          toast(info.state === "pending" ? `${pcOf().name} starts recording the next time its Rig app checks in.` : `Recording for ${minutes} minutes. Nothing on ${pcOf().name} changes.`);
        } catch (e) { toast(e instanceof Error && e.message ? e.message : "Rig couldn't start recording. Try again, and if it keeps happening, restart Rig."); }
      },

      stopRecording: (id) => once(`stop:${id}`, async () => {
        try {
          await client.stopRecording(pcId, id);
          if (!client.caps.local) toast(`${pcOf().name} stops recording the next time its Rig app checks in.`);
        } catch (e) { toast(`Rig couldn't stop the recording. ${e instanceof Error ? e.message : ""} Try Stop again in a moment.`.replace(/\s+/g, " ").trim()); }
      }),

      openRecording: (id) => {
        // A log opens over the Logs view it was picked from; from anywhere else, over Logs.
        const inLogs = logRoutes.includes(uiNow.current.route);
        const back = id == null && uiNow.current.recordingId != null && inLogs;
        if (id != null && inLogs && uiNow.current.recordingId == null) logsScroll.current = window.scrollY;
        set({ recordingId: id });
        if (id && !inLogs) location.hash = "logs";
        // Back to the list lands where it was; a recording opens at its top.
        if (back) requestAnimationFrame(() => window.scrollTo(0, logsScroll.current));
        else window.scrollTo(0, 0);
      },

      commandStep: (proposalId, index, act) => once(`command:${proposalId}:${index}`, async () => {
        const message = dataNow.current.chat.find((m) => m.proposal?.id === proposalId);
        const p = message?.proposal;
        const preview = p?.previews?.[index];
        const was = p?.outcomes?.[index];
        if (!p) return;
        if (!client.caps.applyChanges || !client.previewStep || !client.applyStep || !client.undoStep) { toast(`Changes can only be made in the Rig app on ${pcOf().name}.`); return; }
        const at = <T,>(list: (T | null | undefined)[] | undefined, v: T | null) => p.steps.map((_, i) => (i === index ? v : list?.[i] ?? null));
        const patch = (f: (q: NonNullable<ChatMessage["proposal"]>) => Partial<NonNullable<ChatMessage["proposal"]>>) =>
          setData((d) => ({ ...d, chat: d.chat.map((m) => (m.proposal?.id === proposalId ? { ...m, proposal: { ...m.proposal, ...f(m.proposal) } } : m)) }));
        const keep = (o: StepOutcome) => patch((q) => ({ outcomes: at(q.outcomes, o) }));
        const asked = p.steps[index];
        if (!asked || asked.kind === "fix") return;
        const step = helperStep(asked);
        if (typeof step === "string") return;
        try {
          if (act === "read" && p.status !== "declined" && (!was || was.apply.outcome === "expired" || was.apply.outcome === "refused" || was.apply.outcome === "declined")) {
            const fresh = await client.previewStep(pcId, step, !!p.tainted);
            patch((q) => ({ previews: at(q.previews, fresh), outcomes: at(q.outcomes, null) }));
            return;
          }
          if (act === "apply" && preview?.outcome === "ready" && (!was || was.apply.outcome === "declined") && p.status !== "declined" && !waitingOn(p, index)) {
            if (stale(preview.expiresAt)) { patch((q) => ({ previews: at(q.previews, null) })); return; }
            const apply = await client.applyStep(pcId, preview.nonce, { title: stepHeadline(asked, preview.verdict.commands, p.looks), why: p.why, by: "rig", from: { proposalId, messageId: message.id } });
            keep({ apply });
          } else if (act === "undo" && was?.apply.outcome === "applied" && was.undo?.outcome !== "undone") {
            keep({ ...was, undo: await client.undoStep(pcId, was.apply.undo.id) });
          } else if (act === "forceUndo" && was?.apply.outcome === "applied" && was.undo?.outcome === "drifted") {
            keep({ ...was, undo: await client.undoStep(pcId, was.apply.undo.id, true) });
          } else return;
          const changes = await client.changes(pcId);
          setData((d) => ({ ...d, changes }));
        } catch (e) {
          const what = act === "read" ? "read the current settings" : act === "apply" ? "make this change" : "undo this";
          toast(`Rig couldn't ${what}. ${e instanceof Error ? e.message : ""} Try again, and if it keeps happening, restart Rig.`.replace(/\s+/g, " ").trim());
        }
      }),

      firmwareRestart: (messageId, act) => once(`restart:${messageId}`, async () => {
        const m = dataNow.current.chat.find((x) => x.id === messageId);
        if (!m?.firmwareSetup) return;
        if (!client.caps.applyChanges || !client.previewStep || !client.applyStep || !client.undoStep) { toast(`Rig can restart into firmware setup only in the Rig app on ${pcOf().name}.`); return; }
        const was = m.restart ?? {};
        const keep = (restart: NonNullable<ChatMessage["restart"]>) => setData((d) => ({ ...d, chat: d.chat.map((x) => (x.id === messageId ? { ...x, restart } : x)) }));
        const applied = was.outcome?.apply.outcome === "applied";
        try {
          if (act === "reset" && !applied) keep({});
          // The op is only its name, so nothing the chat read can reach it.
          else if (act === "read" && !applied) keep({ preview: await client.previewStep(pcId, { kind: "native", op: { name: "restartToFirmware" } }, false) });
          else if (act === "apply" && was.preview?.outcome === "ready" && !applied) {
            if (stale(was.preview.expiresAt)) { keep({}); return; }
            const apply = await client.applyStep(pcId, was.preview.nonce, { title: RESTART_WORDS.title, by: "rig" });
            keep({ ...was, outcome: { apply }, at: new Date().toISOString() });
          } else if (act === "cancel" && was.outcome?.apply.outcome === "applied" && was.outcome.undo?.outcome !== "undone") {
            keep({ ...was, outcome: { ...was.outcome, undo: await client.undoStep(pcId, was.outcome.apply.undo.id) } });
          } else return;
          if (act === "apply" || act === "cancel") { const changes = await client.changes(pcId); setData((d) => ({ ...d, changes })); }
        } catch (e) {
          const what = act === "read" ? "check whether it can restart into firmware setup" : act === "apply" ? "set the restart" : "cancel the restart";
          toast(`Rig couldn't ${what}. ${e instanceof Error ? e.message : ""}`.replace(/\s+/g, " ").trim());
        }
      }),

      declineProposal: (proposalId) => {
        const p = dataNow.current.chat.find((m) => m.proposal?.id === proposalId)?.proposal;
        const made = p ? appliedCount(p) : 0;
        patchProposal(proposalId, { status: "declined" });
        toast(!made ? "Okay, nothing was changed." : `Okay. ${made === 1 ? "The step you applied stays" : `The ${made} steps you applied stay`}; the rest won't run. Undo them in Changes.`);
      },

      approveScript: (messageId) => once(`script:${messageId}`, async () => {
        const m = dataNow.current.chat.find((x) => x.id === messageId);
        const sc = m?.script;
        const rec = host.recorder;
        if (!sc || sc.status !== "waiting") return;
        if (!rec?.probes || !rec.approveAdmin) { toast(`Scripts run in the background recorder, in the Rig app on ${pcOf().name}.`); return; }
        const s = sc.probe.source;
        try {
          if (s.kind === "script" && s.admin) await rec.approveAdmin(sc.probe);
          else await rec.probes({ op: "approve", probe: sc.probe });
          patchScript(messageId, { status: "approved", error: undefined });
          void client.refreshBackground?.();
          toast("Approved. It runs in the background recorder; turn it off any time in Settings.");
        } catch (e) {
          patchScript(messageId, { error: e instanceof Error ? e.message : "Rig couldn't approve the script." });
        }
      }),
      declineScript: (messageId) => { patchScript(messageId, { status: "declined" }); toast("Okay, the script won't run."); },

      toggleChange: (id) => once(`change:${id}`, async () => {
        const c = dataNow.current.changes.find((x) => x.id === id);
        if (!c) return;
        if (!client.caps.applyChanges) { toast(`Undo works from the Rig app on ${pcOf().name}.`); return; }
        const commands = c.applied.filter((a) => a.undo.kind !== "fix");
        if (commands.length) {
          if (c.status !== "applied" || !client.undoStep) return;
          try {
            const replies: [string, UndoReply][] = [];
            for (const a of [...commands].reverse()) if (a.undo.kind !== "fix") replies.push([a.undo.id, await client.undoStep(pcId, a.undo.id)]);
            const changes = await client.changes(pcId);
            const by = new Map(replies);
            setData((d) => ({
              ...d, changes,
              chat: d.chat.map((m) => {
                const q = m.proposal;
                if (!q?.outcomes?.some((o) => o?.apply.outcome === "applied" && by.has(o.apply.undo.id))) return m;
                return { ...m, proposal: { ...q, outcomes: q.outcomes.map((o) => (o?.apply.outcome === "applied" && by.has(o.apply.undo.id) ? { ...o, undo: by.get(o.apply.undo.id) } : o ?? null)) } };
              }),
            }));
            toast(replies.map(([, u]) => undoneLine(u)).join(" "));
          } catch (e) {
            toast(`Couldn't undo that. ${e instanceof Error ? e.message : ""} Try again in a moment.`.replace(/\s+/g, " ").trim());
          }
          return;
        }
        try {
          const next = c.status === "applied" ? await client.undo(pcId, id) : await client.redo(pcId, id);
          setData((d) => ({ ...d, changes: d.changes.map((x) => (x.id === id ? next : x)), chat: d.chat.map((m) => (m.proposal?.changeId === id ? { ...m, proposal: { ...m.proposal, status: next.status === "applied" ? "applied" : "waiting" } } : m)) }));
          toast(next.status === "undone" ? `Undone. ${c.title} is back to how it was.` : `Made again: ${c.title}.`);
        } catch (e) {
          toast(`Couldn't ${c.status === "applied" ? "undo" : "redo"} that, so nothing was changed. ${e instanceof Error ? e.message : ""} Try again in a moment.`.replace(/\s+/g, " ").trim());
        }
      }),

      openReverts: async () => {
        const before = dataNow.current.changes;
        if (!client.caps.applyChanges || !client.reverts || !before.some((c) => c.status === "applied" && c.applied.some((a) => "revert" in a && a.revert))) return [];
        const open = await client.reverts(pcId).catch(() => []);
        const changes = await client.changes(pcId);
        if (changes.some((c, i) => c.status !== before[i]?.status) || changes.length !== before.length) setData((d) => ({ ...d, changes }));
        return open;
      },
    };
    return ctx;
  }, [client, host, pcId, set, toast, once]);

  const value = useMemo<Ctx | null>(() => (actions && data.pc ? { ...actions, ui, data, pc: data.pc } : null), [actions, ui, data]);
  const store = useRef<Store & { value: Ctx | null; fns: Set<() => void> }>(null!);
  if (!store.current) {
    const st = { value: null as Ctx | null, fns: new Set<() => void>(), get: () => st.value!, subscribe: (fn: () => void) => { st.fns.add(fn); return () => { st.fns.delete(fn); }; } };
    store.current = st;
  }
  store.current.value = value;
  // Tell the screens that picked a part of the state once the new state is in place.
  useLayoutEffect(() => { store.current.fns.forEach((f) => f()); }, [value]);

  const retry = () => { setLoaded(false); setFailed(null); setAttempt((n) => n + 1); };
  if (!value || !actions) return <>{fallback(!loaded ? "loading" : failed !== null ? "error" : data.pcs.some((p) => p.parts) ? "loading" : "empty", retry, failed)}</>;
  return (
    <StoreCtx.Provider value={store.current}>
      <ActionsCtx.Provider value={actions}>
        <UICtx.Provider value={ui}>
          <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
        </UICtx.Provider>
      </ActionsCtx.Provider>
    </StoreCtx.Provider>
  );
}

// ----- Alert preferences, kept on this device -----

const ALERTS_OFF = "rig.alerts.off";
const alertListeners = new Set<() => void>();
let alertsOffCache: { raw: string | null; kinds: AlertKind[] } = { raw: null, kinds: [] };

/** The alert kinds turned off on this device. Every kind is on until someone turns it off. */
export function alertKindsOff(): AlertKind[] {
  const raw = storage.get(ALERTS_OFF);
  if (raw !== alertsOffCache.raw) {
    let kinds: AlertKind[] = [];
    try {
      const v: unknown = JSON.parse(raw ?? "[]");
      if (Array.isArray(v)) kinds = alertRules.map((r) => r.kind).filter((k) => v.includes(k));
    } catch { /* a damaged value turns everything back on */ }
    alertsOffCache = { raw, kinds };
  }
  return alertsOffCache.kinds;
}

export function setAlertKind(kind: AlertKind, on: boolean) {
  const rest = alertKindsOff().filter((k) => k !== kind);
  storage.set(ALERTS_OFF, JSON.stringify(on ? rest : [...rest, kind]));
  alertListeners.forEach((f) => f());
}

function onAlertPrefs(f: () => void) {
  const fromOtherWindow = (e: StorageEvent) => { if (e.key === ALERTS_OFF || e.key === RECORDING_NOTICE) f(); };
  alertListeners.add(f);
  window.addEventListener("storage", fromOtherWindow);
  return () => { alertListeners.delete(f); window.removeEventListener("storage", fromOtherWindow); };
}

/** The alert kinds turned off on this device, kept current as they change. */
export function useAlertKindsOff(): AlertKind[] {
  return useSyncExternalStore(onAlertPrefs, alertKindsOff, () => []);
}

const RECORDING_NOTICE = "rig.notify.recordingDone";

/** Whether the Rig app on this PC sends a notification when a recording finishes. On until someone turns it off. */
export const recordingNoticeOn = () => storage.get(RECORDING_NOTICE) !== "off";

export function setRecordingNotice(on: boolean) {
  storage.set(RECORDING_NOTICE, on ? "on" : "off");
  alertListeners.forEach((f) => f());
}

export function useRecordingNoticeOn(): boolean {
  return useSyncExternalStore(onAlertPrefs, recordingNoticeOn, () => true);
}

// ----- Appearance, kept on this device -----

const APPEARANCE = "rig.appearance.v1";
const appearanceListeners = new Set<() => void>();
let appearanceCache: { raw: string | null | undefined; value: Appearance } = { raw: undefined, value: defaultAppearance };

/** How Rig looks on this device: colors, chrome, corners, density, text size and motion. */
export function storedAppearance(): Appearance {
  const raw = storage.get(APPEARANCE);
  if (raw !== appearanceCache.raw) appearanceCache = { raw, value: parseAppearance(raw) };
  return appearanceCache.value;
}

export function setAppearance(patch: Partial<Appearance>) {
  storage.set(APPEARANCE, JSON.stringify({ ...storedAppearance(), ...patch }));
  appearanceListeners.forEach((f) => f());
}

export const resetAppearance = () => setAppearance(defaultAppearance);

function onAppearance(f: () => void) {
  const fromOtherWindow = (e: StorageEvent) => { if (e.key === APPEARANCE) f(); };
  appearanceListeners.add(f);
  window.addEventListener("storage", fromOtherWindow);
  return () => { appearanceListeners.delete(f); window.removeEventListener("storage", fromOtherWindow); };
}

/** The appearance picked on this device, kept current as it changes here or in another window. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(onAppearance, storedAppearance, () => defaultAppearance);
}
