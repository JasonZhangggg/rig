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
  words: Record<string, string>;
  examples: { app: string; refused: boolean }[];
}

const S = (rulesJson as unknown as { screen: ScreenRules }).screen;
export const screenWords = (which: string) => `${S.words[which]}.`;
export const screenExamples = S.examples;

const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
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

/** Whether the looked-at control takes this value. */
export function lookTakes(look: ScreenLook, to: string): boolean {
  if (look.options) return look.options.includes(to);
  return !!look.range && NUMBER.test(to) && Number(to) >= look.range.min && Number(to) <= look.range.max;
}
