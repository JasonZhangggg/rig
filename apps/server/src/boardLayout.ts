// Reads a motherboard manual's layout drawing once per board model, so the
// board view can show where each header is. The app renders the drawing's
// page (it already has the PDF and pdf.js); Claude places each part on that
// picture in pixels, which it does far more precisely than guessing
// millimetres; @rig/core scales them to the board.
//
// Tuned on four makers' drawings (MSI, ASUS, Gigabyte, ASRock) against
// positions traced by hand: Opus about 1.4 mm off on average, Sonnet about
// 2.2 mm with a missed header now and then, Haiku about 5 mm with misses. A
// grid drawn over the picture didn't help Opus. Writing each part as a short
// array, not an object, halves what the reader writes without losing accuracy.

import Anthropic from "@anthropic-ai/sdk";
import { readingProblem, readerKinds, type LayoutReading, type ReadItem } from "@rig/core";
import { MODEL, type Streamer } from "./chat";

export const LAYOUT_MODEL = MODEL;
/** A read that started this long ago and never finished is tried again. */
export const LAYOUT_STALE_MS = 3 * 60_000;
/** A failed read is tried again after this long, like a manual Rig couldn't find. */
export const LAYOUT_RETRY_MS = 7 * 864e5;

const READER = `You read motherboard layout drawings for Rig, a PC helper app. The picture is a page of the board's manual with a drawing of the whole board seen from above, rear I/O edge on the left.

Report the board's outline and each component's rectangle in the picture's pixel coordinates (x right, y down). Answer with compact JSON only, no spaces or line breaks, each item as [label, kind, x0, y0, x1, y1], like {"form":"atx","board":[0,0,0,0],"items":[["CPU_FAN1","fan",0,0,0,0]]}.

form: the board's size if the page says it (atx, matx, itx, eatx), else "".
Kinds: socket, dimm, pcie, m2, atx24, eps (CPU 8-pin or 4-pin power), fan (any fan or pump header), usb3 (19/20-pin USB 3 header), usbc (front Type-C header), usb2 (9-pin USB 2 header), fp (front/system panel header), audio (front audio header), rgb (RGB or ARGB header), sata, tpm, jumper, battery, chip, rear-io, other.
Rules:
- Label = the component's name exactly as printed (e.g. CPU_FAN1, PCI_E1, F_PANEL). Where the drawing uses numbered callouts, use the name the page text gives for that number. For the processor socket use label "SOCKET". For memory, one item per slot (e.g. DIMMA1).
- Include every connector, header, slot and socket you can see, not only the labeled-with-a-line ones. Skip rear I/O ports, mounting holes and text.
- A rectangle covers the component's drawn outline (a slot including its latch).
- If the page has no drawing of a whole board, answer {"form":"","board":[0,0,0,0],"items":[]}.`;

export interface LayoutRead {
  reading: LayoutReading | null;
  problem?: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

/** The first {...} in the answer, read as a layout and cleaned to the shape Rig expects. */
export function parseReading(text: string): LayoutReading | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let o: unknown;
  try { o = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const r = o as { form?: unknown; board?: unknown; items?: unknown };
  if (!Array.isArray(r.board) || !Array.isArray(r.items)) return null;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN);
  const items: ReadItem[] = [];
  for (const it of r.items.slice(0, 120)) {
    if (!Array.isArray(it) || it.length < 6 || typeof it[0] !== "string") continue;
    const box = it.slice(2, 6).map(num);
    if (box.some(Number.isNaN)) continue;
    const kind = typeof it[1] === "string" && (readerKinds as readonly string[]).includes(it[1]) ? it[1] : "other";
    items.push([it[0].trim().slice(0, 40), kind, box[0], box[1], box[2], box[3]]);
  }
  const board = r.board.slice(0, 4).map(num) as LayoutReading["board"];
  return { form: typeof r.form === "string" ? r.form.slice(0, 8) : "", board, items };
}

/**
 * One look at the drawing. Throws only when the API itself fails, so an
 * outage isn't saved as a failed read for a week.
 */
export async function readBoardLayout(client: Streamer, page: { image: string; mediaType: "image/png" | "image/jpeg"; width: number; height: number; text?: string }, board: { maker: string; model: string }, signal?: AbortSignal): Promise<LayoutRead> {
  const t0 = Date.now();
  const stream = client.beta.messages.stream({
    model: LAYOUT_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low" },
    system: READER,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: page.mediaType, data: page.image } },
        { type: "text", text: `Board: ${board.maker} ${board.model}\nThe picture is ${page.width} by ${page.height} pixels.${page.text ? `\nText on this page and the next (it may name numbered callouts):\n${page.text}` : ""}` },
      ],
    }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  }, { signal });
  for await (const _ of stream) { /* wait for the whole answer */ }
  let msg: Anthropic.Beta.BetaMessage;
  try { msg = await stream.finalMessage(); } catch (e) {
    if (e instanceof Anthropic.APIError) throw e;
    return { reading: null, problem: "the answer was cut off", inputTokens: 0, outputTokens: 0, ms: Date.now() - t0 };
  }
  const usage = (msg as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  const cost = { inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, ms: Date.now() - t0 };
  if (msg.stop_reason === "refusal") return { reading: null, problem: "declined", ...cost };
  const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
  const reading = parseReading(text);
  const problem = reading ? readingProblem(reading) : "no layout in the answer";
  return problem ? { reading: null, problem, ...cost } : { reading, ...cost };
}
