// Rig's right-click menu in place of WebView2's browser menu.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { installContextMenu } from "../src/contextmenu";

beforeAll(() => installContextMenu());
beforeEach(() => {
  invoke.mockReset();
  document.execCommand = vi.fn(() => true);
});
afterEach(() => {
  document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

function rightClick(el: Element) {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 30 });
  el.dispatchEvent(e);
  return e;
}
const menu = () => document.querySelector(".rig-menu");
const entries = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".rig-menu button")].map((b) => `${b.querySelector("span")!.textContent}${b.disabled ? " (off)" : ""}`);
const press = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".rig-menu button")].find((b) => b.querySelector("span")!.textContent === label)!.click();

describe("right-click menu", () => {
  it("shows nothing on the page itself, and never the browser's menu", () => {
    const p = document.createElement("p");
    p.textContent = "CPU 54 °C";
    document.body.append(p);
    const e = rightClick(p);
    expect(e.defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
  });

  it("offers Copy for selected text", () => {
    const p = document.createElement("p");
    p.textContent = "CPU 54 °C";
    document.body.append(p);
    window.getSelection()!.selectAllChildren(p);
    rightClick(p);
    expect(entries()).toEqual(["Copy"]);
    press("Copy");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(menu()).toBeNull();
  });

  it("offers cut, copy, paste and select all in a text field", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.append(input);
    rightClick(input);
    expect(entries()).toEqual(["Cut (off)", "Copy (off)", "Paste", "Select all"]);
    input.focus();
    input.setSelectionRange(0, 5);
    rightClick(input);
    expect(entries()).toEqual(["Cut", "Copy", "Paste", "Select all"]);
  });

  it("pastes the clipboard's text into the field", async () => {
    invoke.mockResolvedValue("from the clipboard");
    const input = document.createElement("textarea");
    document.body.append(input);
    rightClick(input);
    press("Paste");
    await vi.waitFor(() => expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "from the clipboard"));
    expect(invoke).toHaveBeenCalledWith("clipboard_text");
  });

  it("never copies a password out, but lets one be pasted in", () => {
    const input = document.createElement("input");
    input.type = "password";
    input.value = "secret";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, 6);
    rightClick(input);
    expect(entries()).toEqual(["Cut (off)", "Copy (off)", "Paste", "Select all"]);
  });

  it("can't cut or paste into a field that's read-only", () => {
    const input = document.createElement("input");
    input.readOnly = true;
    input.value = "0.1.6";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, 5);
    rightClick(input);
    expect(entries()).toEqual(["Cut (off)", "Copy", "Paste (off)", "Select all"]);
  });

  it("closes with Escape and when clicking elsewhere", () => {
    const input = document.createElement("input");
    document.body.append(input);
    rightClick(input);
    menu()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu()).toBeNull();
    rightClick(input);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu()).toBeNull();
  });
});
