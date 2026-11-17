import { useMemo } from "react";
import { user } from "../../data";
import { StageSlot } from "../../components/Stage";
import { useApp } from "../../state";
import { issueGo, partIcon, shortType } from "./shared";
import {
  Arrow, CapsuleChart, CapsuleTimeline, Check, DotMatrix, Legend, Stat,
  fanColumns, fanStats, tempLabels, useGrowOnce, weekSessions, weekTemps,
} from "./pulse-parts";

const Mic = () => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;

export function BlendHome() {
  const { pc, set, go, toast } = useApp();
  const issues = pc.issues ?? [];
  const open = issues.filter((i) => i.severity !== "ok");
  const top = issues.find((i) => i.severity === "warn") ?? issues[0];
  const parts = Object.entries(pc.parts ?? {}).filter(([, p]) => p.temp !== undefined).slice(0, 4);
  const fans = useMemo(() => fanColumns(14), []);
  const days = weekTemps(pc);
  const sessions = weekSessions(pc);
  const labels = tempLabels(pc);
  const peak = Math.max(...days.map((d) => d.peak));
  const total = sessions.filter((s) => s.kind !== "background").reduce((a, s) => a + s.hours, 0);
  const growCaps = useGrowOnce("blend-caps");
  const growTl = useGrowOnce("blend-tl");
  const now = new Date();
  const ringC = 2 * Math.PI * 52;

  return (
    <div className="page f-home bl-home">
      <section className="f-band">
        <div className="f-band-left">
          <div className="f-date"><b>{now.getDate()}</b><span>{now.toLocaleDateString(undefined, { weekday: "short" })},<br />{now.toLocaleDateString(undefined, { month: "long" })}</span></div>
          {top && (
            <button type="button" className="f-cta" onClick={() => issueGo(top, pc, set, go)}>
              <span>{top.severity === "warn" ? "Fix what needs a look" : "See what's new"}</span>
              {open.length > 0 && <em className="bl-n">{open.length}</em>}
              <i><Arrow /></i>
            </button>
          )}
          <button type="button" className="f-round big" aria-label="Run a checkup" title="Run a checkup" onClick={() => toast("A checkup reads every sensor for 30 seconds. Nothing is changed.")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>
          </button>
        </div>
        <div className="f-band-right">
          <h1>Hey {user.name}, <span>need help?</span></h1>
          <p>Just ask me anything about {pc.name}.</p>
        </div>
        <button type="button" className="f-mic" aria-label="Ask Rig" onClick={() => set({ palette: true })}><Mic /></button>
      </section>

      <div className="f-grid bl-grid">
        <section className="f-card f-pc bl-pc">
          <div className="bl-pc-glow" aria-hidden="true" />
          <StageSlot id="hero-stage" zoom={false} spin />
          <div className="f-pc-top">
            <div><div className="f-kicker">{pc.nickname}</div><div className="f-pc-name">{pc.name}</div></div>
            <a className="f-arrow" href="#pc" aria-label="Open 3D view"><Arrow /></a>
          </div>
          <div className="f-pc-chips">
            {parts.map(([id, p]) => (
              <button key={id} type="button" className={`f-chip${p.warn ? " hot" : ""}`} onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
                <i>{partIcon[id]}</i>{shortType(p.type)}<b>{p.temp}°</b>
              </button>
            ))}
          </div>
        </section>

        <section className="f-card f-health tone-dark">
          <div className="f-card-head"><span>Health</span><a className="f-mini" href="#history" aria-label="Health history"><Arrow /></a></div>
          <div className="f-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" className="tr" />
              <circle cx="60" cy="60" r="52" className="vl" strokeDasharray={`${(ringC * pc.health) / 100} ${ringC}`} transform="rotate(-90 60 60)" />
            </svg>
            <div><b>{pc.health}</b><span>of 100</span></div>
          </div>
          <p>{pc.summary}</p>
        </section>

        <section className="f-card bl-fans tone-dark">
          <div className="f-card-head"><span>Fans</span><span className="f-faint">rpm</span></div>
          <div className="pl-stats">{fanStats(pc).map((s) => <Stat key={s.label} {...s} />)}</div>
          <DotMatrix values={fans} label="Fan speed over the last few days, every six hours. Fastest in the evenings." />
        </section>

        <section className="f-card bl-temps tone-dark">
          <div className="f-card-head"><span>Temperatures</span><span className="f-faint">This week, °C</span></div>
          <CapsuleChart days={days} grow={growCaps} label={`${labels.peak} went from ${days[0].peak}°C on ${days[0].d} to ${days[days.length - 1].peak}°C on ${days[days.length - 1].d}.`} />
          <Legend items={[["c", labels.idle], ["a", labels.typical], ["b", labels.peak]]} total={["Peak", `${peak}°C`]} />
        </section>

        <section className="f-card bl-week">
          <div className="f-card-head"><span>This week</span><span className="f-faint">Hours after 6 PM</span></div>
          <CapsuleTimeline rows={sessions} grow={growTl} />
          <Legend items={[["a", pc.kind === "laptop" ? "Normal" : "Played"], ["b", "Ran hot"], ["c", "Background task"]]} total={["Total", `${total} h`]} />
        </section>

        <section className="f-card f-todo">
          <div className="f-card-head"><span>Things to look at</span><span className="f-count">{open.length}</span></div>
          {issues.map((i) => (
            <button key={i.id} type="button" className={`f-todo-row ${i.severity}`} onClick={() => issueGo(i, pc, set, go)}>
              <i className="f-todo-ico">{i.severity === "ok" ? <Check /> : partIcon[i.part ?? ""] ?? <Check />}</i>
              <span><b>{i.title}</b><small>{i.body}</small></span>
              <i className="f-todo-go"><Arrow /></i>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
