import { useMemo } from "react";
import { StageSlot } from "../../components/Stage";
import { useApp } from "../../state";
import { issueGo, partIcon, shortType } from "./shared";
import {
  Arrow, CapsuleChart, CapsuleTimeline, Check, DotMatrix, Legend, Sparkline2, Stat,
  fanColumns, fanStats, healthSeries, healthStats, tempLabels, useGrowOnce, weekSessions, weekTemps,
} from "./pulse-parts";

const Caret = () => <svg className="pl-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const rangeName = { "24h": "Day", "7d": "Week", "30d": "Month" } as const;
const nextRange = { "24h": "7d", "7d": "30d", "30d": "24h" } as const;

export function PulseHome() {
  const { ui, pc, set, go, toast } = useApp();
  const issues = pc.issues ?? [];
  const open = issues.filter((i) => i.severity !== "ok");
  const top = issues.find((i) => i.severity === "warn") ?? issues[0];
  const mine = Object.values(ui.pcs).filter((x) => x.parts);
  const parts = Object.entries(pc.parts ?? {}).filter(([, p]) => p.temp !== undefined).slice(0, 4);
  const series = useMemo(healthSeries, []);
  const fans = useMemo(() => fanColumns(16), []);
  const days = weekTemps(pc);
  const sessions = weekSessions(pc);
  const labels = tempLabels(pc);
  const peak = Math.max(...days.map((d) => d.peak));
  const total = sessions.filter((s) => s.kind !== "background").reduce((a, s) => a + s.hours, 0);
  const growCaps = useGrowOnce("pulse-caps");
  const growTl = useGrowOnce("pulse-tl");

  const cycleRange = () => {
    const r = nextRange[ui.range];
    set({ range: r });
    if (r !== "7d") toast(`Showing ${rangeName[r].toLowerCase()}. This mockup only has a week of sample data.`);
  };
  const cyclePC = () => {
    const i = mine.findIndex((x) => x.id === pc.id);
    set({ pcId: mine[(i + 1) % mine.length].id, selected: null });
  };

  return (
    <div className="page pl-home">
      <header className="page-head pl-head">
        <div><h1>{pc.name}</h1><p className="sub">{pc.nickname}. {pc.summary}</p></div>
        <div className="pl-filters">
          <button type="button" className="pl-filter" onClick={cycleRange}><span>Range:</span> <b>{rangeName[ui.range]}</b><Caret /></button>
          <button type="button" className="pl-filter" onClick={cyclePC}><span>PC:</span> <b>{pc.name}</b><Caret /></button>
          {top && (
            <button type="button" className="pl-cta" onClick={() => issueGo(top, pc, set, go)}>
              {top.severity === "warn" ? "Fix what needs a look" : "See what's new"}
              {open.length > 0 && <em>{open.length}</em>}
            </button>
          )}
        </div>
      </header>

      <div className="pl-grid">
        <section className="pl-card pl-health">
          <div className="pl-card-head"><h2>Health</h2><a className="pl-go" href="#history" aria-label="Temperature history"><Arrow /></a></div>
          <div className="pl-score"><b>{pc.health}</b><span>of 100</span></div>
          <div className="pl-stats">{healthStats(pc).map((s) => <Stat key={s.label} {...s} />)}</div>
          <Sparkline2 a={series.cpu} b={series.gpu} label="Processor and graphics card temperature over the week. Both rise every evening." />
        </section>

        <section className="pl-card pl-fans">
          <div className="pl-card-head"><h2>Fans</h2><a className="pl-go" href="#pc" aria-label="Fans in 3D"><Arrow /></a></div>
          <div className="pl-stats">{fanStats(pc).map((s) => <Stat key={s.label} {...s} />)}</div>
          <DotMatrix values={fans} label="Fan speed over the last four days, every six hours. Fastest in the evenings." />
        </section>

        <section className="pl-card pl-pc">
          <StageSlot id="hero-stage" zoom={false} spin />
          <div className="pl-pc-top">
            <div><div className="pl-kicker">{pc.nickname}</div><h2 className="pl-pc-name">{pc.name}</h2></div>
            <a className="pl-go solid" href="#pc" aria-label="Open 3D view"><Arrow /></a>
          </div>
          <div className="pl-chips">
            {parts.map(([id, p]) => (
              <button key={id} type="button" className={`pl-chip${p.warn ? " hot" : ""}`} onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
                <i>{partIcon[id]}</i>{shortType(p.type)}<b>{p.temp}°</b>
              </button>
            ))}
          </div>
        </section>

        <section className="pl-card pl-temps">
          <div className="pl-card-head"><div><h2>Temperatures</h2><p className="pl-sub">Every day this week, °C</p></div><a className="pl-go" href="#history" aria-label="Temperature history"><Arrow /></a></div>
          <CapsuleChart days={days} grow={growCaps} label={`${labels.peak} went from ${days[0].peak}°C on ${days[0].d} to ${days[days.length - 1].peak}°C on ${days[days.length - 1].d}.`} />
          <Legend items={[["c", labels.idle], ["a", labels.typical], ["b", labels.peak]]} total={["Peak", `${peak}°C`]} />
        </section>

        <section className="pl-card pl-week">
          <div className="pl-card-head"><div><h2>This week</h2><p className="pl-sub">{pc.kind === "laptop" ? "Busy sessions" : "Gaming sessions"}, hours after 6 PM</p></div><a className="pl-go" href={pc.kind === "laptop" ? "#history" : "#games"} aria-label={pc.kind === "laptop" ? "Temperature history" : "Games"}><Arrow /></a></div>
          <CapsuleTimeline rows={sessions} grow={growTl} />
          <Legend items={[["a", pc.kind === "laptop" ? "Normal" : "Played"], ["b", "Ran hot"], ["c", "Background task"]]} total={["Total", `${total} h`]} />
        </section>

        <section className="pl-card pl-needs">
          <div className="pl-card-head"><h2>Needs a look</h2>{open.length > 0 && <span className="pl-count">{open.length}</span>}</div>
          <div className="pl-issues">
            {issues.map((i) => (
              <button key={i.id} type="button" className={`pl-issue ${i.severity}`} onClick={() => issueGo(i, pc, set, go)}>
                <i className="pl-issue-ico">{i.severity === "ok" ? <Check /> : partIcon[i.part ?? ""] ?? <Check />}</i>
                <span className="pl-issue-txt"><b>{i.title}</b><small>{i.body}</small></span>
                <span className="pl-issue-go" aria-hidden="true"><Arrow /></span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
