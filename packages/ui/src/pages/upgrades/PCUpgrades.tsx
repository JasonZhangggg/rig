// Upgrade ideas on My PC: Rig's pick for the Upgrades tab, and an Upgrade tab
// on each part that has an idea.

import { useEffect, useMemo, useState } from "react";
import type { PC, Upgrade } from "@rig/core";
import { ManualRef } from "../../manuals/ManualRef";
import { useActions, useAppSelector, useStillPC } from "../../state";
import { bestPick, ideaText, roomPart, type Pick } from "./pick";
import { roomIn, type Room } from "./room";

const fitChip: Record<Upgrade["fit"], JSX.Element> = {
  fits: <span className="chip ok">Fits</span>,
  check: <span className="chip warn">Check first</span>,
  no: <span className="chip bad">Can't upgrade</span>,
  later: <span className="chip info">Not needed yet</span>,
};
const fitWords: Record<Upgrade["fit"], string> = { fits: "Fits as it is", check: "Check your model first", no: "Can't be upgraded", later: "Not needed yet" };

/** The part on My PC each kind of upgrade belongs to, best first. */
const partKeys: Record<string, string[]> = { Memory: ["ram"], Storage: ["ssd"], Cooling: ["fans"], Battery: ["battery"], Processor: ["cpu"], "Graphics card": ["gpu"] };
export const partOf = (u: Upgrade, pc: PC) => partKeys[u.part]?.find((k) => pc.parts?.[k]) ?? null;

export interface PCUpgrades { list: Upgrade[] | null; failed: boolean; pick: Pick | null; room: Room[] }

/** The upgrade ideas for the PC on screen and Rig's pick among them. */
export function useUpgrades(): PCUpgrades {
  const { client } = useActions();
  const pc = useStillPC();
  const [got, setGot] = useState<{ id: string; list: Upgrade[]; failed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    client.upgrades(pc.id).then((list) => live && setGot({ id: pc.id, list, failed: false })).catch(() => live && setGot({ id: pc.id, list: [], failed: true }));
    return () => { live = false; };
  }, [client, pc.id]);
  const list = got?.id === pc.id ? got.list : null;
  const alerts = useAppSelector((c) => c.pc.alerts);
  const failed = !!(got?.id === pc.id && got.failed);
  // The same object until the ideas or the PC's parts change, so the Upgrades tab isn't drawn again on every reading.
  return useMemo(() => {
    const room = roomIn(pc);
    return { list, failed, pick: list ? bestPick(list, { ...pc, alerts }, room) : null, room };
  }, [list, failed, pc, alerts]);
}

function AskBuy({ u, primary }: { u: Upgrade; primary?: boolean }) {
  const { ask } = useActions();
  const pc = useStillPC();
  if (u.price) return <span className="up-price">{u.price}</span>;
  if (u.fit === "no") return null;
  return <button className={`btn sm${primary ? " primary" : ""}`} type="button" onClick={() => ask(`${u.title}: what exactly should I buy for ${pc.name}, and will it fit?`)}>Ask what to buy</button>;
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

/** The Upgrade tab of a part: each idea for it, the room it has, and what to do next. */
export function PartUpgrade({ ideas, ups }: { ideas: Upgrade[]; ups: PCUpgrades }) {
  const roomFor = (u: Upgrade) => ups.room.find((r) => roomPart[r.key] === u.part);
  return (
    <ul className="pc-up-ideas">
      {ideas.map((u) => {
        const r = roomFor(u);
        const isPick = ups.pick?.idea === u;
        return (
          <li key={u.title} className="pc-up-idea">
            {/* The chip says how it fits; beside Rig's pick, the words say it instead. */}
            <div className="pc-up-top">{isPick ? <><span className="chip ok no-dot">Rig's pick</span><span className="faint">{fitWords[u.fit]}</span></> : fitChip[u.fit]}</div>
            <h3>{u.title}</h3>
            <p className="muted">{ideaText(u, ups.pick)}</p>
            {/* Not needed yet is the chip's to say, so the room line keeps to its figure. */}
            {r && <p className="faint up-row-room"><Meter r={r} /><span>{r.figure} {r.unit}.{u.fit === "later" || !r.note ? "" : ` ${r.note}`}</span></p>}
            <ManualRef part={u.part} />
            <div className="pc-up-go"><AskBuy u={u} primary={isPick} /></div>
          </li>
        );
      })}
    </ul>
  );
}
