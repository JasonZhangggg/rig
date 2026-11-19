// Fake readings for the demo, shaped like what LibreHardwareMonitor reports,
// so the demo runs through exactly the same code as a real PC.

import type { Inventory, Sensor, Snapshot } from "../telemetry";
import { activityAt, type Activity } from "./schedule";

const wobble = (t: number, period: number, amp: number) => Math.sin(t / period) * amp;

/**
 * Readings for a demo PC at a moment. It follows the PC's weekly schedule
 * unless told what it's doing; a game on its own means both parts flat out.
 */
export function simulate(inv: Inventory, t: number, opts: { game?: string | null; activity?: Activity; dust?: number } = {}): Snapshot {
  const laptop = inv.machine.kind === "laptop";
  const act = opts.activity ?? (opts.game ? { cpu: 1, gpu: 1, game: opts.game } : activityAt(inv.machine.kind, t));
  const cpu = Math.min(act.cpu, 1), gpuLoad = Math.min(act.gpu, 1), load = Math.max(cpu, gpuLoad);
  const dust = opts.dust ?? 0;
  const amd = /amd|ryzen/i.test(inv.cpu.name);
  const s: Sensor[] = [];
  const add = (hw: Sensor["hw"], hwName: string, type: Sensor["type"], name: string, value: number, max?: number) =>
    s.push({ id: `/${hw}/0/${type}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, hw, hwName, type, name, value: Math.round(value * 10) / 10, min: null, max: max ?? null });
  const pct = (v: number) => Math.max(0, Math.min(100, v));

  // The processor, named the way LibreHardwareMonitor names it: Ryzen reports one temperature per chiplet, Intel one per core.
  const cpuT = (laptop ? 52 : 42) + act.cpu * (laptop ? 30 : 22) + wobble(t, 9000, 2.5);
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

  const gpu = inv.gpus.find((g) => !g.integrated);
  if (gpu) {
    const gt = 36 + act.gpu * 44 + dust * 9 + wobble(t, 7000, 1.5);
    add("gpu", gpu.name, "temperature", "GPU Core", gt);
    add("gpu", gpu.name, "temperature", "GPU Hot Spot", gt + 11);
    add("gpu", gpu.name, "temperature", "GPU Memory Junction", gt + 6 + gpuLoad * 8);
    add("gpu", gpu.name, "load", "GPU Core", 3 + gpuLoad * 94);
    add("gpu", gpu.name, "load", "GPU Memory Controller", 2 + gpuLoad * 48);
    add("gpu", gpu.name, "load", "GPU Video Engine", 0);
    add("gpu", gpu.name, "load", "GPU Memory", 14 + gpuLoad * 52);
    add("gpu", gpu.name, "clock", "GPU Core", 210 + gpuLoad * 2400);
    add("gpu", gpu.name, "clock", "GPU Memory", gpuLoad > 0.1 ? 10501 : 405);
    add("gpu", gpu.name, "fan", "GPU Fan 1", gpuLoad > 0.5 ? 1900 + dust * 550 + wobble(t, 5000, 60) : 0, 3000);
    add("gpu", gpu.name, "fan", "GPU Fan 2", gpuLoad > 0.5 ? 1880 + dust * 550 + wobble(t, 5100, 60) : 0, 3000);
    add("gpu", gpu.name, "control", "GPU Fan 1", gpuLoad > 0.5 ? 52 + dust * 15 : 0);
    add("gpu", gpu.name, "power", "GPU Package", 14 + gpuLoad * 206);
    add("gpu", gpu.name, "data", "GPU Memory Used", ((gpu.vramMb ?? 8192) / 1024) * (0.14 + gpuLoad * 0.52));
    add("gpu", gpu.name, "data", "GPU Memory Total", (gpu.vramMb ?? 8192) / 1024);
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
    add("cooler", "Laptop fans", "fan", "Fan #1", 1800 + cpu * 2600, 5200);
    add("cooler", "Laptop fans", "fan", "Fan #2", 1760 + cpu * 2550, 5200);
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

  return { at: t, sensors: s, game: act.game, elevated: true };
}
