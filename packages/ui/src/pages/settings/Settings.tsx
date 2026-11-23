import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../../appearance";
import { useActions } from "../../state";
import { FoldedSection, SettingsSection, onFocusSection, peekFocusSection, sectionAnchor, settingsSections, takeFocusSection } from "./sections";

export function Settings() {
  const ctx = useActions();
  const shown = settingsSections.filter((s) => s.show?.(ctx) ?? true);
  const main = shown.filter((s) => !s.folded), folded = shown.filter((s) => s.folded);
  const [open, setOpen] = useState<string[]>(() => { const id = peekFocusSection(); return id ? [id] : []; });
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const jump = (id: string) => {
    if (!open.includes(id) && folded.some((s) => s.id === id)) setOpen((o) => [...o, id]);
    requestAnimationFrame(() => document.getElementById(sectionAnchor(id))?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }));
  };
  const jumpTo = useRef(jump);
  jumpTo.current = jump;
  useEffect(() => {
    const id = takeFocusSection();
    if (id) requestAnimationFrame(() => document.getElementById(sectionAnchor(id))?.scrollIntoView({ block: "start" }));
    // Picked from Ctrl K while Settings is already open: the address doesn't change, so jump here.
    return onFocusSection((id) => jumpTo.current(id));
  }, []);
  return (
    <div className="page set-page">
      <div className="page-head">
        <div><h1>Settings</h1><p className="sub">How Rig looks and alerts you{ctx.client.kind === "desktop" ? " on this PC" : ""}, your account and your data.</p></div>
      </div>
      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {main.map((s) => <button key={s.id} type="button" onClick={() => jump(s.id)}>{s.title}</button>)}
          {folded.length > 0 && <span className="set-nav-label" aria-hidden="true">More</span>}
          {folded.map((s) => <button key={s.id} type="button" onClick={() => jump(s.id)}>{s.title}</button>)}
        </nav>
        <div className="set-list">
          {main.map(({ id, title, intro, Body }) => <SettingsSection key={id} id={id} title={title} intro={intro}><Body /></SettingsSection>)}
          {folded.length > 0 && (
            <div className="card set-folds">
              {folded.map(({ id, title, intro, Body }) => (
                <FoldedSection key={id} id={id} title={title} intro={intro} open={open.includes(id)} onToggle={() => toggle(id)}><Body /></FoldedSection>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
