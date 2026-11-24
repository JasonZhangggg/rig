import type { ReactNode } from "react";
import type { FoundCommand, Touch } from "@rig/core";
import { commandSays, lines, touchKind, touchName, touchShort, touchWhere, value } from "./words";

/** A labelled block on a change card. The label says whose words or reading it is. */
export function Fact({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="cc-fact">
      <div className="cc-label">{label}{note && <span className="faint"> · {note}</span>}</div>
      {children}
    </div>
  );
}

/** Claude's one sentence, set apart so it never reads as something Rig checked. */
export function ClaudeSays({ text }: { text: string }) {
  return <Fact label="Claude says"><p className="cc-quote">{text}</p></Fact>;
}

/** What a script printed. */
export function Printed({ text, label }: { text: string; label?: string }) {
  return <pre className="cc-pre" aria-label={label}>{text.trim() || "Nothing was printed."}</pre>;
}

/** What the read script printed before and after, side by side. */
export function ReadCompare({ before, after }: { before: string; after: string }) {
  return (
    <div className="cc-compare">
      <Fact label="Before"><Printed text={before} label="Before" /></Fact>
      <Fact label="After"><Printed text={after} label="After" /></Fact>
    </div>
  );
}

/** Commands Rig's checker found, in its words. */
export function CommandList({ commands }: { commands: FoundCommand[] }) {
  return (
    <ul className="cc-list" aria-label="Commands Rig found">
      {commands.map((c) => (
        <li key={`${c.name}|${c.says}`} className={`cc-cmd t${c.tier}`}>
          <code>{c.name}</code>
          <span>{commandSays(c)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface GlanceProps {
  /** What the command touches, with the value Rig read just now when it has. */
  touches: { touch: Touch; now?: string | null }[];
  risk: string;
  undo: string;
  /** Nothing can put it back. */
  noUndo?: boolean;
}

/** The three things to know first, from Rig's own reads and checks: what changes, how risky it is, and whether it can be undone. */
export function Glance({ touches, risk, undo, noUndo }: GlanceProps) {
  return (
    <dl className="cc-glance">
      <div>
        <dt>What changes</dt>
        <dd>
          {touches.length ? (
            <ul className="cc-plain" aria-label="What it changes">
              {touches.map(({ touch, now }) => (
                <li key={`${touch.kind}|${touchName(touch)}`}>
                  {touch.kind !== "other" && <><span className="cc-tag">{touchKind(touch)}</span> </>}<b>{touchShort(touch)}</b>
                  {now !== undefined && <> <span className="faint">now</span> <b>{value(now)}</b></>}
                  {touchWhere(touch) && <code className="cc-where">{touchWhere(touch)}</code>}
                </li>
              ))}
            </ul>
          ) : "Rig can't tell ahead of time"}
        </dd>
      </div>
      <div><dt>How risky</dt><dd>{risk}</dd></div>
      <div><dt>Can it be undone</dt><dd className={noUndo ? "cc-no" : undefined}>{undo}</dd></div>
    </dl>
  );
}

export interface TouchRow { touch: Touch; now?: string | null; before?: string | null; after?: string | null }

/** Everything a command touches. With `now` it shows the current value; with `before` and `after`, both. */
export function TouchList({ rows, label = "What it changes" }: { rows: TouchRow[]; label?: string }) {
  return (
    <ul className="cc-list" aria-label={label}>
      {rows.map((r) => (
        <li key={`${r.touch.kind}|${touchName(r.touch)}`} className="cc-touch">
          <span className="cc-tag">{r.touch.kind === "other" ? "" : touchKind(r.touch)}</span>
          <code>{touchName(r.touch)}</code>
          {"after" in r
            ? <span className="cc-values"><span className="cc-before">{value(r.before ?? null)}</span><span className="cc-arrow" aria-label="changed to">→</span><b>{value(r.after ?? null)}</b></span>
            : <span className="cc-values"><span className="faint">Now</span> <b>{value(r.now ?? null)}</b></span>}
        </li>
      ))}
    </ul>
  );
}

/** A script's full text, folded until the person opens it. */
export function ScriptFold({ label, text, open }: { label: string; text: string; open?: boolean }) {
  return (
    <details className="cc-fold" open={open}>
      <summary>{label} <span className="faint">· {lines(text)}</span></summary>
      <pre className="cc-pre cc-script" aria-label={label}>{text}</pre>
    </details>
  );
}

/** Every script of one command: what reads, what changes and what puts it back. */
export function Scripts({ cmd, open }: { cmd: { read: string; run: string; undo?: string }; open?: boolean }) {
  return (
    <div className="cc-folds">
      <ScriptFold label="Change script" text={cmd.run} open={open} />
      {cmd.undo ? <ScriptFold label="Undo script" text={cmd.undo} open={open} /> : null}
      <ScriptFold label="Read script" text={cmd.read} />
    </div>
  );
}
