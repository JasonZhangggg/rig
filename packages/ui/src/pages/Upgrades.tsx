import { useEffect, useState } from "react";
import type { Upgrade } from "@rig/core";
import { useApp } from "../state";
import { partIcon } from "./shared";
import { bestPick, roomPart } from "./upgrades/pick";
import { roomIn, type Room } from "./upgrades/room";

const fitChip: Record<Upgrade["fit"], JSX.Element> = {
  fits: <span className="chip ok">Fits</span>,
  check: <span className="chip warn">Check first</span>,
  no: <span className="chip bad">Can't upgrade</span>,
  later: <span className="chip info">Not needed yet</span>,
};
const fitWords: Record<Upgrade["fit"], string> = { fits: "Fits as it is", check: "Check your model first", no: "Can't be upgraded", later: "Not needed yet" };

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
  const room = roomIn(pc);
  const roomFor = (u: Upgrade) => room.find((r) => roomPart[r.key] === u.part);
  const pick = list ? bestPick(list, pc, room) : null;
  const rest = list?.filter((u) => u !== pick?.idea) ?? [];
  const unmatched = room.filter((r) => !list?.some((u) => u.part === roomPart[r.key]));

  return (
    <div className="page pg-focus">
      <div className="page-head"><div><h1>Upgrades for {pc.name}</h1><p className="sub">Worked out from the parts Rig found in your {pc.kind === "laptop" ? "laptop" : "PC"}. Ask about any of them to check your exact model's manual.</p></div></div>
      {list == null ? <p className="muted" role="status">Loading…</p> : (
        <>
          {pick && <PickCard idea={pick.idea} why={pick.why} room={roomFor(pick.idea)} />}
          <section className="card up-ideas" aria-labelledby="up-ideas-h">
            <div className="card-head"><h2 id="up-ideas-h">{pick ? (rest.length ? "Other ideas" : "Anything else") : `Ideas for ${pc.name}`}</h2></div>
            {list.length === 0 && (
              <div className="up-none">
                <h3>{failed ? "Couldn't load upgrades just now" : "Nothing to suggest right now"}</h3>
                <p className="muted">{failed ? "Open this page again in a minute." : `When Rig finds a part in ${pc.name} with room to grow, like a free memory slot or a drive filling up, it shows up here with what to buy.`}</p>
              </div>
            )}
            {rest.length > 0 && <ul className="up-list">{rest.map((u) => <IdeaRow key={u.title} u={u} room={roomFor(u)} />)}</ul>}
            <AskRow />
          </section>
          {unmatched.length > 0 && (
            <p className="faint pg-note">Also found: {unmatched.map((r) => `${r.label.toLowerCase()} ${r.figure} ${r.unit} (${r.part})`).join(", ")}.</p>
          )}
        </>
      )}
    </div>
  );
}

function AskBuy({ u, primary }: { u: Upgrade; primary?: boolean }) {
  const { pc, ask } = useApp();
  if (u.price) return <span className="up-price">{u.price}</span>;
  if (u.fit === "no") return null;
  return <button className={`btn${primary ? " primary" : " sm"}`} type="button" onClick={() => ask(`${u.title}: what exactly should I buy for ${pc.name}, and will it fit?`)}>Ask what to buy</button>;
}

/** Rig's pick: the idea first and biggest, why it's the one, and the room the PC has for it. */
function PickCard({ idea, why, room }: { idea: Upgrade; why: string; room?: Room }) {
  const { pc } = useApp();
  return (
    <section className="card pg-lead good up-pick" aria-labelledby="up-pick-h">
      <div className="pg-lead-text">
        <span className="pg-lead-tag">Rig's pick for {pc.name}</span>
        <h2 id="up-pick-h" className="pg-lead-h">{idea.title}</h2>
        <p className="pg-lead-body">{why} {idea.detail}</p>
        <div className="gm-actions"><AskBuy u={idea} primary /><span className="faint up-fit">{fitWords[idea.fit]}</span></div>
      </div>
      {room && (
        <div className="pg-lead-fig up-pick-room">
          <span className="label">{room.label}</span>
          <b className="num">{room.figure}</b>
          <span className="muted">{room.unit}</span>
          <Meter r={room} />
          <span className="faint">{room.part}</span>
        </div>
      )}
    </section>
  );
}

function IdeaRow({ u, room }: { u: Upgrade; room?: Room }) {
  return (
    <li className="up-row">
      <span className="up-ico" aria-hidden="true">{partIcon[iconFor[u.part] ?? "board"]}</span>
      <div className="up-row-text">
        <span className="up-row-title"><h3>{u.title}</h3>{u.fit !== "fits" && fitChip[u.fit]}</span>
        <p className="muted">{u.detail}{u.gain ? ` ${u.gain}.` : ""}</p>
        {room && <p className="faint up-row-room"><Meter r={room} /><span>{room.figure} {room.unit}, {room.part}</span></p>}
      </div>
      <div className="up-row-go"><AskBuy u={u} /></div>
    </li>
  );
}

function Meter({ r }: { r: Room }) {
  const m = r.meter;
  if (m?.kind === "slots") {
    return (
      <span className="up-slots" role="img" aria-label={`${m.used} of ${m.total} slots used`}>
        {Array.from({ length: m.total }, (_, i) => <i key={i} className={i < m.used ? "on" : undefined} />)}
      </span>
    );
  }
  if (m?.kind === "share") {
    return <span className="bar up-share" role="img" aria-label={`${Math.round((m.value / m.of) * 100)}% ${r.key === "battery" ? "of original capacity" : "used"}`}><i style={{ width: `${(m.value / m.of) * 100}%` }} /></span>;
  }
  return null;
}

function AskRow() {
  const { pc, ask } = useApp();
  return (
    <div className="pg-foot up-ask">
      <div><h3>Have a part in mind?</h3><p className="muted">Ask Rig whether it fits {pc.name} and what difference it would make.</p></div>
      <button className="btn sm" type="button" onClick={() => ask(`Which upgrade would make the biggest difference for ${pc.name}?`)}>Ask what helps most</button>
    </div>
  );
}
