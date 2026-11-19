import { useEffect, useRef } from "react";
import type { PC } from "@rig/core";
import { createScene } from "../scene";
import { sceneTheme } from "../themes";

/** A standalone, slowly turning 3D PC, for the website. Falls back to nothing without WebGL. */
export function PCPreview({ pc, className }: { pc: PC; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let scene: ReturnType<typeof createScene> | null = null;
    try {
      scene = createScene(ref.current!);
      scene.setPC(pc, sceneTheme);
      scene.setZoomable(false);
      scene.setSpin(true);
    } catch { /* no WebGL: the page reads fine without the picture */ }
    return () => scene?.dispose();
  }, [pc]);
  return <div ref={ref} className={className} aria-hidden="true" />;
}
