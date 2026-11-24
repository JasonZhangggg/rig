// Changing values in a program's or game's own settings file: the fileEdit
// native op. The helper's worker finds each value's text in the file, as the
// person, and replaces only that text, so the rest of the file stays byte for
// byte as it was. The file itself is the op's touch, so Rig snapshots it
// first and undo puts the copy back. FileEdit.cs in the helper makes the same
// checks.

import { fileEditFormats, fileEditPathRule, fileEditRefuses, localFile, placeOf, programFile } from "./check";
import type { NativeRule, Tier, Touch } from "./change";
import type { DiffRow } from "./model";

/** A JSON string, whole number, true, false or null. A number with a fraction is `{ number: "0.85" }`, since a step holds only whole numbers. */
export type FileValue = string | number | boolean | null | { number: string };

export interface FileEdit {
  /** Where the value is. JSON: object keys and array indexes ("0"), outermost first. INI: [section, key]; section "" is the part before the first section. */
  at: string[];
  value: FileValue;
  /** The key may not be in the file yet, and Rig adds it. Without this, the key must already be there. */
  add?: true;
}

export interface FileEditOp {
  name: "fileEdit";
  /** Claude's one sentence, shown labelled as Claude's. */
  does: string;
  path: string;
  /** "ini" also reads .cfg files written as key=value lines under [sections]. */
  format: "json" | "ini";
  edits: FileEdit[];
}

export const FILE_EDIT = { edits: 20, depth: 16, segment: 200, value: 1000, does: 300 };

const JSON_NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
/** Folds ASCII letters only, as the helper does, so the two agree on which keys are the same. */
const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

const HIDDEN = "A key or value can't hold hidden characters that change how its text reads on the card.";

/** The value as Rig keeps it, or what is wrong with it. */
function canonicalValue(v: unknown, format: FileEditOp["format"]): { value: FileValue } | string {
  const ini = format === "ini";
  if (typeof v === "string") {
    if (v.length > FILE_EDIT.value) return `A value can be at most ${FILE_EDIT.value} characters.`;
    if (fileEditRefuses(v, "hidden")) return HIDDEN;
    return ini && fileEditRefuses(v, "iniValue") ? "A value in an INI file is one line of plain text, with no line breaks or control characters." : { value: v };
  }
  if (typeof v === "number") {
    if (Number.isSafeInteger(v)) return { value: v };
    return Number.isFinite(v) ? { value: { number: String(v) } } : "A number must be an ordinary number.";
  }
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { number?: unknown }).number === "string") {
    const n = (v as { number: string }).number;
    return n.length <= 40 && JSON_NUMBER.test(n) ? { value: { number: n } } : "{ number } must hold a number written as JSON writes it, such as 0.85.";
  }
  if (v === null || typeof v === "boolean") return ini ? "A value in an INI file is text or a number: write it the way the file does, such as 1 or True." : { value: v };
  return "A value is text, a number, true, false or null.";
}

function canonicalEdit(raw: unknown, format: FileEditOp["format"]): FileEdit | string {
  const e = (raw ?? {}) as Record<string, unknown>;
  const at = e.at;
  if (!Array.isArray(at) || at.length === 0 || at.length > FILE_EDIT.depth || !at.every((s) => typeof s === "string" && s.length <= FILE_EDIT.segment && !fileEditRefuses(s, "at"))) {
    return `Each edit's at is a list of 1 to ${FILE_EDIT.depth} keys, each one line of text.`;
  }
  if ((at as string[]).some((s) => fileEditRefuses(s, "hidden"))) return HIDDEN;
  if (format === "ini") {
    const [section, key] = at as string[];
    if (at.length !== 2 || section.includes("]")) return 'In an INI file, at is [section, key], with "" for keys above the first section.';
    if (!key || key.startsWith(" ") || key.endsWith(" ") || key.includes("=") || /^[;#[]/.test(key)) return "An INI key is its name as written before =, with no spaces around it.";
  } else if (at.some((s) => s === "")) return "A JSON key in at can't be empty.";
  if (!("value" in e)) return "Each edit needs the value to set.";
  const value = canonicalValue(e.value, format);
  if (typeof value === "string") return value;
  return { at: [...(at as string[])], value: value.value, ...(e.add === true ? { add: true as const } : {}) };
}

/** The op as Rig keeps and fingerprints it, or what is wrong with it in plain words. */
export function canonicalFileEdit(raw: Record<string, unknown>): FileEditOp | string {
  const { does, path, format, edits } = raw;
  if (typeof does !== "string" || !does.trim() || does.length > FILE_EDIT.does) return "A file edit needs one plain sentence on what it does.";
  if (typeof path !== "string" || !localFile(path) || path.indexOf(":", 2) >= 0) return "A file edit needs the file's full path, such as C:\\Users\\you\\AppData\\Roaming\\Game\\settings.json.";
  if (programFile(path)) return "Rig doesn't edit programs, scripts or shortcuts, only settings files.";
  if (format !== "json" && format !== "ini") return 'A file edit\'s format is "json" or "ini" (use "ini" for .cfg files written as key=value lines).';
  const { formats, ends } = fileEditFormats(path);
  if (formats.length === 0) return `Rig only edits settings files whose names end in ${ends.join(", ")}.`;
  if (!formats.includes(format)) return `A file with this name's ending is edited with format "${formats.join('" or "')}".`;
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > FILE_EDIT.edits) return `A file edit changes 1 to ${FILE_EDIT.edits} values.`;
  const out: FileEdit[] = [];
  const seen = new Set<string>();
  for (const raw of edits) {
    const e = canonicalEdit(raw, format);
    if (typeof e === "string") return e;
    const id = JSON.stringify(format === "ini" ? e.at.map(fold) : e.at);
    if (seen.has(id)) return "A file edit names the same value twice.";
    seen.add(id);
    out.push(e);
  }
  return { name: "fileEdit", does, path, format, edits: out };
}

/** A file in someone's own folders under C:\Users, not the shared ones. */
const ownFile = (path: string) => /^[a-z]:\\users\\(?!(public|default|default user|all users)\\)[^\\]+\\./.test(placeOf(path));

export const fileEditRule: NativeRule<FileEditOp> = {
  canonical: canonicalFileEdit,
  tier: (op): Tier => (fileEditPathRule(op.path, "tier3") ? 3 : ownFile(op.path) && !op.edits.some((e) => e.add) ? 1 : 2),
  reasons: (op) => [
    ...(fileEditPathRule(op.path, "tier3") ? [`${fileEditPathRule(op.path, "tier3")}.`] : []),
    "Rig changes only the text of the values listed and saves a copy of the file first, so undo puts it back.",
    ...(op.edits.some((e) => e.add) ? ["It adds a key the file may not have yet, which the program may not expect."] : []),
    ...(!ownFile(op.path) ? ["The file isn't in your own folders, so the change may reach everyone on this PC. Rig makes it with your own rights."] : []),
  ],
  title: (op) => `Changed ${op.edits.length === 1 ? "a value" : `${op.edits.length} values`} in ${fileName(op.path)}`,
  touches: (op): Touch[] => [{ kind: "file", path: op.path }],
  never: (op) => fileEditPathRule(op.path, "never"),
  rows: (op, before, after) => {
    const now = (text: string | undefined, i: number) => {
      const line = text?.split("\n")[i] ?? "";
      const label = `${atLabel(op.edits[i].at)}: `;
      return line.startsWith(label) ? line.slice(label.length) : undefined;
    };
    return op.edits.map((e, i): DiffRow => [`${fileName(op.path)} › ${atLabel(e.at)}`, now(before, i) ?? "As it is now", now(after, i) ?? valueText(e.value, op.format)]);
  },
};

const fileName = (path: string) => path.split("\\").filter(Boolean).pop() ?? path;
/** How the helper names a value's place on the card. */
export const atLabel = (at: string[]) => at.map((s) => (s === "" ? "(top)" : s)).join(" › ");
/** A value as the edit writes it: JSON text for JSON, the bare text for INI. */
const valueText = (v: FileValue, format: FileEditOp["format"]) => (v !== null && typeof v === "object" ? v.number : typeof v === "string" && format === "json" ? JSON.stringify(v) : String(v));
