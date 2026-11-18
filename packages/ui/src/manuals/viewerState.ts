// Which manual page is open in the viewer. Anything in the app can open it.

import { useSyncExternalStore } from "react";
import { parseManualLink } from "@rig/core";

export interface ViewerState { manualId: string | null; page: number; nonce: number }

let state: ViewerState = { manualId: null, page: 1, nonce: 0 };
const listeners = new Set<() => void>();
const set = (next: Partial<ViewerState>) => { state = { ...state, ...next }; listeners.forEach((f) => f()); };

/** Opens a manual in the viewer, at a page when given. */
export function openManual(manualId: string, page?: number) {
  set({ manualId, page: page && page > 0 ? page : 1, nonce: state.nonce + 1 });
}

/** Opens the manual page a chat source or link points to. False when the link isn't one. */
export function openManualLink(url: string | undefined): boolean {
  const l = parseManualLink(url);
  if (!l) return false;
  openManual(l.manualId, l.page);
  return true;
}

export function closeManual() { set({ manualId: null }); }
export function setViewerPage(page: number) { set({ page }); }

export function useViewer(): ViewerState {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => state, () => state);
}
