import type { SceneTheme } from "./scene";

export type StyleId = "studio" | "workbench" | "checkup";

export const styles: { id: StyleId; name: string; note: string }[] = [
  { id: "studio", name: "Studio", note: "Light and precise, like a spec sheet" },
  { id: "workbench", name: "Workbench", note: "Dark instrument panel for enthusiasts" },
  { id: "checkup", name: "Checkup", note: "Friendly health check for everyday owners" },
];

// How the 3D scene looks in each style. UI colors live in styles.css.
export const sceneThemes: Record<StyleId, SceneTheme> = {
  studio: {
    bg: "#ECEEF1", floor: "#E2E5E9", caseColor: "#F2F3F4", trim: "#2A2E34", glass: "#CFE0EA", glassOpacity: 0.16,
    board: "#1F2328", heatsink: "#4A5058", fins: "#C9CDD2", copper: "#C07A4A", fanFrame: "#2B2F35", ram: "#2C3036",
    gpuShroud: "#2E3238", gpuBack: "#555B63", gpuFanRing: "#5A6068", psu: "#26292E", laptopShell: "#B9BEC6",
    chip: "#1C1F23", battery: "#30343A", ssd: "#1E3A2E", keys: "#2A2D32", trackpad: "#AEB3BB",
    screenBg: "#F7F8FA", screenPanel: "#E6E9EE", screenLine: "#C7CDD5",
    heatCool: "#3A7BD5", heatWarm: "#E0A030", heatHot: "#D8432F", highlight: "#2F6FEB",
    hemi: 0.7, key: 1.7, rim: 0.5, exposure: 1.0,
  },
  workbench: {
    bg: "#16191C", floor: "#1A1D21", caseColor: "#2A2E33", trim: "#0E1012", glass: "#9FB4C8", glassOpacity: 0.1,
    board: "#121417", heatsink: "#3A3F45", fins: "#8E949B", copper: "#B36F43", fanFrame: "#1A1D20", ram: "#1C1F22",
    gpuShroud: "#24272B", gpuBack: "#3B4046", gpuFanRing: "#3B4046", psu: "#1B1E21", laptopShell: "#5E646C",
    chip: "#0D0F11", battery: "#22262A", ssd: "#163024", keys: "#15171A", trackpad: "#4A5058",
    screenBg: "#111315", screenPanel: "#1C2024", screenLine: "#30363C",
    heatCool: "#4C8DFF", heatWarm: "#EDB45A", heatHot: "#F06B5F", highlight: "#78A9FF",
    hemi: 0.35, key: 1.5, rim: 1.0, rimColor: "#9DB8E0", exposure: 1.05,
  },
  checkup: {
    bg: "#E4ECE8", floor: "#D8E2DD", caseColor: "#F5F7F6", trim: "#2F3B37", glass: "#CDE3DA", glassOpacity: 0.16,
    board: "#22302C", heatsink: "#56625E", fins: "#CBD3CF", copper: "#C27C4E", fanFrame: "#33403B", ram: "#2F3B37",
    gpuShroud: "#34403C", gpuBack: "#5A6662", gpuFanRing: "#5A6662", psu: "#2B3632", laptopShell: "#C4CCC8",
    chip: "#1D2623", battery: "#36423E", ssd: "#24443A", keys: "#2E3835", trackpad: "#B7C0BC",
    screenBg: "#F4F8F6", screenPanel: "#E2EAE6", screenLine: "#C2CEC8",
    heatCool: "#2C64A8", heatWarm: "#D99A2B", heatHot: "#C8453A", highlight: "#1D5A4C",
    hemi: 0.75, key: 1.6, rim: 0.4, exposure: 1.0,
  },
};

export const accents = ["#E8692E", "#3C7BF0", "#2E9E6B", "#C2477A", "#8A63D2", "#C9A227", "#5B6573"];
