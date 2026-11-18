// Upgrades on My PC: a short card with Rig's pick and the other ideas, and an
// Upgrade tab on each part that has one. Each idea opens its part.

import { useEffect, useState } from "react";
import type { PC, Upgrade } from "@rig/core";
import { getStage } from "../../components/Stage";
import { ManualRef } from "../../manuals/ManualRef";
import { useApp } from "../../state";
import { partIcon } from "../shared";
import { bestPick, roomPart, type Pick } from "./pick";
import { roomIn, type Room } from "./room";

export const fitChip: Record<Upgrade["fit"], JSX.Element> = {
  fits: <span className="chip ok">Fits</span>,
  check: <span className="chip warn">Check first</span>,
  no: <span className="chip bad">Can't upgrade</span>,
  later: <span className="chip info">Not needed yet</span>,
};
const fitWords: Record<Upgrade["fit"], string> = { fits: "Fits as it is", check: "Check your model first", no: "Can't be upgraded", later: "Not needed yet" };

/** The part on My PC each kind of upgrade belongs to, best first. */
const partKeys: Record<string, string[]> = { Memory: ["ram"], Storage: ["ssd"], Cooling: ["fans"], Battery: ["battery"], Processor: ["cpu"], "Graphics card": ["gpu"] };
export const partOf = (u: Upgrade, pc: PC) => partKeys[u.part]?.find((k) => pc.parts?.[k]) ?? null;
const iconOf = (u: Upgrade, pc: PC) => partIcon[partOf(u, pc) ?? "board"] ?? partIcon.board;

export interface PCUpgrades { list: Upgrade[] | null; failed: boolean; pick: Pick | null; room: Room[] }

/** The upgrade ideas for the PC on screen and Rig's pick among them. */
export function useUpgrades(): PCUpgrades {
  const { pc, client } = useApp();
  const [got, setGot] = useState<{ id: string; list: Upgrade[]; failed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    client.upgrades(pc.id).then((list) => live && setGot({ id: pc.id, list, failed: false })).catch(() => live && setGot({ id: pc.id, list: [], failed: true }));
    return () => { live = false; };
  }, [client, pc.id]);
  const list = got?.id === pc.id ? got.list : null;
  const room = roomIn(pc);
  return { list, failed: !!(got?.id === pc.id && got.failed), pick: list ? bestPick(list, pc, room) : null, room };
}

/** Opens a part on My PC at its Upgrade tab. */
export function useOpenUpgrade() {
  const { pc, set } = useApp();
  return (u: Upgrade) => {
    const id = partOf(u, pc);
    if (!id) return;
    // Selecting in the scene opens the part at its Live tab, so the tab is set after.
    getStage().scene.select(id);
    set({ selected: id, tab: "upgrade" });
  };
}

function AskBuy({ u, primary }: { u: Upgrade; primary?: boolean }) {
  const { pc, ask } = useApp();
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

/** On My PC, beside the parts: Rig's pick and the other ideas, one line each. */
export function UpgradesCard({ ups }: { ups: PCUpgrades }) {
  const { pc, ask } = useApp();
  const open = useOpenUpgrade();
  const { list, failed, pick } = ups;
  const rest = list?.filter((u) => u !== pick?.idea && u.fit !== "no") ?? [];
  return (
    <section className="card pc-ups" aria-labelledby="pc-ups-h" id="pc-upgrades">
      <div className="card-head">
        <h2 id="pc-ups-h">Upgrades</h2>
        <button className="linkish pc-ups-ask" type="button" onClick={() => ask(`Which upgrade would make the biggest difference for ${pc.name}?`)}>Have a part in mind? Ask if it fits</button>
      </div>
      {list == null ? <p className="muted pc-ups-pad" role="status">Looking at what fits…</p>
        : !list.length ? <p className="muted pc-ups-pad">{failed ? "Couldn't check upgrades just now." : `Nothing to suggest for ${pc.name} right now.`}</p>
        : (
          <div className="pc-ups-body">
            {pick && (
              <button type="button" className="pc-ups-pick" onClick={() => open(pick.idea)}>
                <span className="label">Rig's pick</span>
                <b>{pick.idea.title}</b>
                <span className="muted">{pick.why}</span>
              </button>
            )}
            {rest.length > 0 && (
              <ul className="pc-ups-list" aria-label="Other ideas">
                {rest.map((u) => (
                  <li key={u.title}>
                    <button type="button" onClick={() => open(u)}>
                      <span className="up-ico" aria-hidden="true">{iconOf(u, pc)}</span>
                      <span className="pc-ups-title">{u.title}</span>
                      {fitChip[u.fit]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
    </section>
  );
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
            <div className="pc-up-top">{isPick ? <span className="chip ok no-dot">Rig's pick</span> : fitChip[u.fit]}<span className="faint">{fitWords[u.fit]}</span></div>
            <h3>{u.title}</h3>
            <p className="muted">{isPick && ups.pick!.pressing ? `${ups.pick!.why} ` : ""}{u.detail}{u.gain ? ` ${u.gain}.` : ""}</p>
            {r && <p className="faint up-row-room"><Meter r={r} /><span>{r.figure} {r.unit}. {r.note}</span></p>}
            <ManualRef part={u.part} />
            <div className="pc-up-go"><AskBuy u={u} primary={isPick} /></div>
          </li>
        );
      })}
    </ul>
  );
}
