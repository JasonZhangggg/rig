import { useCallback, useEffect, useState } from "react";
import { defaultDashboard, defaultWidget, moveTo, parseDashboard, serialize, update, type Dashboard, type Widget } from "./layout";

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };
const forget = (key: string) => { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } };

export const dashboardKey = (owner: string | null | undefined) => (owner ? `rig.dashboard.v1:${owner}` : "rig.dashboard.v1");

/** The dashboard saved under `key` on this device, and the changes the page makes to it. */
export function useDashboard(key: string) {
  const [state, setState] = useState(() => ({ key, dash: parseDashboard(read(key)), dirty: false }));
  if (state.key !== key) setState({ key, dash: parseDashboard(read(key)), dirty: false });
  const dash = state.key === key ? state.dash : parseDashboard(read(key));

  // Saved only once the person changes something, so a dashboard nobody touched keeps following the defaults.
  useEffect(() => { if (state.dirty) write(state.key, serialize(state.dash)); }, [state]);

  const change = useCallback((fn: (d: Dashboard) => Dashboard) => setState((s) => ({ key: s.key, dash: fn(s.dash), dirty: true })), []);

  return {
    dash,
    change,
    setWidget: useCallback((id: string, patch: Partial<Widget>) => change((d) => ({ ...d, widgets: update(d.widgets, id, patch) })), [change]),
    move: useCallback((id: string, to: number, patch?: Partial<Widget>) => change((d) => ({ ...d, widgets: update(moveTo(d.widgets, id, to), id, patch ?? {}) })), [change]),
    /** Shows a hidden widget again at the end, with the settings it had. */
    add: useCallback((id: string) => change((d) => {
      const me = d.widgets.find((w) => w.id === id);
      return me ? { ...d, widgets: [...d.widgets.filter((w) => w.id !== id), { ...me, hidden: false }] } : d;
    }), [change]),
    /** Back to how it started for this one widget, keeping its place. */
    resetWidget: useCallback((id: string) => change((d) => ({ ...d, widgets: d.widgets.map((w) => (w.id === id ? { ...defaultWidget(w.kind), hidden: false } : w)) })), [change]),
    /** Back to the defaults, and forgets the saved copy so Home follows the defaults again. */
    reset: useCallback(() => { forget(key); setState({ key, dash: defaultDashboard(), dirty: false }); }, [key]),
  };
}
