// Finds the pages of a manual that hold the useful diagrams, from the words
// pdf.js read off each page. Pure: the app runs it once after reading a PDF.
//
// A diagram page has a heading ("Front panel header") and many short labels
// (F_PANEL, PWR_LED+, RESET SW) with few sentences. A page that mentions a
// header in passing ("connect the fan to CPU_FAN") is prose and doesn't count.

import type { DiagramKind, ManualDiagram, ManualPage } from "./manuals";

export const diagramLabels: Record<DiagramKind, string> = {
  "board-layout": "Board layout",
  "front-panel": "Front panel header",
  "fan-headers": "Fan headers",
  "memory-slots": "Memory slot order",
  "m2-slots": "M.2 slots",
  "rear-io": "Rear ports",
  "power-connectors": "Power connectors",
  "rgb-headers": "RGB headers",
  "usb-headers": "USB headers",
  dimensions: "Dimensions",
  installation: "Installation",
  specs: "Specifications",
};

interface Rule {
  kind: DiagramKind;
  /** Headings, matched against short lines and the start of the page. */
  titles: RegExp[];
  /** Labels printed on the drawing. Each different one counts once. */
  labels?: RegExp;
  /** Without a heading the page needs this many different labels. Never, when missing. */
  alone?: number;
  /** With a heading the page still needs this many labels. */
  withTitle?: number;
}

const rules: Rule[] = [
  {
    kind: "fan-headers",
    titles: [/\bfan (and pump )?(headers?|connectors?)\b/, /\bcooling fan connectors?\b/, /\bfan and pump\b/],
    labels: /\b(CPU_FAN\d?|CPU_OPT\d?|PUMP_FAN\d?|AIO_PUMP|W_PUMP\+?|SYS_FAN\d*|CHA_FAN\d*|M\.?2_FAN|FAN\d)(?![\w])/gi,
    alone: 3,
  },
  {
    kind: "front-panel",
    titles: [/\b(front|system) panel (headers?|connectors?|pins?|pinout)\b/, /^front panel( i\/o)?$/, /\bf_panel\b.*\bheader\b/, /\bpanel header\b/],
    labels: /\b(F_PANEL\d?|JFP\d|PANEL\d|PWR_LED[+-]?|HDD_LED[+-]?|PLED[+-]?|HD_LED[+-]?|HDLED[+-]?|POWER ?SW|RESET ?SW|PWR_?BTN|RESET_?BTN|PWRSW|RESETSW|SPEAKER|Power LED|HDD LED)(?![\w])/gi,
    alone: 3,
  },
  {
    kind: "memory-slots",
    titles: [/\bmemory (slots?|slot order|configuration|installation|layout|population)\b/, /\brecommended memory\b/, /\binstall(ing)? (the )?memory\b/, /\bdimm (installation|slots?|configuration)\b/],
    labels: /\b(DIMM_?[AB][12]|DDR[45]_?[AB][12]|[AB][12])(?![\w])/g,
    alone: 4,
    withTitle: 1,
  },
  {
    kind: "m2-slots",
    titles: [/\bm\.?2 (slots?|ssd|installation|drives?|connectors?|sockets?)\b/, /\binstall(ing)? (an |the |a )?(m\.?2|ssd)\b/, /\b(replac(e|ing)|remov(e|ing)) the ssd\b/, /\bssd slot\b/],
    labels: /\b(M\.?2_\d|M2[A-D]?_(CPU|SB|\d)|M\.2 22\d0|M2_SLOT\d?|M\.2 slot \d)(?![\w])/gi,
    alone: 3,
    withTitle: 1,
  },
  {
    kind: "rear-io",
    titles: [/\brear (i\/o|panel|ports)\b/, /\bback (panel|i\/o)\b/, /\bi\/o (panel|shield|ports)\b/],
    labels: /\b(LAN|HDMI|DisplayPort|BIOS FLASHBACK|Flash BIOS|CLR_CMOS|Clear CMOS|Wi-?Fi antenna|S\/PDIF|Line[- ]?in|Line[- ]?out|Mic[- ]?in|USB Type-C|PS\/2|USB \d(\.\d)?( Gen \dx?\d?)?)(?![\w])/gi,
    alone: 5,
    withTitle: 2,
  },
  {
    kind: "power-connectors",
    titles: [/\b(atx |cpu |pcie? )?power (connectors?|headers?|cables?)\b/, /\bpower supply connectors?\b/, /\bmodular cables?\b/],
    labels: /\b(EATX12V\d?|EATX_?PWR|ATX_?PWR\d?|ATX_?12V(_\d)?|CPU_PWR\d?|PCIE_PWR\d?|12VHPWR|12V-2x6|24-pin|8-pin|4\+4-pin|6\+2-pin|EPS)(?![\w])/gi,
    alone: 3,
  },
  {
    kind: "rgb-headers",
    titles: [/\b(a?rgb|led|lighting) (headers?|connectors?)\b/, /\baddressable (rgb|led)\b/, /\brgb lighting\b/],
    labels: /\b(JRGB\d?|JARGB(_V2)?(_\d)?|JRAINBOW\d?|ARGB(_HEADER)?(_\d)?|RGB_HEADER\d?|ADD_GEN2|AURA_RGB|D_LED\d?|LED_C\d?|5V ARGB|12V RGB)(?![\w])/gi,
    alone: 3,
  },
  {
    kind: "usb-headers",
    titles: [/\busb (\d(\.\d)? )?(gen \d(x\d)? )?(type-c )?(headers?|connectors? \(internal\))\b/, /\binternal usb\b/],
    labels: /\b(JUSB\d|USB3_\d+|U32G\d_\w+|F_USB\d*(_\d)?|F_U32\w*|USB_?C\d?|USB\d{2,4}|JC\d|Type-C header|USB 2\.0 header|USB 3\.2 Gen [12](x2)? header)(?![\w])/gi,
    alone: 3,
  },
  {
    kind: "dimensions",
    titles: [/\b(dimensions|product size|measurements)\b/],
    labels: /\b\d+(\.\d+)? ?mm\b/gi,
    withTitle: 2,
  },
  {
    kind: "installation",
    titles: [
      /\binstall(ing)? (the |a |an )?(cpu|processor|cpu cooler|cooler|motherboard|graphics card|power supply|fans?|radiator)\b/,
      /\b(cpu|processor|motherboard|cooler|fan|radiator|hardware) installation\b/,
      /\b(remov(e|ing)|open(ing)?) the bottom (cover|case)\b/, /\breplac(e|ing) the battery\b/, /\bdisassembly\b/,
    ],
  },
  {
    kind: "specs",
    titles: [/\b(specifications?|spec sheet|technical data)\b/],
    labels: /\b(Chipset|Form Factor|Expansion Slots?|Storage|LAN|Wireless|Audio|BIOS|Memory|CPU|Processor|Graphics|Rear Panel|Internal Connectors|Operating System|Weight|Dimensions|Battery|Display|Ports)(?![\w])/gi,
    withTitle: 3,
  },
];

// The board layout shows headers of many kinds on one drawing.
const layoutTitles = [/\b(motherboard|board|mainboard|component|components) (layout|overview|locations?)\b/, /^layout$/, /\binside (view|the laptop)\b/, /\binternal (layout|view)\b/];
const layoutKinds: DiagramKind[] = ["fan-headers", "front-panel", "memory-slots", "m2-slots", "power-connectors", "rgb-headers", "usb-headers"];

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

interface Heads { top: string[]; all: string[]; start: string }

const lead = /^(\d+(\.\d+)*\.?|\d+-\d+|step \d+:?|chapter \d+:?)\s+/i;

/**
 * Where a heading can be: short lines near the top of the page, any short
 * line that is mostly the heading itself ("USB headers" further down), and the
 * very start of the page, for PDFs that run their text together.
 */
function headings(text: string): Heads {
  // "SYS_FAN1~5: Fan Connectors" and "F_PANEL (Front Panel Header)" put the heading after the header names.
  const lines = text.split(/\n+/).map((l) => l.trim().replace(lead, "")).flatMap((l) => {
    const after = /^[^:]{1,40}:\s*(.+)$/.exec(l)?.[1];
    const inside = /^\S+\s*\(([^)]+)\)$/.exec(l)?.[1];
    return [l, ...(after ? [after] : []), ...(inside ? [inside] : [])];
  });
  const short = (l: string) => !!l && words(l) <= 8 && !/[a-z]{3,}[.!?]$/.test(l);
  return { top: lines.slice(0, 7).filter(short), all: lines.filter(short), start: text.trim().slice(0, 60).replace(lead, "") };
}

/** A contents page lists every heading with its page number; it isn't a diagram. */
const isContents = (text: string) => /^(table of )?contents$/im.test(text) || (text.match(/^.{3,60}?[ .]{1,}\d{1,3}$/gm)?.length ?? 0) >= 6;

/** How much of the page is labels rather than sentences, 0 to 1. */
function labelShare(text: string): number {
  const total = words(text);
  if (!total) return 0;
  const sentences = text.match(/[a-z]{3,}[.!?](\s|$)/g)?.length ?? 0;
  return Math.max(0, 1 - (sentences * 12) / total);
}

const distinct = (text: string, re?: RegExp) => (re ? new Set([...text.matchAll(re)].map((m) => m[0].toUpperCase().replace(/\s+/g, " "))).size : 0);
/** The heading line that names this kind of diagram, if the page has one. */
function titleOf(h: Heads, titles: RegExp[]): string | null {
  for (const t of titles) {
    // Near the top, the heading starts the line (give or take two words like "Connecting the").
    const top = h.top.find((l) => { const m = t.exec(l.toLowerCase()); return !!m && l.slice(0, m.index).split(/\s+/).filter(Boolean).length <= 2; });
    if (top) return top;
    if (t.exec(h.start.toLowerCase())?.index === 0) return h.start.split("\n")[0];
    const any = h.all.find((l) => { const m = t.exec(l.toLowerCase()); return !!m && m[0].length >= l.replace(/\s*\(.*\)$/, "").length * 0.6; });
    if (any) return any;
  }
  return null;
}

/** "INSTALLING THE CPU (AM5)" reads as "Installing the CPU". */
const asLabel = (line: string) => {
  const s = line.replace(/\s*\(.*\)\s*$/, "").trim().slice(0, 40);
  return s === s.toUpperCase() ? s[0] + s.slice(1).toLowerCase().replace(/\b(cpu|ssd|usb|rgb|argb|m\.2|i\/o|atx|pcie)\b/g, (w) => w.toUpperCase()) : s[0].toUpperCase() + s.slice(1);
};

interface Found { kind: DiagramKind; page: number; score: number; titled: boolean; label: string }

/** The pages with useful diagrams: the best page for each kind (two when they're about as good), in page order. */
export function findDiagrams(pages: ManualPage[]): ManualDiagram[] {
  const found: Found[] = [];
  for (const p of pages) {
    const text = p.text ?? "";
    if (!text.trim() || isContents(text)) continue;
    const heads = headings(text);
    const share = labelShare(text);
    const weight = 0.4 + 0.6 * share;

    const labelCount: Partial<Record<DiagramKind, number>> = {};
    for (const r of rules) {
      const n = Math.min(distinct(text, r.labels), 8);
      labelCount[r.kind] = n;
      const head = titleOf(heads, r.titles);
      const t = !!head;
      const ok = t ? n >= (r.withTitle ?? 0) : r.alone != null && n >= r.alone && share >= 0.5;
      if (ok) found.push({ kind: r.kind, page: p.n, score: (t ? 4 : 0) + n * weight, titled: t, label: r.kind === "installation" && head ? asLabel(head) : diagramLabels[r.kind] });
    }

    const cats = layoutKinds.filter((k) => (labelCount[k] ?? 0) > 0).length;
    const t = !!titleOf(heads, layoutTitles);
    if ((t && cats >= 2) || (cats >= 5 && share >= 0.5)) {
      const inside = /inside|internal/i.test(heads.top.join(" "));
      found.push({ kind: "board-layout", page: p.n, score: (t ? 4 : 0) + cats * weight, titled: t, label: inside ? "Inside view" : diagramLabels["board-layout"] });
    }
  }

  const layoutPages = new Set(found.filter((f) => f.kind === "board-layout").map((f) => f.page));
  const out: ManualDiagram[] = [];
  const kinds = [...new Set(found.map((f) => f.kind))];
  for (const kind of kinds) {
    // A header that only shows on the board layout is already covered by the layout's own entry.
    const list = found.filter((f) => f.kind === kind && (kind === "board-layout" || f.titled || !layoutPages.has(f.page)))
      .sort((a, b) => b.score - a.score || a.page - b.page);
    const [best, next] = list;
    if (!best) continue;
    out.push({ page: best.page, kind, label: best.label });
    if (next && next.score >= best.score * 0.85 && next.titled === best.titled) out.push({ page: next.page, kind, label: next.label });
  }
  return out.sort((a, b) => a.page - b.page || a.kind.localeCompare(b.kind));
}
