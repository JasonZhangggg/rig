import { seenLabel, type PC } from "@rig/core";
import { useApp } from "../state";

function PCArt({ pc }: { pc: PC }) {
  return pc.kind === "laptop" ? (
    <svg viewBox="0 0 120 100" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--text-2)" }}><rect x="22" y="18" width="76" height="50" rx="4" /><path d="M12 76h96l-6 8H18z" /><rect x="30" y="26" width="60" height="34" rx="2" stroke={pc.accent} /></svg>
  ) : (
    <svg viewBox="0 0 120 100" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: "var(--text-2)" }}><rect x="36" y="8" width="48" height="84" rx="4" /><path d="M78 16v68" stroke={pc.accent} strokeWidth={3} /><circle cx="58" cy="34" r="9" /><circle cx="58" cy="62" r="9" /></svg>
  );
}

/** Every PC on the account. */
export function Web() {
  const { data, pickPC, go, toast, client } = useApp();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Your PCs</h1><p className="sub">{client.kind === "desktop" ? "Every PC signed in to your account. Open one to see its readings and history." : "Each PC sends its readings here from the Rig app."}</p></div>
        <button className="btn sm" type="button" onClick={() => toast("Install Rig on the other PC and sign in with the same account. It shows up here on its own.")}>Add a PC</button>
      </div>
      <div className="pc-cards">
        {data.pcs.map((x) => (
          <article key={x.id} className="card pc-card" style={{ ["--pc" as string]: x.accent }}>
            <div className="art"><PCArt pc={x} /><span className="glow" /></div>
            <div className="info">
              <div className="row"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="dot" /><h3>{x.name}</h3></div><span className="num" style={{ fontWeight: 600 }}>{x.health}</span></div>
              <div className="faint">{x.nickname} · {x.os}</div>
              <p className="muted" style={{ fontSize: ".93em" }}>{x.summary}</p>
              <div className="row">
                <span className={`chip${x.online ? " ok" : ""}`}>{seenLabel(x)}</span>
                <button className="btn sm" type="button" onClick={() => {
                  if (!x.parts) { toast(`${x.name} hasn't sent its details yet. Open Rig on it once.`); return; }
                  pickPC(x.id); go("overview");
                }}>Open</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
