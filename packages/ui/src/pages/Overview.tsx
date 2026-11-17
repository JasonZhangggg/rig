import { useEffect, useMemo, useState } from "react";
import { coveredIssues, fanTrend, insightContext, seenLabel, shownAlerts, shownSummary, weekEvenings, weekTemps, type HistoryPoint, type Issue, type PC } from "@rig/core";
import { StageSlot, getStage } from "../components/Stage";
import { useAlertKindsOff, useApp, useHistory, useTemp, useTempText } from "../state";
import { FansCard } from "./overview/FansCard";
import { TempsCard } from "./overview/TempsCard";
import { WeekCard } from "./overview/WeekCard";
import { alertIssue, bySeverity, dustIssue, firstName, greeting, issueGo, shortType } from "./shared";

const Go = () => <svg className="f-go" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const SPEC_PARTS = ["cpu", "gpu", "ram"];

/** The parts named beside the PC: the three that define it, then any other part reporting a temperature. */
function mainParts(pc: PC) {
  const all = pc.parts ?? {};
  const ids = [...SPEC_PARTS.filter((id) => all[id]), ...Object.keys(all).filter((id) => !SPEC_PARTS.includes(id) && all[id].temp != null)];
  return ids.slice(0, 5).map((id) => ({ id, type: shortType(all[id].type), name: all[id].name, temp: all[id].temp, warn: all[id].warn }));
}

/** Heat and exploded views for the hero. They belong to this page, so leaving it puts the shared scene back. */
function useHeroViews() {
  const [heat, setHeat] = useState(false);
  const [exploded, setExploded] = useState(false);
  useEffect(() => { getStage().scene.setHeat(heat); }, [heat]);
  useEffect(() => { getStage().scene.setExploded(exploded); }, [exploded]);
  useEffect(() => () => { const { scene } = getStage(); scene.setHeat(false); scene.setExploded(false); }, []);
  return { heat, exploded, toggleHeat: () => setHeat((v) => !v), toggleExploded: () => setExploded((v) => !v) };
}

/** The home charts from the last week of history, in the viewer's local days. Null while history loads. */
function useWeekInsights(pc: PC, points: HistoryPoint[] | null) {
  // The PC object is replaced on every live reading, so the memo keys on the fields the charts read.
  const { kind } = pc;
  const cpu = pc.parts?.cpu?.limit, gpu = pc.parts?.gpu?.limit;
  return useMemo(() => {
    if (!points) return null;
    const ctx = insightContext({ kind, parts: { cpu: { limit: cpu }, gpu: { limit: gpu } } });
    return { recorded: points.length > 0, temps: weekTemps(points, ctx), evenings: weekEvenings(points, ctx), fans: fanTrend(points, ctx) };
  }, [points, kind, cpu, gpu]);
}

export function Overview() {
  const ctx = useApp();
  const { pc, data, client, set, go, ask } = ctx;
  const dust = dustIssue(pc);
  const off = useAlertKindsOff();
  const alerts = shownAlerts(pc.alerts, off);
  const summary = shownSummary(pc, alerts);
  const covered = coveredIssues(alerts);
  const found = (dust ? [...(pc.issues ?? []), dust] : pc.issues ?? []).filter((i) => !covered.has(i.id) && !(alerts.length && i.severity === "ok"));
  const issues = bySeverity([...alerts.map((a) => alertIssue(a)), ...found]);
  const open = issues.filter((i) => i.severity === "warn" || i.severity === "bad");
  const top = open[0] ?? issues[0];
  const parts = mainParts(pc);
  const views = useHeroViews();
  const name = client.kind === "demo" ? null : firstName(data.account?.name);
  const status = open.length === 0 ? "Nothing needs a look." : open.length === 1 ? "One thing needs a look." : `${open.length} things need a look.`;
  const ringC = 2 * Math.PI * 52;
  const week = useWeekInsights(pc, useHistory("7d"));
  const temp = useTemp();
  const inUnit = useTempText();
  const checkup = () => ask(`Give ${pc.name} a checkup. Is anything running hotter or slower than it should?`);
  const asks = [`Why is ${pc.name} loud?`, "What should I upgrade first?", `How hot is too hot for ${pc.name}?`];
  const goTo = (i: Issue) => issueGo(i.ask ? { ...i, ask: inUnit(i.ask) } : i, pc, ctx);

  return (
    <div className="page f-home">
      <header className="f-head">
        <div className="f-head-text">
          <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
          <p>{pc.online ? `${pc.name} is ${pc.health >= 75 ? "running well" : "not at its best"}. ${status}` : `${pc.name} is offline. ${seenLabel(pc)}.`}</p>
        </div>
        <div className="f-head-tools">
          {top && (
            <button type="button" className="f-link" onClick={() => goTo(top)}>
              {open.length ? <>Review <em>{open.length}</em></> : "See what's new"}<Go />
            </button>
          )}
          <button type="button" className="f-link" onClick={() => set({ palette: true })}>Ask Rig<Go /></button>
        </div>
      </header>

      <div className="f-top">
        <section className="f-pc" aria-label={`${pc.name} in 3D`}>
          <div className="f-pc-in">
          <div className="f-pc-top">
            <div><div className="f-kicker">{pc.nickname}</div><div className="f-pc-name">{pc.name}</div></div>
            <div className="f-pc-tools">
              <div className="f-views" role="group" aria-label="3D view">
                <button type="button" aria-pressed={views.heat} onClick={views.toggleHeat}>Heat</button>
                <button type="button" aria-pressed={views.exploded} onClick={views.toggleExploded}>Exploded</button>
              </div>
              <a className="f-link" href="#pc">Open 3D view<Go /></a>
            </div>
          </div>
          <div className="f-stage"><StageSlot id="hero-stage" zoom={false} spin /></div>
          {parts.length > 0 && (
            <ul className="f-parts" aria-label="Main parts">
              {parts.map((p) => {
                const t = p.temp != null ? temp(p.temp, { mark: "degree" }) : null;
                return (
                  <li key={p.id} className={!t && parts.some((o) => o.temp != null) ? "plain" : undefined}>
                    <button type="button" className={`f-part${p.warn ? " hot" : ""}`} aria-label={`${p.type}, ${p.name}${t ? `, ${t}` : ""}`} onClick={() => { set({ selected: p.id, tab: "live" }); go("pc"); }}>
                      <span>{p.type}</span>{t && <b>{t}</b>}<em>{p.name}</em>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        </section>

        <div className="f-side">
          <section className="f-health tone-dark">
            <div className="f-ring">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="52" className="tr" />
                <circle cx="60" cy="60" r="52" className="vl" strokeDasharray={`${(ringC * pc.health) / 100} ${ringC}`} transform="rotate(-90 60 60)" />
              </svg>
              <div><b>{pc.health}</b><span>of 100</span></div>
            </div>
            <div className="f-health-text">
              <h2>Health</h2>
              <p>{summary}</p>
              <a className="f-link" href="#history">See history<Go /></a>
            </div>
          </section>

          <section className="f-todo">
            <div className="f-todo-head"><h2>Things to look at</h2>{open.length > 0 && <span className="f-count">{open.length} open</span>}</div>
            {issues.length > 0 ? (
              <ul className="f-todo-list">
                {issues.map((i) => (
                  <li key={i.id}>
                    <button type="button" className={`f-todo-row ${i.severity}`} onClick={() => goTo(i)}>
                      <span><b>{inUnit(i.title)}</b><small>{inUnit(i.body)}</small></span>
                      <Go />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="f-todo-empty">Nothing to look at. Rig keeps watching while you use {pc.name}.</p>
            )}
            {issues.length <= 3 && (
              <div className="f-asks" role="group" aria-label="Ask Rig">
                <span>Ask Rig</span>
                {asks.map((q) => <button key={q} type="button" onClick={() => ask(q)}>{q}<Go /></button>)}
              </div>
            )}
            <div className="f-todo-foot">
              <p>Want a fuller look at {pc.name}?</p>
              <button type="button" className="f-link" onClick={checkup}>Run a checkup<Go /></button>
            </div>
          </section>
        </div>
      </div>

      <section className="f-week" aria-labelledby="f-week-title">
        <div className="f-week-head">
          <h2 id="f-week-title">This week</h2>
          <p>The last seven days on {pc.name}</p>
        </div>
        <div className="f-trends">
          <div className="f-vitals tone-dark">
            <TempsCard temps={week?.temps ?? null} name={pc.name} />
            <FansCard fans={pc.fans} trend={week?.fans ?? null} />
          </div>
          <WeekCard week={week?.evenings ?? null} recorded={week?.recorded ?? false} name={pc.name} />
        </div>
      </section>
    </div>
  );
}
