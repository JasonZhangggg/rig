// Turns what the server read off a motherboard manual's layout drawing into a
// board layout Rig can draw. The reader answers in the picture's pixels (it
// places things on a picture far better than it guesses millimetres); this
// file scales them to the board's standard size. Pure, so the server checks a
// reading the same way the app draws it.

import type { BoardItem, BoardShape } from "./build";
import { slotName } from "./build";
import { makerName } from "./manualParts";

/** The reader's kinds, as it is asked to name them. */
export const readerKinds = ["socket", "dimm", "pcie", "m2", "atx24", "eps", "fan", "usb3", "usbc", "usb2", "fp", "audio", "rgb", "sata", "tpm", "jumper", "battery", "chip", "rear-io", "other"] as const;
export type ReaderKind = (typeof readerKinds)[number];

/** One item as the reader writes it: [printed name, kind, x0, y0, x1, y1] in the picture's pixels. */
export type ReadItem = [string, string, number, number, number, number];

/** What the reader sends back for one drawing. */
export interface LayoutReading {
  /** The board's outline in the picture: x0, y0, x1, y1. */
  board: [number, number, number, number];
  /** The size the manual gives, if it says ("atx", "matx", "itx", "eatx"). */
  form?: string;
  items: ReadItem[];
}

/** A layout read from a manual, as the server keeps it for every PC with that board. */
export interface BoardLayout {
  maker: string;
  model: string;
  /** The manual's page the drawing is on, counted from 1. */
  page: number;
  reading: LayoutReading;
}

const formSize: Record<BoardShape["form"], [number, number]> = { atx: [244, 305], matx: [244, 244], itx: [170, 170], eatx: [277, 305] };

/** The key one board model's layout is kept under: the same for "MAG B650 TOMAHAWK WIFI (MS-7D75)" from any PC. */
export function boardKey(maker: string, model: string): string {
  const m = model.toUpperCase().replace(/\(MS-[0-9A-Z]+\)/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
  return `${makerName(maker).toLowerCase()}|${m}`;
}

/** The board's size: what the manual says, else the standard size whose sides fit the drawing. */
export function boardForm(r: Pick<LayoutReading, "board" | "form">, product = ""): BoardShape["form"] {
  const f = (r.form ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (f === "atx" || f === "matx" || f === "itx" || f === "eatx") return f;
  if (f === "microatx") return "matx";
  if (f === "miniitx") return "itx";
  const [x0, y0, x1, y1] = r.board;
  const ratio = (y1 - y0) / (x1 - x0);
  if (ratio > 1.18) return "atx";
  if (ratio > 1.05) return "eatx";
  return /\bITX\b|-I\b|\dI\b/i.test(product) ? "itx" : "matx";
}

const kindOf: Record<ReaderKind, BoardItem["kind"]> = {
  socket: "socket", dimm: "dimm", pcie: "pcie", m2: "m2", atx24: "power", eps: "power", fan: "fan",
  usb3: "usb", usbc: "usb", usb2: "usb", fp: "front-panel", audio: "audio", rgb: "rgb", sata: "sata",
  tpm: "other", jumper: "other", battery: "other", chip: "chipset", "rear-io": "io", other: "other",
};

const fanPins = ["Ground", "+12V", "Speed", "PWM"];

/** The plain name shown beside the printed one. */
function plainLabel(kind: ReaderKind, name: string, nth: number): string {
  const n = name.toUpperCase();
  switch (kind) {
    case "socket": return "Processor socket";
    case "dimm": return `Memory slot ${slotName(name.replace(/^DDR\d?[\s_-]*/i, "")) ?? name}`;
    case "pcie": return nth === 0 ? "Graphics card slot" : "PCIe slot";
    case "m2": return "M.2 slot";
    case "atx24": return "24-pin power";
    case "eps": return "Processor power";
    case "fan":
      if (/PUMP|AIO|W_?PUMP/.test(n)) return "Pump or fan";
      if (/CPU|OPT/.test(n)) return /OPT/.test(n) ? "Second processor fan" : "Processor fan";
      return /\d/.test(n) ? `Case fan ${n.match(/(\d+)\D*$/)?.[1] ?? ""}`.trim() : "Case fan";
    case "usb3": return "USB 3 front header (19-pin)";
    case "usbc": return "USB-C front header";
    case "usb2": return "USB 2 header";
    case "fp": return "Front panel header";
    case "audio": return "Front audio header";
    case "rgb": return /ARGB|ADD|JRAINBOW|ADDR|5V/.test(n) ? "ARGB header (5V)" : "RGB header (12V)";
    case "sata": return "SATA ports";
    case "tpm": return "TPM header";
    case "jumper": return /CMOS|CLR/.test(n) ? "Clear settings jumper" : "Jumper";
    case "battery": return "Settings battery";
    case "chip": return "Chipset";
    case "rear-io": return "Rear ports";
    default: return "Connector";
  }
}

/** A header's pin grid, laid along its long side. */
function pinsFor(kind: ReaderKind, wide: boolean): BoardItem["pins"] {
  const grid = (long: number, short: number, extra: Omit<NonNullable<BoardItem["pins"]>, "cols" | "rows"> = {}) =>
    wide ? { cols: long, rows: short, ...extra } : { cols: short, rows: long, ...extra };
  switch (kind) {
    case "fan": return grid(4, 1, { names: fanPins });
    case "fp": return grid(5, 2, { missing: [9] });
    case "usb3": return grid(10, 2, { missing: [19] });
    case "usb2": return grid(5, 2, { missing: [9] });
    case "audio": return grid(5, 2, { missing: [8] });
    case "atx24": return grid(12, 2);
    case "eps": return grid(4, 2);
    default: return undefined;
  }
}

const isKind = (k: string): k is ReaderKind => (readerKinds as readonly string[]).includes(k);
const finite = (...n: number[]) => n.every((x) => typeof x === "number" && Number.isFinite(x));

/** Why a reading can't be drawn, or null when it can. */
export function readingProblem(r: unknown): string | null {
  const o = r as Partial<LayoutReading> | null;
  if (!o || typeof o !== "object") return "no reading";
  const b = o.board;
  if (!Array.isArray(b) || b.length !== 4 || !finite(...b)) return "no board outline";
  const [x0, y0, x1, y1] = b;
  if (x1 - x0 < 50 || y1 - y0 < 50) return "board outline too small";
  const ratio = (y1 - y0) / (x1 - x0);
  if (ratio < 0.85 || ratio > 1.4) return "board outline isn't a standard board shape";
  if (!Array.isArray(o.items)) return "no items";
  const inside = o.items.filter((it) => Array.isArray(it) && it.length === 6 && typeof it[0] === "string" && finite(it[2], it[3], it[4], it[5]));
  if (inside.length < 8) return "too few items";
  if (!inside.some((it) => it[1] === "socket")) return "no processor socket";
  if (inside.filter((it) => it[1] === "dimm").length < 1) return "no memory slots";
  return null;
}

/**
 * The board layout from a reading: each rectangle scaled from the drawing's
 * outline to the board's standard size, cut to the board, with plain names and
 * pin grids. Items outside the board (a drawing's labels or ports) are dropped.
 */
export function layoutFromReading(layout: BoardLayout): Omit<BoardShape, "source"> {
  const r = layout.reading;
  const form = boardForm(r, layout.model);
  const [W, H] = formSize[form];
  const [bx0, by0, bx1, by1] = r.board;
  const sx = W / (bx1 - bx0), sy = H / (by1 - by0);
  const used = new Set<string>();
  const counts: Partial<Record<ReaderKind, number>> = {};
  const items: BoardItem[] = [];

  for (const raw of r.items) {
    if (!Array.isArray(raw) || raw.length !== 6) continue;
    const [label, k, x0, y0, x1, y1] = raw;
    if (typeof label !== "string" || !finite(x0, y0, x1, y1)) continue;
    const kind: ReaderKind = isKind(k) ? k : "other";
    let u0 = (Math.min(x0, x1) - bx0) * sx, u1 = (Math.max(x0, x1) - bx0) * sx;
    let v0 = (Math.min(y0, y1) - by0) * sy, v1 = (Math.max(y0, y1) - by0) * sy;
    // Mostly off the board: a label box or something drawn beside it.
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    if (cu < -2 || cu > W + 2 || cv < -2 || cv > H + 2) continue;
    u0 = Math.max(0, u0); v0 = Math.max(0, v0); u1 = Math.min(W, u1); v1 = Math.min(H, v1);
    const w = Math.max(1, u1 - u0), h = Math.max(1, v1 - v0);

    const nth = counts[kind] ?? 0;
    counts[kind] = nth + 1;
    const printed = label.trim().slice(0, 40);
    const name = kind === "dimm" ? slotName(printed.replace(/^DDR\d?[\s_-]*/i, "")) ?? printed : kind === "socket" ? "CPU" : printed;
    let id = `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || nth}`;
    while (used.has(id)) id += "-b";
    used.add(id);
    const pins = pinsFor(kind, w >= h);
    items.push({ id, name, label: plainLabel(kind, printed, nth), kind: kindOf[kind], u: round(u0), v: round(v0), w: round(w), h: round(h), ...(pins ? { pins } : {}) });
  }
  // The rear ports are seldom drawn as one part; the 3D view needs them.
  if (!items.some((i) => i.kind === "io")) items.unshift({ id: "io", name: "Rear I/O", label: "Rear ports", kind: "io", u: 0, v: 8, w: 22, h: Math.min(150, H - 16) });

  return {
    model: `${makerName(layout.maker)} ${layout.model}`.trim(),
    form, w: W, h: H, color: "#24262a", items,
    layoutFrom: `Read from page ${layout.page} of the manual. Usually within about 2 mm.`,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
