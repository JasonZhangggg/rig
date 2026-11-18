import type { ReactNode } from "react";
import { formatTemp, HOT_MARGIN, type GameLibrary, type GameStats, type TempUnit } from "@rig/core";
import { useTempUnit } from "../../state";
import { Icon } from "../../components/common";
import { initials } from "../overview/WeekCard";
import { ago, hours, temp } from "./words";

export const sessionCount = (n: number) => (n === 1 ? "1 session" : `${n} sessions`);

/** Peak against the safe limit, in a few words. */
export const headroomWords = (h: number, unit: TempUnit = "c") => {
  const d = formatTemp(Math.abs(h), unit, { delta: true, mark: "degree" });
  return h > 0 ? `${d} under the limit` : h === 0 ? "at the limit" : `${d} over the limit`;
};

export function LimitChip({ game }: { game: GameStats }) {
  if (game.headroom == null || game.headroom > HOT_MARGIN) return null;
  return <span className="chip warn">{game.headroom < 0 ? "Over the limit" : "Near the limit"}</span>;
}

export type GameSort = "played" | "hot" | "recent";
const sorts: [GameSort, string][] = [["played", "Most played"], ["hot", "Hottest"], ["recent", "Recent"]];

/** The games in the chosen order: most played (as the library has them), hottest peak first, or latest played first. */
export function sortGames(games: GameStats[], sort: GameSort) {
  if (sort === "played") return games;
  return [...games].sort(sort === "recent" ? (a, b) => b.lastPlayed - a.lastPlayed : (a, b) => (b.peak ?? -Infinity) - (a.peak ?? -Infinity) || b.hours - a.hours);
}

/** Every game in the range, in the order picked in its header. Each row opens the game; anything more goes in the footer. */
export function Library({ library, when, sort, onSort, tuned, onOpen, children }: { library: GameLibrary; when: string; sort: GameSort; onSort: (s: GameSort) => void; tuned: (name: string) => boolean; onOpen: (name: string) => void; children?: ReactNode }) {
  const unit = useTempUnit();
  const top = Math.max(...library.games.map((g) => g.hours)) || 1;
  return (
    <section className="card" aria-labelledby="gm-list-h">
      <div className="card-head gm-list-head">
        <div className="gm-list-title"><h2 id="gm-list-h">Games {when}</h2><span className="faint">{hours(library.hours)} in all</span></div>
        <div className="seg gm-sort" role="group" aria-label="Sort games">
          {sorts.map(([k, label]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => onSort(k)}>{label}</button>)}
        </div>
      </div>
      <ul className="gm-list" aria-label="Games">
        {sortGames(library.games, sort).map((g) => (
          <li key={g.name}>
            <button type="button" className="gm-row" onClick={() => onOpen(g.name)}>
              <span className="gm-badge" aria-hidden="true">{initials(g.name) || g.name[0]}</span>
              <span className="gm-name">
                <span className="gm-title"><b>{g.name}</b><LimitChip game={g} /></span>
                <span className="faint">{sessionCount(g.sessions.length)}, last played {ago(g.lastPlayed)}{tuned(g.name) && <>, <span className="gm-tuned">settings to try</span></>}</span>
              </span>
              <span className="gm-hours">
                <span className="bar"><i style={{ width: `${(g.hours / top) * 100}%` }} /></span>
                <span className="num">{hours(g.hours)}</span>
              </span>
              <span className="gm-temp">
                <span><b className="num">{temp(g.typical, unit)}</b> typical</span>
                <span className="faint">Peak {temp(g.peak, unit)}{g.headroom != null && `, ${headroomWords(g.headroom, unit)}`}</span>
              </span>
              <span className="gm-go"><Icon d="m8 4 6 6-6 6" /></span>
            </button>
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}
