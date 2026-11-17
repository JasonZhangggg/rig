import { user } from "../../data";
import { StageSlot } from "../../components/Stage";
import { useApp } from "../../state";
import { issueGo, partIcon, shortType } from "./shared";
import {
  Arrow, CapsuleChart, CapsuleTimeline, Check, DotDigits, Legend,
  tempLabels, useGrowOnce, weekSessions, weekTemps,
} from "./pulse-parts";

function partOfDay() {
  const h = new Date().getHours();
  return h < 5 ? "Evening" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

export function SignatureHome() {
  const { pc, set, go } = useApp();
  const issues = pc.issues ?? [];
  const warn = issues.filter((i) => i.severity === "warn");
  const open = issues.filter((i) => i.severity !== "ok");
  const top = warn[0] ?? open[0];
  const parts = Object.entries(pc.parts ?? {}).filter(([, p]) => p.temp !== undefined).slice(0, 4);
  const days = weekTemps(pc);
  const sessions = weekSessions(pc);
  const labels = tempLabels(pc);
  const peak = Math.max(...days.map((d) => d.peak));
  const total = sessions.filter((s) => s.kind !== "background").reduce((a, s) => a + s.hours, 0);
  const growCaps = useGrowOnce("sig-caps");
  const growTl = useGrowOnce("sig-tl");
  const growDots = useGrowOnce("sig-dots");

  return (
    <div className="page sg-home">
      <header className="sg-greet">
        <div>
          <h1>{partOfDay()}, {user.name}.</h1>
          <p>{pc.name}, {pc.nickname.toLowerCase()}. {pc.summary}</p>
        </div>
        <div className="sg-greet-cta">
          {warn.length > 0 ? (
            <button type="button" className="sg-pill coral" onClick={() => issueGo(warn[0], pc, set, go)}>
              {warn.length === 1 ? "1 thing needs a look" : `${warn.length} things need a look`}<i><Arrow /></i>
            </button>
          ) : (
            <span className="sg-pill lime"><Check />All good</span>
          )}
          {warn.length === 0 && top && (
            <button type="button" className="sg-pill plain" onClick={() => issueGo(top, pc, set, go)}>
              {open.length} idea{open.length > 1 ? "s" : ""} to try<i><Arrow /></i>
            </button>
          )}
        </div>
      </header>

      <div className="sg-grid">
        <section className="sg-tile dark sg-health">
          <div className="sg-tile-head"><h2>Health</h2><a className="sg-go" href="#history" aria-label="Temperature history"><Arrow /></a></div>
          <div className="sg-score">
            <DotDigits value={String(pc.health)} grow={growDots} label={`Health ${pc.health} out of 100`} />
            <span>of 100</span>
          </div>
          <p className={`sg-note${warn.length ? " hot" : ""}`}><i aria-hidden="true" />{warn.length ? warn[0].title : "Nothing needs a look right now"}</p>
        </section>

        <section className="sg-tile sg-pc">
          <StageSlot id="hero-stage" zoom={false} spin />
          <div className="sg-pc-top">
            <div><div className="sg-kicker">{pc.nickname}</div><h2 className="sg-pc-name">{pc.name}</h2></div>
            <a className="sg-go solid" href="#pc" aria-label="Open 3D view"><Arrow /></a>
          </div>
          <div className="sg-chips">
            {parts.map(([id, p]) => (
              <button key={id} type="button" className={`sg-chip${p.warn ? " hot" : ""}`} onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
                <i>{partIcon[id]}</i>{shortType(p.type)}<b>{p.temp}°</b>
              </button>
            ))}
          </div>
        </section>

        <section className="sg-tile dark sg-temps">
          <div className="sg-tile-head"><div><h2>Temperatures</h2><p className="sg-sub">Every day this week, °C</p></div><a className="sg-go" href="#history" aria-label="Temperature history"><Arrow /></a></div>
          <CapsuleChart days={days} grow={growCaps} label={`${labels.peak} went from ${days[0].peak}°C on ${days[0].d} to ${days[days.length - 1].peak}°C on ${days[days.length - 1].d}.`} />
          <Legend items={[["c", labels.idle], ["a", labels.typical], ["b", labels.peak]]} total={["Peak", `${peak}°C`]} />
        </section>

        <section className="sg-tile sg-week">
          <div className="sg-tile-head"><div><h2>This week</h2><p className="sg-sub">{pc.kind === "laptop" ? "Busy sessions" : "Gaming sessions"}, hours after 6 PM</p></div><a className="sg-go" href={pc.kind === "laptop" ? "#history" : "#games"} aria-label={pc.kind === "laptop" ? "Temperature history" : "Games"}><Arrow /></a></div>
          <CapsuleTimeline rows={sessions} grow={growTl} />
          <Legend items={[["a", pc.kind === "laptop" ? "Normal" : "Played"], ["b", "Ran hot"], ["c", "Background task"]]} total={["Total", `${total} h`]} />
        </section>

        <section className="sg-tile sg-todo">
          <div className="sg-tile-head"><h2>Things to look at</h2>{open.length > 0 && <span className="sg-n">{open.length}</span>}</div>
          <div className="sg-rows">
            {issues.map((i) => (
              <button key={i.id} type="button" className={`sg-row ${i.severity}`} onClick={() => issueGo(i, pc, set, go)}>
                <i className="sg-row-ico" aria-hidden="true">{i.severity === "ok" ? <Check /> : null}</i>
                <span className="sg-row-txt"><b>{i.title}</b><small>{i.body}</small></span>
                <span className="sg-row-go" aria-hidden="true"><Arrow /></span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
