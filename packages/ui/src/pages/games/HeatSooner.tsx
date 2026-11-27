import type { CSSProperties } from "react";
import { HOT_MARGIN, SQUARE_MIN, type HeatBands, type HeatLevel, type HeatTrend, type SessionHeat, type TempSubject } from "@rig/core";
import { Row, Rows } from "../../components/Rows";
import { useActions, useStillPC, useTempUnit } from "../../state";
import { day, gap, partName, temp, timeRange } from "./words";

interface Props {
  game: string;
  trend: HeatTrend;
  subject: TempSubject;
  limit: number;
  /** The session the chart below shows, by its start. */
  shown: number;
  onPick: (from: number) => void;
}

const levels: HeatLevel[] = ["cool", "normal", "warm", "hot"];
/** Each level's square, written out so the stylesheet check finds every class. */
const square: Record<HeatLevel, string> = { cool: "hq hq-cool", normal: "hq hq-normal", warm: "hq hq-warm", hot: "hq hq-hot" };

/** "30 min", "2 h", "2 h 50 min". */
export const minutes = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
/** The same in words, for a sentence: "30 minutes", "2 hours 50 minutes". */
const minutesLong = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  const hh = h ? `${h} ${h === 1 ? "hour" : "hours"}` : "", mm = r ? `${r} minutes` : "";
  return [hh, mm].filter(Boolean).join(" ") || "0 minutes";
};
/** When a session first got hot, as a sentence ends: "30 minutes in", "in its first 10 minutes". */
const inAt = (m: number) => (m === 0 ? `in its first ${SQUARE_MIN} minutes` : `about ${minutesLong(m)} in`);

/**
 * Every session of a game as a row of ten-minute squares, oldest at the top, so heat arriving sooner shows as the
 * rust moving left down the rows. Beside them, what changed in a sentence, and what to do only when the readings back it.
 */
export function HeatSooner({ game, trend, subject, limit, shown, onPick }: Props) {
  const unit = useTempUnit();
  const { bands, sessions } = trend;
  const part = partName(subject);
  const cols = Math.max(...sessions.map((s) => s.squares.length), 1);
  const hour = 60 / SQUARE_MIN;
  const every = cols > 5 * hour ? 2 * hour : hour;
  const ticks = Array.from({ length: Math.ceil(cols / every) }, (_, i) => i * every);
  const latest = sessions[sessions.length - 1];

  return (
    <section className="gm-heat" aria-label="When it got hot">
      <Story game={game} trend={trend} subject={subject} limit={limit} />
      <div className="gm-heat-main">
        <div className="gm-heat-head">
          <h2>Every session, oldest at the top</h2>
          <p className="muted">Each square is {SQUARE_MIN} minutes of play, colored by how warm the {part} got. On the right, the hottest it got.</p>
        </div>
        <ul className="gm-heat-list" aria-label="Sessions" style={{ "--n": cols } as CSSProperties}>
          {sessions.map((s) => (
            <li key={s.from}>
              <button type="button" className="gm-heat-row" aria-pressed={s.from === shown} onClick={() => onPick(s.from)}>
                <span className="gm-heat-when">
                  <b>{day(s.from)}</b>
                  <span>{s.hotAfter == null ? "Never hot" : s.hotAfter === 0 ? `Hot within ${SQUARE_MIN} min` : `Hot after ${minutes(s.hotAfter)}`}</span>
                </span>
                <span className="gm-heat-sq" aria-hidden="true">
                  {s.squares.map((q) => <i key={q.at} className={q.level ? square[q.level] : "hq hq-none"} title={q.peak == null ? "No reading" : temp(q.peak, unit)} />)}
                </span>
                <span className={`gm-heat-peak num${s.peak != null && s.peak >= bands.hot ? " look" : ""}`}><span className="sr-only">peak </span>{temp(s.peak, unit)}</span>
                <span className="sr-only">, {timeRange(s.from, s.to)}{s === latest ? ", the latest" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="gm-heat-axis" aria-hidden="true" style={{ "--n": cols } as CSSProperties}>
          <span />
          <span className="gm-heat-ticks">
            {ticks.map((i) => <span key={i} style={{ gridColumn: `${i + 1} / span ${Math.min(every, cols - i)}` }}>{i === 0 ? "Start" : minutes(i * SQUARE_MIN)}</span>)}
          </span>
        </div>
        <Legend bands={bands} />
      </div>
    </section>
  );
}


function Legend({ bands }: { bands: HeatBands }) {
  const unit = useTempUnit();
  const words: Record<HeatLevel, string> = {
    cool: `Under ${temp(bands.normal, unit)}`,
    normal: `${temp(bands.normal, unit)} to ${temp(bands.warm - 1, unit)}`,
    warm: `${temp(bands.warm, unit)} to ${temp(bands.hot - 1, unit)}`,
    hot: `Hot, ${temp(bands.hot, unit)} and up`,
  };
  return <div className="legend gm-heat-legend">{levels.map((l) => <span key={l}><i className={square[l]} />{words[l]}</span>)}</div>;
}

/** What changed, in a sentence, then what to do when the readings back it. */
function Story({ game, trend, subject, limit }: { game: string; trend: HeatTrend; subject: TempSubject; limit: number }) {
  const unit = useTempUnit();
  const { ask } = useActions();
  const pc = useStillPC();
  const part = partName(subject);
  const hot = temp(trend.bands.hot, unit);
  const { story } = trend;
  /** How a session went, after "On Wed, Nov 25 it…". */
  const went = (s: SessionHeat) => (s.hotAfter == null ? `stayed under ${hot} for all ${minutesLong(s.minutes)}` : `got hot ${inAt(s.hotAfter)}`);
  const what = `Hot means ${hot} and up, within ${gap(HOT_MARGIN, unit)} of its ${temp(limit, unit)} limit.`;

  if (story.kind === "cool") {
    return (
      <div className="gm-heat-story">
        <h2 className="gm-heat-h">The {part} stayed cool</h2>
        <p className="muted">It never got within {gap(HOT_MARGIN, unit)} of its {temp(limit, unit)} limit in {story.sessions === 1 ? "this session" : `any of these ${story.sessions} sessions`}.</p>
      </div>
    );
  }
  if (story.kind === "same") {
    return (
      <div className="gm-heat-story">
        <span className="label">Same as before</span>
        <h2 className="gm-heat-h">The {part} gets hot {inAt(story.hotAfter)}</h2>
        <p className="muted">That's been about the same every session since {day(story.since)}. {what}</p>
      </div>
    );
  }
  if (story.kind === "latest") {
    const { now, range } = story;
    return (
      <div className="gm-heat-story">
        <h2 className="gm-heat-h">{now.hotAfter == null ? `Last time the ${part} stayed under ${hot}` : `Last time the ${part} got hot ${inAt(now.hotAfter)}`}</h2>
        <p className="muted">
          {range ? `Other sessions got hot anywhere from ${minutesLong(range[0])} to ${minutesLong(range[1])} in, with no clear trend.` : "A few more sessions will show whether that's changing."} {what}
        </p>
      </div>
    );
  }

  const { then, now } = story;
  const sooner = story.kind === "sooner";
  const laptop = pc.kind === "laptop";
  const weeks = Math.round((now.from - then.from) / (7 * 864e5));
  const numbers = ["Two", "Three", "Four", "Five", "Six"];
  const earlier = weeks >= 2 && weeks <= 6 ? `${numbers[weeks - 2]} weeks earlier` : `On ${day(then.from)}`;
  /** How long a session took to get hot, after "it": "took about 2 hours 50 minutes", "stayed under 82°C for all 4 hours". */
  const took = (s: SessionHeat) => (s.hotAfter == null ? `stayed under ${hot} for all ${minutesLong(s.minutes)}` : s.hotAfter === 0 ? `got hot ${inAt(0)}` : `took about ${minutesLong(s.hotAfter)}`);
  const headline = sooner
    ? `The ${part} now gets hot ${inAt(now.hotAfter!)}. ${earlier} it ${took(then)}.`
    : `The ${part} now ${now.hotAfter == null ? `stays under ${hot} for a whole session` : `gets hot ${inAt(now.hotAfter)}`}. ${earlier} it got hot ${inAt(then.hotAfter!)}.`;
  const why = trend.sameLoad == null ? null
    : !trend.sameLoad ? `It's working harder than it was (${Math.round(now.load!)}% against ${Math.round(then.load!)}%), which explains some of it.`
    : sooner ? `It works just as hard as before, so it's most likely cooling less well. ${laptop ? "Dust in the vents" : "Dust in the filters"} is the usual reason.`
    : null;
  const advise = sooner && trend.sameLoad === true;
  const question = `${game} gets my ${part} hot sooner than it did. On ${day(then.from)} it ${went(then)}; on ${day(now.from)} it ${went(now)}. How do I clean the ${laptop ? "dust out of the vents" : "dust filters"} on ${pc.name}?`;
  const figure = (s: SessionHeat) => (s.hotAfter == null ? "Never" : minutes(s.hotAfter));

  return (
    <div className="gm-heat-story">
      <span className={`label${sooner ? " look" : ""}`}>{sooner ? "Getting worse" : "Getting better"}</span>
      <h2 className="gm-heat-h">{sooner ? `${game} gets hot sooner` : `${game} takes longer to get hot`}</h2>
      <p className="muted">{headline}{why && ` ${why}`}</p>
      <div className="gm-heat-compare" role="group" aria-label="Time to get hot">
        <span className="label">Time to get hot</span>
        <span className="gm-heat-fig"><b className="num">{figure(then)}</b><span>{day(then.from)}</span></span>
        <span className="gm-heat-arrow" aria-hidden="true">→</span>
        <span className={`gm-heat-fig${sooner ? " look" : ""}`}><b className="num">{figure(now)}</b><span>{day(now.from)}</span></span>
      </div>
      {advise && (
        <Rows label="What to do">
          <Row name="Clean the dust filters" title={laptop ? "Blow the dust out of the vents" : "Clean the dust filters"}
            meta={laptop ? "A few minutes with a can of air" : "About 10 minutes with the PC off"}
            action={<button type="button" className="btn ghost sm" onClick={() => ask(question)}>How</button>} />
        </Rows>
      )}
    </div>
  );
}
