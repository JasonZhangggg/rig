// A week in the life of each demo PC, so its readings, history and charts
// look like a real person's: weekday work, evening games, one hot evening,
// an update running in the background, a late Saturday past midnight.

import type { Inventory, PCKind } from "../telemetry";

/** Whose week a demo PC follows: the tower's, the work laptop's, or the gaming laptop's (a laptop with a dedicated graphics chip). */
export type DemoWeek = PCKind | "gaming";

export const weekFor = (inv: Pick<Inventory, "machine" | "gpus">): DemoWeek =>
  inv.machine.kind === "laptop" && inv.gpus.some((g) => !g.integrated) ? "gaming" : inv.machine.kind;

/** How hard each part works, from 0 at rest to 1 flat out (a little over 1 pushes it past its usual), and the game in front, if any. */
export interface Activity {
  cpu: number; gpu: number; game: string | null;
  /** Minutes since this stretch began, so a game's first hour can warm up. Missing means long enough to be warm through. */
  since?: number;
  /** On a laptop with two graphics chips, the graphics work runs on the built-in one and the graphics card sleeps. */
  chip?: "built-in";
}

/** Something the PC does from one local hour to another. Hours past 24 run into the next morning. */
interface Stretch extends Activity { from: number; to: number }

const rest: Activity = { cpu: 0.05, gpu: 0.03, game: null };
const office: Stretch = { from: 9, to: 17, cpu: 0.3, gpu: 0.1, game: null };

const play = (from: number, to: number, game: string, cpu: number, gpu: number): Stretch => ({ from, to, game, cpu, gpu });
const task = (from: number, to: number, cpu: number): Stretch => ({ from, to, game: null, cpu, gpu: 0.05 });

/** Each weekday's stretches, Sunday first. */
const weeks: Record<DemoWeek, Stretch[][]> = {
  tower: [
    [play(14, 16, "Counter-Strike 2", 0.5, 0.65), play(19.5, 22, "Counter-Strike 2", 0.5, 0.65)],
    [office, task(20, 21, 1)],
    [office, play(19, 21.5, "Counter-Strike 2", 0.5, 0.65)],
    [office, play(18.5, 22.5, "Cyberpunk 2077", 0.7, 1)],
    [office, play(20, 23, "Baldur's Gate 3", 0.5, 0.75)],
    [office, play(19, 23.5, "Baldur's Gate 3", 0.5, 0.75)],
    [play(21, 25.5, "Baldur's Gate 3", 0.5, 0.75)],
  ],
  laptop: [
    [play(19, 21, "Stardew Valley", 0.4, 0)],
    [office, play(20, 21.5, "Minecraft", 0.7, 0)],
    [office, task(19.5, 21, 1.5)],
    [office, task(21, 22, 1)],
    [office, play(18, 20.5, "Stardew Valley", 0.4, 0)],
    [office, task(20, 22, 1.5)],
    [play(19.5, 23, "Minecraft", 0.7, 0)],
  ],
  // Lectures and coursework by day on the built-in graphics, games plugged in at night on the RTX.
  gaming: [
    [play(15, 18, "Baldur's Gate 3", 0.5, 0.8), play(20.5, 23, "Counter-Strike 2", 0.5, 0.7)],
    [office, play(20, 22.5, "Counter-Strike 2", 0.5, 0.7)],
    [office, task(18, 19, 1)],
    [office, play(19.5, 22.5, "Cyberpunk 2077", 0.7, 1)],
    [office, play(20, 22, "Counter-Strike 2", 0.5, 0.7)],
    [office, play(19, 24, "Baldur's Gate 3", 0.5, 0.8)],
    [play(13, 16, "Cyberpunk 2077", 0.7, 1), play(21, 25, "Counter-Strike 2", 0.5, 0.7)],
  ],
};

/** What a demo PC on this week is doing at a moment, in the local time of whoever runs the demo. */
export function activityAt(week: DemoWeek, t: number): Activity {
  const d = new Date(t);
  const hour = d.getHours() + d.getMinutes() / 60;
  const today = weeks[week][d.getDay()];
  const yesterday = weeks[week][(d.getDay() + 6) % 7];
  const now = today.find((s) => s.from <= hour && hour < s.to);
  const late = now ? null : yesterday.find((s) => s.from <= hour + 24 && hour + 24 < s.to);
  const on = now ?? late;
  return on ? { cpu: on.cpu, gpu: on.gpu, game: on.game, since: ((now ? hour : hour + 24) - on.from) * 60 } : rest;
}
