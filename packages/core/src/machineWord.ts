import type { PC } from "./model";

/**
 * The word for this machine on screen: "laptop" on a laptop, "PC" on anything else. Every "your PC" or
 * "this PC" that means the machine Rig is looking at takes its noun from here, so a laptop is never called a PC.
 * Words about PCs in general ("PC parts", "every PC on your account") stay as they are.
 */
export const machineWord = (kind: PC["kind"] | undefined): "laptop" | "PC" => (kind === "laptop" ? "laptop" : "PC");
