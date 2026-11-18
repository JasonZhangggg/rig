import { useState } from "react";
import type { GameLibrary } from "@rig/core";
import { useTempUnit } from "../../state";
import { day, hours, temp, timeRange } from "./words";

/** The latest sittings across every game, tucked behind a button. Each opens its game. */
export function RecentSessions({ library, onOpen }: { library: GameLibrary; onOpen: (name: string) => void }) {
  const unit = useTempUnit();
  const [open, setOpen] = useState(false);
  const all = library.games.flatMap((g) => g.sessions.map((s) => ({ s, g })));
  const recent = [...all].sort((a, b) => b.s.to - a.s.to).slice(0, 6);
  return (
    <div className="pg-foot">
      <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide recent sessions" : "Show recent sessions"}
      </button>
      {open && (
        <ul className="gm-recent" aria-label="Recent sessions">
          {recent.map(({ s, g }) => (
            <li key={`${g.name}-${s.from}`}>
              <button type="button" className="gm-recent-row" onClick={() => onOpen(g.name)}>
                <span className="gm-recent-what"><b className="gm-recent-name">{g.name}</b><span className="muted">{day(s.from)}, {timeRange(s.from, s.to)}</span></span>
                <span className="num">{hours(s.hours)}</span>
                {s.hot ? <span className="gm-hot">Ran hot, {temp(s.peak, unit)}</span> : <span className="muted">Peak {temp(s.peak, unit)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
