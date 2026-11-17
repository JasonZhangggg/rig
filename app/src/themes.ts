import type { SceneTheme } from "./scene";

export type StyleId = "studio" | "workbench" | "checkup";

export const styles: { id: StyleId; name: string; note: string }[] = [
  { id: "studio", name: "Soft", note: "Light, calm and rounded" },
  { id: "workbench", name: "Night", note: "Dark canvas for enthusiasts" },
  { id: "checkup", name: "Warm", note: "Warm and bold, nested panels" },
];

// How the 3D scene looks in each style. UI colors live in styles.css.
export const sceneThemes: Record<StyleId, SceneTheme> = {
  studio: {
    bg: "#F2F3F5", floor: "#E6E8EB", caseColor: "#F7F7F8", trim: "#2A2E34", glass: "#CFE0EA", glassOpacity: 0.16,
    board: "#1F2328", heatsink: "#4A5058", fins: "#C9CDD2", copper: "#C07A4A", fanFrame: "#2B2F35", ram: "#2C3036",
    gpuShroud: "#2E3238", gpuBack: "#555B63", gpuFanRing: "#5A6068", psu: "#26292E", laptopShell: "#B9BEC6",
    chip: "#1C1F23", battery: "#30343A", ssd: "#1E3A2E", keys: "#2A2D32", trackpad: "#AEB3BB",
    screenBg: "#F7F8FA", screenPanel: "#E6E9EE", screenLine: "#C7CDD5",
    heatCool: "#3A7BD5", heatWarm: "#E0A030", heatHot: "#D8432F", highlight: "#4C7FE8",
    hemi: 0.75, key: 1.8, rim: 0.6, exposure: 1.0, transparent: true, shadow: 0.26, edge: "#8F98A3", edgeOpacity: 0.35,
  },
  workbench: {
    bg: "#1C1C1E", floor: "#232326", caseColor: "#2A2E33", trim: "#0E1012", glass: "#9FB4C8", glassOpacity: 0.1,
    board: "#121417", heatsink: "#3A3F45", fins: "#8E949B", copper: "#B36F43", fanFrame: "#1A1D20", ram: "#1C1F22",
    gpuShroud: "#24272B", gpuBack: "#3B4046", gpuFanRing: "#3B4046", psu: "#1B1E21", laptopShell: "#5E646C",
    chip: "#0D0F11", battery: "#22262A", ssd: "#163024", keys: "#15171A", trackpad: "#4A5058",
    screenBg: "#111315", screenPanel: "#1C2024", screenLine: "#30363C",
    heatCool: "#4C8DFF", heatWarm: "#EDB45A", heatHot: "#F06B5F", highlight: "#78A9FF",
    hemi: 0.45, key: 1.6, rim: 1.1, rimColor: "#9DB8E0", exposure: 1.1, transparent: true, shadow: 0.6, edge: "#AFC3D9", edgeOpacity: 0.3,
  },
  checkup: {
    bg: "#F3F0EE", floor: "#E7E1DD", caseColor: "#FAF8F7", trim: "#2A2524", glass: "#E6D6D2", glassOpacity: 0.16,
    board: "#252120", heatsink: "#5C5552", fins: "#D8D1CC", copper: "#C27C4E", fanFrame: "#2F2A29", ram: "#2B2625",
    gpuShroud: "#2C2827", gpuBack: "#5E5754", gpuFanRing: "#5E5754", psu: "#2A2625", laptopShell: "#D3CAC5",
    chip: "#1E1B1A", battery: "#3A3533", ssd: "#3A2A2E", keys: "#2E2928", trackpad: "#C3BAB5",
    screenBg: "#FAF7F5", screenPanel: "#EEE8E4", screenLine: "#D3CBC6",
    heatCool: "#3A6FD8", heatWarm: "#D99A2B", heatHot: "#D6345B", highlight: "#D6345B",
    hemi: 0.75, key: 1.75, rim: 0.5, exposure: 1.0, transparent: true, shadow: 0.24, edge: "#B3A69F", edgeOpacity: 0.4,
  },
};

export const accents = ["#E8692E", "#3C7BF0", "#2E9E6B", "#C2477A", "#8A63D2", "#C9A227", "#5B6573"];
