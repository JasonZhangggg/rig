import { useId, type ReactNode } from "react";
import type { FoundCommand, Touch } from "@rig/core";
import { clip, commandSays, lines, saidText, touchKind, touchName, touchShort, touchWhere, value } from "./words";

/** A labelled block on a change card. The label says whose words or reading it is. */
export function Fact({ label, note, id, children }: { label: string; note?: string; id?: string; children: ReactNode }) {
  return (
    <div className="cc-fact">
      <div className="cc-label" id={id}>{label}{note && <span className="faint"> · {note}</span>}</div>
      {children}
    </div>
  );
}

/** Claude's one sentence, set apart so it never reads as something Rig checked. */
export function ClaudeSays({ text }: { text: string }) {
  const said = saidText(text);
  return (
    <Fact label="Claude says">
      {said ? <p className="cc-quote" title={said !== text.trim() ? text : undefined}>{said}</p> : <p className="cc-quote faint">Claude didn't say what this does.</p>}
    </Fact>
  );
}

/** Text from the PC or a script, in a box that scrolls. It takes focus so a keyboard can scroll it, and is named by its visible label. */
export function Pre({ text, labelledBy, className = "" }: { text: string; labelledBy: string; className?: string }) {
  return <pre className={`cc-pre ${className}`.trim()} tabIndex={0} role="region" aria-labelledby={labelledBy}>{text}</pre>;
}

/** What a script printed, under a label that says which script and where. */
export function Printed({ label, text }: { label: string; text: string }) {
  const id = useId();
  return <Fact label={label} id={id}><Pre text={text.trim() || "Nothing was printed."} labelledBy={id} /></Fact>;
}

/** What the read script printed before and after, side by side. */
export function ReadCompare({ before, after, pcName }: { before: string; after: string; pcName?: string }) {
  return (
    <div className="cc-compare">
      <Printed label={`Before, the read script printed${pcName ? ` (on ${pcName})` : ""}`} text={before} />
      <Printed label="After, it printed" text={after} />
    </div>
  );
}

/** Text that came from Claude, shown as code and cut short, with the whole of it on hover. */
export function Claim({ text, max = 48, className = "" }: { text: string; max?: number; className?: string }) {
  const short = clip(text, max);
  return <code className={`cc-claim ${className}`.trim()} title={short !== text ? text : undefined}>{short}</code>;
}

/** Commands Rig's checker found, in its words. */
export function CommandList({ commands }: { commands: FoundCommand[] }) {
  return (
    <ul className="cc-list" aria-label="Commands Rig found">
      {commands.map((c) => (
        <li key={`${c.name}|${c.says}`} className={`cc-cmd t${c.tier}`}>
          <Claim text={c.name} max={40} />
          <span>{commandSays(c)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Commands that may change things off the list, so what Rig saves doesn't cover them. */
export function Untied({ names, after }: { names: string[]; after?: boolean }) {
  if (!names.length) return null;
  const many = names.length > 1;
  return (
    <span className="cc-untied">
      {" "}It also runs {names.map((n, i) => <span key={n}>{i > 0 && (i === names.length - 1 ? " and " : ", ")}<Claim text={n} max={32} /></span>)}, which {many ? "aren't" : "isn't"} tied to the list. {after ? "Undo can't put back what that changed." : "Rig has no copy of what that changes."}
    </span>
  );
}

export interface GlanceProps {
  /** What Claude says the command touches, with the value Rig read just now when it has. `false` means Rig didn't read that one. */
  touches: { touch: Touch; now?: string | null | false }[];
  risk: string;
  undo: ReactNode;
  /** Nothing can put it back. */
  noUndo?: boolean;
}

function Value({ now }: { now: string | null | false }) {
  if (now === false) return <span className="faint">Rig didn't read this</span>;
  const v = value(now), short = clip(v, 40);
  return <><span className="faint">now</span> <b title={short !== v ? v : undefined}>{short}</b></>;
}

/** The three things to know first: what Claude says it changes with Rig's read of each, how risky Rig found it, and whether it can be undone. */
export function Glance({ touches, risk, undo, noUndo }: GlanceProps) {
  return (
    <dl className="cc-glance">
      <div>
        <dt>Claude says it changes</dt>
        <dd>
          {touches.length ? (
            <ul className="cc-plain" aria-label="What it changes">
              {touches.map(({ touch, now }) => {
                const where = touchWhere(touch);
                return (
                  <li key={`${touch.kind}|${touchName(touch)}`}>
                    {touch.kind !== "other" && <><span className="cc-tag">{touchKind(touch)}</span> </>}<Claim text={touchShort(touch)} />
                    {now !== undefined && <> <Value now={now} /></>}
                    {where && <Claim className="cc-where" text={where} max={64} />}
                  </li>
                );
              })}
            </ul>
          ) : "Nothing listed."}
        </dd>
      </div>
      <div><dt>How risky</dt><dd>{risk}</dd></div>
      <div><dt>Can it be undone</dt><dd className={noUndo ? "cc-no" : undefined}>{undo}</dd></div>
    </dl>
  );
}

export interface TouchRow { touch: Touch; now?: string | null; before?: string | null; after?: string | null }

/** Everything a command touches. With `now` it shows a value, under `nowWord`; with `before` and `after`, both. */
export function TouchList({ rows, label = "What it changes", nowWord = "Now" }: { rows: TouchRow[]; label?: string; nowWord?: string }) {
  return (
    <ul className="cc-list" aria-label={label}>
      {rows.map((r) => (
        <li key={`${r.touch.kind}|${touchName(r.touch)}`} className="cc-touch">
          <span className="cc-tag">{r.touch.kind === "other" ? "" : touchKind(r.touch)}</span>
          <Claim text={touchName(r.touch)} max={96} />
          {"after" in r
            ? <span className="cc-values"><span className="cc-before">{value(r.before ?? null)}</span><span className="cc-arrow" aria-hidden="true">→</span><span className="sr-only"> changed to </span><b>{value(r.after ?? null)}</b></span>
            : <span className="cc-values"><span className="faint">{nowWord}</span> <b>{value(r.now ?? null)}</b></span>}
        </li>
      ))}
    </ul>
  );
}

/** A script's full text, folded until the person opens it. */
export function ScriptFold({ label, text, open }: { label: string; text: string; open?: boolean }) {
  const id = useId();
  return (
    <details className="cc-fold" open={open}>
      <summary><span id={id}>{label}</span> <span className="faint">· {lines(text)}</span></summary>
      <Pre className="cc-script" text={text} labelledBy={id} />
    </details>
  );
}

/** Every script of one command: what reads, what changes and what puts it back. */
export function Scripts({ cmd, open }: { cmd: { read: string; run: string; undo?: string | null }; open?: boolean }) {
  return (
    <div className="cc-folds">
      <ScriptFold label="Change script" text={cmd.run} open={open} />
      {cmd.undo ? <ScriptFold label="Undo script" text={cmd.undo} open={open} /> : null}
      <ScriptFold label="Read script" text={cmd.read} />
    </div>
  );
}
