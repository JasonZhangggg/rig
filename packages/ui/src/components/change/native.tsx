import type { ReactNode } from "react";
import { atLabel, canonicalNative, GPU_SETTINGS, gpuValueSays, lookApp, lookControl, lookSteps, nativeRows, protectionOf, revertWords, type FileEditOp, type GpuOp, type GpuSetting, type KeepOffOp, type NativeOp, type ProtectionOp, type RunResult, type ScreenLook, type ScreenOp, type SelftestOp } from "@rig/core";
import { Claim, Printed } from "./parts";
import { clip, type RedKind } from "./words";

/** One value a native op changes: where, as it is (or was), and as it will be (or came out). */
export interface NativeChange { place: string; before: string; after: string }

/**
 * What differs between kinds of native op on a card. Everything else (tier, approval, undo) is the same card. `look` is
 * what the helper found in an app's window, for a screen step whose proposal carries it.
 */
interface NativePart<O extends NativeOp> {
  /** The card's heading, like a command card's: "Changes Vertical sync for game.exe". */
  title(op: O, look?: ScreenLook): string;
  /** What it changes and where, above the values. `note` says whose words the value is. */
  where(op: O, look?: ScreenLook): { label: string; value: string; full?: string; note?: string }[];
  /** Each value, from the helper's read before and, once it ran, after. */
  changes(op: O, before?: string, after?: string, look?: ScreenLook): NativeChange[];
  /** What else the person should see from the helper's read. */
  more?(op: O, read: string | undefined, pcName: string, look?: ScreenLook): ReactNode;
  /** What a tier 3 card leads with, when it isn't that the change lowers a protection. */
  red?: { kind: RedKind; undo: string };
  /** Rig's own sentence on it, for an op Claude writes no sentence for. */
  says?(op: O): string;
  /** The Undo button's words, when undoing it has a plainer name. */
  undoWord?: string;
  /** What the result says once it ran, in place of the values before and after. */
  done?(op: O, result: RunResult, look?: ScreenLook): ReactNode;
}

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
  where: (_op, look) => (look ? [{ label: "App", value: lookApp(look) }, { label: "Path", value: lookSteps(look), note: appWords }] : []),
  changes: (op, before, after, look) => {
    const [name, was, to] = (nativeRows(op, before, after) ?? [])[0] ?? [];
    return [{ place: look ? lookControl(look) : name ?? "Setting", before: before === undefined ? look?.value || "As it is now" : was ?? before, after: to ?? op.to }];
  },
  more: (_op, _read, _pcName, look) => (
    <p className="cc-note">Rig will click through {look ? `${lookApp(look)}'s` : "the app's"} window to set it, the way you would. A Stop bar shows at the top of the screen while it does; press Stop to end it at once.</p>
  ),
  red: { kind: "unsure", undo: "Not for sure. Undo walks the same path in the app and sets the old value again, which can miss if the app changed." },
  done: (op, result, look) => {
    const control = look ? lookControl(look) : "the setting";
    if (result.stopped) {
      return (
        <>
          <div className="cc-first" role="status"><b>Rig stopped part way.</b></div>
          <p className="cc-note">{clip(result.after, 240)}</p>
          <p className="cc-note">Undo walks the same path and sets {look?.value ? `${control} back to ${look.value}` : `${control} back`}.</p>
        </>
      );
    }
    return <p className="cc-note" role="status">Rig set {control} to {op.to} in {inApp(look)} and read it back.</p>;
  },
};

const rowsOf = (op: ProtectionOp | KeepOffOp, before?: string, after?: string): NativeChange[] =>
  (nativeRows(op, before, after) ?? []).map(([place, was, to]) => ({ place, before: was, after: to }));

/** The word on the button that undoes turning a protection off. */
export const BACK_ON = "Turn it back on now";

const protection: NativePart<ProtectionOp> = {
  title: (op) => `Turns off ${protectionOf(op.id)?.name} for ${revertWords(op.revertAfter)}`,
  where: () => [],
  changes: rowsOf,
  says: (op) => protectionOf(op.id)?.says ?? "",
  more: (op) => (
    <p className="cc-note">Rig turns it back on by itself after {revertWords(op.revertAfter)}, even if the PC restarts in between. You can turn it back on sooner, and only you can choose to keep it off, in Changes.</p>
  ),
  red: { kind: "lowers", undo: "Yes. Rig turns it back on by itself when the time is up, and you can turn it back on sooner." },
  undoWord: BACK_ON,
  done: (op) => <p className="cc-note" role="status">Rig turns it back on by itself {revertWords(op.revertAfter)} after it was turned off. Changes shows the time left.</p>,
};

const keepOff: NativePart<KeepOffOp> = {
  title: (op) => `Keeps ${protectionOf(op.id)?.name} off`,
  where: () => [],
  changes: rowsOf,
  says: () => "Rig stops its timer, so this stays off until you turn it back on yourself, in Changes or in Windows Security.",
  red: { kind: "lowers", undo: "Yes. Undo starts Rig's timer again, 15 minutes long. Until it's back on, the PC is less protected." },
};

/** One entry per kind of native op. A new op is one more entry here. */
export const nativeParts: { [N in NativeOp["name"]]: NativePart<Extract<NativeOp, { name: N }>> } = { selftest, gpu, fileEdit, screen, protection, keepOff };

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
      {part.where(op, look).map((w) => (
        <p key={w.label} className="cc-where-line">
          <span className="cc-tag">{w.label}</span> <b>{w.value}</b>{w.note && <span className="faint"> · {w.note}</span>}
          {w.full && w.full !== w.value && <Claim className="cc-where" text={w.full} max={96} />}
        </p>
      ))}
      <ChangeList changes={part.changes(op, read, undefined, look)} />
    </>
  );
}
