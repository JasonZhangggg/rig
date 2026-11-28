import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useApp } from "../../state";
import { KINDS, type Dashboard, type Dir, type OptValue, type Spacing, type Tone, type Widget } from "./layout";
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

/** Where a widget sits and how big it is, for anyone who can't or would rather not drag. Wide grids only. */
export interface Place {
  size: string;
  sizes: [string, string][];
  onSize: (size: string) => void;
  onMove: (dir: Dir) => void;
  /** Whether the widget has room to move that way. A move that can't happen shows as a dimmed arrow. */
  canMove: (dir: Dir) => boolean;
}

const arrows: [Dir, string, string][] = [["left", "Move left", "M12 5 7 10l5 5"], ["up", "Move up", "M5 12l5-5 5 5"], ["down", "Move down", "M5 8l5 5 5-5"], ["right", "Move right", "M8 5l5 5-5 5"]];

/** Every choice for one widget. Changes show on the tile straight away. */
export function WidgetOptions({ w, onChange, place }: { w: Widget; onChange: (patch: Partial<Widget>) => void; place?: Place }) {
  const ctx = useApp();
  const meta = KINDS[w.kind];
  const setOpt = (key: string, v: OptValue) => onChange({ opts: { ...w.opts, [key]: v } });
  const dark = w.tone === "dark";
  const lastSeries = (key: string) => w.kind === "temps" && SERIES.includes(key) && SERIES.filter((k) => w.opts[k] !== false).length === 1 && w.opts[key] !== false;
  const options = meta.options.filter((o) => !o.styles || o.styles.includes(w.style));
  const toggles = options.filter((o) => o.type === "toggle");
  // A move that reaches the edge dims its own arrow, so focus steps to an arrow that still moves rather than dropping to the page.
  const move = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = move.current, now = document.activeElement;
    if (!el || !(now instanceof HTMLButtonElement) || !el.contains(now) || !now.disabled) return;
    (el.querySelector<HTMLElement>("button:not(:disabled)") ?? el.closest(".dsec")?.querySelector<HTMLElement>("button[aria-pressed='true']"))?.focus({ preventScroll: true });
  });
  return (
    <>
      {place && (
        <Section title="Place">
          <Seg label="Size" value={place.size} options={place.sizes} onPick={place.onSize} />
          <div className="dopt">
            <span className="dopt-label" id="dopt-move">Move</span>
            <div className="dseg dmove" role="group" aria-labelledby="dopt-move" ref={move}>
              {arrows.map(([dir, text, d]) => (
                <button key={dir} type="button" aria-label={text} title={text} disabled={!place.canMove(dir)} onClick={() => place.onMove(dir)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              ))}
            </div>
          </div>
        </Section>
      )}
      <Section title="Look">
        <Seg label="Style" value={w.style} options={meta.styles} onPick={(style) => onChange({ style })} />
        <Seg<Tone> label="Tone" value={w.tone} options={[["light", "Light"], ["dark", "Dark"]]} onPick={(tone) => onChange({ tone })} />
        <Seg label="Background" value={dark ? "tile" : w.frame} options={[["tile", "Tile"], ["open", "On the page"]]} onPick={(frame) => onChange({ frame })} disabled={dark} />
        {dark && <p className="dnote">Dark widgets always sit on a tile.</p>}
      </Section>
      {options.length > 0 && (
        <Section title="Show">
          {options.map((o) => {
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
