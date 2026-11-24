import { checkStep, type AppliedStep, type ApplyReply, type Command, type CommandStep, type FoundCommand, type HelperStep, type NativeStep, type ScreenLook, type StepOutcome, type UndoReply } from "@rig/core";
import { ChangeList, nativeOf } from "./native";
import { Claim, ClaudeSays, Fact, Printed, ReadCompare, Scripts, TouchList, Untied } from "./parts";
import { declinedLine, limitLine, nativeReach, runCommands, sentinelWords, snapshotted, touchName, undoneLine, undoReach } from "./words";

type Applied = Extract<ApplyReply, { outcome: "applied" }>;
type RolledBack = Extract<ApplyReply, { outcome: "rolledBack" }>;

/** Things that changed which the command didn't say it would. */
export function AlsoChanged({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <Fact label="Also changed" note="Rig saw these change too, and has no saved copy of them">
      <ul className="cc-plain">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </Fact>
  );
}

function AppliedResult({ reply, pcName }: { reply: Applied; pcName: string }) {
  return (
    <>
      <ReadCompare before={reply.result.before} after={reply.result.after} pcName={pcName} />
      <Fact label="What changed" note="read by Rig before and after"><TouchList label="What changed" rows={reply.result.touches} /></Fact>
      <AlsoChanged items={reply.result.alsoChanged} />
      {reply.result.output.trim() && <Printed label="The change script printed" text={reply.result.output} />}
    </>
  );
}

/** A native op's values before and after, as the helper read them. */
function NativeApplied({ step, reply, looks }: { step: NativeStep; reply: Applied; looks?: ScreenLook[] }) {
  const native = nativeOf(step.op, looks);
  return (
    <>
      {native?.part.done?.(native.op, reply.result, native.look)}
      {native && !reply.result.stopped && <Fact label="What changed" note="read by Rig before and after"><ChangeList label="What changed" changes={native.part.changes(native.op, reply.result.before, reply.result.after, native.look)} /></Fact>}
      <AlsoChanged items={reply.result.alsoChanged} />
    </>
  );
}

function RolledBackResult({ reply, native }: { reply: RolledBack; native: boolean }) {
  const touches = reply.result.touches;
  const saved = touches.filter((t) => snapshotted(t.touch));
  const left = reply.left ?? [];
  const lost = [...touches.filter((t) => !snapshotted(t.touch)).map((t) => <Claim key={touchName(t.touch)} text={touchName(t.touch)} max={96} />), ...reply.result.alsoChanged, ...left];
  return (
    <>
      <div className="cc-first" role="status">
        <b>Rig stopped this and put back what it had saved.</b>
      </div>
      <Fact label="Why">
        <ul className="cc-plain">
          {reply.sentinels.map((s) => (
            <li key={s.sentinel}>{native ? "It" : "The command"} changed {sentinelWords(s.sentinel)}, which Rig never lets {native ? "a change touch" : "a command change"}. It went from “{s.before}” to “{s.after}”.</li>
          ))}
          {reply.error && <li>{native ? "It" : "The command"} stopped with an error: {reply.error}</li>}
        </ul>
      </Fact>
      {saved.length > 0 && <Fact label="Rig put back"><TouchList label="Rig put back" nowWord="to" rows={saved.map((t) => ({ touch: t.touch, now: t.before }))} /></Fact>}
      {lost.length > 0 && <Fact label="Rig couldn't put back" note={left.length ? undefined : "it had no copy"}><ul className="cc-plain">{lost.map((x, i) => <li key={i}>{x}</li>)}</ul></Fact>}
      {!native && reply.result.output.trim() && <Printed label="The change script printed" text={reply.result.output} />}
    </>
  );
}

function Undone({ undo, readLabel }: { undo: UndoReply; readLabel: string }) {
  return (
    <div className="cc-undone" role="status">
      <p><b>{undoneLine(undo)}</b></p>
      {undo.outcome === "drifted" && undo.changed.length > 0 && <Fact label="Changed since"><ul className="cc-plain">{undo.changed.map((x) => <li key={x}>{x}</li>)}</ul></Fact>}
      {undo.outcome === "undone" && undo.left.length > 0 && <Fact label="Rig couldn't put back"><ul className="cc-plain">{undo.left.map((x) => <li key={x}>{x}</li>)}</ul></Fact>}
      {undo.outcome === "undone" && <Printed label={readLabel} text={undo.printed} />}
    </div>
  );
}

export interface ResultViewProps {
  step: HelperStep;
  outcome: StepOutcome;
  /** The commands the change script runs, as Rig found them. */
  runs: FoundCommand[];
  pcName: string;
  canApply: boolean;
  /** The looks the proposal's screen steps came from. */
  looks?: ScreenLook[];
  busy?: boolean;
  /** `force` puts it back even though something else changed those places since. */
  onUndo: (force?: boolean) => void;
}

/** What happened after Apply: before and after, what else changed, a rollback, and Undo with what it can reach. */
export function ResultView({ step, outcome, runs, pcName, canApply, looks, busy, onUndo }: ResultViewProps) {
  const a = outcome.apply;
  if (a.outcome === "expired") return <p className="cc-note">This card was too old to run, so nothing changed on {pcName}. Ask again and Rig will read the settings fresh.</p>;
  if (a.outcome === "refused") return <p className="cc-note"><b>Rig didn't run this, so nothing changed on {pcName}.</b> {a.verdict.refused}</p>;
  if (a.outcome === "rolledBack") return <RolledBackResult reply={a} native={step.kind === "native"} />;
  if (a.outcome === "limit") return <p className="cc-note" role="status">{limitLine(a.until, pcName)}</p>;
  if (a.outcome === "declined") return <p className="cc-note" role="status">{declinedLine(pcName)}</p>;
  const reach = step.kind === "command" ? undoReach(step.cmd, a.undo, runs) : nativeReach(a.undo, (() => { const n = nativeOf(step.op); const own = n?.part.red?.(n.op); return own?.words ? own : undefined; })());
  const again = outcome.undo?.outcome === "failed";
  const drifted = outcome.undo?.outcome === "drifted";
  return (
    <>
      {step.kind === "command" ? <AppliedResult reply={a} pcName={pcName} /> : <NativeApplied step={step} reply={a} looks={looks} />}
      {outcome.undo ? <Undone undo={outcome.undo} readLabel={step.kind === "command" ? "After undo, the read script printed" : "After undo, Rig read"} /> : null}
      {drifted && canApply && (
        <div className="cc-undo">
          <p className="faint">Putting it back anyway sets these to what Rig saved, over whatever changed them since.</p>
          <button className="btn sm" type="button" disabled={busy} onClick={() => onUndo(true)}>{busy ? "Undoing…" : "Put back anyway"}</button>
        </div>
      )}
      {(!outcome.undo || again) && (
        <div className="cc-undo">
          {!again && <p className={reach.can ? "faint" : "cc-undo-line none"}>{reach.line}<Untied names={reach.untied} after />{reach.can && !canApply && <> Undo it in the Rig app on {pcName}.</>}</p>}
          {reach.can && canApply && <button className="btn sm" type="button" disabled={busy} onClick={() => onUndo()}>{busy ? "Undoing…" : again ? "Try undo again" : "Undo"}</button>}
        </div>
      )}
    </>
  );
}

/** A command step in the changes log: Claude's sentence, Rig's before and after, and the scripts that ran. */
export function StepRecord({ applied }: { applied: Extract<AppliedStep, { step: CommandStep }> }) {
  const cmd = applied.step.cmd;
  const reach = undoReach(cmd, applied.undo, recordRuns(cmd));
  return (
    <div className="cc-record">
      <ClaudeSays text={cmd.does} />
      {applied.verify && <ReadCompare before={applied.verify.before} after={applied.verify.after} />}
      <AlsoChanged items={applied.undo.outside} />
      <p className="faint cc-reach">{reach.line}<Untied names={reach.untied} after /></p>
      <Scripts cmd={{ ...cmd, undo: applied.undo.script ?? cmd.undo }} />
    </div>
  );
}

/** The change script's commands for a logged step, by Rig's own check of it. */
export function recordRuns(cmd: Command): FoundCommand[] {
  const v = checkStep({ kind: "command", cmd });
  return runCommands(cmd, v.commands);
}
