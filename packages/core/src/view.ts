// Builds the PC view the screens draw from the helper's raw inventory and
// readings. Runs on the desktop for the live view and on the server for the
// web view, so both always agree.

import type { FanReading, HistoryPoint, Issue, Part, PC, Reading, Stat, StorageSlice } from "./model";
import { cpuLimit, cpuTemp, findings, gpuLimit, gpuTemp, score, summaryLine, type Finding, type HealthInput } from "./health";
import { findSensor, type Inventory, type Sensor, type Snapshot, type StorageScan, type SystemFacts } from "./telemetry";
import { driveMaps } from "./drives";

export interface Identity { name?: string; accent?: string; cleanedAt?: string }

/** Highest value seen per sensor id since midnight. Kept by whoever owns the live feed. */
export type DayMax = Record<string, number>;

export const defaultAccent = "#EA5A72";

const chipMaker: Record<Inventory["gpus"][number]["vendor"], string | undefined> = { nvidia: "NVIDIA", amd: "AMD", intel: "Intel", other: undefined };

const round = (v: number | null | undefined) => (v == null ? undefined : Math.round(v));
const gb = (mb: number) => Math.round(mb / 1024);
const ghz = (mhz: number | null | undefined) => (mhz == null ? undefined : `${(mhz / 1000).toFixed(2)} GHz`);

function maxOf(snap: Snapshot | null, pick: (s: Sensor) => boolean): number | undefined {
  const v = snap?.sensors.filter((s) => pick(s) && s.value != null).map((s) => s.value!) ?? [];
  return v.length ? Math.max(...v) : undefined;
}

function prettyName(host: string): string {
  // DESKTOP-4KF2J9 means nobody named it. Use something friendlier until they do.
  return /^(DESKTOP|LAPTOP)-[A-Z0-9]+$/i.test(host) ? "My PC" : host;
}

/** Which part a sensor is filed under, as a key of PC.parts: the graphics card only for the card Rig shows, case and laptop fans under Fans. */
function partOf(s: Sensor, laptop: boolean, gpuName: string | undefined): string | null {
  if (s.hw === "gpu") return s.hwName === gpuName ? "gpu" : null;
  if (s.type === "fan" || s.type === "control" || s.hw === "cooler") return "fans";
  switch (s.hw) {
    case "cpu": return "cpu";
    case "board": return laptop ? "board" : "motherboard";
    case "memory": return "ram";
    case "storage": return "ssd";
    case "battery": return "battery";
    case "psu": return "psu";
    default: return null;
  }
}

/**
 * The PC's readings right now, in the shape of a history point, so a chart can draw a live line with
 * the same code as the logged history. Temperatures and fan are the highest now; loads as they read.
 */
export function livePoint(pc: PC, t: number): HistoryPoint {
  const p = pc.parts ?? {};
  const fans = (pc.readings ?? []).filter((r) => r.type === "fan" && r.part === "fans" && r.value != null).map((r) => r.value!);
  const drives = (pc.readings ?? []).filter((r) => r.type === "temperature" && r.part === "ssd" && r.value != null).map((r) => r.value!);
  const n = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  return {
    t, busy: false, game: null,
    cpu: n(p.cpu?.temp), gpu: n(p.gpu?.temp), cpuLoad: n(p.cpu?.load), gpuLoad: n(p.gpu?.load), mem: n(p.ram?.load),
    drive: drives.length ? Math.round(Math.max(...drives)) : n(p.ssd?.temp), board: n((p.motherboard ?? p.board)?.temp),
    fan: fans.length ? Math.round(Math.max(...fans)) : null,
  };
}

/** What else the checks can read: Windows events (the crash checks run only when these are given) and recorded history. */
export type Evidence = Pick<HealthInput, "events" | "history" | "now"> & {
  /** The helper's last folder scan, for what fills each drive. Missing: the map shows used and free only. */
  scan?: StorageScan | null;
};

export function buildPC(inv: Inventory, snap: Snapshot | null, facts: SystemFacts | null, id: Identity = {}, dayMax: DayMax = {}, more: Evidence = {}): PC & { findings: Finding[] } {
  const laptop = inv.machine.kind === "laptop";
  const parts: Record<string, Part> = {};
  const { scan, ...evidence } = more;
  const fs = findings({ inv, snap, facts, ...evidence });
  const cpuLim = cpuLimit(inv.cpu.name, snap);
  const warnPart = new Set(fs.filter((f) => f.severity === "warn" || f.severity === "bad").map((f) => f.part).filter(Boolean));

  // Processor
  const ct = cpuTemp(snap);
  const cpuLoad = findSensor(snap, "cpu", "load", /total/i);
  const cpuClock = maxOf(snap, (s) => s.hw === "cpu" && s.type === "clock" && /core/i.test(s.name));
  const cpuFan = findSensor(snap, "board", "fan", /cpu|#1/i) ?? findSensor(snap, "cooler", "fan");
  parts.cpu = {
    name: inv.cpu.name, type: laptop ? "Processor" : "Processor and cooler", modelSource: "generic",
    temp: round(ct?.value), tempMax: ct ? round(Math.max(dayMax[ct.id] ?? 0, ct.value ?? 0)) : undefined, limit: cpuLim,
    load: round(cpuLoad?.value), clock: ghz(cpuClock), fan: laptop ? undefined : round(cpuFan?.value),
    warn: warnPart.has("cpu"),
    specs: [["Cores", `${inv.cpu.cores} cores, ${inv.cpu.threads} threads`], ...(inv.cpu.maxClockMhz ? [["Top speed", ghz(inv.cpu.maxClockMhz)!] as [string, string]] : []), ["Safe limit", `${cpuLim}°C`]],
    manual: [],
  };

  // Graphics
  const dgpu = inv.gpus.find((g) => !g.integrated) ?? inv.gpus[0];
  if (dgpu && (!laptop || !dgpu.integrated)) {
    const gt = gpuTemp(snap);
    parts.gpu = {
      name: dgpu.name, type: "Graphics card", modelSource: "generic",
      // Windows names the chip, not the exact card; the card's own maker isn't known yet.
      maker: chipMaker[dgpu.vendor], model: dgpu.name.replace(/^(NVIDIA|AMD|Intel)(\(R\))?\s+/i, ""),
      temp: round(gt?.value), tempMax: gt ? round(Math.max(dayMax[gt.id] ?? 0, gt.value ?? 0)) : undefined, limit: gpuLimit(dgpu.vendor),
      load: round(findSensor(snap, "gpu", "load", /core|d3d 3d/i)?.value), clock: ghz(findSensor(snap, "gpu", "clock", /core/i)?.value),
      fan: round(findSensor(snap, "gpu", "fan")?.value), warn: warnPart.has("gpu"),
      specs: [...(dgpu.vramMb ? [["Memory", `${gb(dgpu.vramMb)} GB`] as [string, string]] : []), ["Safe limit", `${gpuLimit(dgpu.vendor)}°C`]],
      manual: [],
      driver: dgpu.driverVersion ? { installed: `${dgpu.vendor === "nvidia" ? "NVIDIA" : dgpu.vendor === "amd" ? "AMD" : "Driver"} ${dgpu.driverVersion}`, note: dgpu.driverDate ? `Installed ${dgpu.driverDate}.` : "" } : undefined,
    };
  }

  // Board
  const boardTemp = findSensor(snap, "board", "temperature", /system|motherboard|board/i) ?? findSensor(snap, "board", "temperature");
  const boardPart: Part = {
    name: `${inv.board.manufacturer} ${inv.board.product}`.trim(), type: "Motherboard", modelSource: "generic",
    maker: inv.board.manufacturer || undefined, model: inv.board.product || undefined,
    temp: round(boardTemp?.value), tempMax: boardTemp ? round(Math.max(dayMax[boardTemp.id] ?? 0, boardTemp.value ?? 0)) : undefined,
    specs: [["BIOS", inv.board.biosVersion + (inv.board.biosDate ? ` (${inv.board.biosDate})` : "")]],
    manual: [],
    driver: { installed: `BIOS ${inv.board.biosVersion}`, note: inv.board.biosDate ? `From ${inv.board.biosDate}.` : "" },
  };
  if (laptop) parts.board = boardPart; else parts.motherboard = boardPart;

  // Memory
  const m = inv.memory;
  const memLoad = findSensor(snap, "memory", "load", /memory$|^memory/i);
  const memUsed = findSensor(snap, "memory", "data", /used/i);
  const memTemp = findSensor(snap, "memory", "temperature");
  const speed = m.modules.find((x) => x.speedMhz)?.speedMhz;
  parts.ram = {
    name: m.modules.length > 1 && m.modules.every((x) => x.capacityMb === m.modules[0].capacityMb)
      ? `${m.modules.length} × ${gb(m.modules[0].capacityMb)} GB${m.modules[0].manufacturer ? ` ${m.modules[0].manufacturer}` : ""}`
      : `${gb(m.totalMb)} GB`,
    type: "Memory", modelSource: "generic", temp: round(memTemp?.value), load: round(memLoad?.value),
    specs: [
      ["Total", `${gb(m.totalMb)} GB`],
      ...(speed ? [["Speed", `${speed} MT/s`] as [string, string]] : []),
      ...(m.slotsTotal ? [["Slots used", `${m.modules.length} of ${m.slotsTotal}`] as [string, string]] : []),
      ...(memUsed?.value != null ? [["In use", `${memUsed.value.toFixed(1)} GB`] as [string, string]] : []),
    ],
    manual: [],
  };

  // Storage: the system drive
  const disk = inv.disks.find((d) => d.media === "nvme") ?? inv.disks[0];
  if (disk) {
    // The drive shown, not whichever drive reported first.
    const mine = (x: Sensor) => x.hwName.trim().toLowerCase() === disk.model.trim().toLowerCase();
    const st = snap?.sensors.find((x) => x.hw === "storage" && x.type === "temperature" && x.value != null && mine(x) && /^(composite |)temperature$/i.test(x.name))
      ?? snap?.sensors.find((x) => x.hw === "storage" && x.type === "temperature" && x.value != null && mine(x))
      ?? findSensor(snap, "storage", "temperature");
    const sys = inv.volumes.find((v) => v.letter.startsWith("C")) ?? inv.volumes[0];
    parts.ssd = {
      name: disk.model, type: "Storage", modelSource: "generic", temp: round(st?.value), tempMax: st ? round(Math.max(dayMax[st.id] ?? 0, st.value ?? 0)) : undefined,
      warn: warnPart.has("ssd"),
      specs: [
        ["Size", disk.sizeGb >= 1000 ? `${(disk.sizeGb / 1000).toFixed(1)} TB` : `${Math.round(disk.sizeGb)} GB`],
        ["Type", { nvme: "NVMe SSD", ssd: "SATA SSD", hdd: "Hard drive", unknown: "Drive" }[disk.media]],
        ...(disk.healthPercent != null ? [["Life left", `${disk.healthPercent}%`] as [string, string]] : []),
        ...(disk.status ? [["Windows health check", { healthy: "Healthy", warning: "Warning", unhealthy: "Failing" }[disk.status]] as [string, string]] : []),
        ...(disk.writtenTb != null ? [["Written so far", `${disk.writtenTb.toFixed(1)} TB`] as [string, string]] : []),
        ...(sys ? [["Free", `${Math.round(sys.freeGb)} GB on ${sys.letter}`] as [string, string]] : []),
      ],
      manual: [],
    };
  }

  // Fans
  const fanSensors = snap?.sensors.filter((s) => s.type === "fan" && (s.value ?? 0) > 0) ?? [];
  const fans: FanReading[] = fanSensors.map((s) => ({ label: s.hw === "gpu" ? "Graphics" : s.name.replace(/^Fan #?/, "Fan "), rpm: Math.round(s.value!), max: Math.max(2000, Math.round(s.max ?? 0)) }));
  parts.fans = {
    name: laptop ? "Laptop fans" : "Case fans", type: "Cooling", modelSource: "generic",
    fan: fans.length ? Math.round(fans.reduce((n, f) => n + f.rpm, 0) / fans.length) : undefined,
    specs: fans.length ? fans.map((f) => [f.label, `${f.rpm.toLocaleString("en-US")} rpm`] as [string, string]) : [["Fans", "No fan speeds reported"]],
    manual: [],
  };

  if (laptop) {
    parts.chassis = { name: `${inv.machine.manufacturer} ${inv.machine.model}`.trim(), type: "Laptop", modelSource: "generic", maker: inv.machine.manufacturer || undefined, model: inv.machine.model || undefined, specs: [["Maker", inv.machine.manufacturer], ["Model", inv.machine.model]], manual: [] };
    const b = inv.battery;
    if (b) {
      const wear = b.designWh && b.fullWh ? Math.round((b.fullWh / b.designWh) * 100) : undefined;
      parts.battery = {
        name: b.designWh ? `${Math.round(b.designWh)} Wh battery` : "Battery", type: "Battery", modelSource: "generic", warn: warnPart.has("battery"),
        specs: [...(wear != null ? [["Capacity now", `${b.fullWh!.toFixed(1)} Wh (${wear}%)`] as [string, string]] : []), ...(b.cycles != null ? [["Cycles", String(b.cycles)] as [string, string]] : [])],
        manual: [],
      };
    }
  } else {
    parts.case = { name: "Your case", type: "Case", modelSource: "generic", specs: [["Model", "Not set yet. Add it in Customize so Rig can find its manual."]], manual: [] };
    const psuPower = findSensor(snap, "psu", "power");
    parts.psu = { name: "Power supply", type: "Power supply", modelSource: "generic", specs: psuPower?.value != null ? [["Drawing now", `${Math.round(psuPower.value)} W`]] : [["Model", "Not set yet"]], manual: [] };
  }

  // Tiles
  const stats: Stat[] = [];
  if (parts.cpu.temp != null) stats.push({ label: "CPU", value: parts.cpu.temp, unit: "°C", note: parts.cpu.load != null ? `${parts.cpu.load}% busy` : "", warn: parts.cpu.warn });
  if (laptop && inv.battery?.designWh && inv.battery.fullWh) stats.push({ label: "Battery", value: Math.round((inv.battery.fullWh / inv.battery.designWh) * 100), unit: "%", note: "of original capacity" });
  else if (parts.gpu?.temp != null) stats.push({ label: "GPU", value: parts.gpu.temp, unit: "°C", note: snap?.game ? `in ${snap.game}` : parts.gpu.load != null ? `${parts.gpu.load}% busy` : "", warn: parts.gpu.warn });
  const totalGb = inv.volumes.reduce((n, v) => n + v.sizeGb, 0);
  const freeGb = inv.volumes.reduce((n, v) => n + v.freeGb, 0);
  if (totalGb > 0) stats.push({ label: "Storage", value: Math.round(((totalGb - freeGb) / totalGb) * 100), unit: "%", note: `${Math.round(totalGb - freeGb)} of ${Math.round(totalGb)} GB used` });
  if (memLoad?.value != null) stats.push({ label: "Memory", value: Math.round(memLoad.value), unit: "%", note: memUsed?.value != null ? `${memUsed.value.toFixed(1)} of ${gb(m.totalMb)} GB in use` : "" });

  const slices: StorageSlice[] = inv.volumes.map((v) => ({ label: v.label ? `${v.letter} ${v.label}` : v.letter, gb: Math.round(v.sizeGb - v.freeGb) }));
  slices.push({ label: "Free", gb: Math.round(freeGb) });

  const drives = new Set(snap?.sensors.filter((x) => x.hw === "storage").map((x) => x.hwName));
  const readings: Reading[] = (snap?.sensors ?? []).flatMap((x) => {
    const part = partOf(x, laptop, dgpu?.name);
    if (!part || !parts[part] || x.value == null) return [];
    const top = Math.max(x.max ?? -Infinity, dayMax[x.id] ?? -Infinity, x.value);
    return [{ id: x.id, part, name: x.hw === "storage" && drives.size > 1 ? `${x.hwName} ${x.name}` : x.name, type: x.type, value: x.value, min: x.min ?? null, max: top }];
  });

  const { health, breakdown } = score(laptop, fs, more.events != null);
  const issues: Issue[] = fs.length ? fs : [{ id: "all-good", severity: "ok", title: "Nothing needs a look", body: "Temperatures, storage and settings all look normal.", action: "Ask Rig anything", go: "chat" }];

  return {
    id: inv.machine.id,
    name: id.name || prettyName(inv.machine.hostname),
    kind: inv.machine.kind,
    accent: id.accent || defaultAccent,
    nickname: laptop ? `${inv.machine.manufacturer} laptop` : "Desktop",
    os: `${inv.machine.os.name} ${inv.machine.os.version}`.trim(),
    health, breakdown,
    seenAt: snap ? new Date(snap.at).toISOString() : undefined,
    lastSync: "Live on this PC",
    online: true,
    summary: summaryLine(health, fs),
    stats, issues, fans,
    storage: { slices, totalGb: Math.round(totalGb) },
    drives: driveMaps(inv, scan, snap),
    model: { source: "generic", label: laptop ? "Built from your laptop's size" : "Built from your parts' sizes" },
    parts,
    settings: facts ? { gameMode: facts.gameMode, visualEffects: facts.visualEffects, powerPlans: facts.powerPlans, startupOn: facts.startupApps.filter((a) => a.enabled).length } : undefined,
    cleanedAt: id.cleanedAt,
    readings,
    board: laptop ? undefined : {
      memory: m.modules.map((x) => ({ slot: x.slot, gb: gb(x.capacityMb), mts: x.speedMhz, maker: x.manufacturer, partNumber: x.partNumber })),
      memorySlots: m.slotsTotal,
      drives: inv.disks.map((d) => ({ model: d.model, media: d.media, sizeGb: Math.round(d.sizeGb) })),
      gpu: inv.gpus.find((g) => !g.integrated)?.name,
      fans: (snap?.sensors ?? []).filter((x) => x.hw === "board" && x.type === "fan").map((x) => ({ id: x.id, name: x.name })),
    },
    gpuSubsys: dgpu && !dgpu.integrated && dgpu.subsysVendor ? { vendor: dgpu.subsysVendor, id: dgpu.subsysId } : undefined,
    displays: inv.displays.map((d) => ({
      name: d.name, width: d.width, height: d.height, refreshHz: d.refreshHz, connection: d.connection,
      onCard: d.gpu && dgpu && !dgpu.integrated ? d.gpu === dgpu.name : undefined,
    })),
    findings: fs,
  };
}
