import { useEffect, useMemo, useState } from "react";
import { historyRecorded, isActive, joinRecordings, limitsOf, liveRecorded, recorded, type Range as HistoryRange, type Recorded, type Recording, type RecordingInfo } from "@rig/core";
import { ChartNote } from "../../chart";
import { Icon } from "../../components/common";
import { useActions, useAppSelector, useData, useHistory, useStillPC, useUI } from "../../state";
import { useOpenLog } from "../Logs";
import { LogsHead } from "./Head";
import { AllSensors, type Band, type ChartMark } from "./Lanes";
import { CustomLogs, NowRecording, Recordings } from "./Recordings";
import { WeekStory } from "./Story";
import { clock, dayName, isPhone } from "./words";

const MIN = 60_000, HOUR = 36e5, DAY = 864e5;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** How far back the chart reaches. The first two are the live readings, the rest what Rig logged. */
export type Span = "5m" | "1h" | "6h" | "day" | "week" | "month";
export const spanWords: [Span, string][] = [["5m", "5 min"], ["1h", "1 hour"], ["6h", "6 hours"], ["day", "Day"], ["week", "Week"], ["month", "Month"]];
const spanMs: Record<Exclude<Span, "day">, number> = { "5m": 5 * MIN, "1h": HOUR, "6h": 6 * HOUR, week: 7 * DAY, month: 30 * DAY };
const isLive = (s: Span) => s === "5m" || s === "1h";
const historyRange = (s: Span): HistoryRange => (s === "month" ? "30d" : s === "week" ? "7d" : "24h");

/** About this many readings are drawn across a chart, however long it spans. */
const DRAWN = 400;

/**
 * Every reading for a short span; for a long one, the last reading of each slot, so a month isn't thousands of points a line.
 * Slots are fixed in time, so a reading stays drawn as the chart slides.
 */
export function thin<T extends { t: number }>(list: readonly T[], from: number, span: number): T[] {
  const inRange = list.filter((p) => p.t >= from - span / 10);
  const step = span / DRAWN;
  if (inRange.length <= DRAWN * 1.5) return inRange;
  const out: T[] = [];
  for (const p of inRange) {
    const slot = Math.floor(p.t / step);
    if (out.length && Math.floor(out[out.length - 1].t / step) === slot) out[out.length - 1] = p; else out.push(p);
  }
  return out;
}

/** The closer looks the recorder took between two times. */
export const looksIn = (list: RecordingInfo[], from: number, to: number) =>
  list.filter((r) => r.id.startsWith("bg-a-") && r.startedAt != null && Date.parse(r.createdAt) >= from && Date.parse(r.createdAt) < to);

/** The days of the background log that hold a stretch, fetched again whenever one of them grows. */
function useDays(need: RecordingInfo[]): Recording[] | null {
  const { client } = useActions();
  const pc = useStillPC();
  const [got, setGot] = useState<{ key: string; list: Recording[] } | null>(null);
  // A day keeps at most 360 readings, so after a few hours its count stops growing even as newer ones replace the old.
  // Its newest reading is what moves, so that's in the key too.
  const version = need.map((d) => `${d.id}|${d.finishedAt ?? ""}|${d.sampleCount}|${d.eventCount}`).join(",");
  const ids = need.map((d) => d.id).join(",");
  useEffect(() => {
    let live = true;
    if (!need.length) return;
    Promise.all(need.map((d) => client.recording(pc.id, d.id)))
      .then((list) => live && setGot({ key: ids, list: list.filter((r): r is Recording => !!r) }))
      .catch(() => live && setGot({ key: ids, list: [] }));
    return () => { live = false; };
  }, [client, pc.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return got && got.key === ids ? got.list : null;
}

/** What one stretch of the chart shows, and where its readings came from. */
interface Shown { r: Recorded | null; /** Every reading, not thinned, for each sensor's exact lowest and highest. */ whole?: Recorded | null; from: number; to: number; title: string; source: string; note?: string; live?: boolean; empty?: string }

/** Every reading on the PC, over whatever stretch you pick: the last few minutes as they come in, back to the last month. */
export function Readings() {
  const opened = useOpenLog();
  const ui = useUI();
  const pc = useStillPC();
  const full = useAppSelector((c) => c.pc, Object.is);
  const data = useData("recordings", "live");
  const [span, setSpan] = useState<Span>(ui.route === "recorded" ? "day" : ui.route === "history" ? "week" : "5m");
  const [pick, setPick] = useState(0);
  const [view, setView] = useState<"sensors" | "story">("sensors");
  // The week can also be told as a story: what stood out, and when.
  const story = view === "story" && span === "week";
  const limits = limitsOf(full);
  const days = useMemo(() => data.recordings.filter((r) => r.id.startsWith("bg-d-")).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)), [data.recordings]);
  const logged = !isLive(span) && span !== "month" && days.length > 0;
  const now = Date.now();

  // The day the arrows picked, or the last stretch of time.
  const dayInfo = span === "day" && logged ? days[Math.min(pick, days.length - 1)] : undefined;
  const from = dayInfo?.startedAt != null ? startOfDay(dayInfo.startedAt) : span === "day" ? now - DAY : now - spanMs[span];
  const to = dayInfo ? from + DAY : now;
  const need = !logged ? [] : dayInfo ? [dayInfo] : days.filter((d) => d.startedAt != null && d.startedAt < to && startOfDay(d.startedAt) + DAY > from);
  const recs = useDays(need);
  const history = useHistory(historyRange(span));

  const shown = useMemo((): Shown => {
    const title = span === "5m" ? "Last 5 minutes" : span === "1h" ? "Last hour" : span === "6h" ? "Last 6 hours" : span === "day" ? (dayInfo ? dayName(from) : "Last 24 hours") : span === "week" ? "Last 7 days" : "Last 30 days";
    if (isLive(span)) {
      const live = data.live;
      const r = live.length > 1 ? liveRecorded(full.readings ?? [], thin(live, from, to - from)) : null;
      const whole = r ? liveRecorded(full.readings ?? [], live.filter((p) => p.t >= from)) : null;
      const last = live[live.length - 1];
      const every = live.length > 1 ? Math.max(1, Math.round((last.t - live[live.length - 2].t) / 1000)) : null;
      // Rig keeps readings from when it opened, so a long span may start partway.
      const since = live[0] && live[0].t > from + 30_000 ? live[0].t : null;
      // Until then the chart starts where the readings do, so they fill it instead of sitting at its right edge.
      return {
        r: r && r.sensors.length ? r : null, whole, from: since ? Math.min(since, to - 20_000) : from, to, title, live: full.online,
        source: !full.online ? (last ? `Offline since ${clock(last.t)}` : "Offline") : every ? `A reading every ${every} s` : "Waiting for the next reading",
        note: since ? `Readings start at ${clock(since)}, when Rig opened. For earlier ones, pick 6 hours.` : undefined,
        empty: !full.online ? `${pc.name} is offline, so there's nothing live to show. Pick 6 hours or longer for what it logged.` : "Readings draw here as they come in.",
      };
    }
    if (logged) {
      if (!recs) return { r: null, from, to, title, source: "", empty: "Loading…" };
      const all = recs.length ? recorded(recs.length === 1 ? recs[0] : joinRecordings(recs)) : null;
      const inRange = all ? all.points.filter((p) => p.t >= from && p.t <= to) : [];
      const r = all && { ...all, points: thin(inRange, from, to - from) };
      const first = r?.points[0]?.t ?? from, last = r?.points.at(-1)?.t ?? to;
      // A day draws from its first reading; a stretch up to now draws all of it, so a gap shows as a gap.
      return {
        r: r && r.points.length ? r : null, title, whole: all ? { ...all, points: inRange } : null,
        from: dayInfo ? first : from, to: dayInfo ? Math.max(last, first + HOUR) : to,
        source: dayInfo ? `${clock(first)} to ${last >= to - MIN ? "midnight" : clock(last)}, every 30 s` : "Every sensor, every 30 s",
        empty: "Nothing logged in this stretch.",
      };
    }
    if (!history) return { r: null, from, to, title, source: "", empty: "Loading…" };
    const points = history.filter((p) => p.t >= from && p.t <= to);
    const r = points.length ? historyRecorded(thin(points, from, to - from)) : null;
    return {
      r, whole: r ? historyRecorded(points) : null, from, to, title, source: "Every 10 minutes while Rig was open",
      note: span !== "month" ? "Turn on the background recorder in Settings on this PC to keep every sensor every 30 seconds, even while Rig is closed." : undefined,
      empty: `Nothing logged on ${pc.name} in the last ${span === "month" ? "30 days" : span === "week" ? "7 days" : span === "day" ? "24 hours" : "6 hours"}.`,
    };
  }, [span, data.live, full.readings, full.online, recs, history, from, to, dayInfo, pc.name, logged]);

  if (opened) return opened;
  const active = data.recordings.find(isActive);
  const looks = isLive(span) ? [] : looksIn(data.recordings, from, to);
  const bands: Band[] = looks.map((l) => ({ from: l.startedAt!, to: l.finishedAt ?? l.startedAt!, kind: "look" }));
  const marks: ChartMark[] = looks.map((l) => ({ t: Date.parse(l.createdAt), look: true }));
  const live = isLive(span) && !!shown.live;

  return (
    <div className="page lg-page rd-page">
      <LogsHead sub={`Every sensor on ${pc.name}, from the last few minutes back to the last month.`} />
      {active && <NowRecording r={active} pcName={pc.name} />}
      <section className="rd-readings" aria-label="Readings">
        <div className="rd-bar">
          <div className="seg rd-spans" role="group" aria-label="How far back">
            {spanWords.map(([k, word]) => <button key={k} type="button" aria-pressed={span === k} onClick={() => { setSpan(k); setPick(0); }}>{word}</button>)}
          </div>
          {span === "week" && <div className="seg rd-views" role="group" aria-label="Show as">
            <button type="button" aria-pressed={story} onClick={() => setView("story")}>Story</button>
            <button type="button" aria-pressed={!story} onClick={() => setView("sensors")}>Sensors</button>
          </div>}
        </div>
        {!story && <div className="rc-day rd-head">
          {dayInfo && <button type="button" className="btn ghost sm icon" aria-label="Day before" disabled={pick >= days.length - 1} onClick={() => setPick(pick + 1)}><Icon d="M12 4 6 10l6 6" /></button>}
          <h2 id="rd-h" className={`rc-day-name${dayInfo ? "" : " alone"}`}>{shown.title}</h2>
          {dayInfo && <button type="button" className="btn ghost sm icon" aria-label="Day after" disabled={pick <= 0} onClick={() => setPick(pick - 1)}><Icon d="M8 4l6 6-6 6" /></button>}
          <span className="rd-source">
            {isLive(span) && <span className={`lv-badge${live ? " on" : ""}`}><i aria-hidden="true" />{live ? "Live" : "Offline"}</span>}
            {shown.source && <span className="faint" aria-live="off">{shown.source}</span>}
          </span>
        </div>}
        {story ? <WeekStory /> : !shown.r ? <ChartNote>{shown.empty ?? "Nothing to show."}</ChartNote>
          : <AllSensors r={shown.r} whole={shown.whole} from={shown.from} to={shown.to} limits={limits} bands={bands} marks={marks} compact={isPhone()} live={live} />}
        {!story && shown.r && shown.note && <p className="faint lv-since">{shown.note}</p>}
      </section>
      <div className="rc-lower">
        <Recordings />
        <CustomLogs />
      </div>
    </div>
  );
}
