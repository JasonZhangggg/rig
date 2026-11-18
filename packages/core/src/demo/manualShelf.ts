// The demo's manuals, kept in memory per PC. Atlas starts with its board
// manual found and read; Pebble starts with none, so finding one can be tried.

import type { ChatEvent, Source } from "../client";
import { diagramLabels, findDiagrams } from "../diagrams";
import { searchPages } from "../manualSearch";
import { manualLink, type DiagramKind, type Manual, type ManualDiagram, type ManualHit, type ManualPage, type ManualTarget } from "../manuals";
import { render, sampleBoardManual, sampleLaptopGuide, type SampleManual } from "./manuals";

interface Shelf { list: Manual[]; pages: Map<string, ManualPage[]> }
interface Sample { bytes: Uint8Array; pages: ManualPage[]; title: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Which made-up manual the demo "finds" for a part. Anything else isn't found, so that path can be tried too. */
function sampleFor(t: ManualTarget): (() => SampleManual) | null {
  if (t.kind === "motherboard" && /b650\s*tomahawk/i.test(t.model)) return () => sampleBoardManual(t.maker || "MSI", t.model);
  if (t.kind === "laptop" && /ux3405|zenbook\s*14/i.test(t.model)) return () => sampleLaptopGuide(t.maker || "ASUS", t.model);
  return null;
}

export class DemoManuals {
  private shelves = new Map<string, Shelf>();
  private samples = new Map<string, Sample>();
  private seq = 0;
  /** How long "looking on the maker's site" takes. */
  delay = 1200;

  /** Puts a manual on a PC's shelf, already read, the way the app leaves it after reading. */
  seed(pcId: string, target: ManualTarget) {
    const make = sampleFor(target);
    if (!make) return;
    const m = this.found(pcId, target, make);
    const s = this.samples.get(m.id)!;
    Object.assign(m, { pageCount: s.pages.length, indexed: true, diagrams: findDiagrams(s.pages), addedAt: new Date(Date.now() - 6 * 864e5).toISOString() });
    this.shelf(pcId).pages.set(m.id, s.pages);
  }

  private shelf(pcId: string): Shelf {
    let s = this.shelves.get(pcId);
    if (!s) this.shelves.set(pcId, (s = { list: [], pages: new Map() }));
    return s;
  }

  private found(pcId: string, t: ManualTarget, make: () => SampleManual): Manual {
    const sample = make();
    const { bytes, pages } = render(sample);
    const id = `demo-manual-${++this.seq}`;
    this.samples.set(id, { bytes, pages, title: sample.title });
    const m: Manual = {
      id, machineId: pcId, part: t.part, kind: t.kind, maker: t.maker, model: t.model, title: sample.title,
      host: "Sample made by Rig", source: "found", indexed: false, diagrams: [], addedAt: new Date().toISOString(), bytes: bytes.length,
    };
    this.shelf(pcId).list.unshift(m);
    return m;
  }

  async list(pcId: string): Promise<Manual[]> { return structuredClone(this.shelf(pcId).list); }

  async find(pcId: string, t: ManualTarget): Promise<Manual | null> {
    await sleep(this.delay);
    const make = sampleFor(t);
    return make ? structuredClone(this.found(pcId, t, make)) : null;
  }

  async add(pcId: string, t: ManualTarget, file: { name: string; bytes: number }): Promise<Manual> {
    const m: Manual = {
      id: `demo-manual-${++this.seq}`, machineId: pcId, part: t.part, kind: t.kind, maker: t.maker, model: t.model,
      title: file.name.replace(/\.pdf$/i, "") || `${t.maker} ${t.model}`.trim(), source: "added", indexed: false, diagrams: [], addedAt: new Date().toISOString(), bytes: file.bytes,
    };
    this.shelf(pcId).list.unshift(m);
    return structuredClone(m);
  }

  async file(pcId: string, id: string): Promise<ArrayBuffer> {
    const m = this.get(pcId, id);
    if (m.source === "added") throw new Error("This PDF was added from a file, so only the device it was added on has it.");
    const bytes = this.samples.get(id)!.bytes;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async save(pcId: string, id: string, pages: ManualPage[], diagrams: ManualDiagram[]): Promise<Manual> {
    const m = this.get(pcId, id);
    this.shelf(pcId).pages.set(id, structuredClone(pages));
    Object.assign(m, { pageCount: Math.max(m.pageCount ?? 0, pages.length), indexed: true, diagrams: structuredClone(diagrams) });
    return structuredClone(m);
  }

  async search(pcId: string, q: string, opts?: { manualId?: string; limit?: number }): Promise<ManualHit[]> {
    const s = this.shelf(pcId);
    return searchPages(s.list.map((manual) => ({ manual, pages: s.pages.get(manual.id) ?? [] })), q, opts);
  }

  async page(pcId: string, id: string, n: number): Promise<ManualPage | null> {
    return structuredClone(this.shelf(pcId).pages.get(id)?.find((p) => p.n === n) ?? null);
  }

  async remove(pcId: string, id: string) {
    const s = this.shelf(pcId);
    s.list = s.list.filter((m) => m.id !== id);
    s.pages.delete(id);
  }

  private get(pcId: string, id: string): Manual {
    const m = this.shelf(pcId).list.find((x) => x.id === id);
    if (!m) throw new Error("That manual isn't on this PC any more.");
    return m;
  }

  /** The question is about something a manual shows: a header, a fan connector, the front panel, memory slots, M.2 or the manual itself. */
  static asksManual(q: string) {
    return /header|front panel|f_panel|power (button|switch) (wire|cable)|memory slot|ram slot|dimm|which slot|m\.2|\bm2\b|nvme slot|manual|pinout|(plug|connect)\w* .*\bfans?\b|\bfans? (header|connector|cable|plug)|bottom cover|battery connector|ssd slot|page \d+/i.test(q);
  }

  /** Answers from the PC's manual, quoting the page. */
  async answer(pcId: string, pcName: string, q: string, say: (t: string) => Promise<void>, onEvent: (e: ChatEvent) => void) {
    const s = this.shelf(pcId);
    const m = s.list.find((x) => x.indexed && (x.kind === "motherboard" || x.kind === "laptop"));
    if (!m) {
      await say(`There's no manual for ${pcName} yet. Open Manuals and Rig looks up the maker's own guide, then reads it so I can quote the right page.`);
      return;
    }
    const at = (k: DiagramKind) => m.diagrams.find((d) => d.kind === k)?.page;
    type Topic = [RegExp, DiagramKind, (page: number) => string];
    const topic: Topic[] = m.kind === "laptop" ? [
      [/memory|ram|dimm|stick/i, "board-layout", (n) => `The memory in ${pcName} is soldered to the board, so it can't be upgraded (page ${n}). The SSD and the battery can be replaced.`],
      [/m\.2|\bm2\b|nvme|ssd/i, "m2-slots", (n) => `${pcName} has one M.2 2280 slot, at the top right under a thin shield (page ${n}). Unplug the battery connector first, undo the one screw at the end of the drive, and it springs up so you can pull it out.`],
      [/bottom cover|open/i, "installation", (n) => `Seven T5 Torx screws hold the bottom cover (page ${n}). Two of them are shorter, so keep them apart. Start prying at the hinge with a plastic pick.`],
      [/battery/i, "board-layout", (n) => `The battery sits along the front edge (page ${n}). Unplug its connector first, then undo the five screws along its edge.`],
      [/fan/i, "board-layout", (n) => `The fan is at the top left with the cover off (page ${n}). Blow the dust out in short bursts while holding the fan still.`],
    ] : [
      [/front panel|f_panel|power (button|switch)|reset/i, "front-panel", (n) => `The case's buttons and lights go on the front panel header, F_PANEL, at the bottom right edge of the board (page ${n}). Power switch on pins 6 and 8, reset on 5 and 7; neither cares which way round. The two lights have a + side: if one stays dark, turn its plug round.`],
      [/memory|ram|dimm|stick/i, "memory-slots", (n) => `With two sticks, use A2 and B2, the second and fourth slots from the processor (page ${n}). That runs them in dual channel. ${pcName} already has its two sticks there, so the other two slots are free if you add a matching pair.`],
      [/m\.2|\bm2\b|nvme|ssd/i, "m2-slots", (n) => `The board has two M.2 slots (page ${n}). M2_1, below the processor, already holds the drive Windows is on. M2_2 is free: take off its heatsink (one screw), slide the new drive in at an angle and press it down onto the latch.`],
      [/fan|pump/i, "fan-headers", (n) => `Fan headers are on page ${n}. The cooler's fan goes on CPU_FAN at the top of the board, a liquid cooler's pump on PUMP_FAN, and case fans on CHA_FAN1 (beside the memory) or CHA_FAN2 and CHA_FAN3 (bottom edge).`],
      [/rgb|argb|light/i, "rgb-headers", (n) => `Lighting goes on page ${n}: 5V addressable strips (three wires) on ARGB_1, 12V RGB (four wires) on RGB_1. A 5V strip on the 12V header gets damaged, so check the plug first.`],
      [/usb/i, "usb-headers", (n) => `The case's front USB ports plug into the headers on page ${n}: JUSB1 for USB 2.0, JUSB3 for USB 3.2, and JUSB4 for the Type-C port.`],
    ];
    const asked = Number(/\bpage (\d+)\b/i.exec(q)?.[1]);
    const askedPage = asked ? (s.pages.get(m.id) ?? []).find((p) => p.n === asked) : undefined;
    const hit = askedPage ? undefined : topic.find(([re, k]) => re.test(q) && at(k));
    let page = hit ? at(hit[1])! : at("board-layout") ?? 1;
    let text = hit ? hit[2](page) : "";
    if (askedPage) {
      page = askedPage.n;
      const d = m.diagrams.find((x) => x.page === page);
      const lines = askedPage.text.split("\n").slice(1, 4).join(" ");
      text = d
        ? `Page ${page} is the ${d.label.toLowerCase()}. ${lines.length > 30 ? `It starts: "${lines.slice(0, 220).trim()}…"` : ""} Ask me about any label on it and I'll explain what it's for.`
        : `Page ${page} reads: "${askedPage.text.replace(/\s+/g, " ").slice(0, 260).trim()}…"`;
    } else if (!hit) {
      const found = searchPages([{ manual: m, pages: s.pages.get(m.id) ?? [] }], q, { limit: 1 })[0];
      if (found) { page = found.page; text = `Page ${page} of the ${m.title} covers that: "${found.snippet.replace(/[«»]/g, "")}"`; }
      else text = `The board layout on page ${page} shows where every slot and header is. Ask about a specific one, like the front panel header or the memory slots, and I'll point you to its page.`;
    }
    await say(`${text}\n\nThis is the demo's sample manual, made up for trying Rig.`);
    const label = m.diagrams.find((d) => d.page === page)?.label ?? diagramLabels["board-layout"];
    const named = hit || m.diagrams.some((d) => d.page === page);
    const src: Source = { kind: "Manual", label: `${m.title}, p. ${page}${named ? ` (${label})` : ""}`, url: manualLink(m.id, page) };
    onEvent({ type: "sources", sources: [src] });
  }
}
