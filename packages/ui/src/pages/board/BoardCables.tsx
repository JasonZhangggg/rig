import { useEffect, useMemo } from "react";
import { cableGuide, resolveBuild } from "@rig/core";
import { cableColor, type CableDraw } from "../../boardScene";
import { useApp } from "../../state";
import { boardStage, useBoardShape } from "./boardStage";

/**
 * The cable guide, for putting the PC back together: each power cable from the supply, in the order to plug them in,
 * drawn on the board while this tab is open. Pointing at a cable lights it on the board; clicking one zooms to its plug.
 */
export function BoardCables() {
  const board = useBoardShape();
  const { pc } = useApp();
  // The card Windows names; none when Windows has read the board and found no card; a typical card before that.
  const gpu = pc.board ? pc.board.gpu ?? null : pc.parts?.gpu?.name;
  const sub = pc.gpuSubsys;
  // The exact card where Windows' ids name one Rig knows, for its own power plugs.
  const card = useMemo(() => resolveBuild({ gpu: gpu ? { name: gpu, subsysVendor: sub?.vendor, subsysId: sub?.id } : gpu === null ? null : undefined }).gpu, [gpu, sub]);
  const guide = useMemo(() => cableGuide(board, gpu, card?.ports?.power), [board, gpu, card]);
  const draws = useMemo<CableDraw[]>(() => {
    return guide.cables.map((c) => ({
      id: c.id, step: c.step, title: c.title, code: c.code ?? c.plug, to: c.to, optional: c.optional,
      ...(c.id === "gpu" && card ? { card: { length: card.length, height: card.height, thick: card.thick } } : {}),
    }));
  }, [guide, card]);
  useEffect(() => {
    boardStage.cables(draws);
    return () => boardStage.cables(null);
  }, [draws]);

  return (
    <div className="bc">
      <p className="bc-lead muted">The power cables from the supply, in the order to plug them in.</p>
      <ol className="bc-list" aria-label="Power cables">
        {guide.cables.map((c) => (
          <li key={c.id}>
            <button type="button" className="bc-row" style={{ ["--c" as string]: cableColor[c.id] }}
              aria-label={`${c.step}. ${c.title}${c.code ? ` (${c.code})` : ""}: ${c.plug} cable from the supply's ${c.port} port. Show on the board`}
              onPointerEnter={() => boardStage.hoverCable(c.id)} onPointerLeave={() => boardStage.hoverCable(null)}
              onFocus={() => boardStage.hoverCable(c.id)} onBlur={() => boardStage.hoverCable(null)}
              onClick={() => boardStage.focusCable(c.id)}>
              <span className="bc-step num" aria-hidden="true">{c.step}</span>
              <span className="bc-txt">
                <span className="bc-head">
                  <b>{c.title}</b>
                  {c.code && c.code !== c.plug && <small>{c.code}</small>}
                  {c.optional ? <span className="chip no-dot bc-tag">Optional</span> : !c.known && <span className="chip no-dot bc-tag">Usual spot</span>}
                </span>
                <span className="bc-plug">{c.plug} cable, from the supply's {c.port} port</span>
                <span className="bc-how">{c.how}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <ul className="bc-notes">{guide.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      <p className="faint bc-from">{guide.from} Drives and fans take their own smaller plugs, not shown here.</p>
    </div>
  );
}
