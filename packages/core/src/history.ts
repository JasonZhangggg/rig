// What one HistoryPoint holds, folded from the sensor readings taken during
// its window. The desktop app and the demo both record through this.

import { cpuTemp, gpuTemp } from "./health";
import type { HistoryPoint } from "./model";
import { findSensor, type Snapshot } from "./telemetry";

const max = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
const round = (v: number | null) => (v == null ? null : Math.round(v));

/** The name that appears most often, or null when none does. Ties go to the first seen. */
export function mostCommon(names: Iterable<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const n of names) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  let top: string | null = null;
  for (const [n, c] of counts) if (top == null || c > counts.get(top)!) top = n;
  return top;
}

/** A game ran, or the processor or graphics card worked above 70%. */
export function isBusy(s: Snapshot): boolean {
  return !!s.game || (findSensor(s, "gpu", "load", /core|d3d 3d/i)?.value ?? 0) > 70 || (findSensor(s, "cpu", "load", /total/i)?.value ?? 0) > 70;
}

/** The readings of one history window: the highest temperatures and fan speed, whether it was busy, and the games seen. */
export class HistoryWindow {
  private cpu: number | null = null;
  private gpu: number | null = null;
  private fan: number | null = null;
  private busy = false;
  private games: string[] = [];

  constructor(readonly from: number) {}

  add(s: Snapshot) {
    this.cpu = max(this.cpu, cpuTemp(s)?.value ?? null);
    this.gpu = max(this.gpu, gpuTemp(s)?.value ?? null);
    for (const x of s.sensors) if (x.type === "fan" && x.value != null && x.value > 0) this.fan = max(this.fan, x.value);
    this.busy ||= isBusy(s);
    if (s.game) this.games.push(s.game);
  }

  point(): HistoryPoint {
    return { t: this.from, cpu: round(this.cpu), gpu: round(this.gpu), busy: this.busy, fan: round(this.fan), game: mostCommon(this.games) };
  }
}
