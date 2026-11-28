/**
 * Calls `look` every `ms` while the page is in view. While the tab is in the background or Rig's window is minimised,
 * nobody sees the answer, so the calls wait, and one is made as soon as the page is shown again. Returns the stop.
 */
export function whileShown(look: () => void, ms: number): () => void {
  const doc = typeof document === "undefined" ? undefined : document;
  const hidden = () => doc?.visibilityState === "hidden";
  let missed = false;
  const timer = setInterval(() => { if (hidden()) missed = true; else look(); }, ms);
  const shown = () => { if (!hidden() && missed) { missed = false; look(); } };
  doc?.addEventListener("visibilitychange", shown);
  return () => { clearInterval(timer); doc?.removeEventListener("visibilitychange", shown); };
}
