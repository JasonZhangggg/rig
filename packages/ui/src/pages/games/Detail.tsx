import { useState, type ReactNode } from "react";
import { HOT_MARGIN, type Game, type GameLibrary, type GameSession, type GameStats } from "@rig/core";
import { LineChart } from "../../chart";
import { Icon } from "../../components/common";
import { useApp } from "../../state";
import { sessionCount } from "./Library";
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
  const part = partName(library.subject);
  const { sessions } = game;
  const [picked, setPicked] = useState(sessions.length - 1);
  const shown = sessions[Math.min(picked, sessions.length - 1)];
  const longest = sessions.reduce((a, b) => (b.hours > a.hours ? b : a));
  const question = `How can I make ${game.name} run better and cooler on ${pc.name}? While I play, the ${part} is usually ${temp(game.typical)} and peaks at ${temp(game.peak)}, and its safe limit is ${library.limit}°C.`;
  const near = game.headroom != null && game.headroom <= HOT_MARGIN;

  return (
    <div className="page">
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

      <section className="trend">
        <div className="card card-pad">
          <div className="label">{cap(part)} while playing</div>
          <p className="num big-figure">{temp(game.typical)}</p>
          <p className="muted">Typical. {game.peakAt != null ? `The hottest moment was ${temp(game.peak)}, ${moment(game.peakAt)}.` : ""}</p>
        </div>
        <div className="card card-pad">
          <div className="label">{game.headroom == null || game.headroom > 0 ? "Below the safe limit" : game.headroom === 0 ? "At the safe limit" : "Over the safe limit"}</div>
          <p className="num big-figure" style={near ? { color: "var(--warn)" } : undefined}>{game.headroom == null ? "–" : `${Math.abs(game.headroom)}°C`}</p>
          <p className="muted">Peak {temp(game.peak)} against the {part}'s {library.limit}°C limit. {near ? "Worth a look." : "Plenty of room."}</p>
        </div>
        <div className="card card-pad">
          <div className="label">Longest session</div>
          <p className="num big-figure">{hours(longest.hours)}</p>
          <p className="muted">{day(longest.from)}. {sessions.length > 1 ? `Sessions average ${hours(game.hours / sessions.length)}.` : ""}</p>
        </div>
      </section>

      {game.notes.length > 0 && (
        <section className="card card-pad gm-notes">
          <h2>What Rig noticed</h2>
          <ul>{game.notes.map((n) => <li key={n.kind}>{noteText(n, library.subject)}</li>)}</ul>
        </section>
      )}

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
                <span className="muted">{temp(s.typical)} typical, peak {temp(s.peak)}</span>
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
  if (s.points.length < 2) return <p className="muted">One reading in this session: {temp(s.peak)}. Too short to chart.</p>;
  const series = subject === "gpu" ? [{ key: "cpu" as const, cls: "cpu" }, { key: "gpu" as const, cls: "gpu" }] : [{ key: "cpu" as const, cls: "gpu" }];
  return <LineChart points={s.points} series={series} limit={{ v: limit, label: `${limit}°C limit` }} h={240} />;
}
