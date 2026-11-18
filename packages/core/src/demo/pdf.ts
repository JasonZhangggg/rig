// A small PDF writer for the demo's sample manuals: pages of vector drawings
// and text in the built-in Helvetica fonts, written as plain PDF 1.4 with an
// exact cross-reference table, so pdf.js reads and draws it like a real one.
// Text is ASCII only. Positions are given from the top-left, in points.

import { joinTextItems, type TextPiece } from "../manualText";

type RGB = [number, number, number];
export interface Style { fill?: RGB; stroke?: RGB; width?: number; dash?: number[] }
export interface TextStyle { size?: number; bold?: boolean; mono?: boolean; color?: RGB; align?: "left" | "center" | "right" }

export const PAGE_W = 595;
export const PAGE_H = 842;

const num = (n: number) => (Math.round(n * 100) / 100).toString();
const color = (c: RGB) => c.map(num).join(" ");
const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");

/** Rough width of Helvetica text, close enough to centre labels. */
export function textWidth(s: string, size: number, bold = false, mono = false): number {
  if (mono) return s.length * size * 0.6;
  let w = 0;
  for (const ch of s) w += /[il.,:;'|!]/.test(ch) ? 0.28 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z0-9_]/.test(ch) ? 0.67 : ch === " " ? 0.28 : 0.53;
  return w * size * (bold ? 1.06 : 1);
}

export class PdfPage {
  readonly ops: string[] = [];
  readonly pieces: TextPiece[] = [];

  private y(top: number) { return PAGE_H - top; }
  private paint(s: Style) {
    const pre: string[] = [];
    if (s.fill) pre.push(`${color(s.fill)} rg`);
    if (s.stroke) pre.push(`${color(s.stroke)} RG ${num(s.width ?? 1)} w`);
    pre.push(s.dash ? `[${s.dash.map(num).join(" ")}] 0 d` : "[] 0 d");
    return { pre: pre.join(" "), op: s.fill && s.stroke ? "B" : s.fill ? "f" : "S" };
  }

  rect(x: number, top: number, w: number, h: number, s: Style = { stroke: [0, 0, 0] }) {
    const { pre, op } = this.paint(s);
    this.ops.push(`q ${pre} ${num(x)} ${num(this.y(top + h))} ${num(w)} ${num(h)} re ${op} Q`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, s: Style = { stroke: [0, 0, 0] }) {
    const { pre } = this.paint({ ...s, fill: undefined, stroke: s.stroke ?? [0, 0, 0] });
    this.ops.push(`q ${pre} ${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S Q`);
    return this;
  }

  /** A closed shape through the points. */
  poly(points: [number, number][], s: Style) {
    const { pre, op } = this.paint(s);
    const path = points.map(([x, y], i) => `${num(x)} ${num(this.y(y))} ${i ? "l" : "m"}`).join(" ");
    this.ops.push(`q ${pre} ${path} h ${op} Q`);
    return this;
  }

  circle(cx: number, cy: number, r: number, s: Style) {
    const k = r * 0.5523;
    const y = this.y(cy);
    const { pre, op } = this.paint(s);
    this.ops.push(`q ${pre} ${num(cx + r)} ${num(y)} m ${num(cx + r)} ${num(y + k)} ${num(cx + k)} ${num(y + r)} ${num(cx)} ${num(y + r)} c `
      + `${num(cx - k)} ${num(y + r)} ${num(cx - r)} ${num(y + k)} ${num(cx - r)} ${num(y)} c ${num(cx - r)} ${num(y - k)} ${num(cx - k)} ${num(y - r)} ${num(cx)} ${num(y - r)} c `
      + `${num(cx + k)} ${num(y - r)} ${num(cx + r)} ${num(y - k)} ${num(cx + r)} ${num(y)} c h ${op} Q`);
    return this;
  }

  /** An arrow from one point to another, with its head at the end. */
  arrow(x1: number, y1: number, x2: number, y2: number, c: RGB = [0, 0, 0]) {
    this.line(x1, y1, x2, y2, { stroke: c, width: 1.2 });
    const a = Math.atan2(y2 - y1, x2 - x1), l = 7, sp = 0.45;
    this.poly([[x2, y2], [x2 - l * Math.cos(a - sp), y2 - l * Math.sin(a - sp)], [x2 - l * Math.cos(a + sp), y2 - l * Math.sin(a + sp)]], { fill: c });
    return this;
  }

  /** One line of text. `top` is the baseline. */
  text(x: number, top: number, s: string, t: TextStyle = {}) {
    const size = t.size ?? 10;
    const w = textWidth(s, size, t.bold, t.mono);
    const left = t.align === "center" ? x - w / 2 : t.align === "right" ? x - w : x;
    const font = t.mono ? "F3" : t.bold ? "F2" : "F1";
    this.ops.push(`q ${color(t.color ?? [0.1, 0.1, 0.12])} rg BT /${font} ${num(size)} Tf 1 0 0 1 ${num(left)} ${num(this.y(top))} Tm (${esc(s)}) Tj ET Q`);
    this.pieces.push({ str: s, x: left, y: this.y(top), height: size });
    return this;
  }

  /** Text wrapped to a width. Returns the baseline below the last line. */
  para(x: number, top: number, width: number, s: string, t: TextStyle & { lead?: number } = {}) {
    const size = t.size ?? 10, lead = t.lead ?? size * 1.45;
    let line = "";
    let y = top;
    for (const word of s.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, t.bold) > width) { this.text(x, y, line, t); y += lead; line = word; } else line = next;
    }
    if (line) { this.text(x, y, line, t); y += lead; }
    return y;
  }

  /** The page's text the way pdf.js reads it back. */
  textContent() { return joinTextItems(this.pieces); }
}

/** Writes the pages as one PDF file. */
export function writePdf(pages: PdfPage[], title: string): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  // 1 catalog, 2 page tree, 3-5 fonts, 6 info; pages follow.
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  add(`<< /Title (${esc(title)}) /Producer (Rig demo) >>`);
  const kids: number[] = [];
  for (const p of pages) {
    const stream = p.ops.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is one byte (Latin-1), so string offsets are byte offsets.
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
