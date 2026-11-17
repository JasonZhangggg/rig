import { useEffect, useState } from "react";
import type { Game } from "@rig/core";
import { DiffTable } from "../components/common";
import { useApp } from "../state";

export function Games() {
  const { pc, client, ask } = useApp();
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    let live = true;
    client.games(pc.id).then((g) => live && setGames(g)).catch(() => live && setGames([]));
    return () => { live = false; };
  }, [client, pc.id]);
  const head = <div className="page-head"><div><h1>Games</h1><p className="sub">Frame rates are measured on {pc.name} while you play, never guessed. Rig never touches the game itself, so anti-cheat stays happy.</p></div></div>;
  if (games == null) return <div className="page">{head}<p className="muted">Loading…</p></div>;
  if (!games.length) {
    return (
      <div className="page">
        {head}
        <section className="card card-pad empty">
          <h2 className="plain-h">No games measured yet</h2>
          <p className="muted" style={{ maxWidth: "52ch" }}>Play a game with Rig open and it shows up here with its frame rate and how smooth it was. Then Rig can suggest settings that run better on {pc.name}.</p>
          <button className="btn" type="button" onClick={() => ask("What settings should I use for my games?")}>Ask about game settings</button>
        </section>
      </div>
    );
  }
  const max = Math.max(...games.map((g) => Math.max(g.tuned?.avg ?? 0, g.now?.avg ?? 0)));
  const Bar = ({ v, tuned }: { v: number; tuned?: boolean }) => <div className={`bar${tuned ? " tuned" : ""}`}><i style={{ width: `${(v / max) * 100}%` }} /></div>;
  return (
    <div className="page">
      {head}
      <section className="card">
        {games.map((g) => (
          <div key={g.id} className="game">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><h3>{g.name}</h3><div className="faint">{g.res} · {g.measured}</div></div>
              {g.now && (
                <div className="bars">
                  <div className="bar-row"><span className="muted">Now</span><Bar v={g.now.avg} /><span className="num">{g.now.avg} fps</span></div>
                  {g.tuned && <div className="bar-row"><span>Tuned</span><Bar v={g.tuned.avg} tuned /><span className="num"><b>{g.tuned.avg}</b> fps</span></div>}
                  {g.tuned && <div className="bar-row"><span className="faint">1% low</span><span className="faint" style={{ fontSize: 12.5 }}>{g.now.low} → {g.tuned.low} fps, fewer stutters</span><span /></div>}
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {g.settings.length > 0 && <div className="diff-wrap"><DiffTable rows={g.settings} /></div>}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn sm" type="button" onClick={() => ask(`How do I set ${g.settings.map((s) => `${s[0]} to ${s[2]}`).join(", ")} in ${g.name}?`)}>How to set these</button>
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
