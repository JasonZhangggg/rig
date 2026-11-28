// The checks that need more than one temperature against one limit: the
// graphics card's hot spot and memory, drive health and heat, memory speed
// and channels, firmware with known fixes, heat at rest over days, and the
// crashes, sudden shutdowns, driver resets and hardware errors Windows logged,
// each read alongside what the PC's readings were doing at the time.
//
// Every finding says what it rests on (evidence) and how sure Rig is
// (confidence), so the chat can explain it and the person can check it.
// Pure, so the desktop, the demo and the tests agree.

import type { SleepLog } from "./sleeps";
import type { HistoryPoint, Issue } from "./model";
import type { PCEvent } from "./recordings";
import { describeChange, memoryTest, type PCChange } from "./changes";
import { machineWord } from "./machineWord";
import type { Inventory, Snapshot, SystemFacts } from "./telemetry";
import { cardChip, cpuLimit, driveTemp, gpuHotSpot, gpuLimit, gpuLoad, gpuMemTemp, gpuTemp, hotSpotLimit } from "./limits";

export interface Finding extends Issue { category: string; weight: number }

export interface HealthInput {
  inv: Inventory;
  snap: Snapshot | null;
  facts: SystemFacts | null;
  /** Windows events from the last few weeks, any order. Leave out when they weren't read: the crash checks then don't run. */
  events?: readonly PCEvent[];
  /** Recorded history windows, any order. Used to tell what the PC was doing when something happened. */
  history?: readonly HistoryPoint[];
  /** Milliseconds since epoch. Defaults to the reading's time, then the clock. */
  now?: number;
  /** A laptop's sleeps and wakes from the background recorder, for how much battery each sleep used (sleeps.ts). */
  sleep?: SleepLog;
}

export const STABILITY = "Crashes and errors";

const MIN = 60_000;
const DAY = 864e5;
const round = Math.round;

type Add = (f: Omit<Finding, "id"> & { id: string }) => void;

// ----- Dates -----

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Mar 2026" or "Oct 22, 2026" (how the helper writes BIOS and driver dates) as UTC milliseconds. Null when it isn't one. */
export function parseDate(s: string | null | undefined): number | null {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/.exec((s ?? "").trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  return month < 0 ? null : Date.UTC(+m[3], month, m[2] ? +m[2] : 1);
}

// ----- Graphics card -----

/** A hot spot this much over the core, under load, means the cooler isn't pressing evenly or the paste has dried out. */
export const HOTSPOT_GAP = 30;
/** GDDR6X slows itself down at 110°C; at 100°C it's worth a look. */
export const VRAM_WARM = 100;

function graphics({ inv, snap }: HealthInput, add: Add) {
  const gpu = inv.gpus.find((g) => !g.integrated);
  if (!gpu || !snap) return;
  const chip = cardChip(inv);
  const core = gpuTemp(snap, chip)?.value, hot = gpuHotSpot(snap, chip)?.value, mem = gpuMemTemp(snap, chip)?.value;
  const load = gpuLoad(snap, chip)?.value;
  const hotLim = hotSpotLimit(gpu.vendor);
  const laptop = inv.machine.kind === "laptop";
  if (hot != null && hot >= hotLim - 3) {
    add({
      id: "gpu-hotspot-hot", category: "Temperatures", weight: 25, severity: "bad", part: "gpu", confidence: "sure",
      title: `Graphics card's hot spot is at ${round(hot)}°C`,
      body: laptop
        ? `Its hottest point slows the graphics down at about ${hotLim}°C. Keep the vents clear and use it on a hard, flat surface; if it keeps happening, dust in the fans or old paste is the usual cause.`
        : `Its hottest point slows the card down at about ${hotLim}°C. Clean the card's fans and give it room to breathe; if it keeps happening, the cooler needs fresh paste or pads.`,
      evidence: [`Hot spot ${round(hot)}°C, limit about ${hotLim}°C`, ...(core != null ? [`Core ${round(core)}°C`] : [])],
      action: "Ask what to do", go: "chat", ask: `My graphics card's hot spot is at ${round(hot)}°C. What should I do?`,
    });
  } else if (hot != null && core != null && load != null && load >= 70 && hot - core >= HOTSPOT_GAP) {
    add({
      id: "gpu-hotspot-gap", category: "Temperatures", weight: 12, severity: "warn", part: "gpu", confidence: "likely",
      title: `Graphics card's hot spot runs ${round(hot - core)}° above its core`,
      body: `A gap this wide under load usually means the cooler isn't pressing evenly on the chip or its thermal paste has dried out. Under warranty, the ${laptop ? "laptop's" : "card's"} maker can repaste it.`,
      evidence: [`Core ${round(core)}°C, hot spot ${round(hot)}°C at ${round(load)}% load`, `A healthy card stays within about 10 to 25° under load`],
      action: "Ask about it", go: "chat", ask: `My graphics card's hot spot is ${round(hot - core)}° hotter than its core under load. Is the paste bad?`,
    });
  }
  if (mem != null && mem >= VRAM_WARM) {
    add({
      id: "gpu-vram-hot", category: "Temperatures", weight: 12, severity: mem >= 108 ? "bad" : "warn", part: "gpu", confidence: "sure",
      title: `Graphics card memory is at ${round(mem)}°C`,
      body: laptop
        ? "Its memory chips slow down at about 110°C. Clear vents and a hard, flat surface under the laptop help."
        : "Its memory chips slow down at about 110°C. Better case airflow helps; on some cards new thermal pads drop it by 10 to 20°.",
      evidence: [`Memory ${round(mem)}°C${load != null ? ` at ${round(load)}% load` : ""}`],
      action: "Ask what to do", go: "chat", ask: `My graphics card's memory runs at ${round(mem)}°C. Is that a problem?`,
    });
  }
}

// ----- Drives -----

/** Life left, as the drive reports it, below which it's wearing out and critical. Alerts use the same lines. */
export const WEAR_LOW = 20;
export const WEAR_CRITICAL = 10;

/** Where each kind of drive starts to slow itself down or wear faster, in °C. */
export const DRIVE_WARM = { nvme: 75, ssd: 65, hdd: 55, unknown: 70 } as const;

function drives({ inv, snap }: HealthInput, add: Add) {
  const laptop = inv.machine.kind === "laptop";
  for (const d of inv.disks) {
    const name = d.model;
    if (d.status === "unhealthy" || d.status === "warning") {
      const bad = d.status === "unhealthy";
      add({
        id: `disk-status-${name}`, category: "Storage", weight: bad ? 45 : 30, severity: bad ? "bad" : "warn", part: "ssd", confidence: "sure",
        title: bad ? `Windows says ${name} is failing` : `Windows reports a problem with ${name}`,
        body: bad ? "The drive's own self-test says it may stop working. Back up anything important now and replace it." : "The drive's self-test flagged a problem. Back up what matters and keep an eye on it.",
        evidence: [`Windows storage health: ${d.status}`, ...(d.healthPercent != null ? [`Life left: ${d.healthPercent}%`] : [])],
        action: "See upgrades", go: "upgrades",
      });
    }
    // NVMe drives report spare blocks left and the line the maker says is too few.
    const own = snap?.sensors.filter((s) => s.hw === "storage" && s.hwName.trim().toLowerCase() === name.trim().toLowerCase()) ?? [];
    const spare = own.find((s) => s.type === "level" && /^available spare$/i.test(s.name))?.value;
    const floor = own.find((s) => s.type === "level" && /available spare threshold/i.test(s.name))?.value;
    if (spare != null && floor != null && floor > 0 && spare <= floor) {
      add({
        id: `disk-spare-${name}`, category: "Storage", weight: 40, severity: "bad", part: "ssd", confidence: "sure",
        title: `${name} has run out of spare space`,
        body: "It replaces worn-out blocks from a reserve, and that reserve is used up. Back up now and replace the drive.",
        evidence: [`Spare left ${round(spare)}%, maker's minimum ${round(floor)}%`],
        action: "See upgrades", go: "upgrades",
      });
    }
    const temp = driveTemp(snap, name)?.value;
    const warm = DRIVE_WARM[d.media];
    if (temp != null && temp >= warm) {
      add({
        id: `disk-hot-${name}`, category: "Temperatures", weight: 10, severity: temp >= warm + 10 ? "bad" : "warn", part: "ssd", confidence: "sure",
        title: `${name} is at ${round(temp)}°C`,
        body: laptop
          ? `${d.media === "hdd" ? "Hard drives wear faster above about 50°C." : "It slows itself down when it gets this hot."} Keep the vents clear and use the laptop on a hard, flat surface.`
          : d.media === "hdd" ? "Hard drives wear faster above about 50°C. A case fan blowing across it fixes most of this." : "It slows itself down when it gets this hot. A heatsink or the board's drive cover, and some airflow over it, usually fixes it.",
        evidence: [`Drive ${round(temp)}°C, ${{ nvme: "NVMe drives", ssd: "SATA SSDs", hdd: "hard drives", unknown: "drives" }[d.media]} start to slow or wear faster around ${warm}°C`],
        action: "Ask about it", go: "chat", ask: `My drive ${name} is at ${round(temp)}°C. Is that too hot?`,
      });
    }
  }
}

// ----- Memory -----

/**
 * The speed a memory kit is sold at, from its part number, in MT/s. Only the
 * makers whose part numbers say it plainly; null for the rest, and for plain
 * modules that run at the standard speed anyway.
 */
export function ratedSpeed(partNumber: string | null | undefined): number | null {
  const p = (partNumber ?? "").trim().toUpperCase();
  let m: RegExpExecArray | null;
  if ((m = /^F[45]-(\d{4})/.exec(p))) return +m[1]; // G.Skill: F4-3600C16-8GTZNC, F5-6000J3038F16G
  if ((m = /^CM\w+?M\d[A-Z](\d{4})[A-Z]\d{2}/.exec(p))) return +m[1]; // Corsair: CMK32GX5M2B6000C30
  if ((m = /^(?:KF|HX)(\d{3})C/.exec(p))) return +m[1] * 10; // Kingston Fury and HyperX: KF560C36BBE-16, HX436C17PB3/16
  if ((m = /^BL(?:\d+K)?\d+G(\d{2})C/.exec(p))) return +m[1] * 100; // Crucial Ballistix: BL2K16G36C16U4B
  if ((m = /(\d{4})HC\d{2}/.exec(p))) return +m[1]; // TeamGroup: TF3D416G3200HC16F01
  return null;
}

/** The memory's rated speed and the speed it runs at, when it runs well below the rating. Null when it's fine or Rig can't tell. */
export function slowMemory(inv: Inventory): { rated: number; running: number } | null {
  const speeds = inv.memory.modules.map((m) => m.speedMhz).filter((v): v is number => !!v);
  const rated = Math.max(0, ...inv.memory.modules.map((m) => ratedSpeed(m.partNumber) ?? 0));
  if (!speeds.length || !rated) return null;
  const running = Math.min(...speeds);
  // Some boards report the clock (half the transfer rate): 1800 for a 3600 kit is running at full speed.
  if (Math.abs(running * 2 - rated) <= rated * 0.06) return null;
  return rated >= running * 1.12 ? { rated, running } : null;
}

/** The memory runs at its kit's rated (XMP or EXPO) speed, above the standard one. */
export function memoryOverclocked(inv: Inventory): boolean {
  const speeds = inv.memory.modules.map((m) => m.speedMhz).filter((v): v is number => !!v);
  if (!speeds.length) return false;
  const running = Math.min(...speeds);
  const ddr5 = running >= 4000;
  return running > (ddr5 ? 5600 : 3200);
}

function memory({ inv }: HealthInput, add: Add) {
  if (inv.machine.kind !== "tower") return;
  const slow = slowMemory(inv);
  if (slow) {
    add({
      id: "mem-slow", category: "Startup and speed", weight: 8, severity: "info", part: "ram", confidence: "likely",
      title: `Memory runs at ${slow.running} MT/s but is rated for ${slow.rated}`,
      body: `Turning on its profile in the BIOS (XMP on Intel boards, EXPO or DOCP on AMD) runs it at full speed, which helps games most. Rig can't change BIOS settings, but can show you where it is.`,
      evidence: [`Running at ${slow.running} MT/s`, `Part number ${inv.memory.modules.find((m) => ratedSpeed(m.partNumber) === slow.rated)?.partNumber} is sold as ${slow.rated} MT/s`],
      action: "Show me how", go: "chat", ask: `My memory runs at ${slow.running} MT/s but is rated for ${slow.rated}. How do I turn on XMP or EXPO on my board?`,
    });
  }
  const mods = inv.memory.modules;
  if (mods.length === 1 && (inv.memory.slotsTotal ?? 0) >= 2) {
    add({
      id: "mem-single", category: "Startup and speed", weight: 5, severity: "info", part: "ram", confidence: "likely",
      title: "Memory runs on one channel",
      body: "With one stick, the processor reads memory at half the speed it could. A second matching stick in the right slot (see the board's manual) helps games and built-in graphics most.",
      evidence: [`1 memory stick in ${inv.memory.slotsTotal} slots`],
      action: "See upgrades", go: "upgrades",
    });
  }
}

// ----- Firmware and drivers -----

/** Intel's 13th and 14th gen desktop processors that need the 2024 microcode fix against slowly becoming unstable. */
export const intelVmin = (cpu: string) => /i[579]-1[34]\d{3}(K|KF|KS|F)?\b/i.test(cpu);
/** Intel's fix (microcode 0x12B) reached boards from September 2024. */
export const INTEL_FIX = Date.UTC(2024, 8, 1);
/** AMD's fix for Ryzen 7000 chips damaged by high SoC voltage (AGESA 1.0.0.7) reached boards from May 2023. */
export const AM5_FIX = Date.UTC(2023, 4, 1);
const am5Early = (cpu: string) => /Ryzen \d+ 7\d{3}(X3D|X)?\b/i.test(cpu);

function firmware({ inv }: HealthInput, now: number, add: Add) {
  const bios = parseDate(inv.board.biosDate);
  const tower = inv.machine.kind === "tower";
  if (tower && bios != null && intelVmin(inv.cpu.name) && bios < INTEL_FIX) {
    add({
      id: "bios-intel-fix", category: "Drivers and updates", weight: 25, severity: "warn", part: "motherboard", confidence: "likely",
      title: "Update the BIOS to protect this processor",
      body: "Intel's 13th and 14th gen processors can slowly become unstable on older BIOS versions. Intel's fix comes as a BIOS update from the board's maker; install the newest one.",
      evidence: [`Processor: ${inv.cpu.name}`, `BIOS ${inv.board.biosVersion} from ${inv.board.biosDate}, before Intel's fix in September 2024`],
      action: "Show me how", go: "chat", ask: `How do I update the BIOS on my ${inv.board.manufacturer} ${inv.board.product} to get Intel's fix for 13th and 14th gen processors?`,
    });
  }
  if (tower && bios != null && am5Early(inv.cpu.name) && bios < AM5_FIX) {
    add({
      id: "bios-am5-fix", category: "Drivers and updates", weight: 25, severity: "warn", part: "motherboard", confidence: "likely",
      title: "Update the BIOS to protect this processor",
      body: "BIOS versions from before May 2023 could give Ryzen 7000 processors too much voltage, which damaged some X3D chips. The board maker's newest BIOS fixes it.",
      evidence: [`Processor: ${inv.cpu.name}`, `BIOS ${inv.board.biosVersion} from ${inv.board.biosDate}, before AMD's fix in May 2023`],
      action: "Show me how", go: "chat", ask: `How do I update the BIOS on my ${inv.board.manufacturer} ${inv.board.product}?`,
    });
  }
  const gpu = inv.gpus.find((g) => !g.integrated);
  const drv = parseDate(gpu?.driverDate);
  if (gpu && drv != null && now - drv > 365 * DAY) {
    add({
      id: "gpu-driver-old", category: "Drivers and updates", weight: 4, severity: "info", part: "gpu", confidence: "sure",
      title: "Graphics driver is over a year old",
      body: "Newer drivers fix crashes and speed up recent games. Get the latest from the card's maker.",
      evidence: [`Driver ${gpu.driverVersion ?? ""} from ${gpu.driverDate}`.replace("  ", " ")],
      action: "Ask about it", go: "chat", ask: "How do I update my graphics driver safely?",
    });
  }
}

// ----- Heat at rest, over days -----

/** Windows Rig needs before it calls a pattern in the history. */
const MIN_WINDOWS = 12;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function restingHeat({ inv, snap, history }: HealthInput, now: number, add: Add) {
  if (!history?.length) return;
  const lim = cpuLimit(inv.cpu.name, snap);
  const laptop = inv.machine.kind === "laptop";
  const quiet = history.filter((p) => !p.busy && p.cpu != null && p.t <= now && now - p.t < 3 * DAY && (p.cpuLoad == null || p.cpuLoad <= 10));
  if (quiet.length < MIN_WINDOWS) return;
  const usual = round(median(quiet.map((p) => p.cpu!)));
  if (usual < lim - (laptop ? 12 : 20)) return;
  add({
    id: "cpu-hot-idle", category: "Temperatures", weight: 15, severity: "warn", part: "cpu", confidence: "likely",
    title: `Processor runs hot even at rest`,
    body: laptop
      ? `With nothing heavy running it still peaks around ${usual}°C. Dust in the fan and vents is the usual cause on a laptop.`
      : `With nothing heavy running it still peaks around ${usual}°C, where most desktops stay under 60°C. Dried-out paste, a cooler that isn't seated well or a failing pump are the usual causes.`,
    evidence: [`Usual peak at rest over the last ${quiet.length} quiet ten-minute windows: ${usual}°C`, `Limit ${lim}°C`],
    action: "Ask what to do", go: "chat", ask: `My processor peaks around ${usual}°C even when nothing heavy is running. Why?`,
  });
}

// ----- Windows events -----

/** Windows stop codes, grouped by what they usually point at. */
export const stopCodes: Record<number, { name: string; points: StopGroup }> = {
  0x124: { name: "WHEA_UNCORRECTABLE_ERROR", points: "hardware" },
  0x101: { name: "CLOCK_WATCHDOG_TIMEOUT", points: "hardware" },
  0x9c: { name: "MACHINE_CHECK_EXCEPTION", points: "hardware" },
  0x7f: { name: "UNEXPECTED_KERNEL_MODE_TRAP", points: "hardware" },
  0x1a: { name: "MEMORY_MANAGEMENT", points: "memory" },
  0x4e: { name: "PFN_LIST_CORRUPT", points: "memory" },
  0x12b: { name: "FAULTY_HARDWARE_CORRUPTED_PAGE", points: "memory" },
  0x50: { name: "PAGE_FAULT_IN_NONPAGED_AREA", points: "memory" },
  0x116: { name: "VIDEO_TDR_FAILURE", points: "graphics" },
  0x117: { name: "VIDEO_TDR_TIMEOUT_DETECTED", points: "graphics" },
  0x119: { name: "VIDEO_SCHEDULER_INTERNAL_ERROR", points: "graphics" },
  0x10e: { name: "VIDEO_MEMORY_MANAGEMENT_INTERNAL", points: "graphics" },
  0x141: { name: "VIDEO_ENGINE_TIMEOUT_DETECTED", points: "graphics" },
  0x7a: { name: "KERNEL_DATA_INPAGE_ERROR", points: "storage" },
  0x77: { name: "KERNEL_STACK_INPAGE_ERROR", points: "storage" },
  0xf4: { name: "CRITICAL_OBJECT_TERMINATION", points: "storage" },
  0x24: { name: "NTFS_FILE_SYSTEM", points: "storage" },
  0xed: { name: "UNMOUNTABLE_BOOT_VOLUME", points: "storage" },
  0x7b: { name: "INACCESSIBLE_BOOT_DEVICE", points: "storage" },
  0xd1: { name: "DRIVER_IRQL_NOT_LESS_OR_EQUAL", points: "driver" },
  0x0a: { name: "IRQL_NOT_LESS_OR_EQUAL", points: "driver" },
  0x3b: { name: "SYSTEM_SERVICE_EXCEPTION", points: "driver" },
  0x7e: { name: "SYSTEM_THREAD_EXCEPTION_NOT_HANDLED", points: "driver" },
  0x1e: { name: "KMODE_EXCEPTION_NOT_HANDLED", points: "driver" },
  0xc4: { name: "DRIVER_VERIFIER_DETECTED_VIOLATION", points: "driver" },
  0x133: { name: "DPC_WATCHDOG_VIOLATION", points: "driver" },
  0x9f: { name: "DRIVER_POWER_STATE_FAILURE", points: "driver" },
  0x139: { name: "KERNEL_SECURITY_CHECK_FAILURE", points: "driver" },
};
export type StopGroup = "hardware" | "memory" | "graphics" | "storage" | "driver";

/** The stop code in a blue screen event's message ("The bugcheck was: 0x00000124 (...)"). */
export function stopCode(message: string): number | null {
  const m = /bug ?check (?:was|code)?:?\s*(0x[0-9a-f]+)/i.exec(message) ?? /\b(0x[0-9a-f]{8,16})\b/i.exec(message);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const isBlueScreen = (e: PCEvent) => e.kind === "crash" && /bugcheck|systemerrorreporting/i.test(e.source);

/** Events joined into incidents: ones less than `gapMs` apart are one. Oldest first. */
function incidents<T extends { t: number }>(list: readonly T[], gapMs: number): T[][] {
  const out: T[][] = [];
  for (const e of [...list].sort((a, b) => a.t - b.t)) {
    const run = out[out.length - 1];
    if (run && e.t - run[run.length - 1].t <= gapMs) run.push(e);
    else out.push([e]);
  }
  return out;
}

/** What the PC was doing in the half hour before a moment, from its history. */
function before(history: readonly HistoryPoint[], t: number, lim: { cpu: number; gpu: number }) {
  const pts = history.filter((p) => p.t <= t && t - p.t <= 30 * MIN);
  if (!pts.length) return null;
  const hot = pts.find((p) => (p.cpu ?? -Infinity) >= lim.cpu - 6 || (p.gpu ?? -Infinity) >= lim.gpu - 6);
  return {
    hot: hot ? ((hot.gpu ?? -Infinity) >= lim.gpu - 6 ? "graphics card" as const : "processor" as const) : null,
    busy: pts.some((p) => p.busy || (p.gpuLoad ?? 0) >= 60),
    game: pts.map((p) => p.game).find((g) => !!g) ?? null,
  };
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

const crashAdvice: Record<StopGroup, string> = {
  hardware: "The crash codes point at the hardware: most often an overclock, undervolt or memory speed that isn't stable, or a processor that needs a BIOS update.",
  memory: "The crash codes point at memory. Windows Memory Diagnostic tests it, and if memory runs at its rated XMP or EXPO speed, trying the standard speed for a few days is the quickest check.",
  graphics: "The crash codes point at the graphics driver. A clean install of the newest driver fixes most of these; if not, check the card's temperatures and power cables.",
  storage: "The crash codes point at a drive Windows reads from. Back up, then check the drive's health and its cable.",
  driver: "The crash codes point at a driver. Updating the chipset, graphics, network and audio drivers fixes most of these.",
};
/** A laptop's graphics have no power cables to check. */
const LAPTOP_GRAPHICS_CRASH = "The crash codes point at the graphics driver. A clean install of the newest driver fixes most of these; if not, check the graphics temperatures.";

const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** The latest change in the three days before trouble first showed, when the log reaches back far enough to show the week before was quiet. */
function startedAfter(events: readonly PCEvent[], first: number | undefined, fits: (c: PCChange) => boolean = () => true): PCChange | null {
  if (first == null || !events.length) return null;
  const oldest = Math.min(...events.map((e) => e.t));
  return events
    .map((e) => (e.kind === "change" ? describeChange(e) : null))
    .filter((c): c is PCChange => !!c && c.t <= first && first - c.t <= 3 * DAY && c.t - oldest >= 7 * DAY && fits(c))
    .sort((a, b) => b.t - a.t)[0] ?? null;
}

/** One sentence tying trouble to the change before it, and how to test that. */
function afterChange(c: PCChange, first: number, one: boolean) {
  const gap = first - c.t;
  const within = gap < DAY ? "hours" : gap < 2 * DAY ? "a day" : `${Math.round(gap / DAY)} days`;
  const undo = c.type === "update" ? "Uninstalling it (Settings, Windows Update, Update history) is a quick test." : c.type === "driver" ? "Going back to the previous driver is a quick test." : "Removing it for a few days is a quick test.";
  return {
    body: `${one ? "It came" : "They started"} ${within} after ${c.what} was installed on ${day(c.t)}. ${undo}`,
    evidence: `First one ${within} after ${c.what} was installed (${day(c.t)})`,
  };
}

/** Driver files that belong to the graphics driver, whatever app loads them. */
const GRAPHICS_DLL = /^(nvwgf2umx?|nvoglv(32|64)|nvd3dumx?|nvgpucomp(32|64)|nvcuda|nvapi(64)?|atiumd\w*|amdxx(32|64)|atiuxp?(64)?|amdvlk(32|64)|aticfx(32|64)|atidxx(32|64)|igd10\w*|igd12\w*|igc(32|64)|igxelpicd(32|64)|ig\d+icd(32|64)|igdusc(32|64))\.dll$/i;
/** Windows' own core files, which every app loads. */
const SYSTEM_DLL = /^(ntdll|kernelbase|ucrtbase|msvcrt|combase|kernel32|user32|win32u)\.dll$/i;
/** Add-ons that load into games to draw an overlay or capture them. */
const ADDONS: [RegExp, string][] = [
  [/^rtsshooks/i, "RivaTuner's on-screen display (part of MSI Afterburner)"],
  [/^discordhook/i, "Discord's in-game overlay"],
  [/^gameoverlayrenderer/i, "Steam's in-game overlay"],
  [/^(nvspcap|nvcamera|nvappoverlay)/i, "NVIDIA's in-game overlay"],
  [/^(graphics-hook|obs-vulkan|obs-opengl)/i, "OBS's game capture"],
  [/^igo(32|64)/i, "the EA app's in-game overlay"],
  [/^(overwolf|owclient)/i, "Overwolf"],
  [/^(uplay_r1|overlay64)/i, "Ubisoft Connect's overlay"],
  [/^medal/i, "Medal's recorder"],
];

const appOf = (m: string) => /faulting application name:?\s+([^\s,]+)/i.exec(m)?.[1];
const moduleOf = (m: string) => /faulting module name:?\s+([^\s,]+)/i.exec(m)?.[1];

function appCrashes({ inv }: HealthInput, events: readonly PCEvent[], fortnight: readonly PCEvent[], add: Add) {
  const list = fortnight
    .filter((e) => e.kind === "crash" && /^application error$/i.test(e.source))
    .map((e) => ({ t: e.t, app: appOf(e.message), mod: moduleOf(e.message) }))
    .filter((x): x is { t: number; app: string; mod: string } => !!x.app && !!x.mod && x.app.toLowerCase() !== x.mod.toLowerCase());
  const groups = new Map<string, typeof list>();
  for (const x of list) groups.set(x.mod.toLowerCase(), [...(groups.get(x.mod.toLowerCase()) ?? []), x]);
  const allFirst = (mod: string) => events.filter((e) => e.kind === "crash" && moduleOf(e.message)?.toLowerCase() === mod).map((e) => e.t).sort((a, b) => a - b)[0];
  const names = (g: typeof list) => [...new Set(g.map((x) => x.app.replace(/\.exe$/i, "")))];
  let shown = 0;
  for (const [mod, g] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    if (shown >= 2) break;
    const apps = names(g), file = g[0].mod, n = g.length;
    const evidence = [`${n} app crashes in 14 days inside ${file}`, `${apps.length === 1 ? "App" : "Apps"}: ${apps.slice(0, 4).join(", ")}${apps.length > 4 ? ` and ${apps.length - 4} more` : ""}`];
    const addon = ADDONS.find(([re]) => re.test(mod))?.[1];
    if (GRAPHICS_DLL.test(mod) && n >= 3) {
      const first = allFirst(mod), c = startedAfter(events, first, (x) => x.graphics || x.type === "update"), why = c && afterChange(c, first, false);
      add({
        id: "app-crash-graphics", category: STABILITY, weight: 15, severity: "warn", part: "gpu", confidence: apps.length >= 2 || c ? "likely" : "possible",
        title: apps.length >= 2 ? `Games and apps crashed ${times(n)} in the graphics driver` : `${apps[0]} crashed ${times(n)} in the graphics driver`,
        body: [`Each crash was inside the graphics driver's own files (${file}), so the driver is the likely cause, not the ${apps.length >= 2 ? "apps" : "app"}.`, why ? why.body : "A clean install of the newest driver fixes most of these; remove any graphics overclock while you test."].join(" "),
        evidence: [...evidence, ...(why ? [why.evidence] : [])],
        action: "Ask what to do", go: "chat", ask: `My games keep crashing in ${file}, which is the graphics driver. How do I fix it?`,
      });
      shown++;
    } else if (SYSTEM_DLL.test(mod) && apps.length >= 3 && n >= 4) {
      add({
        id: "app-crash-system", category: STABILITY, weight: 12, severity: "warn", confidence: "possible",
        title: `${apps.length} different apps crashed inside Windows itself`,
        body: `When unrelated apps crash in the same Windows file (${file}), unstable memory or damaged system files are the usual cause. Test memory with Windows Memory Diagnostic${memoryOverclocked(inv) ? ", try the standard memory speed for a few days" : ""}, and have Windows repair its own files with sfc /scannow in an admin terminal.`,
        evidence,
        action: "Ask what to do", go: "chat", ask: `Several different apps keep crashing in ${file}. Is it my memory or Windows?`,
      });
      shown++;
    } else if (addon && n >= 2) {
      add({
        id: `app-crash-addon-${mod}`, category: STABILITY, weight: 12, severity: "warn", confidence: "likely",
        title: `${apps.length >= 2 ? "Apps" : apps[0]} crashed ${times(n)} in ${addon}`,
        body: `${addon[0].toUpperCase()}${addon.slice(1)} loads into games to draw on top of them, and every one of these crashes was inside it (${file}). Update it, or turn it off for a few days, and see if the crashes stop.`,
        evidence,
        action: "Ask about it", go: "chat", ask: `My games keep crashing in ${file}. Should I turn off that overlay?`,
      });
      shown++;
    } else if (!SYSTEM_DLL.test(mod) && !GRAPHICS_DLL.test(mod) && apps.length >= 2 && n >= 3) {
      add({
        id: `app-crash-module-${mod}`, category: STABILITY, weight: 10, severity: "warn", confidence: "possible",
        title: `${apps.length} apps crashed in the same file, ${file}`,
        body: "It isn't part of those apps, so it's likely an add-on, overlay or security tool that loads into them. Find which program installed it, then update it or turn it off for a few days.",
        evidence,
        action: "Ask about it", go: "chat", ask: `Different apps keep crashing in ${file}. What is it?`,
      });
      shown++;
    }
  }
}

function stability(input: HealthInput, now: number, add: Add) {
  const { inv, snap, events, history = [] } = input;
  if (!events) return;
  const recent = (days: number) => events.filter((e) => e.t <= now && now - e.t < days * DAY);
  const gpu = inv.gpus.find((g) => !g.integrated);
  const lim = { cpu: cpuLimit(inv.cpu.name, snap), gpu: gpu ? gpuLimit(gpu.vendor) : Infinity };
  const fortnight = recent(14);
  const lastMemoryTest = events.filter((e) => memoryTest(e) != null).sort((a, b) => b.t - a.t)[0] ?? null;

  if (lastMemoryTest && memoryTest(lastMemoryTest) === "failed") {
    add({
      id: "mem-test-failed", category: STABILITY, weight: 40, severity: "bad", part: "ram", confidence: "sure",
      title: "Windows' memory test found errors",
      body: memoryOverclocked(inv)
        ? "Memory that fails this test causes crashes and damaged files. Set memory to its standard speed in the BIOS and run the test again. If it still fails, test one stick at a time to find the bad one."
        : "Memory that fails this test causes crashes and damaged files. Test one stick at a time to find the bad one; most memory has a lifetime warranty.",
      evidence: [`Windows Memory Diagnostic on ${day(lastMemoryTest.t)}: errors found`],
      action: "Ask what to do", go: "chat", ask: "Windows' memory test found errors. What should I do?",
    });
  }
  appCrashes(input, events, fortnight, add);

  // Blue screens, one per crash (Windows logs each from two sources).
  const crashes = incidents(fortnight.filter(isBlueScreen), 10 * MIN);
  const codes = crashes.map((c) => c.map((e) => stopCode(e.message)).find((v) => v != null) ?? null);
  if (crashes.length) {
    const groups = codes.map((c) => (c != null ? stopCodes[c]?.points : undefined)).filter((g): g is StopGroup => !!g);
    const top = (["hardware", "memory", "graphics", "storage", "driver"] as const).map((g) => [g, groups.filter((x) => x === g).length] as const).sort((a, b) => b[1] - a[1])[0];
    const lead = top[1] > 0 ? top[0] : null;
    const named = codes.filter((c): c is number => c != null).map((c) => `0x${c.toString(16).toUpperCase()}${stopCodes[c] ? ` ${stopCodes[c].name}` : ""}`);
    const extra = lead === "hardware" || lead === "memory"
      ? [memoryOverclocked(inv) ? "Memory runs above the standard speed, which is a common cause." : "", intelVmin(inv.cpu.name) ? "This processor also needs Intel's BIOS fix if the BIOS predates September 2024." : ""].filter(Boolean).join(" ")
      : "";
    const allCrashes = incidents(events.filter(isBlueScreen), 10 * MIN);
    const first = allCrashes[0]?.[0].t;
    const change = startedAfter(events, first, lead === "graphics" ? (c) => c.graphics || c.type === "update" : undefined);
    const why = change && first != null ? afterChange(change, first, crashes.length === 1) : null;
    const test = lead === "memory" || lead === "hardware" ? lastMemoryTest : null;
    const testLine = test ? (memoryTest(test) === "failed" ? "Windows' memory test found errors, so memory is the likely cause." : `Windows' memory test passed on ${day(test.t)}, which makes failing memory less likely, though it can miss a memory speed that's only just unstable.`) : "";
    add({
      id: "crashes", category: STABILITY, weight: Math.min(40, 20 + (crashes.length - 1) * 10), severity: crashes.length >= 2 || lead === "hardware" ? "bad" : "warn",
      confidence: (lead && top[1] >= 2 && top[1] === groups.length) || (test && memoryTest(test) === "failed") ? "likely" : "possible",
      title: crashes.length === 1 ? "Windows crashed with a blue screen" : `Windows crashed ${times(crashes.length)} in two weeks`,
      body: [lead ? (inv.machine.kind === "laptop" && lead === "graphics" ? LAPTOP_GRAPHICS_CRASH : crashAdvice[lead]) : "Ask Rig to read the crash codes and what was running.", testLine || extra, why?.body ?? ""].filter(Boolean).join(" "),
      evidence: [
        `${crashes.length} blue screen${crashes.length === 1 ? "" : "s"} in the last 14 days`, ...[...new Set(named)].slice(0, 4).map((c) => `Stop code ${c}`),
        ...(test ? [`Windows Memory Diagnostic on ${day(test.t)}: ${memoryTest(test) === "failed" ? "errors found" : "no errors"}`] : []),
        ...(why ? [why.evidence] : []),
      ],
      action: "Ask why", go: "chat", ask: `Windows crashed ${times(crashes.length)} recently${named.length ? ` (${[...new Set(named)].slice(0, 3).join(", ")})` : ""}. What's causing it?`,
    });
  }

  // Sudden power-offs, apart from the ones a blue screen caused.
  const offs = incidents(fortnight.filter((e) => e.kind === "shutdown"), 10 * MIN)
    .filter((run) => !crashes.some((c) => Math.abs(c[0].t - run[0].t) <= 15 * MIN));
  if (offs.length) {
    const word = machineWord(inv.machine.kind);
    const seen = offs.map((run) => before(history, run[0].t, lim));
    const known = seen.filter((s): s is NonNullable<typeof s> => !!s);
    const hot = known.filter((s) => s.hot);
    const loaded = known.filter((s) => s.busy && !s.hot);
    if (hot.length) {
      const part = hot.filter((s) => s.hot === "graphics card").length >= hot.length / 2 ? "graphics card" : "processor";
      add({
        id: "shutdowns-hot", category: STABILITY, weight: 35, severity: "bad", part: part === "graphics card" ? "gpu" : "cpu", confidence: "likely",
        title: `The ${word} shut off suddenly while running hot`,
        body: `${hot.length === offs.length ? "Each time" : `${hot.length} of ${offs.length} times`}, the ${part} was near its limit just before. That's what a ${word} does to protect itself from heat. Clean the dust out and check that every fan spins.`,
        evidence: [`${offs.length} sudden shutdown${offs.length === 1 ? "" : "s"} in 14 days`, `${hot.length} came within half an hour of the ${part} reaching ${part === "graphics card" ? lim.gpu - 6 : lim.cpu - 6}°C or more`],
        action: "Ask what to do", go: "chat", ask: `My ${word} shut off suddenly while it was running hot. What should I do?`,
      });
    } else if (offs.length >= 2 && loaded.length >= 2 && loaded.length === known.length) {
      const game = loaded.map((s) => s.game).find((g) => !!g);
      add({
        id: "shutdowns-load", category: STABILITY, weight: 30, severity: "bad", part: inv.machine.kind === "tower" ? "psu" : undefined, confidence: "likely",
        title: `The ${word} shut off ${times(offs.length)} under load`,
        body: inv.machine.kind === "laptop"
          ? `It was working hard${game ? ` (${game})` : ""} but nothing was hot, which points at power: a charger that can't keep up, a loose charger plug, or a worn battery. Use the charger that came with the laptop, plugged in firmly.`
          : `It was working hard${game ? ` (${game})` : ""} but nothing was hot, which points at power: a power supply that can't keep up with the graphics card's spikes, or a loose power cable to the card. Check the card's power cables first.`,
        evidence: [`${offs.length} sudden shutdowns in 14 days`, `${loaded.length} came while busy, with temperatures normal`],
        action: "Ask what to do", go: "chat", ask: inv.machine.kind === "laptop" ? `My laptop shuts off suddenly while gaming but nothing is hot. Is it the charger or the battery?` : `My PC shuts off suddenly while gaming but nothing is hot. Is it my power supply?`,
      });
    } else if (offs.length >= 2) {
      add({
        id: "shutdowns", category: STABILITY, weight: 20, severity: "warn", confidence: "possible",
        title: `The ${word} turned off without shutting down ${times(offs.length)}`,
        body: inv.machine.kind === "laptop"
          ? "Holding the power button, a battery that ran flat and a failing charger all look like this. If you didn't do it, Rig can record what happens next time."
          : "Power cuts, holding the power button and a failing power supply all look like this. If you didn't do it, Rig can record what happens next time.",
        evidence: [`${offs.length} sudden shutdowns in 14 days`, known.length ? "Temperatures were normal before each one Rig has history for" : "Rig has no readings from just before them"],
        action: "Ask about it", go: "chat", ask: `My ${word} turned off without shutting down ${times(offs.length)}. Why?`,
      });
    }
  }

  // Graphics driver resets this week.
  const resets = incidents(recent(7).filter((e) => e.kind === "driver"), 2 * MIN);
  if (resets.length >= 3) {
    const seen = resets.map((r) => {
      const pts = history.filter((p) => Math.abs(p.t - r[0].t) <= 15 * MIN);
      return pts.length ? pts.some((p) => (p.gpu ?? -Infinity) >= lim.gpu - 6) : null;
    });
    const hot = seen.filter((v) => v === true).length, cool = seen.filter((v) => v === false).length;
    const first = incidents(events.filter((e) => e.kind === "driver"), 2 * MIN)[0]?.[0].t;
    const change = hot > cool ? null : startedAfter(events, first, (c) => c.graphics || c.type === "update");
    const why = change && first != null ? afterChange(change, first, false) : null;
    add({
      id: "driver-resets", category: STABILITY, weight: 15, severity: "warn", part: "gpu", confidence: hot > cool || cool > hot || why ? "likely" : "possible",
      title: `The graphics driver stopped and recovered ${times(resets.length)} this week`,
      body: hot > cool
        ? inv.machine.kind === "laptop" ? "Most came while the graphics were near their limit, so heat is the likely cause. Keep the vents clear and clean the dust out of the fans." : "Most came while the card was near its limit, so heat is the likely cause. Clean its fans and check case airflow."
        : why
          ? `${cool > hot ? "The card wasn't hot when they happened. " : ""}${why.body}`
          : cool > hot
          ? "The card wasn't hot when they happened, so the driver itself or an overclock is more likely. A clean driver install, and removing any overclock, fixes most of these."
          : "A clean driver install fixes most of these. If they keep coming, Rig can record what the card does next time.",
      evidence: [`${resets.length} driver resets in 7 days`, ...(hot + cool ? [`${hot} while the card was hot, ${cool} while it was cool`] : []), ...(why ? [why.evidence] : [])],
      action: "Ask what to do", go: "chat", ask: "My graphics driver keeps crashing and recovering. How do I fix it?",
    });
  }

  // Hardware errors. Uncorrected ones are serious; corrected ones matter when they keep coming.
  const whea = fortnight.filter((e) => e.kind === "hardware");
  const fatal = whea.filter((e) => e.level !== "warning");
  const corrected = whea.filter((e) => e.level === "warning" && now - e.t < 7 * DAY);
  if (fatal.length) {
    add({
      id: "whea-fatal", category: STABILITY, weight: 30, severity: "bad", confidence: "possible",
      title: "Hardware reported an error it couldn't correct",
      body: "This usually comes from an unstable overclock, memory speed or voltage, or a failing part. Undo any overclock and run Windows Memory Diagnostic first.",
      evidence: [`${fatal.length} uncorrectable hardware error${fatal.length === 1 ? "" : "s"} in 14 days`, ...[...new Set(fatal.map((e) => `WHEA-Logger ${e.id}`))].slice(0, 3)],
      action: "Ask why", go: "chat", ask: "Windows logged an uncorrectable hardware error (WHEA). What's failing?",
    });
  } else if (corrected.length >= 10) {
    const pcie = corrected.filter((e) => e.id === 17).length >= corrected.length / 2;
    add({
      id: "whea-corrected", category: STABILITY, weight: 8, severity: "info", confidence: "possible",
      title: `Hardware corrected ${corrected.length} errors this week`,
      body: pcie
        ? inv.machine.kind === "laptop" ? "They come from a PCIe link, usually the graphics or an NVMe drive. A BIOS update from the laptop's maker usually stops them." : "They come from a PCIe link, usually the graphics card or an NVMe drive. Reseating the card, skipping a riser cable, or setting the slot's PCIe generation in the BIOS usually stops them."
        : "The processor or memory keeps fixing its own errors. Nothing has crashed yet, but an unstable overclock, undervolt or memory speed is the usual cause.",
      evidence: [`${corrected.length} corrected hardware errors in 7 days`, `Mostly WHEA-Logger ${pcie ? "17 (PCIe)" : [...new Set(corrected.map((e) => e.id))].slice(0, 3).join(", ")}`],
      action: "Ask about it", go: "chat", ask: `Windows keeps logging corrected hardware errors (WHEA${pcie ? " 17, PCIe" : ""}). Should I worry?`,
    });
  }

  // A drive that keeps reporting read errors or retries.
  const disk = fortnight.filter((e) => e.kind === "disk");
  const badBlocks = disk.filter((e) => /^disk$/i.test(e.source) && (e.id === 7 || e.id === 51)).length;
  if (badBlocks >= 1 || disk.length >= 5) {
    add({
      id: "disk-errors", category: "Storage", weight: badBlocks ? 30 : 15, severity: badBlocks ? "bad" : "warn", part: "ssd", confidence: badBlocks ? "likely" : "possible",
      title: badBlocks ? "A drive reported bad blocks" : "A drive keeps reporting problems",
      body: badBlocks
        ? "Windows couldn't read part of a drive. Back up what matters now, then check the drive's health; a loose or worn cable can cause this on SATA drives."
        : "Windows had to retry or reset a drive several times. A loose cable, a power-saving setting or a failing drive cause this. Back up, and keep an eye on it.",
      evidence: [`${disk.length} drive events in 14 days`, ...(badBlocks ? [`${badBlocks} bad block or paging errors (disk 7 or 51)`] : [])],
      action: "Ask about it", go: "chat", ask: "Windows keeps logging drive errors. Is my drive failing?",
    });
  }
}

/** Every check in this file, for one reading of the PC. */
export function diagnose(input: HealthInput, add: Add) {
  const now = input.now ?? input.snap?.at ?? Date.now();
  graphics(input, add);
  drives(input, add);
  memory(input, add);
  firmware(input, now, add);
  for (const f of slowChecks(input, now)) add(f);
}

/** How long the checks over days of history and weeks of Windows events may reuse their answer while nothing they read changed. */
export const SLOW_CHECKS_MS = 60_000;

type Found = Parameters<Add>[0];
interface SlowEntry { inv: HealthInput["inv"]; events: HealthInput["events"]; history: HealthInput["history"]; length: number; last: number | undefined; lim: number; at: number; found: Found[] }
const slow = new WeakMap<object, SlowEntry>();

/**
 * The checks that read the history and the Windows events. They're the costly part of a reading, and their inputs change only every few
 * minutes (history every ten, events every five), so the answer is kept until the inventory, the events, the history or the processor's
 * limit changes, or a minute has passed.
 */
function slowChecks(input: HealthInput, now: number): Found[] {
  const { inv, events, history } = input;
  const lim = cpuLimit(inv.cpu.name, input.snap);
  const key = events ?? history ?? inv;
  const e = slow.get(key);
  if (e && e.inv === inv && e.events === events && e.history === history && e.length === (history?.length ?? 0) && e.last === history?.[history.length - 1]?.t && e.lim === lim && now >= e.at && now - e.at < SLOW_CHECKS_MS) return e.found;
  const found: Found[] = [];
  restingHeat(input, now, (f) => found.push(f));
  stability(input, now, (f) => found.push(f));
  slow.set(key, { inv, events, history, length: history?.length ?? 0, last: history?.[history.length - 1]?.t, lim, at: now, found });
  return found;
}
