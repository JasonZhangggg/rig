import type { SceneTheme } from "./scene";

export type StyleId = "studio" | "workbench" | "checkup";

export const styles: { id: StyleId; name: string; note: string }[] = [
  { id: "studio", name: "Friendly", note: "Round tiles and a helper that talks to you" },
  { id: "workbench", name: "Canvas", note: "Your PC in the middle, parts wired around it" },
  { id: "checkup", name: "Workspace", note: "Two sidebars, big numbers, dense and calm" },
];

// How the 3D scene looks in each style. UI colors live in styles.css.
export const sceneThemes: Record<StyleId, SceneTheme> = {
  studio: {
    bg: "#F2F3F5", floor: "#E6E8EB", caseColor: "#F7F7F8", trim: "#2A2E34", glass: "#CFE0EA", glassOpacity: 0.16,
    board: "#1F2328", heatsink: "#4A5058", fins: "#C9CDD2", copper: "#C07A4A", fanFrame: "#2B2F35", ram: "#2C3036",
    gpuShroud: "#2E3238", gpuBack: "#555B63", gpuFanRing: "#5A6068", psu: "#26292E", laptopShell: "#B9BEC6",
    chip: "#1C1F23", battery: "#30343A", ssd: "#1E3A2E", keys: "#2A2D32", trackpad: "#AEB3BB",
    screenBg: "#F7F8FA", screenPanel: "#E6E9EE", screenLine: "#C7CDD5",
    heatCool: "#3A7BD5", heatWarm: "#E0A030", heatHot: "#E5533A", highlight: "#EE6A4D",
    hemi: 0.75, key: 1.8, rim: 0.6, exposure: 1.0, transparent: true, shadow: 0.26, edge: "#8F98A3", edgeOpacity: 0.35,
    glow: 0.9, glowBlend: "normal", interior: 5, pedestal: "#FFFFFF", pedestalRim: 0.55,
    air: 0.7, airCool: "#4C8DFF", airWarm: "#EE6A4D", airBlend: "normal",
  },
  workbench: {
    bg: "#1C1C1E", floor: "#232326", caseColor: "#2A2E33", trim: "#0E1012", glass: "#9FB4C8", glassOpacity: 0.1,
    board: "#121417", heatsink: "#3A3F45", fins: "#8E949B", copper: "#B36F43", fanFrame: "#1A1D20", ram: "#1C1F22",
    gpuShroud: "#24272B", gpuBack: "#3B4046", gpuFanRing: "#3B4046", psu: "#1B1E21", laptopShell: "#5E646C",
    chip: "#0D0F11", battery: "#22262A", ssd: "#163024", keys: "#15171A", trackpad: "#4A5058",
    screenBg: "#111315", screenPanel: "#1C2024", screenLine: "#30363C",
    heatCool: "#4C8DFF", heatWarm: "#EDB45A", heatHot: "#F06B5F", highlight: "#78A9FF",
    hemi: 0.45, key: 1.6, rim: 1.1, rimColor: "#9DB8E0", exposure: 1.1, transparent: true, shadow: 0.6, edge: "#AFC3D9", edgeOpacity: 0.3,
    glow: 1, glowBlend: "add", interior: 14, pedestal: "#14161B", pedestalRim: 0.85,
    air: 0.7, airCool: "#7CC4FF", airWarm: "#FF9A55", airBlend: "add",
  },
  checkup: {
    bg: "#F4F3F2", floor: "#E6E4E2", caseColor: "#FAFAF9", trim: "#2A2524", glass: "#E6D6D2", glassOpacity: 0.16,
    board: "#252120", heatsink: "#5C5552", fins: "#D8D1CC", copper: "#C27C4E", fanFrame: "#2F2A29", ram: "#2B2625",
    gpuShroud: "#2C2827", gpuBack: "#5E5754", gpuFanRing: "#5E5754", psu: "#2A2625", laptopShell: "#D3CAC5",
    chip: "#1E1B1A", battery: "#3A3533", ssd: "#3A2A2E", keys: "#2E2928", trackpad: "#C3BAB5",
    screenBg: "#FAF7F5", screenPanel: "#EEE8E4", screenLine: "#D3CBC6",
    heatCool: "#3A6FD8", heatWarm: "#D99A2B", heatHot: "#D9304F", highlight: "#D9304F",
    hemi: 0.75, key: 1.75, rim: 0.5, exposure: 1.0, transparent: true, shadow: 0.24, edge: "#B3A69F", edgeOpacity: 0.4,
    glow: 0.9, glowBlend: "normal", interior: 5, pedestal: "#ECEAE8", pedestalRim: 0.5,
    air: 0.75, airCool: "#5B7FB8", airWarm: "#D9304F", airBlend: "normal",
  },
};

// Color options for Friendly. accent fills buttons, ink is the dark tile color.
export type ColorId = "coral" | "tangerine" | "watermelon" | "orchid" | "periwinkle" | "teal" | "sage";
// Accent colors for Friendly, all at the original coral's strength. Only the accent changes; the background stays neutral.
export const colorways: { id: ColorId; name: string; accent: string; ink: string; scene: string }[] = [
  { id: "coral", name: "Coral", accent: "#EE6A4D", ink: "#1C1A18", scene: "#EE6A4D" },
  { id: "tangerine", name: "Tangerine", accent: "#F0843A", ink: "#1C1A18", scene: "#F0843A" },
  { id: "watermelon", name: "Watermelon", accent: "#EA5A72", ink: "#1C1A18", scene: "#EA5A72" },
  { id: "orchid", name: "Orchid", accent: "#A86ADB", ink: "#1C1A18", scene: "#A86ADB" },
  { id: "periwinkle", name: "Periwinkle", accent: "#6A82EE", ink: "#1C1A18", scene: "#6A82EE" },
  { id: "teal", name: "Teal", accent: "#22A493", ink: "#1C1A18", scene: "#22A493" },
  { id: "sage", name: "Sage", accent: "#A9C7A4", ink: "#1C1A18", scene: "#8DB889" },
];

// Sidebar options for Friendly
export type SideId = "panel" | "tree" | "card" | "dock";
export const sidebars: { id: SideId; name: string }[] = [
  { id: "panel", name: "Panel" },
  { id: "tree", name: "Tree" },
  { id: "card", name: "Card" },
  { id: "dock", name: "Dock" },
];

export const accents = ["#E8692E", "#3C7BF0", "#2E9E6B", "#C2477A", "#8A63D2", "#C9A227", "#5B6573"];
