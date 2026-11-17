import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pcs as pcSeed, chat as chatSeed, changes as changeSeed, type Change, type ChatMessage, type DiffRow, type PC, type Route } from "./data";
import { colorways, sidebars, styles, type ColorId, type SideId, type StyleId } from "./themes";

export const routes: Route[] = ["overview", "pc", "chat", "changes", "upgrades", "games", "history", "web", "signin"];

export interface ModalState { kind: "proposal" | "driver" | "game"; title: string; body: string; rows: DiffRow[]; cta: string }
export interface ToastState { msg: string; undo?: string }

export interface UI {
  route: Route;
  style: StyleId;
  colors: ColorId;
  side: SideId;
  pcId: string;
  pcs: Record<string, PC>;
  exploded: boolean;
  heat: boolean;
  airflow: boolean;
  selected: string | null;
  tab: string;
  range: "24h" | "7d" | "30d";
  changes: Change[];
  chat: ChatMessage[];
  proposalApplied: boolean;
  modal: ModalState | null;
  toast: ToastState | null;
  mockMin: boolean;
  palette: boolean;
}

const storage = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function routeFromHash(): Route {
  const h = location.hash.replace("#", "") as Route;
  return routes.includes(h) ? h : "overview";
}

function initial(): UI {
  const style = storage.get("rig.style") as StyleId | null;
  const pcId = storage.get("rig.pc");
  const colors = storage.get("rig.colors") as ColorId | null;
  const side = storage.get("rig.sidebar") as SideId | null;
  return {
    route: routeFromHash(),
    style: styles.some((s) => s.id === style) ? style! : "studio",
    colors: colorways.some((c) => c.id === colors) ? colors! : "peach",
    side: sidebars.some((c) => c.id === side) ? side! : "panel",
    pcId: pcId && pcSeed[pcId]?.parts ? pcId : "atlas",
    pcs: structuredClone(pcSeed),
    exploded: false, heat: false, airflow: true, selected: null, tab: "live", range: "7d",
    changes: structuredClone(changeSeed),
    chat: structuredClone(chatSeed),
    proposalApplied: false, modal: null, toast: null, mockMin: false, palette: false,
  };
}

interface Ctx {
  ui: UI;
  pc: PC;
  set: (patch: Partial<UI> | ((u: UI) => Partial<UI>)) => void;
  go: (r: Route) => void;
  toast: (msg: string, undo?: string) => void;
  ask: (q: string) => void;
  applyModal: () => void;
  toggleChange: (id: string) => void;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function AppProvider({ children }: { children: ReactNode }) {
  const [ui, setUI] = useState<UI>(initial);
  const set = useCallback((patch: Partial<UI> | ((u: UI) => Partial<UI>)) => {
    setUI((u) => ({ ...u, ...(typeof patch === "function" ? patch(u) : patch) }));
  }, []);

  useEffect(() => {
    const on = () => { set({ route: routeFromHash() }); if (routeFromHash() !== "chat") window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [set]);
  useEffect(() => { storage.set("rig.style", ui.style); }, [ui.style]);
  useEffect(() => { storage.set("rig.colors", ui.colors); }, [ui.colors]);
  useEffect(() => { storage.set("rig.sidebar", ui.side); }, [ui.side]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, [contenteditable]") !== null);
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) { e.preventDefault(); set({ palette: true }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);
  useEffect(() => { storage.set("rig.pc", ui.pcId); }, [ui.pcId]);

  const timer = useRef(0);
  const toast = useCallback((msg: string, undo?: string) => {
    set({ toast: { msg, undo } });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set({ toast: null }), 5000);
  }, [set]);

  const value = useMemo<Ctx>(() => ({
    ui,
    pc: ui.pcs[ui.pcId],
    set,
    toast,
    go: (r) => { location.hash = r; },
    ask: (q) => {
      if (!q.trim()) return;
      set((u) => ({
        chat: [...u.chat,
          { from: "you", text: q },
          { from: "claude", text: "In the real app this answer would come from your parts' manuals and this PC's readings, with the sources listed underneath. The mockup only has the sample conversation above." }],
      }));
      if (location.hash !== "#chat") location.hash = "chat";
      requestAnimationFrame(() => document.querySelector(".composer")?.scrollIntoView({ block: "end" }));
    },
    applyModal: () => {
      const m = ui.modal;
      if (!m) return;
      const id = `n${Date.now()}`;
      const title = m.kind === "proposal" ? m.body
        : m.kind === "driver" ? `Updated ${m.rows[0][0].toLowerCase()} driver`
        : m.title.replace("Apply tuned settings for ", "Tuned settings for ").replace("?", "");
      const change: Change = { id, when: "Just now", title, by: "Claude, after you said yes", status: "applied", why: "", diff: m.rows, result: "", restore: "Restore point made just now" };
      set((u) => ({ modal: null, changes: [change, ...u.changes], proposalApplied: u.proposalApplied || m.kind === "proposal" }));
      toast(`${m.rows.length === 1 ? "Change" : `${m.rows.length} changes`} applied.`, id);
    },
    toggleChange: (id) => {
      const c = ui.changes.find((x) => x.id === id);
      if (!c) return;
      const status = c.status === "applied" ? "undone" : "applied";
      set((u) => ({
        changes: u.changes.map((x) => (x.id === id ? { ...x, status } : x)),
        proposalApplied: status === "undone" && u.chat.some((m) => m.proposal?.title === c.title) ? false : u.proposalApplied,
      }));
      toast(status === "undone" ? `Undone. ${c.title} is back to how it was.` : `Reapplied: ${c.title}.`);
    },
  }), [ui, set, toast]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
