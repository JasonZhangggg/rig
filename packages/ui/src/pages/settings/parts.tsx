import type { ReactNode } from "react";

export const sectionAnchor = (id: string) => `settings-${id}`;

/** A card on the Settings page with a title, a line about it and its rows. */
export function SettingsSection({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="card set-section" id={sectionAnchor(id)} aria-labelledby={`${sectionAnchor(id)}-h`}>
      <div className="card-head"><div><h2 id={`${sectionAnchor(id)}-h`}>{title}</h2>{intro && <p className="muted set-intro">{intro}</p>}</div></div>
      <div className="set-body">{children}</div>
    </section>
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
