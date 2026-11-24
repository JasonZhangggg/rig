// The card close-up on My PC and the Ports tab beside it light each other, the way the board view and the
// Slots tab do: pointing at a row lights its outputs on the card, pointing at an output lights its row.
import { useMemo, useSyncExternalStore } from "react";
import { cardUse, gpuPowerOptions, resolveBuild, type GpuShape } from "@rig/core";
import type { GpuScene } from "../../gpuScene";
import { useApp } from "../../state";

let view: GpuScene | null = null;
let pointedId: string | null = null;
const subs = new Set<() => void>();

export const gpuStage = {
  attach(s: GpuScene | null) { view = s; },
  hover(ids: string[]) { view?.hover(ids); },
  focus(id: string) { view?.focus(id); },
  reset() { view?.reset(); },
  pointed(id: string | null) {
    if (id === pointedId) return;
    pointedId = id;
    subs.forEach((f) => f());
  },
};

/** The output or plug the pointer is over on the card, or null. */
export function useGpuPointed() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => pointedId, () => null);
}

/** The on-screen PC's graphics card: its shape and plugs, and which screen is on which kind of output. */
export function useCard(): { shape: GpuShape; use: ReturnType<typeof cardUse>; options?: ReturnType<typeof gpuPowerOptions> } | null {
  const { pc } = useApp();
  const name = pc.parts?.gpu?.name;
  return useMemo(() => {
    if (!name) return null;
    // Windows' subsystem ids name the exact card where Rig knows it; then its outputs and power plugs come with it.
    const sub = pc.gpuSubsys;
    const input = { name, subsysVendor: sub?.vendor, subsysId: sub?.id };
    const shape = pc.build?.gpu ?? resolveBuild({ gpu: input }).gpu;
    if (!shape) return null;
    // Without the exact card, the plug layouts its chip's cards (from its maker, where Windows names it) come with.
    return { shape, use: cardUse(shape.ports, pc.displays), options: shape.ports ? undefined : gpuPowerOptions(input) };
  }, [name, pc.build, pc.gpuSubsys, pc.displays]);
}
