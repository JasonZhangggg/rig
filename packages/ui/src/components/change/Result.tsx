import type { AppliedStep, ApplyReply, Command, CommandStep, StepOutcome, UndoReply } from "@rig/core";
import { ClaudeSays, Fact, Printed, ReadCompare, Scripts, TouchList } from "./parts";
import { sentinelWords, undoneLine, undoReach } from "./words";

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

function AppliedResult({ reply }: { reply: Applied }) {
  return (
    <>
      <ReadCompare before={reply.result.before} after={reply.result.after} />
      <Fact label="What changed" note="read by Rig before and after"><TouchList label="What changed" rows={reply.result.touches} /></Fact>
      <AlsoChanged items={reply.result.alsoChanged} />
      {reply.result.output.trim() && <Fact label="What the script printed"><Printed text={reply.result.output} /></Fact>}
    </>
  );
}

function RolledBackResult({ reply, pcName }: { reply: RolledBack; pcName: string }) {
  return (
    <>
      <div className="cc-first" role="status">
        <b>Rig put everything back.</b> Nothing is changed on {pcName}.
      </div>
      <Fact label="Why">
        <ul className="cc-plain">
          {reply.sentinels.map((s) => (
            <li key={s.sentinel}>The command changed {sentinelWords(s.sentinel)}, which Rig never lets a command change. It went from “{s.before}” to “{s.after}”, and is back to “{s.before}”.</li>
          ))}
          {reply.error && <li>The command stopped with an error: {reply.error}</li>}
        </ul>
      </Fact>
      <Fact label="What was put back"><TouchList label="What was put back" rows={reply.result.touches.map((t) => ({ touch: t.touch, now: t.before }))} /></Fact>
    </>
  );
}

function Undone({ undo }: { undo: UndoReply }) {
  return (
    <div className="cc-undone" role="status">
      <p><b>{undoneLine(undo)}</b></p>
      {undo.outcome === "undone" && undo.left.length > 0 && <Fact label="Rig couldn't put back"><ul className="cc-plain">{undo.left.map((x) => <li key={x}>{x}</li>)}</ul></Fact>}
      {undo.outcome === "undone" && <Fact label="Now" note="read again after the undo"><Printed text={undo.printed} label="Now" /></Fact>}
    </div>
  );
}

export interface ResultViewProps {
  cmd: Command;
  outcome: StepOutcome;
  pcName: string;
  canApply: boolean;
  busy?: boolean;
  onUndo: () => void;
}

/** What happened after Apply: before and after, what else changed, a rollback, and Undo with what it can reach. */
export function ResultView({ cmd, outcome, pcName, canApply, busy, onUndo }: ResultViewProps) {
  const a = outcome.apply;
  if (a.outcome === "expired") return <p className="cc-note">This card was too old to run, so nothing changed on {pcName}. Ask again and Rig will read the settings fresh.</p>;
  if (a.outcome === "refused") return <p className="cc-note"><b>Rig didn't run this, so nothing changed on {pcName}.</b> {a.verdict.refused}</p>;
  if (a.outcome === "rolledBack") return <RolledBackResult reply={a} pcName={pcName} />;
  const reach = undoReach(cmd, a.undo);
  const again = outcome.undo?.outcome === "failed";
  return (
    <>
      <AppliedResult reply={a} />
      {outcome.undo ? <Undone undo={outcome.undo} /> : null}
      {(!outcome.undo || again) && (
        <div className="cc-undo">
          {!again && <p className={reach.can ? "faint" : "cc-undo-line none"}>{reach.line}{reach.can && !canApply && <> Undo it in the Rig app on {pcName}.</>}</p>}
          {reach.can && canApply && <button className="btn sm" type="button" disabled={busy} onClick={onUndo}>{busy ? "Undoing…" : again ? "Try undo again" : "Undo"}</button>}
        </div>
      )}
    </>
  );
}

/** A command step in the changes log: Claude's sentence, Rig's before and after, and the scripts that ran. */
export function StepRecord({ applied }: { applied: Extract<AppliedStep, { step: CommandStep }> }) {
  const cmd = applied.step.cmd;
  return (
    <div className="cc-record">
      <ClaudeSays text={cmd.does} />
      {applied.verify && <ReadCompare before={applied.verify.before} after={applied.verify.after} />}
      <AlsoChanged items={applied.undo.outside} />
      <p className="faint cc-reach">{undoReach(cmd, applied.undo).line}</p>
      <Scripts cmd={{ ...cmd, undo: applied.undo.script ?? cmd.undo }} />
    </div>
  );
}
