import { HOT_MARGIN, type GameLibrary, type GameStats } from "@rig/core";
import { Icon } from "../../components/common";
import { initials } from "../overview/WeekCard";
import { ago, hours, temp } from "./words";

export const sessionCount = (n: number) => (n === 1 ? "1 session" : `${n} sessions`);

/** Peak against the safe limit, in a few words. */
export const headroomWords = (h: number) => (h > 0 ? `${h}° under the limit` : h === 0 ? "at the limit" : `${-h}° over the limit`);

export function LimitChip({ game }: { game: GameStats }) {
  if (game.headroom == null || game.headroom > HOT_MARGIN) return null;
  return <span className="chip warn">{game.headroom < 0 ? "Over the limit" : "Near the limit"}</span>;
}

/** Every game in the range, most played first. Each row opens the game. */
export function Library({ library, when, tuned, onOpen }: { library: GameLibrary; when: string; tuned: (name: string) => boolean; onOpen: (name: string) => void }) {
  const top = library.games[0]?.hours || 1;
  return (
    <section className="card">
      <div className="card-head"><h2>Most played {when}</h2><span className="faint">{hours(library.hours)} in all</span></div>
      <ul className="gm-list">
        {library.games.map((g) => (
          <li key={g.name}>
            <button type="button" className="gm-row" onClick={() => onOpen(g.name)}>
              <span className="gm-badge" aria-hidden="true">{initials(g.name) || g.name[0]}</span>
              <span className="gm-name">
                <span className="gm-title"><b>{g.name}</b><LimitChip game={g} />{tuned(g.name) && <span className="chip info no-dot">Settings to try</span>}</span>
                <span className="faint">{sessionCount(g.sessions.length)} · last played {ago(g.lastPlayed)}</span>
              </span>
              <span className="gm-hours">
                <span className="bar"><i style={{ width: `${(g.hours / top) * 100}%` }} /></span>
                <span className="num">{hours(g.hours)}</span>
              </span>
              <span className="gm-temp">
                <span><b className="num">{temp(g.typical)}</b> typical</span>
                <span className="faint">Peak {temp(g.peak)}{g.headroom != null && `, ${headroomWords(g.headroom)}`}</span>
              </span>
              <span className="gm-go"><Icon d="m8 4 6 6-6 6" /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
