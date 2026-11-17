import { useEffect, useState } from "react";
import type { Upgrade } from "@rig/core";
import { Icon } from "../components/common";
import { useApp } from "../state";
import { partIcon } from "./shared";
import { roomIn, type Room } from "./upgrades/room";

const fitChip: Record<Upgrade["fit"], JSX.Element> = {
  fits: <span className="chip ok">Fits</span>,
  check: <span className="chip warn">Check first</span>,
  no: <span className="chip bad">Can't upgrade</span>,
  later: <span className="chip info">Not needed yet</span>,
};

const iconFor: Record<string, string> = { Memory: "ram", Storage: "ssd", Cooling: "fans", Battery: "battery", Processor: "cpu", "Graphics card": "gpu" };

export function Upgrades() {
  const { pc, client } = useApp();
  const [list, setList] = useState<Upgrade[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setList(null); setFailed(false);
    client.upgrades(pc.id).then((u) => live && setList(u)).catch(() => { if (live) { setFailed(true); setList([]); } });
    return () => { live = false; };
  }, [client, pc.id]);
  const laptop = pc.kind === "laptop";
  const room = roomIn(pc);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Upgrades for {pc.name}</h1><p className="sub">Worked out from the parts Rig found in your {laptop ? "laptop" : "PC"}. Ask about any of them to check your exact model's manual.</p></div></div>
      {room.length > 0 && (
        <section className="up-room" aria-labelledby="up-room-h">
          <h2 id="up-room-h" className="up-section-h">Where there's room</h2>
          <div className="up-room-grid">
            {room.map((r) => <RoomTile key={r.key} r={r} />)}
            {list && list.length > 0 && <Ideas list={list} />}
          </div>
        </section>
      )}
      <section aria-labelledby="up-ideas-h" className="up-ideas">
        <h2 id="up-ideas-h" className="up-section-h">Ideas for {pc.name}</h2>
        {list == null ? <p className="card card-pad muted" role="status">Loading…</p> : (
          <div className="up-grid">
            {list.length === 0 && (
              <div className="card card-pad up-none">
                <h3>{failed ? "Couldn't load upgrades just now" : "Nothing to suggest right now"}</h3>
                <p className="muted">{failed ? "Open this page again in a minute." : `When Rig finds a part in ${pc.name} with room to grow, like a free memory slot or a drive filling up, it shows up here with what to buy.`}</p>
              </div>
            )}
            {list.map((u) => <UpgradeCard key={u.title} u={u} />)}
            <AskCard />
          </div>
        )}
      </section>
    </div>
  );
}

function RoomTile({ r }: { r: Room }) {
  const m = r.meter;
  return (
    <div className="card up-tile">
      <div className="up-tile-head"><span className="up-ico" aria-hidden="true">{partIcon[r.key]}</span><span className="label">{r.label}</span></div>
      <p className="up-figure"><b className="num">{r.figure}</b> {r.unit}</p>
      {m?.kind === "slots" && (
        <div className="up-slots" role="img" aria-label={`${m.used} of ${m.total} slots used`}>
          {Array.from({ length: m.total }, (_, i) => <i key={i} className={i < m.used ? "on" : undefined} />)}
        </div>
      )}
      {m?.kind === "share" && (
        <div className="bar up-share" role="img" aria-label={`${Math.round((m.value / m.of) * 100)}% ${r.key === "battery" ? "of original capacity" : "used"}`}><i style={{ width: `${(m.value / m.of) * 100}%` }} /></div>
      )}
      <p className="muted up-tile-note"><span className="up-part">{r.part}</span> {r.note}</p>
    </div>
  );
}

function Ideas({ list }: { list: Upgrade[] }) {
  const n = (fit: Upgrade["fit"]) => list.filter((u) => u.fit === fit).length;
  const parts: string[] = [];
  if (n("fits")) parts.push(n("fits") === 1 ? "1 fits as it is" : `${n("fits")} fit as they are`);
  if (n("check")) parts.push(n("check") === 1 ? "1 needs a check first" : `${n("check")} need a check first`);
  if (n("later")) parts.push(`${n("later")} not needed yet`);
  if (n("no")) parts.push(`${n("no")} can't be upgraded`);
  return (
    <div className="card up-tile">
      <div className="up-tile-head"><span className="up-ico" aria-hidden="true"><Icon d="M10 16V5M5.5 9.5 10 5l4.5 4.5" /></span><span className="label">Upgrade ideas</span></div>
      <p className="up-figure"><b className="num">{list.length}</b> {list.length === 1 ? "idea" : "ideas"}</p>
      <p className="muted up-tile-note">{parts.join(", ")}.</p>
    </div>
  );
}

function UpgradeCard({ u }: { u: Upgrade }) {
  const { pc, ask } = useApp();
  return (
    <article className="card up-card">
      <div className="up-card-head">
        <span className="up-ico" aria-hidden="true">{partIcon[iconFor[u.part] ?? "board"]}</span>
        <span className="label">{u.part}</span>
        {fitChip[u.fit]}
      </div>
      <h3>{u.title}</h3>
      <p className="muted">{u.detail}</p>
      {u.gain && <p className="up-gain"><span className="label">What it helps with</span>{u.gain}</p>}
      <div className="up-card-foot">
        {u.price ? <span className="up-price">{u.price}</span> : u.fit !== "no" && <button className="btn sm" type="button" onClick={() => ask(`${u.title}: what exactly should I buy for ${pc.name}, and will it fit?`)}>Ask what to buy</button>}
      </div>
    </article>
  );
}

function AskCard() {
  const { pc, ask } = useApp();
  return (
    <div className="card up-card up-ask">
      <h3>Have a part in mind?</h3>
      <p className="muted">Ask Rig whether it fits {pc.name} and what difference it would make.</p>
      <div className="up-card-foot"><button className="btn sm primary" type="button" onClick={() => ask(`Which upgrade would make the biggest difference for ${pc.name}?`)}>Ask what helps most</button></div>
    </div>
  );
}
