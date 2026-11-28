// What the Windows helper (helper/RigHelper) reports. These shapes are the
// contract between the C# helper, the Rust core and the UI, so change them in
// all three places at once. The helper writes JSON with camelCase names.

import type { SecurityFacts } from "./safety";

export type PCKind = "tower" | "laptop";

export interface Inventory {
  machine: {
    /** Stable id for this PC, from the Windows machine GUID (hashed). */
    id: string;
    hostname: string;
    manufacturer: string;
    model: string;
    kind: PCKind;
    os: { name: string; version: string; build: string };
  };
  cpu: { name: string; cores: number; threads: number; maxClockMhz?: number };
  gpus: { name: string; vendor: "nvidia" | "amd" | "intel" | "other"; /** PCI subsystem vendor and id ("1da2", "e445"): the card's maker and its exact model. Missing from older helpers. */ subsysVendor?: string; subsysId?: string; vramMb?: number; driverVersion?: string; driverDate?: string; integrated: boolean }[];
  board: { manufacturer: string; product: string; biosVersion: string; biosDate?: string };
  memory: {
    totalMb: number; slotsTotal?: number;
    modules: {
      manufacturer?: string; partNumber?: string; capacityMb: number; speedMhz?: number; slot?: string;
      /** Windows' FormFactor for the module (8 a DIMM stick, 12 a SO-DIMM stick, 9, 14, 21 and 22 chips on the board). Missing from older helpers and when Windows doesn't say. */
      formFactor?: number;
      /** The SMBIOS memory type (26 DDR4, 34 DDR5, 27 to 30 and 35 the low-power LPDDR kinds). Missing from older helpers and when Windows doesn't say. */
      smbiosType?: number;
    }[];
  };
  disks: Disk[];
  volumes: Volume[];
  battery?: { designWh?: number; fullWh?: number; cycles?: number };
  displays: {
    name: string; width: number; height: number; refreshHz: number; maxRefreshHz: number; primary: boolean;
    /** The kind of plug on the computer's side, from Windows' display paths. Missing from older helpers. */
    connection?: DisplayConnection;
    /** Windows' name for the graphics that drive this screen ("NVIDIA GeForce RTX 4070 SUPER", "AMD Radeon(TM) Graphics"). Missing from older helpers. */
    gpu?: string;
  }[];
}

export interface Disk {
  model: string;
  sizeGb: number;
  media: "nvme" | "ssd" | "hdd" | "unknown";
  /** Life left, as the drive reports it (NVMe "Percentage Used", or Windows' wear counter). */
  healthPercent?: number;
  writtenTb?: number;
  /** Windows' own verdict from the drive's self-test (SMART). Missing from helpers before 0.1.5. */
  status?: "healthy" | "warning" | "unhealthy";
  /** Windows' disk number, which volumes point at. Missing from helpers before 0.1.8. */
  number?: number;
  /** Hours the drive has been powered on, from Windows' reliability counters (admin only). */
  powerOnHours?: number;
  /** Read and write errors the drive couldn't correct, from the same counters. */
  errors?: number;
}

export interface Volume {
  letter: string;
  label?: string;
  sizeGb: number;
  freeGb: number;
  /** The disk number of the drive it's on (Disk.number). Missing from helpers before 0.1.8, and for a volume spread over several drives. */
  disk?: number;
}

/** What Rig sorts a drive's used space into. Whatever isn't counted is "other" on screen. */
export type FillKind = "windows" | "apps" | "games" | "files" | "system";

/**
 * What fills each volume, from the helper's folder scan (`storage`). The scan walks folders at low priority in the
 * background and is kept on disk for a day, so asking only returns what it last found and, if that's stale, starts another.
 */
export interface StorageScan {
  /** When the last scan finished, ms since 1970. Missing: none has finished yet. */
  at?: number;
  /** A scan is running now. */
  running: boolean;
  volumes: {
    letter: string;
    fills: { kind: FillKind; gb: number; /** The biggest things in it (games by name, your folders), largest first, at most five. */ top?: { name: string; gb: number }[] }[];
  }[];
}

/**
 * How a screen connects, as Windows reports it. Windows says the kind of plug (HDMI, DisplayPort), not which
 * of a card's several plugs of that kind. usb-c is DisplayPort carried over a USB-C or Thunderbolt port.
 */
export type DisplayConnection = "hdmi" | "displayport" | "usb-c" | "dvi" | "vga" | "internal" | "wireless" | "other";

export type HardwareKind = "cpu" | "gpu" | "board" | "memory" | "storage" | "battery" | "psu" | "cooler" | "network" | "other";
/** throughput is in bytes a second (a drive's read and write rates); current is in amps. Helpers before 0.1.4 send neither. */
export type SensorType = "temperature" | "load" | "fan" | "clock" | "power" | "voltage" | "data" | "level" | "control" | "throughput" | "current";

export interface Sensor {
  /** Unique within a PC, e.g. "/amdcpu/0/temperature/2". */
  id: string;
  hw: HardwareKind;
  hwName: string;
  type: SensorType;
  name: string;
  value: number | null;
  min?: number | null;
  max?: number | null;
}

export interface Snapshot {
  /** Milliseconds since epoch. */
  at: number;
  sensors: Sensor[];
  /** Name of the foreground game, when one is running. */
  game?: string | null;
  /** False when the helper runs without admin rights and some sensors are missing. */
  elevated: boolean;
  /** PawnIO, the driver processor temperatures and board fans are read through. Missing from helpers before 0.1.2. */
  driver?: { installed: boolean; version?: string | null };
}

/** Settings Rig can read and change, read from the PC on request. */
/** Windows 11's power mode: Best power efficiency, Balanced or Best performance. */
export type PowerMode = "efficiency" | "balanced" | "performance";
export interface PowerModeFacts { ac: PowerMode; dc: PowerMode; /** Battery saver (Energy saver on newer Windows 11) is on now. */ saver: boolean }
/** An app's graphics preference as Windows stores it: auto is "Let Windows decide", saving the built-in chip, high the graphics card. */
export type AppGpu = "auto" | "saving" | "high";

export interface SystemFacts {
  powerPlans: { guid: string; name: string; active: boolean }[];
  startupApps: { name: string; command: string; enabled: boolean; scope: "user" | "machine" }[];
  gameMode: boolean;
  visualEffects: "auto" | "appearance" | "performance" | "custom";
  maxProcessorState: { ac: number; dc: number };
  /** Windows' power mode (Settings > System > Power), plugged in and on battery, and whether Battery saver is on. Missing from older helpers. */
  powerMode?: PowerModeFacts;
  /**
   * Windows' graphics preference per app (Settings > System > Display > Graphics), by the program's file name in lower
   * case: only the apps that have one. Missing from older helpers.
   */
  gpuPreferences?: Record<string, AppGpu>;
  /** Windows updates, virus protection, the firewall and backup (safety.ts). Missing from helpers before it was read. */
  security?: SecurityFacts;
}

/** Pick the first sensor that matches, by hardware, type and a name test. */
export function findSensor(s: Snapshot | null | undefined, hw: HardwareKind, type: SensorType, name?: RegExp): Sensor | undefined {
  return s?.sensors.find((x) => x.hw === hw && x.type === type && x.value !== null && (!name || name.test(x.name)));
}
