// What the PC physically looks like, for the 3D view: the case, the board and
// where things sit on it, the graphics card, the cooler and the memory, in mm.
//
// Each part says where its shape came from, so the view can be honest about it:
//   detected  Windows named the exact model and Rig knows its size
//   picked    the person chose the model in Rig
//   catalog   Rig matched the name to a model it knows
//   estimated Rig knows the kind of part (a 4070 SUPER) but not the exact card
//   generic   nothing known, a typical part of that kind
//
// Pure: resolveBuild takes what the helper reads plus the person's picks and
// returns the shapes. The catalog is small data, one record per model.

import { msiMagB650TomahawkWifi } from "./boards/msi-mag-b650-tomahawk-wifi";

export type ShapeSource = "detected" | "picked" | "catalog" | "estimated" | "generic";

export interface CaseShape {
  model: string; source: ShapeSource;
  /** Outside size, mm: side to side, floor to top, front to back. */
  w: number; h: number; d: number;
  front: "mesh" | "glass" | "solid";
  /** Standard: PSU under a shroud at the bottom. Dual chamber: PSU behind the board tray, glass front and side. */
  layout: "standard" | "dual-chamber";
  color: string;
  /** Fan mounts that hold fans, front to back or left to right. */
  fans: { front: number; top: number; rear: number; side: number; bottom: number; size: 120 | 140 };
  /** Wood strips on the front, like the Fractal North. */
  trim?: string;
  /** Which of the 3D view's drawn designs this case is ("north", "o11-evo", "h5-flow"); missing: a plain case. */
  look?: string;
}

export interface GpuShape {
  model: string; source: ShapeSource;
  /** Length, height off the board and thickness, mm. */
  length: number; height: number; thick: number;
  fans: number; fanMm: number;
  shroud: string; backplate: boolean;
  /** The maker's cooler design the 3D view draws ("tuf", "strix", "ventus", "fe"); missing: a plain card. */
  look?: string;
}

export interface CoolerShape {
  model: string; source: ShapeSource;
  kind: "tower" | "dual-tower" | "aio" | "low-profile";
  /** Height off the board for an air cooler, mm. */
  height: number;
  fanMm: 120 | 140;
  /** Radiator length for a liquid cooler, mm (240, 280, 360). */
  radiator?: 240 | 280 | 360;
  /** Fins or pump, and the fans' own color when it isn't the theme's. */
  color: string; fanColor?: string;
  /** The drawn design ("nh-d15", "pa120", "lf3", "wraith"); missing: a plain cooler of its kind. */
  look?: string;
}

export interface MemoryShape {
  model: string; source: ShapeSource;
  height: number; color: string; rgb: boolean;
  /** The drawn heatspreader ("vengeance", "vengeance-rgb", "dominator"); missing: a plain stick. */
  look?: string;
  /** Slot names that hold a stick ("A2", "B2"). */
  slots: string[];
}

/** One thing on the board, in mm from the board's top rear corner: u toward the front, v down. */
export interface BoardItem {
  id: string;
  /** Printed name ("JFP1"). */
  name: string;
  /** Plain name ("Front panel header"). */
  label: string;
  kind: "socket" | "dimm" | "pcie" | "m2" | "power" | "fan" | "usb" | "front-panel" | "rgb" | "audio" | "sata" | "chipset" | "heatsink" | "io" | "other";
  u: number; v: number; w: number; h: number;
  /** Pin grid for a header: columns along u, rows along v, pin 1 first. */
  pins?: { cols: number; rows: number; missing?: number[]; names?: string[] };
}

export interface BoardShape {
  model: string; source: ShapeSource;
  form: "atx" | "matx" | "itx" | "eatx";
  /** Board size, mm: front to back, top to bottom. */
  w: number; h: number;
  color: string;
  /** Where each slot and header is. Missing: a typical board of that size. */
  items: BoardItem[];
  /** Where the item positions came from, shown to the person. */
  layoutFrom: string;
}

export interface BuildShape {
  case: CaseShape; board: BoardShape; gpu?: GpuShape; cooler: CoolerShape; memory: MemoryShape;
  /** Share of the visible parts whose shape is real (detected, picked or catalog), 0 to 1. */
  known: number;
}

/** What the helper reads that bears on shape, plus the person's picks. */
export interface BuildInput {
  /** null: no graphics card (the processor's own graphics). Missing: not known yet, a typical card. */
  gpu?: null | { name: string; /** PCI subsystem vendor id ("1043"), which names the card's maker. */ subsysVendor?: string; subsysId?: string };
  board?: { manufacturer: string; product: string };
  /** The board's layout read from its manual (boardLayout.ts), used when Rig has no record of its own for it. */
  boardLayout?: Omit<BoardShape, "source">;
  memory?: { slotsTotal?: number; modules: { partNumber?: string; manufacturer?: string; slot?: string }[] };
  picks?: { case?: string; cooler?: string; gpu?: string };
}

// ---------- catalog ----------
// Sizes are the makers' own figures where their pages give them (checked 2026-11-22).

export const cases: Record<string, Omit<CaseShape, "source">> = {
  "fractal-north": { model: "Fractal Design North", w: 215, h: 469, d: 447, front: "mesh", layout: "standard", color: "#2b2b2e", fans: { front: 2, top: 0, rear: 1, side: 0, bottom: 0, size: 140 }, trim: "#8a5a35", look: "north" },
  "lianli-o11-evo": { model: "Lian Li O11 Dynamic EVO", w: 285, h: 459, d: 465, front: "glass", layout: "dual-chamber", color: "#1d1e21", fans: { front: 0, top: 3, rear: 1, side: 3, bottom: 3, size: 120 }, look: "o11-evo" },
  "nzxt-h5-flow": { model: "NZXT H5 Flow", w: 227, h: 464, d: 446, front: "mesh", layout: "standard", color: "#ececec", fans: { front: 2, top: 0, rear: 1, side: 0, bottom: 1, size: 120 }, look: "h5-flow" },
};

export const gpus: Record<string, Omit<GpuShape, "source"> & { chip: string; maker: string }> = {
  "asus-tuf-4070s-oc": { model: "ASUS TUF RTX 4070 SUPER OC", chip: "RTX 4070 SUPER", maker: "1043", length: 301, height: 139, thick: 63, fans: 3, fanMm: 92, shroud: "#3a3c40", backplate: true, look: "tuf" },
  "asus-strix-4070s-oc": { model: "ASUS ROG Strix RTX 4070 SUPER OC", chip: "RTX 4070 SUPER", maker: "1043", length: 339, height: 149, thick: 62, fans: 3, fanMm: 98, shroud: "#2a2b30", backplate: true, look: "strix" },
  "msi-ventus2x-4070s-oc": { model: "MSI RTX 4070 SUPER Ventus 2X OC", chip: "RTX 4070 SUPER", maker: "1462", length: 242, height: 125, thick: 43, fans: 2, fanMm: 95, shroud: "#2f3033", backplate: true, look: "ventus" },
  "nvidia-fe-4070s": { model: "NVIDIA RTX 4070 SUPER Founders Edition", chip: "RTX 4070 SUPER", maker: "10de", length: 244, height: 112, thick: 40, fans: 2, fanMm: 90, shroud: "#2b2c2e", backplate: true, look: "fe" },
};

/** A typical card of each chip, for when the exact card isn't known. */
const chipTypical: Record<string, Pick<GpuShape, "length" | "height" | "thick" | "fans" | "fanMm">> = {
  "RTX 4070 SUPER": { length: 270, height: 125, thick: 50, fans: 2, fanMm: 95 },
  "RTX 4090": { length: 340, height: 145, thick: 72, fans: 3, fanMm: 100 },
  "RTX 4060": { length: 200, height: 115, thick: 40, fans: 2, fanMm: 85 },
};

export const coolers: Record<string, Omit<CoolerShape, "source">> = {
  "noctua-nh-d15": { model: "Noctua NH-D15", kind: "dual-tower", height: 165, fanMm: 140, color: "#c8ccd1", fanColor: "#d9c4a3", look: "nh-d15" },
  "thermalright-pa120se": { model: "Thermalright Peerless Assassin 120 SE", kind: "dual-tower", height: 155, fanMm: 120, color: "#c9ccd0", fanColor: "#1c1d20", look: "pa120" },
  "arctic-lf3-360": { model: "Arctic Liquid Freezer III 360", kind: "aio", height: 0, fanMm: 120, radiator: 360, color: "#1f2023", look: "lf3" },
  "amd-wraith-prism": { model: "AMD Wraith Prism", kind: "low-profile", height: 93, fanMm: 120, color: "#2a2a2a", look: "wraith" },
};

/** Memory kits named by the start of their part number, which the stick itself reports. */
const memoryFamilies: { prefix: RegExp; model: string; height: number; color: string; rgb: boolean; look: string }[] = [
  { prefix: /^CMK\d+GX5/i, model: "Corsair Vengeance DDR5", height: 35, color: "#1c1c1e", rgb: false, look: "vengeance" },
  { prefix: /^CMH\d+GX5/i, model: "Corsair Vengeance RGB DDR5", height: 44, color: "#1c1c1e", rgb: true, look: "vengeance-rgb" },
  { prefix: /^CMT\d+GX5/i, model: "Corsair Dominator Platinum RGB DDR5", height: 56, color: "#2a2a2c", rgb: true, look: "dominator" },
  { prefix: /^CMP\d+GX5/i, model: "Corsair Dominator Titanium RGB DDR5", height: 57, color: "#3a3b3e", rgb: true, look: "dominator" },
];

/** Board layouts by product name. Positions in mm; see BoardItem. */
export const boards: Record<string, Omit<BoardShape, "source">> = {
  "MAG B650 TOMAHAWK WIFI": msiMagB650TomahawkWifi,
};

// ---------- typical boards ----------

const formSize = { atx: [244, 305], matx: [244, 244], itx: [170, 170], eatx: [277, 305] } as const;

/** A typical ATX layout: where most boards put each thing, from the ATX spacing rules. */
function typicalItems(form: BoardShape["form"]): BoardItem[] {
  const [w, h] = formSize[form];
  const sk = { u: form === "itx" ? 85 : 105, v: form === "itx" ? 60 : 72 };
  const dimmU = form === "itx" ? [132, 144] : [158, 168, 181, 191];
  const items: BoardItem[] = [
    { id: "io", name: "Rear I/O", label: "Rear ports", kind: "io", u: 0, v: 8, w: 22, h: 150 },
    { id: "socket", name: "CPU", label: "Processor socket", kind: "socket", u: sk.u - 20, v: sk.v - 20, w: 40, h: 40 },
    { id: "vrm-top", name: "", label: "Power heatsink", kind: "heatsink", u: 52, v: 10, w: 90, h: 18 },
    { id: "vrm-left", name: "", label: "Power heatsink", kind: "heatsink", u: 26, v: 28, w: 20, h: 95 },
    ...dimmU.map((u, i) => ({ id: `dimm-${i}`, name: form === "itx" ? ["A2", "B2"][i] : ["A1", "A2", "B1", "B2"][i], label: "Memory slot", kind: "dimm" as const, u, v: 14, w: 6, h: 133 })),
    { id: "atx24", name: "ATX_PWR1", label: "24-pin power", kind: "power", u: w - 10, v: 96, w: 8, h: 52, pins: { cols: 2, rows: 12 } },
    { id: "eps", name: "CPU_PWR1", label: "Processor power (8-pin)", kind: "power", u: 30, v: 2, w: 19, h: 9, pins: { cols: 4, rows: 2 } },
    { id: "cpu-fan", name: "CPU_FAN1", label: "Processor fan", kind: "fan", u: 150, v: 4, w: 10, h: 3, pins: { cols: 4, rows: 1, names: ["Ground", "+12V", "Speed", "PWM"] } },
    { id: "pcie1", name: "PCI_E1", label: "Graphics card slot", kind: "pcie", u: 42, v: form === "itx" ? 140 : 156, w: 89, h: 7 },
  ];
  if (form !== "itx") {
    items.push(
      { id: "m2-1", name: "M2_1", label: "M.2 slot (processor)", kind: "m2", u: 48, v: 132, w: 80, h: 22 },
      { id: "chipset", name: "", label: "Chipset heatsink", kind: "chipset", u: 168, v: 196, w: 45, h: 45 },
      { id: "fp", name: "JFP1", label: "Front panel header", kind: "front-panel", u: w - 30, v: h - 9, w: 13, h: 5, pins: { cols: 5, rows: 2, missing: [9] } },
    );
  }
  return items.filter((i) => i.v + i.h <= h + 1);
}

function typicalBoard(form: BoardShape["form"], model: string, source: ShapeSource): BoardShape {
  const [w, h] = formSize[form];
  return { model, source, form, w, h, color: "#24262a", items: typicalItems(form), layoutFrom: "A typical board this size" };
}

const genericCase: CaseShape = { model: "Your case", source: "generic", w: 227, h: 446, d: 464, front: "mesh", layout: "standard", color: "#e9e9e6", fans: { front: 2, top: 0, rear: 1, side: 0, bottom: 0, size: 120 } };
const genericCooler: CoolerShape = { model: "Processor cooler", source: "generic", kind: "dual-tower", height: 155, fanMm: 120, color: "#2c2d30" };

/** The card's chip from the name Windows gives ("NVIDIA GeForce RTX 4070 SUPER" -> "RTX 4070 SUPER"). */
export function gpuChip(name: string): string | undefined {
  const m = /\b(RTX|GTX|RX|Arc)\s*([A-Z]?\d{3,4})(\s*(Ti SUPER|Ti|SUPER|XTX|XT|GRE))?/i.exec(name);
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}${m[4] ? " " + m[4].toUpperCase().replace("TI", "Ti") : ""}` : undefined;
}

/** The cards Rig knows for this chip and maker, for the "Which card is it?" picker. */
export function gpuCandidates(input: NonNullable<BuildInput["gpu"]>) {
  const chip = gpuChip(input.name);
  return Object.entries(gpus).filter(([, g]) => g.chip === chip && (!input.subsysVendor || g.maker === input.subsysVendor.toLowerCase()));
}

/** "DIMM_A2", "A2", "DIMM A2" -> "A2". Other forms ("Controller0-ChannelA-DIMM1") aren't read yet. */
export function slotName(locator?: string) {
  const m = /^(?:DIMM)?[\s_-]*([AB])[\s_-]*([12])$/i.exec((locator ?? "").trim());
  return m ? `${m[1].toUpperCase()}${m[2]}` : undefined;
}

export function memoryFamily(partNumber?: string) {
  if (!partNumber) return undefined;
  return memoryFamilies.find((f) => f.prefix.test(partNumber.trim()));
}

export function resolveBuild(input: BuildInput): BuildShape {
  const picks = input.picks ?? {};
  const c = picks.case && cases[picks.case] ? { ...cases[picks.case], source: "picked" as const } : genericCase;

  // Board: a known layout by product name, or a typical one by size.
  const product = input.board?.product ?? "";
  const known = boards[product.toUpperCase()];
  const form: BoardShape["form"] = /\bITX\b|-I\b/i.test(product) ? "itx" : /\bM\b|M-|MATX|\dM\b/i.test(product) ? "matx" : "atx";
  const fromManual = input.boardLayout;
  const board: BoardShape = known ? { ...known, source: "detected" } : fromManual ? { ...fromManual, source: "detected" } : typicalBoard(form, product ? `${input.board?.manufacturer} ${product}` : "Motherboard", product ? "estimated" : "generic");

  // Graphics card: the person's pick, the one card Rig knows for this chip and maker, or a typical card of the chip.
  let gpu: GpuShape | undefined;
  if (input.gpu === undefined) gpu = { model: "Graphics card", source: "generic", length: 267, height: 134, thick: 42, fans: 2, fanMm: 95, shroud: "#2f3033", backplate: true };
  else if (input.gpu) {
    const picked = picks.gpu && gpus[picks.gpu];
    const found = gpuCandidates(input.gpu);
    const chip = gpuChip(input.gpu.name);
    if (picked) gpu = { ...picked, source: "picked" };
    else if (found.length === 1 && input.gpu.subsysVendor) gpu = { ...found[0][1], source: "catalog" };
    else gpu = { model: input.gpu.name, source: chip && chipTypical[chip] ? "estimated" : "generic", ...(chip && chipTypical[chip] ? chipTypical[chip] : { length: 267, height: 134, thick: 42, fans: 2, fanMm: 95 }), shroud: "#2f3033", backplate: true };
  }

  const cooler = picks.cooler && coolers[picks.cooler] ? { ...coolers[picks.cooler], source: "picked" as const } : genericCooler;

  // Memory: the family from the part number, the sticks from the slots they report.
  const mods = input.memory?.modules ?? [];
  const fam = memoryFamily(mods[0]?.partNumber);
  const dimms = board.items.filter((i) => i.kind === "dimm").map((i) => i.name);
  // Sticks go in the slots they report; a slot name Rig can't read takes the slots boards recommend (A2, B2, then A1, B1).
  const recommended = ["A2", "B2", "A1", "B1"].filter((n) => dimms.includes(n));
  const slots: string[] = [];
  mods.forEach((m) => {
    const named = slotName(m.slot);
    const name = named && dimms.includes(named) && !slots.includes(named) ? named : recommended.find((n) => !slots.includes(n));
    if (name) slots.push(name);
  });
  const memory: MemoryShape = fam
    ? { model: fam.model, source: "detected", height: fam.height, color: fam.color, rgb: fam.rgb, look: fam.look, slots }
    : { model: "Memory", source: mods.length ? "estimated" : "generic", height: 34, color: "#1c1c1e", rgb: false, slots: slots.length ? slots : ["A2", "B2"] };

  const real = (s: ShapeSource) => s === "detected" || s === "picked" || s === "catalog";
  const shapes = [c.source, board.source, cooler.source, memory.source, ...(gpu ? [gpu.source] : [])];
  return { case: c, board, gpu, cooler, memory, known: shapes.filter(real).length / shapes.length };
}
