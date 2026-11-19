import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createScene, type PCScene } from "../scene";

// One WebGL scene for the whole app. Screens borrow it through <StageSlot>.
let host: { el: HTMLDivElement; park: HTMLDivElement; scene: PCScene; onSelect: (id: string | null) => void } | null = null;

// The part under the pointer in the 3D view, so a list can light up its row.
let hovered: string | null = null;
const hoverSubs = new Set<() => void>();
function setHovered(id: string | null) {
  if (id === hovered) return;
  hovered = id;
  hoverSubs.forEach((f) => f());
}
/** The part the pointer is over in the 3D view, or null. */
export function useStageHover() {
  return useSyncExternalStore((f) => { hoverSubs.add(f); return () => { hoverSubs.delete(f); }; }, () => hovered, () => null);
}
/** Lights a part up in the 3D view while a row about it is pointed at or focused. */
export function hoverPart(id: string | null) {
  getStage().scene.hover(id);
}

export function getStage() {
  if (!host) {
    const park = document.createElement("div");
    park.className = "stage-park";
    park.inert = true;
    document.body.appendChild(park);
    const el = document.createElement("div");
    el.className = "stage";
    park.appendChild(el);
    const h = { el, park, scene: null as unknown as PCScene, onSelect: (_id: string | null) => {} };
    h.scene = createScene(el, { onSelect: (id) => h.onSelect(id), onHover: setHovered });
    host = h;
  }
  return host;
}

export function StageSlot({ id, interactive = true, zoom = true, spin = false }: { id: string; interactive?: boolean; zoom?: boolean; spin?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const s = getStage();
    ref.current!.appendChild(s.el);
    s.el.style.pointerEvents = interactive ? "" : "none";
    s.scene.setZoomable(zoom);
    s.scene.setSpin(spin);
    return () => { s.scene.setZoomable(true); s.scene.setSpin(false); s.park.appendChild(s.el); };
  }, [interactive, zoom, spin]);
  return <div className="stage-slot" id={id} ref={ref} />;
}
