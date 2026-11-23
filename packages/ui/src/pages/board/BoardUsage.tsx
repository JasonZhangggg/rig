import type { SlotUse, UsageGroup } from "@rig/core";
import { boardStage, useBoardPointed, useBoardShape } from "./boardStage";
import { useUsage } from "./BoardView";

const stateName: Record<SlotUse["state"], string> = { used: "in use", free: "free", unknown: "Rig can't see it" };

/**
 * Which slots, ports and headers on the motherboard are in use, group by group, from what Windows reports.
 * Pointing at a group or a slot lights it on the board; clicking a slot zooms the board to it.
 */
export function BoardUsage() {
  const board = useBoardShape();
  const groups = useUsage(board);
  const pointed = useBoardPointed();
  if (!groups.length) return <p className="muted">Rig shows what's plugged into the board once the Rig app on this PC sends its parts.</p>;
  return (
    <div className="bu">
      <ul className="bu-groups" aria-label="Slots and headers">
        {groups.map((g) => <Group key={g.key} g={g} pointed={pointed} />)}
      </ul>
      <p className="bu-legend faint" aria-hidden="true"><i className="is-used" />In use<i className="is-free" />Free<i className="is-unknown" />Rig can't see</p>
      <p className="faint bu-from">Slot positions: {board.layoutFrom}</p>
    </div>
  );
}

function Group({ g, pointed }: { g: UsageGroup; pointed: string | null }) {
  const ids = g.slots.map((s) => s.id);
  const lit = pointed != null && ids.includes(pointed);
  const items = g.bySlot ? g.slots.filter((s) => s.state === "used" && s.what && g.key !== "power") : [];
  return (
    <li className={`bu-group${lit ? " is-lit" : ""}`} onPointerEnter={() => boardStage.hover(ids)} onPointerLeave={() => boardStage.hover([])}>
      <div className="bu-head">
        <h3>{g.title}</h3>
        {g.used !== undefined && g.total !== undefined
          ? <span className="num bu-count">{g.used} of {g.total}{g.key === "fan" ? " spinning" : " in use"}</span>
          : g.used !== undefined ? <span className="num bu-count">{g.used} in use</span>
          : g.slots.every((s) => s.state === "unknown") ? <span className="bu-count faint">Can't see</span> : null}
      </div>
      {g.slots.length > 0 && (
        <div className="bu-cells">
          {g.slots.map((s) => (
            <button key={s.id} type="button" className={`bu-cell is-${g.bySlot ? s.state : "unknown"}${pointed === s.id ? " is-lit" : ""}`}
              aria-label={`${s.label}${s.name && s.name !== s.label ? ` (${s.name})` : ""}: ${g.bySlot ? stateName[s.state] : "Rig can't tell which"}${s.what ? `, ${s.what}` : ""}. Show on the board`}
              onPointerEnter={() => boardStage.hover([s.id])} onPointerLeave={() => boardStage.hover(ids)}
              onFocus={() => boardStage.hover([s.id])} onBlur={() => boardStage.hover([])}
              onClick={() => boardStage.focus(s.id)}>
              {s.name || s.label}
            </button>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <ul className="bu-items">{items.map((s) => <li key={s.id}><b>{s.name}</b><span>{s.what}</span></li>)}</ul>
      )}
      <p className="bu-note">{g.note}</p>
    </li>
  );
}
