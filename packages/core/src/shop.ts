// Parts that could go in a PC, checked against the parts Rig read from it.
// The catalog and its prices are demo data: Rig has no shop feed yet, so every
// screen that shows a price says so (see Shop.demo).

import type { Inventory } from "./telemetry";

export type ShopCategory = "memory" | "storage" | "gpu" | "cpu" | "cooler" | "fans" | "psu";

export const shopCategories: { key: ShopCategory; label: string; part: string }[] = [
  { key: "memory", label: "Memory", part: "Memory" },
  { key: "storage", label: "Storage", part: "Storage" },
  { key: "gpu", label: "Graphics card", part: "Graphics card" },
  { key: "cpu", label: "Processor", part: "Processor" },
  { key: "cooler", label: "CPU cooler", part: "Cooling" },
  { key: "fans", label: "Case fans", part: "Cooling" },
  { key: "psu", label: "Power supply", part: "Power supply" },
];

export interface ShopOffer { shop: string; price: number; inStock: boolean }

/** A real retailer's listing for a part, from a shop feed. Its photo and price replace the demo ones. */
export interface Retail {
  shop: string;
  price: number;
  inStock: boolean;
  /** The product's page at the shop. */
  url: string;
  /** The shop's product photo, licensed by its feed for showing next to its price. */
  image?: string;
  /** When the server read it, ISO time. */
  checkedAt: string;
}

export interface ShopItem {
  id: string;
  category: ShopCategory;
  name: string;
  /** The brand, like "Corsair", for the maker filter. */
  maker: string;
  /**
   * A product photo from the shop feed it came from, which licenses it for this use.
   * The demo catalog has none, and Rig never takes photos from makers' or shops' sites.
   */
  image?: string;
  /** One line of what matters, like "DDR5-6000 CL30". */
  spec: string;
  specs: [string, string][];
  /** Lowest first. */
  offers: ShopOffer[];
  /** The lowest price each week for 12 weeks, oldest first. The last one is today's. */
  history: number[];
  /** Typical power draw, for processors and graphics cards. */
  watts?: number;
  /** The real listing, when a shop feed is set up and found this part. */
  retail?: Retail;
  is: {
    ddr?: 4 | 5; sodimm?: boolean; sticks?: number; stickGb?: number; speed?: number; partNumber?: string;
    m2?: boolean; sata?: boolean; tb?: number;
    socket?: string; minBios?: string; cores?: number;
    vramGb?: number;
    heightMm?: number; radiatorMm?: number; sockets?: string[];
    fanMm?: number; count?: number;
    psuW?: number;
  };
}

/** What Rig read about the PC, in the terms parts are checked against. */
export interface HardwareFacts {
  name: string;
  laptop: boolean;
  cpu: { name: string; short: string; socket?: string; cores: number; watts: number };
  gpu: { name: string; short: string; vramGb?: number; watts: number } | null;
  board: { name: string; m2Slots?: number; maxRamGb?: number; bios?: string; biosLabel?: string };
  memory: { ddr?: 4 | 5; slotsTotal?: number; used: number; stickGb?: number; totalGb: number; speed?: number; partNumber?: string; soldered: "reported" | "likely" | false };
  storage: { nvme: number; sata: number; totalTb: number; drive?: string };
  /** Estimated draw at full load, from the parts' typical draw. */
  draw: { cpu: number; gpu: number; rest: number; total: number };
  /** Windows as it names itself ("Windows 11 Pro") and its build. Missing from a server older than the game check. */
  os?: { name: string; build?: string };
  /** The processor's own graphics, when there's no card. */
  igpu?: string;
  /** Each volume's free space, and whether it's on an SSD (missing: Rig can't tell). Missing from an older server. */
  volumes?: { letter: string; freeGb: number; ssd?: boolean }[];
}

export interface Shop {
  /** True while any price shown is made up. */
  demo: boolean;
  /** The shop feed real listings come from, like "Best Buy", when one is set up. */
  retailFrom?: string;
  facts: HardwareFacts;
  items: ShopItem[];
}

export interface Fit { verdict: "fits" | "check" | "no"; why: string; also: string[] }

// Typical draw in watts, matched against the model name.
const cpuWatts: [RegExp, number][] = [[/9950X3D/i, 170], [/9950X/i, 170], [/7950X/i, 170], [/X3D/i, 120], [/9700X|9600X/i, 65], [/7700X|7600X/i, 105], [/1[34]\d00K/i, 125], [/Ultra [579] 2\d\dK/i, 125]];
const gpuWatts: [RegExp, number][] = [[/5090/, 575], [/5080/, 360], [/5070 Ti/i, 300], [/5070/, 250], [/4090/, 450], [/4080/, 320], [/4070 Ti/i, 285], [/4070 SUPER/i, 220], [/4070/, 200], [/4060 Ti/i, 160], [/4060/, 115], [/9070 XT/i, 304], [/9070/, 220], [/7900 XTX/i, 355], [/7800 XT/i, 263]];
const wattsOf = (name: string, table: [RegExp, number][], fallback: number) => table.find(([r]) => r.test(name))?.[1] ?? fallback;

/** Boards Rig knows the spec sheet of. Windows doesn't say how many M.2 slots a board has. */
const boards: Record<string, { m2Slots: number; maxRamGb: number }> = {
  "MAG B650 TOMAHAWK WIFI": { m2Slots: 3, maxRamGb: 192 },
};

function socketOf(cpu: string, laptop: boolean): string | undefined {
  if (laptop) return undefined;
  if (/Ryzen \d \d?[789]\d{3}/i.test(cpu)) return "AM5";
  if (/Ryzen \d \d?[1-5]\d{3}/i.test(cpu)) return "AM4";
  if (/i[3579]-1[234]\d{3}/i.test(cpu)) return "LGA1700";
  if (/Ultra [579] 2\d\d/i.test(cpu)) return "LGA1851";
  return undefined;
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mar 2026" as "2026-03", so dates compare as text. */
function yearMonth(s?: string): string | undefined {
  const m = s?.match(/([A-Z][a-z]{2})\w* (\d{4})/);
  if (!m) return undefined;
  const i = months.indexOf(m[1]);
  return i < 0 ? undefined : `${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

/** "AMD Ryzen 7 7800X3D" as "7800X3D", "NVIDIA GeForce RTX 4070 SUPER" as "RTX 4070 SUPER". */
const shortCpu = (n: string) => n.replace(/^(AMD|Intel\(R\)|Intel)\s+/i, "").replace(/^Ryzen \d\s+/i, "").trim() || n;
const shortGpu = (n: string) => n.replace(/^(NVIDIA|AMD|Intel)\s+/i, "").replace(/^GeForce\s+/i, "").replace(/^Radeon\s+/i, "").trim() || n;

// SMBIOS memory types for LPDDR to LPDDR5: low-power memory is soldered, never a stick.
const lpddr = new Set([27, 28, 29, 30, 35]);
// Windows' FormFactor for chips on the board (TSOP, SMD, BGA, FPBGA), and for the two kinds of stick (DIMM, SO-DIMM).
const chipForm = new Set([9, 14, 21, 22]);
const stickForm = new Set([8, 12]);
// DDR3, DDR4 and DDR5: the kinds that come on sticks.
const stickType = new Set([24, 26, 34]);

/**
 * Whether the memory is soldered to the board, so no stick fits: "reported" when the modules' own form and type
 * say so, "likely" for a laptop with one module and no slot count (it almost always has it on the board), and
 * undefined when it isn't, or Rig can't tell.
 */
export function solderedMemory(inv: Inventory): "reported" | "likely" | undefined {
  const { modules, slotsTotal } = inv.memory;
  const said = modules.map((m) =>
    (m.smbiosType != null && lpddr.has(m.smbiosType)) || (m.formFactor != null && chipForm.has(m.formFactor)) ? true
      : m.formFactor != null && stickForm.has(m.formFactor) && m.smbiosType != null && stickType.has(m.smbiosType) ? false
        : undefined);
  if (said.length && said.every((s) => s === true)) return "reported";
  if (said.some((s) => s === false)) return undefined;
  return inv.machine.kind === "laptop" && !slotsTotal && modules.length <= 1 ? "likely" : undefined;
}

/**
 * How Rig says memory is built into the board, the same on the Upgrade tab and on Upgrades: plainly when the modules
 * say so (solderedMemory's "reported"), "most likely" when it goes by a laptop's one module and no slot count.
 */
export const builtInWords = (how: "reported" | "likely") => (how === "reported" ? "built into the board" : "most likely built into the board");

export function hardwareFacts(inv: Inventory): HardwareFacts {
  const laptop = inv.machine.kind === "laptop";
  const m = inv.memory;
  const first = m.modules[0];
  const speed = first?.speedMhz;
  const socket = socketOf(inv.cpu.name, laptop);
  const ddr: 4 | 5 | undefined = socket === "AM5" || socket === "LGA1851" ? 5 : socket === "AM4" ? 4 : speed ? (speed >= 4800 ? 5 : 4) : undefined;
  const gpu = inv.gpus.find((g) => !g.integrated);
  const board = boards[inv.board.product];
  const cpuW = wattsOf(inv.cpu.name, cpuWatts, laptop ? 45 : 105);
  const gpuW = gpu ? wattsOf(gpu.name, gpuWatts, 200) : 0;
  const rest = laptop ? 20 : 75;
  return {
    name: inv.machine.hostname,
    laptop,
    cpu: { name: inv.cpu.name, short: shortCpu(inv.cpu.name), socket, cores: inv.cpu.cores, watts: cpuW },
    gpu: gpu ? { name: gpu.name, short: shortGpu(gpu.name), vramGb: gpu.vramMb ? Math.round(gpu.vramMb / 1024) : undefined, watts: gpuW } : null,
    board: { name: `${inv.board.manufacturer} ${inv.board.product}`.trim(), m2Slots: board?.m2Slots, maxRamGb: board?.maxRamGb, bios: yearMonth(inv.board.biosDate), biosLabel: inv.board.biosDate },
    memory: {
      ddr, slotsTotal: m.slotsTotal, used: m.modules.length, stickGb: first ? Math.round(first.capacityMb / 1024) : undefined,
      totalGb: Math.round(m.totalMb / 1024), speed, partNumber: first?.partNumber,
      soldered: solderedMemory(inv) ?? false,
    },
    storage: {
      nvme: inv.disks.filter((d) => d.media === "nvme").length,
      sata: inv.disks.filter((d) => d.media === "ssd" || d.media === "hdd").length,
      totalTb: inv.disks.reduce((n, d) => n + d.sizeGb, 0) / 1000,
      drive: inv.disks[0]?.model,
    },
    draw: { cpu: cpuW, gpu: gpuW, rest, total: cpuW + gpuW + rest },
    os: { name: inv.machine.os.name, build: inv.machine.os.build || undefined },
    igpu: gpu ? undefined : inv.gpus.find((g) => g.integrated)?.name,
    volumes: inv.volumes.map((v) => {
      const disk = inv.disks.find((d) => d.number !== undefined && d.number === v.disk) ?? (inv.disks.length === 1 ? inv.disks[0] : undefined);
      const ssd = !disk || disk.media === "unknown" ? undefined : disk.media !== "hdd";
      return { letter: v.letter, freeGb: v.freeGb, ...(ssd === undefined ? {} : { ssd }) };
    }),
  };
}

/** The supply Rig would want for a draw: a quarter on top, rounded up to 50 W. */
export const psuFor = (draw: number) => Math.ceil((draw * 1.25) / 50) * 50;

/** The draw at full load with this part in place of the one it replaces. */
export function drawWith(item: ShopItem, f: HardwareFacts): number {
  if (item.category === "gpu") return f.draw.total - f.draw.gpu + (item.watts ?? 0);
  if (item.category === "cpu") return f.draw.total - f.draw.cpu + (item.watts ?? 0);
  return f.draw.total;
}

const fit = (verdict: Fit["verdict"], why: string, also: (string | false | 0 | undefined)[] = []): Fit => ({ verdict, why, also: also.filter((x): x is string => !!x) });

/** Whether a part fits the PC, and why, in a sentence. psuW is the power supply's wattage when the person told Rig. */
export function fitOf(item: ShopItem, f: HardwareFacts, psuW?: number): Fit {
  const is = item.is;
  const pc = f.name;
  switch (item.category) {
    case "memory": {
      const m = f.memory;
      if (m.soldered) return fit("no", `${pc}'s memory is ${builtInWords(m.soldered)}${f.laptop ? ", like most thin laptops" : ""}.`);
      if (is.sodimm && !f.laptop) return fit("no", "This is laptop memory (SO-DIMM). It doesn't fit a desktop board.");
      if (!is.sodimm && f.laptop) return fit("no", "This is desktop memory. Laptops take the smaller SO-DIMM sticks.");
      if (m.ddr && is.ddr && is.ddr !== m.ddr) return fit("no", `DDR${is.ddr} doesn't fit ${pc}'s DDR${m.ddr} board.`);
      const sticks = is.sticks ?? 1;
      const kitGb = sticks * (is.stickGb ?? 0);
      const free = m.slotsTotal != null ? m.slotsTotal - m.used : undefined;
      const slow = is.ddr === 5 && m.used + sticks > 2 && "Four sticks of DDR5 often run slower than two, around 5200 to 5600 MT/s.";
      if (free != null && sticks <= free) {
        const total = m.totalGb + kitGb;
        if (f.board.maxRamGb && total > f.board.maxRamGb) return fit("no", `${total} GB is more than the board takes (${f.board.maxRamGb} GB).`);
        const into = `the ${free} free ${free === 1 ? "slot" : "slots"}`;
        const slower = is.speed && m.speed && is.speed < m.speed && `Your sticks would slow to ${is.speed} MT/s to match.`;
        if (m.partNumber && is.partNumber === m.partNumber) return fit("fits", `Same kit as yours, into ${into}.`, [slow, slower]);
        return fit("check", `Goes into ${into}, but it's a different kit from yours. Mixed kits sometimes won't run at full speed together.`, [slow, slower]);
      }
      if (m.slotsTotal != null && sticks <= m.slotsTotal) return fit("fits", `Replaces your ${m.used} ${m.used === 1 ? "stick" : "sticks"}.`, [slow]);
      return fit("check", `Check how many memory slots ${pc} has.`);
    }
    case "storage": {
      if (is.sata) return f.laptop ? fit("no", `${pc} has no bay for a 2.5-inch drive.`) : fit("check", "Needs a free 2.5-inch bay and a SATA cable.");
      if (f.laptop) return fit("check", `Replaces ${pc}'s drive, since it has one M.2 slot. Back up first, and check the slot length in its service guide.`);
      const free = f.board.m2Slots != null ? f.board.m2Slots - f.storage.nvme : undefined;
      if (free == null) return fit("check", "Check your board's manual for a free M.2 slot.");
      if (free > 0) return fit("fits", `Goes in one of the ${free} free M.2 ${free === 1 ? "slot" : "slots"}.`);
      return fit("check", "Every M.2 slot is in use, so this would replace a drive.");
    }
    case "gpu": {
      if (f.laptop) return fit("no", f.gpu ? `${pc}'s ${f.gpu.short} is soldered to the board.` : `${pc}'s graphics are built into its processor.`);
      const need = drawWith(item, f);
      const length = "Card length varies by maker, so check it against your case.";
      if (psuW == null) return fit("check", `Needs about ${need} W in all. Tell Rig your power supply's wattage to check it.`, [length]);
      if (psuW >= psuFor(need)) return fit("fits", `Your ${psuW} W supply covers the ${need} W it needs.`, [length]);
      if (psuW >= need) return fit("check", `Tight on your ${psuW} W supply: it needs about ${need} W, and Rig would want ${psuFor(need)} W.`, [length]);
      return fit("no", `Needs about ${need} W, more than your ${psuW} W supply gives.`);
    }
    case "cpu": {
      if (f.laptop) return fit("no", `${pc}'s processor is soldered to the board.`);
      if (!f.cpu.socket) return fit("check", `Rig couldn't tell which socket ${pc}'s board has.`);
      if (is.socket !== f.cpu.socket) return fit("no", `Needs an ${is.socket} board. ${pc} has ${f.cpu.socket}.`);
      const hotter = item.watts && item.watts > f.cpu.watts + 30 && `It draws ${item.watts} W against your ${f.cpu.short}'s ${f.cpu.watts} W, so check your cooler keeps up.`;
      if (is.minBios && f.board.bios && f.board.bios >= is.minBios) return fit("fits", `Same ${f.cpu.socket} socket, and your BIOS from ${f.board.biosLabel} already supports it.`, [hotter]);
      if (is.minBios) return fit("check", `Same ${f.cpu.socket} socket, but it may need a BIOS update first.`, [hotter]);
      return fit("fits", `Same ${f.cpu.socket} socket.`, [hotter]);
    }
    case "cooler": {
      if (f.laptop) return fit("no", `${pc} has no room for a different cooler.`);
      if (f.cpu.socket && !is.sockets?.includes(f.cpu.socket)) return fit("no", `Doesn't mount on ${f.cpu.socket}.`);
      if (is.radiatorMm) return fit("check", `Mounts on ${f.cpu.socket ?? "your socket"}. Needs room for a ${is.radiatorMm} mm radiator in your case.`);
      return fit("check", `Mounts on ${f.cpu.socket ?? "your socket"}. Check that its ${is.heightMm} mm height clears your case's side panel.`);
    }
    case "fans":
      if (f.laptop) return fit("no", `${pc} has no case fan mounts.`);
      return fit("check", `Check your case for free ${is.fanMm} mm mounts and your board for fan headers.`);
    case "psu": {
      if (f.laptop) return fit("no", `${pc} runs from its charger.`);
      const want = psuFor(f.draw.total);
      const w = is.psuW ?? 0;
      if (w < f.draw.total) return fit("no", `Too small for ${pc}'s estimated ${f.draw.total} W.`);
      if (w < want) return fit("check", `Covers ${pc}'s estimated ${f.draw.total} W, with little to spare.`, ["Check it fits your case: most towers take ATX."]);
      return fit("fits", `Covers ${pc}'s estimated ${f.draw.total} W with room to spare.`, ["Check it fits your case: most towers take ATX."]);
    }
  }
}

/** What the part changes against what the PC has now, like "64 GB in all, up from 32 GB". */
export function gainOf(item: ShopItem, f: HardwareFacts): string | null {
  const is = item.is;
  switch (item.category) {
    case "memory": {
      const kit = (is.sticks ?? 1) * (is.stickGb ?? 0);
      const free = f.memory.slotsTotal != null ? f.memory.slotsTotal - f.memory.used : 0;
      const total = (is.sticks ?? 1) <= free ? f.memory.totalGb + kit : kit;
      return total === f.memory.totalGb ? `${total} GB, same as now` : `${total} GB in all, ${total > f.memory.totalGb ? "up" : "down"} from ${f.memory.totalGb} GB`;
    }
    case "storage": {
      const now = +f.storage.totalTb.toFixed(1);
      if (f.laptop && is.m2) return is.tb === now ? `${now} TB, same as now` : `${is.tb} TB in all, ${is.tb! > now ? "up" : "down"} from ${now} TB`;
      return `${+(f.storage.totalTb + (is.tb ?? 0)).toFixed(1)} TB in all, up from ${now} TB`;
    }
    case "gpu": return f.gpu?.vramGb && is.vramGb ? `${is.vramGb} GB of video memory, yours has ${f.gpu.vramGb} GB` : null;
    case "cpu": return is.cores ? `${is.cores} cores, yours has ${f.cpu.cores}` : null;
    case "psu": return is.psuW ? `${is.psuW} W, Rig would want ${psuFor(f.draw.total)} W` : null;
    default: return null;
  }
}

/** A part's state on this PC: what's in it now and how much room there is. Closed when it can't be changed. */
export interface CategoryState { key: ShopCategory; label: string; open: boolean; have: string; room?: string }

export function categoryState(key: ShopCategory, f: HardwareFacts, psuW?: number): CategoryState {
  const label = shopCategories.find((c) => c.key === key)!.label;
  const m = f.memory;
  const closed = (have: string): CategoryState => ({ key, label, open: false, have });
  switch (key) {
    case "memory": {
      if (m.soldered) return closed(`${m.totalGb} GB, ${builtInWords(m.soldered)}`);
      const kit = m.stickGb ? `${m.used} × ${m.stickGb} GB${m.ddr ? ` DDR${m.ddr}` : ""}${m.speed ? ` at ${m.speed} MT/s` : ""}` : `${m.totalGb} GB`;
      const free = m.slotsTotal != null ? m.slotsTotal - m.used : undefined;
      return { key, label, open: true, have: kit, room: free == null ? undefined : free ? `${free} of ${m.slotsTotal} slots free` : "Every slot in use" };
    }
    case "storage": {
      const free = f.board.m2Slots != null ? f.board.m2Slots - f.storage.nvme : undefined;
      return { key, label, open: true, have: f.storage.drive ?? `${+f.storage.totalTb.toFixed(1)} TB`, room: f.laptop ? "One M.2 slot, so a swap" : free == null ? undefined : free ? `${free} of ${f.board.m2Slots} M.2 slots free` : "Every M.2 slot in use" };
    }
    case "gpu": return !f.gpu ? closed("Built into the processor") : f.laptop ? closed(`${f.gpu.short}, soldered`) : { key, label, open: true, have: f.gpu.short, room: f.gpu.vramGb ? `${f.gpu.vramGb} GB of video memory` : undefined };
    case "cpu": return f.laptop ? closed(`${f.cpu.short}, soldered`) : { key, label, open: true, have: f.cpu.name.replace(/^(AMD|Intel)\s+/i, ""), room: f.cpu.socket && `${f.cpu.socket} socket` };
    case "cooler": return f.laptop ? closed("Built in") : { key, label, open: true, have: "Windows can't see it" };
    case "fans": return f.laptop ? closed("Built in") : { key, label, open: true, have: "Windows can't see them" };
    case "psu": return f.laptop ? closed("The charger") : { key, label, open: true, have: psuW ? `${psuW} W` : "Windows can't see it", room: `About ${f.draw.total} W at full load` };
  }
}

// ---- Demo catalog. Made-up prices from made-up shops, labeled as such wherever they show. ----

export const demoShops = ["Northwind", "Contoso Parts", "Fabrikam"];

type Base = Omit<ShopItem, "offers" | "history" | "maker"> & { price: number };

const base: Base[] = [
  { id: "m-vengeance-32", category: "memory", name: "Corsair Vengeance 32 GB (2 × 16 GB)", spec: "DDR5-6000 CL30", price: 104, is: { ddr: 5, sticks: 2, stickGb: 16, speed: 6000, partNumber: "CMK32GX5M2B6000C30" }, specs: [["Type", "DDR5"], ["Speed", "6000 MT/s"], ["Latency", "CL30"], ["Sticks", "2 × 16 GB"], ["Part number", "CMK32GX5M2B6000C30"]] },
  { id: "m-flare-32", category: "memory", name: "G.Skill Flare X5 32 GB (2 × 16 GB)", spec: "DDR5-6000 CL30", price: 99, is: { ddr: 5, sticks: 2, stickGb: 16, speed: 6000, partNumber: "F5-6000J3038F16GX2-FX5" }, specs: [["Type", "DDR5"], ["Speed", "6000 MT/s"], ["Latency", "CL30"], ["Sticks", "2 × 16 GB"]] },
  { id: "m-vengeance-64", category: "memory", name: "Corsair Vengeance 64 GB (2 × 32 GB)", spec: "DDR5-6000 CL30", price: 189, is: { ddr: 5, sticks: 2, stickGb: 32, speed: 6000, partNumber: "CMK64GX5M2B6000C30" }, specs: [["Type", "DDR5"], ["Speed", "6000 MT/s"], ["Latency", "CL30"], ["Sticks", "2 × 32 GB"]] },
  { id: "m-trident-96", category: "memory", name: "G.Skill Trident Z5 96 GB (2 × 48 GB)", spec: "DDR5-6400 CL32", price: 299, is: { ddr: 5, sticks: 2, stickGb: 48, speed: 6400 }, specs: [["Type", "DDR5"], ["Speed", "6400 MT/s"], ["Latency", "CL32"], ["Sticks", "2 × 48 GB"]] },
  { id: "m-fury-ddr4", category: "memory", name: "Kingston Fury Beast 32 GB (2 × 16 GB)", spec: "DDR4-3600 CL18", price: 72, is: { ddr: 4, sticks: 2, stickGb: 16, speed: 3600 }, specs: [["Type", "DDR4"], ["Speed", "3600 MT/s"], ["Sticks", "2 × 16 GB"]] },
  { id: "m-crucial-sodimm", category: "memory", name: "Crucial 32 GB (2 × 16 GB) SO-DIMM", spec: "DDR5-5600 laptop memory", price: 85, is: { ddr: 5, sodimm: true, sticks: 2, stickGb: 16, speed: 5600 }, specs: [["Type", "DDR5 SO-DIMM"], ["Speed", "5600 MT/s"], ["Sticks", "2 × 16 GB"]] },

  { id: "s-990pro-2", category: "storage", name: "Samsung 990 PRO 2 TB", spec: "M.2 NVMe, PCIe 4.0", price: 159, is: { m2: true, tb: 2 }, specs: [["Form", "M.2 2280"], ["Interface", "PCIe 4.0 NVMe"], ["Read", "7450 MB/s"], ["Capacity", "2 TB"]] },
  { id: "s-sn850x-2", category: "storage", name: "WD_Black SN850X 2 TB", spec: "M.2 NVMe, PCIe 4.0", price: 139, is: { m2: true, tb: 2 }, specs: [["Form", "M.2 2280"], ["Interface", "PCIe 4.0 NVMe"], ["Read", "7300 MB/s"], ["Capacity", "2 TB"]] },
  { id: "s-p3plus-4", category: "storage", name: "Crucial P3 Plus 4 TB", spec: "M.2 NVMe, PCIe 4.0", price: 219, is: { m2: true, tb: 4 }, specs: [["Form", "M.2 2280"], ["Interface", "PCIe 4.0 NVMe"], ["Read", "4800 MB/s"], ["Capacity", "4 TB"]] },
  { id: "s-t500-1", category: "storage", name: "Crucial T500 1 TB", spec: "M.2 NVMe, PCIe 4.0", price: 69, is: { m2: true, tb: 1 }, specs: [["Form", "M.2 2280"], ["Interface", "PCIe 4.0 NVMe"], ["Read", "7300 MB/s"], ["Capacity", "1 TB"]] },
  { id: "s-870evo-2", category: "storage", name: "Samsung 870 EVO 2 TB", spec: "2.5-inch SATA", price: 129, is: { sata: true, tb: 2 }, specs: [["Form", "2.5-inch"], ["Interface", "SATA"], ["Read", "560 MB/s"], ["Capacity", "2 TB"]] },

  { id: "g-5070", category: "gpu", name: "NVIDIA GeForce RTX 5070", spec: "12 GB, about 250 W", price: 549, watts: 250, is: { vramGb: 12 }, specs: [["Video memory", "12 GB GDDR7"], ["Typical power", "250 W"], ["Power plug", "16-pin"]] },
  { id: "g-9070xt", category: "gpu", name: "AMD Radeon RX 9070 XT", spec: "16 GB, about 304 W", price: 629, watts: 304, is: { vramGb: 16 }, specs: [["Video memory", "16 GB GDDR6"], ["Typical power", "304 W"], ["Power plugs", "2 × 8-pin on most cards"]] },
  { id: "g-5070ti", category: "gpu", name: "NVIDIA GeForce RTX 5070 Ti", spec: "16 GB, about 300 W", price: 749, watts: 300, is: { vramGb: 16 }, specs: [["Video memory", "16 GB GDDR7"], ["Typical power", "300 W"], ["Power plug", "16-pin"]] },
  { id: "g-5080", category: "gpu", name: "NVIDIA GeForce RTX 5080", spec: "16 GB, about 360 W", price: 999, watts: 360, is: { vramGb: 16 }, specs: [["Video memory", "16 GB GDDR7"], ["Typical power", "360 W"], ["Power plug", "16-pin"]] },

  { id: "c-9700x", category: "cpu", name: "AMD Ryzen 7 9700X", spec: "8 cores, AM5, 65 W", price: 299, watts: 65, is: { socket: "AM5", minBios: "2024-07", cores: 8 }, specs: [["Socket", "AM5"], ["Cores", "8 cores, 16 threads"], ["Typical power", "65 W"]] },
  { id: "c-9800x3d", category: "cpu", name: "AMD Ryzen 7 9800X3D", spec: "8 cores, AM5, 120 W", price: 449, watts: 120, is: { socket: "AM5", minBios: "2024-10", cores: 8 }, specs: [["Socket", "AM5"], ["Cores", "8 cores, 16 threads"], ["Typical power", "120 W"]] },
  { id: "c-9950x3d", category: "cpu", name: "AMD Ryzen 9 9950X3D", spec: "16 cores, AM5, 170 W", price: 649, watts: 170, is: { socket: "AM5", minBios: "2025-03", cores: 16 }, specs: [["Socket", "AM5"], ["Cores", "16 cores, 32 threads"], ["Typical power", "170 W"]] },
  { id: "c-14700k", category: "cpu", name: "Intel Core i7-14700K", spec: "20 cores, LGA1700, 125 W", price: 339, watts: 125, is: { socket: "LGA1700", cores: 20 }, specs: [["Socket", "LGA1700"], ["Cores", "20 cores, 28 threads"], ["Typical power", "125 W"]] },

  { id: "k-pa120se", category: "cooler", name: "Thermalright Peerless Assassin 120 SE", spec: "Air, 155 mm tall", price: 35, is: { heightMm: 155, sockets: ["AM5", "AM4", "LGA1700", "LGA1851"] }, specs: [["Kind", "Air, two towers"], ["Height", "155 mm"], ["Sockets", "AM5, AM4, LGA1700, LGA1851"]] },
  { id: "k-nhd15g2", category: "cooler", name: "Noctua NH-D15 G2", spec: "Air, 168 mm tall", price: 149, is: { heightMm: 168, sockets: ["AM5", "AM4", "LGA1700", "LGA1851"] }, specs: [["Kind", "Air, two towers"], ["Height", "168 mm"], ["Sockets", "AM5, AM4, LGA1700, LGA1851"]] },
  { id: "k-lf3-360", category: "cooler", name: "Arctic Liquid Freezer III 360", spec: "Liquid, 360 mm radiator", price: 109, is: { radiatorMm: 360, sockets: ["AM5", "AM4", "LGA1700", "LGA1851"] }, specs: [["Kind", "Liquid"], ["Radiator", "360 mm"], ["Sockets", "AM5, AM4, LGA1700, LGA1851"]] },

  { id: "f-p14-5", category: "fans", name: "Arctic P14 PWM PST, 5 pack", spec: "140 mm", price: 34, is: { fanMm: 140, count: 5 }, specs: [["Size", "140 mm"], ["In the box", "5 fans"], ["Plug", "4-pin PWM, daisy-chain"]] },
  { id: "f-nfa12", category: "fans", name: "Noctua NF-A12x25 PWM", spec: "120 mm", price: 33, is: { fanMm: 120, count: 1 }, specs: [["Size", "120 mm"], ["In the box", "1 fan"], ["Plug", "4-pin PWM"]] },

  { id: "p-cx650", category: "psu", name: "Corsair CX650", spec: "650 W, 80 Plus Bronze", price: 69, is: { psuW: 650 }, specs: [["Wattage", "650 W"], ["Efficiency", "80 Plus Bronze"], ["Size", "ATX"]] },
  { id: "p-pp12m-750", category: "psu", name: "be quiet! Pure Power 12 M 750 W", spec: "750 W, 80 Plus Gold", price: 99, is: { psuW: 750 }, specs: [["Wattage", "750 W"], ["Efficiency", "80 Plus Gold"], ["Size", "ATX 3.0"]] },
  { id: "p-rm850x", category: "psu", name: "Corsair RM850x", spec: "850 W, 80 Plus Gold", price: 134, is: { psuW: 850 }, specs: [["Wattage", "850 W"], ["Efficiency", "80 Plus Gold"], ["Size", "ATX 3.1"]] },
  { id: "p-rm1000x", category: "psu", name: "Corsair RM1000x", spec: "1000 W, 80 Plus Gold", price: 179, is: { psuW: 1000 }, specs: [["Wattage", "1000 W"], ["Efficiency", "80 Plus Gold"], ["Size", "ATX 3.1"]] },
];

/** A steady pseudo-random number from a string, so demo prices don't jump between loads. */
function seeded(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function demoItem(b: Base): ShopItem {
  const r = seeded(b.id);
  // Twelve weekly lows walking toward today's price.
  const history: number[] = [];
  let p = b.price * (1 + (r() - 0.3) * 0.18);
  for (let i = 0; i < 11; i++) { history.push(Math.round(p)); p += (b.price - p) * 0.25 + (r() - 0.5) * b.price * 0.05; }
  history.push(b.price);
  const offers = demoShops.map((shop, i) => ({ shop, price: i === 0 ? b.price : Math.round(b.price * (1.03 + r() * 0.12)), inStock: i === 0 || r() > 0.3 }));
  // The cheapest shop changes from part to part.
  const turn = Math.floor(r() * 3);
  const shops = offers.map((o, i) => ({ ...o, shop: demoShops[(i + turn) % 3] })).sort((a, z) => a.price - z.price);
  return { id: b.id, category: b.category, name: b.name, maker: makerOf(b.name), spec: b.spec, specs: b.specs, watts: b.watts, is: b.is, offers: shops, history };
}

export const demoCatalog: ShopItem[] = base.map(demoItem);

/** The brand at the start of a product name. A real feed gives the brand itself. */
export function makerOf(name: string): string {
  if (/^be quiet!/i.test(name)) return "be quiet!";
  if (/^WD[_ ]/i.test(name)) return "WD";
  if (/^G\.?Skill/i.test(name)) return "G.Skill";
  return name.split(/\s+/)[0] ?? name;
}

const squash = (s: string) => s.toLowerCase().replace(/×/g, "x").replace(/[\s_()-]+/g, "");

/**
 * Whether a part matches what someone typed: every word has to appear in its
 * name, maker, kind, spec line or specs. "32gb ddr5" matches "32 GB" and "DDR5-6000".
 */
export function matchesQuery(item: ShopItem, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const kind = shopCategories.find((c) => c.key === item.category)?.label ?? "";
  const text = [item.name, item.maker, kind, item.spec, ...item.specs.map(([k, v]) => `${k} ${v}`), item.is.partNumber ?? ""].join(" ");
  const plain = text.toLowerCase();
  const tight = squash(text);
  return words.every((w) => plain.includes(w) || tight.includes(squash(w)));
}

/** The makers among some parts, most parts first, then by name. */
export function makersIn(items: ShopItem[]): { maker: string; count: number }[] {
  const n = new Map<string, number>();
  for (const i of items) n.set(i.maker, (n.get(i.maker) ?? 0) + 1);
  return [...n].map(([maker, count]) => ({ maker, count })).sort((a, b) => b.count - a.count || a.maker.localeCompare(b.maker));
}

/** The parts that could go in this PC, with demo prices. */
export function shopFor(inv: Inventory, retail?: { from: string; hits: Map<string, Retail> }): Shop {
  if (!retail) return { demo: true, facts: hardwareFacts(inv), items: demoCatalog };
  const items = demoCatalog.map((i) => { const r = retail.hits.get(i.id); return r ? { ...i, retail: r } : i; });
  return { demo: items.some((i) => !i.retail), retailFrom: retail.from, facts: hardwareFacts(inv), items };
}

/** The price to show and add up: the real one when there is one, else the lowest demo price. */
export const priceOf = (i: ShopItem) => i.retail?.price ?? i.offers[0].price;

/** The photo to show: the item's own, else its listing's. */
export const photoOf = (i: ShopItem) => i.image ?? i.retail?.image;

/** Words that change which part a model number means: a 5070 Ti isn't a 5070. */
const variants = ["ti", "xt", "xtx", "super", "x3d", "pro", "plus", "evo"];
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * How to look a part up in a shop's search, and what a result's name must hold
 * to count as the same part. Sizes and model numbers have to match, so a 32 GB
 * kit never borrows a 64 GB kit's photo or price.
 */
export function retailTerms(item: ShopItem): { search: string[]; must: string[]; not: string[] } {
  const base = item.name.replace(/\(.*?\)/g, " ").replace(/,.*$/, "");
  const sizes = [...base.matchAll(/(\d+(?:\.\d+)?)\s*(GB|TB|W|mm)\b/gi)].map((m) => `${m[1]}${m[2]}`.toLowerCase());
  const makerWords = item.maker.split(/[^A-Za-z0-9]+/).map(flat).filter(Boolean);
  const words = base.replace(/(\d+(?:\.\d+)?)\s*(GB|TB|W|mm)\b/gi, " ").split(/\s+/).map(flat)
    .filter((w) => w && !makerWords.includes(w) && !/^(pwm|pst|m)$/.test(w));
  // A model number takes the variant word after it: "5070 Ti" is "5070ti", "990 PRO" is "990pro".
  const model: string[] = [];
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (/\d/.test(w) && variants.includes(words[k + 1])) { model.push(w + words[k + 1]); k++; } else model.push(w);
  }
  // One-letter or one-digit words, like the 7 in "Ryzen 7", match anything, so they don't count.
  const must = [...new Set([...model.filter((w) => w.length > 1), ...sizes, ...(item.is.ddr ? [`ddr${item.is.ddr}`] : [])])];
  // A bare model number mustn't match its variants.
  const not = model.filter((w) => /\d{3,}/.test(w) && !variants.some((v) => w.endsWith(v))).flatMap((w) => variants.map((v) => w + v));
  const search = [...new Set([...makerWords, ...item.name.replace(/\(.*?\)/g, " ").split(/[^A-Za-z0-9]+/).map(flat)])]
    .filter((w) => w.length > 1 && !/^(gb|tb|mm|pwm|pst|pack)$/.test(w) && !/^\d+$/.test(w) || /^\d{3,}$/.test(w));
  return { search, must, not };
}

/** Whether a shop's product is the same part as ours, by the terms above. */
export function sameRetailPart(item: ShopItem, name: string, manufacturer?: string): boolean {
  const theirs = flat(`${manufacturer ?? ""} ${name}`);
  const t = retailTerms(item);
  // The first size named is the total: a "64GB (2 x 32GB)" kit also says 32GB.
  const first = (s: string) => s.replace(/\(.*?\)/g, " ").match(/(\d+(?:\.\d+)?)\s*(GB|TB)\b/i)?.slice(1, 3).join("").toLowerCase();
  const size = first(item.name);
  return theirs.includes(flat(item.maker).slice(0, 4)) && t.must.every((w) => theirs.includes(w)) && !t.not.some((w) => theirs.includes(w))
    && (!size || first(name) === size);
}
