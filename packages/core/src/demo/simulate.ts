// Fake readings for the demo, shaped like what LibreHardwareMonitor reports,
// so the demo runs through exactly the same code as a real PC.

import type { Inventory, Sensor, Snapshot } from "../telemetry";
import { activityAt, weekFor, type Activity } from "./schedule";
import { demoBattery } from "./battery";

/**
 * A slow swing over `period` ms. The time is first brought inside one turn: the sine of a number near a billion is
 * several times slower to work out, and a month of demo history takes thousands of readings.
 */
const wobble = (t: number, period: number, amp: number) => Math.sin((t % (TURN * period)) / period) * amp;
const TURN = 2 * Math.PI;
/** How fast a game warms the graphics card through, in minutes: most of the way in about an hour and a half. */
const WARM_UP_MIN = 35;
/**
 * Sensor ids, worked out once per PC: a PC reports its sensors in the same order every time, and the demo
 * reads every sensor thousands of times to make a month of history. The name is checked, so a different order only costs time.
 */
const ids = new WeakMap<Inventory, { dev: string; type: string; name: string; id: string }[]>();
const slug = (dev: string, type: string, name: string) => `/${dev}/0/${type}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** A laptop's dedicated graphics chip wakes when something asks this much of the graphics, and sleeps again after. */
const WAKES_AT = 0.2;

/** How LibreHardwareMonitor names a chip, which isn't always how Windows does: AMD's driver drops the (TM). */
const sensorChipName = (name: string) => name.replace(/\(TM\)/g, "").replace(/\s+/g, " ").trim();

/**
 * Readings for a demo PC at a moment. It follows the PC's weekly schedule
 * unless told what it's doing; a game on its own means both parts flat out.
 */
export function simulate(inv: Inventory, t: number, opts: { game?: string | null; activity?: Activity; dust?: number } = {}): Snapshot {
  const laptop = inv.machine.kind === "laptop";
  const battery = laptop ? demoBattery(inv, t) : null;
  // On battery the laptop does what its day on battery says (demo/battery.ts), not its usual week.
  const act = opts.activity ?? (opts.game ? { cpu: 1, gpu: 1, game: opts.game } : battery?.activity ?? activityAt(weekFor(inv), t));
  const cpu = Math.min(act.cpu, 1), gpuLoad = Math.min(act.gpu, 1), load = Math.max(cpu, gpuLoad);
  const dust = opts.dust ?? 0;
  const amd = /amd|ryzen/i.test(inv.cpu.name);
  const s: Sensor[] = [];
  let known = ids.get(inv);
  if (!known) ids.set(inv, known = []);
  const idOf = (i: number, dev: string, type: string, name: string) => {
    const k = known[i];
    if (k && k.dev === dev && k.type === type && k.name === name) return k.id;
    return (known[i] = { dev, type, name, id: slug(dev, type, name) }).id;
  };
  /** `value` null: the part is there but has no reading now. `dev` tells apart two parts of one kind in the sensor id, as LibreHardwareMonitor's do. */
  const add = (hw: Sensor["hw"], hwName: string, type: Sensor["type"], name: string, value: number | null, max?: number, dev: string = hw) =>
    s.push({ id: idOf(s.length, dev, type, name), hw, hwName, type, name, value: value == null ? null : Math.round(value * 10) / 10, min: null, max: max ?? null });
  const pct = (v: number) => Math.max(0, Math.min(100, v));

  // The processor, named the way LibreHardwareMonitor names it: Ryzen reports one temperature per chiplet, Intel one per core.
  const gpu = inv.gpus.find((g) => !g.integrated);
  // A gaming laptop's processor and graphics chip share their heat pipes, so a game warms both.
  const cpuT = (laptop ? 52 : 42) + act.cpu * (laptop ? 30 : 22) + (laptop && gpu ? gpuLoad * 6 : 0) + wobble(t, 9000, 2.5);
  const cores = Math.min(inv.cpu.cores, 16);
  const smt = Math.min(2, Math.max(1, Math.round(inv.cpu.threads / inv.cpu.cores)));
  const coreLoad = (i: number) => pct(4 + cpu * (88 - i * 5) + wobble(t + i * 1311, 2500, 6) + (i === 1 ? 6 : 0));
  add("cpu", inv.cpu.name, "temperature", amd ? "Core (Tctl/Tdie)" : "CPU Package", cpuT);
  if (amd) add("cpu", inv.cpu.name, "temperature", "CCD1 (Tdie)", cpuT - 3);
  else {
    for (let i = 1; i <= cores; i++) add("cpu", inv.cpu.name, "temperature", `Core #${i}`, cpuT - 4 + (i <= 6 ? 2 : -3) + wobble(t + i * 733, 5000, 2));
    add("cpu", inv.cpu.name, "temperature", "Core Max", cpuT - 1);
  }
  add("cpu", inv.cpu.name, "load", "CPU Total", Math.min(100, 6 + cpu * 70 + wobble(t, 4000, 4)));
  for (let i = 1; i <= cores; i++) {
    const l = coreLoad(i);
    // On Intel's hybrid chips only the first six cores run two threads.
    const threads = amd || i <= 6 ? smt : 1;
    if (threads > 1) for (let k = 1; k <= threads; k++) add("cpu", inv.cpu.name, "load", `CPU Core #${i} Thread #${k}`, pct(l + (k === 1 ? 4 : -6)));
    else add("cpu", inv.cpu.name, "load", `CPU Core #${i}`, l);
  }
  add("cpu", inv.cpu.name, "load", "CPU Core Max", Math.max(...Array.from({ length: cores }, (_, i) => coreLoad(i + 1))));
  for (let i = 1; i <= cores; i++) add("cpu", inv.cpu.name, "clock", `Core #${i}`, (inv.cpu.maxClockMhz ?? 4500) * (0.55 + cpu * 0.4) - (i > 6 && !amd ? 900 : 0) + wobble(t + i * 977, 3000, 120));
  if (amd) add("cpu", inv.cpu.name, "clock", "Bus Speed", 100);
  add("cpu", inv.cpu.name, "power", amd ? "Package" : "CPU Package", 18 + cpu * (laptop ? 28 : 70));
  add("cpu", inv.cpu.name, "power", "CPU Cores", 8 + cpu * (laptop ? 20 : 55));
  if (amd) for (let i = 1; i <= cores; i++) add("cpu", inv.cpu.name, "power", `Core #${i} (SMU)`, 0.6 + (coreLoad(i) / 100) * 7.5);
  add("cpu", inv.cpu.name, "voltage", amd ? "Core (SVI2 TFN)" : "CPU Core", 0.92 + cpu * 0.33 + wobble(t, 2000, 0.01));
  if (amd) add("cpu", inv.cpu.name, "voltage", "SoC (SVI2 TFN)", 1.05);

  // A laptop with a dedicated chip reports its built-in graphics too, before the dedicated chip as LibreHardwareMonitor
  // lists them (AMD's before NVIDIA's). The built-in chip draws the desktop and the browser; in a game it only passes the
  // dedicated chip's frames to the screen. Sharing the processor's chip, it runs about as warm.
  const igpu = laptop && gpu ? inv.gpus.find((g) => g.integrated) : undefined;
  const awake = !laptop || gpuLoad >= WAKES_AT;
  if (igpu) {
    const name = sensorChipName(igpu.name), dev = `gpu-${igpu.vendor}-integrated`;
    const busy = awake ? 0.12 : Math.min(1, 0.04 + act.gpu * 3 + cpu * 0.15);
    add("gpu", name, "temperature", "GPU Core", cpuT - 3, undefined, dev);
    add("gpu", name, "load", "GPU Core", pct(busy * 100 + wobble(t, 2300, 2)), undefined, dev);
    add("gpu", name, "load", "D3D 3D", pct(busy * 92 + wobble(t, 2300, 2)), undefined, dev);
    add("gpu", name, "clock", "GPU Core", 800 + busy * 1900, undefined, dev);
    add("gpu", name, "power", "GPU Core", 1.5 + busy * 14, undefined, dev);
    add("gpu", name, "data", "D3D Shared Memory Used", 0.6 + busy * 1.4, undefined, dev);
  }
  if (gpu) {
    // In a game the card and the air in the case warm through over the first hour or so; dust raises where it settles.
    const soak = act.game && act.since != null ? 1 - Math.exp(-act.since / WARM_UP_MIN) : 1;
    // A laptop's chip has a small cooler of its own and no fans Windows can read: the laptop's fans cool it.
    const gt = laptop ? 42 + act.gpu * (24 + 10 * soak) + wobble(t, 7000, 1.5) : 36 + act.gpu * (30 + 14 * soak) + dust * (3 + 6 * soak) + wobble(t, 7000, 1.5);
    // Asleep, the chip answers nothing but Windows' own 3D counter.
    const on = (v: number) => (awake ? v : null);
    add("gpu", gpu.name, "temperature", "GPU Core", on(gt));
    add("gpu", gpu.name, "temperature", "GPU Hot Spot", on(gt + (laptop ? 9 : 11)));
    if (!laptop) add("gpu", gpu.name, "temperature", "GPU Memory Junction", gt + 6 + gpuLoad * 8);
    add("gpu", gpu.name, "load", "GPU Core", on(3 + gpuLoad * 94));
    add("gpu", gpu.name, "load", "GPU Memory Controller", on(2 + gpuLoad * 48));
    add("gpu", gpu.name, "load", "GPU Video Engine", on(0));
    add("gpu", gpu.name, "load", "GPU Memory", on(14 + gpuLoad * 52));
    if (laptop) add("gpu", gpu.name, "load", "D3D 3D", awake ? 2 + gpuLoad * 92 : 0);
    add("gpu", gpu.name, "clock", "GPU Core", on(210 + gpuLoad * (laptop ? 2100 : 2400)));
    add("gpu", gpu.name, "clock", "GPU Memory", on(gpuLoad > 0.1 ? (laptop ? 8001 : 10501) : 405));
    if (!laptop) {
      add("gpu", gpu.name, "fan", "GPU Fan 1", gpuLoad > 0.5 ? 1900 + dust * 550 + wobble(t, 5000, 60) : 0, 3000);
      add("gpu", gpu.name, "fan", "GPU Fan 2", gpuLoad > 0.5 ? 1880 + dust * 550 + wobble(t, 5100, 60) : 0, 3000);
      add("gpu", gpu.name, "control", "GPU Fan 1", gpuLoad > 0.5 ? 52 + dust * 15 : 0);
    }
    add("gpu", gpu.name, "power", "GPU Package", on(laptop ? 9 + gpuLoad * 96 : 14 + gpuLoad * 206));
    add("gpu", gpu.name, "data", "GPU Memory Used", on(((gpu.vramMb ?? 8192) / 1024) * (0.14 + gpuLoad * 0.52)));
    add("gpu", gpu.name, "data", "GPU Memory Total", on((gpu.vramMb ?? 8192) / 1024));
  }

  if (!laptop) {
    add("board", inv.board.product, "temperature", "System", 34 + load * 10);
    add("board", inv.board.product, "temperature", "CPU", cpuT - 6);
    add("board", inv.board.product, "temperature", "VRM MOS", 38 + cpu * 18);
    add("board", inv.board.product, "temperature", "PCH", 46 + load * 4);
    add("board", inv.board.product, "voltage", "Vcore", 0.95 + cpu * 0.32 + wobble(t, 2100, 0.01));
    add("board", inv.board.product, "voltage", "+12V", 12.096 - load * 0.06);
    add("board", inv.board.product, "voltage", "+5V", 5.04 - load * 0.02);
    add("board", inv.board.product, "voltage", "+3.3V", 3.312);
    add("board", inv.board.product, "voltage", "CPU VDDIO / Memory", 1.35);
    add("board", inv.board.product, "voltage", "VBAT", 3.12);
    const front = 900 + load * 420;
    add("board", inv.board.product, "fan", "Fan #1", 760 + load * 420 + wobble(t, 6000, 30), 2000);
    add("board", inv.board.product, "fan", "Fan #2", front, 1800);
    add("board", inv.board.product, "fan", "Fan #3", front - 10, 1800);
    add("board", inv.board.product, "fan", "Fan #4", 820 + load * 230, 1800);
  } else {
    add("board", inv.board.product, "temperature", "Motherboard", 40 + load * 12);
    // A gaming laptop's fans answer the graphics chip too, and spin faster.
    const fan = gpu ? load : cpu, top = gpu ? 6400 : 5200;
    add("cooler", "Laptop fans", "fan", "Fan #1", 1800 + fan * (top - 2600), top);
    add("cooler", "Laptop fans", "fan", "Fan #2", 1760 + fan * (top - 2650), top);
  }

  const totalGb = inv.memory.totalMb / 1024;
  const memPct = (laptop ? 58 : 30) + load * 12 + wobble(t, 12000, 3);
  add("memory", "Generic Memory", "load", "Memory", memPct);
  add("memory", "Generic Memory", "data", "Memory Used", (totalGb * memPct) / 100);
  add("memory", "Generic Memory", "data", "Memory Available", totalGb - (totalGb * memPct) / 100);
  add("memory", "Generic Memory", "load", "Virtual Memory", memPct * 0.8);

  const disk = inv.disks[0];
  if (disk) {
    const busyDisk = load * 30 + Math.max(0, wobble(t, 1700, 12));
    add("storage", disk.model, "temperature", "Temperature", 38 + load * 14);
    if (disk.media === "nvme") add("storage", disk.model, "temperature", "Temperature 2", 44 + load * 16);
    add("storage", disk.model, "load", "Used Space", 100 - ((inv.volumes[0]?.freeGb ?? 0) / (inv.volumes[0]?.sizeGb || 1)) * 100);
    add("storage", disk.model, "load", "Read Activity", busyDisk * 0.7);
    add("storage", disk.model, "load", "Write Activity", busyDisk * 0.3);
    add("storage", disk.model, "load", "Total Activity", busyDisk);
    add("storage", disk.model, "throughput", "Read Rate", busyDisk * 18e6);
    add("storage", disk.model, "throughput", "Write Rate", busyDisk * 6e6);
    if (disk.media === "nvme") {
      add("storage", disk.model, "level", "Available Spare", 100);
      add("storage", disk.model, "level", "Percentage Used", 100 - (disk.healthPercent ?? 98));
      add("storage", disk.model, "data", "Data Written", (disk.writtenTb ?? 12) * 1000);
    }
  }

  // The battery, named the way LibreHardwareMonitor names it: the rate and current are named for which way they go.
  if (battery && inv.battery) {
    const name = `${inv.machine.manufacturer} Battery`.trim();
    const w = battery.state === "plugged" ? 0 : battery.watts + (battery.state === "discharging" ? wobble(t, 4000, 0.6) + act.cpu * wobble(t, 1300, 1.5) : 0);
    const v = 14.8 + (battery.level / 100) * 2.4;
    const way = battery.state === "discharging" ? "Discharge" : battery.state === "charging" ? "Charge" : "Charge/Discharge";
    add("battery", name, "level", "Charge Level", battery.level);
    if (inv.battery.designWh && inv.battery.fullWh) add("battery", name, "level", "Degradation Level", 100 - (inv.battery.fullWh / inv.battery.designWh) * 100);
    add("battery", name, "voltage", "Voltage", v);
    add("battery", name, "power", `${way} Rate`, w);
    add("battery", name, "current", `${way} Current`, w / v);
  }

  return { at: t, sensors: s, game: act.game, elevated: true };
}
