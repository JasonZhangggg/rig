import { useLayoutEffect, useRef } from "react";
import { createScene, type PCScene } from "../scene";

// One WebGL scene for the whole app. Screens borrow it through <StageSlot>.
let host: { el: HTMLDivElement; park: HTMLDivElement; scene: PCScene; onSelect: (id: string | null) => void } | null = null;

export function getStage() {
  if (!host) {
    const park = document.createElement("div");
    park.className = "stage-park";
    document.body.appendChild(park);
    const el = document.createElement("div");
    el.className = "stage";
    el.setAttribute("aria-label", "3D view of your PC");
    park.appendChild(el);
    const h = { el, park, scene: null as unknown as PCScene, onSelect: (_id: string | null) => {} };
    h.scene = createScene(el, { onSelect: (id) => h.onSelect(id) });
    host = h;
  }
  return host;
}

export function StageSlot({ id, interactive = true }: { id: string; interactive?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const s = getStage();
    ref.current!.appendChild(s.el);
    s.el.style.pointerEvents = interactive ? "" : "none";
    return () => { s.park.appendChild(s.el); };
  }, [interactive]);
  return <div className="stage-slot" id={id} ref={ref} />;
}
