import { useEffect, useState, type CSSProperties } from "react";
import {
  brass, chromeOf, chromes, colorsOf, cornerSets, densities, FILL_INK, fillProblems, isDefaultAppearance, isHex, lightenForInk, motions, pageTones, palettes,
  textSizes, type Appearance, type DataColors,
} from "../../appearance";
import { resetAppearance, setAppearance, useApp, useAppearance } from "../../state";
import { MoreToggle, SettingRow } from "./parts";
import { onFocusSection, peekFocusSection } from "./focus";

const roles: { key: keyof DataColors; name: string; about: string }[] = [
  { key: "good", name: "Settled", about: "Running well, the usual reading" },
  { key: "look", name: "Needs a look", about: "Too hot, failing or worth checking" },
  { key: "expected", name: "Normal", about: "What's typical, for comparison" },
];

export function AppearanceSection() {
  const look = useAppearance();
  const { toast } = useApp();
  const [more, setMore] = useState(() => peekFocusSection() === "appearance");
  useEffect(() => onFocusSection((id) => { if (id === "appearance") setMore(true); }), []);
  const named = <T extends { id: string; name: string }>(list: readonly T[], id: string) => list.find((x) => x.id === id)?.name ?? "";
  const summary = `${named(chromes, look.chrome)} menu, ${named(pageTones, look.page).toLowerCase()} page, ${named(cornerSets, look.corners).toLowerCase()} corners, ${named(densities, look.density).toLowerCase()} spacing`;
  return (
    <>
      <div className="set-block">
        <div className="set-text"><b id="look-colors">Colors</b><p className="muted">The colors that mark your readings on every screen and the 3D PC.</p></div>
        <div className="look-presets" role="group" aria-labelledby="look-colors">
          {palettes.map((p) => (
            <PresetCard key={p.id} name={p.name} blurb={p.blurb} colors={p.colors} on={look.palette === p.id} onPick={() => setAppearance({ palette: p.id })} />
          ))}
          <PresetCard name="Custom" blurb="Pick your own three." colors={look.custom} on={look.palette === "custom"} onPick={() => setAppearance({ palette: "custom" })} />
        </div>
        {look.palette === "custom" && <CustomColors look={look} />}
      </div>
      <Choice id="look-text" title="Text size" body="Makes every screen a little bigger, the 3D PC included." options={textSizes} value={look.text} onPick={(text) => setAppearance({ text })} />
      <Choice id="look-motion" title="Motion" body="Reduce keeps the 3D PC and the sign-in art still and turns off animations." options={motions} value={look.motion} onPick={(motion) => setAppearance({ motion })} />
      <MoreToggle id="look-more" title="More appearance options" summary={summary} open={more} onToggle={() => setMore(!more)} />
      {more && (
        <div className="look-more" id="look-more">
          <Sample />
          <div className="set-block">
            <div className="set-text"><b id="look-chrome">Dark color</b><p className="muted">The dark color of the menu, buttons and dark tiles.</p></div>
            <div className="look-swatches" role="group" aria-labelledby="look-chrome">
              {chromes.map((c) => <Swatch key={c.id} name={c.name} color={c.graphite} on={look.chrome === c.id} onPick={() => setAppearance({ chrome: c.id })} />)}
            </div>
          </div>
          <div className="set-block">
            <div className="set-text"><b id="look-page">Page</b><p className="muted">The tone behind the cards.</p></div>
            <div className="look-swatches" role="group" aria-labelledby="look-page">
              {pageTones.map((p) => <Swatch key={p.id} name={p.name} color={p.ground} light on={look.page === p.id} onPick={() => setAppearance({ page: p.id })} />)}
            </div>
          </div>
          <Choice id="look-corners" title="Corners" body="How round cards, buttons and tiles are." options={cornerSets} value={look.corners} onPick={(corners) => setAppearance({ corners })} />
          <Choice id="look-density" title="Density" body="Compact puts cards closer together and the text a size smaller." options={densities} value={look.density} onPick={(density) => setAppearance({ density })} />
        </div>
      )}
      <SettingRow title="Reset appearance" body="Back to how Rig ships. Your custom colors are cleared too.">
        <button className="btn sm" type="button" disabled={isDefaultAppearance(look)} onClick={() => { resetAppearance(); toast("Appearance is back to how Rig ships."); }}>Reset appearance</button>
      </SettingRow>
    </>
  );
}

/** A small live sample in the current look: a light card and a dark tile, as Home has them. */
function Sample() {
  const bars = [62, 74, 58, 92, 70, 66, 48];
  return (
    <div className="look-sample" aria-hidden="true">
      <div className="look-sample-light">
        <div className="look-sample-chips"><span className="chip ok">Settled</span><span className="chip warn">Needs a look</span></div>
        <div className="look-sample-bars">{bars.map((h, i) => <i key={i} className={i === 3 ? "look" : i === 6 ? "exp" : undefined} style={{ height: `${h}%` }} />)}</div>
        <p><b className="look-sample-good">42°</b> processor, <b className="look-sample-look">88°</b> graphics card</p>
      </div>
      <div className="look-sample-dark tone-dark">
        <MiniRing size={64} />
        <div><b>96</b><small>Health</small></div>
      </div>
    </div>
  );
}

function MiniRing({ size, colors }: { size: number; colors?: DataColors }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  const good = colors ? colors.good : "var(--good-on-dark)", bad = colors ? colors.look : "var(--look-on-dark)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="look-ring">
      <circle cx={size / 2} cy={size / 2} r={r} className="look-ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={good} strokeDasharray={`${c * 0.68} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={bad} strokeDasharray={`${c * 0.14} ${c}`} strokeDashoffset={-c * 0.72} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

function PresetCard({ name, blurb, colors, on, onPick }: { name: string; blurb: string; colors: DataColors; on: boolean; onPick: () => void }) {
  const style = { "--pv-good": colors.good, "--pv-look": colors.look, "--pv-exp": colors.expected } as CSSProperties;
  return (
    <button type="button" className="look-preset" aria-pressed={on} onClick={onPick} style={style}>
      <span className="look-preset-pv" aria-hidden="true">
        <span className="look-preset-dark"><MiniRing size={40} colors={colors} /></span>
        <span className="look-preset-bars"><i /><i /><i className="exp" /><i className="look" /><i /><i /></span>
      </span>
      <span className="look-preset-text"><b>{name}</b><small>{blurb}</small></span>
    </button>
  );
}

function Swatch({ name, color, on, light, onPick }: { name: string; color: string; on: boolean; light?: boolean; onPick: () => void }) {
  return (
    <button type="button" className="look-swatch" aria-pressed={on} onClick={onPick}>
      <i className={light ? "light" : undefined} style={{ background: color }} aria-hidden="true" />{name}
    </button>
  );
}

function Choice<T extends string>({ id, title, body, options, value, onPick }: { id: string; title: string; body: string; options: readonly { id: T; name: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <SettingRow id={id} title={title} body={body}>
      <div className="seg" role="group" aria-labelledby={id}>
        {options.map((o) => <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onPick(o.id)}>{o.name}</button>)}
      </div>
    </SettingRow>
  );
}

function CustomColors({ look }: { look: Appearance }) {
  const colors = colorsOf(look), chrome = chromeOf(look);
  const problems = fillProblems(colors, chrome);
  const pick = (patch: Partial<DataColors>) => setAppearance({ custom: { ...look.custom, ...patch } });
  return (
    <div className="look-custom" role="group" aria-label="Custom colors">
      <div className="look-custom-grid">
        {roles.map((r) => <ColorField key={r.key} label={r.name} about={r.about} value={look.custom[r.key]} onChange={(v) => pick({ [r.key]: v })} />)}
      </div>
      {problems.goodTooDark && (
        <Problem text="Labels on Settled are hard to read on a color this dark." fix="Use a lighter shade" onFix={() => pick({ good: lightenForInk(colors.good, FILL_INK) })} />
      )}
      {problems.lookTooDark && (
        <Problem text="Labels on Needs a look are hard to read on a color this dark." fix="Use a lighter shade" onFix={() => pick({ look: lightenForInk(colors.look, chrome.graphite) })} />
      )}
      {problems.tooAlike && <Problem text="Settled and Needs a look are close, so some people, including many with color blindness, may not tell them apart. Colors that differ in lightness as well as hue work best." />}
      <div className="set-actions">
        <label className="look-from">
          <span>Start from</span>
          <select className="input" value="" onChange={(e) => { const p = palettes.find((x) => x.id === e.target.value); if (p) pick({ ...p.colors }); }}>
            <option value="" disabled>A preset…</option>
            {palettes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button className="btn sm" type="button" onClick={() => pick({ ...brass.colors })}>Reset to Brass</button>
      </div>
    </div>
  );
}

function Problem({ text, fix, onFix }: { text: string; fix?: string; onFix?: () => void }) {
  return (
    <div className="callout warn look-problem" role="status">
      <span>{text}</span>
      {fix && <button className="btn sm" type="button" onClick={onFix}>{fix}</button>}
    </div>
  );
}

function ColorField({ label, about, value, onChange }: { label: string; about: string; value: string; onChange: (v: string) => void }) {
  const [typed, setTyped] = useState(value);
  useEffect(() => setTyped(value), [value]);
  const commit = () => {
    const v = typed.trim().replace(/^#?/, "#");
    const full = /^#[0-9a-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v;
    if (isHex(full)) onChange(full.toUpperCase()); else setTyped(value);
  };
  const id = `look-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="look-field">
      <label htmlFor={id}><b>{label}</b><small>{about}</small></label>
      <div className="look-field-row">
        <input id={id} type="color" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <input className="input num" aria-label={`${label}, hex code`} value={typed} spellCheck={false} autoComplete="off" maxLength={7}
          onChange={(e) => setTyped(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
    </div>
  );
}
