// What one HistoryPoint holds, folded from the sensor readings taken during
// its window. The desktop app and the demo both record through this.

import { readBattery } from "./battery";
import { cpuTemp, gpuTemp } from "./health";
import type { HistoryPoint } from "./model";
import type { ProcessUse } from "./recordings";
import { gpuLoad } from "./limits";
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

/** A game ran, or the processor or graphics card worked above 70%. `chip`: the graphics card's name (cardChip), so a second chip's readings don't count as the card's. */
export function isBusy(s: Snapshot, chip?: string): boolean {
  return !!s.game || (gpuLoad(s, chip)?.value ?? 0) > 70 || (findSensor(s, "cpu", "load", /total/i)?.value ?? 0) > 70;
}

/**
 * The readings of one history window: the highest temperatures and fan speed, whether it was busy, and the games seen.
 * `chip` is the graphics card's name (cardChip), so a laptop's built-in graphics never stand in for its dedicated chip.
 */
export class HistoryWindow {
  private cpu: number | null = null;
  private gpu: number | null = null;
  private fan: number | null = null;
  private drive: number | null = null;
  private board: number | null = null;
  private loads = { cpuLoad: new Mean(), gpuLoad: new Mean(), mem: new Mean() };
  private busy = false;
  private games: string[] = [];
  private batt: number | null = null;
  private drain = new Mean(10);
  private hadBattery = false;
  private appUse = new Map<string, number>();
  private appReads = 0;

  constructor(readonly from: number, private readonly chip?: string) {}

  add(s: Snapshot) {
    this.cpu = max(this.cpu, cpuTemp(s)?.value ?? null);
    this.gpu = max(this.gpu, gpuTemp(s, this.chip)?.value ?? null);
    for (const x of s.sensors) {
      if (x.value == null) continue;
      if (x.type === "fan" && x.value > 0) this.fan = max(this.fan, x.value);
      if (x.type === "temperature" && x.hw === "storage") this.drive = max(this.drive, x.value);
    }
    this.board = max(this.board, (findSensor(s, "board", "temperature", /system|motherboard|board/i) ?? findSensor(s, "board", "temperature"))?.value ?? null);
    this.loads.cpuLoad.add(findSensor(s, "cpu", "load", /total/i)?.value);
    this.loads.gpuLoad.add(gpuLoad(s, this.chip)?.value);
    this.loads.mem.add(findSensor(s, "memory", "load", /^memory$/i)?.value);
    this.busy ||= isBusy(s, this.chip);
    if (s.game) this.games.push(s.game);
    const b = readBattery(s);
    if (b) {
      this.hadBattery = true;
      if (b.level != null) this.batt = b.level;
      if (b.state === "discharging") this.drain.add(b.watts);
    }
  }

  /** On battery the busiest apps are worth keeping, so the battery page can say what drained it. */
  get onBattery() { return this.drain.value() != null; }

  /** The busiest apps at one moment in the window. An app counts when it averaged at least 5% of the whole processor. */
  addApps(top: readonly ProcessUse[]) {
    this.appReads++;
    for (const p of top) this.appUse.set(p.name, (this.appUse.get(p.name) ?? 0) + p.cpu);
  }

  point(): HistoryPoint {
    return {
      t: this.from, cpu: round(this.cpu), gpu: round(this.gpu), busy: this.busy, fan: round(this.fan), game: mostCommon(this.games),
      cpuLoad: this.loads.cpuLoad.value(), gpuLoad: this.loads.gpuLoad.value(), mem: this.loads.mem.value(), drive: round(this.drive), board: round(this.board),
      ...(this.hadBattery ? { batt: round(this.batt), drain: this.drain.value() } : {}),
      ...(this.onBattery && this.appReads ? this.busyApps() : {}),
    };
  }

  private busyApps(): { apps?: string[] } {
    const apps = [...this.appUse].map(([name, sum]) => [name, sum / this.appReads] as const)
      .filter(([name, cpu]) => cpu >= BUSY_APP && !NOT_APPS.test(name)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
    return apps.length ? { apps } : {};
  }
}

/** An app's share of the whole processor, averaged over a window, that counts as keeping it busy. */
const BUSY_APP = 5;
/** Windows' own housekeeping, which isn't an app anyone opened. */
const NOT_APPS = /^(idle|system|system idle process|registry|dwm|csrss|svchost|lsass|services|wininit|smss|audiodg|rig|righelper)(\.exe)?$/i;

/** A running average of the readings that came in, rounded; null when none did. */
class Mean {
  private sum = 0;
  private n = 0;
  /** `per` steps: 1 rounds to whole numbers, 10 to tenths. */
  constructor(private per = 1) {}
  add(v: number | null | undefined) { if (v != null) { this.sum += v; this.n++; } }
  value() { return this.n ? Math.round((this.sum / this.n) * this.per) / this.per : null; }
}
