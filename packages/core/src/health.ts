// Turns readings and settings into the issues and health score people see.
// Pure functions, so they run the same on the desktop, the server and in tests.

import type { HealthPart, Issue, Severity } from "./model";
import { findSensor, type Inventory, type Snapshot, type SystemFacts } from "./telemetry";

export interface HealthInput {
  inv: Inventory;
  snap: Snapshot | null;
  facts: SystemFacts | null;
}

export interface Finding extends Issue { category: string; weight: number }

export function cpuLimit(name: string): number {
  if (/X3D/i.test(name)) return 89;
  if (/AMD|Ryzen/i.test(name)) return 95;
  return 100;
}
export function gpuLimit(vendor: string): number {
  return vendor === "amd" ? 100 : 88;
}

export const cpuTemp = (s: Snapshot | null) =>
  findSensor(s, "cpu", "temperature", /package|tctl|tdie|core \(tctl|average/i) ?? findSensor(s, "cpu", "temperature");
export const gpuTemp = (s: Snapshot | null) =>
  findSensor(s, "gpu", "temperature", /^gpu core$|^gpu$|edge/i) ?? findSensor(s, "gpu", "temperature");

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function findings({ inv, snap, facts }: HealthInput): Finding[] {
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "id"> & { id?: string }) => out.push({ id: f.id ?? `${f.category}-${out.length}`, ...f } as Finding);

  // Permission for sensors
  if (snap && !snap.elevated) {
    add({ id: "needs-admin", category: "Temperatures", weight: 0, severity: "info", title: "Rig can't read every temperature yet", body: "Windows only shares processor and board temperatures with apps that have admin permission. Restart Rig and choose Yes when Windows asks.", action: "How this works", go: "chat", ask: "Why does Rig need admin permission to read temperatures?" });
  }

  // Temperatures
  const ct = cpuTemp(snap);
  if (ct?.value != null) {
    const lim = cpuLimit(inv.cpu.name);
    if (ct.value >= lim) add({ id: "cpu-hot", category: "Temperatures", weight: 40, severity: "bad", title: `Processor is at its ${lim}°C limit`, body: `It's at ${Math.round(ct.value)}°C and will slow itself down to cool off. Check that the cooler's fan spins and the vents aren't blocked.`, action: "Ask what to do", part: "cpu", go: "chat", ask: `My processor is at ${Math.round(ct.value)}°C. What should I do?` });
    else if (ct.value >= lim - 8) add({ id: "cpu-warm", category: "Temperatures", weight: 15, severity: "warn", title: `Processor runs warm at ${Math.round(ct.value)}°C`, body: `That's ${Math.round(lim - ct.value)}° under its ${lim}°C limit. Fine for short bursts, but worth a look if it stays there.`, action: "Ask about it", part: "cpu", go: "chat", ask: `My processor runs at ${Math.round(ct.value)}°C. Is that okay?`,
      fix: inv.machine.kind === "laptop" && facts && facts.maxProcessorState.ac === 100 ? [{ kind: "power.maxProcessorState", ac: 99, dc: 99 }] : undefined });
  }
  const gpu = inv.gpus.find((g) => !g.integrated);
  const gt = gpuTemp(snap);
  if (gpu && gt?.value != null) {
    const lim = gpuLimit(gpu.vendor);
    if (gt.value >= lim) add({ id: "gpu-hot", category: "Temperatures", weight: 35, severity: "bad", title: `Graphics card is at its ${lim}°C limit`, body: `It's at ${Math.round(gt.value)}°C and will lower its speed. Dust on the intake filters is the usual cause.`, action: "Ask what to do", part: "gpu", go: "chat", ask: `My graphics card is at ${Math.round(gt.value)}°C. What should I do?` });
    else if (gt.value >= lim - 6) add({ id: "gpu-warm", category: "Temperatures", weight: 12, severity: "warn", title: `Graphics card runs warm at ${Math.round(gt.value)}°C`, body: `${Math.round(lim - gt.value)}° under its limit. If it's warmer than it used to be at the same settings, dust is the usual cause.`, action: "Ask about it", part: "gpu", go: "chat", ask: `My graphics card runs at ${Math.round(gt.value)}°C while gaming. Is that okay?` });
  }

  // Storage
  for (const v of inv.volumes) {
    const free = pct(v.freeGb, v.sizeGb);
    if (free < 10) add({ id: `vol-${v.letter}`, category: "Storage", weight: 25, severity: "warn", title: `Drive ${v.letter} is almost full`, body: `${Math.round(v.freeGb)} GB free of ${Math.round(v.sizeGb)} GB. Windows slows down and updates can fail below 10% free.`, action: "Ask how to free space", go: "chat", ask: `Drive ${v.letter} only has ${Math.round(v.freeGb)} GB free. What can I safely remove?` });
    else if (free < 15) add({ id: `vol-${v.letter}`, category: "Storage", weight: 8, severity: "info", title: `Drive ${v.letter} is getting full`, body: `${Math.round(v.freeGb)} GB free of ${Math.round(v.sizeGb)} GB.`, action: "Ask how to free space", go: "chat", ask: `How can I free up space on drive ${v.letter}?` });
  }
  for (const d of inv.disks) {
    if (d.healthPercent != null && d.healthPercent < 80) add({ id: `disk-${d.model}`, category: "Storage", weight: 30, severity: d.healthPercent < 50 ? "bad" : "warn", title: `${d.model} is wearing out`, body: `Its health is ${d.healthPercent}%. Keep a backup of anything important and plan a replacement.`, action: "See upgrades", part: "ssd", go: "upgrades" });
  }

  // Memory pressure
  const mem = findSensor(snap, "memory", "load", /memory$|^memory/i);
  if (mem?.value != null && mem.value >= 90) add({ id: "mem-full", category: "Startup and speed", weight: 15, severity: "warn", title: `Memory is ${Math.round(mem.value)}% full`, body: "Apps will start to slow down as Windows moves things to disk.", action: "Ask what's using it", part: "ram", go: "chat", ask: "My memory is almost full. What's using it?" });

  // Startup apps
  const on = facts?.startupApps.filter((a) => a.enabled) ?? [];
  if (on.length >= 8) add({ id: "startup", category: "Startup and speed", weight: 10, severity: "info", title: `${on.length} apps start with Windows`, body: "Each one slows startup a little and keeps running in the background. Rig can suggest which are safe to turn off.", action: "Review startup apps", go: "chat", ask: "Which of my startup apps can I safely turn off?" });

  // Screens below their best refresh rate
  for (const d of inv.displays) {
    if (d.maxRefreshHz > d.refreshHz && d.maxRefreshHz >= 75) add({ id: `hz-${d.name}`, category: "Startup and speed", weight: 6, severity: "info", title: `${d.name} runs at ${d.refreshHz} Hz but can do ${d.maxRefreshHz} Hz`, body: "Games and scrolling look smoother at the higher rate. Nothing else changes.", action: "Review change", go: "overview", fix: [{ kind: "display.refreshRate", display: d.name, hz: d.maxRefreshHz }] });
  }

  // Battery wear
  const b = inv.battery;
  if (b?.designWh && b.fullWh) {
    const wear = pct(b.fullWh, b.designWh);
    if (wear < 70) add({ id: "battery", category: "Battery", weight: 30, severity: "warn", title: `Battery holds ${wear}% of its original charge`, body: "Most people replace it around this point. Rig can find the right part for your model.", action: "See upgrades", part: "battery", go: "upgrades" });
  }

  // Windows version
  if (/windows 10/i.test(inv.machine.os.name)) add({ id: "win10", category: "Drivers and updates", weight: 25, severity: "warn", title: "Windows 10 no longer gets security updates", body: "Support ended in October 2025. Rig can check whether this PC can move to Windows 11.", action: "Ask about Windows 11", go: "chat", ask: "Can this PC run Windows 11?" });

  return out;
}

const categoriesFor = (laptop: boolean) => laptop
  ? ["Temperatures", "Battery", "Storage", "Startup and speed", "Drivers and updates"]
  : ["Temperatures", "Storage", "Startup and speed", "Drivers and updates"];

const okNote: Record<string, string> = {
  Temperatures: "Within normal range",
  Storage: "Plenty of free space",
  "Startup and speed": "Nothing slowing it down",
  "Drivers and updates": "Nothing waiting",
  Battery: "Holding its charge well",
};

/** Score each category from its findings, then the overall score. */
export function score(laptop: boolean, fs: Finding[]): { health: number; breakdown: HealthPart[] } {
  const breakdown = categoriesFor(laptop).map((label) => {
    const mine = fs.filter((f) => f.category === label && f.weight > 0);
    const value = Math.max(5, 100 - mine.reduce((n, f) => n + f.weight, 0));
    const worst = mine.sort((a, b) => b.weight - a.weight)[0];
    const sev: Severity = !worst ? "ok" : worst.severity;
    return { label, value, note: worst ? worst.title : okNote[label], sev };
  });
  const health = Math.round(breakdown.reduce((n, b) => n + b.value, 0) / breakdown.length);
  return { health, breakdown };
}

export function summaryLine(health: number, fs: readonly Pick<Issue, "severity">[]): string {
  const look = fs.filter((f) => f.severity === "warn" || f.severity === "bad").length;
  if (look === 0) return health >= 90 ? "Running well. Nothing needs a look." : "Running fine.";
  return `${health >= 75 ? "Running well." : "Could be better."} ${look === 1 ? "One thing needs a look." : `${look} things need a look.`}`;
}
