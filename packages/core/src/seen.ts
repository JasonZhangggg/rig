// When a PC last sent its readings, in plain words. The server sends a time;
// the desktop and the demo send words, which are shown as they are.

import type { PC } from "./model";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** "Online", "Last seen 3 hours ago", or the PC's own words when it sent words instead of a time. */
export function seenLabel(pc: Pick<PC, "online" | "lastSync">, now = Date.now()): string {
  const t = /^\d{4}-\d\d-\d\dT/.test(pc.lastSync) ? Date.parse(pc.lastSync) : NaN;
  if (Number.isNaN(t)) return pc.lastSync;
  if (pc.online) return "Online";
  const d = Math.max(0, now - t);
  if (d < MIN) return "Last seen just now";
  if (d < HOUR) return `Last seen ${ago(Math.floor(d / MIN), "minute")}`;
  if (d < DAY) return `Last seen ${ago(Math.floor(d / HOUR), "hour")}`;
  if (d < 30 * DAY) return `Last seen ${ago(Math.floor(d / DAY), "day")}`;
  return `Last seen ${new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}
