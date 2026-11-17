import { useEffect, useState } from "react";
import type { Upgrade } from "@rig/core";
import { useApp } from "../state";

const fitChip: Record<Upgrade["fit"], JSX.Element> = {
  fits: <span className="chip ok">Fits</span>,
  check: <span className="chip warn">Check first</span>,
  no: <span className="chip bad">Can't upgrade</span>,
  later: <span className="chip info">Not needed yet</span>,
};

export function Upgrades() {
  const { pc, client, ask } = useApp();
  const [list, setList] = useState<Upgrade[] | null>(null);
  useEffect(() => {
    let live = true;
    client.upgrades(pc.id).then((u) => live && setList(u)).catch(() => live && setList([]));
    return () => { live = false; };
  }, [client, pc.id]);
  const laptop = pc.kind === "laptop";
  return (
    <div className="page">
      <div className="page-head"><div><h1>Upgrades for {pc.name}</h1><p className="sub">Worked out from the parts Rig found in your {laptop ? "laptop" : "PC"}. Ask about any of them to check your exact model's manual.</p></div></div>
      <section className="card">
        {list == null && <p className="card-pad muted">Loading…</p>}
        {list?.length === 0 && <p className="card-pad muted">Nothing to suggest right now.</p>}
        {list?.map((u) => (
          <div key={u.title} className="upg">
            <div><div className="label">{u.part}</div></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><h3>{u.title}</h3>{fitChip[u.fit]}</div>
              <p className="muted">{u.detail}</p>
              {u.gain && <p className="gain">{u.gain}</p>}
            </div>
            <div className="price">
              {u.price || (u.fit !== "no" && <button className="btn sm" type="button" onClick={() => ask(`${u.title}: what exactly should I buy for ${pc.name}, and will it fit?`)}>Ask what to buy</button>)}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
