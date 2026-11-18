let pending: string | null = null;
/** Asks the Settings page to open and scroll to a section once it opens (from search). */
export const focusSection = (id: string) => { pending = id; };
/** The section Settings was asked to open, read while it first renders. */
export const peekFocusSection = () => pending;
export const takeFocusSection = () => { const id = pending; pending = null; return id; };
