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
