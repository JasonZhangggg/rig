// What the Windows helper (helper/RigHelper) reports. These shapes are the
// contract between the C# helper, the Rust core and the UI, so change them in
// all three places at once. The helper writes JSON with camelCase names.

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
  gpus: { name: string; vendor: "nvidia" | "amd" | "intel" | "other"; vramMb?: number; driverVersion?: string; driverDate?: string; integrated: boolean }[];
  board: { manufacturer: string; product: string; biosVersion: string; biosDate?: string };
  memory: { totalMb: number; slotsTotal?: number; modules: { manufacturer?: string; partNumber?: string; capacityMb: number; speedMhz?: number; slot?: string }[] };
  disks: { model: string; sizeGb: number; media: "nvme" | "ssd" | "hdd" | "unknown"; healthPercent?: number; writtenTb?: number; /** Windows' own verdict from the drive's self-test (SMART). Missing from helpers before 0.1.5. */ status?: "healthy" | "warning" | "unhealthy" }[];
  volumes: { letter: string; label?: string; sizeGb: number; freeGb: number }[];
  battery?: { designWh?: number; fullWh?: number; cycles?: number };
  displays: { name: string; width: number; height: number; refreshHz: number; maxRefreshHz: number; primary: boolean }[];
}

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
export interface SystemFacts {
  powerPlans: { guid: string; name: string; active: boolean }[];
  startupApps: { name: string; command: string; enabled: boolean; scope: "user" | "machine" }[];
  gameMode: boolean;
  visualEffects: "auto" | "appearance" | "performance" | "custom";
  maxProcessorState: { ac: number; dc: number };
}

/** Pick the first sensor that matches, by hardware, type and a name test. */
export function findSensor(s: Snapshot | null | undefined, hw: HardwareKind, type: SensorType, name?: RegExp): Sensor | undefined {
  return s?.sensors.find((x) => x.hw === hw && x.type === type && x.value !== null && (!name || name.test(x.name)));
}
