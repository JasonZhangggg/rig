import { HOT_MARGIN, type Game, type GameLibrary } from "@rig/core";
import { useTempUnit } from "../../state";
import { headroomWords } from "./Library";
import { cap, day, hours, partName, temp, timeRange } from "./words";

/** Four figures over the range: time played, sessions, the hottest game and how many came close to the limit. */
export function Strip({ library, when }: { library: GameLibrary; when: string }) {
  const unit = useTempUnit();
  const { games } = library;
  const sessions = games.flatMap((g) => g.sessions.map((s) => ({ s, g })));
  const longest = sessions.reduce((a, b) => (b.s.hours > a.s.hours ? b : a));
  const hottest = games.reduce((a, b) => ((b.peak ?? -Infinity) > (a.peak ?? -Infinity) ? b : a));
  const close = games.filter((g) => g.headroom != null && g.headroom <= HOT_MARGIN);
  const part = partName(library.subject);
  return (
    <section className="gm-strip" aria-label={`Your games ${when}`}>
      <Figure label={`Played ${when}`} figure={hours(library.hours)} note={games.length === 1 ? "1 game" : `${games.length} games`} />
      <Figure label="Sessions" figure={String(sessions.length)} note={`Longest ${hours(longest.s.hours)}, ${longest.g.name}`} />
      <Figure label="Hottest game" figure={temp(hottest.peak, unit)} note={`${hottest.name}${hottest.headroom != null ? `, ${headroomWords(hottest.headroom, unit)}` : ""}`} look={hottest.headroom != null && hottest.headroom <= HOT_MARGIN} />
      <Figure
        label="Near the limit"
        figure={close.length === 1 ? "1 game" : `${close.length} games`}
        note={close.length ? close.map((g) => g.name).join(", ") : `${cap(part)} stayed well under its ${temp(library.limit, unit)} limit`}
        look={close.length > 0}
      />
    </section>
  );
}

function Figure({ label, figure, note, look }: { label: string; figure: string; note: string; look?: boolean }) {
  return (
    <div className={`card gm-figure${look ? " look" : ""}`}>
      <span className="label">{label}</span>
      <b className="num">{figure}</b>
      <span className="muted">{note}</span>
    </div>
  );
}

/** The latest sittings across every game. Each opens its game. */
export function RecentSessions({ library, onOpen }: { library: GameLibrary; onOpen: (name: string) => void }) {
  const unit = useTempUnit();
  const recent = library.games.flatMap((g) => g.sessions.map((s) => ({ s, g }))).sort((a, b) => b.s.to - a.s.to).slice(0, 6);
  return (
    <section className="card card-pad rail-card">
      <h2>Recent sessions</h2>
      <ul className="gm-recent" aria-label="Recent sessions">
        {recent.map(({ s, g }) => (
          <li key={`${g.name}-${s.from}`}>
            <button type="button" className="gm-recent-row" onClick={() => onOpen(g.name)}>
              <b className="gm-recent-name">{g.name}</b>
              <span className="faint">{day(s.from)}, {timeRange(s.from, s.to)}</span>
              <span className="gm-recent-fig"><span className="num">{hours(s.hours)}</span>{s.hot ? <span className="gm-hot">Ran hot, {temp(s.peak, unit)}</span> : <span className="faint">peak {temp(s.peak, unit)}</span>}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Games Rig measured frame rates for, with what the suggested settings would give. Each opens its game. */
export function Measured({ library, tuning, onOpen }: { library: GameLibrary; tuning: (name: string) => Game | undefined; onOpen: (name: string) => void }) {
  const list = library.games.map((g) => tuning(g.name)).filter((g): g is Game => !!g);
  if (!list.length) return null;
  return (
    <section className="card">
      <div className="card-head"><h2>Settings to try</h2><span className="faint">{list.length === 1 ? "1 game" : `${list.length} games`}</span></div>
      <ul className="gm-measured">
        {list.map((g) => (
          <li key={g.id}>
            <button type="button" className="gm-measured-row" onClick={() => onOpen(g.name)}>
              <span className="gm-recent-name">{g.name}</span>
              <span className="muted">{g.settings.length === 1 ? "1 setting to change" : `${g.settings.length} settings to change`}{g.res ? `, ${g.res}` : ""}</span>
              {g.now && <span className="gm-fps num">{g.now.avg}{g.tuned && <> → <b>{g.tuned.avg}</b></>} fps</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
