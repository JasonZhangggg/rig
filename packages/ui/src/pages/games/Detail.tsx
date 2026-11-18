import { useState, type ReactNode } from "react";
import { HOT_MARGIN, type Game, type GameLibrary, type GameSession, type GameStats } from "@rig/core";
import { LineChart } from "../../chart";
import { Icon } from "../../components/common";
import { useApp, useTempUnit } from "../../state";
import { headroomWords, sessionCount } from "./Library";
import { Tuning } from "./Tuning";
import { ago, cap, day, hours, longDay, moment, noteText, partName, temp, timeRange } from "./words";

interface Props {
  game: GameStats;
  library: GameLibrary;
  /** Measured frame rates and settings, when Rig has them for this game. */
  tuning?: Game;
  /** "this week" or "this month". */
  when: string;
  range: ReactNode;
  onBack: () => void;
}

/** One game over the range: its temperatures, what stands out, and each session on a chart. */
export function Detail({ game, library, tuning, when, range, onBack }: Props) {
  const { pc, ask } = useApp();
  const unit = useTempUnit();
  const part = partName(library.subject);
  const { sessions } = game;
  const [picked, setPicked] = useState(sessions.length - 1);
  const shown = sessions[Math.min(picked, sessions.length - 1)];
  const longest = sessions.reduce((a, b) => (b.hours > a.hours ? b : a));
  const question = `How can I make ${game.name} run better and cooler on ${pc.name}? While I play, the ${part} is usually ${temp(game.typical, unit)} and peaks at ${temp(game.peak, unit)}, and its safe limit is ${temp(library.limit, unit)}.`;
  const near = game.headroom != null && game.headroom <= HOT_MARGIN;
  const verdict = game.headroom == null ? `How warm ${game.name} ran` : game.headroom < 0 ? "It ran over the safe limit" : game.headroom === 0 ? "It reached the safe limit" : near ? "It came close to the safe limit" : "It ran cool";

  return (
    <div className="page pg-focus">
      <div className="page-head">
        <div>
          <button type="button" className="btn ghost sm gm-back" onClick={onBack}><Icon d="M12 4 6 10l6 6" />All games</button>
          <h1>{game.name}</h1>
          <p className="sub">{hours(game.hours)} over {sessionCount(sessions.length)} {when}, last played {ago(game.lastPlayed)}.</p>
        </div>
        <div className="gm-actions">
          {range}
          <button type="button" className="btn primary" onClick={() => ask(question)}>Ask about this game</button>
        </div>
      </div>

      <section className={`card pg-lead ${near ? "look" : "good"}`} aria-labelledby="gm-detail-h">
        <div className="pg-lead-text">
          <span className="pg-lead-tag">{near ? "Worth a look" : "All good"}</span>
          <h2 id="gm-detail-h" className="pg-lead-h">{verdict}</h2>
          <p className="pg-lead-body">
            {`The ${part} usually sits at ${temp(game.typical, unit)} while you play`}
            {game.peakAt != null ? ` and peaked at ${temp(game.peak, unit)} ${moment(game.peakAt)}, against its ${temp(library.limit, unit)} limit.` : "."}
            {` The longest session was ${hours(longest.hours)}, ${day(longest.from)}.`}
          </p>
          {game.notes.length > 0 && (
            <div className="gm-notes">
              <span className="label">What Rig noticed</span>
              <ul>{game.notes.map((n) => <li key={n.kind}>{noteText(n, library.subject, unit)}</li>)}</ul>
            </div>
          )}
        </div>
        <p className="pg-lead-fig"><b className="num">{temp(game.peak, unit)}</b><span className="muted">{game.headroom == null ? "Hottest moment" : headroomWords(game.headroom, unit)}</span></p>
      </section>

      <section className="card card-pad gm-sessions">
        <div className="gm-sess-head">
          <h2>{longDay(shown.from)}, {timeRange(shown.from, shown.to)}</h2>
          <div className="legend">
            {library.subject === "gpu" && <span><i className="lg-cpu" />Processor</span>}
            <span><i className="lg-gpu" />{cap(part)}</span>
            <span><i className="lg-limit" />Safe limit</span>
          </div>
        </div>
        <SessionChart s={shown} subject={library.subject} limit={library.limit} />
        <ul className="gm-sess-list" aria-label="Sessions">
          {sessions.map((s, i) => ({ s, i })).reverse().map(({ s, i }) => (
            <li key={s.from}>
              <button type="button" className="gm-sess" aria-pressed={s === shown} onClick={() => setPicked(i)}>
                <span>{day(s.from)}</span>
                <span className="muted">{timeRange(s.from, s.to)}</span>
                <span className="num">{hours(s.hours)}</span>
                <span className="muted">{temp(s.typical, unit)} typical, peak {temp(s.peak, unit)}</span>
                <span>{s.hot && <span className="chip warn">Ran hot</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {tuning && <Tuning game={tuning} />}
    </div>
  );
}

function SessionChart({ s, subject, limit }: { s: GameSession; subject: GameLibrary["subject"]; limit: number }) {
  const unit = useTempUnit();
  if (s.points.length < 2) return <p className="muted">One reading in this session: {temp(s.peak, unit)}. Too short to chart.</p>;
  const series = subject === "gpu" ? [{ key: "cpu" as const, cls: "cpu" }, { key: "gpu" as const, cls: "gpu" }] : [{ key: "cpu" as const, cls: "gpu" }];
  return <LineChart points={s.points} series={series} limit={{ v: limit, label: `${temp(limit, unit)} limit` }} h={240} />;
}
