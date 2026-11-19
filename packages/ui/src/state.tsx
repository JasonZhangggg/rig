import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { RecorderLink } from "@rig/core";
import { defaultAppearance, parseAppearance, type Appearance } from "./appearance";
import { alertRules, formatTemp, isTempUnit, tempsInText, titleFor, type TempFormat, type TempUnit, type Account, type AlertKind, type ActionCall, type Change, type ChatMessage, type DiffRow, type HistoryPoint, type PC, type Range, type RecordingInfo, type RigClient, type Route } from "@rig/core";

export const routes: Route[] = ["overview", "pc", "chat", "changes", "upgrades", "games", "history", "logs", "manuals", "web", "signin", "settings"];

/** What the app around the screens can do beyond the client. The desktop app passes these; the website passes none. */
export interface AppHost {
  /** Start Rig when the person signs in to Windows. */
  autostart?: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  /** The Rig server this app signs in to, shown in Settings. */
  server?: string;
  /** Rig's background recorder, turned on and off in Settings. Windows only. */
  recorder?: Pick<RecorderLink, "status" | "set" | "probes" | "approveAdmin">;
}

/** The review sheet shown before any change is made. */
export interface Review {
  title: string;
  body: string;
  rows: DiffRow[];
  calls: ActionCall[];
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
  heat: boolean;
  selected: string | null;
  tab: string;
  range: Range;
  review: Review | null;
  toast: ToastState | null;
  palette: boolean;
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
}

const storage = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/** Pages that moved into My PC: their old addresses still open it. */
const movedToPC: Route[] = ["manuals", "upgrades"];

function routeFromHash(): Route {
  const h = location.hash.replace("#", "") as Route;
  if (movedToPC.includes(h)) { history.replaceState(null, "", "#pc"); return "pc"; }
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
  review: (calls: ActionCall[], meta: { title?: string; body?: string; cta?: string; by: "you" | "rig"; why?: string; proposalId?: string }) => Promise<void>;
  confirmReview: () => Promise<void>;
  declineProposal: (proposalId: string) => void;
  /** The person approved a script Rig proposed. Runs as admin only after Windows' own prompt. Never called by the chat. */
  approveScript: (messageId: string) => Promise<void>;
  declineScript: (messageId: string) => void;
  toggleChange: (id: string) => Promise<void>;
  pickPC: (id: string) => void;
  /** Starts recording readings on the PC. Nothing changes there, so there's no review. */
  startRecording: (minutes: number, reason: string) => Promise<void>;
  stopRecording: (id: string) => Promise<void>;
  openRecording: (id: string | null) => void;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

/** The temperature unit picked on this device, for code outside the screens such as notifications. */
export function storedTempUnit(): TempUnit {
  const u = storage.get("rig.tempUnit");
  return isTempUnit(u) ? u : "c";
}

/** The viewer's temperature unit. Outside the app (as in a test of one card) it's °C. */
export const useTempUnit = (): TempUnit => useContext(AppCtx)?.ui.tempUnit ?? "c";

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

/** The on-screen PC's recorded history over a range. Null while it loads, empty when there is none or it couldn't be read. */
export function useHistory(range: Range): HistoryPoint[] | null {
  const { client, pc } = useApp();
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  useEffect(() => {
    let live = true;
    setPoints(null);
    client.history(pc.id, range).then((p) => live && setPoints(p)).catch(() => live && setPoints([]));
    return () => { live = false; };
  }, [client, pc.id, range]);
  return points;
}

/** What shows before a PC is on screen: still reading, no PCs, or the list couldn't be read (with a way to try again). */
export type Pending = "loading" | "empty" | "error";

const noHost: AppHost = {};

export function AppProvider({ client, host = noHost, children, fallback }: { client: RigClient; host?: AppHost; children: ReactNode; fallback: (state: Pending, retry: () => void) => ReactNode }) {
  const [ui, setUI] = useState<UI>(() => ({
    route: routeFromHash(),
    pcId: storage.get("rig.pc"),
    exploded: false, heat: false, selected: null, tab: "live", range: "7d",
    review: null, toast: null, palette: false, sideMini: storage.get("rig.sideMini") === "1", recordingId: null,
    tempUnit: storedTempUnit(),
  }));
  const [data, setData] = useState<Data>({ account: null, pcs: [], pc: null, changes: [], chat: [], answering: false, recordings: [] });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const set = useCallback((patch: Partial<UI> | ((u: UI) => Partial<UI>)) => {
    setUI((u) => ({ ...u, ...(typeof patch === "function" ? patch(u) : patch) }));
  }, []);

  // Account and the list of PCs
  useEffect(() => {
    let live = true;
    Promise.all([client.account(), client.machines()]).then(([account, pcs]) => {
      if (!live) return;
      setData((d) => ({ ...d, account, pcs }));
      setUI((u) => ({ ...u, pcId: pcs.some((p) => p.id === u.pcId && p.parts) ? u.pcId : pcs.find((p) => p.parts)?.id ?? null }));
      setFailed(false);
      setLoaded(true);
    }).catch(() => { if (live) { setFailed(true); setLoaded(true); } });
    return () => { live = false; };
  }, [client, attempt]);

  // Live view of the chosen PC, its changes and a fresh chat
  useEffect(() => {
    if (!ui.pcId) return;
    storage.set("rig.pc", ui.pcId);
    const id = ui.pcId;
    setData((d) => ({ ...d, pc: d.pcs.find((p) => p.id === id && p.parts) ?? null, changes: [], chat: client.conversation?.(id) ?? [], recordings: [] }));
    setUI((u) => ({ ...u, recordingId: null }));
    const stop = client.watch(id, (pc) => setData((d) => ({ ...d, pc, pcs: d.pcs.map((p) => (p.id === pc.id ? pc : p)) })));
    const stopRecordings = client.watchRecordings(id, (recordings) => setData((d) => ({ ...d, recordings })));
    client.changes(id).then((changes) => setData((d) => ({ ...d, changes }))).catch(() => {});
    return () => { stop(); stopRecordings(); };
  }, [client, ui.pcId]);

  useEffect(() => {
    const on = () => { set({ route: routeFromHash() }); if (routeFromHash() !== "chat") window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [set]);
  useEffect(() => { storage.set("rig.sideMini", ui.sideMini ? "1" : "0"); }, [ui.sideMini]);
  useEffect(() => { storage.set("rig.tempUnit", ui.tempUnit); }, [ui.tempUnit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]") !== null;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) { e.preventDefault(); set({ palette: true }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  const timer = useRef(0);
  const toast = useCallback((msg: string, undo?: string) => {
    set({ toast: { msg, undo } });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set({ toast: null }), 6000);
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

  const value = useMemo<Ctx | null>(() => {
    if (!data.pc || !pcId) return null;
    const pc = data.pc;

    const patchProposal = (proposalId: string, patch: Partial<NonNullable<ChatMessage["proposal"]>>) =>
      setData((d) => ({ ...d, chat: d.chat.map((m) => (m.proposal?.id === proposalId ? { ...m, proposal: { ...m.proposal, ...patch } } : m)) }));

    const patchScript = (messageId: string, patch: Partial<NonNullable<ChatMessage["script"]>>) =>
      setData((d) => ({ ...d, chat: d.chat.map((m) => (m.id === messageId && m.script ? { ...m, script: { ...m.script, ...patch } } : m)) }));

    const ctx: Ctx = {
      client, host, ui, data, pc, set, toast,
      go: (r) => { location.hash = r; },
      pickPC: (id) => set({ pcId: id, selected: null }),

      ask: (q) => {
        if (!q.trim() || data.answering) return;
        if (location.hash !== "#chat") location.hash = "chat";
        const mine: ChatMessage = { id: uid(), from: "you", text: q.trim() };
        const reply: ChatMessage = { id: uid(), from: "rig", text: "", pending: true };
        const history = [...data.chat.filter((m) => !m.error), mine];
        setData((d) => ({ ...d, chat: [...d.chat, mine, reply], answering: true }));
        chatAbort.current?.abort();
        const ab = new AbortController();
        chatAbort.current = ab;
        const edit = (f: (m: ChatMessage) => ChatMessage) => setData((d) => ({ ...d, chat: d.chat.map((m) => (m.id === reply.id ? f(m) : m)) }));
        client.chat(pcId, history, (e) => {
          if (e.type === "text") edit((m) => ({ ...m, text: m.text + e.text }));
          else if (e.type === "sources") edit((m) => ({ ...m, sources: [...(m.sources ?? []), ...e.sources] }));
          else if (e.type === "steps") edit((m) => ({ ...m, steps: e.steps }));
          else if (e.type === "proposal") edit((m) => ({ ...m, proposal: e.proposal }));
          else if (e.type === "recording") edit((m) => ({ ...m, recording: e.request }));
          else if (e.type === "probe") edit((m) => ({ ...m, probe: e.op === "add" ? { op: "add", id: e.probe.id, label: e.probe.label, error: e.error } : { op: "remove", id: e.id, error: e.error } }));
          else if (e.type === "script") edit((m) => ({ ...m, script: { probe: e.probe, status: "waiting" } }));
          else if (e.type === "error") edit((m) => ({ ...m, error: true, text: m.text || e.message }));
        }, ab.signal)
          .catch((err: unknown) => edit((m) => ({ ...m, error: true, text: m.text || `Rig couldn't answer just now. ${err instanceof Error ? err.message : ""}`.trim() })))
          .finally(() => { edit((m) => ({ ...m, pending: false })); setData((d) => ({ ...d, answering: false })); });
        requestAnimationFrame(() => document.querySelector(".composer")?.scrollIntoView({ block: "end" }));
      },

      clearChat: () => { if (!data.answering) setData((d) => ({ ...d, chat: [] })); },

      review: async (calls, meta) => {
        if (!client.caps.applyChanges) { toast(`Changes can only be made in the Rig app on ${pc.name}.`); return; }
        let rows: DiffRow[];
        try { rows = await client.preview(pcId, calls); } catch (e) { toast(`Couldn't read the current settings. ${e instanceof Error ? e.message : ""}`); return; }
        const title = meta.title ?? titleFor(calls);
        set({ review: { title, body: meta.body ?? "Here's exactly what will change. Nothing happens until you confirm.", rows, calls, cta: meta.cta ?? (calls.length === 1 ? "Make this change" : `Make ${calls.length} changes`), by: meta.by, why: meta.why, proposalId: meta.proposalId } });
      },

      confirmReview: async () => {
        const r = ui.review;
        if (!r || r.busy) return;
        set({ review: { ...r, busy: true, error: undefined } });
        try {
          const change = await client.apply(pcId, r.calls, { title: r.title, why: r.why, by: r.by });
          setData((d) => ({ ...d, changes: [change, ...d.changes.filter((c) => c.id !== change.id)] }));
          if (r.proposalId) patchProposal(r.proposalId, { status: "applied", changeId: change.id });
          set({ review: null });
          toast(r.calls.length === 1 ? "Done." : `${r.calls.length} changes made.`, change.id);
        } catch (e) {
          set({ review: { ...r, busy: false, error: e instanceof Error ? e.message : "Something went wrong. Nothing was changed." } });
        }
      },

      startRecording: async (minutes, reason) => {
        try {
          const info = await client.startRecording(pcId, { minutes, reason });
          setData((d) => ({ ...d, recordings: [info, ...d.recordings.filter((r) => r.id !== info.id)] }));
          toast(info.state === "pending" ? `${pc.name} starts recording the next time its Rig app checks in.` : `Recording for ${minutes} minutes. Nothing on ${pc.name} changes.`);
        } catch (e) { toast(e instanceof Error && e.message ? e.message : "Rig couldn't start recording."); }
      },

      stopRecording: async (id) => {
        try {
          await client.stopRecording(pcId, id);
          if (!client.caps.local) toast(`${pc.name} stops recording the next time its Rig app checks in.`);
        } catch (e) { toast(`Rig couldn't stop the recording. ${e instanceof Error ? e.message : ""}`.trim()); }
      },

      openRecording: (id) => { set({ recordingId: id }); if (id && location.hash !== "#logs") location.hash = "logs"; window.scrollTo(0, 0); },

      declineProposal: (proposalId) => { patchProposal(proposalId, { status: "declined" }); toast("Okay, nothing was changed."); },

      approveScript: async (messageId) => {
        const m = data.chat.find((x) => x.id === messageId);
        const sc = m?.script;
        const rec = host.recorder;
        if (!sc || sc.status !== "waiting") return;
        if (!rec?.probes || !rec.approveAdmin) { toast(`Scripts run in the background recorder, in the Rig app on ${pc.name}.`); return; }
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
      },
      declineScript: (messageId) => { patchScript(messageId, { status: "declined" }); toast("Okay, the script won't run."); },

      toggleChange: async (id) => {
        const c = data.changes.find((x) => x.id === id);
        if (!c) return;
        if (!client.caps.applyChanges) { toast(`Undo works from the Rig app on ${pc.name}.`); return; }
        try {
          const next = c.status === "applied" ? await client.undo(pcId, id) : await client.redo(pcId, id);
          setData((d) => ({ ...d, changes: d.changes.map((x) => (x.id === id ? next : x)), chat: d.chat.map((m) => (m.proposal?.changeId === id ? { ...m, proposal: { ...m.proposal, status: next.status === "applied" ? "applied" : "waiting" } } : m)) }));
          toast(next.status === "undone" ? `Undone. ${c.title} is back to how it was.` : `Made again: ${c.title}.`);
        } catch (e) {
          toast(`Couldn't ${c.status === "applied" ? "undo" : "redo"} that. ${e instanceof Error ? e.message : ""}`);
        }
      },
    };
    return ctx;
  }, [client, host, ui, data, pcId, set, toast]);

  const retry = () => { setLoaded(false); setFailed(false); setAttempt((n) => n + 1); };
  if (!value) return <>{fallback(!loaded ? "loading" : failed ? "error" : data.pcs.some((p) => p.parts) ? "loading" : "empty", retry)}</>;
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
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
