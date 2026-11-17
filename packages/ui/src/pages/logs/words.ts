import { eventKinds, type EventKind, type RecordingInfo } from "@rig/core";

export const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const clockSec = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
export const dayName = (t: number) => {
  const d = new Date(t), today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};
export const shortDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const minutes = (n: number) => (n === 1 ? "1 minute" : n < 60 || n % 60 ? `${n} minutes` : n === 60 ? "1 hour" : `${n / 60} hours`);
export const kindWord = (k: EventKind) => eventKinds.find((x) => x.kind === k)!.one;
export const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

/** When a recording ran, or what it's waiting for. */
export function whenRan(r: RecordingInfo): string {
  if (r.startedAt == null) return r.state === "pending" ? "Not started yet" : "Never started";
  const end = r.finishedAt ?? r.endsAt ?? r.startedAt;
  return `${dayName(r.startedAt)}, ${clock(r.startedAt)} to ${clock(end)}`;
}

export const stateWord: Record<RecordingInfo["state"], string> = { pending: "Waiting", recording: "Recording", done: "Finished", cancelled: "Stopped early", failed: "Didn't work" };
