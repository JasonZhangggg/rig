// A recording that caught a problem: what happened and its most likely cause first, then the temperature it followed
// against the game's usual range, what the recording rules out, and what to do. The figures come from caughtProblem.
import { useMemo, useState } from "react";
import { RECORD_HOT_MARGIN, smoothed, toUnit, type Caught, type RecordingInfo, type RecordingSample } from "@rig/core";
import { Row, Rows } from "../../components/Rows";
import { useActions, useData, useStillPC, useTemp, useTempText, useTempUnit } from "../../state";
import { useWidth } from "./Lanes";
import { clock, dayName, isPhone } from "./words";

const MIN = 60_000;
const lower = (s: string) => s[0].toLowerCase() + s.slice(1);
const roughly = (ms: number) => { const s = Math.round(ms / 1000); return s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} minutes`; };

/** The lead: what it caught, the most likely cause, and the times Windows logged it before. */
export function CaughtLead({ caught }: { caught: Caught }) {
  const inUnit = useTempText();
  const before = caught.earlier[0];
  const again = before
    ? ` Windows logged the same ${caught.event.kind === "driver" ? "reset" : lower(caught.moment)} on ${dayName(before.t)}${caught.earlier.length > 1 ? ` and ${caught.earlier.length - 1} more time${caught.earlier.length > 2 ? "s" : ""} before that` : ""}, when Rig wasn't recording.`
    : "";
  return (
    <section className={`cg-lead${caught.cause === "heat" ? " look" : ""}`} aria-labelledby="cg-lead-h">
      <p className="cg-eyebrow">What it caught</p>
      <h2 id="cg-lead-h" className="cg-headline">{caught.headline}</h2>
      <p className="cg-summary">{inUnit(caught.summary)}{again}</p>
    </section>
  );
}

/** The part's temperature over the recording, with the game's usual range shaded, the stretch above it in rust and the moment marked. */
export function CaughtChart({ samples, caught, limit, minutes }: { samples: RecordingSample[]; caught: Caught; limit?: number; minutes: number }) {
  const [ref, w] = useWidth<HTMLDivElement>(860);
  const unit = useTempUnit();
  const temp = useTemp();
  const compact = w < 560 || isPhone();
  const part = caught.part;
  const name = part === "gpu" ? "Graphics card" : "Processor";
  const usualText = caught.usualAt ? `Your normal in ${caught.usualAt.game}, ${temp(caught.usualAt.lo, { mark: "none" })} to ${temp(caught.usualAt.hi)}` : null;
  return (
    <section className="card card-pad cg-chart" aria-labelledby="cg-chart-h">
      <div className="gm-sess-head">
        <h2 id="cg-chart-h">The {minutes} minutes Rig recorded</h2>
        <div className="legend cg-legend">
          {caught.usual.length > 0 && <span><i className="cg-sw-usual" />{caught.usual.length === 1 ? usualText : "Your normal for what was playing"}</span>}
          {caught.above.length > 0 && <span><i className="cg-sw-above" />{caught.measure === "usual" ? "Above your normal" : "Near its limit"}</span>}
          <span><i className="cg-sw-moment" />{caught.moment}</span>
        </div>
      </div>
      <div ref={ref}>
        <ChartSvg samples={samples} caught={caught} limit={limit} w={w} compact={compact} unit={unit} name={name} />
      </div>
    </section>
  );
}

function ChartSvg({ samples: all, caught, limit, w, compact, unit, name }: { samples: RecordingSample[]; caught: Caught; limit?: number; w: number; compact: boolean; unit: ReturnType<typeof useTempUnit>; name: string }) {
  const temp = useTemp();
  const part = caught.part;
  const g = useMemo(() => {
    // The line draws each reading averaged over a minute, the same way the stretches above were found, so it reads calmly.
    const sorted = all.filter((s) => s[part] != null).sort((a, b) => a.t - b.t);
    if (sorted.length < 2) return null;
    const sm = smoothed(sorted, part);
    const samples = sorted.map((s) => ({ ...s, [part]: sm.get(s.t) ?? s[part] }));
    const cv = (c: number) => toUnit(c, unit);
    const lanes = segments(samples);
    const showLane = lanes.some((l) => l.game);
    const laneH = showLane ? 22 : 0;
    const pad = { l: compact ? 34 : 46, r: compact ? 8 : 16, t: laneH + (compact ? 30 : 46), b: 26 };
    const h = compact ? 250 : 320;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
    const vals = samples.map((s) => cv(s[part]!));
    for (const u of caught.usual) vals.push(cv(u.lo), cv(u.hi));
    if (limit != null) vals.push(cv(limit));
    const step = unit === "f" ? 10 : 5;
    const yMin = Math.floor((Math.min(...vals) - step / 2) / step) * step;
    const yMax = Math.ceil((Math.max(...vals) + 1) / step) * step;
    const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * iw;
    const yv = (v: number) => pad.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    const y = (c: number) => yv(cv(c));
    const grid: number[] = [];
    const gridStep = yMax - yMin > step * 5 ? step * 2 : step;
    for (let v = Math.ceil(yMin / gridStep) * gridStep; v <= yMax; v += gridStep) grid.push(v);
    const every = (t1 - t0 <= 70 * MIN ? (compact && t1 - t0 > 30 * MIN ? 20 : 10) : 30) * MIN;
    const ticks: number[] = [];
    for (let t = Math.ceil(t0 / every) * every; t <= t1; t += every) ticks.push(t);
    let line = "", prev: RecordingSample | null = null;
    // A pause of more than three readings breaks the line, as the PC was off or not reading.
    const gap = Math.max(5000, Math.min(...samples.slice(1).map((s, i) => s.t - samples[i].t))) * 3;
    for (const s of samples) { line += `${!prev || s.t - prev.t > gap ? "M" : "L"}${x(s.t).toFixed(1)},${y(s[part]!).toFixed(1)}`; prev = s; }
    // Each stretch above: the area between the line and the top of the usual range (or the line near the limit).
    const floorOf = (s: RecordingSample) => caught.measure === "usual" ? caught.usual.find((u) => u.game === s.game)?.hi ?? null : limit != null ? limit - RECORD_HOT_MARGIN : null;
    const areas = caught.above.map((a) => {
      const inside = samples.filter((s) => s.t >= a.from && s.t <= a.to && floorOf(s) != null);
      if (inside.length < 2) return "";
      const top = inside.map((s) => `${x(s.t).toFixed(1)},${y(Math.max(s[part]!, floorOf(s)!)).toFixed(1)}`);
      const bottom = [...inside].reverse().map((s) => `${x(s.t).toFixed(1)},${y(floorOf(s)!).toFixed(1)}`);
      return `M${top.join("L")}L${bottom.join("L")}Z`;
    });
    const bands = lanes.flatMap((l) => { const u = caught.usual.find((r) => r.game === l.game); return u ? [{ from: l.from, to: l.to, u }] : []; });
    return { samples, lanes, showLane, laneH, pad, h, ih, t0, t1, x, y, yv, grid, ticks, line, areas, bands };
  }, [all, part, caught, limit, w, compact, unit]);
  if (!g) return null;
  const { lanes, showLane, laneH, pad, h, ih, t0, t1, x, y, yv, grid, ticks, line, areas, bands } = g;
  const ev = caught.event.t;
  const evX = x(Math.min(Math.max(ev, t0), t1));
  const barW = Math.max(3, caught.stall ? x(caught.stall.to) - x(caught.stall.from) : 3);
  const right = evX > w * 0.55;
  const evLine2 = caught.stall ? `The graphics card's load fell to ${caught.stall.load}% for ${roughly(caught.stall.to - caught.stall.from)}` : lower(caught.what).replace(/^./, (c) => c.toUpperCase());
  const start = caught.during ?? caught.above[0];
  const startS = start ? g.samples.find((s) => s.t >= start.from) : undefined;
  const band0 = bands[bands.length - 1];
  const label = `${name} temperature during the recording, with ${caught.moment.toLowerCase()} at ${clock(ev)}`;
  return (
    <svg className="chart cg-svg" viewBox={`0 0 ${w} ${h}`} style={{ height: h }} role="img" aria-label={label}>
      {showLane && (
        <g className="cg-lane">
          {!compact && <text x={pad.l - 8} y={15} textAnchor="end" className="chart-tick">Playing</text>}
          {lanes.filter((l) => l.game).map((l) => {
            const lx = x(l.from), lw = Math.max(2, x(l.to) - lx);
            return (
              <g key={l.from}>
                <rect x={lx} y={0} width={lw} height={laneH} rx={4} className="cg-lane-bar" />
                {lw > 90 && <text x={lx + 8} y={15} className="cg-lane-text">{l.game}</text>}
              </g>
            );
          })}
        </g>
      )}
      {bands.map((b) => <rect key={b.from} x={x(b.from)} y={y(b.u.hi)} width={Math.max(2, x(b.to) - x(b.from))} height={Math.max(2, y(b.u.lo) - y(b.u.hi))} className="cg-band" />)}
      {grid.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={w - pad.r} y1={yv(v)} y2={yv(v)} className="chart-grid" />
          <text x={pad.l - 8} y={yv(v) + 4} className="chart-tick" textAnchor="end">{v}°</text>
        </g>
      ))}
      {ticks.map((t) => <text key={t} x={x(t)} y={h - 6} className="chart-tick" textAnchor={x(t) < pad.l + 30 ? "start" : x(t) > w - pad.r - 30 ? "end" : "middle"}>{clock(t)}</text>)}
      {limit != null && (
        <>
          <line x1={pad.l} x2={w - pad.r} y1={y(limit)} y2={y(limit)} className="chart-limit" />
          {!compact && <text x={pad.l + 6} y={y(limit) - 6} className="chart-tick chart-limit-label">{temp(limit)} safe limit</text>}
        </>
      )}
      {areas.map((d, i) => d && <path key={i} d={d} className="cg-above" />)}
      <path d={line} className="cg-line" vectorEffect="non-scaling-stroke" />
      {band0 && !compact && x(band0.to) - Math.max(x(band0.from), evX + barW) > 260 && (
        <text x={x(band0.to) - 8} y={y(band0.u.lo) + 16} textAnchor="end" className="cg-band-label">Your normal, {temp(band0.u.lo, { mark: "none" })} to {temp(band0.u.hi)}</text>
      )}
      {startS && !compact && Math.abs(x(startS.t) - evX) > 40 && (
        <g className="cg-pin">
          <line x1={x(startS.t)} x2={x(startS.t)} y1={y(startS[part]!)} y2={y(Math.min(startS[part]!, ...(caught.usual.map((u) => u.lo)))) + 20} />
          <circle cx={x(startS.t)} cy={y(startS[part]!)} r={4} />
          <text x={x(startS.t)} y={y(Math.min(startS[part]!, ...(caught.usual.map((u) => u.lo)))) + 34} textAnchor="middle">
            <tspan className="cg-pin-b">{clock(startS.t)}</tspan> {caught.measure === "usual" ? "Goes above your normal" : "Comes near its limit"}
          </text>
        </g>
      )}
      <rect x={evX} y={pad.t - (compact ? 26 : 40)} width={barW} height={ih + (compact ? 26 : 40)} className="cg-moment" />
      <text x={right ? evX - 8 : evX + barW + 8} y={pad.t - (compact ? 14 : 26)} textAnchor={right ? "end" : "start"} className="cg-moment-t">
        {clock(ev)} · {caught.moment}
      </text>
      {!compact && <text x={right ? evX - 8 : evX + barW + 8} y={pad.t - 9} textAnchor={right ? "end" : "start"} className="cg-moment-s">{evLine2}</text>}
    </svg>
  );
}

/** What was in front over the recording: one run per game, and the stretches with none. */
function segments(samples: RecordingSample[]): { from: number; to: number; game: string | null }[] {
  const out: { from: number; to: number; game: string | null }[] = [];
  for (const s of samples) {
    const last = out[out.length - 1];
    const game = s.game ?? null;
    if (last && last.game === game) last.to = s.t;
    else { if (last) last.to = s.t; out.push({ from: s.t, to: s.t, game }); }
  }
  return out;
}

/** What it ruled out: the processor, memory, other apps and the power, each with what Rig read. */
export function CaughtChecks({ caught }: { caught: Caught }) {
  const inUnit = useTempText();
  const all = caught.checks.every((c) => c.ok);
  if (!caught.checks.length) return null;
  return (
    <section className="card card-pad cg-card" aria-labelledby="cg-checks-h">
      <div className="cg-card-head">
        <h2 id="cg-checks-h">{all ? "What it ruled out" : "What else Rig checked"}</h2>
        <p className="muted">{all ? "Rig watched everything else at the same time. None of it was out of the ordinary." : "Rig watched everything else at the same time."}</p>
      </div>
      <ul className="cg-checks">
        {caught.checks.map((c) => (
          <li key={c.id} className={c.ok ? "ok" : "look"}>
            {c.ok ? <svg className="cg-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg> : <span className="cg-dot" aria-hidden="true" />}
            <span className="cg-check-body">
              <b>{c.ok ? <span className="sr-only">Ruled out: </span> : <span className="sr-only">Needs a look: </span>}{inUnit(c.title)}</b>
              <span>{inUnit(c.detail)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What to do: bring the heat down and check with the next recording, or record the next time when the cause isn't clear. */
export function CaughtTodo({ caught, info }: { caught: Caught; info: RecordingInfo }) {
  const { client, startRecording, toast, ask } = useActions();
  const pc = useStillPC();
  const data = useData("recordings", "answering");
  const [starting, setStarting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const recording = data.recordings.some((r) => r.state === "pending" || r.state === "recording");
  const end = info.finishedAt ?? info.endsAt ?? caught.event.t;
  const cleaned = pc.cleanedAt && Date.parse(pc.cleanedAt) > end ? Date.parse(pc.cleanedAt) : null;
  const game = caught.game;
  const record = () => {
    setStarting(true);
    const why = `Check ${caught.part === "gpu" ? "the graphics card" : "the processor"}${game ? ` in ${game}` : ""} after ${caught.moment.toLowerCase()} on ${new Date(caught.event.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`;
    void startRecording(info.minutes, why).finally(() => setStarting(false));
  };
  const clean = () => {
    setCleaning(true);
    client.rename(pc.id, { cleanedAt: new Date().toISOString() }).catch(() => toast("Couldn't save that. Try again.")).finally(() => setCleaning(false));
  };
  const recordRow = (title: string, meta: string) => (
    <Row name={title} title={title} meta={recording ? "Recording now. It shows in Logs." : meta}
      action={!recording && <button type="button" className="btn ghost sm" disabled={starting} onClick={record}>{starting ? "Starting…" : "Record"}</button>} />
  );
  const heat = caught.cause === "heat";
  return (
    <section className="card card-pad cg-card" aria-labelledby="cg-todo-h">
      <div className="cg-card-head">
        <h2 id="cg-todo-h">What to do</h2>
        <p className="muted">{heat ? "Bring the heat down, then check." : "Catch it again, with more to go on."}</p>
      </div>
      <Rows label="What to do">
        {heat && (
          <Row name="Clean the dust filters and fans" title="Clean the dust filters and fans"
            meta={cleaned ? `You cleaned it ${({ Today: "today", Yesterday: "yesterday" } as Record<string, string>)[dayName(cleaned)] ?? `on ${dayName(cleaned)}`}. Record a game to check.` : `It ran ${caught.measure === "usual" ? "above your normal" : "close to its limit"} here. Dust is the usual cause.`}
            action={!cleaned && <button type="button" className="btn ghost sm" disabled={cleaning} onClick={clean}>I cleaned it</button>} />
        )}
        {heat ? recordRow("Record your next game", `${info.minutes} minutes, to check it stays in your normal range`) : recordRow("Record the next time you play", `${info.minutes} minutes. Rig keeps the same readings`)}
        {!heat && !info.background && (
          <Row name="Ask Rig about it" title="Ask Rig about it" meta="It reads this recording and the event log"
            action={<button type="button" className="btn ghost sm" disabled={data.answering} onClick={() => ask(`Look at the recording "${info.reason}". What could have caused ${caught.what}?`)}>Ask</button>} />
        )}
      </Rows>
    </section>
  );
}
