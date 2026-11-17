import { useMemo } from "react";
import { history, sparkData, user, type Severity } from "../data";
import { WeekChart } from "../chart";
import { Ring, StatusChip } from "../components/common";
import { StageSlot } from "../components/Stage";
import { useApp } from "../state";

const sevLabel = { warn: "Needs a look", info: "Suggestion", ok: "Good news", bad: "Problem" };

// How the health score breaks down, per PC (sample data for the mockup).
const breakdown: Record<string, { label: string; value: number; note: string; sev: Severity }[]> = {
  atlas: [
    { label: "Temperatures", value: 64, note: "Graphics card 9°C warmer than usual", sev: "warn" },
    { label: "Drivers and updates", value: 86, note: "1 driver update ready", sev: "info" },
    { label: "Storage", value: 92, note: "39% free, drive health good", sev: "ok" },
    { label: "Startup and speed", value: 95, note: "Boots in 18 s", sev: "ok" },
  ],
  pebble: [
    { label: "Temperatures", value: 80, note: "Short slowdowns on battery", sev: "info" },
    { label: "Battery", value: 89, note: "89% of original capacity", sev: "ok" },
    { label: "Drivers and updates", value: 84, note: "BIOS 310 ready", sev: "info" },
    { label: "Storage", value: 94, note: "57% free", sev: "ok" },
  ],
};

// Change since the last comparable period, per tile (sample data).
const deltas: Record<string, { text: string; dir: "up-bad" | "down-good" | "up-good" | "down-bad" | "flat" }> = {
  "atlas:CPU": { text: "2° cooler than last week", dir: "down-good" },
  "atlas:GPU": { text: "+9° vs last month", dir: "up-bad" },
  "atlas:Storage": { text: "+3% this month", dir: "flat" },
  "atlas:Memory": { text: "Normal for you", dir: "flat" },
  "pebble:CPU": { text: "Normal on calls", dir: "flat" },
  "pebble:Battery": { text: "-2% this year", dir: "down-bad" },
  "pebble:Storage": { text: "+1% this month", dir: "flat" },
  "pebble:Memory": { text: "+12% vs usual", dir: "up-bad" },
};

const metricIcon: Record<string, JSX.Element> = {
  CPU: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" strokeLinecap="round" /></svg>,
  GPU: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="6" width="20" height="11" rx="2" /><circle cx="9" cy="11.5" r="3" /><circle cx="16.5" cy="11.5" r="2" /><path d="M5 17v3M2 9H1" strokeLinecap="round" /></svg>,
  Storage: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 14h18" /><circle cx="17" cy="17" r="1" fill="currentColor" /></svg>,
  Memory: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="7" width="20" height="9" rx="1.5" /><path d="M6 10.5v2M10 10.5v2M14 10.5v2M18 10.5v2M5 16v3M19 16v3" strokeLinecap="round" /></svg>,
  Battery: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="7" width="18" height="10" rx="2.5" /><path d="M22 10.5v3" strokeLinecap="round" /><rect x="4.5" y="9.5" width="11" height="5" rx="1" fill="currentColor" stroke="none" /></svg>,
};

const actIcons = [
  "M12 3v9M7.5 5.5a8 8 0 1 0 9 0",
  "M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6",
  "M13 3 5 13h6l-1 8 8-10h-6z",
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const tileName: Record<string, string> = { CPU: "Processor", GPU: "Graphics card", Storage: "Storage", Memory: "Memory", Battery: "Battery" };
const tileLimit: Record<string, number> = { CPU: 95, GPU: 90 };

function AreaSpark({ values, id }: { values: number[]; id: string }) {
  const w = 200, h = 44;
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 10);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg className="area-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="s0" /><stop offset="1" className="s1" /></linearGradient></defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={d} className="line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Three-quarter dial with the part's icon in the middle
function Dial({ pct, icon }: { pct: number; icon: JSX.Element }) {
  const r = 27, c = 2 * Math.PI * r, arc = c * 0.75;
  const v = Math.max(0.02, Math.min(1, pct)) * arc;
  return (
    <div className="dial" aria-hidden="true">
      <svg viewBox="0 0 70 70">
        <circle cx="35" cy="35" r={r} className="dial-track" strokeDasharray={`${arc} ${c}`} transform="rotate(135 35 35)" />
        <circle cx="35" cy="35" r={r} className="dial-val" strokeDasharray={`${v} ${c}`} transform="rotate(135 35 35)" />
      </svg>
      <span className="dial-ico">{icon}</span>
    </div>
  );
}

export function Overview() {
  const { ui, pc, set, go, toast } = useApp();
  const mine = Object.values(ui.pcs).filter((x) => x.parts);
  const issues = pc.issues ?? [];
  const needs = issues.filter((i) => i.severity !== "ok").length;
  const pts = useMemo(() => history(7), []);
  const parts = Object.entries(pc.parts ?? {});
  const hot = parts.filter(([, p]) => p.temp !== undefined).slice(0, 4);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="page dash">
      <header className="dash-head">
        <div className="dash-hello">
          <div className="faint">{today}</div>
          <h1>{greeting()}, {user.name}</h1>
          <p className="dash-sub">{pc.name}: {pc.summary}</p>
        </div>
        <div className="dash-tools">
          <div className="pc-pills" role="group" aria-label="Your PCs">
            {mine.map((x) => (
              <button key={x.id} type="button" className="pc-pill" aria-pressed={x.id === pc.id} onClick={() => set({ pcId: x.id, selected: null })}>
                <span className="pc-ava" style={{ ["--pc" as string]: x.accent }}>{x.name[0]}</span>
                <span className="pc-pill-text"><b>{x.name}</b><span>{x.nickname}</span></span>
                {(x.issues ?? []).some((i) => i.severity === "warn") && <span className="pc-pill-flag" aria-label="Needs a look" />}
              </button>
            ))}
            <button type="button" className="pc-pill add" onClick={() => toast("Adding a PC opens a download link and a pairing code.")} aria-label="Add a PC">+</button>
          </div>
          <button type="button" className="command" onClick={() => set({ palette: true })} aria-label="Search or ask">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <span className="command-ph">Search parts, changes, games, or ask</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
      </header>

      <div className="bento">
        <section className="card b-hero" style={{ ["--pc" as string]: pc.accent }}>
          <StageSlot id="hero-stage" zoom={false} spin />
          <div className="hero-over top">
            <div className="hero-id"><div className="hero-kicker"><span className="dot" />{pc.nickname}</div><div className="hero-name">{pc.name}</div><div className="hero-os">{pc.os}</div></div>
            <span className="chip ok">{pc.lastSync}</span>
          </div>
          <div className="hero-over bottom">
            <div className="part-pills">
              {hot.map(([id, p]) => (
                <button key={id} type="button" className={`pill${p.warn ? " warn" : ""}`} onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
                  <span>{p.type}</span><b className="num">{p.temp}°</b>
                </button>
              ))}
            </div>
            <a className="btn primary" href="#pc">Open 3D view</a>
          </div>
        </section>

        <section className="b-tiles" aria-label="Right now">
          {(pc.stats ?? []).map((s, i) => {
            const dl = deltas[`${pc.id}:${s.label}`];
            const pct = s.unit === "%" ? s.value / 100 : s.value / (tileLimit[s.label] ?? 100);
            return (
              <div key={s.label} className={`card tile k-${s.label.toLowerCase()}${s.warn ? " warn" : ""}`}>
                <div className="tile-head">
                  <span className="tile-name">{tileName[s.label] ?? s.label}</span>
                  {s.warn && <span className="chip warn">Running warm</span>}
                </div>
                <div className="tile-body">
                  <div className="tile-num num">{s.value}<small>{s.unit}</small></div>
                  <Dial pct={pct} icon={metricIcon[s.label]} />
                </div>
                <div className="tile-foot">
                  {dl && <span className={`delta ${dl.dir}`}><i />{dl.text}</span>}
                  <span className="tile-note">{s.note}{tileLimit[s.label] && s.unit !== "%" ? ` · limit ${tileLimit[s.label]}°` : ""}</span>
                </div>
                <AreaSpark id={`sp-${pc.id}-${i}`} values={sparkData(s.value, 36, 3 + i, s.unit === "%" ? 3 : 8)} />
              </div>
            );
          })}
        </section>

        <section className="card b-temps">
          <div className="card-head">
            <div><h2>Temperatures this week</h2><div className="faint">Evenings are gaming. The graphics card peak is creeping up.</div></div>
            <div className="legend">
              <span><i className="lg-cpu" />Processor</span>
              <span><i className="lg-gpu" />{pc.kind === "laptop" ? "Graphics" : "Graphics card"}</span>
              <a className="btn ghost sm" href="#history">History</a>
            </div>
          </div>
          <div className="temps-body"><WeekChart points={pts} names={{ cpu: "Processor", gpu: pc.kind === "laptop" ? "Graphics" : "Graphics card" }} /></div>
        </section>

        <section className="card b-health">
          <div className="health-top">
            <Ring value={pc.health} />
            <div><div className="label">Health</div><p className="health-sum">{pc.summary}</p></div>
          </div>
          <div className="meters">
            {(breakdown[pc.id] ?? []).map((m) => (
              <div key={m.label} className="meter">
                <div className="meter-head"><span>{m.label}</span><span className="num faint">{m.value}</span></div>
                <div className={`meter-bar ${m.sev}`}><i style={{ width: `${m.value}%` }} /></div>
                <div className="faint meter-note">{m.note}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="b-side">
          <section className="card b-needs">
            <div className="card-head"><h2>Worth a look</h2>{needs > 0 && <span className="count">{needs}</span>}</div>
            <div className="issues compact">
              {issues.map((i) => (
                <button key={i.id} type="button" className={`issue ${i.severity}`} onClick={() => {
                  if (i.part && i.go === "pc") set({ selected: i.part, tab: pc.parts?.[i.part]?.driver ? "drivers" : "live" });
                  go(i.go);
                }}>
                  <span className={`sev ${i.severity}`} />
                  <span className="issue-text"><span className="label">{sevLabel[i.severity]}</span><b>{i.title}</b><span className="muted">{i.body}</span></span>
                  <span className="issue-go">{i.action} ›</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card b-changes">
            <div className="card-head"><h2>Recent changes</h2><a className="btn ghost sm" href="#changes">See all</a></div>
            {ui.changes.slice(0, 3).map((c, i) => (
              <a key={c.id} href="#changes" className="act-row">
                <span className="act-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={actIcons[i % actIcons.length]} /></svg></span>
                <span className="act-text"><b>{c.title}</b><span>{c.when} · {c.by === "You" ? "by you" : "you said yes"}</span></span>
                <StatusChip status={c.status} />
              </a>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
