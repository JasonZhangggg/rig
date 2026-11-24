// Screen steps: setting one control in an app's window. The helper walks to
// the control and reads it (a look), keeps the walk itself, and answers with
// an id. A change names only that id and the new value. What an app may be,
// and when a look's text counts as Rig's own, is in rules/commands.json under
// `screen`; the helper holds the same rules to the window it finds.

import rulesJson from "./rules/commands.json";

interface ScreenRules {
  roots: string[];
  apps: { name: string; aumid: string; image: string }[];
  settings: { name: string; image: string; pages: string[] };
  refuse: { says: string; images: string[] }[];
  refuseStarts: { says: string; starts: string[] };
  neverNames: string[];
  words: Record<string, string>;
  examples: { app: string; refused: boolean }[];
}

const S = (rulesJson as unknown as { screen: ScreenRules }).screen;
export const screenWords = (which: string) => `${S.words[which]}.`;
export const screenExamples = S.examples;

const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The apps Ask may name for a look: Rig's own names, then each Settings page on the list. A program's path is the helper's to resolve, never the model's. */
export const SCREEN_APPS = [...S.apps.map((a) => a.name), ...S.settings.pages.map((p) => `ms-settings:${p}`)];

/** The app as Rig writes it, when it is one Ask may name. */
export const screenApp = (app: unknown): string | null => (typeof app === "string" ? SCREEN_APPS.find((a) => fold(a) === fold(app.trim())) ?? null : null);

/** A control name or value Rig never walks through, sets or presses. */
export const screenNeverName = (text: string) => S.neverNames.some((n) => fold(text).includes(n));

const settingsSays = () => `${S.refuse.find((r) => r.images.includes(S.settings.image))!.says}.`;

/** Why Rig won't look at this app, in plain words, or null. The helper checks the window's own program again. */
export function screenAppRefusal(app: unknown): string | null {
  if (typeof app !== "string" || !/^[\x20-\x7e]{1,260}$/.test(app)) return screenWords("app");
  const name = fold(app);
  if (S.apps.some((a) => fold(a.name) === name)) return null;
  if (name.startsWith("ms-settings:")) return S.settings.pages.includes(name.slice("ms-settings:".length)) ? null : settingsSays();
  if (!S.roots.some((r) => name.startsWith(r)) || !name.endsWith(".exe") || /(^|\\)\.\.(\\|$)/.test(name) || /[a-z0-9]~\d/.test(name) || /[/*?"<>|]/.test(name) || name.includes("\\\\")) return screenWords("app");
  const image = name.slice(name.lastIndexOf("\\") + 1);
  const refused = S.refuse.find((r) => r.images.includes(image));
  if (refused) return `${refused.says}.`;
  return S.refuseStarts.starts.some((s) => image.startsWith(s)) ? `${S.refuseStarts.says}.` : null;
}

/** What a look found. The names and values are the app's own words: one line each, plain, at most 80 characters. */
export interface ScreenLook {
  lookId: string;
  /** Rig's own name for the app, then the name of each control on the way, the last being the one it read. */
  path: string[];
  value: string;
  /** The values the control offers, when it offers a list. */
  options?: string[];
  /** The lowest and highest number it takes, when it takes a number. */
  range?: { min: number; max: number };
  /** False when the text may be someone else's: it counts as outside content, and no change can come of this look. */
  clean: boolean;
  /** ISO time after which the look can't be used for a change. */
  expiresAt: string;
}

/** `shows`: the names Rig did see where it stopped, to look again with. */
export type ScreenLookReply = ScreenLook | { refused: string; shows?: string[]; clean: boolean };

export const NUMBER = /^-?\d{1,9}(\.\d{1,6})?$/;

const LINE = /^[\x20-\x7e]{1,80}$/;
const WORDS = /^[\x20-\x7e]{0,80}$/;
const LOOK_ID = /^[0-9a-f]{32}$/;
const str = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);
const strings = (v: unknown, re: RegExp, most: number): string[] | null =>
  Array.isArray(v) && v.length <= most && v.every((x) => str(x, re) !== null) ? (v as string[]) : null;

/** The helper's answer to `screen.look`, or null when it isn't one: only the fields a look has, each held to the helper's own limits. */
export function screenLookReply(raw: unknown): ScreenLookReply | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clean = r.clean === true;
  if (r.refused !== undefined) {
    const refused = typeof r.refused === "string" && r.refused.trim() ? r.refused.replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 300) : null;
    const shows = r.shows === undefined ? [] : strings(r.shows, LINE, 40);
    return refused && shows ? { refused, ...(shows.length ? { shows } : {}), clean } : null;
  }
  const lookId = str(r.lookId, LOOK_ID);
  const path = strings(r.path, LINE, 9);
  const value = str(r.value, WORDS);
  const expiresAt = typeof r.expiresAt === "string" && Number.isFinite(Date.parse(r.expiresAt)) ? new Date(r.expiresAt).toISOString() : null;
  if (!lookId || !path || path.length < 2 || value === null || !expiresAt) return null;
  const look = { lookId, path, value, clean, expiresAt };
  if (r.options !== undefined) {
    const options = strings(r.options, WORDS, 100);
    return options && options.length > 0 && r.range === undefined ? { ...look, options } : null;
  }
  const range = r.range as Record<string, unknown> | undefined;
  const min = range?.min, max = range?.max;
  return typeof min === "number" && typeof max === "number" && Number.isFinite(min) && Number.isFinite(max) && min <= max ? { ...look, range: { min, max } } : null;
}

/** Whether the helper found the control, rather than stopping on the way. */
export const isLook = (r: ScreenLookReply): r is ScreenLook => "lookId" in r;

/** The app's name on a look, and the controls on the way as plain steps: "Display › Change resolution › Resolution". */
export const lookApp = (look: ScreenLook) => look.path[0];
export const lookSteps = (look: ScreenLook) => look.path.slice(1).join(" › ");
export const lookControl = (look: ScreenLook) => look.path[look.path.length - 1];

/** What a look found, line by line. Every name and value in it is the app's own words. */
export function lookText(r: ScreenLookReply): string {
  if (!isLook(r)) return [`Rig stopped: ${r.refused}`, ...(r.shows?.length ? [`It saw: ${r.shows.join(" | ")}`] : [])].join("\n");
  return [
    `App: ${lookApp(r)}`, `Path: ${lookSteps(r)}`, `Now: ${r.value || "(empty)"}`,
    r.options ? `Takes one of: ${r.options.join(" | ")}` : `Takes a number from ${r.range!.min} to ${r.range!.max}`,
    `lookId: ${r.lookId}`,
  ].join("\n");
}

/** Whether the looked-at control takes this value. */
export function lookTakes(look: ScreenLook, to: string): boolean {
  if (look.options) return look.options.includes(to);
  return !!look.range && NUMBER.test(to) && Number(to) >= look.range.min && Number(to) <= look.range.max;
}
