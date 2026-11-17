import { games, user } from "../../data";
import { StageSlot } from "../../components/Stage";
import { useApp } from "../../state";
import { extras, greeting, issueGo, partIcon, shortType } from "./shared";

export function WorkspaceHome() {
  const { ui, pc, set, go } = useApp();
  const ex = extras[pc.id] ?? extras.atlas;
  const issues = pc.issues ?? [];
  const top = issues.find((i) => i.severity === "warn") ?? issues.find((i) => i.severity === "info");
  const parts = Object.entries(pc.parts ?? {});
  const temps = parts.filter(([, p]) => p.temp !== undefined);
  const [hotId, hot] = temps.reduce((a, b) => ((b[1].temp ?? 0) > (a[1].temp ?? 0) ? b : a));
  const totalW = ex.power.reduce((a, p) => a + p.w, 0);
  const maxPeak = Math.max(...ex.week.map((w) => w.peak));
  const minPeak = Math.min(...ex.week.map((w) => w.peak)) - 12;
  const mine = Object.values(ui.pcs).filter((x) => x.parts);
  const needs = issues.filter((i) => i.severity !== "ok").length;

  return (
    <div className="page w-home">
      <div className="w-top">
        <div className="w-crumbs"><span>Your PCs</span><i>/</i><span>{pc.name}</span><i>/</i><b>Overview</b></div>
        <div className="w-top-r">
          <span className="w-sync"><i />{pc.lastSync}</span>
          <a className="w-btn" href="#history">This week ▾</a>
          <a className="w-btn dark" href="#chat">Ask Rig</a>
        </div>
      </div>

      <div className="w-chips" role="group" aria-label="Your PCs">
        {mine.map((x) => (
          <button key={x.id} type="button" aria-pressed={x.id === pc.id} onClick={() => set({ pcId: x.id, selected: null })}>
            <span className="sh-dot" style={{ ["--pc" as string]: x.accent }} />{x.name}<small>{x.nickname}</small>
          </button>
        ))}
      </div>

      <h1 className="w-title">{greeting()}, <b>{user.name}.</b><br />{pc.name} is <b>{pc.health >= 80 ? "in good shape" : "doing okay"}</b>{needs === 0 ? ", nothing to check." : needs === 1 ? ", with one thing to check." : `, with ${needs} things to check.`}</h1>

      <div className="w-grid">
        <section className="w-big">
          <div className="w-label">Hottest right now · {shortType(hot.type)}</div>
          <div className="w-giant num">{hot.temp}<small>°C</small></div>
          <div className="w-pills">
            {hot.warn && <span className="w-red">+9° vs last month</span>}
            <span className="w-grey">limit {hot.tempMax ? hot.tempMax + (hotId === "gpu" ? 2 : 0) : 90}°C</span>
            <span className="w-grey">{hot.load ?? 0}% busy</span>
          </div>
          <div className="w-power">
            <div className="w-power-head"><span>Power draw while gaming</span><b>{totalW} W <small>of {ex.psu} W</small></b></div>
            <div className="w-power-bar" aria-hidden="true">
              {ex.power.map((p, i) => <i key={p.label} className={`p${i}`} style={{ flexGrow: p.w }} />)}
              <i className="head" style={{ flexGrow: ex.psu - totalW }} />
            </div>
            <div className="w-power-legend">
              {ex.power.map((p, i) => <span key={p.label}><i className={`p${i}`} />{p.label} <b>{p.w} W</b></span>)}
              <span><i className="head" />Room to spare <b>{ex.psu - totalW} W</b></span>
            </div>
          </div>
        </section>

        <section className="w-feature">
          {top ? (
            <>
              <div className="w-feature-top"><span className="w-label">Needs a look</span><span className="w-feature-n">{issues.filter((i) => i.severity !== "ok").length}</span></div>
              <h2>{top.title}</h2>
              <p>{top.body}</p>
              <div className="w-feature-foot">
                <button type="button" className="w-btn light" onClick={() => issueGo(top, pc, set, go)}>{top.action}</button>
                <a className="w-link" href="#changes">Past changes</a>
              </div>
            </>
          ) : <h2>Nothing needs you.</h2>}
        </section>

        <section className="w-pc" style={{ ["--pc" as string]: pc.accent }}>
          <div className="w-pc-head"><span className="w-label">{pc.nickname}</span><a className="w-btn sm" href="#pc">Open 3D</a></div>
          <div className="w-pc-stage"><StageSlot id="hero-stage" zoom={false} spin /></div>
        </section>

        <section className="w-panel w-chart">
          <div className="w-panel-head"><h2>Graphics peak each evening</h2><span className="w-faint">°C, last 7 days</span></div>
          <div className="w-bars">
            {ex.week.map((w) => {
              const h = ((w.peak - minPeak) / (maxPeak - minPeak)) * 100;
              const isMax = w.peak === maxPeak;
              return (
                <div key={w.d} className={`w-bar${isMax ? " max" : ""}`}>
                  <span className="w-bar-v">{w.peak}°</span>
                  <div className="w-bar-track"><i style={{ height: `${h}%` }} /></div>
                  <small>{w.d}</small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="w-panel w-games">
          <div className="w-panel-head"><h2>Games</h2><a className="w-link" href="#games">All</a></div>
          {games.map((g) => {
            const gain = Math.round(((g.tuned.avg - g.now.avg) / g.now.avg) * 100);
            return (
              <a key={g.name} className="w-game" href="#games">
                <span className="w-game-ico">{g.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
                <span className="w-game-n"><b>{g.name}</b><small>{g.res}</small></span>
                <span className="w-pill-dark num">{g.now.avg} fps</span>
                <span className="w-pill-red num">+{gain}%</span>
              </a>
            );
          })}
        </section>

        <section className="w-panel w-parts">
          <div className="w-panel-head"><h2>Parts</h2><span className="w-faint">{parts.length} found</span></div>
          {parts.filter(([, p]) => p.temp !== undefined || p.fan).slice(0, 5).map(([id, p]) => (
            <button key={id} type="button" className="w-part" onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
              <i>{partIcon[id] ?? partIcon.board}</i><span>{shortType(p.type)}</span>
              {p.temp !== undefined ? <b className={`num${p.warn ? " red" : ""}`}>{p.temp}°</b> : <b className="num">{p.fan?.toLocaleString()} rpm</b>}
            </button>
          ))}
        </section>
      </div>

      <div className="w-stats">
        <div><small>Health score</small><b className="num">{pc.health}<span>/100</span></b><em>{issues.filter((i) => i.severity !== "ok").length} to check</em></div>
        <div><small>Uptime</small><b className="num">{ex.uptime}</b><em>since the last restart</em></div>
        <div><small>Startup</small><b className="num">{ex.boot}</b><em className="good">11 s faster</em></div>
        <div><small>Changes</small><b className="num">{ui.changes.length}</b><em>all undoable</em></div>
      </div>
    </div>
  );
}
