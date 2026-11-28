// Turns readings and settings into the issues and health score people see.
// Pure functions, so they run the same on the desktop, the server and in tests.

import type { HealthPart, Issue, Severity } from "./model";
import { diagnose, STABILITY, WEAR_CRITICAL, WEAR_LOW, type Finding, type HealthInput } from "./diagnose";
import { boostsToLimit, cpuLimit, cpuTemp, gpuLimit, gpuTemp } from "./limits";
import { findSensor } from "./telemetry";
import { suggestedOff } from "./startup";

export type { Finding, HealthInput } from "./diagnose";
export { cpuLimit, cpuTemp, gpuLimit, gpuTemp } from "./limits";

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** Processor load at or under this, in percent, counts as at rest; at or over BUSY_LOAD as working hard. */
export const REST_LOAD = 30;
export const BUSY_LOAD = 60;

export function findings(input: HealthInput): Finding[] {
  const { inv, snap, facts } = input;
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "id"> & { id?: string }) => out.push({ id: f.id ?? `${f.category}-${out.length}`, ...f } as Finding);

  // Permission for sensors
  if (snap && !snap.elevated) {
    add({ id: "needs-admin", category: "Temperatures", weight: 0, severity: "info", title: "Rig can't read every temperature yet", body: "Windows only shares processor and board temperatures with apps that have admin permission. Restart Rig and choose Yes when Windows asks.", action: "How this works", go: "chat", ask: "Why does Rig need admin permission to read temperatures?" });
  } else if (snap?.driver && !snap.driver.installed) {
    add({ id: "needs-driver", category: "Temperatures", weight: 0, severity: "info", title: "Rig can't read processor temperatures yet", body: "They come through PawnIO, a small signed driver that installs with Rig, and it isn't on this PC. Run Rig's installer again and choose Yes when Windows asks.", action: "How this works", go: "chat", ask: "What is PawnIO and why does Rig need it for processor temperatures?" });
  }

  // Processor temperature, read against how hard it's working: at its limit in a long render is how some chips are built; at its limit at rest is a cooling fault.
  const ct = cpuTemp(snap);
  if (ct?.value != null) {
    const lim = cpuLimit(inv.cpu.name, snap);
    const t = Math.round(ct.value);
    const load = findSensor(snap, "cpu", "load", /total/i)?.value;
    const l = load == null ? null : Math.round(load);
    const seen = [`${ct.name} ${t}°C, limit ${lim}°C`, ...(l != null ? [`Processor load ${l}%`] : [])];
    const byDesign = boostsToLimit(inv.cpu.name) && l != null && l >= BUSY_LOAD;
    if (ct.value >= lim) {
      if (l != null && l <= REST_LOAD) add({ id: "cpu-hot", category: "Temperatures", weight: 40, severity: "bad", part: "cpu", confidence: "likely", evidence: seen, title: `Processor is at its ${lim}°C limit while barely working`, body: `It's at ${t}°C with only ${l}% load. That points at the cooler: a fan or pump that stopped, a cooler that came loose, or dried-out paste. Check that the cooler's fan spins.`, action: "Ask what to do", go: "chat", ask: `My processor is at ${t}°C while doing almost nothing. What should I do?` });
      else if (byDesign) add({ id: "cpu-hot", category: "Temperatures", weight: 10, severity: "warn", part: "cpu", confidence: "sure", evidence: seen, title: `Processor reached its ${lim}°C limit under heavy load`, body: "This processor is built to run up to its limit when working flat out, and gives up a little speed to stay there. That's safe. A stronger cooler would keep more of the speed.", action: "Ask about it", go: "chat", ask: `My processor hits ${t}°C under heavy load. Is that normal for it?` });
      else add({ id: "cpu-hot", category: "Temperatures", weight: 40, severity: "bad", part: "cpu", confidence: "sure", evidence: seen, title: `Processor is at its ${lim}°C limit`, body: `It's at ${t}°C and will slow itself down to cool off. Check that the cooler's fan spins and the vents aren't blocked.`, action: "Ask what to do", go: "chat", ask: `My processor is at ${t}°C. What should I do?` });
    } else if (ct.value >= lim - 8 && !byDesign) {
      add({ id: "cpu-warm", category: "Temperatures", weight: 15, severity: "warn", part: "cpu", confidence: "sure", evidence: seen,
        title: `Processor runs warm at ${t}°C`,
        body: l != null && l <= REST_LOAD ? `That's ${Math.round(lim - ct.value)}° under its ${lim}°C limit with only ${l}% load, which is warm for a processor at rest. Check the cooler and the vents.` : `That's ${Math.round(lim - ct.value)}° under its ${lim}°C limit. Fine for short bursts, but worth a look if it stays there.`,
        action: "Ask about it", go: "chat", ask: `My processor runs at ${t}°C. Is that okay?`,
        fix: inv.machine.kind === "laptop" && facts && facts.maxProcessorState.ac === 100 ? [{ kind: "power.maxProcessorState", ac: 99, dc: 99 }] : undefined });
    }
  }
  const gpu = inv.gpus.find((g) => !g.integrated);
  const gt = gpuTemp(snap);
  if (gpu && gt?.value != null) {
    const lim = gpuLimit(gpu.vendor);
    const evidence = [`${gt.name} ${Math.round(gt.value)}°C, limit ${lim}°C`];
    if (gt.value >= lim) add({ id: "gpu-hot", category: "Temperatures", weight: 35, severity: "bad", confidence: "sure", evidence, title: `Graphics card is at its ${lim}°C limit`, body: `It's at ${Math.round(gt.value)}°C and will lower its speed. Dust on the intake filters is the usual cause.`, action: "Ask what to do", part: "gpu", go: "chat", ask: `My graphics card is at ${Math.round(gt.value)}°C. What should I do?` });
    else if (gt.value >= lim - 6) add({ id: "gpu-warm", category: "Temperatures", weight: 12, severity: "warn", confidence: "sure", evidence, title: `Graphics card runs warm at ${Math.round(gt.value)}°C`, body: `${Math.round(lim - gt.value)}° under its limit. If it's warmer than it used to be at the same settings, dust is the usual cause.`, action: "Ask about it", part: "gpu", go: "chat", ask: `My graphics card runs at ${Math.round(gt.value)}°C while gaming. Is that okay?` });
  }

  // Storage
  for (const v of inv.volumes) {
    const free = pct(v.freeGb, v.sizeGb);
    if (free < 10) add({ id: `vol-${v.letter}`, category: "Storage", weight: 25, severity: "warn", title: `Drive ${v.letter} is nearly full`, body: `${Math.round(v.freeGb)} GB free of ${Math.round(v.sizeGb)} GB. Windows slows down and updates can fail below 10% free.`, action: "Ask how to free space", go: "chat", ask: `Drive ${v.letter} only has ${Math.round(v.freeGb)} GB free. What can I safely remove?` });
    else if (free < 15) add({ id: `vol-${v.letter}`, category: "Storage", weight: 8, severity: "info", title: `Drive ${v.letter} is getting full`, body: `${Math.round(v.freeGb)} GB free of ${Math.round(v.sizeGb)} GB.`, action: "Ask how to free space", go: "chat", ask: `How can I free up space on drive ${v.letter}?` });
  }
  // Life left as the drive reports it. 80% left still means years of use, so only the last fifth counts.
  for (const d of inv.disks) {
    if (d.healthPercent != null && d.healthPercent < WEAR_LOW) add({ id: `disk-${d.model}`, category: "Storage", weight: d.healthPercent < WEAR_CRITICAL ? 35 : 25, severity: d.healthPercent < WEAR_CRITICAL ? "bad" : "warn", confidence: "sure", evidence: [`Life left ${d.healthPercent}%${d.writtenTb != null ? `, ${d.writtenTb} TB written` : ""}`], title: `${d.model} is wearing out`, body: `It reports ${d.healthPercent}% of its life left. Keep a backup of anything important and plan a replacement.`, action: "See upgrades", part: "ssd", go: "upgrades" });
  }

  // Memory pressure
  const mem = findSensor(snap, "memory", "load", /memory$|^memory/i);
  if (mem?.value != null && mem.value >= 90) add({ id: "mem-full", category: "Startup and speed", weight: 15, severity: "warn", title: `Memory is ${Math.round(mem.value)}% full`, body: "Apps will start to slow down as Windows moves things to disk.", action: "Ask what's using it", part: "ram", go: "chat", ask: "My memory is almost full. What's using it?" });

  // Startup apps
  // Eight or more, or a few Rig knows open fine when started by hand.
  const on = facts?.startupApps.filter((a) => a.enabled) ?? [];
  const canGo = suggestedOff(on).length;
  if (on.length >= 8 || canGo >= 3) add({
    id: "startup", category: "Startup and speed", weight: 10, severity: "info", title: `${on.length} apps start with Windows`,
    body: canGo ? `Each one slows startup a little and keeps running in the background. Rig suggests turning off ${canGo} of them.` : "Each one slows startup a little and keeps running in the background.",
    action: "Review startup apps", go: "chat", open: "startup", ask: "Which of my startup apps can I safely turn off?",
  });

  // Screens below their best refresh rate
  for (const d of inv.displays) {
    if (d.maxRefreshHz > d.refreshHz && d.maxRefreshHz >= 75) add({ id: `hz-${d.name}`, category: "Startup and speed", weight: 6, severity: "info", title: `${d.name} runs at ${d.refreshHz} Hz but can do ${d.maxRefreshHz} Hz`, body: "Games and scrolling look smoother at the higher rate. Nothing else changes.", action: "Review change", go: "overview", fix: [{ kind: "display.refreshRate", display: d.name, hz: d.maxRefreshHz }] });
  }

  // Battery wear
  const b = inv.battery;
  if (b?.designWh && b.fullWh) {
    const wear = Math.min(100, pct(b.fullWh, b.designWh));
    if (wear < 70) add({ id: "battery", category: "Battery", weight: 30, severity: "warn", confidence: "sure", evidence: [`Holds ${b.fullWh} Wh of its original ${b.designWh} Wh${b.cycles ? ` after ${b.cycles} charge cycles` : ""}`], title: `Battery holds ${wear}% of its original charge`, body: "Most people replace it around this point. Rig can find the right part for your model.", action: "See upgrades", part: "battery", go: "upgrades" });
  }

  // Windows version
  if (/windows 10/i.test(inv.machine.os.name)) add({ id: "win10", category: "Drivers and updates", weight: 25, severity: "warn", title: "Windows 10 no longer gets security updates", body: "Support ended in October 2025. Rig can check whether this PC can move to Windows 11.", action: "Ask about Windows 11", go: "chat", ask: "Can this PC run Windows 11?" });

  diagnose(input, (f) => add(f));
  return out;
}

const categoriesFor = (laptop: boolean, stability: boolean) => [
  ...(laptop ? ["Temperatures", "Battery", "Storage", "Startup and speed", "Drivers and updates"] : ["Temperatures", "Storage", "Startup and speed", "Drivers and updates"]),
  ...(stability ? [STABILITY] : []),
];

const okNote: Record<string, string> = {
  Temperatures: "Within normal range",
  Storage: "Plenty of free space",
  "Startup and speed": "Nothing slowing it down",
  "Drivers and updates": "Nothing waiting",
  Battery: "Holding its charge well",
  [STABILITY]: "No crashes lately",
};

/** Score each category from its findings, then the overall score. `stability` adds the crashes category, for when Rig has read the PC's Windows events. */
export function score(laptop: boolean, fs: Finding[], stability = fs.some((f) => f.category === STABILITY)): { health: number; breakdown: HealthPart[] } {
  const breakdown = categoriesFor(laptop, stability).map((label) => {
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
