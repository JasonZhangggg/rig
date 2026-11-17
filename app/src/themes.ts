import type { Finish, SceneTheme } from "./scene";

export type StyleId = "mix" | "paper" | "signature" | "pulse" | "blend" | "studio" | "workbench" | "checkup";
export type Mode = "dark" | "light";

export const styles: { id: StyleId; name: string; note: string }[] = [
  { id: "mix", name: "Mix", note: "Signature's type and colors on Blend's panel and tiles" },
  { id: "paper", name: "Paper", note: "Calm paper, a floating numbered sidebar, coral only where it matters" },
  { id: "signature", name: "Signature", note: "Paper's calm with live charts on graphite tiles, lime for good, coral for a look" },
  { id: "pulse", name: "Pulse", note: "Black cards, lime and orange charts, pill nav on top" },
  { id: "blend", name: "Blend", note: "Friendly's panel and tiles with Pulse's charts, in lime and black" },
  { id: "studio", name: "Friendly", note: "Round tiles and a helper that talks to you" },
  { id: "workbench", name: "Canvas", note: "Your PC in the middle, parts wired around it" },
  { id: "checkup", name: "Workspace", note: "Two sidebars, big numbers, dense and calm" },
];

export const studioAccent = "#EA5A72";
export const lime = "#C6F432";
export const coral = "#FD754D";

// How the 3D scene looks in each style. UI colors live in styles.css.
const baseScenes: Record<Exclude<StyleId, "mix" | "paper" | "signature">, SceneTheme> = {
  pulse: {
    bg: "#161616", floor: "#1C1C1C", caseColor: "#D9DBD4", trim: "#1D1E1C", glass: "#B9C2BC", glassOpacity: 0.12,
    board: "#151615", heatsink: "#3C3F3B", fins: "#A2A79F", copper: "#B8784A", fanFrame: "#1B1C1B", ram: "#202220",
    gpuShroud: "#262826", gpuBack: "#3D403C", gpuFanRing: "#40443F", psu: "#1C1D1C", laptopShell: "#C9CCC5",
    chip: "#111211", battery: "#262826", ssd: "#1F2A12", keys: "#1C1D1C", trackpad: "#B3B7B0",
    screenBg: "#121312", screenPanel: "#1E201D", screenLine: "#343832",
    heatCool: "#E4F7B0", heatWarm: "#FF9A1F", heatHot: "#FF5A36", highlight: "#C6F432",
    hemi: 0.55, key: 1.7, rim: 1.0, rimColor: "#E8F8B0", exposure: 1.05, transparent: true, shadow: 0.55, edge: "#C9CEC5", edgeOpacity: 0.28,
    glow: 1, glowBlend: "add", interior: 10, pedestal: "#232422", pedestalRim: 0.8,
    air: 0.7, airCool: "#E9FBB0", airWarm: "#FF9A1F", airBlend: "add",
  },
  blend: {
    bg: "#F3F3F2", floor: "#E6E6E4", caseColor: "#F8F8F7", trim: "#1F1F1E", glass: "#D5D9D6", glassOpacity: 0.16,
    board: "#1E1F1E", heatsink: "#4A4C4A", fins: "#C9CBC8", copper: "#C07A4A", fanFrame: "#2A2B2A", ram: "#2B2C2B",
    gpuShroud: "#2D2E2D", gpuBack: "#555755", gpuFanRing: "#5A5C5A", psu: "#262726", laptopShell: "#BDBFBC",
    chip: "#1B1C1B", battery: "#303130", ssd: "#26331A", keys: "#2A2B2A", trackpad: "#B0B2AF",
    screenBg: "#F7F7F6", screenPanel: "#E7E7E5", screenLine: "#C9C9C6",
    heatCool: "#9FCB1A", heatWarm: "#F28A00", heatHot: "#D9480F", highlight: "#C6F432",
    hemi: 0.75, key: 1.8, rim: 0.6, exposure: 1.0, transparent: true, shadow: 0.26, edge: "#8F928E", edgeOpacity: 0.35,
    glow: 0.9, glowBlend: "normal", interior: 5, pedestal: "#FFFFFF", pedestalRim: 0.55,
    air: 0.7, airCool: "#8DB80F", airWarm: "#F28A00", airBlend: "normal",
  },
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

const pulseLightScene: SceneTheme = {
  ...baseScenes.blend,
  bg: "#F4F5F0", floor: "#E4E6DE", caseColor: "#F7F8F4", pedestal: "#FFFFFF", edge: "#8E938A",
};

// Paper and Signature: a light case on a see-through stage so the card's gradient shows.
// Heat runs mist to coral; airflow is mist in Paper and lime in Signature.
export const sceneThemes: Record<StyleId, SceneTheme> = {
  ...baseScenes,
  paper: {
    ...baseScenes.blend,
    caseColor: "#FAF9F7", trim: "#1B1B1F", glass: "#DCD8EE", pedestal: "#FFFFFF", edge: "#8F8D88",
    heatCool: "#A79DDF", heatWarm: "#FDA07F", heatHot: "#FD754D", highlight: coral,
    airCool: "#A79DDF", airWarm: coral, shadow: 0.22,
  },
  mix: {
    ...baseScenes.blend,
    caseColor: "#FAF9F7", trim: "#1B1B1F", glass: "#D9DCD2", pedestal: "#FFFFFF", edge: "#8F8D88",
    heatCool: "#8DB80F", heatWarm: "#FDA07F", heatHot: "#FD754D", highlight: lime,
    airCool: "#8DB80F", airWarm: coral, shadow: 0.22,
  },
  signature: {
    ...baseScenes.blend,
    caseColor: "#FAF9F7", trim: "#1B1B1F", glass: "#D9DCD2", pedestal: "#FFFFFF", edge: "#8F8D88",
    heatCool: "#8DB80F", heatWarm: "#FDA07F", heatHot: "#FD754D", highlight: lime,
    airCool: "#8DB80F", airWarm: coral, shadow: 0.22,
  },
};

/** The color the 3D highlight and glow take in looks that keep the page to one accent. */
export const sceneGlow: Partial<Record<StyleId, string>> = {
  mix: lime, paper: coral, signature: lime, pulse: lime, blend: lime, studio: studioAccent,
};

export const finishes: { id: Finish; name: string }[] = [
  { id: "photo", name: "Real" },
  { id: "clay", name: "Clay" },
  { id: "ink", name: "Ink" },
  { id: "line", name: "Drawing" },
];

export type Hero = "band" | "score" | "statement" | "ask";
export const heroes: { id: Hero; name: string }[] = [
  { id: "band", name: "Greeting" },
  { id: "score", name: "Score" },
  { id: "statement", name: "Statement" },
  { id: "ask", name: "Ask" },
];

/** Mix's data colors. The 3D PC takes its glow, heat and airflow from the same set,
 *  and every set but Signal dims the glow so the PC reads as hardware, not neon. */
export type ColorSet = "sage" | "ocean" | "iris" | "teal" | "brass" | "denim" | "olive" | "sea" | "cobalt" | "mono" | "signal";
export const colorSets: { id: ColorSet; name: string; accent: string; scene: Partial<SceneTheme> }[] = [
  { id: "sage", name: "Sage", accent: "#A9C4A0", scene: {
    heatCool: "#7FA376", heatWarm: "#E09A6E", heatHot: "#C4643A", highlight: "#A9C4A0",
    airCool: "#8FB386", airWarm: "#E09A6E", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "ocean", name: "Ocean", accent: "#9EC5E8", scene: {
    heatCool: "#6E9DC8", heatWarm: "#EDB45E", heatHot: "#D9822B", highlight: "#9EC5E8",
    airCool: "#86B2DB", airWarm: "#EDB45E", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "iris", name: "Iris", accent: "#B3B9F2", scene: {
    heatCool: "#8E95D9", heatWarm: "#F3A683", heatHot: "#D9704A", highlight: "#B3B9F2",
    airCool: "#A2A8E6", airWarm: "#F3A683", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "teal", name: "Teal", accent: "#8CCFC0", scene: {
    heatCool: "#5FAE9C", heatWarm: "#F0BC67", heatHot: "#D98E2B", highlight: "#8CCFC0",
    airCool: "#7CC2B2", airWarm: "#F0BC67", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "brass", name: "Brass", accent: "#E6D3A3", scene: {
    heatCool: "#BFAA78", heatWarm: "#D9804F", heatHot: "#B8552A", highlight: "#E6D3A3",
    airCool: "#D2C08F", airWarm: "#D9804F", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "denim", name: "Denim", accent: "#C6D4E3", scene: {
    heatCool: "#A9BBCE", heatWarm: "#6B93C9", heatHot: "#2D5A96", highlight: "#C6D4E3",
    airCool: "#B7C7D9", airWarm: "#6B93C9", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "olive", name: "Olive", accent: "#D4D9B4", scene: {
    heatCool: "#B9C091", heatWarm: "#8FA35A", heatHot: "#4A5E1E", highlight: "#D4D9B4",
    airCool: "#C7CDA2", airWarm: "#8FA35A", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "sea", name: "Sea", accent: "#C3DCD5", scene: {
    heatCool: "#A3C4BB", heatWarm: "#5FA394", heatHot: "#24675A", highlight: "#C3DCD5",
    airCool: "#B3D0C8", airWarm: "#5FA394", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "cobalt", name: "Cobalt", accent: "#9DB8FF", scene: {
    heatCool: "#6F8FE0", heatWarm: "#F7CD5D", heatHot: "#E0A21F", highlight: "#9DB8FF",
    airCool: "#89A8F5", airWarm: "#F7CD5D", glow: 0.4, interior: 1.5, pedestalRim: 0.35 } },
  { id: "mono", name: "Mono", accent: "#F2F0EB", scene: {
    heatCool: "#B9B6AF", heatWarm: "#E5A08E", heatHot: "#E5735A", highlight: "#1B1B1F",
    airCool: "#A9A6A0", airWarm: "#E5735A", glow: 0.25, interior: 1, pedestalRim: 0.2 } },
  { id: "signal", name: "Signal", accent: "#C6F432", scene: {} },
];

export function sceneFor(style: StyleId, mode: Mode): SceneTheme {
  return style === "pulse" && mode === "light" ? pulseLightScene : sceneThemes[style];
}

export const accents = ["#E8692E", "#3C7BF0", "#2E9E6B", "#C2477A", "#8A63D2", "#C9A227", "#5B6573"];
