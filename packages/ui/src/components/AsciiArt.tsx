import { useEffect, useRef } from "react";

/**
 * A picture made of text characters, as one canvas that fills its box's width.
 * Each row has a matching row of colour keys: a space draws nothing, any other
 * character picks an entry in the palette. A palette entry that is a number is the
 * page's text colour at that opacity, so "ink" art follows the app's colours.
 */
export type AsciiArtData = { cols: number; rows: string[]; colors: string[]; palette: (string | number)[] };

// Keys run from "!" to "~", skipping the backslash and the double quote, which JSON escapes.
const KEYS = Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i)).filter((c) => c !== "\\" && c !== '"');
const KEY_INDEX = new Map(KEYS.map((k, i) => [k, i]));

const FONT = "Rig Art Mono";
// DejaVu Sans Mono, cut down to the characters the art uses. Its advance is 0.602em.
const ADVANCE = 0.602;
const LINE = 1.09;
let fontReady: Promise<unknown> | undefined;
function loadFont() {
  if (fontReady) return fontReady;
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return (fontReady = Promise.resolve());
  const face = new FontFace(FONT, `url(${new URL("../assets/rig-mono.woff2", import.meta.url).href}) format("woff2")`);
  document.fonts.add(face);
  return (fontReady = face.load().catch(() => undefined));
}

/** Draws the art into a canvas the width of the box. */
export function paintArt(canvas: HTMLCanvasElement, art: AsciiArtData, width: number, ink: string, dpr: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx || width <= 0) return;
  const cell = width / art.cols, size = cell / ADVANCE, line = size * LINE;
  const height = Math.ceil(art.rows.length * line);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `${size}px "${FONT}", monospace`;
  ctx.textBaseline = "top";
  ctx.lineWidth = size * 0.08;
  art.rows.forEach((row, y) => {
    const keys = art.colors[y] ?? "";
    for (let i = 0; i < row.length;) {
      const key = keys[i] ?? " ";
      let j = i + 1;
      while (j < row.length && (keys[j] ?? " ") === key) j++;
      const p = key === " " ? undefined : art.palette[KEY_INDEX.get(key) ?? -1];
      if (p !== undefined) {
        const text = row.slice(i, j), x = i * cell, top = y * line;
        if (typeof p === "number") {
          // Ink art is thin dark strokes on paper, so each character gets a hairline outline to hold its tone.
          ctx.globalAlpha = p; ctx.fillStyle = ink; ctx.strokeStyle = ink;
          ctx.fillText(text, x, top);
          ctx.strokeText(text, x, top);
        } else {
          ctx.globalAlpha = 1; ctx.fillStyle = p;
          ctx.fillText(text, x, top);
        }
      }
      i = j;
    }
  });
  ctx.globalAlpha = 1;
}

export function AsciiArt({ art, className }: { art: AsciiArtData; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = box.current, cv = canvas.current;
    if (!el || !cv || typeof window === "undefined") return;
    let live = true, drawn = "";
    const draw = () => {
      if (!live) return;
      const width = el.clientWidth, ink = getComputedStyle(el).color, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const key = `${width}|${ink}|${dpr}`;
      if (!width || key === drawn) return;
      drawn = key;
      paintArt(cv, art, width, ink, dpr);
    };
    void loadFont().then(draw);
    const sized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(draw);
    sized?.observe(el);
    // The app sets its colours as styles on the root, so ink art redraws when they change.
    const themed = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(draw);
    themed?.observe(document.documentElement, { attributes: true });
    return () => { live = false; sized?.disconnect(); themed?.disconnect(); };
  }, [art]);
  return (
    <div ref={box} className={className ? `ascii-art ${className}` : "ascii-art"} aria-hidden="true">
      <canvas ref={canvas} style={{ display: "block" }} />
    </div>
  );
}
