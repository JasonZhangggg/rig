// Which of the motherboard's slots, ports and headers are in use, from what Windows says is plugged in
// (PC.board) laid over the board's layout (BoardShape). Windows sees memory sticks with their slots,
// drives by how they connect, the graphics card and the board's fan inputs. It can't see the front
// panel, USB, audio or RGB headers, so those are shown as "Rig can't see this", never guessed.
import type { BoardFacts } from "./model";
import { slotName, type BoardItem, type BoardShape } from "./build";

/** used and free are what Windows shows; unknown is a slot Rig can't see into. */
export type SlotState = "used" | "free" | "unknown";

export interface SlotUse {
  /** The board item's id, so a list row and the 3D board can light each other. */
  id: string;
  /** Printed name ("A2", "M2_1"). */
  name: string;
  /** Plain name ("Memory slot A2"). */
  label: string;
  state: SlotState;
  /** What's in it, in a few words ("16 GB Corsair, 6000 MT/s"). */
  what?: string;
}

export interface UsageGroup {
  key: "memory" | "pcie" | "m2" | "sata" | "fan" | "power" | "headers";
  title: string;
  slots: SlotUse[];
  /** How many are in use, and of how many, when Rig can count them. */
  used?: number;
  total?: number;
  /** One plain line: what's in use, or why Rig can't say which slot. */
  note: string;
  /** False when Windows can say how many are in use but not which ones, so the list shows a count, not slot by slot. */
  bySlot: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const size = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(gb % 1000 ? 1 : 0)} TB` : `${gb} GB`);
const byKind = (b: BoardShape, ...kinds: BoardItem["kind"][]) => b.items.filter((i) => kinds.includes(i.kind));
const slot = (it: BoardItem, state: SlotState, what?: string): SlotUse => ({ id: it.id, name: it.name, label: it.label, state, what });

/** "SATA1-4" is four ports on one block; anything else is one. */
export function portsOf(it: BoardItem) {
  const m = /(\d+)\s*[-~]\s*(\d+)/.exec(it.name);
  return m ? Math.max(1, +m[2] - +m[1] + 1) : 1;
}

/** The memory sticks placed in the board's slots: the slot Windows names, else the slots boards ask for first. */
export function memoryIn(board: BoardShape, facts: BoardFacts) {
  const dimms = byKind(board, "dimm");
  const names = dimms.map((d) => d.name);
  const order = ["A2", "B2", "A1", "B1"].filter((n) => names.includes(n)).concat(names.filter((n) => !["A2", "B2", "A1", "B1"].includes(n)));
  const placed = new Map<string, BoardFacts["memory"][number]>();
  let guessed = false;
  for (const m of facts.memory) {
    const named = slotName(m.slot);
    if (named && names.includes(named) && !placed.has(named)) { placed.set(named, m); continue; }
    const next = order.find((n) => !placed.has(n));
    if (next) { placed.set(next, m); guessed = true; }
  }
  return { dimms, placed, guessed };
}

function stick(m: BoardFacts["memory"][number]) {
  return [`${m.gb} GB`, m.maker].filter(Boolean).join(" ") + (m.mts ? `, ${m.mts} MT/s` : "");
}

/**
 * The board's usage, group by group. fanRpm is each fan input's speed now, by sensor id;
 * a missing or zero speed is a fan that isn't plugged in or isn't spinning.
 */
export function boardUsage(board: BoardShape, facts: BoardFacts, fanRpm: Record<string, number | null | undefined> = {}): UsageGroup[] {
  const out: UsageGroup[] = [];
  const typical = board.source === "generic" || board.source === "estimated";

  // Memory: Windows names each stick's slot on most boards.
  const { dimms, placed, guessed } = memoryIn(board, facts);
  if (dimms.length) {
    const slots = dimms.map((d) => { const m = placed.get(d.name); return slot(d, m ? "used" : "free", m ? stick(m) : undefined); });
    const used = slots.filter((s) => s.state === "used").length;
    out.push({
      key: "memory", title: "Memory", slots, used, total: dimms.length, bySlot: true,
      note: guessed ? "Windows didn't say which slots, so these are the ones boards fill first." : used ? `${plural(used, "stick")}, ${size(facts.memory.reduce((n, m) => n + m.gb, 0))} in all.` : "No memory reported.",
    });
  }

  // Expansion slots: Windows names the graphics card but not the slot it's in. Graphics cards go in the top x16 slot.
  const pcie = byKind(board, "pcie");
  if (pcie.length) {
    const top = pcie.find((p) => p.id === "pcie1") ?? pcie[0];
    const slots = pcie.map((p) => p === top && facts.gpu ? slot(p, "used", facts.gpu.replace(/^(NVIDIA|AMD|Intel)(\(R\))?\s+(GeForce\s+)?/i, "")) : slot(p, "unknown"));
    out.push({
      key: "pcie", title: "Expansion slots", slots, bySlot: true, used: facts.gpu ? 1 : undefined, total: pcie.length,
      note: facts.gpu
        ? `The graphics card is almost always in ${top.name}. Rig can't see other cards, such as Wi-Fi or capture cards.`
        : "No graphics card, so the processor's own graphics are in use. Rig can't see other cards.",
    });
  }

  // M.2: Windows counts NVMe drives but doesn't say which slot each is in.
  const m2 = byKind(board, "m2");
  const nvme = facts.drives.filter((d) => d.media === "nvme");
  if (m2.length || nvme.length) {
    const n = nvme.length, t = m2.length;
    const sure = n === 0 || n >= t;
    const slots = m2.map((it) => (n === 0 ? slot(it, "free") : n >= t ? slot(it, "used", t === 1 ? nvme[0].model : undefined) : slot(it, "unknown")));
    if (n >= t && t > 1) slots.forEach((s, i) => { s.what = nvme[i]?.model; });
    out.push({
      key: "m2", title: "M.2 drives", slots, used: n, total: t || undefined, bySlot: sure && t <= 1,
      note: n === 0 ? "No NVMe drives." : `${nvme.map((d) => `${d.model} (${size(d.sizeGb)})`).join(", ")}.${t > 1 && n < t ? " Windows doesn't say which slot." : ""}`,
    });
  }

  // SATA: SSDs and hard drives that aren't NVMe. A USB drive can show up as one too, so this is a count, not a port map.
  const sata = byKind(board, "sata");
  const sataDrives = facts.drives.filter((d) => d.media === "ssd" || d.media === "hdd");
  if (sata.length || sataDrives.length) {
    const ports = sata.reduce((n, s) => n + portsOf(s), 0);
    out.push({
      key: "sata", title: "SATA ports", slots: sata.map((s) => slot(s, sataDrives.length ? "used" : "free")), used: sataDrives.length, total: ports || undefined, bySlot: false,
      note: sataDrives.length ? `${sataDrives.map((d) => d.model).join(", ")}. Windows doesn't say which port.` : "No SATA drives.",
    });
  }

  // Fans: the board reads a speed on each fan input. Names like "CPU Fan" say which header; "Fan #2" doesn't.
  const headers = byKind(board, "fan");
  if (headers.length || facts.fans.length) {
    const spinning = facts.fans.filter((f) => (fanRpm[f.id] ?? 0) > 0);
    const matched = new Map<string, number>();
    for (const f of facts.fans) {
      const h = fanHeader(f.name, headers);
      if (h) matched.set(h.id, fanRpm[f.id] ?? 0);
    }
    const all = headers.length > 0 && facts.fans.length > 0 && facts.fans.every((f) => fanHeader(f.name, headers));
    const slots = headers.map((h) => {
      const rpm = matched.get(h.id);
      return rpm === undefined ? slot(h, "unknown") : slot(h, rpm > 0 ? "used" : "free", rpm > 0 ? `${Math.round(rpm).toLocaleString("en-US")} rpm` : undefined);
    });
    out.push({
      key: "fan", title: "Fan headers", slots, used: spinning.length, total: headers.length || undefined, bySlot: all,
      note: !facts.fans.length ? "The board doesn't report fan speeds to Windows."
        : `${plural(spinning.length, "fan")} spinning on ${plural(facts.fans.length, "fan input")}.${all ? "" : " The board doesn't say which header each input is."}`,
    });
  }

  // Power: a running PC has its 24-pin and processor power plugged in. A second processor plug is optional.
  const power = byKind(board, "power");
  if (power.length) {
    const needed = (p: BoardItem) => p.id === "atx24" || p.id === "eps";
    out.push({
      key: "power", title: "Power", slots: power.map((p) => slot(p, needed(p) ? "used" : "unknown", needed(p) ? "Plugged in, or the PC wouldn't start" : undefined)), bySlot: true,
      note: power.some((p) => !needed(p)) ? "The second processor plug is optional, and Windows can't tell if it's in." : "Both have to be in for the PC to start.",
    });
  }

  // Headers Windows can't see into at all.
  const blind = byKind(board, "usb", "front-panel", "audio", "rgb");
  if (blind.length) {
    out.push({ key: "headers", title: "Front panel, USB, audio and lighting", slots: blind.map((b) => slot(b, "unknown")), bySlot: true, note: "Windows can't see what's plugged into these. Point at one for its pins." });
  }

  if (typical) for (const g of out) g.note = `${g.note} The slots are a typical board's until Rig reads your board's layout.`.trim();
  return out;
}

/** The header a fan input's name points to ("CPU Fan" -> CPU_FAN1, "System Fan #2" -> SYS_FAN2), or none for a bare "Fan #2". */
export function fanHeader(name: string, headers: BoardItem[]): BoardItem | undefined {
  const n = name.toLowerCase();
  const find = (re: RegExp) => headers.find((h) => re.test(h.name.toLowerCase()));
  if (/\bcpu\b/.test(n) && !/opt/.test(n)) return find(/^cpu_fan/);
  if (/\bpump\b|\baio\b/.test(n)) return find(/pump/);
  const m = /(system|chassis|sys|cha)\s*fan\s*#?\s*(\d+)/.exec(n);
  if (m) return find(new RegExp(`^(sys|cha)_?fan_?${m[2]}$`));
  return undefined;
}
