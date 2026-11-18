import { useCallback, useEffect, useRef, useState } from "react";
import { arrange, defaultDashboard, parseDashboard, serialize, syncLayouts, update, type Bp, type Cell, type Dashboard, type Widget } from "./layout";

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };
const forget = (key: string) => { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } };

export const dashboardKey = (owner: string | null | undefined) => (owner ? `rig.dashboard.v1:${owner}` : "rig.dashboard.v1");

interface State { key: string; dash: Dashboard; dirty: boolean }
const UNDO_DEPTH = 40;

/** The dashboard saved under `key` on this device, the changes the page makes to it, and a way back from each. */
export function useDashboard(key: string) {
  const [state, setState] = useState<State>(() => ({ key, dash: parseDashboard(read(key)), dirty: false }));
  const past = useRef<Dashboard[]>([]);
  if (state.key !== key) { past.current = []; setState({ key, dash: parseDashboard(read(key)), dirty: false }); }
  const dash = state.key === key ? state.dash : parseDashboard(read(key));

  // Saved only once the person changes something, so a dashboard nobody touched keeps following the defaults.
  useEffect(() => { if (state.dirty) write(state.key, serialize(state.dash)); }, [state]);

  // The latest state, read and written synchronously so changes in one event build on each other and history stays exact.
  const cur = useRef(state);
  cur.current = state;
  const commit = useCallback((next: State, from?: Dashboard) => {
    if (from) past.current = [...past.current.slice(1 - UNDO_DEPTH), from];
    cur.current = next;
    setState(next);
  }, []);

  const change = useCallback((fn: (d: Dashboard) => Dashboard) => {
    const s = cur.current;
    const next = fn(s.dash);
    if (next !== s.dash) commit({ key: s.key, dash: next, dirty: true }, s.dash);
  }, [commit]);

  const show = useCallback((id: string, hidden: boolean) => change((d) => syncLayouts({ ...d, widgets: update(d.widgets, id, { hidden }) })), [change]);

  return {
    dash,
    change,
    setWidget: useCallback((id: string, patch: Partial<Widget>) => change((d) => ({ ...d, widgets: update(d.widgets, id, patch) })), [change]),
    /** One grid's new arrangement, carried to the other grid so the two keep the same order. */
    setCells: useCallback((bp: Bp, cells: Cell[]) => change((d) => arrange(d, bp, cells)), [change]),
    setPhone: useCallback((order: string[]) => change((d) => ({ ...d, phone: order })), [change]),
    hide: useCallback((id: string) => show(id, true), [show]),
    /** Shows a hidden widget again in the first gap it fits, with the settings it had. */
    add: useCallback((id: string) => show(id, false), [show]),
    /** Back to how it started for this one widget, keeping its place. */
    /** Back to the defaults, and forgets the saved copy so Home follows the defaults again. */
    reset: useCallback(() => {
      forget(key);
      commit({ key, dash: defaultDashboard(), dirty: false }, cur.current.dash);
    }, [key, commit]),
    /** Steps back one change, and saves where that lands. False when there's nothing to undo. */
    undo: useCallback(() => {
      const prev = past.current.at(-1);
      if (!prev) return false;
      past.current = past.current.slice(0, -1);
      commit({ key: cur.current.key, dash: prev, dirty: true });
      return true;
    }, [commit]),
  };
}
