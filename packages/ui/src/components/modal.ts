import { useLayoutEffect, type KeyboardEvent, type RefObject } from "react";

/**
 * While a dialog is open, everything outside it is inert, so Tab and a screen reader stay inside it,
 * and focus goes back to where it was when it closes.
 */
export function useModal(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!open || !box) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const made: HTMLElement[] = [];
    for (let el: HTMLElement | null = box; el && el !== document.body; el = el.parentElement) {
      for (const s of Array.from(el.parentElement?.children ?? [])) {
        if (s !== el && s instanceof HTMLElement && !s.inert && s.tagName !== "SCRIPT") { s.inert = true; made.push(s); }
      }
    }
    return () => {
      made.forEach((s) => { s.inert = false; });
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [ref, open]);
}

/**
 * Arrow keys for a menu or a tab list: move focus to the next or previous item with the given role,
 * Home and End to the ends. Tabs follow focus.
 */
export function arrowKeys(role: "menuitem" | "tab") {
  const [next, prev] = role === "tab" ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
  return (e: KeyboardEvent<HTMLElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`));
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === next ? (at + 1) % items.length : e.key === prev ? (at - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0 || !items.length) return;
    e.preventDefault();
    items[to].focus();
    if (role === "tab") items[to].click();
  };
}

/** Focuses a menu's first item when it opens. */
export const focusFirstItem = (el: HTMLElement | null) => { el?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); };
