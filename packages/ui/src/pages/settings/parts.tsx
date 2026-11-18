import type { ReactNode } from "react";

export const sectionAnchor = (id: string) => `settings-${id}`;

const chevron = <svg className="set-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** A group on the Settings page: its title and a line about it, then its rows on one card. */
export function SettingsSection({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  const a = sectionAnchor(id);
  return (
    <section className="set-section" id={a} aria-labelledby={`${a}-h`}>
      <div className="set-head"><h2 id={`${a}-h`}>{title}</h2>{intro && <p className="set-intro">{intro}</p>}</div>
      <div className="card set-body">{children}</div>
    </section>
  );
}

/** A rarely needed group, folded to one line until it's opened. */
export function FoldedSection({ id, title, intro, open, onToggle, children }: { id: string; title: string; intro?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const a = sectionAnchor(id);
  return (
    <section className="set-fold" id={a} aria-labelledby={`${a}-h`}>
      <h2>
        <button type="button" aria-expanded={open} aria-controls={`${a}-b`} onClick={onToggle}>
          <span className="set-fold-text"><span id={`${a}-h`} className="set-fold-title">{title}</span>{intro && <span className="set-intro">{intro}</span>}</span>
          {chevron}
        </button>
      </h2>
      {open && <div className="set-fold-body" id={`${a}-b`}>{children}</div>}
    </section>
  );
}

/** A switch-like row that shows or hides more settings below it. */
export function MoreToggle({ id, title, summary, open, onToggle }: { id: string; title: string; summary: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="set-more-btn" aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <span className="set-text"><b>{title}</b><span className="muted">{summary}</span></span>
      {chevron}
    </button>
  );
}

/** One setting: what it is on the left, its control on the right. */
export function SettingRow({ title, body, children, id }: { title: string; body?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="set-row">
      <div className="set-text"><b id={id}>{title}</b>{body && <p className="muted">{body}</p>}</div>
      {children && <div className="set-control">{children}</div>}
    </div>
  );
}
