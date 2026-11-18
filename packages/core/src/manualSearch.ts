// Searches saved manual pages on the device: the demo and the desktop app
// while signed out use this; signed in, the server searches. Matches header
// names however they're typed ("F_PANEL", "f panel", "fpanel"), any case, and
// plurals roughly.

import type { Manual, ManualHit, ManualPage } from "./manuals";

const STOP = new Set("a an and are at be by can do does for from go goes how i in is it my need of on or put should the to what where which with why you your".split(" "));
const SNIPPET = 200;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** One word as a pattern: plural endings optional, and "fan1" matches "fan 1" and "fan_1". */
function wordPattern(w: string): string {
  const stem = w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w.length > 4 && /(ch|sh|x)es$/.test(w) ? w.slice(0, -2) : w;
  const parts = stem.match(/[\p{L}]+|\d+/gu) ?? [escape(stem)];
  return parts.map(escape).join("[\\s_\\-.]?") + (/[a-z]$/.test(stem) ? "(?:e?s)?" : "");
}

const bounded = (src: string) => `(?<![a-z0-9])${src}(?![a-z0-9])`;

export interface SearchDoc { manual: Pick<Manual, "id" | "title" | "part">; pages: ManualPage[] }

/** Best matches first, at most `limit` (default 20). Matched words in the snippet are wrapped in « and ». */
export function searchPages(docs: SearchDoc[], query: string, opts: { manualId?: string; limit?: number } = {}): ManualHit[] {
  const q = query.toLowerCase().replace(/[_\-/]+/g, " ").replace(/[^\p{L}\p{N}.\s]+/gu, " ").replace(/\.(?!\d)/g, " ").trim();
  if (!q) return [];
  const all = q.split(/\s+/);
  const kept = all.filter((w) => !STOP.has(w));
  const terms = [...new Set(kept.length ? kept : all)].filter((w) => w.length > 1 || /\d/.test(w));
  // Words typed together also match run together: "f panel" finds "F_PANEL" and "FPANEL".
  const phrase = all.length > 1 ? new RegExp(bounded(all.map(wordPattern).join("[\\s_\\-.]*")), "giu") : null;
  const res = terms.map((w) => new RegExp(bounded(wordPattern(w)), "giu"));
  if (!res.length && !phrase) return [];

  const hits: (ManualHit & { score: number; order: number })[] = [];
  docs.forEach((d, order) => {
    if (opts.manualId && d.manual.id !== opts.manualId) return;
    for (const p of d.pages) {
      const text = p.text ?? "";
      const lower = text.toLowerCase();
      const phraseN = phrase ? count(lower, phrase) : 0;
      const per = res.map((re) => count(lower, re));
      const matched = per.filter((n) => n > 0).length;
      // Every word on the page, or the whole phrase, or most of a long question.
      if (!phraseN && matched < Math.max(1, Math.ceil(res.length * 0.6))) continue;
      // A match in the page's heading counts for more: that page is about it.
      const head = text.split("\n").slice(0, 3).filter((l) => l.split(/\s+/).length <= 12).join("\n").toLowerCase();
      const inHead = (phrase && count(head, phrase)) || res.some((re) => count(head, re) > 0) ? 20 : 0;
      const score = phraseN * 12 + matched * 6 + per.reduce((s, n) => s + Math.min(n, 5), 0) + (matched === res.length ? 8 : 0) + inHead;
      hits.push({ manualId: d.manual.id, title: d.manual.title, part: d.manual.part, page: p.n, snippet: snippet(text, phrase, res), score, order });
    }
  });
  return hits.sort((a, b) => b.score - a.score || a.order - b.order || a.page - b.page)
    .slice(0, opts.limit ?? 20)
    .map(({ score: _s, order: _o, ...h }) => h);
}

function count(text: string, re: RegExp): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text)) n++;
  return n;
}

/** About 200 characters around the first match, with every match marked. */
function snippet(text: string, phrase: RegExp | null, res: RegExp[]): string {
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const starts: number[] = [];
  let flat = "";
  for (const l of lines) { starts.push(flat ? flat.length + 1 : 0); flat = flat ? `${flat} ${l}` : l; }
  const lower = flat.toLowerCase();
  let at = 0;
  for (const re of phrase ? [phrase, ...res] : res) {
    re.lastIndex = 0;
    const m = re.exec(lower);
    if (m) { at = m.index; break; }
  }
  // Start at the beginning of the match's line when it's close, otherwise a little before the match.
  const lineStart = [...starts].reverse().find((s) => s <= at && at - s <= 70);
  let from = lineStart ?? Math.max(0, at - 60);
  if (lineStart == null && from > 0) { const sp = flat.indexOf(" ", from); if (sp > 0 && sp < at) from = sp + 1; }
  let to = Math.min(flat.length, from + SNIPPET);
  if (to < flat.length) { const sp = flat.lastIndexOf(" ", to); if (sp > at) to = sp; }
  const piece = flat.slice(from, to);
  // When the words are on the page together, mark only that, not every stray "panel".
  const marks = phrase && count(lower, phrase) ? [phrase] : res;
  const any = new RegExp(marks.map((r) => `(?:${r.source})`).join("|"), "giu");
  return `${from > 0 ? "…" : ""}${piece.replace(any, (m) => `«${m}»`)}${to < flat.length ? "…" : ""}`;
}

/** Splits a snippet into plain and matched pieces, for drawing the matches. */
export function snippetParts(s: string): { text: string; match: boolean }[] {
  return s.split(/(«[^»]*»)/).filter(Boolean).map((t) => (t.startsWith("«") ? { text: t.slice(1, -1), match: true } : { text: t, match: false }));
}
