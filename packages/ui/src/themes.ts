import type { SceneTheme } from "./scene";

/** The 3D look: a light case drawn in ink on a see-through stage, lit in brass. UI colors live in styles/tokens.css. */
export const sceneTheme: SceneTheme = {
  bg: "#F3F3F2", floor: "#E6E6E4", caseColor: "#FAF9F7", trim: "#1B1B1F", glass: "#D9DCD2", glassOpacity: 0.16,
  board: "#1E1F1E", heatsink: "#4A4C4A", fins: "#C9CBC8", copper: "#C07A4A", fanFrame: "#2A2B2A", ram: "#2B2C2B",
  gpuShroud: "#2D2E2D", gpuBack: "#555755", gpuFanRing: "#5A5C5A", psu: "#262726", laptopShell: "#BDBFBC",
  chip: "#1B1C1B", battery: "#303130", ssd: "#26331A", keys: "#2A2B2A", trackpad: "#B0B2AF",
  screenBg: "#F7F7F6", screenPanel: "#E7E7E5", screenLine: "#C9C9C6",
  heatCool: "#BFAA78", heatWarm: "#D9804F", heatHot: "#B8552A", highlight: "#E6D3A3", accent: "#E6D3A3",
  hemi: 0.75, key: 1.8, rim: 0.6, exposure: 1.0, transparent: true, shadow: 0.22, edge: "#8F8D88", edgeOpacity: 0.35,
  glow: 0.4, glowBlend: "normal", interior: 1.5, pedestal: "#FFFFFF", pedestalRim: 0.35,
  air: 0.7, airCool: "#D2C08F", airWarm: "#D9804F", airBlend: "normal",
};

/** Colors a person can pick to mark their PC in the list of PCs. */
export const pcAccents = ["#EA5A72", "#E8692E", "#3C7BF0", "#2E9E6B", "#C2477A", "#8A63D2", "#C9A227", "#5B6573"];
