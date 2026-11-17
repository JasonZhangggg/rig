import type { ActionCall } from "@rig/core";
import { StageSlot } from "../components/Stage";
import { useApp } from "../state";
import { issueGo, partIcon, shortType } from "./shared";

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

const CLEAN_EVERY = 90;
const daysSince = (iso?: string) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : null);

export function Overview() {
  const ctx = useApp();
  const { pc, data, set, go, review, client } = ctx;
  const issues = pc.issues ?? [];
  const top = issues.find((i) => i.severity === "warn" || i.severity === "bad") ?? issues[0];
  const temps = Object.entries(pc.parts ?? {}).filter(([, p]) => p.temp != null);
  const chips = temps.slice(0, 4);
  // How close the warmest part is to its own limit
  const closest = temps.reduce<{ id: string; temp: number; gap: number } | null>((best, [id, p]) => {
    const gap = (p.limit ?? 95) - (p.temp ?? 0);
    return !best || gap < best.gap ? { id, temp: p.temp!, gap } : best;
  }, null);
  const mood = !closest ? "calm" : closest.gap <= 2 ? "hot" : closest.gap <= 8 ? "warm" : "calm";
  const now = new Date();
  const ringC = 2 * Math.PI * 52;
  const name = data.account?.name?.split(" ")[0];
  const s = pc.settings;
  const high = s?.powerPlans.find((p) => /high performance/i.test(p.name));
  const balanced = s?.powerPlans.find((p) => /balanced/i.test(p.name));
  const switches: { key: string; title: string; body: string; on: boolean; flip: ActionCall | null }[] = s ? [
    { key: "game", title: "Game Mode", body: "Windows puts games first while they run", on: s.gameMode, flip: { kind: "windows.gameMode", enabled: !s.gameMode } },
    { key: "power", title: "High performance", body: "Full speed all the time. Warmer at idle.", on: !!high?.active, flip: high && balanced ? { kind: "power.plan", guid: high.active ? balanced.guid : high.guid } : null },
    { key: "fx", title: "Fewer animations", body: "Snappier windows on slower PCs", on: s.visualEffects === "performance", flip: { kind: "windows.visualEffects", mode: s.visualEffects === "performance" ? "auto" : "performance" } },
  ] : [];
  const cleaned = daysSince(pc.cleanedAt);
  const storage = pc.storage;
  const free = storage?.slices.find((x) => x.label === "Free");
  const used = storage?.slices.filter((x) => x.label !== "Free") ?? [];

  return (
    <div className="page f-home">
      <section className="f-band">
        <div className="f-band-left">
          <div className="f-date"><b>{now.getDate()}</b><span>{now.toLocaleDateString(undefined, { weekday: "short" })},<br />{now.toLocaleDateString(undefined, { month: "long" })}</span></div>
          {top && (
            <button type="button" className="f-cta" onClick={() => issueGo(top, pc, ctx)}>
              <span>{top.severity === "warn" || top.severity === "bad" ? "Fix what needs a look" : "See what's new"}</span><i><Arrow /></i>
            </button>
          )}
          <button type="button" className="f-round big" aria-label="Open the 3D view" title="Open the 3D view" onClick={() => go("pc")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>
          </button>
        </div>
        <div className="f-band-right">
          <h1>Hey{name ? ` ${name}` : ""}, <span>need help?</span></h1>
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
            {chips.map(([id, p]) => (
              <button key={id} type="button" className={`f-chip${p.warn ? " hot" : ""}`} onClick={() => { set({ selected: id, tab: "live" }); go("pc"); }}>
                <i>{partIcon[id]}</i>{shortType(p.type)}<b>{p.temp}°</b>
              </button>
            ))}
          </div>
        </section>

        <section className="f-card f-health">
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

        <section className="f-card f-mood">
          <div className="f-card-head"><span>How's {pc.name} feeling?</span></div>
          <div className="f-faces">
            {(["calm", "warm", "hot"] as const).map((m) => (
              <span key={m} className={`f-face ${m}${m === mood ? " on" : ""}`}><Face mood={m} /><small>{m === "calm" ? "Calm" : m === "warm" ? "Warm" : "Hot"}</small></span>
            ))}
          </div>
          <p>{!closest ? "Waiting for the first temperature reading." : mood === "calm"
            ? <>Cool and quiet. The warmest part is at <b>{closest.temp}°C</b>.</>
            : <>The {shortType(pc.parts![closest.id].type).toLowerCase()} is at <b>{closest.temp}°C</b>, {Math.max(0, Math.round(closest.gap))}° under its limit.</>}</p>
        </section>

        <section className="f-card f-fans">
          <div className="f-card-head"><span>Fans right now</span><span className="f-faint">rpm</span></div>
          {pc.fans?.length ? (
            <div className="f-eq">
              {pc.fans.slice(0, 6).map((f) => (
                <div key={f.label} className={`f-eq-col${f.rpm / f.max > 0.75 ? " hi" : ""}`}>
                  <b>{(f.rpm / 1000).toFixed(1)}k</b>
                  <div className="f-eq-bar"><i style={{ height: `${Math.min(100, (f.rpm / f.max) * 100)}%` }} /></div>
                  <small>{f.label}</small>
                </div>
              ))}
            </div>
          ) : <p className="f-faint">No fan is reporting a speed. Some fans stop completely when the PC is cool.</p>}
        </section>

        <section className="f-card f-toggles">
          <div className="f-card-head"><span>Quick switches</span></div>
          {switches.length ? switches.map((w) => (
            <button key={w.key} type="button" className="f-switch" role="switch" aria-checked={w.on} disabled={!w.flip}
              onClick={() => w.flip && review([w.flip], { by: "you", title: `Turn ${w.title} ${w.on ? "off" : "on"}`, cta: w.on ? "Turn off" : "Turn on" })}>
              <span><b>{w.title}</b><small>{w.body}</small></span><i />
            </button>
          )) : <p className="f-faint">{client.caps.local ? "Reading Windows settings…" : `Switches work in the Rig app on ${pc.name}.`}</p>}
        </section>

        <section className="f-card f-clean">
          <div className="f-card-head"><span>Since the last dust clean</span></div>
          {cleaned == null ? (
            <>
              <p className="f-faint">Tell Rig when you clean the dust out and it will remind you when it's due.</p>
              <button type="button" className="btn sm" onClick={() => client.rename(pc.id, { cleanedAt: new Date().toISOString() })}>I cleaned it today</button>
            </>
          ) : (
            <>
              <div className="f-clean-num"><b>{cleaned}</b><span>days<br />clean every {CLEAN_EVERY}</span></div>
              <div className="f-dots" aria-label={`${cleaned} of ${CLEAN_EVERY} days`}>
                {Array.from({ length: 30 }, (_, i) => <i key={i} className={i < Math.round((Math.min(cleaned, CLEAN_EVERY) / CLEAN_EVERY) * 30) ? (i >= 18 ? "late" : "on") : ""} />)}
              </div>
              {cleaned > 0 && <button type="button" className="btn ghost sm" onClick={() => client.rename(pc.id, { cleanedAt: new Date().toISOString() })}>Cleaned it again</button>}
            </>
          )}
        </section>

        <section className="f-card f-storage">
          <div className="f-card-head"><span>Storage</span>{storage && <span className="f-faint">{storage.totalGb >= 1000 ? `${(storage.totalGb / 1000).toFixed(1)} TB` : `${storage.totalGb} GB`}</span>}</div>
          {storage && free ? (
            <>
              <div className="f-bubbles" aria-hidden="true">
                {[...used.slice(0, 3), free].map((x, i) => {
                  const d = 40 + Math.sqrt(x.gb / Math.max(1, storage.totalGb)) * 78;
                  return <span key={x.label} className={`f-bub b${i === used.slice(0, 3).length ? 3 : i}`} style={{ width: d, height: d }}><b>{x.gb >= 1000 ? `${(x.gb / 1000).toFixed(1)} TB` : `${x.gb}`}</b><small>{x.label}</small></span>;
                })}
              </div>
              <p className="f-faint">{free.gb} GB free.</p>
            </>
          ) : <p className="f-faint">Reading drives…</p>}
        </section>

        <section className="f-card f-todo">
          <div className="f-card-head"><span>Things to look at</span><span className="f-count">{issues.filter((i) => i.severity !== "ok").length}</span></div>
          {issues.map((i) => (
            <button key={i.id} type="button" className={`f-todo-row ${i.severity}`} onClick={() => issueGo(i, pc, ctx)}>
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
