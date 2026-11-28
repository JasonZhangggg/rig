import { useMemo } from "react";
import { graphicsWord, insightContext, type PC, weekStory, type StoryMark, type WeekStory as Story } from "@rig/core";
import { ChartNote } from "../../chart";
import { Row, Rows } from "../../components/Rows";
import { useActions, useData, useHistory, useStillPC, useTemp, useTempText } from "../../state";
import { useEvents } from "../Logs";
import { useWidth } from "./Lanes";
import { clock } from "./words";
import { dateText } from "../../dateText";

type Temp = ReturnType<typeof useTemp>;

const MIN = 60_000, DAY = 864e5, WINDOW = 10 * MIN;
const hours = (h: number) => `${Math.round(h * 2) / 2} h`;
const flagText = (m: StoryMark, temp: Temp) => m.label.replace("{temp}", m.temp == null ? "" : temp(m.temp, { mark: "degree" }));

/** The week on one screen: a sentence on what stood out, three figures against the week before, the week's chart and what happened. */
export function WeekStory() {
  const pc = useStillPC();
  const history = useHistory("30d");
  const events = useEvents();
  const { changes, recordings } = useData("changes", "recordings");
  const temp = useTemp();
  const text = useTempText();
  const { go, openRecording } = useActions();
  const cpu = pc.parts?.cpu?.limit, gpu = pc.parts?.gpu?.limit;
  const story = useMemo(() => history && events
    ? weekStory({ points: history, events, changes, recordings }, insightContext({ kind: pc.kind, parts: { cpu: { limit: cpu }, gpu: { limit: gpu } } }, Date.now()))
    : null, [history, events, changes, recordings, pc.kind, cpu, gpu]);

  if (!story) return <ChartNote busy>Loading…</ChartNote>;
  const { figures: f, headline } = story;
  const deg = (v: number | null) => temp(v, { mark: "degree" });
  return (
    <section className="ws" aria-labelledby="ws-h">
      <div className="ws-top">
        <div className="ws-say">
          <p className="ws-eyebrow">This week on {pc.name}</p>
          <h2 id="ws-h" className="ws-headline">{headline.lead}{headline.rest && <> <span className="ws-rest">{text(headline.rest)}</span></>}</h2>
        </div>
        {story.points.length > 0 && (
          <div className="ws-figs" role="group" aria-label="This week against the week before">
            <Figure value={deg(f.resting.now)} word="resting" before={f.resting.before == null ? null : `${deg(f.resting.before)} before`} look={f.resting.look} />
            <Figure value={f.played.now == null ? "–" : hours(f.played.now)} word="played" before={f.played.before == null ? null : `${hours(f.played.before)} last week`} />
            <Figure value={deg(f.hottest.now)} word="hottest" before={f.hottest.before == null ? null : `${deg(f.hottest.before)} last week`} look={f.hottest.look} />
          </div>
        )}
      </div>
      {story.points.length > 0 ? <WeekChart story={story} temp={temp} kind={pc.kind} /> : <ChartNote>{`Nothing logged on ${pc.name} in the last 7 days.`}</ChartNote>}
      {story.marks.length > 0 && (
        <Rows label="What happened this week">
          {[...story.marks].reverse().map((m) => (
            <Row
              key={`${m.kind}${m.t}`} name={m.title} at={new Date(m.t).toISOString()}
              time={<>{dateText(new Date(m.t), { weekday: "short", month: "short", day: "numeric" })}<span>{clock(m.t)}</span></>}
              title={<span className={m.look ? "ws-look" : undefined}>{text(m.title)}</span>}
              meta={text(m.detail)}
              action={<>
                {m.changeId && <button type="button" className="btn ghost sm" onClick={() => go("changes")}>See the change</button>}
                {m.recordingId && <button type="button" className="btn ghost sm" onClick={() => openRecording(m.recordingId!)}>Recording</button>}
                {m.logged && <button type="button" className="btn ghost sm" onClick={() => go("events")}>In Events</button>}
                {m.kind === "hot" && !m.logged && <button type="button" className="btn ghost sm" onClick={() => go("games")}>In Games</button>}
              </>}
            />
          ))}
        </Rows>
      )}
    </section>
  );
}

function Figure({ value, word, before, look }: { value: string; word: string; before: string | null; look?: boolean }) {
  return (
    <p className={`ws-fig${look ? " look" : ""}`}>
      <b className="num">{value}</b>
      <span>{word}{before && <> · <span className="num">{before}</span></>}</span>
    </p>
  );
}

/** A flag's label, placed in a row over the chart that its words and stem don't cross. */
interface Flag { m: StoryMark; x: number; v: number | null; row: number; a: number; b: number; end: boolean; text: string }

function placeFlags(marks: StoryMark[], x: (t: number) => number, value: (t: number) => number | null, temp: Temp, left: number, right: number, rows: number): Flag[] {
  const placed: Flag[] = [];
  const out: Flag[] = [];
  for (const m of marks) {
    const px = x(m.t), text = flagText(m, temp), w = text.length * 6.7 + 6;
    const end = px + 5 + w > right && px - 5 - w >= left;
    const a = end ? px - 5 - w : px + 5, b = end ? px - 5 : px + 5 + w;
    let row = -1;
    for (let r = 0; r < rows && row < 0; r++) {
      const clash = placed.some((p) => (p.row === r && p.a < b + 8 && a < p.b + 8) || (p.row < r && px >= p.a - 4 && px <= p.b + 4) || (p.row > r && p.x >= a - 4 && p.x <= b + 4));
      if (!clash) row = r;
    }
    const f = { m, x: px, v: value(m.t), row, a, b, end, text };
    if (row >= 0) placed.push(f);
    out.push(f);
  }
  return out;
}

function WeekChart({ story, temp, kind }: { story: Story; temp: Temp; kind: PC["kind"] }) {
  const [ref, w] = useWidth<HTMLDivElement>(900);
  const narrow = w < 560;
  const rowH = 18;
  const pad = { l: 34, r: 6 };
  const t0 = story.days[0], t1 = story.days[6] + DAY;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const valueAt = (t: number) => story.points.find((p) => p.t <= t && t < p.t + WINDOW)?.v ?? null;
  const flags = placeFlags(story.marks, x, valueAt, temp, pad.l, w - pad.r, 3);
  // Only as many rows of labels as the flags need.
  const rows = Math.max(1, ...flags.map((f) => f.row + 1));
  const top = rows * rowH + 10, ph = narrow ? 150 : 190, h = top + ph + 26;

  const vals = [...story.points.map((p) => p.v), ...story.resting].filter((v): v is number => v != null);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 4) / 10) * 10);
  const hi = Math.ceil((Math.max(...vals, story.hotLine) + 4) / 10) * 10;
  const y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
  const base = top + ph;

  const bars = useMemo(() => {
    const d = { desktop: "", game: "", hot: "" };
    for (const p of story.points) {
      if (p.v == null) continue;
      const a = x(p.t), bw = Math.max(0.6, x(p.t + WINDOW) - a + 0.3).toFixed(2), cap = Math.max(p.v, lo);
      const kind = p.game ? "game" : "desktop";
      d[kind] += `M${a.toFixed(2)} ${base}V${y(Math.min(cap, story.hotLine)).toFixed(1)}h${bw}V${base}Z`;
      if (cap > story.hotLine) d.hot += `M${a.toFixed(2)} ${y(story.hotLine).toFixed(1)}V${y(cap).toFixed(1)}h${bw}V${y(story.hotLine).toFixed(1)}Z`;
    }
    return d;
  }, [story, w, lo, hi]); // eslint-disable-line react-hooks/exhaustive-deps

  // The resting temperature, one step a day.
  let rest = "";
  let prev: number | null = null;
  story.resting.forEach((r, i) => {
    if (r == null) { prev = null; return; }
    const a = x(story.days[i]), b = x(Math.min(story.days[i] + DAY, story.to));
    rest += prev == null ? `M${a.toFixed(1)} ${y(r).toFixed(1)}` : `V${y(r).toFixed(1)}`;
    rest += `H${b.toFixed(1)}`;
    prev = r;
  });
  const firstRest = story.resting.findIndex((r) => r != null);
  const lastRest = story.resting.length - 1 - [...story.resting].reverse().findIndex((r) => r != null);
  const restLabels = firstRest < 0 ? [] : [firstRest, ...(!narrow && lastRest > firstRest && story.resting[lastRest] !== story.resting[firstRest] ? [lastRest] : [])];

  const grid: number[] = [];
  for (let v = Math.ceil(lo / 20) * 20; v <= hi; v += 20) if (Math.abs(v - story.hotLine) >= 6) grid.push(v);
  const dayLabel = (d: number, i: number) => {
    if (i === 6) return narrow ? "Now" : "Today";
    const day = new Date(d), name = dateText(day, { weekday: narrow ? "narrow" : "short" });
    return narrow ? name : `${name} ${day.getDate()}`;
  };
  const hotDeg = temp(story.hotLine, { mark: "degree" });

  return (
    <div className="ws-chart">
      <ul className="ws-key" aria-label="Key">
        <li><i className="ws-sw ws-desk" />Desktop</li>
        <li><i className="ws-sw ws-game" />Games</li>
        <li><i className="ws-sw ws-hot" />Close to its limit, {hotDeg} and up</li>
        <li><i className="ws-sw ws-resting" />Resting temperature</li>
      </ul>
      <div ref={ref} className="ws-plot">
        <svg width={w} height={h} role="img" aria-label={`${story.subject === "gpu" ? graphicsWord(kind) : "Processor"} temperature, last 7 days`}>
          {grid.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
              <text x={pad.l - 6} y={y(v) + 4} className="chart-tick" textAnchor="end">{temp(v, { mark: "degree" })}</text>
            </g>
          ))}
          {story.days.slice(1).map((d) => <line key={d} x1={x(d)} x2={x(d)} y1={top - 4} y2={base} className="ws-day" />)}
          <path d={bars.desktop} className="ws-bar ws-desk" />
          <path d={bars.game} className="ws-bar ws-game" />
          <path d={bars.hot} className="ws-bar ws-hot" />
          <line x1={pad.l} x2={w - pad.r} y1={y(story.hotLine)} y2={y(story.hotLine)} className="ws-hotline" />
          <text x={pad.l - 6} y={y(story.hotLine) + 4} className="chart-tick ws-hottick" textAnchor="end">{hotDeg}</text>
          <path d={rest} className="ws-rest-line" />
          {restLabels.map((i) => (
            <text key={i} x={x(story.days[i]) + 4} y={y(story.resting[i]!) - 7} className="ws-rest-label">Resting at {temp(story.resting[i], { mark: "degree" })}</text>
          ))}
          {flags.map((f) => {
            const end = f.v == null ? base : y(f.v);
            const from = f.row < 0 ? end - 14 : (rows - 1 - f.row) * rowH + 2;
            return (
              <g key={`${f.m.kind}${f.m.t}`} className={`ws-flag${f.m.look ? " look" : ""}`}>
                <line x1={f.x} x2={f.x} y1={from} y2={end - 3} />
                <rect x={f.x - 3} y={end - 3} width={6} height={6} />
                {f.row >= 0 && <text x={f.end ? f.b : f.a} y={from + 11} textAnchor={f.end ? "end" : "start"}>{f.text}</text>}
              </g>
            );
          })}
          {story.days.map((d, i) => (
            <text key={d} x={(x(d) + x(d + DAY)) / 2} y={h - 6} className={`chart-tick ws-dayname${i === 6 ? " today" : ""}`} textAnchor="middle">{dayLabel(d, i)}</text>
          ))}
        </svg>
      </div>
    </div>
  );
}
