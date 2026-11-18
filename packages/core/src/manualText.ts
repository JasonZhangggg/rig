// Turns the text pieces a PDF reader gives for one page into the page's text,
// line by line in reading order, and keeps it within Rig's limits.

import { MANUAL_MAX_PAGES, MANUAL_PAGE_CHARS, type ManualPage } from "./manuals";

/** One piece of text as pdf.js reports it: its string, where it starts and whether a line ends after it. */
export interface TextPiece { str: string; x: number; y: number; height?: number; hasEOL?: boolean }

/** Joins a page's pieces in the order they were drawn: a new line where the baseline moves, a space between words on a line. */
export function joinTextItems(items: TextPiece[]): string {
  let out = "";
  let prev: TextPiece | null = null;
  let broke = true;
  for (const it of items) {
    if (prev && !broke) {
      const tol = Math.max(2, (it.height || prev.height || 10) * 0.4);
      if (Math.abs(it.y - prev.y) > tol) out += "\n";
      else if (it.str && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
    }
    out += it.str;
    broke = !!it.hasEOL;
    if (broke) out += "\n";
    if (it.str || it.hasEOL) prev = it;
  }
  return out.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** Keeps at most MANUAL_MAX_PAGES pages and MANUAL_PAGE_CHARS characters on each. */
export function clampPages(pages: ManualPage[]): ManualPage[] {
  return pages.slice(0, MANUAL_MAX_PAGES).map((p) => ({ n: p.n, text: p.text.length > MANUAL_PAGE_CHARS ? p.text.slice(0, MANUAL_PAGE_CHARS) : p.text }));
}
