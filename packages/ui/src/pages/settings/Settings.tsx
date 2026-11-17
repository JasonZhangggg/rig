import { useEffect } from "react";
import { reducedMotion } from "../../appearance";
import { useApp } from "../../state";
import { SettingsSection, sectionAnchor, settingsSections, takeFocusSection } from "./sections";

export function Settings() {
  const ctx = useApp();
  const shown = settingsSections.filter((s) => s.show?.(ctx) ?? true);
  useEffect(() => {
    const id = takeFocusSection();
    if (id) requestAnimationFrame(() => document.getElementById(sectionAnchor(id))?.scrollIntoView({ block: "start" }));
  }, []);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Settings</h1><p className="sub">Your account, your data and how Rig shows things{ctx.client.kind === "desktop" ? " on this PC" : ""}.</p></div>
      </div>
      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {shown.map((s) => <button key={s.id} type="button" onClick={() => document.getElementById(sectionAnchor(s.id))?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" })}>{s.title}</button>)}
        </nav>
        <div className="set-list">
          {shown.map(({ id, title, intro, Body }) => <SettingsSection key={id} id={id} title={title} intro={intro}><Body /></SettingsSection>)}
        </div>
      </div>
    </div>
  );
}
