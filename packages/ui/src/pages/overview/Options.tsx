import type { ReactNode } from "react";
import { useApp } from "../../state";
import { KINDS, type Dashboard, type OptValue, type Spacing, type Tone, type Widget } from "./layout";
import { sourceItems } from "./widgets";

function Seg<T extends string>({ label, value, options, onPick, disabled }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void; disabled?: boolean }) {
  const id = `dopt-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="dopt">
      <span className="dopt-label" id={id}>{label}</span>
      <div className="dseg" role="group" aria-labelledby={id}>
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={v === value} disabled={disabled} onClick={() => onPick(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="dtog">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="dsec"><h3>{title}</h3>{children}</div>
);

const SERIES = ["idle", "typical", "peak"];

/** Every choice for one widget. Changes show on the tile straight away. */
export function WidgetOptions({ w, onChange }: { w: Widget; onChange: (patch: Partial<Widget>) => void }) {
  const ctx = useApp();
  const meta = KINDS[w.kind];
  const setOpt = (key: string, v: OptValue) => onChange({ opts: { ...w.opts, [key]: v } });
  const dark = w.tone === "dark";
  const lastSeries = (key: string) => w.kind === "temps" && SERIES.includes(key) && SERIES.filter((k) => w.opts[k] !== false).length === 1 && w.opts[key] !== false;
  const toggles = meta.options.filter((o) => o.type === "toggle");
  return (
    <>
      <Section title="Look">
        <Seg label="Style" value={w.style} options={meta.styles} onPick={(style) => onChange({ style })} />
        <Seg<Tone> label="Tone" value={w.tone} options={[["light", "Light"], ["dark", "Dark"]]} onPick={(tone) => onChange({ tone })} />
        <Seg label="Background" value={dark ? "tile" : w.frame} options={[["tile", "Tile"], ["open", "On the page"]]} onPick={(frame) => onChange({ frame })} disabled={dark} />
        {dark && <p className="dnote">Dark widgets always sit on a tile.</p>}
      </Section>
      {meta.options.length > 0 && (
        <Section title="Show">
          {meta.options.map((o) => {
            if (o.type === "choice") return <Seg key={o.key} label={o.label} value={String(w.opts[o.key])} options={o.choices} onPick={(v) => setOpt(o.key, v)} />;
            if (o.type === "set") {
              const items = sourceItems(o.source, ctx);
              const off = (w.opts[o.key] as string[]) ?? [];
              if (!items.length) return null;
              return (
                <fieldset key={o.key} className="dset">
                  <legend>{o.label}</legend>
                  {items.map(([id, text]) => (
                    <Toggle key={id} label={text} checked={!off.includes(id)} onChange={(v) => setOpt(o.key, v ? off.filter((x) => x !== id) : [...off, id])} />
                  ))}
                </fieldset>
              );
            }
            return null;
          })}
          {toggles.length > 0 && (
            <div className="dtogs">
              {toggles.map((o) => <Toggle key={o.key} label={o.label} checked={w.opts[o.key] !== false} disabled={lastSeries(o.key)} onChange={(v) => setOpt(o.key, v)} />)}
            </div>
          )}
        </Section>
      )}
    </>
  );
}

const Plus = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;

/** The hidden widgets, to put back on Home. */
export function AddWidgets({ hidden, onAdd }: { hidden: Widget[]; onAdd: (id: string) => void }) {
  if (!hidden.length) return <p className="dnote">Every widget is on Home. Hide one from its options and it waits here.</p>;
  return (
    <ul className="dlib">
      {hidden.map((w) => (
        <li key={w.id}>
          <button type="button" onClick={() => onAdd(w.id)}>
            <span><b>{KINDS[w.kind].title}</b><small>{KINDS[w.kind].blurb}</small></span>
            <i aria-hidden="true"><Plus /></i>
            <span className="sr-only">Add</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Choices for the whole of Home. Corners and density belong to Settings, Appearance, so every screen matches. */
export function DashOptions({ dash, onSpacing, onTone, onAppearance }: { dash: Dashboard; onSpacing: (spacing: Spacing) => void; onTone: (tone: Tone | "default") => void; onAppearance: () => void }) {
  return (
    <>
      <Section title="Layout">
        <Seg<Spacing> label="Space between widgets" value={dash.spacing} options={[["tight", "Tight"], ["normal", "Normal"], ["roomy", "Roomy"]]} onPick={onSpacing} />
      </Section>
      <Section title="Every widget">
        <div className="dfoot-row">
          <button type="button" className="dbtn" onClick={() => onTone("light")}>All light</button>
          <button type="button" className="dbtn" onClick={() => onTone("dark")}>All dark</button>
          <button type="button" className="dbtn" onClick={() => onTone("default")}>As they started</button>
        </div>
      </Section>
      <Section title="Corners and density">
        <p className="dnote">Home follows the corners, density and colors you pick in Settings, so every screen matches.</p>
        <div className="dfoot-row">
          <button type="button" className="dbtn" onClick={onAppearance}>Open Appearance settings</button>
        </div>
      </Section>
    </>
  );
}

export function ResetConfirm({ onReset, onCancel }: { onReset: () => void; onCancel: () => void }) {
  return (
    <>
      <p className="dnote">This puts every widget back where it started, in its first style and size.</p>
      <div className="dfoot-row end">
        <button type="button" className="dbtn" onClick={onCancel}>Keep my layout</button>
        <button type="button" className="dbtn primary" onClick={onReset}>Reset Home</button>
      </div>
    </>
  );
}
