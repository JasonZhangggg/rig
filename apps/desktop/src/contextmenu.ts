// Rig's own right-click menu. Without it, WebView2 shows the browser's menu
// (Back, Refresh, Save as, Print), which does nothing useful in an app and
// looks like a web page. Text fields get Cut, Copy, Paste and Select all;
// selected text gets Copy; anywhere else, right-click does nothing, like most
// Windows apps. The menu uses Rig's tokens (contextmenu.css).

import { invoke } from "@tauri-apps/api/core";
import "./contextmenu.css";

type Item = { label: string; keys: string; run: () => void | Promise<void>; off?: boolean };
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "number", "password", ""]);

function fieldAt(t: EventTarget | null): Field | null {
  if (!(t instanceof Element)) return null;
  const el = t.closest("input, textarea, [contenteditable]:not([contenteditable='false'])");
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type) ? el : null;
  return el instanceof HTMLElement ? el : null;
}

const isInput = (f: Field): f is HTMLInputElement | HTMLTextAreaElement => f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement;
const readOnly = (f: Field) => (isInput(f) ? f.readOnly || f.disabled : false);
function hasSelection(f: Field | null) {
  if (f && isInput(f)) {
    try { return (f.selectionStart ?? 0) !== (f.selectionEnd ?? 0); } catch { return false; } // number inputs have no selection
  }
  return String(window.getSelection() ?? "").length > 0;
}

let open: { el: HTMLElement; back: Element | null } | null = null;

function close(refocus = true) {
  if (!open) return;
  const { el, back } = open;
  open = null;
  el.remove();
  if (refocus && back instanceof HTMLElement) back.focus({ preventScroll: true });
}

function items(f: Field | null): Item[] {
  const exec = (cmd: string) => () => { document.execCommand(cmd); };
  const sel = hasSelection(f);
  if (!f) return sel ? [{ label: "Copy", keys: "Ctrl+C", run: exec("copy") }] : [];
  const ro = readOnly(f);
  // Passwords can be pasted into but never copied out.
  const secret = f instanceof HTMLInputElement && f.type === "password";
  return [
    { label: "Cut", keys: "Ctrl+X", run: exec("cut"), off: !sel || ro || secret },
    { label: "Copy", keys: "Ctrl+C", run: exec("copy"), off: !sel || secret },
    {
      label: "Paste", keys: "Ctrl+V", off: ro,
      // The page can't read the clipboard itself, so the app hands it the text.
      run: async () => {
        const text = await invoke<string | null>("clipboard_text").catch(() => null);
        if (text) { f.focus(); document.execCommand("insertText", false, text); }
      },
    },
    { label: "Select all", keys: "Ctrl+A", run: () => { f.focus(); if (isInput(f)) f.select(); else document.execCommand("selectAll"); } },
  ];
}

function show(list: Item[], x: number, y: number, byKeyboard: boolean) {
  close(false);
  const el = document.createElement("div");
  el.className = "rig-menu";
  el.setAttribute("role", "menu");
  for (const it of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.disabled = !!it.off;
    b.innerHTML = `<span></span><kbd></kbd>`;
    b.firstElementChild!.textContent = it.label;
    b.lastElementChild!.textContent = it.keys;
    b.addEventListener("click", () => { close(); void it.run(); });
    el.append(b);
  }
  // Keep the text field's focus and selection while the menu is used.
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("keydown", (e) => {
    const buttons = [...el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = buttons.length, down = e.key === "ArrowDown";
      buttons[i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : n - 1)) % n]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    }
  });
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
  open = { el, back: document.activeElement };
  if (byKeyboard) el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

export function installContextMenu() {
  addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const f = fieldAt(e.target);
    const list = items(f);
    if (!list.length) { close(false); return; }
    // The menu key and Shift+F10 open it at the field, not at the pointer.
    const byKeyboard = e.button !== 2;
    const at = byKeyboard && e.target instanceof Element ? e.target.getBoundingClientRect() : null;
    show(list, at ? at.left + 12 : e.clientX, at ? at.bottom + 4 : e.clientY, byKeyboard);
  });
  addEventListener("mousedown", (e) => { if (open && !open.el.contains(e.target as Node)) close(false); }, true);
  addEventListener("blur", () => close(false));
  addEventListener("resize", () => close(false));
  addEventListener("scroll", () => close(false), true);
}
