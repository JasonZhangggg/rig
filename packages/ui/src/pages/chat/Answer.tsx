import type { ReactNode } from "react";

/**
 * Rig's answers are written in a little Markdown: paragraphs split by a blank line, "- " or "1. " lists,
 * **bold** labels, *emphasis* and `code`. This draws that much as real paragraphs and lists, and shows
 * anything else as the words it is. It works on a half-streamed answer too: a list item shows as soon as
 * its line starts, and bold that hasn't closed yet runs to the end of what has arrived.
 */
export type Block =
  | { kind: "p"; text: string; heading?: boolean }
  | { kind: "ul" | "ol"; items: string[]; start?: number };

const bullet = /^\s*[-*•+]\s+(.*)$/;
const numbered = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const heading = /^\s*#{1,6}\s+(.*)$/;

export function answerBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { kind: "ul" | "ol" }> | null = null;
  let gap = false;
  const endPara = () => { if (para.length) blocks.push({ kind: "p", text: para.join(" ") }); para = []; };
  const endList = () => { if (list) blocks.push(list); list = null; };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { endPara(); gap = true; continue; }
    const b = bullet.exec(raw);
    const n = b ? null : numbered.exec(raw);
    if (b || n) {
      const kind = b ? "ul" : "ol";
      const item = (b ? b[1] : n![2]).trim();
      endPara();
      // A blank line between items of the same kind keeps one list; anything else starts a new one.
      if (!list || list.kind !== kind) {
        endList();
        list = kind === "ol" ? { kind, items: [], start: Number(n![1]) } : { kind, items: [] };
      }
      list.items.push(item);
    } else if (heading.test(raw)) {
      endPara(); endList();
      blocks.push({ kind: "p", text: heading.exec(raw)![1].trim(), heading: true });
    } else if (list && !gap) {
      // A line right under an item, with no blank line between, carries that item on.
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      endList();
      para.push(line);
    }
    gap = false;
  }
  endPara(); endList();
  return blocks;
}

/** **bold**, *emphasis* and `code` inside a line; every other character is shown as it is. */
export function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  const flush = () => { if (buf) out.push(buf); buf = ""; };
  let i = 0;
  while (i < s.length) {
    if (s[i] === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i + 1) { flush(); out.push(<code key={out.length}>{s.slice(i + 1, j)}</code>); i = j + 1; continue; }
    }
    if (s.startsWith("**", i)) {
      const j = s.indexOf("**", i + 2);
      const inner = j < 0 ? s.slice(i + 2) : s.slice(i + 2, j);
      if (inner.trim()) { flush(); out.push(<strong key={out.length}>{inline(inner)}</strong>); i = j < 0 ? s.length : j + 2; continue; }
      // "**" with nothing after it yet (still streaming) or nothing inside: drop the marks.
      if (j < 0 || j === i + 2) { i = j < 0 ? s.length : j + 2; continue; }
    }
    if (s[i] === "*" && s[i + 1] && /\S/.test(s[i + 1]) && s[i + 1] !== "*" && !/\w/.test(s[i - 1] ?? "")) {
      const j = s.indexOf("*", i + 1);
      if (j > i + 1 && /\S/.test(s[j - 1]) && s[j + 1] !== "*" && !/\w/.test(s[j + 1] ?? "")) {
        flush(); out.push(<em key={out.length}>{inline(s.slice(i + 1, j))}</em>); i = j + 1; continue;
      }
    }
    buf += s[i];
    i++;
  }
  flush();
  return out;
}

/** An answer from Rig, drawn as paragraphs and lists. */
export function Answer({ text }: { text: string }) {
  return (
    <>
      {answerBlocks(text).map((b, i) => {
        if (b.kind === "p") return <p key={i} className={b.heading ? "answer-head" : undefined}>{inline(b.text)}</p>;
        const items = b.items.map((it, k) => <li key={k}>{inline(it)}</li>);
        return b.kind === "ul"
          ? <ul key={i} className="answer-list">{items}</ul>
          : <ol key={i} className="answer-list" start={b.start && b.start !== 1 ? b.start : undefined}>{items}</ol>;
      })}
    </>
  );
}
