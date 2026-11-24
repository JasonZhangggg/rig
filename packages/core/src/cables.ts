// The cable guide: which power cable goes from the power supply to which plug on the motherboard and the graphics
// card, in the order a rebuild plugs them in. The board's plugs come from its layout (BoardShape); the graphics
// card's plug from its chip. Rig can't read the power supply or the case, so where the supply sits and how the
// cables get to the board are always the usual ones, and the guide says so. Pure, so the list and the 3D board agree.

import { gpuChip, type BoardItem, type BoardShape } from "./build";

export type CableId = "eps" | "eps2" | "atx24" | "gpu";

export interface Cable {
  id: CableId;
  /** Its place in the order to plug them in, from 1. */
  step: number;
  /** What it powers, in plain words ("Processor power"). */
  title: string;
  /** The plug, as it's sold and printed on the cable ("8-pin CPU"). */
  plug: string;
  /** The board item it goes to, or null for the graphics card. */
  to: string | null;
  /** The printed name on the board ("CPU_PWR1"), when there is one. */
  code?: string;
  /** What the port on a modular supply is usually marked. */
  port: string;
  /** One line on plugging it in. */
  how: string;
  /** Whether Rig knows where this plug is on this PC, or shows where most boards and cards have it. */
  known: boolean;
  /** Fine to leave out. */
  optional?: boolean;
}

export interface CableGuide {
  cables: Cable[];
  /** Where the plugs' places come from, in a sentence. */
  from: string;
  /** Things that hold for every cable. */
  notes: string[];
}

/** What the card's power plug is, from its chip: what most cards of the chip take, never more sure than that. */
export function gpuPlug(name: string): { plug: string; words: string } {
  const chip = gpuChip(name.replace(/\((TM|R)\)/gi, ""));
  const m = chip ? /^(RTX|GTX|RX|ARC)\s+[A-Z]?(\d{3,4})(.*)$/i.exec(chip) : null;
  const of = chip ? `${chip} cards` : "graphics cards";
  if (!m) return { plug: "16-pin or 8-pin", words: "Most new graphics cards take a 16-pin plug or one or more 8-pin plugs. Look at the card's top edge." };
  const brand = m[1].toUpperCase(), n = +m[2], ti = /Ti/i.test(m[3]);
  const gen = n >= 1000 ? Math.floor(n / 100) : Math.floor(n / 10), tier = n % 100;
  const sixteen = { plug: "16-pin", words: `Most ${of} take one 16-pin plug (12V-2x6).` };
  const either = { plug: "16-pin or 8-pin", words: `${chip} cards take one 16-pin plug or one or two 8-pin plugs, depending on the maker. Look at the card's top edge.` };
  const eights = (count: string) => ({ plug: "8-pin PCIe", words: `Most ${of} take ${count} 8-pin PCIe plugs.` });
  if (brand === "RTX" && gen >= 50) return tier >= 70 ? sixteen : either;
  if (brand === "RTX" && gen === 40) return tier >= 80 || (tier === 70 && ti) ? sixteen : tier === 70 ? either : { plug: "8-pin PCIe", words: `Most ${of} take one 8-pin PCIe plug.` };
  if (brand === "RTX" && gen === 30) return tier >= 80 ? eights("two or three") : eights("one or two");
  if (brand === "RX") return n >= 7800 ? eights("two or three") : eights("one or two");
  return eights("one or two");
}

const text = (it: BoardItem) => `${it.name} ${it.label}`;
const pinCount = (it: BoardItem) => (it.pins ? it.pins.cols * it.pins.rows : 0);
/** Processor power ("CPU_PWR1", "ATX12V", "EPS"), told apart from the 24-pin ("ATX_PWR1"). */
const isCpu = (it: BoardItem) => /CPU|EPS|12V|Processor/i.test(text(it)) || [4, 8].includes(pinCount(it));
const is24 = (it: BoardItem) => !isCpu(it) && (pinCount(it) === 24 || /24|ATX/i.test(text(it)));
const numberIn = (s: string) => +(/(\d+)\D*$/.exec(s)?.[1] ?? 0);

/**
 * The guide for one PC. gpu is the card's name from Windows, null for no card (the processor's own graphics), and
 * undefined when Rig hasn't read it yet (a typical card).
 */
export function cableGuide(board: BoardShape, gpu?: string | null): CableGuide {
  const known = board.source !== "generic" && board.source !== "estimated";
  const power = board.items.filter((i) => i.kind === "power");
  const cpus = power.filter(isCpu).sort((a, b) => numberIn(a.name) - numberIn(b.name));
  const main = power.find(is24);
  const cables: Omit<Cable, "step">[] = [];
  cpus.forEach((it, i) => {
    const pins = pinCount(it) || 8;
    cables.push({
      id: i === 0 ? "eps" : "eps2", title: i === 0 ? "Processor power" : "Second processor power",
      plug: `${pins}-pin CPU`, to: it.id, code: it.name || undefined, port: "CPU", known,
      how: i === 0
        ? `First, while there's room: it's hard to reach once the cooler is on.${pins === 8 ? " An 8-pin CPU cable often splits into 4 + 4." : ""}`
        : "Optional for most processors. Plug it in if your supply has a second CPU cable.",
      ...(i === 0 ? {} : { optional: true }),
    });
  });
  if (main) cables.push({ id: "atx24", title: "Board power", plug: "24-pin", to: main.id, code: main.name || undefined, port: "MB or ATX", known, how: "Line the clip up with the latch and press until it clicks. It takes a firm push." });
  if (gpu !== null) {
    const p = gpuPlug(gpu ?? "");
    cables.push({ id: "gpu", title: "Graphics card power", plug: p.plug, to: null, port: "PCIe or VGA", known: false, how: `${p.words} Push it all the way in, with no gap, and don't bend the cable right at the plug.` });
  }
  return {
    cables: cables.map((c, i) => ({ ...c, step: i + 1 })),
    from: known
      ? "The board's plugs are where your board has them. The power supply and the card's plug are where most PCs have them, since Windows can't see either."
      : "Every plug is where most boards and cards have it, since Rig doesn't know this board's layout yet.",
    notes: [
      "CPU and graphics card cables can both have 8 pins, but they're wired differently. Use the cables marked CPU for the board and PCIe or VGA for the card.",
      "On a modular supply, use only the cables that came with it. Cables from another supply can damage parts.",
    ],
  };
}
