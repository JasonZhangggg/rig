import { useEffect, useState } from "react";
import { dateText } from "../../dateText";

const clock = (iso: string) => dateText(new Date(iso), { hour: "numeric", minute: "2-digit" });

/** "in 14 minutes", "in 2 hours", "in under a minute", or null once the time is up. */
export function timeLeft(dueAt: string, now: number): string | null {
  const ms = Date.parse(dueAt) - now;
  if (!(ms > 0)) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "in under a minute";
  if (minutes < 90) return `in ${minutes} minutes`;
  return `in ${Math.round(minutes / 60)} hours`;
}

/** When a protection that is off for now comes back on, counting down. */
export function Countdown({ dueAt, kept }: { dueAt: string; kept?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (kept) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [kept]);
  if (kept) return <span>Off until you turn it back on.</span>;
  const left = timeLeft(dueAt, now);
  return <span role="timer">{left ? `Rig turns it back on at ${clock(dueAt)}, ${left}.` : "Rig is turning it back on now."}</span>;
}
