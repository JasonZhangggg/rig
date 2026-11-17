import type { SceneTheme } from "./scene";

// The approved look: Friendly with the Watermelon accent. UI colors live in styles/.
export const accent = "#EA5A72";

export const sceneTheme: SceneTheme = {
  bg: "#F2F3F5", floor: "#E6E8EB", caseColor: "#F7F7F8", trim: "#2A2E34", glass: "#CFE0EA", glassOpacity: 0.16,
  board: "#1F2328", heatsink: "#4A5058", fins: "#C9CDD2", copper: "#C07A4A", fanFrame: "#2B2F35", ram: "#2C3036",
  gpuShroud: "#2E3238", gpuBack: "#555B63", gpuFanRing: "#5A6068", psu: "#26292E", laptopShell: "#B9BEC6",
  chip: "#1C1F23", battery: "#30343A", ssd: "#1E3A2E", keys: "#2A2D32", trackpad: "#AEB3BB",
  screenBg: "#F7F8FA", screenPanel: "#E6E9EE", screenLine: "#C7CDD5",
  heatCool: "#3A7BD5", heatWarm: "#E0A030", heatHot: "#E5533A", highlight: accent,
  hemi: 0.75, key: 1.8, rim: 0.6, exposure: 1.0, transparent: true, shadow: 0.26, edge: "#8F98A3", edgeOpacity: 0.35,
  glow: 0.9, glowBlend: "normal", interior: 5, pedestal: "#FFFFFF", pedestalRim: 0.55,
  air: 0.7, airCool: "#4C8DFF", airWarm: accent, airBlend: "normal",
};

/** Colors a person can pick to mark their PC. */
export const pcAccents = ["#EA5A72", "#E8692E", "#3C7BF0", "#2E9E6B", "#C2477A", "#8A63D2", "#C9A227", "#5B6573"];
