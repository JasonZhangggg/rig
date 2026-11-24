import type { ReactNode } from "react";
import { atLabel, canonicalNative, FIRMWARE_MAKER_NAMES, FIRMWARE_MAKERS, firmwareRows, firmwareSealed, firmwareSetting, GPU_SETTINGS, gpuValueSays, nativeRows, RESTART_WORDS, type FileEditOp, type FirmwareOp, type GpuOp, type GpuSetting, type NativeOp, type RestartFirmwareOp, type ScreenOp, type SelftestOp } from "@rig/core";
import { Claim, Printed } from "./parts";
import { clip } from "./words";

/** One value a native op changes: where, as it is (or was), and as it will be (or came out). */
export interface NativeChange { place: string; before: string; after: string }

/** What differs between kinds of native op on a card. Everything else (tier, approval, undo) is the same card. */
interface NativePart<O extends NativeOp> {
  /** The card's heading, like a command card's: "Changes Vertical sync for game.exe". */
  title(op: O): string;
  /** What it changes and where, above the values. */
  where(op: O, read?: string): { label: string; value: string; full?: string }[];
  /** Each value, from the helper's read before and, once it ran, after. */
  changes(op: O, before?: string, after?: string): NativeChange[];
  /** What else the person should see from the helper's read. */
  more?(op: O, read: string | undefined, pcName: string): ReactNode;
  /** A tier 3 card's words, when it isn't the usual "lowers a protection" with Undo. */
  red?(op: O): NativeRed;
  /** What the person ticks to say they're ready, from the helper's read, or null when nothing needs ticking. */
  confirm?(op: O, read: string | undefined): string | null;
}

export interface NativeRed { head: string; chip: string; word: string; undo: string; noUndo: boolean }

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

const screen: NativePart<ScreenOp> = {
  title: () => "Changes a setting in an app's window",
  where: () => [],
  changes: (op, before, after) => [{ place: "Setting", before: before?.trim() || "As it is now", after: after?.trim() || op.to }],
};

/** The maker the helper's firmware read names, like "Dell". */
const firmwareMaker = (read: string | undefined) => /^Maker: (.+)$/m.exec(read ?? "")?.[1]?.trim();

export const sealedLine = "Drive encryption (BitLocker) is on. Windows may ask for its recovery key at the next start.";
export const recoveryKey = "I have my BitLocker recovery key.";

const firmware: NativePart<FirmwareOp> = {
  title: (op) => {
    const s = firmwareSetting(op.setting);
    return s ? `Changes ${s.name} in firmware` : "Changes a firmware setting";
  },
  where: (op, read) => {
    const maker = firmwareMaker(read);
    return [{ label: "Setting", value: firmwareSetting(op.setting)?.name ?? op.setting }, ...(maker ? [{ label: "Maker", value: maker }] : [])];
  },
  changes: (op, before, after) => firmwareRows(op, before, after).map(([place, was, to]) => ({ place, before: was, after: to })),
  more: (op, read) => {
    const s = firmwareSetting(op.setting);
    const maker = FIRMWARE_MAKERS.find((m) => FIRMWARE_MAKER_NAMES[m] === firmwareMaker(read));
    const asks = maker && s?.makers[maker]?.asks;
    return (
      <>
        <p className="cc-note">{s?.says} It applies at the next restart. Rig won't restart the PC for you.</p>
        {asks && <p className="cc-note">{asks}</p>}
        {firmwareSealed(read) && <p className="cc-note cc-no" role="note">{sealedLine}</p>}
      </>
    );
  },
  red: (op) => {
    const s = firmwareSetting(op.setting);
    return s?.undo === false
      ? { head: "This changes a firmware setting, and Rig won't change it back.", chip: "Firmware", word: "firmware", undo: `No. Rig won't turn ${s.name} off again. You can in firmware setup.`, noUndo: true }
      : { head: "This changes a firmware setting.", chip: "Firmware", word: "firmware", undo: "Yes. Undo sets the old value back, and that also applies at the next restart.", noUndo: false };
  },
  confirm: (_op, read) => (firmwareSealed(read) ? recoveryKey : null),
};

const restartToFirmware: NativePart<RestartFirmwareOp> = {
  title: () => "Restarts into firmware setup",
  where: () => [],
  changes: () => [{ place: RESTART_WORDS.row[0], before: RESTART_WORDS.row[1], after: RESTART_WORDS.row[2] }],
  more: (_op, read) => (firmwareSealed(read) ? <p className="cc-note cc-no" role="note">{sealedLine}</p> : null),
  red: () => ({ head: "This restarts your PC in one minute.", chip: "Restarts the PC", word: "restart", undo: "Cancel stops the restart during that minute.", noUndo: false }),
  confirm: (_op, read) => (firmwareSealed(read) ? recoveryKey : null),
};

/** One entry per kind of native op. A new op is one more entry here. */
export const nativeParts: { [N in NativeOp["name"]]: NativePart<Extract<NativeOp, { name: N }>> } = { selftest, gpu, fileEdit, screen, firmware, restartToFirmware };

/** The op's kind, when this copy of Rig knows it. A newer Rig may send kinds this one doesn't. */
export const knownNative = (raw: unknown) => {
  const name = raw && typeof raw === "object" ? (raw as { name?: unknown }).name : undefined;
  return typeof name === "string" && Object.hasOwn(nativeParts, name);
};

/** The op as Rig keeps it, with the part that shows it, or null when Rig can't use it. */
export function nativeOf(raw: unknown): { op: NativeOp; part: NativePart<NativeOp> } | null {
  const op = canonicalNative(raw);
  if (typeof op === "string" || !knownNative(op)) return null;
  return { op, part: nativeParts[op.name] as NativePart<NativeOp> };
}

/** Whether Rig won't put this native op back, by its part's own words. */
export function nativeNoUndo(raw: unknown): boolean {
  const n = nativeOf(raw);
  return !!n?.part.red?.(n.op).noUndo;
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
export function NativeWhat({ op, part, read }: { op: NativeOp; part: NativePart<NativeOp>; read?: string }) {
  return (
    <>
      {part.where(op, read).map((w) => (
        <p key={w.label} className="cc-where-line"><span className="cc-tag">{w.label}</span> <b>{w.value}</b>{w.full && w.full !== w.value && <Claim className="cc-where" text={w.full} max={96} />}</p>
      ))}
      <ChangeList changes={part.changes(op, read)} />
    </>
  );
}
