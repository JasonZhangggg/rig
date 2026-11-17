import { useState } from "react";
import { user } from "../../data";
import { StageSlot } from "../../components/Stage";
import { useApp } from "../../state";
import { extras, issueGo, partIcon, shortType } from "./shared";

const Arrow = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Mic = () => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;

function Face({ mood }: { mood: "calm" | "warm" | "hot" }) {
  const mouth = mood === "calm" ? "M8 14.5c2.2 2.2 5.8 2.2 8 0" : mood === "warm" ? "M8.5 15.5h7" : "M8 16.5c2.2-2.2 5.8-2.2 8 0";
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
      <path d={mouth} />{mood === "hot" && <path d="M18.5 5.5c.8 1.2.8 2.2 0 3" />}
    </svg>
  );
}

export function FriendlyHome() {
  const { pc, set, go, toast } = useApp();
  const ex = extras[pc.id] ?? extras.atlas;
  const issues = pc.issues ?? [];
  const top = issues.find((i) => i.severity === "warn") ?? issues[0];
  const parts = Object.entries(pc.parts ?? {}).filter(([, p]) => p.temp !== undefined).slice(0, 4);
  const hottest = Math.max(...parts.map(([, p]) => p.temp ?? 0));
  const mood = hottest >= 82 ? "warm" : "calm";
  const [toggles, setToggles] = useState({ quiet: true, game: false, updates: true });
  const now = new Date();
  const used = ex.storage.filter((s) => s.label !== "Free");
  const free = ex.storage.find((s) => s.label === "Free")!;
  const ringC = 2 * Math.PI * 52;

  return (
    <div className="page f-home">
      <section className="f-band">
        <div className="f-band-left">
          <div className="f-date"><b>{now.getDate()}</b><span>{now.toLocaleDateString(undefined, { weekday: "short" })},<br />{now.toLocaleDateString(undefined, { month: "long" })}</span></div>
          {top && (
            <button type="button" className="f-cta" onClick={() => issueGo(top, pc, set, go)}>
              <span>{top.severity === "warn" ? "Fix what needs a look" : "See what's new"}</span><i><Arrow /></i>
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

      <div className="f-grid">
        <section className="f-card f-pc" style={{ ["--pc" as string]: pc.accent }}>
          <div className="f-pc-glow" aria-hidden="true" />
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

        <section className="f-card f-health">
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

        <section className="f-card f-mood">
          <div className="f-card-head"><span>How's {pc.name} feeling?</span></div>
          <div className="f-faces">
            {(["calm", "warm", "hot"] as const).map((m) => (
              <span key={m} className={`f-face ${m}${m === mood ? " on" : ""}`}><Face mood={m} /><small>{m === "calm" ? "Calm" : m === "warm" ? "Warm" : "Hot"}</small></span>
            ))}
          </div>
          <p>{mood === "warm" ? <>A little warm while gaming. The graphics card hit <b>{hottest}°C</b>, 6° under its limit.</> : <>Cool and quiet. The warmest part is at <b>{hottest}°C</b>.</>}</p>
        </section>

        <section className="f-card f-fans">
          <div className="f-card-head"><span>Fans right now</span><span className="f-faint">rpm</span></div>
          <div className="f-eq">
            {ex.fans.map((f) => (
              <div key={f.label} className={`f-eq-col${f.rpm / f.max > 0.75 ? " hi" : ""}`}>
                <b>{(f.rpm / 1000).toFixed(1)}k</b>
                <div className="f-eq-bar"><i style={{ height: `${(f.rpm / f.max) * 100}%` }} /></div>
                <small>{f.label}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="f-card f-toggles">
          <div className="f-card-head"><span>Quick switches</span></div>
          {([["quiet", "Quiet when idle", "Fans slow down when you're not gaming"], ["game", "Game boost", "Max fans while a game is open"], ["updates", "Ask about updates", "Rig checks drivers every day"]] as const).map(([k, t, d]) => (
            <button key={k} type="button" className="f-switch" role="switch" aria-checked={toggles[k]} onClick={() => { setToggles({ ...toggles, [k]: !toggles[k] }); toast(`${t} is ${toggles[k] ? "off" : "on"}.`); }}>
              <span><b>{t}</b><small>{d}</small></span><i />
            </button>
          ))}
        </section>

        <section className="f-card f-clean">
          <div className="f-card-head"><span>Since the last dust clean</span></div>
          <div className="f-clean-num"><b>{ex.cleanDays}</b><span>days<br />clean every {ex.cleanEvery}</span></div>
          <div className="f-dots" aria-label={`${ex.cleanDays} of ${ex.cleanEvery} days`}>
            {Array.from({ length: ex.cleanEvery }, (_, i) => <i key={i} className={i < ex.cleanDays ? (i >= ex.cleanEvery * 0.6 ? "late" : "on") : ""} />)}
          </div>
        </section>

        <section className="f-card f-storage">
          <div className="f-card-head"><span>Storage</span><span className="f-faint">{(ex.totalGb / 1000).toFixed(0)} TB</span></div>
          <div className="f-bubbles" aria-hidden="true">
            {[...used, free].map((s, i) => {
              const d = 40 + Math.sqrt(s.gb / ex.totalGb) * 78;
              return <span key={s.label} className={`f-bub b${i}`} style={{ width: d, height: d }}><b>{s.gb >= 1000 ? `${(s.gb / 1000).toFixed(1)} TB` : `${s.gb}`}</b><small>{s.label}</small></span>;
            })}
          </div>
          <p className="f-faint">{free.gb} GB free. Games take the most room.</p>
        </section>

        <section className="f-card f-todo">
          <div className="f-card-head"><span>Things to look at</span><span className="f-count">{issues.filter((i) => i.severity !== "ok").length}</span></div>
          {issues.map((i) => (
            <button key={i.id} type="button" className={`f-todo-row ${i.severity}`} onClick={() => issueGo(i, pc, set, go)}>
              <i className="f-todo-ico">{partIcon[i.part ?? ""] ?? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 12.5 10 17l9-10" /></svg>}</i>
              <span><b>{i.title}</b><small>{i.body}</small></span>
              <i className="f-todo-go"><Arrow /></i>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
