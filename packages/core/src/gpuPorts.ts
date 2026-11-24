// The graphics card's plugs: the display outputs on its bracket and the power plugs on its top edge, and which
// screen is on which output, from what Windows says about each screen.
//
// Windows names the kind of plug each screen is on (HDMI, DisplayPort) and which graphics drive it, but not
// which of a card's several plugs of that kind. So one screen on a card's one HDMI output is certain; one of
// two screens on three DisplayPort outputs is "on one of these", never a guess at which.
import type { DisplayLink } from "./model";
import type { DisplayConnection } from "./telemetry";

export type OutputKind = "hdmi" | "dp" | "usb-c" | "dvi";
export type PlugKind = "16-pin" | "8-pin" | "6-pin";

export interface GpuOutput {
  id: string;
  kind: OutputKind;
  /** Plain name, numbered when the card has more than one of its kind ("DisplayPort 2"). */
  label: string;
  version?: string;
}

export interface GpuPlug {
  id: string;
  kind: PlugKind;
  label: string;
}

export interface GpuPorts {
  /** Along the bracket from the slot up. */
  outputs: GpuOutput[];
  power: GpuPlug[];
  /** Where the list came from, shown to the person. */
  from: string;
  /** True when it's this card's own list; false when it's what most cards of the chip have. */
  exact: boolean;
}

const kindName: Record<OutputKind, string> = { hdmi: "HDMI", dp: "DisplayPort", "usb-c": "USB-C", dvi: "DVI" };
const plugName: Record<PlugKind, string> = { "16-pin": "16-pin power", "8-pin": "8-pin power", "6-pin": "6-pin power" };

/** A card's plugs from a short list: ports([["dp", 3, "1.4a"], ["hdmi", 1, "2.1a"]], ["16-pin"], ...). */
export function ports(outs: [OutputKind, number, string?][], power: PlugKind[], from: string, exact: boolean): GpuPorts {
  const count = (k: OutputKind) => outs.filter(([x]) => x === k).reduce((n, [, c]) => n + c, 0);
  const seen: Partial<Record<OutputKind, number>> = {};
  const outputs: GpuOutput[] = [];
  for (const [kind, n, version] of outs) for (let i = 0; i < n; i++) {
    const k = (seen[kind] = (seen[kind] ?? 0) + 1);
    outputs.push({ id: `${kind}-${k}`, kind, version, label: count(kind) > 1 ? `${kindName[kind]} ${k}` : kindName[kind] });
  }
  const plugs = power.map((kind, i) => ({ id: `power-${i + 1}`, kind, label: power.length > 1 ? `${plugName[kind]} ${i + 1}` : plugName[kind] }));
  return { outputs, power: plugs, from, exact };
}

export const outputKindName = (k: OutputKind) => kindName[k];

// ---------- power plug pins ----------

export interface PlugPin { name: string; /** Missing where Rig doesn't have the numbering (the 16-pin plug). */ number?: number }
/**
 * A power plug's pins as they sit on the card, seen from above: rows of pins, and on a 16-pin plug the four small
 * sense pins above them. The 8-pin and 6-pin plugs' first row is the clip side.
 */
export interface PlugPinout { rows: PlugPin[][]; sense?: PlugPin[]; note: string }

export function plugPinout(kind: PlugKind): PlugPinout {
  const run = (from: number, to: number, name: (n: number) => string) => Array.from({ length: to - from + 1 }, (_, i) => ({ number: from + i, name: name(from + i) }));
  if (kind === "16-pin") {
    // Twelve power pins in two rows, six +12V and six ground, and four short sense pins above them.
    const power = () => Array.from({ length: 6 }, () => ({ name: "Power" }));
    return {
      sense: Array.from({ length: 4 }, () => ({ name: "Sense" })),
      rows: [power(), power()],
      note: "Six of the big pins carry +12V and six are ground. The four small pins tell the card the plug is all the way in, so push until the latch clicks and no gap shows.",
    };
  }
  // PCIe plugs: +12V on pins 1 to 3, ground on the rest, and the clip side all ground (black wires).
  if (kind === "8-pin") return { rows: [run(5, 8, () => "Ground"), run(1, 4, (n) => (n <= 3 ? "+12V" : "Ground"))], note: "Seen from above, clip side at the top. Use a separate cable from the power supply for each 8-pin plug where you can." };
  return { rows: [run(4, 6, () => "Ground"), run(1, 3, () => "+12V")], note: "Seen from above, clip side at the top." };
}

// ---------- which screen is on which output ----------

const kindOf: Partial<Record<DisplayConnection, OutputKind>> = { hdmi: "hdmi", displayport: "dp", "usb-c": "usb-c", dvi: "dvi" };
/** "On an HDMI output", with its article, for a screen whose output Rig can't place on the card. */
const connectionName: Partial<Record<DisplayConnection, string>> = { hdmi: "an HDMI", displayport: "a DisplayPort", "usb-c": "a USB-C", dvi: "a DVI", vga: "a VGA" };

/** used and free are what Windows shows. some: a few of these outputs are in use, Windows doesn't say which. unknown: Rig can't tell. */
export type OutputState = "used" | "free" | "some" | "unknown";

export interface OutputUse {
  /** The output's id, so the list and the 3D card can light each other. */
  id: string;
  label: string;
  kind: OutputKind;
  state: OutputState;
  /** The screen on it, when Windows makes it certain. */
  screen?: string;
}

export interface OutputGroup {
  kind: OutputKind;
  title: string;
  outputs: OutputUse[];
  /** Screens Windows puts on this kind of output on the card. */
  screens: string[];
  /** One plain line on what's known. */
  note: string;
}

export interface CardUse {
  groups: OutputGroup[];
  /** Screens that aren't on the card's outputs, each with what Rig can say about where they are. */
  elsewhere: { name: string; note: string }[];
  /** Set when Windows didn't say how the screens connect at all. */
  unknown?: string;
  /**
   * Set when Rig doesn't know the card's own outputs: each screen on the card, with the kind of plug Windows names
   * for it. groups is then empty.
   */
  screens?: { name: string; /** "2560 × 1440 at 165 Hz" */ detail: string; /** "an HDMI": the kind of output it's on, where Windows names it. */ plug?: string }[];
}

const screenText = (s: DisplayLink) => `${s.name}, ${s.width} × ${s.height} at ${s.refreshHz} Hz`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Lays the screens Windows reports over the card's outputs. A screen counts as on the card when Windows says the
 * card drives it, or when it doesn't say (older helpers) and the PC has only the one graphics card in use.
 */
export function cardUse(p: GpuPorts | undefined, displays: DisplayLink[] | undefined): CardUse {
  const shown = (displays ?? []).filter((d) => d.connection !== "internal");
  const elsewhere: CardUse["elsewhere"] = [];
  const onCard: DisplayLink[] = [];
  for (const d of shown) {
    if (d.onCard === false) elsewhere.push({ name: d.name, note: "On the motherboard's own video out, so it uses the processor's graphics, not this card. Games run faster with it plugged into the card." });
    else if (d.connection === "wireless") elsewhere.push({ name: d.name, note: "Connected wirelessly, not to a plug on the card." });
    else onCard.push(d);
  }
  // Without the card's own list, only what Windows says about each screen.
  if (!p) return { groups: [], elsewhere, screens: onCard.map((d) => ({ name: d.name, detail: `${d.width} × ${d.height} at ${d.refreshHz} Hz`, plug: d.connection && connectionName[d.connection] })) };
  // With no screen on the card every output is free; with screens but no plug kinds, Rig can't say.
  const anyKnown = !onCard.length || onCard.some((d) => d.connection);
  const groups: OutputGroup[] = [];
  const kinds = [...new Set(p.outputs.map((o) => o.kind))];
  for (const kind of kinds) {
    const outs = p.outputs.filter((o) => o.kind === kind);
    const title = outs.length > 1 ? `${kindName[kind]} (${outs.length})` : kindName[kind];
    if (!anyKnown) {
      groups.push({ kind, title, screens: [], outputs: outs.map((o) => ({ id: o.id, label: o.label, kind, state: "unknown" })), note: "Windows didn't say which kind of plug each screen uses." });
      continue;
    }
    const on = onCard.filter((d) => d.connection && kindOf[d.connection] === kind);
    const screens = on.map(screenText);
    let state: OutputState, note: string, screen: string | undefined;
    if (!on.length) { state = "free"; note = outs.length > 1 ? "All free." : "Free."; }
    else if (outs.length === 1 && on.length === 1) { state = "used"; screen = on[0].name; note = `${on[0].name} is on it.`; }
    else if (on.length === outs.length) { state = "used"; note = `All in use. Windows doesn't say which screen is on which.`; }
    else if (on.length > outs.length) { state = "used"; note = `${plural(on.length, "screen")} on ${plural(outs.length, "output")}, so some share one through a hub or a daisy chain.`; }
    else { state = "some"; note = `${on.length} of ${outs.length} in use. Windows doesn't say which ${outs.length > 2 ? "ones" : "one"}.`; }
    groups.push({ kind, title, screens, note, outputs: outs.map((o) => ({ id: o.id, label: o.label, kind, state, screen })) });
  }
  // Screens on a kind of plug this card doesn't list.
  for (const d of onCard) {
    const kind = d.connection && kindOf[d.connection];
    if (d.connection && (!kind || !kinds.includes(kind))) {
      elsewhere.push({ name: d.name, note: d.connection === "vga" || d.connection === "other"
        ? "Windows doesn't name its plug as one this card has. It may go through an adapter."
        : `Windows says it's on ${kindName[kind!] ?? "a plug"}, which this card's list doesn't have. It may go through an adapter, or this card's outputs differ.` });
    }
  }
  const unknown = !anyKnown && onCard.length ? `${plural(onCard.length, "screen")} connected. Windows didn't say which kind of plug ${onCard.length === 1 ? "it uses" : "each uses"}.` : undefined;
  return { groups, elsewhere, unknown };
}
