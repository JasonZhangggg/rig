// The daily question allowance starts again at midnight UTC. Most people don't think in UTC, so Rig says when that
// is on their own clock, from the time zone their app sends with each question. Some runtimes put a narrow no-break
// space before AM and PM, so the time is written with an ordinary space everywhere.

/** "at 7:00 PM", "tomorrow at 9:00 AM", or "at midnight UTC" when the time zone is missing or unknown. */
export function askAgainAt(now: Date, timeZone?: string): string {
  if (!timeZone) return "at midnight UTC";
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  try {
    const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
    const time = reset.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).replace(/\s/g, " ");
    return `${day(reset) === day(now) ? "" : "tomorrow "}at ${time}`;
  } catch {
    return "at midnight UTC";
  }
}
