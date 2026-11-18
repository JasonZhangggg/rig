import { useRef, useState, type ReactNode } from "react";
import { HOT_MARGIN, type Game, type GameLibrary, type GameNote, type GameSession, type GameStats, type TempSubject } from "@rig/core";
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
  // The session on the chart, and the moment its readout holds: the session's peak unless a note pointed at another.
  const [picked, setPicked] = useState<{ i: number; at?: number }>({ i: sessions.length - 1 });
  const shown = sessions[Math.min(picked.i, sessions.length - 1)];
  const chartRef = useRef<HTMLElement>(null);
  /** Opens the session holding a moment Rig noted, with the readout on it. */
  const showMoment = (at: number) => {
    const i = sessions.findIndex((s) => at >= s.from && at <= s.to);
    if (i < 0) return;
    setPicked({ i, at });
    chartRef.current?.scrollIntoView({ block: "nearest" });
  };
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
          </p>
          {game.notes.length > 0 && (
            <div className="gm-notes">
              <span className="label">What Rig noticed</span>
              <ul>{game.notes.map((n) => <li key={n.kind}><Note n={n} subject={library.subject} onShow={showMoment} /></li>)}</ul>
            </div>
          )}
        </div>
        <p className="pg-lead-fig"><b className="num">{temp(game.peak, unit)}</b><span className="muted">{game.headroom == null ? "Hottest moment" : headroomWords(game.headroom, unit)}</span></p>
      </section>

      <section ref={chartRef} className="card card-pad gm-sessions" aria-label="Sessions chart">
        <div className="gm-sess-head">
          <h2>{longDay(shown.from)}, {timeRange(shown.from, shown.to)}</h2>
          <div className="legend">
            {library.subject === "gpu" && <span><i className="lg-cpu" />Processor</span>}
            <span><i className="lg-gpu" />{cap(part)}</span>
            <span><i className="lg-limit" />Safe limit</span>
          </div>
        </div>
        <SessionChart s={shown} subject={library.subject} limit={library.limit} at={picked.at} />
        <ul className="gm-sess-list" aria-label="Sessions">
          {sessions.map((s, i) => ({ s, i })).reverse().map(({ s, i }) => (
            <li key={s.from}>
              <button type="button" className="gm-sess" aria-pressed={s === shown} onClick={() => setPicked({ i })}>
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

/** A note Rig made. One about a moment shows that moment on the chart. */
function Note({ n, subject, onShow }: { n: GameNote; subject: TempSubject; onShow: (at: number) => void }) {
  const unit = useTempUnit();
  const text = noteText(n, subject, unit);
  if (n.kind !== "near-limit") return <>{text}</>;
  return <button type="button" className="gm-note-btn" onClick={() => onShow(n.at)}>{text}</button>;
}

/** The session's readings, with the readout held at its hottest moment (or the moment given). */
function SessionChart({ s, subject, limit, at }: { s: GameSession; subject: GameLibrary["subject"]; limit: number; at?: number }) {
  const unit = useTempUnit();
  if (s.points.length < 2) return <p className="muted">One reading in this session: {temp(s.peak, unit)}. Too short to chart.</p>;
  const series = subject === "gpu" ? [{ key: "cpu" as const, cls: "cpu" }, { key: "gpu" as const, cls: "gpu" }] : [{ key: "cpu" as const, cls: "gpu" }];
  const hottest = s.points.reduce((a, p) => ((p[subject] ?? -Infinity) > (a[subject] ?? -Infinity) ? p : a));
  return <LineChart points={s.points} series={series} limit={{ v: limit, label: `${temp(limit, unit)} limit` }} h={240} pin={at ?? hottest.t} label={`Temperatures, ${day(s.from)}`} />;
}
