import { useMemo } from "react";
import { fanTrend, insightContext, weekEvenings, weekTemps, type HistoryPoint, type PC } from "@rig/core";
import { StageSlot } from "../components/Stage";
import { useApp, useHistory, useTemp, useTempText } from "../state";
import { FansCard } from "./overview/FansCard";
import { TempsCard } from "./overview/TempsCard";
import { WeekCard } from "./overview/WeekCard";
import { dustIssue, greeting, issueGo, partIcon, shortType } from "./shared";

const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Check = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17l9-10" /></svg>;
const Mic = () => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
const Pulse = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;

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
  const issues = dust ? [...(pc.issues ?? []), dust] : pc.issues ?? [];
  const open = issues.filter((i) => i.severity === "warn" || i.severity === "bad");
  const top = open[0] ?? issues[0];
  const chips = Object.entries(pc.parts ?? {}).filter(([, p]) => p.temp != null).slice(0, 4);
  const name = client.kind === "demo" ? null : data.account?.name.split(" ")[0];
  const status = open.length === 0 ? "Nothing needs a look." : open.length === 1 ? "One thing needs a look." : `${open.length} things need a look.`;
  const now = new Date();
  const ringC = 2 * Math.PI * 52;
  const week = useWeekInsights(pc, useHistory("7d"));
  const temp = useTemp();
  const inUnit = useTempText();

  return (
    <div className="page f-home">
      <section className="f-band">
        <div className="f-band-left">
          <div className="f-date"><b>{now.getDate()}</b><span>{now.toLocaleDateString(undefined, { weekday: "short" })},<br />{now.toLocaleDateString(undefined, { month: "long" })}</span></div>
          {top && (
            <button type="button" className="f-cta" onClick={() => issueGo(top, pc, ctx)}>
              <span>{open.length ? "Review" : "See what's new"}</span>
              {open.length > 0 && <em>{open.length}</em>}
              <i><Arrow /></i>
            </button>
          )}
          <button type="button" className="f-round" aria-label="Run a checkup" title="Run a checkup" onClick={() => ask(`Give ${pc.name} a checkup. Is anything running hotter or slower than it should?`)}><Pulse /></button>
        </div>
        <div className="f-band-right">
          <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
          <p>{pc.name} is {pc.health >= 75 ? "running well" : "not at its best"}. {status}</p>
        </div>
        <button type="button" className="f-mic" aria-label="Ask Rig" onClick={() => set({ palette: true })}><Mic /></button>
      </section>

      <div className="f-grid">
        <section className="f-card f-pc">
          <StageSlot id="hero-stage" zoom={false} spin />
          <div className="f-pc-top">
            <div><div className="f-kicker">{pc.nickname}</div><div className="f-pc-name">{pc.name}</div></div>
            <a className="f-arrow" href="#pc" aria-label="Open 3D view"><Arrow /></a>
          </div>
          <div className="f-pc-chips">
            {chips.map(([id, p]) => (
              <button key={id} type="button" className={`f-chip${p.warn ? " hot" : ""}`} onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
                <i>{partIcon[id]}</i>{shortType(p.type)}<b>{temp(p.temp, { mark: "degree" })}</b>
              </button>
            ))}
          </div>
        </section>

        <section className="f-card f-health tone-dark">
          <div className="f-card-head"><span>Health</span><a className="f-mini" href="#history" aria-label="Temperature history"><Arrow /></a></div>
          <div className="f-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" className="tr" />
              <circle cx="60" cy="60" r="52" className="vl" strokeDasharray={`${(ringC * pc.health) / 100} ${ringC}`} transform="rotate(-90 60 60)" />
            </svg>
            <div><b>{pc.health}</b><span>of 100</span></div>
          </div>
          <p>{pc.summary}</p>
        </section>

        <FansCard fans={pc.fans} trend={week?.fans ?? null} />
        <TempsCard temps={week?.temps ?? null} name={pc.name} />
        <WeekCard week={week?.evenings ?? null} recorded={week?.recorded ?? false} name={pc.name} />

        <section className="f-card f-todo">
          <div className="f-card-head"><span>Things to look at</span>{open.length > 0 && <span className="f-count">{open.length}</span>}</div>
          {issues.map((i) => (
            <button key={i.id} type="button" className={`f-todo-row ${i.severity}`} onClick={() => issueGo(i, pc, ctx)}>
              <i className="f-todo-ico">{i.severity === "ok" ? <Check /> : partIcon[i.part ?? ""] ?? <Check />}</i>
              <span><b>{inUnit(i.title)}</b><small>{inUnit(i.body)}</small></span>
              <i className="f-todo-go"><Arrow /></i>
            </button>
          ))}
          {!issues.length && <p className="f-faint">Nothing to look at. Rig keeps watching while you use {pc.name}.</p>}
        </section>
      </div>
    </div>
  );
}
