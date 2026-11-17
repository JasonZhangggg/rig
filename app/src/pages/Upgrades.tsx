import { upgrades, type Upgrade } from "../data";
import { useApp } from "../state";

const fitChip: Record<Upgrade["fit"], JSX.Element> = {
  fits: <span className="chip ok">Fits</span>,
  check: <span className="chip warn">Fits, check power</span>,
  no: <span className="chip bad">Can't upgrade</span>,
  later: <span className="chip info">Not needed yet</span>,
};

export function Upgrades() {
  const { pc } = useApp();
  const list = upgrades[pc.id] ?? [];
  const laptop = pc.kind === "laptop";
  return (
    <div className="page">
      <div className="page-head"><div><h1>Upgrades for {pc.name}</h1><p className="sub">Checked against your exact {laptop ? "laptop model" : "case, board and power supply"}. Prices are samples for this mockup.</p></div></div>
      <section className="card card-pad">
        <div className="slotmap">
          {laptop ? (
            <>
              <div><span className="label">Memory</span><div className="slots"><span className="slot soldered">Soldered</span></div></div>
              <div><span className="label">M.2 storage</span><div className="slots"><span className="slot used">1</span></div></div>
            </>
          ) : (
            <>
              <div><span className="label">Memory</span><div className="slots">{["A1", "A2", "B1", "B2"].map((s) => <span key={s} className={`slot${s.endsWith("2") ? " used" : ""}`}>{s}</span>)}</div></div>
              <div><span className="label">M.2 storage</span><div className="slots">{[1, 2, 3].map((s) => <span key={s} className={`slot${s === 1 ? " used" : ""}`}>{s}</span>)}</div></div>
              <div><span className="label">Power</span><p className="num" style={{ fontSize: "1.3em" }}>412 <span className="faint">/ 750 W</span></p></div>
              <div><span className="label">GPU room</span><p className="num" style={{ fontSize: "1.3em" }}>98 <span className="faint">mm spare</span></p></div>
            </>
          )}
        </div>
        <p className="faint" style={{ marginTop: 12, fontSize: 12.5 }}>Filled boxes are in use. Empty boxes are free slots.</p>
      </section>
      <section className="card">
        {list.map((u) => (
          <div key={u.title} className="upg">
            <div><div className="label">{u.part}</div></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><h3>{u.title}</h3>{fitChip[u.fit]}</div>
              <p className="muted">{u.detail}</p>
              {u.gain && <p className="gain">{u.gain}</p>}
            </div>
            <div className="price">{u.price && <>{u.price}<div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>sample price</div></>}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
