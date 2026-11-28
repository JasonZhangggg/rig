// Home widgets for the rest of Rig: the live chart, drive health, Changes, Windows events, games, upgrades, drivers,
// logs and manuals. Each is a list of hairline rows under a heading, opening its page when a row is pressed.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { eventKinds, graphicsWord, eventTitle, gameLibrary, insightContext, isActive, safetyRows, safetySummary, type Game, type HistoryPoint, type Manual, type PCEvent, type RecordingInfo, type Severity } from "@rig/core";
import { useActions, useApp, useData, useHistory, useMachineWord, useTemp } from "../../state";
import { useEvents } from "../Logs";
import { ago, hours } from "../games/words";
import { serious } from "../logs/summary";
import { safetyHead } from "../safety/SafetyTab";
import { stateWord, whenRan } from "../logs/words";
import { shortType } from "../shared";
import { useUpgrades } from "../upgrades/PCUpgrades";
import type { OptValue } from "./layout";
import { EmptyNote, useFit } from "./parts";
import { Go, type WidgetProps } from "./widgets";

const on = (opts: Record<string, OptValue>, key: string) => opts[key] !== false;
const fixed = (props: WidgetProps) => props.box.cols > 1;

// ----- Shared pieces -----

function Head({ title, sub, figure, word, look }: { title: string; sub?: ReactNode; figure?: ReactNode; word?: string; look?: boolean }) {
  return (
    <div className="pl-head">
      <div><h2>{title}</h2>{sub && <span className="f-faint">{sub}</span>}</div>
      {figure != null && <div className={`pl-figure${look ? " look" : ""}`}><b>{figure}</b><span>{word}</span></div>}
    </div>
  );
}

export interface Line {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  /** A short figure or word on the right. */
  value?: ReactNode;
  sev?: Severity;
  /** A share from 0 to 1, drawn as a thin bar under the row. */
  meter?: number;
  onClick: () => void;
}

/** Rows with a hairline between them. The tile shows as many as fit and a link to the rest. */
function RowList({ lines, fit, watch, more, onMore }: { lines: Line[]; fit: boolean; watch: string; more: (rest: number) => string; onMore: () => void }) {
  const [list, fits] = useFit<HTMLUListElement>(lines.length, { on: fit, reserve: 36, min: 0, watch });
  const rest = lines.length - fits;
  return (
    <ul className="f-rows" ref={list}>
      {lines.slice(0, fits).map((l) => (
        <li key={l.key}>
          <button type="button" data-sev={l.sev} onClick={l.onClick}>
            <span className="f-rows-main">
              <b>{l.sev && l.sev !== "ok" && <i className="f-dot" aria-hidden="true" />}<span>{l.title}</span></b>
              {l.meta && <small>{l.meta}</small>}
              {l.meter != null && <i className="f-rows-meter" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, l.meter * 100))}%` }} /></i>}
            </span>
            {l.value != null && <em>{l.value}</em>}
          </button>
        </li>
      ))}
      {rest > 0 && (
        <li data-more="" className="f-more">
          <button type="button" className="f-link" onClick={onMore}>{more(rest)}<Go /></button>
        </li>
      )}
    </ul>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ----- Last hour -----

type Point = HistoryPoint;
type Series = { key: "cpu" | "gpu"; label: string; pick: (p: Point) => number | null | undefined };

/** `gpu`: the graphics part's name, "Graphics" on a laptop. */
const seriesOf = (gpu: string): Record<string, Series[]> => ({
  temps: [{ key: "cpu", label: "Processor", pick: (p) => p.cpu }, { key: "gpu", label: gpu, pick: (p) => p.gpu }],
  load: [{ key: "cpu", label: "Processor", pick: (p) => p.cpuLoad }, { key: "gpu", label: gpu, pick: (p) => p.gpuLoad }],
});

/** A path through the points, scaled to a 100 by 40 box. */
function pathOf(points: Point[], pick: Series["pick"], from: number, span: number, lo: number, hi: number) {
  let d = "";
  let pen = false;
  for (const p of points) {
    const v = pick(p);
    if (v == null) { pen = false; continue; }
    const x = ((p.t - from) / span) * 100, y = 40 - ((v - lo) / (hi - lo || 1)) * 40;
    d += `${pen ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    pen = true;
  }
  return d;
}

export function TrendWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { pc } = useApp();
  const { live } = useData("live");
  const past = useHistory("24h");
  const temp = useTemp();
  const minutes = Number(opts.span) || 60;
  const load = style === "load";
  const series = seriesOf(graphicsWord(pc.kind))[load ? "load" : "temps"].filter((s) => on(opts, s.key));
  const last = live[live.length - 1];
  const to = last?.t ?? Date.now(), from = to - minutes * 60_000;
  // The recorded history fills the stretch before Rig opened, so the chart isn't empty for its first hour.
  const firstLive = live[0]?.t ?? Infinity;
  const shown: Point[] = [...(past ?? []).filter((p) => p.t >= from && p.t < firstLive), ...live.filter((p) => p.t >= from)];
  const values = shown.flatMap((p) => series.map((s) => s.pick(p)).filter((v): v is number => v != null));
  const lo = load ? 0 : Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  const hi = load ? 100 : Math.ceil((Math.max(...values) + 5) / 10) * 10;
  const now = last ?? shown[shown.length - 1];
  const fmt = (v: number | null | undefined) => (v == null ? "No reading" : load ? `${Math.round(v)}%` : temp(v, { mark: "degree" }));
  const sub = `${load ? "Load" : "Temperatures"}, last ${minutes === 60 ? "hour" : `${minutes} minutes`}`;
  const enough = shown.length > 1 && values.length > 1 && series.length > 0;
  return (
    <section className="f-trend" data-style={style}>
      <Head title="Last hour" sub={sub} />
      {enough ? (
        <>
          <div className="f-trend-chart" role="img" aria-label={series.map((s) => `${s.label} ${fmt(s.pick(now))}`).join(", ")}>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2="100" y1="20" y2="20" className="grid" />
              {series.map((s) => <path key={s.key} d={pathOf(shown, s.pick, from, to - from, lo, hi)} className={`ln ${s.key}`} />)}
            </svg>
            <span className="f-trend-hi" aria-hidden="true">{fmt(hi)}</span>
            <span className="f-trend-lo" aria-hidden="true">{fmt(lo)}</span>
          </div>
          {on(opts, "legend") && (
            <ul className="f-trend-key">
              {series.map((s) => <li key={s.key} className={s.key}><i aria-hidden="true" /><span>{s.label}</span><b>{fmt(s.pick(now))}</b></li>)}
            </ul>
          )}
        </>
      ) : (
        <EmptyNote ghost={false}>{!series.length ? "Both lines are switched off. Turn one back on in this widget's options." : pc.online ? "The chart fills in over the next few minutes while Rig is open." : `${pc.name} is offline. The chart picks up when it's back.`}</EmptyNote>
      )}
      <a className="f-link" href="#logs">See every reading<Go /></a>
    </section>
  );
}

// ----- Drive health -----

const size = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${Math.round(gb)} GB`);

export function DrivesWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { pc, set, go } = useApp();
  const temp = useTemp();
  const drives = (pc.drives ?? []).filter((d) => d.media !== "unknown" || d.lifeLeft != null || d.sizeGb > 0).filter((d) => d.model !== "Other drives");
  const open = () => { set({ selected: "ssd", tab: "drives" }); go("pc"); };
  const worst = drives.find((d) => d.health.sev === "bad") ?? drives.find((d) => d.health.sev === "warn");
  const lines: Line[] = drives.map((d) => {
    const bits = [d.health.text];
    if (on(opts, "free") && d.freeGb != null) bits.push(`${size(d.freeGb)} free`);
    return {
      key: d.model + d.volumes.join(),
      title: d.model,
      meta: bits.join(" · "),
      value: style === "meters" && d.lifeLeft != null ? `${d.lifeLeft}% left` : on(opts, "temps") && d.temp != null ? temp(d.temp, { mark: "degree" }) : d.lifeLeft != null ? `${d.lifeLeft}% left` : undefined,
      sev: d.health.sev,
      meter: style === "meters" && d.lifeLeft != null ? d.lifeLeft / 100 : undefined,
      onClick: open,
    };
  });
  return (
    <section className="f-list" data-style={style}>
      <Head title="Drive health" sub={drives.length ? (worst ? worst.health.text : `${plural(drives.length, "drive")}, all healthy`) : undefined} />
      {lines.length ? (
        <RowList lines={lines} fit={fixed(props)} watch={`${style}${opts.temps}${opts.free}`} more={(n) => `${plural(n, "more drive")}`} onMore={open} />
      ) : (
        <EmptyNote ghost={false}>Rig hasn't read the drives yet. How each one is holding up shows here soon.</EmptyNote>
      )}
    </section>
  );
}

// ----- Changes -----

export function ChangesWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { go } = useApp();
  const { changes, unseenChanges } = useData("changes", "unseenChanges");
  const list = on(opts, "undone") ? changes : changes.filter((c) => c.status === "applied");
  const week = changes.filter((c) => Date.now() - Date.parse(c.at) < 7 * 864e5).length;
  const open = () => go("changes");
  const lines: Line[] = list.map((c) => ({
    key: c.id,
    title: c.title,
    meta: [ago(Date.parse(c.at)), on(opts, "who") ? (c.by === "you" ? "by you" : "by Rig") : null].filter(Boolean).join(" · "),
    value: c.status === "applied" ? "On" : "Undone",
    onClick: open,
  }));
  const sub = unseenChanges ? `${plural(unseenChanges, "new change")} since you last looked` : changes.length ? "Each one can be undone" : undefined;
  return (
    <section className="f-list" data-style={style}>
      <Head title="Changes" sub={sub} figure={style !== "count" && changes.length ? week : undefined} word="This week" />
      {style === "count" && changes.length > 0 && (
        <div className="f-bignum"><b>{week}</b><span>{week === 1 ? "change this week" : "changes this week"}</span></div>
      )}
      {lines.length ? (
        <RowList lines={style === "count" ? lines.slice(0, 1) : lines} fit={fixed(props)} watch={`${style}${opts.undone}${opts.who}`} more={(n) => `${n} more`} onMore={open} />
      ) : (
        <EmptyNote ghost={false}>{changes.length ? "Every change is undone. Switch on undone changes in this widget's options to see them." : "No changes yet. When Rig changes a setting for you, it shows here with a way to undo it."}</EmptyNote>
      )}
    </section>
  );
}

// ----- Windows events -----

const KIND_ORDER = eventKinds.map((k) => k.kind);

export function EventsWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { go } = useApp();
  const events = useEvents();
  const days = Number(opts.days) || 7;
  const since = Date.now() - days * 864e5;
  const installs = opts.installs === true;
  const kept = (events ?? []).filter((e) => e.t >= since && (serious(e) || (installs && e.kind === "change")));
  const problems = kept.filter((e) => e.kind !== "change");
  const span = days === 1 ? "the last 24 hours" : `the last ${days} days`;
  const open = () => go("events");
  let lines: Line[];
  if (style === "latest") {
    lines = [...kept].sort((a, b) => b.t - a.t).map((e: PCEvent, i) => ({
      key: `${e.t}-${i}`,
      title: eventTitle(e),
      meta: `${ago(e.t)} · ${eventKinds.find((k) => k.kind === e.kind)?.one ?? "Windows error"}`,
      sev: e.kind === "change" ? undefined : e.level === "critical" || e.kind === "crash" || e.kind === "shutdown" ? "bad" : "warn",
      onClick: open,
    }));
  } else {
    const counts = new Map<string, PCEvent[]>();
    for (const e of kept) counts.set(e.kind, [...(counts.get(e.kind) ?? []), e]);
    lines = [...counts.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0] as PCEvent["kind"]) - KIND_ORDER.indexOf(b[0] as PCEvent["kind"])).map(([kind, list]) => {
      const newest = list.reduce((m, e) => (e.t > m.t ? e : m));
      return {
        key: kind,
        title: eventKinds.find((k) => k.kind === kind)?.label ?? kind,
        meta: `Latest ${ago(newest.t)}`,
        value: list.length,
        sev: kind === "change" ? undefined : kind === "crash" || kind === "shutdown" || kind === "hardware" ? "bad" : "warn",
        onClick: open,
      };
    });
  }
  return (
    <section className="f-list" data-style={style}>
      <Head title="Windows events" sub={events ? (problems.length ? `In ${span}` : undefined) : "Reading the event log"} figure={problems.length || undefined} word={problems.length === 1 ? "Problem" : "Problems"} look={problems.length > 0} />
      {events && lines.length ? (
        <RowList lines={lines} fit={fixed(props)} watch={`${style}${days}${installs}`} more={(n) => `${n} more`} onMore={open} />
      ) : events ? (
        <EmptyNote ghost={false}>No crashes, driver resets or errors in {span}.</EmptyNote>
      ) : null}
      {!lines.length && <a className="f-link" href="#events">Open events<Go /></a>}
    </section>
  );
}

// ----- Games -----

/** Frame rates Rig measured, by game name. */
function useFrameRates(want: boolean) {
  const { client } = useActions();
  const { pc } = useApp();
  const [games, setGames] = useState<Map<string, Game>>(new Map());
  useEffect(() => {
    if (!want) return;
    let live = true;
    client.games(pc.id).then((list) => live && setGames(new Map(list.filter((g) => g.now).map((g) => [g.name.toLowerCase(), g])))).catch(() => undefined);
    return () => { live = false; };
  }, [client, pc.id, want]);
  return games;
}

export function GamesWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { pc, go } = useApp();
  const temp = useTemp();
  const range = opts.range === "30d" ? "30d" : "7d";
  const points = useHistory(range);
  const { kind } = pc;
  const cpu = pc.parts?.cpu?.limit, gpu = pc.parts?.gpu?.limit;
  const lib = useMemo(() => (points ? gameLibrary(points, insightContext({ kind, parts: { cpu: { limit: cpu }, gpu: { limit: gpu } } })) : null), [points, kind, cpu, gpu]);
  const rates = useFrameRates(on(opts, "fps"));
  const when = range === "7d" ? "this week" : "this month";
  const open = () => go("games");
  const games = lib?.games ?? [];
  const lines: Line[] = games.map((g) => {
    const fps = on(opts, "fps") ? rates.get(g.name.toLowerCase())?.now : undefined;
    const meta = [`${hours(g.hours)}`, `played ${ago(g.lastPlayed)}`, fps ? `${fps.avg} fps` : null].filter(Boolean).join(" · ");
    const near = g.notes.some((n) => n.kind === "near-limit");
    return { key: g.name, title: g.name, meta, value: on(opts, "temps") && g.peak != null ? temp(g.peak, { mark: "degree" }) : undefined, sev: near ? "warn" : undefined, onClick: open };
  });
  const top = games[0];
  return (
    <section className="f-list" data-style={style}>
      <Head title="Games" sub={lib ? (games.length ? "Hours and the hottest moment" : undefined) : "Reading the history"} figure={games.length ? hours(lib!.hours) : undefined} word={when === "this week" ? "This week" : "This month"} />
      {style === "top" && top && (
        <div className="f-pick-main"><b>{top.name}</b><span>Most played {when}, {hours(top.hours)}</span></div>
      )}
      {lines.length ? (
        <RowList lines={style === "top" ? lines.slice(1) : lines} fit={fixed(props)} watch={`${style}${range}${opts.temps}${opts.fps}`} more={(n) => `${plural(n, "more game")}`} onMore={open} />
      ) : lib ? (
        <EmptyNote ghost={false}>No games {when}. Rig notes each game you play while it's open.</EmptyNote>
      ) : null}
    </section>
  );
}

// ----- Next upgrade -----

const fitWords = { fits: "Fits as it is", check: "Check your model first", no: "Can't be upgraded", later: "Not needed yet" } as const;

export function UpgradeWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { pc, go, ask } = useApp();
  const { list, failed, pick } = useUpgrades();
  const open = () => go("upgrades");
  const ideas = list ?? [];
  if (style === "list" || !pick) {
    const lines: Line[] = ideas.map((u) => ({
      key: u.title,
      title: u.title,
      meta: [fitWords[u.fit], on(opts, "why") ? u.gain : null].filter(Boolean).join(" · "),
      value: on(opts, "price") && u.price ? u.price : undefined,
      sev: pick?.idea.title === u.title && pick.pressing ? "warn" : undefined,
      onClick: open,
    }));
    return (
      <section className="f-list" data-style={style}>
        <Head title={style === "list" ? "Upgrades" : "Next upgrade"} sub={list ? (ideas.length ? `${plural(ideas.length, "idea")} for ${pc.name}` : undefined) : "Looking at the parts"} />
        {lines.length ? (
          <RowList lines={lines} fit={fixed(props)} watch={`${style}${opts.why}${opts.price}`} more={(n) => `${n} more`} onMore={open} />
        ) : list ? (
          <EmptyNote ghost={false}>{failed ? "Rig couldn't look up upgrades right now. Open Upgrades to try again." : `Nothing worth upgrading on ${pc.name} right now.`}</EmptyNote>
        ) : null}
        <a className="f-link" href="#upgrades">See upgrades<Go /></a>
      </section>
    );
  }
  const u = pick.idea;
  return (
    <section className="f-list f-pick" data-style={style}>
      <Head title="Next upgrade" sub={u.part} />
      <div className="f-pick-main">
        <b>{u.title}</b>
        <span>{u.gain}</span>
        {on(opts, "why") && pick.why && <small>{pick.why}</small>}
      </div>
      <dl className="f-pick-facts">
        <div><dt>Fit</dt><dd>{fitWords[u.fit]}</dd></div>
        {on(opts, "price") && u.price && <div><dt>Price</dt><dd>{u.price}</dd></div>}
      </dl>
      <div className="f-pick-links">
        <button type="button" className="f-link" onClick={open}>See upgrades<Go /></button>
        {!u.price && <button type="button" className="f-link" onClick={() => ask(`${u.title}: what exactly should I buy for ${pc.name}, and will it fit?`)}>Ask what to buy<Go /></button>}
      </div>
    </section>
  );
}

// ----- Drivers -----

export function DriversWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { pc, set, go, ask } = useApp();
  const found = Object.entries(pc.parts ?? {}).filter(([, p]) => p.driver);
  const lines: Line[] = found.map(([id, p]) => {
    const d = p.driver!;
    const newer = d.latest && d.latest !== d.installed;
    return {
      key: id,
      title: d.installed,
      meta: [shortType(p.type), on(opts, "dates") && d.note ? d.note.replace(/\.$/, "") : null].filter(Boolean).join(" · "),
      value: newer ? "Newer one out" : undefined,
      sev: newer ? "warn" : undefined,
      onClick: () => { set({ selected: id, tab: "drivers" }); go("pc"); },
    };
  });
  const question = `Are my drivers and BIOS up to date on ${pc.name}? I have ${found.map(([, p]) => p.driver!.installed).join(" and ")}.`;
  return (
    <section className="f-list" data-style={style}>
      <Head title="Drivers" sub={found.length ? "Rig never installs drivers by itself" : undefined} />
      {lines.length ? (
        <RowList lines={lines} fit={fixed(props)} watch={`${style}${opts.dates}`} more={(n) => `${n} more`} onMore={() => go("pc")} />
      ) : (
        <EmptyNote ghost={false}>Rig shows the graphics driver and BIOS versions here once it has read them.</EmptyNote>
      )}
      {on(opts, "ask") && found.length > 0 && <button type="button" className="f-link" onClick={() => ask(question)}>Check for updates<Go /></button>}
    </section>
  );
}

// ----- Safe and up to date -----

export function SafetyWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { pc, go } = useApp();
  const now = Date.now();
  const rows = safetyRows(pc.security, now, pc.kind);
  const summary = safetySummary(rows);
  const lines: Line[] = rows.map((r) => ({
    key: r.id, title: r.title, meta: r.line,
    sev: r.state === "look" ? "warn" : undefined,
    onClick: () => go("safety"),
  }));
  return (
    <section className="f-list" data-style={style}>
      <Head title="Safe and up to date" sub={on(opts, "age") ? safetyHead(pc.security?.readAt, summary, now) : summary} />
      <RowList lines={lines} fit={fixed(props)} watch={`${style}${opts.age}`} more={(n) => `${n} more`} onMore={() => go("safety")} />
    </section>
  );
}

// ----- Logs -----

export function LogsWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { openRecording } = useActions();
  const { recordings } = useData("recordings");
  const list = opts.daily === true ? recordings : recordings.filter((r) => !r.background);
  const running = list.find((r) => r.state === "recording");
  const word = useMachineWord();
  const now = Date.now();
  const lines: Line[] = list.map((r: RecordingInfo) => {
    const share = r.state === "recording" && r.startedAt && r.endsAt ? (now - r.startedAt) / (r.endsAt - r.startedAt) : undefined;
    const found = on(opts, "found") && style !== "compact" && r.headline ? r.headline : null;
    return {
      key: r.id,
      title: r.reason,
      meta: found ?? whenRan(r),
      value: isActive(r) || r.state !== "done" ? stateWord[r.state] : undefined,
      sev: r.state === "failed" ? "warn" : undefined,
      meter: share,
      onClick: () => openRecording(r.id),
    };
  });
  return (
    <section className="f-list" data-style={style}>
      <Head title="Logs" sub={running ? "Recording now" : list.length ? `${plural(list.length, "log")} on this ${word}` : undefined} />
      {lines.length ? (
        <RowList lines={lines} fit={fixed(props)} watch={`${style}${opts.daily}${opts.found}`} more={(n) => `${n} more`} onMore={() => { location.hash = "logs"; }} />
      ) : (
        <EmptyNote ghost={false}>No logs yet. Ask Rig to watch while you play, and the log shows up here.</EmptyNote>
      )}
      {!lines.length && <a className="f-link" href="#logs">Open Logs<Go /></a>}
    </section>
  );
}

// ----- Manuals -----

export function ManualsWidget(props: WidgetProps) {
  const { style, opts } = props;
  const { client } = useActions();
  const { pc, set, go } = useApp();
  const [manuals, setManuals] = useState<Manual[] | null>(null);
  useEffect(() => {
    let live = true;
    client.manuals(pc.id).then((m) => live && setManuals(m)).catch(() => live && setManuals([]));
    return () => { live = false; };
  }, [client, pc.id]);
  const lines: Line[] = (manuals ?? []).map((m) => {
    const part = pc.parts?.[m.part];
    return {
      key: m.id,
      title: `${m.maker} ${m.model}`,
      meta: [part ? shortType(part.type) : null, on(opts, "pages") && m.pageCount ? plural(m.pageCount, "page") : null].filter(Boolean).join(" · ") || undefined,
      onClick: () => { if (part) set({ selected: m.part, tab: "manual" }); go(part ? "pc" : "manuals"); },
    };
  });
  return (
    <section className="f-list" data-style={style}>
      <Head title="Manuals" sub={manuals ? (manuals.length ? "Ask Rig about any page" : undefined) : "Looking for manuals"} />
      {lines.length ? (
        <RowList lines={lines} fit={fixed(props)} watch={`${style}${opts.pages}`} more={(n) => `${n} more`} onMore={() => go("manuals")} />
      ) : manuals ? (
        <EmptyNote ghost={false}>Rig looks up the manuals for your motherboard and graphics card. They show up here once found.</EmptyNote>
      ) : null}
    </section>
  );
}
