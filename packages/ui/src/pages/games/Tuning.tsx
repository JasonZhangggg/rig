import type { Game } from "@rig/core";
import { DiffTable } from "../../components/common";
import { useApp } from "../../state";

/** Measured frame rates and the settings that would run better. Only for a game with measurements. */
export function Tuning({ game }: { game: Game }) {
  const { ask } = useApp();
  const max = Math.max(game.tuned?.avg ?? 0, game.now?.avg ?? 0);
  const Bar = ({ v, tuned }: { v: number; tuned?: boolean }) => <div className={`bar${tuned ? " tuned" : ""}`}><i style={{ width: `${(v / max) * 100}%` }} /></div>;
  return (
    <section className="card">
      <div className="card-head"><h2>Settings to try</h2><span className="faint">{game.res} · {game.measured}</span></div>
      <div className="game">
        {game.now ? (
          <div className="bars">
            <div className="bar-row"><span className="muted">Now</span><Bar v={game.now.avg} /><span className="num">{game.now.avg} fps</span></div>
            {game.tuned && <div className="bar-row"><span>Tuned</span><Bar v={game.tuned.avg} tuned /><span className="num"><b>{game.tuned.avg}</b> fps</span></div>}
            {game.tuned && <div className="bar-row"><span className="faint">1% low</span><span className="faint" style={{ fontSize: 12.5 }}>{game.now.low} → {game.tuned.low} fps, fewer stutters</span><span /></div>}
          </div>
        ) : <span />}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {game.settings.length > 0 && <div className="diff-wrap"><DiffTable rows={game.settings} /></div>}
          {game.settings.length > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn sm" type="button" onClick={() => ask(`How do I set ${game.settings.map((s) => `${s[0]} to ${s[2]}`).join(", ")} in ${game.name}?`)}>How to set these</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
