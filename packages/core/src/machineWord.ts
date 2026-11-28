import type { PC } from "./model";

/**
 * The word for this machine on screen: "laptop" on a laptop, "PC" on anything else. Every "your PC" or
 * "this PC" that means the machine Rig is looking at takes its noun from here, so a laptop is never called a PC.
 * Words about PCs in general ("PC parts", "every PC on your account") stay as they are.
 */
export const machineWord = (kind: PC["kind"] | undefined): "laptop" | "PC" => (kind === "laptop" ? "laptop" : "PC");

/**
 * The graphics part's name on screen: "Graphics card" on a desktop, "Graphics" on a laptop, whose graphics is a chip
 * on its board, not a card. Every label that names the part takes it from here. Sentences about graphics cards in
 * general, and the cards Upgrades suggests, stay as they are.
 */
export const graphicsWord = (kind: PC["kind"] | undefined): "Graphics" | "Graphics card" => (kind === "laptop" ? "Graphics" : "Graphics card");
