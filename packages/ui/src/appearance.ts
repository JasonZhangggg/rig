// How Rig looks on this device: the data colors, the chrome around them, corners,
// spacing, text size and motion. The stylesheet reads the tokens set here, so a
// change shows on every screen at once.

export type RGB = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
};
export const rgbToHex = (c: RGB) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

const toLinear = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** WCAG relative luminance, 0 for black to 1 for white. */
export const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex).map(toLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** WCAG contrast ratio between two colors, 1 to 21. */
export const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** Mixes a toward b by t (0 is a, 1 is b). */
export const mix = (a: string, b: string, t: number) => { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t) as RGB); };

function toHsl(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl([h, s, l]: RGB) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** Moves a color's lightness, keeping its hue, until `ok` holds. Gives the last try when nothing passes. */
export function shiftUntil(hex: string, dir: "darker" | "lighter", ok: (c: string) => boolean) {
  if (ok(hex)) return hex;
  const [h, s, l] = toHsl(hex);
  let out = hex;
  for (let k = 1; k <= 100; k++) {
    const nl = dir === "darker" ? l * (1 - k / 100) : l + (1 - l) * (k / 100);
    out = fromHsl([h, s, nl]);
    if (ok(out)) return out;
  }
  return out;
}

const passes = (c: string, on: string[], min: number) => on.every((b) => contrast(c, b) >= min);

// ----- Telling two colors apart, also with color blindness -----

// Machado, Oliveira and Fernandes (2009), full strength, in linear RGB.
const visions: Record<string, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export function seenWith(hex: string, vision: keyof typeof visions) {
  const m = visions[vision], [r, g, b] = hexToRgb(hex).map(toLinear);
  const out = [0, 1, 2].map((i) => Math.min(1, Math.max(0, m[i * 3] * r + m[i * 3 + 1] * g + m[i * 3 + 2] * b)));
  return rgbToHex(out.map(fromLinear) as RGB);
}

function lab(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const deltaE = (a: string, b: string) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

/** How far apart two colors look for the person who sees them least apart: typical vision and the three full color blindnesses. */
export const leastDifference = (a: string, b: string) =>
  Math.min(deltaE(a, b), ...Object.keys(visions).map((v) => deltaE(seenWith(a, v), seenWith(b, v))));

/** Settled and Needs a look must stay this far apart for everyone. */
export const DISTINCT = 20;

// ----- What can be picked -----

export interface DataColors {
  /** Settled, running well. */
  good: string;
  /** Needs a look. */
  look: string;
  /** What's normal, like a typical reading. */
  expected: string;
}

export interface Derived {
  goodMark: string; goodText: string; goodBg: string; goodOnDark: string;
  lookText: string; lookBg: string; lookOnDark: string;
}

/** Colors the 3D PC draws with. */
export interface SceneColors { heatCool: string; heatWarm: string; heatHot: string; airCool: string; airWarm: string; highlight: string }

export interface PalettePreset {
  id: string;
  name: string;
  blurb: string;
  colors: DataColors;
  /** Brass pins the values it shipped with, so the default never drifts. */
  derived?: Derived;
  scene?: SceneColors;
}

export const palettes: PalettePreset[] = [
  {
    id: "brass", name: "Brass", blurb: "Pale gold and rust. The Rig look.",
    colors: { good: "#E6D3A3", look: "#D9804F", expected: "#A7A39B" },
    derived: { goodMark: "#7C6A3A", goodText: "#6A5A2E", goodBg: "#F3EDDD", goodOnDark: "#E6D3A3", lookText: "#A4471C", lookBg: "#F8E2D5", lookOnDark: "#D9804F" },
    scene: { heatCool: "#BFAA78", heatWarm: "#D9804F", heatHot: "#B8552A", airCool: "#D2C08F", airWarm: "#D9804F", highlight: "#E6D3A3" },
  },
  { id: "sage", name: "Sage", blurb: "Soft green with terracotta.", colors: { good: "#BFD6AE", look: "#D5734F", expected: "#A3A69C" } },
  { id: "cobalt", name: "Cobalt", blurb: "Clear blue with amber.", colors: { good: "#B5C8F0", look: "#E39A3B", expected: "#A2A5AD" } },
  { id: "coral", name: "Coral", blurb: "Sea glass with warm coral.", colors: { good: "#A8DCCF", look: "#E8796A", expected: "#A6A29D" } },
  { id: "lilac", name: "Lilac", blurb: "Lilac with rose.", colors: { good: "#D2C5EE", look: "#DA6A90", expected: "#A6A2AC" } },
  { id: "butter", name: "Butter", blurb: "Butter yellow with tomato.", colors: { good: "#F0DC8E", look: "#E2694C", expected: "#A9A497" } },
  { id: "quiet", name: "Quiet", blurb: "Greys, with amber only where something needs a look.", colors: { good: "#D9D6CF", look: "#EFA03A", expected: "#A7A39B" } },
  { id: "clear", name: "Clear", blurb: "Sky blue and orange that stay apart with color blindness.", colors: { good: "#56B4E9", look: "#E69F00", expected: "#9A9A9A" } },
];

export const brass = palettes[0];

export interface Chrome { id: string; name: string; graphite: string; raised: string }
export const chromes: Chrome[] = [
  { id: "graphite", name: "Graphite", graphite: "#1B1B1F", raised: "#26262B" },
  { id: "walnut", name: "Walnut", graphite: "#2A211C", raised: "#382C26" },
  { id: "ink", name: "Ink", graphite: "#172031", raised: "#212B3E" },
  { id: "forest", name: "Forest", graphite: "#16251F", raised: "#20312A" },
  { id: "plum", name: "Plum", graphite: "#261B29", raised: "#332536" },
];

export interface PageTone { id: string; name: string; ground: string; band: string; bg: string }
export const pageTones: PageTone[] = [
  { id: "warm", name: "Warm", ground: "#E4E1DA", band: "#EAE7E1", bg: "#F2F0EC" },
  { id: "stone", name: "Stone", ground: "#E2E2E0", band: "#E9E9E7", bg: "#F2F2F1" },
  { id: "mist", name: "Mist", ground: "#DEE2E7", band: "#E6E9ED", bg: "#F1F3F6" },
];

export const cornerSets = [
  { id: "rounded", name: "Rounded", r: 28, sm: 14 },
  { id: "soft", name: "Soft", r: 18, sm: 10 },
  { id: "square", name: "Square", r: 8, sm: 5 },
] as const;

export const densities = [
  { id: "comfortable", name: "Comfortable", gap: 14, fs: 15 },
  { id: "compact", name: "Compact", gap: 10, fs: 14 },
] as const;

export const textSizes = [
  { id: "default", name: "Default", zoom: 1 },
  { id: "large", name: "Larger", zoom: 1.1 },
  { id: "larger", name: "Largest", zoom: 1.2 },
] as const;

export const motions = [
  { id: "system", name: "Follow system" },
  { id: "reduce", name: "Reduce" },
] as const;

export interface Appearance {
  /** A preset's id, or "custom". */
  palette: string;
  custom: DataColors;
  chrome: string;
  page: string;
  corners: (typeof cornerSets)[number]["id"];
  density: (typeof densities)[number]["id"];
  text: (typeof textSizes)[number]["id"];
  motion: (typeof motions)[number]["id"];
}

export const defaultAppearance: Appearance = {
  palette: "brass", custom: { ...brass.colors }, chrome: "graphite", page: "warm", corners: "rounded", density: "comfortable", text: "default", motion: "system",
};

const oneOf = <T extends string>(v: unknown, ids: readonly { id: T }[], fallback: T): T => (ids.some((x) => x.id === v) ? (v as T) : fallback);

/** Reads a saved appearance, keeping what is valid and falling back to the default for the rest. */
export function parseAppearance(raw: string | null | undefined): Appearance {
  let v: Partial<Record<keyof Appearance, unknown>> = {};
  try { const p: unknown = JSON.parse(raw ?? "{}"); if (p && typeof p === "object") v = p as typeof v; } catch { /* a damaged value means the default look */ }
  const d = defaultAppearance;
  const c = (v.custom && typeof v.custom === "object" ? v.custom : {}) as Partial<DataColors>;
  return {
    palette: v.palette === "custom" ? "custom" : oneOf(v.palette, palettes, d.palette),
    custom: { good: isHex(c.good) ? c.good : d.custom.good, look: isHex(c.look) ? c.look : d.custom.look, expected: isHex(c.expected) ? c.expected : d.custom.expected },
    chrome: oneOf(v.chrome, chromes, d.chrome),
    page: oneOf(v.page, pageTones, d.page),
    corners: oneOf(v.corners, cornerSets, d.corners),
    density: oneOf(v.density, densities, d.density),
    text: oneOf(v.text, textSizes, d.text),
    motion: oneOf(v.motion, motions, d.motion),
  };
}

/** True when nothing differs from how Rig ships, custom colors included. */
export const isDefaultAppearance = (a: Appearance) => (Object.keys(defaultAppearance) as (keyof Appearance)[]).every((k) =>
  k === "custom" ? (["good", "look", "expected"] as const).every((r) => a.custom[r] === defaultAppearance.custom[r]) : a[k] === defaultAppearance[k]);

export const chromeOf = (a: Appearance) => chromes.find((c) => c.id === a.chrome) ?? chromes[0];
export const pageOf = (a: Appearance) => pageTones.find((p) => p.id === a.page) ?? pageTones[0];
export const presetOf = (a: Appearance) => (a.palette === "custom" ? null : palettes.find((p) => p.id === a.palette) ?? brass);
export const colorsOf = (a: Appearance): DataColors => presetOf(a)?.colors ?? a.custom;

/** Light backgrounds text sits on: cards, the page and its bands. */
const lightGrounds = (page: PageTone) => ["#FFFFFF", page.bg, page.band];

/** A pale wash of a color for chips and highlighted rows. */
const tint = (c: string) => { for (let k = 55; k < 100; k++) { const t = mix(c, "#FFFFFF", k / 100); if (luminance(t) >= 0.8) return t; } return mix(c, "#FFFFFF", 0.95); };

/** Works out text, mark, wash and on-graphite shades for a set of data colors, so text keeps AA contrast on light and dark. */
export function derive(colors: DataColors, chrome: Chrome = chromes[0], page: PageTone = pageTones[0]): Derived {
  const grounds = lightGrounds(page), dark = [chrome.graphite, chrome.raised];
  const goodBg = tint(colors.good), lookBg = tint(colors.look);
  return {
    goodBg, lookBg,
    goodMark: shiftUntil(colors.good, "darker", (c) => passes(c, ["#FFFFFF", page.bg], 4)),
    goodText: shiftUntil(colors.good, "darker", (c) => passes(c, [...grounds, goodBg], 5.2)),
    lookText: shiftUntil(colors.look, "darker", (c) => passes(c, [...grounds, lookBg], 4.6)),
    goodOnDark: shiftUntil(colors.good, "lighter", (c) => passes(c, dark, 4.6)),
    lookOnDark: shiftUntil(colors.look, "lighter", (c) => passes(c, dark, 4.6)),
  };
}

/** Whether derived shades keep AA text contrast on the light grounds and on the chrome. */
export function meetsContrast(d: Derived, chrome: Chrome = chromes[0], page: PageTone = pageTones[0]) {
  const grounds = lightGrounds(page), dark = [chrome.graphite, chrome.raised];
  return passes(d.goodText, [...grounds, d.goodBg], 4.5) && passes(d.lookText, [...grounds, d.lookBg], 4.5)
    && passes(d.goodOnDark, dark, 4.5) && passes(d.lookOnDark, dark, 4.5) && passes(d.goodMark, ["#FFFFFF"], 3);
}

/** The data colors with their derived shades, as the current appearance has them. */
export function paletteOf(a: Appearance) {
  const preset = presetOf(a), colors = colorsOf(a), chrome = chromeOf(a), page = pageOf(a);
  const pinned = preset?.derived && meetsContrast(preset.derived, chrome, page) ? preset.derived : null;
  return { colors, ...(pinned ?? derive(colors, chrome, page)) };
}

export function sceneColorsOf(a: Appearance): SceneColors {
  const preset = presetOf(a);
  if (preset?.scene) return preset.scene;
  const p = paletteOf(a);
  return {
    heatCool: mix(p.colors.good, p.goodMark, 0.4), heatWarm: p.colors.look, heatHot: mix(p.colors.look, p.lookText, 0.55),
    airCool: mix(p.colors.good, p.goodMark, 0.2), airWarm: p.colors.look, highlight: p.colors.good,
  };
}

/** Every CSS custom property the appearance sets on the page. */
export function tokensOf(a: Appearance): Record<string, string> {
  const p = paletteOf(a), chrome = chromeOf(a), page = pageOf(a);
  const corners = cornerSets.find((c) => c.id === a.corners) ?? cornerSets[0];
  const density = densities.find((d) => d.id === a.density) ?? densities[0];
  return {
    "--good": p.colors.good, "--good-mark": p.goodMark, "--good-text": p.goodText, "--good-bg": p.goodBg, "--good-on-dark": p.goodOnDark,
    "--look": p.colors.look, "--look-text": p.lookText, "--look-bg": p.lookBg, "--look-on-dark": p.lookOnDark,
    "--expected": p.colors.expected,
    "--graphite": chrome.graphite, "--graphite-2": chrome.raised,
    "--ground": page.ground, "--band": page.band, "--bg": page.bg, "--surface-2": page.bg,
    "--r": `${corners.r}px`, "--r-sm": `${corners.sm}px`,
    "--gap": `${density.gap}px`, "--fs": `${density.fs}px`,
  };
}

/** Puts an appearance on the page and tells the canvases (3D PC, sign-in art) to repaint. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(tokensOf(a))) root.style.setProperty(k, v);
  if (a.motion === "reduce") root.dataset.motion = "reduce"; else delete root.dataset.motion;
  if (a.text === "default") delete root.dataset.text; else root.dataset.text = a.text;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", pageOf(a).ground);
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

export const APPEARANCE_EVENT = "rig:appearance";

let motionQuery: MediaQueryList | null | undefined;
/** True when motion should stay still: picked in Settings, or asked for by the system. */
export function reducedMotion() {
  if (document.documentElement.dataset.motion === "reduce") return true;
  if (motionQuery === undefined) motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  return motionQuery?.matches ?? false;
}

/** Labels on a fill: dark ink on Settled, graphite on Needs a look. */
export const FILL_INK = "#111111";
export const fillProblems = (colors: DataColors, chrome: Chrome = chromes[0]) => ({
  goodTooDark: contrast(FILL_INK, colors.good) < 4.5,
  lookTooDark: contrast(chrome.graphite, colors.look) < 4.5,
  tooAlike: leastDifference(colors.good, colors.look) < DISTINCT,
});
export const lightenForInk = (c: string, ink: string) => shiftUntil(c, "lighter", (x) => contrast(ink, x) >= 4.6);
