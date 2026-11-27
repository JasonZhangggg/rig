import type { CSSProperties } from "react";
import { coveredIssues, shownAlerts, shownSummary, type HistoryPoint, type Issue, type PC, type Stat } from "@rig/core";
import { StageSlot } from "../../components/Stage";
import { Warm } from "../../components/common";
import { useAlertKindsOff, useApp, useTemp, useTempText, type Ctx } from "../../state";
import { alertIssue, bySeverity, dustIssue, issueGo, partIcon, shortType } from "../shared";
import type { OptValue, SizeName } from "./layout";
import { EmptyNote, useFit } from "./parts";
import { PartByPart } from "./PartByPart";

export const Go = () => <svg className="f-go" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Check = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17l9-10" /></svg>;
const Chip = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" /><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" strokeLinecap="round" /></svg>;
const Chat = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5z" /></svg>;

/** What a widget knows about its tile: its size name and how many grid cells it covers. */
export interface TileBox { size: SizeName; span: number; rows: number; cols: number }
export interface WidgetProps { style: string; opts: Record<string, OptValue>; box: TileBox; editing: boolean }

const on = (opts: Record<string, OptValue>, key: string) => opts[key] !== false;
/** On the grid a tile has a fixed size and its lists drop what doesn't fit; in the phone's list every item shows. */
const fixed = (box: TileBox) => box.cols > 1;

/** True once Rig has scored the PC. A new PC reports 0 with nothing behind it until its first checkup. */
export const scored = (pc: { health: number; breakdown?: unknown[] }) => pc.health > 0 || (pc.breakdown?.length ?? 0) > 0;
const offList = (opts: Record<string, OptValue>, key: string) => (Array.isArray(opts[key]) ? (opts[key] as string[]) : []);

/** Alerts and findings in the order Home shows them, with what needs a look first. */
export function useHomeIssues() {
  const { pc } = useApp();
  const off = useAlertKindsOff();
  const alerts = shownAlerts(pc.alerts, off);
  const dust = dustIssue(pc);
  const covered = coveredIssues(alerts);
  const found = (dust ? [...(pc.issues ?? []), dust] : pc.issues ?? []).filter((i) => !covered.has(i.id) && !(alerts.length && i.severity === "ok"));
  const issues = bySeverity([...alerts.map((a) => alertIssue(a)), ...found]);
  const open = issues.filter((i) => i.severity === "warn" || i.severity === "bad");
  return { issues, open, summary: shownSummary(pc, alerts) };
}

/** Opens an issue the way its row does, in the viewer's temperature unit. */
export function useOpenIssue() {
  const ctx = useApp();
  const inUnit = useTempText();
  return (i: Issue) => issueGo(i.ask ? { ...i, ask: inUnit(i.ask) } : i, ctx.pc, ctx);
}

export const checkupQuestion = (name: string) => `Give ${name} a checkup. Is anything running hotter or slower than it should?`;

// ----- Your PC -----

export interface HeroViews { heat: boolean; exploded: boolean; toggleHeat: () => void; toggleExploded: () => void }

const SPEC_PARTS = ["cpu", "gpu", "ram"];

export function PCWidget({ style, opts, editing, views, box, points }: WidgetProps & { views: HeroViews; points: HistoryPoint[] | null }) {
  if (style === "parts") return <PartByPart points={points} names={on(opts, "specs")} box={box} />;
  return <PCModel style={style} opts={opts} editing={editing} views={views} />;
}

/** The PC in 3D, its part names beside it and its temperatures large under it. */
function PCModel({ style, opts, editing, views }: Pick<WidgetProps, "style" | "opts" | "editing"> & { views: HeroViews }) {
  const { pc, set, go } = useApp();
  const temp = useTemp();
  const specs = on(opts, "specs") ? SPEC_PARTS.flatMap((id) => { const p = pc.parts?.[id]; return p ? [{ id, type: shortType(p.type), name: p.name }] : []; }) : [];
  const reads = on(opts, "reads") ? Object.entries(pc.parts ?? {}).filter(([, p]) => p.temp != null).slice(0, 4) : [];
  const open = (id: string) => { set({ selected: id, tab: "live" }); go("pc"); };
  const chips = style === "chips";
  return (
    <section className={`f-pc${reads.length && !chips ? "" : " no-reads"}${chips ? " chips" : ""}${specs.length ? "" : " no-specs"}`} aria-label={`${pc.name} in 3D`}>
      <div className="f-pc-in">
        <div className="f-pc-top">
          <div><div className="f-kicker">{pc.nickname}</div><div className="f-pc-name">{pc.name}</div></div>
          <div className="f-pc-tools">
            {on(opts, "views") && (
              <div className="f-views" role="group" aria-label="3D view">
                <button type="button" aria-pressed={views.heat} onClick={views.toggleHeat}>Heat</button>
                <button type="button" aria-pressed={views.exploded} onClick={views.toggleExploded}>Exploded</button>
              </div>
            )}
            <a className="f-link" href="#pc">Open 3D view<Go /></a>
          </div>
        </div>
        <div className="f-stage"><StageSlot id="hero-stage" zoom={false} spin={on(opts, "spin")} interactive={!editing} /></div>
        {specs.length > 0 && (
          <dl className="f-specs">
            {specs.map((p) => <div key={p.id}><dt>{p.type}</dt><dd>{p.name}</dd></div>)}
          </dl>
        )}
        {reads.length > 0 && (chips ? (
          <div className="f-chips" role="group" aria-label="Temperatures">
            {reads.map(([id, p]) => (
              <button key={id} type="button" className={`f-chip${p.warn ? " hot" : ""}`} onClick={() => open(id)}>
                <i aria-hidden="true">{partIcon[id] ?? <Chip />}</i><span>{shortType(p.type)}</span><b>{temp(p.temp, { mark: "degree" })}{p.warn && <Warm />}</b>
              </button>
            ))}
          </div>
        ) : (
          <div className="f-reads" role="group" aria-label="Temperatures">
            {reads.map(([id, p]) => (
              <button key={id} type="button" className={`f-read${p.warn ? " hot" : ""}`} onClick={() => open(id)}>
                <span>{shortType(p.type)}</span><b>{temp(p.temp, { mark: "degree" })}{p.warn && <Warm />}</b>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ----- Health -----

/** What holds the score down, in a line. The page's heading already says how the PC is doing, so this says why. */
export function healthWhy(breakdown: PC["breakdown"], fallback: string) {
  const low = (breakdown ?? []).filter((b) => b.sev !== "ok").sort((a, b) => a.value - b.value)[0];
  if (low) return `${low.label}: ${low.note}.`;
  return breakdown?.length ? "Every check passed." : fallback;
}

export function HealthWidget({ style, opts, box }: WidgetProps) {
  const { pc } = useApp();
  const { summary } = useHomeIssues();
  const ringC = 2 * Math.PI * 52;
  const known = scored(pc);
  const all = on(opts, "breakdown") && known ? pc.breakdown ?? [] : [];
  const [list, fits] = useFit<HTMLUListElement>(all.length, { on: fixed(box), min: 0, watch: style });
  const parts = all.slice(0, fits);
  const value = known ? pc.health : null;
  const label = known ? `Health ${pc.health} of 100` : "Health not scored yet";
  const text = (
    <div className="f-health-text">
      <h2>Health</h2>
      {on(opts, "summary") && <p>{known ? healthWhy(pc.breakdown, summary) : `Rig scores ${pc.name} once it has had a good look.`}</p>}
      {on(opts, "link") && <a className="f-link" href="#logs">See readings<Go /></a>}
    </div>
  );
  return (
    <section className={`f-health${known ? "" : " unscored"}`} data-style={style}>
      <div className="f-health-main">
        {style === "number" ? (
          <div className="f-hnum" role="img" aria-label={label}>
            <b>{value ?? "Soon"}</b><span>{known ? "of 100" : "Not scored yet"}</span>
            <i style={{ "--v": `${value ?? 0}%` } as CSSProperties} />
          </div>
        ) : (
          <div className="f-ring" role="img" aria-label={label}>
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" className="tr" />
              {value != null && <circle cx="60" cy="60" r="52" className="vl" strokeDasharray={`${(ringC * value) / 100} ${ringC}`} transform="rotate(-90 60 60)" />}
            </svg>
            <div aria-hidden="true">{value != null ? <><b>{value}</b><span>of 100</span></> : <span>Not scored yet</span>}</div>
          </div>
        )}
        {text}
      </div>
      {all.length > 0 && (
        <ul className="f-hparts" ref={list}>
          {parts.map((p) => (
            <li key={p.label} className={p.sev}>
              <span>{p.label}</span>
              <i aria-hidden="true"><i style={{ width: `${p.value}%` }} /></i>
              <b>{p.value}</b>
              <small>{p.note}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ----- Things to look at -----

export function TodoWidget({ style, opts, box }: WidgetProps) {
  const { pc, ask } = useApp();
  const inUnit = useTempText();
  const openIssue = useOpenIssue();
  const { issues: all, open } = useHomeIssues();
  const issues = on(opts, "worth") ? all : open;
  const [list, fits] = useFit<HTMLUListElement>(issues.length, { on: fixed(box), reserve: 40, min: 0, watch: style });
  const rest = issues.length - fits;
  return (
    <section className="f-todo" data-style={style}>
      <div className="f-todo-head"><h2>Things to look at</h2>{on(opts, "count") && open.length > 0 && <span className="f-count" aria-label={`${open.length} open`}>{open.length}</span>}</div>
      {issues.length > 0 ? (
        <ul className="f-todo-list" ref={list}>
          {issues.slice(0, fits).map((i) => (
            <li key={i.id}>
              <button type="button" className={`f-todo-row ${i.severity}`} onClick={() => openIssue(i)}>
                <i className="f-todo-ico">{i.severity === "ok" ? <Check /> : partIcon[i.part ?? ""] ?? <Check />}</i>
                <span><b>{inUnit(i.title)}</b>{style !== "compact" && <small>{inUnit(i.body)}</small>}</span>
                <i className="f-todo-go"><Arrow /></i>
              </button>
            </li>
          ))}
          {rest > 0 && (
            <li data-more="" className="f-more">
              <button type="button" className="f-link" onClick={() => ask(`What needs a look on ${pc.name} right now?`)}>{fits ? (rest === 1 ? "One more to look at" : `${rest} more to look at`) : `See all ${rest}`}<Go /></button>
            </li>
          )}
        </ul>
      ) : (
        <div className="f-todo-empty"><i className="f-todo-ico"><Check /></i><p>Nothing to look at. Rig keeps watching while you use {pc.name}.</p></div>
      )}
      {on(opts, "foot") && (
        <div className="f-todo-foot">
          <button type="button" className="f-link" onClick={() => ask(checkupQuestion(pc.name))}>Run a checkup<Go /></button>
        </div>
      )}
    </section>
  );
}

// ----- Ask Rig -----

export const questions = (name: string) => [
  `Why is ${name} loud?`,
  "What should I upgrade first?",
  `How hot is too hot for ${name}?`,
  "What slows my startup?",
  `Is ${name} ready for new games?`,
];

export function AsksWidget({ style, opts, box }: WidgetProps) {
  const { pc, ask, set } = useApp();
  const all = questions(pc.name).slice(0, Number(opts.count) || 3);
  const [list, fits] = useFit<HTMLDivElement>(all.length, { on: fixed(box), watch: `${style}${opts.box}` });
  const asks = all.slice(0, fits);
  return (
    <section className="f-asks" data-style={style} aria-labelledby="f-asks-title">
      <h2 id="f-asks-title">Ask Rig</h2>
      {opts.box === true && (
        <button type="button" className="f-askbox" onClick={() => set({ palette: true })}><Chat /><span>Ask anything about {pc.name}</span></button>
      )}
      <div className="f-asks-list" role="group" aria-label="Ask Rig" ref={list}>
        {asks.map((q) => <button key={q} type="button" onClick={() => ask(q)}>{q}<Go /></button>)}
      </div>
    </section>
  );
}

// ----- Storage -----

const size = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${Math.round(gb)} GB`);

export function StorageWidget({ style, opts, box }: WidgetProps) {
  const { pc } = useApp();
  const st = pc.storage;
  const [drives, fits] = useFit<HTMLUListElement>(st?.slices.length ?? 0, { on: fixed(box), min: 0, watch: style });
  if (!st || !st.totalGb) {
    return (
      <section className="f-store" data-style={style}>
        <div className="pl-head"><div><h2>Storage</h2></div></div>
        <EmptyNote ghost={false}>Rig hasn't read the drives yet. How full they are shows up here soon.</EmptyNote>
      </section>
    );
  }
  const free = st.slices.filter((s) => s.label === "Free").reduce((n, s) => n + s.gb, 0);
  const used = st.totalGb - free;
  const pct = Math.round((used / st.totalGb) * 100);
  const slices = st.slices.filter((s) => s.label !== "Free");
  const c = 2 * Math.PI * 44;
  const list = on(opts, "list");
  return (
    <section className="f-store" data-style={style}>
      <div className="pl-head">
        <div><h2>Storage</h2><span className="f-faint">{size(st.totalGb)} in all</span></div>
        {style !== "number" && <div className="pl-figure"><b>{pct}%</b><span>Used</span></div>}
      </div>
      {style === "ring" ? (
        <div className="f-store-ring" role="img" aria-label={`${pct}% used, ${size(free)} free`}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="44" className="tr" />
            <circle cx="50" cy="50" r="44" className="vl" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 50 50)" />
          </svg>
          <div aria-hidden="true"><b>{size(free)}</b><span>free</span></div>
        </div>
      ) : style === "number" ? (
        <div className="f-store-num"><b>{size(free)}</b><span>free of {size(st.totalGb)}</span></div>
      ) : (
        <div className="f-store-bar" role="img" aria-label={`${pct}% used, ${size(free)} free`}>
          {slices.map((s, i) => <i key={s.label} className={i ? "more" : undefined} style={{ flexGrow: s.gb }} />)}
          {free > 0 && <i className="free" style={{ flexGrow: free }} />}
        </div>
      )}
      {style === "bar" && <div className="f-store-free" aria-hidden="true"><b>{size(free)}</b><span>free of {size(st.totalGb)}</span></div>}
      {list && (
        <ul className="f-store-list" ref={drives}>
          {st.slices.slice(0, fits).map((s) => <li key={s.label} className={s.label === "Free" ? "free" : undefined}><span>{s.label}</span><b>{size(s.gb)}</b></li>)}
        </ul>
      )}
    </section>
  );
}

// ----- Right now -----

/** A reading's share of its scale: a percentage as is, a temperature against its part's safe limit. */
function share(s: Stat, limits: { CPU?: number; GPU?: number }) {
  if (s.unit === "%") return s.value / 100;
  const limit = limits[s.label as "CPU" | "GPU"];
  return limit ? s.value / limit : null;
}

export function LiveWidget({ style, opts, box }: WidgetProps) {
  const { pc } = useApp();
  const temp = useTemp();
  const off = offList(opts, "off");
  const all = (pc.stats ?? []).filter((s) => !off.includes(s.label));
  const [list, fits] = useFit<HTMLUListElement>(all.length, { on: fixed(box), watch: `${style}${on(opts, "notes")}` });
  const stats = all.slice(0, fits);
  const limits = { CPU: pc.parts?.cpu?.limit, GPU: pc.parts?.gpu?.limit };
  const value = (s: Stat) => (s.unit === "°C" ? temp(s.value, { mark: "degree" }) : `${s.value}${s.unit}`);
  return (
    <section className="f-live" data-style={style}>
      <div className="pl-head"><div><h2>Right now</h2><span className="f-faint">{pc.online ? "Live from " + pc.name : "Last readings from " + pc.name}</span></div></div>
      {stats.length ? (
        <ul className="f-live-list" ref={list}>
          {stats.map((s) => {
            const f = share(s, limits);
            return (
              <li key={s.label} className={s.warn ? "hot" : undefined}>
                <span>{s.label}</span>
                <b>{value(s)}{s.warn && <Warm />}</b>
                {style === "meters" && f != null && <i className="f-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, f * 100)}%` }} /></i>}
                {on(opts, "notes") && s.note && <small>{s.note}</small>}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyNote ghost={false}>{pc.stats?.length ? "Every reading is switched off. Turn some back on in this widget's options." : `Live readings show up here once ${pc.name} reports them.`}</EmptyNote>
      )}
    </section>
  );
}

// ----- Parts -----

export function PartsWidget({ style, opts, box }: WidgetProps) {
  const { pc, set, go } = useApp();
  const temp = useTemp();
  const off = offList(opts, "off");
  const found = Object.entries(pc.parts ?? {});
  const parts = found.filter(([id]) => !off.includes(id));
  const [list, fits] = useFit<HTMLUListElement>(parts.length, { on: fixed(box), reserve: 44, watch: `${style}${on(opts, "temps")}` });
  const rest = parts.length - fits;
  return (
    <section className="f-parts" data-style={style}>
      <div className="pl-head"><div><h2>Parts</h2>{parts.length > 0 && <span className="f-faint">{parts.length} {parts.length === 1 ? "part" : "parts"} in {pc.name}</span>}</div></div>
      {parts.length ? (
        <ul className="f-parts-list" ref={list}>
          {parts.slice(0, fits).map(([id, p]) => (
            <li key={id}>
              <button type="button" onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
                <i aria-hidden="true">{partIcon[id] ?? <Chip />}</i>
                <span><small>{shortType(p.type)}</small><b>{p.name}</b></span>
                {on(opts, "temps") && p.temp != null && <em className={p.warn ? "hot" : undefined}>{temp(p.temp, { mark: "degree" })}</em>}
              </button>
            </li>
          ))}
          {rest > 0 && (
            <li data-more="" className="f-more">
              <a className="f-link" href="#pc">{`See all ${parts.length} parts`}<Go /></a>
            </li>
          )}
        </ul>
      ) : (
        <EmptyNote ghost={false}>{found.length ? "Every part is switched off. Turn some back on in this widget's options." : `Rig lists each part here once it has had a look inside ${pc.name}.`}</EmptyNote>
      )}
    </section>
  );
}

/** The labels a "set" option picks from, read from the PC. */
export function sourceItems(source: "fans" | "stats" | "parts", ctx: Pick<Ctx, "pc">): [string, string][] {
  const { pc } = ctx;
  if (source === "fans") return (pc.fans ?? []).map((f) => [f.label, f.label]);
  if (source === "stats") return (pc.stats ?? []).map((s) => [s.label, s.label]);
  return Object.entries(pc.parts ?? {}).map(([id, p]) => [id, shortType(p.type)]);
}
