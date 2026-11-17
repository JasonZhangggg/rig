import type { GameNote, TempSubject } from "@rig/core";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const momentFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const hours = (h: number) => `${oneDecimal.format(h)} h`;
export const temp = (v: number | null) => (v == null ? "–" : `${v}°C`);
export const partName = (s: TempSubject) => (s === "gpu" ? "graphics card" : "processor");
export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
export const day = (t: number) => dayFmt.format(t);
export const longDay = (t: number) => longDayFmt.format(t);
/** "7:00 – 11:30 PM", or "9:00 PM – 1:30 AM" when it runs past midnight. */
export const timeRange = (from: number, to: number) =>
  new Date(from).toDateString() === new Date(to).toDateString() ? timeFmt.formatRange(from, to) : `${timeFmt.format(from)} – ${timeFmt.format(to)}`;
export const moment = (t: number) => momentFmt.format(t);

const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** "20 minutes ago", "3 hours ago", "yesterday", "5 days ago", "2 weeks ago", in the viewer's language and local days. */
export function ago(t: number, now = Date.now()) {
  const min = Math.max(1, Math.round((now - t) / 6e4));
  if (min < 60) return rtf.format(-min, "minute");
  const days = Math.round((midnight(now) - midnight(t)) / 864e5);
  if (days === 0) return rtf.format(-Math.round(min / 60), "hour");
  if (days < 14) return rtf.format(-days, "day");
  return rtf.format(-Math.round(days / 7), "week");
}

/** A note in plain words. */
export function noteText(n: GameNote, subject: TempSubject) {
  switch (n.kind) {
    case "hotter": return `Runs ${n.by}°C hotter than your other games.`;
    case "cooler": return `Runs ${n.by}°C cooler than your other games.`;
    case "near-limit": {
      const part = cap(partName(subject));
      const when = moment(n.at);
      if (n.under > 0) return `${part} came within ${n.under}°C of its safe limit (${when}). Short spikes are fine; if it happens every time, clean the dust and check the fans.`;
      if (n.under === 0) return `${part} reached its safe limit (${when}). If it happens every time, clean the dust and check the fans.`;
      return `${part} went ${-n.under}°C over its safe limit (${when}) and probably slowed itself down to cool off. Clean the dust and check the fans.`;
    }
    case "warming": return `Recent sessions run ${n.by}°C warmer than earlier ones. Dust building up is the usual cause.`;
  }
}
