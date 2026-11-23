// pdf.js, loaded only when a manual is read or opened, so the app's first
// screen doesn't carry it. Its worker comes from the package as a file Vite
// serves (both the website and the desktop app build with Vite).

import { clampPages, joinTextItems, MANUAL_MAX_PAGES, type ManualPage } from "@rig/core";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let lib: Promise<PdfJs> | null = null;

/** pdf.js with its worker set up. Fails plainly where it can't run (as in tests), and tries again next time. */
export function loadPdfjs(): Promise<PdfJs> {
  lib ??= (async () => {
    const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  lib.catch(() => { lib = null; });
  return lib;
}

// pdf.js hands the data to its worker and empties it, so it always gets a copy.
const load = (pdfjs: PdfJs, bytes: ArrayBuffer): PDFDocumentLoadingTask => pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });

// One open document per file, so turning pages doesn't parse the PDF again.
const docs = new WeakMap<ArrayBuffer, Promise<{ task: PDFDocumentLoadingTask; doc: PDFDocumentProxy }>>();

function open(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  let entry = docs.get(bytes);
  if (!entry) {
    entry = loadPdfjs().then(async (pdfjs) => { const task = load(pdfjs, bytes); return { task, doc: await task.promise }; });
    entry.catch(() => docs.delete(bytes));
    docs.set(bytes, entry);
  }
  return entry.then((e) => e.doc);
}

/** Closes a file opened for drawing. */
export async function closePdf(bytes: ArrayBuffer) {
  const entry = docs.get(bytes);
  docs.delete(bytes);
  await entry?.then((e) => e.task.destroy()).catch(() => {});
}

/** Reads every page's text in reading order, within Rig's limits. Calls back after each page. */
export async function readPdf(bytes: ArrayBuffer, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ pages: ManualPage[]; pageCount: number }> {
  const task = load(await loadPdfjs(), bytes);
  try {
    const doc = await task.promise;
    const total = doc.numPages;
    const last = Math.min(total, MANUAL_MAX_PAGES);
    const pages: ManualPage[] = [];
    for (let n = 1; n <= last; n++) {
      if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pieces = content.items.flatMap((it) => ("str" in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], height: it.height, hasEOL: it.hasEOL }] : []));
      pages.push({ n, text: joinTextItems(pieces) });
      page.cleanup();
      onProgress?.(n, total);
    }
    return { pages: clampPages(pages), pageCount: total };
  } finally {
    void task.destroy();
  }
}

const drawing = new WeakMap<HTMLCanvasElement, RenderTask>();

/** Draws page n to fit `width` CSS pixels, sharp on high-density screens. Returns the page count. */
export async function renderPage(bytes: ArrayBuffer, n: number, canvas: HTMLCanvasElement, width: number): Promise<{ pageCount: number; height: number }> {
  const doc = await open(bytes);
  const page = await doc.getPage(Math.min(Math.max(1, n), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const scale = width / base.width;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const view = page.getViewport({ scale: scale * ratio });
  drawing.get(canvas)?.cancel();
  canvas.width = Math.floor(view.width);
  canvas.height = Math.floor(view.height);
  canvas.style.width = `${Math.floor(view.width / ratio)}px`;
  canvas.style.height = `${Math.floor(view.height / ratio)}px`;
  const task = page.render({ canvas, viewport: view });
  drawing.set(canvas, task);
  try {
    await task.promise;
  } finally {
    if (drawing.get(canvas) === task) drawing.delete(canvas);
  }
  return { pageCount: doc.numPages, height: view.height / ratio };
}

/** True when an error is a drawing that was replaced by a newer one, not a real failure. */
export const isCancelled = (e: unknown) => e instanceof Error && e.name === "RenderingCancelledException";

/**
 * A page as a picture for the server's layout reader: drawn sharp, its white
 * margins cut off (they cost tokens and hold nothing), then scaled so the long
 * side is at most `maxSide` pixels.
 */
export async function renderForReading(bytes: ArrayBuffer, n: number, maxSide = 1568): Promise<{ image: string; mediaType: "image/png"; width: number; height: number }> {
  // Its own copy of the file, closed straight after: this runs once per board, in the background, and nothing else needs the document kept open.
  const task = load(await loadPdfjs(), bytes);
  try {
    return await drawForReading(await task.promise, n, maxSide);
  } finally {
    void task.destroy();
  }
}

async function drawForReading(doc: PDFDocumentProxy, n: number, maxSide: number) {
  const page = await doc.getPage(Math.min(Math.max(1, n), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const view = page.getViewport({ scale: (maxSide * 1.5) / Math.max(base.width, base.height) });
  const big = document.createElement("canvas");
  big.width = Math.floor(view.width);
  big.height = Math.floor(view.height);
  const ctx = big.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, big.width, big.height);
  await page.render({ canvas: big, viewport: view }).promise;
  page.cleanup();

  // The ink's bounding box, with a small margin.
  const { data, width, height } = ctx.getImageData(0, 0, big.width, big.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = width - 1; y1 = height - 1; }
  const pad = 12;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const s = Math.min(1, maxSide / Math.max(cw, ch));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cw * s));
  out.height = Math.max(1, Math.round(ch * s));
  const o = out.getContext("2d")!;
  o.imageSmoothingQuality = "high";
  o.drawImage(big, x0, y0, cw, ch, 0, 0, out.width, out.height);
  const url = out.toDataURL("image/png");
  const size = { width: out.width, height: out.height };
  // Both canvases are large; giving them no size frees their pixels now rather than whenever they're collected.
  big.width = big.height = out.width = out.height = 0;
  return { image: url.slice(url.indexOf(",") + 1), mediaType: "image/png" as const, ...size };
}
