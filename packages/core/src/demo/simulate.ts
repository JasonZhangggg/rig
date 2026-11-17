// Fake readings for the demo, shaped like what LibreHardwareMonitor reports,
// so the demo runs through exactly the same code as a real PC.

import type { Inventory, Sensor, Snapshot } from "../telemetry";

/** 0 at rest, 1 while the demo's evening game session is on. */
export function gameLoad(t: number): number {
  const h = new Date(t).getHours();
  return h >= 19 && h <= 22 ? 1 : h >= 9 && h <= 17 ? 0.35 : 0.1;
}

const wobble = (t: number, period: number, amp: number) => Math.sin(t / period) * amp;

export function simulate(inv: Inventory, t: number, opts: { game?: string | null; dust?: number } = {}): Snapshot {
  const laptop = inv.machine.kind === "laptop";
  const load = opts.game ? 1 : gameLoad(t);
  const dust = opts.dust ?? 0;
  const amd = /amd|ryzen/i.test(inv.cpu.name);
  const s: Sensor[] = [];
  const add = (hw: Sensor["hw"], hwName: string, type: Sensor["type"], name: string, value: number, max?: number) =>
    s.push({ id: `/${hw}/0/${type}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, hw, hwName, type, name, value: Math.round(value * 10) / 10, min: null, max: max ?? null });

  const cpuT = (laptop ? 52 : 42) + load * (laptop ? 30 : 22) + wobble(t, 9000, 2.5);
  add("cpu", inv.cpu.name, "temperature", amd ? "Core (Tctl/Tdie)" : "CPU Package", cpuT);
  add("cpu", inv.cpu.name, "load", "CPU Total", 6 + load * 38 + wobble(t, 4000, 4));
  for (let i = 1; i <= Math.min(inv.cpu.cores, 8); i++) add("cpu", inv.cpu.name, "clock", `Core #${i}`, (inv.cpu.maxClockMhz ?? 4500) * (0.55 + load * 0.4) + wobble(t + i * 977, 3000, 120));
  add("cpu", inv.cpu.name, "power", "Package", 18 + load * (laptop ? 28 : 70));

  const gpu = inv.gpus.find((g) => !g.integrated);
  if (gpu) {
    const gt = 36 + load * 44 + dust * 9 + wobble(t, 7000, 1.5);
    add("gpu", gpu.name, "temperature", "GPU Core", gt);
    add("gpu", gpu.name, "temperature", "GPU Hot Spot", gt + 11);
    add("gpu", gpu.name, "load", "GPU Core", 3 + load * 94);
    add("gpu", gpu.name, "clock", "GPU Core", 210 + load * 2400);
    add("gpu", gpu.name, "fan", "GPU Fan 1", load > 0.5 ? 1900 + dust * 550 + wobble(t, 5000, 60) : 0, 3000);
    add("gpu", gpu.name, "power", "GPU Package", 14 + load * 206);
  }

  if (!laptop) {
    add("board", inv.board.product, "temperature", "System", 34 + load * 10);
    const front = 900 + load * 420;
    add("board", inv.board.product, "fan", "Fan #1", 760 + load * 420 + wobble(t, 6000, 30), 2000);
    add("board", inv.board.product, "fan", "Fan #2", front, 1800);
    add("board", inv.board.product, "fan", "Fan #3", front - 10, 1800);
    add("board", inv.board.product, "fan", "Fan #4", 820 + load * 230, 1800);
  } else {
    add("board", inv.board.product, "temperature", "Motherboard", 40 + load * 12);
    add("cooler", "Laptop fans", "fan", "Fan #1", 1800 + load * 2600, 5200);
    add("cooler", "Laptop fans", "fan", "Fan #2", 1760 + load * 2550, 5200);
  }

  const totalGb = inv.memory.totalMb / 1024;
  const memPct = (laptop ? 58 : 30) + load * 12 + wobble(t, 12000, 3);
  add("memory", "Generic Memory", "load", "Memory", memPct);
  add("memory", "Generic Memory", "data", "Memory Used", (totalGb * memPct) / 100);
  add("storage", inv.disks[0]?.model ?? "Disk", "temperature", "Temperature", 38 + load * 14);

  return { at: t, sensors: s, game: opts.game ?? null, elevated: true };
}
