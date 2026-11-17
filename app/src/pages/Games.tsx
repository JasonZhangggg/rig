import { games } from "../data";
import { DiffTable } from "../components/common";
import { useApp } from "../state";

export function Games() {
  const { pc, set } = useApp();
  if (pc.kind === "laptop") {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Games</h1><p className="sub">Tuning is measured on your PC, never guessed, and never touches the game itself.</p></div></div>
        <section className="card card-pad empty">
          <h2 className="plain-h">No games found on {pc.name}</h2>
          <p className="muted" style={{ maxWidth: "46ch" }}>Rig looks in Steam, Epic, Xbox and Battle.net. Install a game and it shows up here with tuned settings.</p>
          <button className="btn" type="button" onClick={() => set({ pcId: "atlas", selected: null })}>See Atlas's games</button>
        </section>
      </div>
    );
  }
  const max = Math.max(...games.map((g) => g.tuned.avg));
  const Bar = ({ v, tuned }: { v: number; tuned?: boolean }) => <div className={`bar${tuned ? " tuned" : ""}`}><i style={{ width: `${(v / max) * 100}%` }} /></div>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Games</h1><p className="sub">Settings are measured on {pc.name} with real benchmark runs. Rig only changes game settings files, never the game itself.</p></div></div>
      <section className="card">
        {games.map((g) => (
          <div key={g.name} className="game">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><h3>{g.name}</h3><div className="faint">{g.res} · {g.measured}</div></div>
              <div className="bars">
                <div className="bar-row"><span className="muted">Now</span><Bar v={g.now.avg} /><span className="num">{g.now.avg} fps</span></div>
                <div className="bar-row"><span>Tuned</span><Bar v={g.tuned.avg} tuned /><span className="num"><b>{g.tuned.avg}</b> fps</span></div>
                <div className="bar-row"><span className="faint">1% low</span><span className="faint" style={{ fontSize: 12.5 }}>{g.now.low} → {g.tuned.low} fps, fewer stutters</span><span /></div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="diff-wrap"><DiffTable rows={g.settings} /></div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn primary sm" type="button" onClick={() => set({ modal: { kind: "game", title: `Apply tuned settings for ${g.name}?`, body: `Measured ${g.now.avg} → ${g.tuned.avg} fps average on this PC.`, rows: g.settings, cta: "Apply settings" } })}>Apply tuned settings</button>
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
