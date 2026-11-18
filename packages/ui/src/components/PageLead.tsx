import type { ReactNode } from "react";

/**
 * The one thing a page is about, at its top: a short tag, the answer as a heading, a line on what it means, what to do,
 * and at most one figure beside it. Everything else on the page sits under it, smaller.
 */
export function PageLead({ id, tone, tag, title, body, figure, figureNote, aside, children }: {
  id: string;
  tone: "good" | "look" | "plain";
  tag: string;
  title: string;
  body?: ReactNode;
  figure?: string;
  figureNote?: string;
  /** In place of the figure, when it needs to be more than words, like a button. */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={`card pg-lead ${tone}${figure || aside ? "" : " solo"}`} aria-labelledby={id}>
      <div className="pg-lead-text">
        <span className="pg-lead-tag">{tag}</span>
        <h2 id={id} className="pg-lead-h">{title}</h2>
        {body && <p className="pg-lead-body">{body}</p>}
        {children && <div className="gm-actions">{children}</div>}
      </div>
      {aside}
      {!aside && figure && <p className="pg-lead-fig"><b className="num">{figure}</b>{figureNote && <span className="muted">{figureNote}</span>}</p>}
    </section>
  );
}
