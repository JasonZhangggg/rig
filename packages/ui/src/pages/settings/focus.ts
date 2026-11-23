let pending: string | null = null;
const open = new Set<(id: string) => void>();
/**
 * Asks Settings to open and scroll to a section (from search). When Settings is already on screen it jumps right
 * away; otherwise the section waits until Settings next opens.
 */
export const focusSection = (id: string) => {
  if (open.size) { pending = null; open.forEach((f) => f(id)); } else pending = id;
};
/** The section Settings was asked to open, read while it first renders. */
export const peekFocusSection = () => pending;
export const takeFocusSection = () => { const id = pending; pending = null; return id; };
/** Settings, while it's on screen, hears each section asked for. Returns the way to stop. */
export const onFocusSection = (f: (id: string) => void) => { open.add(f); return () => { open.delete(f); }; };
