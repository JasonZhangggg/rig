// Game requirements for the demo's "Can it run?", read once from each game's Steam store page on Nov 28, 2026
// and copied word for word. Marked demo, so the screen labels them as a sample read; a real lookup reads the page again.

import type { GameRequirements } from "../canItRun";

const readAt = "2026-11-28T12:00:00.000Z";
const steam = (url: string) => ({ url, label: "Steam store page" });

export const demoRequirements: GameRequirements[] = [
  {
    game: "Forza Horizon 5",
    minimum: { os: "Windows 10 version 18362.0 or higher", cpu: "Intel i5-4460 or AMD Ryzen 3 1200", memoryGb: 8, gpu: "NVidia GTX 970, AMD RX 470, OR Intel Arc A380", storageGb: 110 },
    recommended: { os: "Windows 10 version 18362.0 or higher", cpu: "Intel i5-8400 or AMD Ryzen 5 1500X", memoryGb: 16, gpu: "NVidia GTX 1070, AMD RX 590, OR Intel Arc A750", storageGb: 110 },
    source: steam("https://store.steampowered.com/app/1551360/Forza_Horizon_5/"), readAt, demo: true,
  },
  {
    game: "Microsoft Flight Simulator 2024",
    minimum: { os: "Windows 10", cpu: "AMD Ryzen 5 2600X or Intel Core i7-6800K", memoryGb: 16, gpu: "Radeon RX 5700 or GeForce GTX 970", storageGb: 50 },
    recommended: { os: "Windows 10", cpu: "AMD Ryzen 7 2700X or Intel Core i7-10700K", memoryGb: 32, gpu: "Radeon RX 5700 XT or GeForce RTX 2080", storageGb: 50 },
    source: steam("https://store.steampowered.com/app/2537590/Microsoft_Flight_Simulator_2024/"), readAt, demo: true,
  },
  {
    game: "Counter-Strike 2",
    minimum: { os: "Windows® 10", cpu: "4 hardware CPU threads - Intel® Core™ i5 750 or higher", memoryGb: 8, gpu: "Video card must be 1 GB or more and should be a DirectX 11-compatible with support for Shader Model 5.0", vramGb: 1, storageGb: 85 },
    source: steam("https://store.steampowered.com/app/730/CounterStrike_2/"), readAt, demo: true,
  },
];

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const nicknames: Record<string, string> = { fh5: "forzahorizon5", msfs: "microsoftflightsimulator2024", msfs2024: "microsoftflightsimulator2024", flightsimulator2024: "microsoftflightsimulator2024", cs2: "counterstrike2", counterstrike: "counterstrike2" };

/** The demo's sample for a game name in the person's own words, or null. */
export function demoRequirementsFor(name: string): GameRequirements | null {
  const k = nicknames[key(name)] ?? key(name);
  if (k.length < 3) return null;
  return demoRequirements.find((r) => key(r.game) === k || key(r.game).startsWith(k)) ?? null;
}
