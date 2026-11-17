import { games } from "../../data";
import { StageSlot } from "../../components/Stage";
import { paperSection } from "../../components/Shells";
import { useApp } from "../../state";
import { issueGo, partIcon, shortType } from "./shared";
import { Arrow, CapsuleBars, DotDigits, peakBars, useGrowOnce } from "./pulse-parts";

const count = ["No", "One", "Two", "Three", "Four"];
const nextStep: Record<string, string> = {
  atlas: "Clean the front intake filter, about five minutes",
  pebble: "Try the cooler power mode on battery",
};

export function PaperHome() {
  const { ui, pc, set, go } = useApp();
  const issues = pc.issues ?? [];
  const warn = issues.filter((i) => i.severity === "warn");
  const open = issues.filter((i) => i.severity !== "ok");
  const top = warn[0] ?? open[0];
  const parts = Object.entries(pc.parts ?? {});
  const hot = parts.filter(([, p]) => p.temp !== undefined).sort(([, a], [, b]) => Number(b.warn ?? 0) - Number(a.warn ?? 0) || (b.temp ?? 0) - (a.temp ?? 0))[0];
  const drift = warn.map((i) => /(\d+°C) hotter than a month ago/.exec(i.title)?.[1]).find(Boolean);
  const hotNote = drift ? `${drift} warmer than last month` : pc.stats?.find((s) => s.label === "CPU")?.note.replace(/^./, (c) => c.toUpperCase()) ?? "Normal for this PC";
  const bars = peakBars(pc);
  const peak = bars.find((b) => b.kind === "peak")!;
  const lastChange = ui.changes.find((c) => c.status === "applied");
  const growBars = useGrowOnce("paper-bars");
  const growDots = useGrowOnce("paper-dots");
  const [n1, s1] = paperSection("overview");

  const line1 = `${pc.summary.split(". ")[0].replace(/\.$/, "")}.`;
  const line2 = warn.length > 0 ? `${count[warn.length] ?? warn.length} thing${warn.length > 1 ? "s" : ""} to look at.`
    : open.length > 0 ? `${count[open.length] ?? open.length} idea${open.length > 1 ? "s" : ""} to try.` : "Nothing to look at.";
  const lede = top ? `${top.title}. ${top.body.split(". ")[0].replace(/\.$/, "")}.` : pc.summary;
  const facts: [string | number, string][] = [
    [pc.health, "health"],
    [parts.length, "parts"],
    pc.kind === "laptop" ? [pc.stats?.find((s) => s.label === "Battery")?.value + "%", "battery"] : [games.length, "games tuned"],
    [ui.changes.length, "changes"],
  ];

  return (
    <div className="page pp-home">
      <div className="pp-rule"><span>{n1}</span><span>{s1}</span></div>

      <div className="pp-hero-row">
        <section className="pp-hero">
          <div className="pp-hero-head"><span>{pc.name}</span><span>{pc.lastSync.replace("Synced", "Checked")}</span></div>
          <h1 className="pp-display">{line1}<br />{line2}</h1>
          <p className="pp-lede">{lede}</p>
          <div className="pp-actions">
            {top && <button type="button" className="pp-btn dark" onClick={() => issueGo(top, pc, set, go)}>{warn.length ? "Fix what needs a look" : "See what's new"}</button>}
            <a className="pp-btn line" href="#pc">See the 3D view</a>
          </div>
          <div className="pp-facts">{facts.map(([v, t]) => <span key={t}><b>{v}</b> {t}</span>)}</div>
        </section>

        <section className="pp-dusk" aria-label={`${pc.name} in 3D`}>
          <StageSlot id="hero-stage" zoom={false} spin />
          {hot && (
            <button type="button" className="pp-note" onClick={() => { set({ selected: hot[0], tab: "live" }); go("pc"); }}>
              <i className="pp-note-ico">{partIcon[hot[0]]}</i>
              <span><b>{shortType(hot[1].type)} {hot[1].temp}°C</b><small>{hotNote}</small></span>
            </button>
          )}
        </section>
      </div>

      <section className="pp-sec">
        <div className="pp-rule"><span>02</span><span>This week</span></div>
        <div className="pp-sec-head">
          <h2 className="pp-h2">The week,<br />at a glance.</h2>
          <p>Lit dots are the one number that matters. Bars are each day's hottest moment: {pc.kind === "laptop" ? "the processor" : "the graphics card"} in graphite, the peak in coral, the next three days in mist.</p>
        </div>
        <div className="pp-figs">
          <div className="pp-card pp-dotcard">
            <div className="pp-cap">Peak this week</div>
            <div className="pp-dotfig">
              <DotDigits value={String(peak.v)} grow={growDots} label={`Peak temperature this week: ${peak.v}°C on ${peak.d}`} />
              <span className="pp-unit">°C</span>
            </div>
            <p className="pp-small">{pc.kind === "laptop" ? "Processor" : "Graphics card"} on {peak.d}. Safe up to {pc.kind === "laptop" ? 95 : 90}°C.</p>
          </div>
          <div className="pp-card pp-barcard">
            <div className="pp-cap">Daily peak, °C</div>
            <CapsuleBars bars={bars} grow={growBars} label={`Daily peak temperature for the last 7 days, highest ${peak.v}°C on ${peak.d}, and the next 3 days expected around ${bars[bars.length - 1].v}°C.`} />
            <div className="pp-legend"><span><i className="past" />Normal</span><span><i className="peak" />Peak</span><span><i className="forecast" />Forecast</span></div>
          </div>
        </div>
      </section>

      <div className="pp-strip">
        <div><b>Needs a look</b><span>{top ? top.title : "Nothing right now"}</span></div>
        <div><b>Last change</b><span>{lastChange ? lastChange.title : "Nothing changed yet"}</span></div>
        <div><b>Next</b><span>{nextStep[pc.id] ?? top?.action ?? "Nothing to do"}</span></div>
      </div>

      <section className="pp-sec">
        <div className="pp-rule"><span>03</span><span>Things to look at</span></div>
        <div className="pp-list">
          {issues.map((i) => (
            <button key={i.id} type="button" className={`pp-row ${i.severity}`} onClick={() => issueGo(i, pc, set, go)}>
              <i className="pp-dot" aria-hidden="true" />
              <span className="pp-row-txt"><b>{i.title}</b><small>{i.body}</small></span>
              <span className="pp-row-act">{i.action}</span>
              <span className="pp-row-go" aria-hidden="true"><Arrow /></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
