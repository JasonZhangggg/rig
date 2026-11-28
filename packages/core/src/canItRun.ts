// "Can my PC run this game?": the game's own minimum and recommended requirements, as a store or the publisher lists
// them, against the parts Rig read. The requirements come from a page Rig read (the server's lookup, see
// apps/server/src/requirements.ts) and are kept word for word; only the comparison happens here, in code.
//
// Processors and graphics are compared by a coarse tier table, not benchmark scores: a tier is a band of parts that
// play games about as well as each other, so two parts in the same tier count as a match. A part the table doesn't
// know, on either side, is said to be one Rig couldn't place, never guessed.

import type { HardwareFacts, ShopCategory } from "./shop";
import { categoryState } from "./shop";

/** One level of a game's requirements, as the page words it. Numbers are what the page gives, in GB. */
export interface SpecLevel {
  os?: string;
  cpu?: string;
  gpu?: string;
  memoryGb?: number;
  /** Video memory, when the page asks for it on its own line. */
  vramGb?: number;
  storageGb?: number;
  /** The page asks for an SSD. */
  ssd?: boolean;
}

export interface GameRequirements {
  /** The game's name as the page gives it. */
  game: string;
  minimum?: SpecLevel;
  recommended?: SpecLevel;
  /** The page the requirements were read from. */
  source: { url: string; label: string };
  /** When Rig read it (ISO). */
  readAt: string;
  /** Read once for the demo, and labelled as a sample. */
  demo?: boolean;
}

export type RunPart = "cpu" | "gpu" | "memory" | "storage" | "os";
/** How a part compares: meets the recommended, meets only the minimum, is below the minimum, or couldn't be compared. */
export type RunLevel = "recommended" | "minimum" | "below" | "unknown";
export type RunVerdict = "well" | "low" | "meets" | "below" | "unknown";

export interface PartCheck {
  part: RunPart;
  /** "Graphics card", "Memory". */
  label: string;
  /** What this PC has, in a few words. */
  yours: string;
  /** The page's own words for each level. */
  minimum?: string;
  recommended?: string;
  level: RunLevel;
  /** Below the recommended, though Rig couldn't check the minimum. */
  underRecommended?: boolean;
  /** Meets the minimum, but Rig couldn't place the recommended. */
  recommendedUnknown?: boolean;
  /** Why it couldn't be compared, in a sentence. */
  why?: string;
}

export interface RunAnswer {
  verdict: RunVerdict;
  /** One plain sentence. */
  headline: string;
  /** One grey line under it: the part that holds it back, or what Rig couldn't say. */
  sub?: string;
  parts: PartCheck[];
  /** The one part that holds it back. */
  holder?: RunPart;
  /** The Upgrades tab's kind of part for the holder, when this PC can take a new one. */
  upgrade?: ShopCategory;
}

// ----- Placing parts -----

type Vendor = "nvidia" | "amd" | "intel";
interface Placed { tier: number; vendor: Vendor; model: string }

// Graphics tiers, 1 (oldest integrated graphics) to 10 (today's fastest cards), keyed by the model as matched below.
const gpuTiers: Record<string, number> = {
  "gtx 650": 1, "gtx 660": 2, "gtx 670": 2, "gtx 680": 3, "gtx 750": 1, "gtx 750 ti": 2, "gtx 760": 2, "gtx 770": 3, "gtx 780": 3, "gtx 780 ti": 3,
  "gtx 950": 2, "gtx 960": 3, "gtx 970": 4, "gtx 980": 4, "gtx 980 ti": 5,
  "gt 1030": 1, "gtx 1050": 2, "gtx 1050 ti": 3, "gtx 1060": 4, "gtx 1070": 5, "gtx 1070 ti": 5, "gtx 1080": 6, "gtx 1080 ti": 7,
  "gtx 1630": 2, "gtx 1650": 3, "gtx 1650 super": 4, "gtx 1660": 4, "gtx 1660 super": 5, "gtx 1660 ti": 5,
  "rtx 2060": 5, "rtx 2060 super": 6, "rtx 2070": 6, "rtx 2070 super": 6, "rtx 2080": 7, "rtx 2080 super": 7, "rtx 2080 ti": 8,
  "rtx 3050": 5, "rtx 3060": 6, "rtx 3060 ti": 7, "rtx 3070": 7, "rtx 3070 ti": 8, "rtx 3080": 8, "rtx 3080 ti": 9, "rtx 3090": 9, "rtx 3090 ti": 9,
  "rtx 4060": 6, "rtx 4060 ti": 7, "rtx 4070": 8, "rtx 4070 super": 9, "rtx 4070 ti": 9, "rtx 4070 ti super": 10, "rtx 4080": 10, "rtx 4080 super": 10, "rtx 4090": 10,
  "rtx 5050": 6, "rtx 5060": 7, "rtx 5060 ti": 7, "rtx 5070": 9, "rtx 5070 ti": 10, "rtx 5080": 10, "rtx 5090": 10,
  "hd 7850": 2, "hd 7870": 3, "hd 7950": 3, "hd 7970": 3, "r7 370": 2, "r9 270": 2, "r9 270x": 3, "r9 280": 3, "r9 280x": 3, "r9 290": 4, "r9 290x": 4,
  "r9 380": 3, "r9 380x": 3, "r9 390": 4, "r9 390x": 4,
  "rx 460": 2, "rx 470": 4, "rx 480": 4, "rx 550": 1, "rx 560": 2, "rx 570": 4, "rx 580": 4, "rx 590": 4, "vega 56": 5, "vega 64": 5, "radeon vii": 6,
  "rx 5500 xt": 4, "rx 5600 xt": 5, "rx 5700": 6, "rx 5700 xt": 6,
  "rx 6400": 3, "rx 6500 xt": 3, "rx 6600": 6, "rx 6600 xt": 6, "rx 6650 xt": 6, "rx 6700": 7, "rx 6700 xt": 7, "rx 6750 xt": 7,
  "rx 6800": 8, "rx 6800 xt": 8, "rx 6900 xt": 9, "rx 6950 xt": 9,
  "rx 7600": 6, "rx 7600 xt": 6, "rx 7700 xt": 8, "rx 7800 xt": 9, "rx 7900 gre": 9, "rx 7900 xt": 10, "rx 7900 xtx": 10,
  "rx 9060 xt": 7, "rx 9070": 9, "rx 9070 xt": 10,
  "radeon 680m": 3, "radeon 760m": 3, "radeon 780m": 3, "radeon 880m": 3, "radeon 890m": 3, "vega 8": 1, "vega 11": 1,
  "arc a310": 2, "arc a380": 3, "arc a580": 5, "arc a750": 6, "arc a770": 6, "arc b570": 6, "arc b580": 7,
  "arc 130v": 3, "arc 140v": 3, "arc 140t": 3, "arc graphics": 3, "iris xe": 2, "iris plus": 1, "uhd graphics": 1, "hd graphics": 1,
};

const vendorOf = (model: string): Vendor => /^(gtx|rtx|gt|mx)\b/.test(model) ? "nvidia" : /^(arc|iris|uhd|hd graphics)\b/.test(model) ? "intel" : "amd";

/** Lower case, with trademark marks and makers' brand words out, so "NVIDIA® GeForce® GTX 1060" reads "gtx 1060". */
function plain(s: string): string {
  return s.toLowerCase().replace(/\((tm|r)\)|[®™]/g, " ").replace(/\bnvidia\b|\bgeforce\b|\bintel\b|\bamd\b/g, " ").replace(/\s+/g, " ").trim();
}

const gpuPatterns: RegExp[] = [
  /\b(rtx|gtx|gt|mx) ?(\d{3,4})(?: ?(ti))?(?: ?(super))?\b/g,
  /\b(rx) ?(\d{3,4}) ?(xtx|xt|gre)?\b/g,
  /\b(r[79]|hd) ?(\d{3,4})(x)?\b/g,
  /\b(vega) ?(56|64|8|11)\b/g,
  /\bradeon ?(vii|\d{3}m)\b/g,
  /\barc ?(a\d{3}|b\d{3}|\d{3}[vt]|graphics)\b/g,
  /\b(iris) ?(xe|plus)\b/g,
  /\b(uhd|hd) graphics\b/g,
];

function gpuKey(m: RegExpExecArray, i: number): string {
  switch (i) {
    case 0: return [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ");
    case 1: return [m[1], m[2], m[3]].filter(Boolean).join(" ");
    case 2: return `${m[1]} ${m[2]}${m[3] ?? ""}`;
    case 3: return `vega ${m[2]}`;
    case 4: return `radeon ${m[1]}`;
    case 5: return `arc ${m[1]}`;
    case 6: return `iris ${m[2]}`;
    default: return `${m[1]} graphics`;
  }
}

/** Every graphics model in a line that the table knows, in the order they appear. */
function gpusIn(text: string): Placed[] {
  const t = plain(text).replace(/\bradeon (rx|r[79]|hd)\b/g, "$1");
  const found: { at: number; p: Placed }[] = [];
  gpuPatterns.forEach((re, i) => {
    for (const m of t.matchAll(re)) {
      const model = gpuKey(m, i);
      const tier = gpuTiers[model];
      if (tier) found.push({ at: m.index!, p: { tier, vendor: vendorOf(model), model } });
    }
  });
  return found.sort((a, b) => a.at - b.at).map((f) => f.p);
}

/** This PC's graphics: a laptop's version of a card plays about a tier lower, and so do the low-power chips' own graphics. */
function placeYourGpu(name: string, cpu: string): Placed | null {
  const p = gpusIn(name)[0];
  if (!p) return null;
  const t = plain(name);
  const mobileCard = /\b(laptop|mobile|max-q)\b/.test(t) || (!p.model.startsWith("radeon") && / \d{3,4}m\b/.test(t));
  const lowPower = p.model === "arc graphics" && /\d{3}u\b/i.test(cpu);
  return mobileCard || lowPower ? { ...p, tier: Math.max(1, p.tier - 1) } : p;
}

// Processor tiers, 1 to 8. Intel Core by generation and class.
const intelTier = (gen: number, cls: number): number => {
  const row: Record<number, number> =
    gen <= 1 ? { 3: 1, 5: 1, 7: 1 }
    : gen <= 3 ? { 3: 1, 5: 2, 7: 2 }
    : gen <= 5 ? { 3: 1, 5: 2, 7: 3 }
    : gen <= 7 ? { 3: 2, 5: 3, 7: 4 }
    : gen <= 9 ? { 3: 3, 5: 4, 7: 5, 9: 5 }
    : gen <= 11 ? { 3: 4, 5: 5, 7: 6, 9: 6 }
    : gen === 12 ? { 3: 5, 5: 6, 7: 7, 9: 7 }
    : { 3: 5, 5: 7, 7: 8, 9: 8 };
  return row[cls] ?? 0;
};
// Ryzen by the desktop series it matches and class; X3D chips one tier up.
const ryzenTier = (series: number, cls: number, x3d: boolean): number => {
  const row: Record<number, number> =
    series === 1 ? { 3: 1, 5: 2, 7: 3 }
    : series === 2 ? { 3: 2, 5: 3, 7: 3 }
    : series <= 4 ? { 3: 3, 5: 4, 7: 5, 9: 5 }
    : series <= 6 ? { 3: 5, 5: 6, 7: 6, 9: 7 }
    : series <= 8 ? { 5: 7, 7: 7, 9: 8 }
    : { 5: 7, 7: 8, 9: 8 };
  const t = row[cls] ?? 0;
  return t && x3d ? Math.min(8, t + 1) : t;
};

function cpusIn(text: string): Placed[] {
  const t = plain(text).replace(/\bcore\b/g, " ").replace(/\s+/g, " ");
  const found: { at: number; p: Placed }[] = [];
  const add = (at: number, tier: number, vendor: Vendor, model: string) => { if (tier > 0) found.push({ at, p: { tier: Math.max(1, Math.min(8, tier)), vendor, model } }); };

  for (const m of t.matchAll(/\bi([3579])[- ]?(\d{3,5})([a-z]\d?)*/g)) {
    const digits = m[2];
    const gen = digits.length === 3 ? 1 : digits.length === 5 || digits.startsWith("1") ? Number(digits.slice(0, 2)) : Number(digits[0]);
    const suffix = m[0].slice(m[0].indexOf(digits) + digits.length);
    const low = /^(u|y|p|g\d)/.test(suffix) ? 1 : 0;
    add(m.index!, intelTier(gen, Number(m[1])) - low, "intel", `i${m[1]}-${digits}${suffix}`);
  }
  for (const m of t.matchAll(/\bultra ([579]) ?(\d)(\d{2})([a-z]*)/g)) {
    const cls = Number(m[1]), series = Number(m[2]), suffix = m[4];
    const desktop = series === 2 && (/^k|^f/.test(suffix) || suffix === "");
    const base = series === 1 ? { 5: 5, 7: 6, 9: 6 }[cls]! : desktop ? { 5: 7, 7: 8, 9: 8 }[cls]! : /^h/.test(suffix) ? { 5: 6, 7: 7, 9: 7 }[cls]! : { 5: 5, 7: 6, 9: 6 }[cls]!;
    add(m.index!, base - (suffix.startsWith("u") ? 1 : 0), "intel", `ultra ${cls} ${series}${m[3]}${suffix}`);
  }
  for (const m of t.matchAll(/\bryzen (?:pro )?([3579]) (?:pro )?(\d)(\d)(\d)(\d)(x3d|xt|x|ge|g|f|hx3d|hx|hs|h|u)?\b/g)) {
    const cls = Number(m[1]), first = Number(m[2]), third = Number(m[4]), suffix = m[6] ?? "";
    const mobile = /^(hx|hs|h|u)/.test(suffix);
    let series = first;
    if (mobile) series = first >= 7 ? ({ 1: 3, 2: 3, 3: 5, 4: 7 } as Record<number, number>)[third] ?? 0 : first <= 3 ? 2 : first === 4 ? 3 : 5;
    add(m.index!, ryzenTier(series, cls, suffix.includes("x3d")) - (suffix === "u" ? 1 : 0), "amd", `ryzen ${cls} ${m[2]}${m[3]}${m[4]}${m[5]}${suffix}`);
  }
  for (const m of t.matchAll(/\bryzen ai ([579]) (?:hx )?(\d{3})\b/g)) add(m.index!, { 5: 6, 7: 6, 9: 7 }[Number(m[1])]!, "amd", `ryzen ai ${m[1]} ${m[2]}`);
  for (const m of t.matchAll(/\b(fx[- ]?\d{4}|phenom|athlon|core 2|core2|pentium|celeron)\b/g)) add(m.index!, 1, /fx|phenom|athlon/.test(m[1]) ? "amd" : "intel", m[1]);
  return found.sort((a, b) => a.at - b.at).map((f) => f.p);
}

/** The alternative to hold this PC's part against: the one from the same maker when the page names one, else the easiest. */
function needed(text: string | undefined, yours: Placed | null, find: (t: string) => Placed[]): Placed | null | undefined {
  if (!text) return undefined;
  const alts = find(text);
  if (!alts.length) return null;
  const same = yours && alts.filter((a) => a.vendor === yours.vendor);
  const pool = same?.length ? same : alts;
  return pool.reduce((a, b) => (b.tier < a.tier ? b : a));
}

// ----- Windows -----

const winRank: Record<string, number> = { xp: 1, vista: 2, "7": 3, "8": 4, "8.1": 5, "10": 6, "11": 7 };
function windowsIn(text: string): number | null {
  const ranks = [...text.toLowerCase().matchAll(/windows\s*(?:®|\(r\))?\s*(11|10|8\.1|8|7|vista|xp)\b/g)].map((m) => winRank[m[1]]);
  // "Windows 10/11" and "Windows 10 or 11" ask for the older one.
  for (const m of text.matchAll(/windows\s*(?:®)?\s*(10|11)\s*(?:\/|or|and)\s*(10|11)/gi)) ranks.push(winRank[m[1]], winRank[m[2]]);
  return ranks.length ? Math.min(...ranks) : null;
}
const buildIn = (text: string) => Number(text.match(/\b(?:version|build)\s*(\d{5})/i)?.[1]) || null;

// ----- Words -----

const labels: Record<RunPart, string> = { cpu: "Processor", gpu: "Graphics card", memory: "Memory", storage: "Free space", os: "Windows" };
/** The part's name inside a sentence. */
const inline = (p: RunPart, f: HardwareFacts) => p === "gpu" && !f.gpu ? "graphics" : p === "storage" ? "free space" : p === "os" ? "Windows version" : labels[p].toLowerCase();
const possessive = (s: string) => (s.endsWith("s") ? `${s}'` : `${s}'s`);
const gb = (n: number) => `${Math.round(n).toLocaleString("en-US")} GB`;
const shortName = (n: string) => n.replace(/\((tm|r)\)|[®™]/gi, "").replace(/^(NVIDIA|AMD|Intel)\s+/i, "").replace(/^(GeForce|Radeon)\s+/i, "").replace(/\s+/g, " ").trim();

const meetsText = (s?: SpecLevel) => !!s && Object.values(s).some((v) => v !== undefined && v !== "" && v !== false);

/** One comparison: true when yours is enough, false when it's short, null when Rig can't say. */
type Cmp = boolean | null | undefined;

function levelOf(min: Cmp, rec: Cmp): Pick<PartCheck, "level" | "underRecommended" | "recommendedUnknown"> {
  if (min === false) return { level: "below" };
  if (rec === true) return { level: "recommended" };
  if (rec === false) return min === true ? { level: "minimum" } : { level: "unknown", underRecommended: true };
  if (min === true) return rec === null ? { level: "minimum", recommendedUnknown: true } : { level: "minimum" };
  return { level: "unknown" };
}

/** Compares this PC with a game's requirements, part by part, and says how it would run. */
export function canItRun(f: HardwareFacts, req: GameRequirements): RunAnswer {
  const min = meetsText(req.minimum) ? req.minimum : undefined;
  const hasRec = meetsText(req.recommended);
  // A line the recommended section leaves out is taken to be the same as the minimum's.
  const rec: SpecLevel | undefined = hasRec ? { ...min, ...Object.fromEntries(Object.entries(req.recommended!).filter(([, v]) => v !== undefined && v !== "")) } : undefined;
  const parts: PartCheck[] = [];
  const push = (part: RunPart, yours: string, mText: string | undefined, rText: string | undefined, m: Cmp, r: Cmp, why?: string) => {
    if (mText === undefined && rText === undefined) return;
    const lv = levelOf(m, r);
    const unsure = lv.level === "unknown" || lv.recommendedUnknown;
    parts.push({ part, label: part === "gpu" && !f.gpu ? "Graphics" : labels[part], yours, minimum: mText, recommended: rText, ...lv, ...(unsure && why ? { why } : {}) });
  };

  // Processor and graphics, by tier.
  const placedPart = (part: "cpu" | "gpu") => {
    const name = part === "cpu" ? f.cpu.name : f.gpu?.name ?? f.igpu;
    const yours = name ? (part === "cpu" ? cpusIn(name)[0] ?? null : placeYourGpu(name, f.cpu.name)) : null;
    const find = part === "cpu" ? cpusIn : gpusIn;
    const mNeed = needed(min?.[part], yours, find), rNeed = needed(rec?.[part], yours, find);
    const cmp = (n: Placed | null | undefined): Cmp => (n === undefined ? undefined : !yours || !n ? null : yours.tier >= n.tier);
    let m = cmp(mNeed), r = cmp(rNeed);
    if (part === "gpu" && f.gpu?.vramGb) {
      // Video memory the page asks for counts on its own: short of it is short, and it settles a card the page doesn't name.
      const vram = (c: Cmp, need?: number): Cmp => (!need ? c : f.gpu!.vramGb! < need ? false : c ?? true);
      m = vram(m, min?.vramGb);
      r = vram(r, rec?.vramGb);
    }
    const what = part === "cpu" ? "processor" : f.gpu ? "graphics card" : "graphics";
    const why = !name ? `Windows didn't name the ${what}.`
      : !yours ? `Rig couldn't place your ${what} against the game's.`
      : `Rig couldn't place the ${what} the page asks for.`;
    const yoursText = name ? shortName(name) : "Not known";
    push(part, yoursText, min?.[part], rec?.[part], m, r, why);
  };
  placedPart("cpu");
  placedPart("gpu");

  // Memory.
  {
    const have = f.memory.totalGb;
    const cmp = (n?: number): Cmp => (n === undefined ? undefined : have ? have >= n : null);
    push("memory", have ? gb(have) : "Not known", min?.memoryGb !== undefined ? gb(min.memoryGb) : undefined, rec?.memoryGb !== undefined ? gb(rec.memoryGb) : undefined,
      cmp(min?.memoryGb), cmp(rec?.memoryGb), "Windows didn't say how much memory is in it.");
  }

  // Free space: the roomiest drive that fits, an SSD where the page asks for one.
  {
    const vols = f.volumes ?? [];
    const fits = (s?: SpecLevel): Cmp => {
      if (s?.storageGb === undefined) return undefined;
      if (!vols.length) return null;
      const ok = vols.filter((v) => v.freeGb >= s.storageGb!);
      if (!s.ssd) return ok.length > 0;
      if (ok.some((v) => v.ssd === true)) return true;
      return ok.some((v) => v.ssd === undefined) ? null : false;
    };
    const need = (s?: SpecLevel) => (s?.storageGb !== undefined ? `${gb(s.storageGb)}${s.ssd ? " on an SSD" : ""}` : undefined);
    const roomy = [...vols].sort((a, b) => b.freeGb - a.freeGb)[0];
    const asked = rec ?? min;
    const best = asked?.ssd ? [...vols].filter((v) => v.ssd).sort((a, b) => b.freeGb - a.freeGb)[0] ?? roomy : roomy;
    push("storage", best ? `${gb(best.freeGb)} free on ${best.letter}` : "Not known", need(min), need(rec), fits(min), fits(rec),
      vols.length ? "Rig can't tell whether your drives are SSDs." : "Rig hasn't read your drives yet.");
  }

  // Windows.
  {
    const mine = f.os ? windowsIn(f.os.name) : null;
    const myBuild = Number(f.os?.build?.split(".")[0]) || null;
    const cmp = (text?: string): Cmp => {
      if (!text) return undefined;
      const need = windowsIn(text);
      if (need === null || mine === null) return null;
      if (mine !== need) return mine > need;
      const b = buildIn(text);
      return b && myBuild ? myBuild >= b : true;
    };
    push("os", f.os ? f.os.name : "Not known", min?.os, rec?.os, cmp(min?.os), cmp(rec?.os),
      f.os && mine === null ? "Rig couldn't read which Windows this is." : "The page doesn't name a Windows version.");
  }

  return verdictOf(f, req, parts, hasRec);
}

const priority: RunPart[] = ["gpu", "cpu", "memory", "storage", "os"];

function verdictOf(f: HardwareFacts, req: GameRequirements, parts: PartCheck[], hasRec: boolean): RunAnswer {
  const pc = f.name, game = req.game;
  const first = (pick: (p: PartCheck) => boolean) => priority.map((k) => parts.find((p) => p.part === k)).find((p) => p && pick(p));
  const unsure = parts.filter((p) => (p.part === "cpu" || p.part === "gpu") && ((p.level === "unknown" && !p.underRecommended) || p.recommendedUnknown));
  const left = unsure.length ? `Rig couldn't compare the ${unsure.map((p) => inline(p.part, f)).join(" or the ")}, so this is from the other parts.` : undefined;
  const upgradeFor = (p: RunPart): ShopCategory | undefined => {
    const cat = ({ cpu: "cpu", gpu: "gpu", memory: "memory", storage: "storage" } as Partial<Record<RunPart, ShopCategory>>)[p];
    return cat && categoryState(cat, f).open ? cat : undefined;
  };
  const answer = (verdict: RunVerdict, headline: string, subs: (string | undefined)[], holder?: RunPart): RunAnswer => {
    const sub = subs.filter(Boolean).join(" ");
    const upgrade = holder && upgradeFor(holder);
    return { verdict, headline, ...(sub ? { sub } : {}), parts, ...(holder ? { holder } : {}), ...(upgrade ? { upgrade } : {}) };
  };

  if (!parts.length) return answer("unknown", `Rig couldn't find ${possessive(game)} requirements on the page`, ["Ask Rig, and it can look further."]);
  const below = first((p) => p.level === "below");
  if (below) {
    const sub = below.part === "storage" ? `No drive has ${below.minimum} free.` : `Its ${inline(below.part, f)} ${are(below.part, f)} below the minimum the game asks for.`;
    return answer("below", `${pc} is below ${possessive(game)} minimum`, [sub], below.part);
  }
  if (parts.every((p) => p.level === "unknown" && !p.underRecommended)) {
    return answer("unknown", `Rig couldn't compare ${pc} with ${game}`, ["The page's requirements don't name parts Rig can place."]);
  }
  if (!hasRec) return answer("meets", `${pc} meets ${possessive(game)} minimum`, ["The page lists only a minimum, so Rig can't say how high the settings can go.", left]);
  const short = first((p) => (p.level === "minimum" && !p.recommendedUnknown) || !!p.underRecommended);
  if (short) {
    const sub = short.part === "storage" ? "There's less free space than the game recommends." : `Its ${inline(short.part, f)} ${are(short.part, f)} below what the game recommends.`;
    return answer("low", `${pc} runs ${game} at low settings`, [sub, left], short.part);
  }
  return answer("well", `${pc} runs ${game} well`, [left ?? "It meets what the game recommends."]);
}

const are = (p: RunPart, f: HardwareFacts) => (p === "gpu" && !f.gpu ? "are" : "is");

/** The level a part reached, in a word or two. */
export const runLevelWord: Record<RunLevel, string> = { recommended: "Recommended", minimum: "Minimum", below: "Below minimum", unknown: "Couldn't compare" };

// Exposed for the tests: where Rig places a part on its own.
export const placeCpu = (name: string) => cpusIn(name)[0]?.tier ?? null;
export const placeGpu = (name: string, cpu = "") => placeYourGpu(name, cpu)?.tier ?? null;
