// The board view on My PC and the slot list beside it light each other: pointing at a row lights its
// slots on the board, pointing at a slot on the board lights its row. This holds the one board view
// on screen and the item under the pointer.
import { useMemo, useSyncExternalStore } from "react";
import { resolveBuild, type BoardShape } from "@rig/core";
import type { BoardScene, CableDraw } from "../../boardScene";
import { boardShape, useBoardLayout } from "../../manuals/boardLayout";
import { useStillPC } from "../../state";

let view: BoardScene | null = null;
let hovered: string | null = null;
// The cable guide's cables, kept here so a board view drawn again (a new size of window, a new look) draws them too.
let cables: CableDraw[] | null = null;
const subs = new Set<() => void>();

export const boardStage = {
  attach(s: BoardScene | null) { view = s; s?.setCables(cables); },
  /** Lights items without moving the camera. */
  hover(ids: string[]) { view?.hover(ids); },
  /** Zooms to one item, with its pin map when it has named pins. */
  focus(id: string) { view?.highlight({ id }); },
  reset() { view?.reset(); },
  /** Draws the cable guide on the board, or takes it away with null. */
  cables(list: CableDraw[] | null) { cables = list; view?.setCables(list); },
  hoverCable(id: string | null) { view?.hoverCable(id); },
  focusCable(id: string) { view?.focusCable(id); },
  /** The board view says what the pointer is over. */
  pointed(id: string | null) {
    if (id === hovered) return;
    hovered = id;
    subs.forEach((f) => f());
  },
};

/** The board item the pointer is over in the board view, or null. */
export function useBoardPointed() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => hovered, () => null);
}

/**
 * The on-screen PC's motherboard: Rig's own record for the model, else the layout read from its manual,
 * else a typical board of its size.
 */
export function useBoardShape(): BoardShape {
  const pc = useStillPC();
  const layout = useBoardLayout();
  const mb = pc.parts?.motherboard;
  return useMemo(
    () => resolveBuild({ board: mb ? { manufacturer: mb.maker ?? "", product: mb.model ?? "" } : undefined, boardLayout: layout ? boardShape(layout) : undefined }).board,
    [mb?.maker, mb?.model, layout], // eslint-disable-line react-hooks/exhaustive-deps
  );
}
