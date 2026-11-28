import type { ReactNode } from "react";
import { atLabel, canonicalNative, FIRMWARE_MAKER_NAMES, FIRMWARE_MAKERS, firmwareRows, firmwareSealed, firmwareSetting, GPU_SETTINGS, gpuValueSays, lookApp, lookControl, lookSteps, nativeRows, protectionRow, RESTART_WORDS, revertWords, type FileEditOp, type FirmwareOp, type GpuOp, type GpuSetting, type NativeOp, type ProtectionKeepOp, type ProtectionOp, type RestartFirmwareOp, type RunResult, type ScreenLook, type ScreenOp, type SelftestOp } from "@rig/core";
import { Claim, Printed } from "./parts";
import { Countdown } from "./Revert";
import { clip, type RedKind } from "./words";

/** One value a native op changes: where, as it is (or was), and as it will be (or came out). */
export interface NativeChange { place: string; before: string; after: string }

/**
 * What differs between kinds of native op on a card. Everything else (tier, approval, undo) is the same card. `look` is
 * what the helper found in an app's window, for a screen step whose proposal carries it.
 */
interface NativePart<O extends NativeOp> {
  /** Rig's own sentence on what it does, made from the op, for a kind whose op carries no sentence of Claude's, or one Rig offers itself. */
  does?(op: O): string | undefined;
  /** The card's heading, like a command card's: "Changes Vertical sync for game.exe". */
  title(op: O, look?: ScreenLook): string;
  /** What it changes and where, above the values, from the op and the helper's read. `note` says whose words the value is. */
  where(op: O, read?: string, look?: ScreenLook): { label: string; value: string; full?: string; note?: string }[];
  /** Each value, from the helper's read before and, once it ran, after. */
  changes(op: O, before?: string, after?: string, look?: ScreenLook): NativeChange[];
  /** What else the person should see from the helper's read. */
  more?(op: O, read: string | undefined, pcName: string, look?: ScreenLook, word?: string): ReactNode;
  /** A tier 3 card's words, when it isn't the usual "lowers a protection" with Undo. */
  red?(op: O, word?: string): NativeRed;
  /** What the person ticks to say they're ready, from the helper's read, or null when nothing needs ticking. */
  confirm?(op: O, read: string | undefined): string | null;
  /** What the result says once it ran, in place of the values before and after; `undone` once Undo put it back. */
  done?(op: O, result: RunResult, look?: ScreenLook, undone?: boolean): ReactNode;
  /** What Undo does once it ran, when it isn't putting back exactly what Rig read before. Says the same as `red.undo`. */
  back?(op: O, look?: ScreenLook): string;
  /** The Undo button's own words, or "none" when the step has nothing to undo. */
  button?: string | "none";
}

/**
 * A tier 3 card's lead and its answer to "Can it be undone". `kind` picks Rig's usual words; `words` replaces them, and a
 * part with its own words also says what Undo can reach once the change ran.
 */
export interface NativeRed { kind: RedKind; undo: string; noUndo: boolean; words?: { head: string; chip: string; word: string } }

const fileName = (path: string) => path.split("\\").filter(Boolean).pop() ?? path;

/** The setting's value in the helper's one line, "Vertical sync for game.exe: Off (the driver's default)", or null. */
function gpuNow(s: GpuSetting, line: string | undefined, value: string): string | null {
  if (!line?.trim()) return null;
  const says = [...Object.values(s.values).map((v) => v.says), ...(gpuValueSays(s, value) ? [gpuValueSays(s, value)!] : [])];
  const known = says.find((x) => line.includes(`: ${x} (`) || line.endsWith(`: ${x}`));
  if (known) return known;
  const m = /: ([^:]+?)(?: \([^()]*\))?$/.exec(line.trim());
  return m ? m[1] : line.trim();
}

const gpu: NativePart<GpuOp> = {
  title: (op) => `Changes ${GPU_SETTINGS[op.setting].name} for ${op.app ?? "all programs"}`,
  where: (op) => [{ label: "Setting", value: GPU_SETTINGS[op.setting].name }, { label: "Program", value: op.app ?? "All programs" }],
  changes: (op, before, after) => {
    const s = GPU_SETTINGS[op.setting];
    return [{ place: s.name, before: gpuNow(s, before, op.value) ?? "As it is now", after: gpuNow(s, after, op.value) ?? gpuValueSays(s, op.value) ?? op.value }];
  },
  more: (op, read, pcName) => {
    const s = GPU_SETTINGS[op.setting];
    return (
      <>
        <p className="cc-note">{s.says}{s.nextStart && ` It takes effect the next time ${op.app ?? "a program"} starts.`}</p>
        {read && <Printed label={`NVIDIA's settings now (on ${pcName})`} text={read} />}
      </>
    );
  },
};

const fileEdit: NativePart<FileEditOp> = {
  title: (op) => `Changes ${op.edits.length === 1 ? "a value" : `${op.edits.length} values`} in ${fileName(op.path)}`,
  where: (op) => [{ label: "File", value: fileName(op.path), full: op.path }],
  changes: (op, before, after) => (nativeRows(op, before, after) ?? []).map(([, was, to], i) => ({ place: atLabel(op.edits[i].at), before: was, after: to })),
  more: (_op, read, pcName) => {
    const lines = read?.split("\n\n").slice(1).join("\n\n").trim();
    return lines ? <Printed label={`The lines that change (on ${pcName})`} text={lines} /> : null;
  },
};

const selftest: NativePart<SelftestOp> = {
  title: () => "Runs Rig's self-test change",
  where: () => [],
  changes: (op, before, after) => [{ place: "Test value", before: before?.trim() || "As it is now", after: after?.trim() || op.value }],
};

const appWords = "names and values in the app's own words";
const inApp = (look?: ScreenLook) => (look ? lookApp(look) : "the app");

const screen: NativePart<ScreenOp> = {
  title: (_op, look) => `Changes a setting in ${look ? lookApp(look) : "an app's window"}`,
  where: (_op, _read, look) => (look ? [{ label: "App", value: lookApp(look) }, { label: "Path", value: lookSteps(look), note: appWords }] : []),
  changes: (op, before, after, look) => {
    const [name, was, to] = (nativeRows(op, before, after) ?? [])[0] ?? [];
    return [{ place: look ? lookControl(look) : name ?? "Setting", before: before === undefined ? look?.value || "As it is now" : was ?? before, after: to ?? op.to }];
  },
  more: (_op, _read, _pcName, look) => (
    <p className="cc-note">Rig will click through {look ? `${lookApp(look)}'s` : "the app's"} window to set it, the way you would. A Stop bar shows at the top of the screen while it does; press Stop to end it at once.</p>
  ),
  red: () => ({ kind: "unsure", undo: "Not for sure. Undo walks the same path in the app and sets the old value again, which can miss if the app changed.", noUndo: false }),
  done: (op, result, look) => {
    const control = look ? lookControl(look) : "the setting";
    if (result.stopped) {
      return (
        <>
          <div className="cc-first" role="status"><b>Rig stopped part way.</b></div>
          <p className="cc-note">{clip(result.after, 240)}</p>
        </>
      );
    }
    return <p className="cc-note" role="status">Rig set {control} to {op.to} in {inApp(look)} and read it back.</p>;
  },
  back: (_op, look) => {
    const control = look ? lookControl(look) : "the setting";
    return `Rig can't promise this undo. It walks the same path in ${inApp(look)} and sets ${look?.value ? `${control} back to ${look.value}` : `${control} back`}, which can miss if the app changed.`;
  },
};

/** The maker the helper's firmware read names, like "Dell". */
const firmwareMaker = (read: string | undefined) => /^Maker: (.+)$/m.exec(read ?? "")?.[1]?.trim();

export const sealedLine = "Drive encryption (BitLocker) is on. Windows may ask for its recovery key at the next start.";
export const recoveryKey = "I have my BitLocker recovery key.";

const firmware: NativePart<FirmwareOp> = {
  // A setting Rig offers itself (the battery charge limit) has its own sentence in the table, shown in place of Claude's.
  does: (op) => firmwareSetting(op.setting)?.does?.[op.value],
  title: (op) => {
    const s = firmwareSetting(op.setting);
    return s ? `Changes ${s.name} in firmware` : "Changes a firmware setting";
  },
  where: (op, read) => {
    const maker = firmwareMaker(read);
    return [{ label: "Setting", value: firmwareSetting(op.setting)?.name ?? op.setting }, ...(maker ? [{ label: "Maker", value: maker }] : [])];
  },
  changes: (op, before, after) => firmwareRows(op, before, after).map(([place, was, to]) => ({ place, before: was, after: to })),
  more: (op, read, _pcName, _look, word = "PC") => {
    const s = firmwareSetting(op.setting);
    const maker = FIRMWARE_MAKERS.find((m) => FIRMWARE_MAKER_NAMES[m] === firmwareMaker(read));
    const asks = maker && s?.makers[maker]?.asks;
    return (
      <>
        <p className="cc-note">{s?.says} It applies at the next restart. Rig won't restart the {word} for you.</p>
        {asks && <p className="cc-note">{asks}</p>}
        {firmwareSealed(read) && <p className="cc-note cc-no" role="note">{sealedLine}</p>}
      </>
    );
  },
  red: (op) => {
    const s = firmwareSetting(op.setting);
    return s?.undo === false
      ? { kind: "none", words: { head: "This changes a firmware setting, and Rig won't change it back.", chip: "Firmware", word: "firmware" }, undo: `No. Rig won't turn ${s.name} off again. You can in firmware setup.`, noUndo: true }
      : { kind: "lowers", words: { head: "This changes a firmware setting.", chip: "Firmware", word: "firmware" }, undo: "Yes. Undo sets the old value back, and that also applies at the next restart.", noUndo: false };
  },
  confirm: (_op, read) => (firmwareSealed(read) ? recoveryKey : null),
};

const restartToFirmware: NativePart<RestartFirmwareOp> = {
  title: () => "Restarts into firmware setup",
  where: () => [],
  changes: () => [{ place: RESTART_WORDS.row[0], before: RESTART_WORDS.row[1], after: RESTART_WORDS.row[2] }],
  more: (_op, read) => (firmwareSealed(read) ? <p className="cc-note cc-no" role="note">{sealedLine}</p> : null),
  red: (_op, word = "PC") => ({ kind: "lowers", words: { head: `This restarts your ${word} in one minute.`, chip: `Restarts the ${word}`, word: "restart" }, undo: "Cancel stops the restart during that minute.", noUndo: false }),
  confirm: (_op, read) => (firmwareSealed(read) ? recoveryKey : null),
};

const rowName = (id: string) => protectionRow(id)?.name ?? "A protection";
export const TURN_BACK_ON = "Turn it back on now";

const protection: NativePart<ProtectionOp> = {
  does: (op) => `Turns ${rowName(op.id)} off for ${revertWords(op.revertAfter)}, then back on by itself.`,
  title: (op) => `Turns off ${rowName(op.id)} for ${revertWords(op.revertAfter)}`,
  where: (op) => [{ label: "Protection", value: rowName(op.id) }, { label: "Off for", value: revertWords(op.revertAfter) }],
  changes: (op, before, after) => [{ place: rowName(op.id), before: before?.trim() || "On", after: after?.trim() || `Off for ${revertWords(op.revertAfter)}` }],
  more: (op, _read, _pcName, _look, word = "PC") => (
    <>
      <p className="cc-note">{protectionRow(op.id)?.risk}</p>
      <p className="cc-note">Rig turns it back on by itself after {revertWords(op.revertAfter)}, also if the {word} restarts or Rig is closed. You can turn it back on sooner in Changes. Keeping it off is a separate choice only you can make there.</p>
    </>
  ),
  red: (_op, word = "PC") => ({ kind: "lowers", undo: `Yes. Rig turns it back on by itself, and ${TURN_BACK_ON} does it sooner. Until then, the ${word} is less protected.`, noUndo: false }),
  done: (op, result, _look, undone) => (
    <p className="cc-note" role="status">
      {undone ? `${rowName(op.id)} is back on.` : <>{rowName(op.id)} is off. {result.revert ? <Countdown dueAt={result.revert.dueAt} /> : `Rig turns it back on by itself after ${revertWords(op.revertAfter)}.`}</>}
    </p>
  ),
  back: () => "It comes back on by itself. You can also turn it back on sooner.",
  button: TURN_BACK_ON,
};

const protectionKeep: NativePart<ProtectionKeepOp> = {
  does: (op) => `Stops Rig from turning ${rowName(op.id)} back on by itself. It stays off until you turn it back on.`,
  title: (op) => `Keeps ${rowName(op.id)} off`,
  where: (op) => [{ label: "Protection", value: rowName(op.id) }],
  changes: (op, before, after) => [{ place: rowName(op.id), before: before?.trim() || "Off for now", after: after?.trim() || "Off until you turn it back on" }],
  red: () => ({ kind: "lowers", undo: `Yes. ${TURN_BACK_ON} in Changes turns it on again.`, noUndo: false }),
  button: "none",
};

/** One entry per kind of native op. A new op is one more entry here. */
export const nativeParts: { [N in NativeOp["name"]]: NativePart<Extract<NativeOp, { name: N }>> } = { selftest, gpu, fileEdit, screen, firmware, restartToFirmware, protection, protectionKeep };

/** The op's kind, when this copy of Rig knows it. A newer Rig may send kinds this one doesn't. */
export const knownNative = (raw: unknown) => {
  const name = raw && typeof raw === "object" ? (raw as { name?: unknown }).name : undefined;
  return typeof name === "string" && Object.hasOwn(nativeParts, name);
};

/** The op as Rig keeps it, with the part that shows it and, for a screen step, the look it came from; or null when Rig can't use it. */
export function nativeOf(raw: unknown, looks?: ScreenLook[]): { op: NativeOp; part: NativePart<NativeOp>; look?: ScreenLook } | null {
  const op = canonicalNative(raw);
  if (typeof op === "string" || !knownNative(op)) return null;
  const look = op.name === "screen" ? looks?.find((l) => l.lookId === op.lookId) : undefined;
  return { op, part: nativeParts[op.name] as NativePart<NativeOp>, ...(look ? { look } : {}) };
}

/** Whether Rig won't put this native op back, by its part's own words. */
export function nativeNoUndo(raw: unknown): boolean {
  const n = nativeOf(raw);
  return !!n?.part.red?.(n.op).noUndo;
}

/** Rig's own sentence on a native op, when its kind makes one, or null. */
export function nativeOwnDoes(raw: unknown): string | null {
  const n = nativeOf(raw);
  return n?.part.does?.(n.op) ?? null;
}

/** Claude's sentence on a native op, whatever its kind. */
export const nativeDoes = (raw: unknown): string => {
  const does = raw && typeof raw === "object" ? (raw as { does?: unknown }).does : undefined;
  return typeof does === "string" ? does : "";
};

/** Each value as "place: before → after". */
export function ChangeList({ changes, label = "What changes" }: { changes: NativeChange[]; label?: string }) {
  return (
    <ul className="cc-list" aria-label={label}>
      {changes.map((c) => (
        <li key={c.place} className="cc-edit">
          <Claim text={`${c.place}:`} max={64} />
          <span className="cc-values">
            <span className="cc-before" title={clip(c.before, 40) !== c.before ? c.before : undefined}>{clip(c.before, 40)}</span>
            <span className="cc-arrow" aria-hidden="true">→</span><span className="sr-only"> changed to </span>
            <b title={clip(c.after, 40) !== c.after ? c.after : undefined}>{clip(c.after, 40)}</b>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Where a native op changes things, and each value it changes, as the helper read it. */
export function NativeWhat({ op, part, read, look }: { op: NativeOp; part: NativePart<NativeOp>; read?: string; look?: ScreenLook }) {
  return (
    <>
      {part.where(op, read, look).map((w) => (
        <p key={w.label} className="cc-where-line">
          <span className="cc-tag">{w.label}</span> <b>{w.value}</b>{w.note && <span className="faint"> · {w.note}</span>}
          {w.full && w.full !== w.value && <Claim className="cc-where" text={w.full} max={96} />}
        </p>
      ))}
      <ChangeList changes={part.changes(op, read, undefined, look)} />
    </>
  );
}
