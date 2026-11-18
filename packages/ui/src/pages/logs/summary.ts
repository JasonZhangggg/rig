import { eventTitle, type EventKind, type PCEvent, type RecordingInfo } from "@rig/core";
import { clock, shortDay } from "./words";

/** Events worth a person's attention: anything but routine Windows noise and the warnings Windows handled on its own. Driver resets are warnings but still show on screen. */
export const serious = (e: PCEvent) => e.kind !== "other" && (e.level !== "warning" || e.kind === "driver");

export interface Highlight {
  key: string;
  kind: EventKind;
  title: string;
  meaning: string;
  /** The words for this group inside the summary sentence, like "the graphics driver reset twice". */
  phrase: string;
  events: PCEvent[];
  last: number;
}

export const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const app = (e: PCEvent) => /^(?:faulting application name|the program):?\s+([^\s,]+)/i.exec(e.message)?.[1]?.replace(/\.exe$/i, "");
const blueScreen = (e: PCEvent) => /bugcheck|systemerrorreporting/i.test(e.source);
const froze = (e: PCEvent) => /hang/i.test(e.source);

/** One plain-words line per kind of thing that went wrong, so repeats read as one. */
function describe(e: PCEvent, pcName: string, n: number): Omit<Highlight, "events" | "last"> {
  switch (e.kind) {
    case "driver": return { key: "driver", kind: e.kind, title: "Graphics driver reset", phrase: `the graphics driver reset ${times(n)}`, meaning: "Your screen goes black for a moment, then comes back. Heat or an outdated graphics driver is the usual cause." };
    case "shutdown": return { key: "shutdown", kind: e.kind, title: `${pcName} turned off without shutting down`, phrase: `${pcName} shut off unexpectedly ${times(n)}`, meaning: "It lost power or froze before Windows could shut down. If it happens again, check the power cable and ask Rig." };
    case "hardware": return { key: "hardware", kind: e.kind, title: "A part reported a hardware error", phrase: `a part reported a hardware error ${times(n)}`, meaning: "Usually the processor or memory. One can be a fluke; if you see it again, ask Rig to look into it." };
    case "disk": return { key: "disk", kind: e.kind, title: "A drive reported a problem", phrase: `a drive reported a problem ${times(n)}`, meaning: "It had trouble reading or writing. Back up anything important and ask Rig to check the drive." };
    default: {
      if (blueScreen(e)) return { key: "bsod", kind: e.kind, title: "Windows crashed (blue screen)", phrase: `Windows crashed ${times(n)}`, meaning: "Windows stopped to protect itself. Once can be a fluke; if it repeats, ask Rig what's behind it." };
      const name = app(e);
      const verb = froze(e) ? "stopped responding" : "crashed";
      return name
        ? { key: `app:${name.toLowerCase()}:${verb}`, kind: e.kind, title: `${name} ${verb}`, phrase: `${name} ${verb} ${times(n)}`, meaning: "Only the app was affected. If it keeps happening, updating or reinstalling it usually helps." }
        : { key: `app:?:${verb}`, kind: e.kind, title: eventTitle(e), phrase: `an app ${verb} ${times(n)}`, meaning: "Only the app was affected. If it keeps happening, updating or reinstalling it usually helps." };
    }
  }
}

/** System problems first, then by how often, then the newest. */
const weight = (h: Highlight) => (h.key.startsWith("app:") ? 1 : 0);

/** The events that matter, one group per thing that went wrong. */
export function highlights(events: readonly PCEvent[], pcName: string): Highlight[] {
  const groups = new Map<string, PCEvent[]>();
  for (const e of events.filter(serious)) {
    const key = describe(e, pcName, 1).key;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()]
    .map((list) => ({ ...describe(list[0], pcName, list.length), events: list, last: Math.max(...list.map((e) => e.t)) }))
    .sort((a, b) => weight(a) - weight(b) || b.events.length - a.events.length || b.last - a.last);
}

const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** What the last 30 days of events say about the PC: the main sentence, and a quieter one about the minor entries. */
export function summaryLine(events: readonly PCEvent[], pcName: string): { main: string; rest: string } {
  const groups = highlights(events, pcName);
  const minor = events.length - groups.reduce((n, g) => n + g.events.length, 0);
  const rest = !minor ? "" : minor === 1 ? "Windows also noted 1 minor thing." : `Windows also noted ${minor} minor things.`;
  if (!groups.length) return events.length ? { main: `Nothing serious happened on ${pcName} in the last 30 days.`, rest } : { main: `Nothing went wrong on ${pcName} in the last 30 days.`, rest: "No crashes, driver resets, hardware errors, unexpected shutdowns or drive problems. If any happen, they show up here in plain words." };
  const shown = groups.length > 4 ? [...groups.slice(0, 3).map((g) => g.phrase), `${groups.length - 3} other things went wrong`] : groups.map((g) => g.phrase);
  return { main: `In the last 30 days, ${join(shown)}.`, rest };
}

/** When a group happened: "Nov 9 at 7:55 AM" once, or "2 times, last Nov 11". */
export function whenWords(h: Highlight): string {
  return h.events.length === 1 ? `${shortDay(h.last)} at ${clock(h.last)}` : `${h.events.length} times, last ${shortDay(h.last)}`;
}

/** A finished recording that was running when one of these events happened. */
export const caughtBy = (h: Highlight, recordings: readonly RecordingInfo[]) =>
  recordings.find((r) => r.startedAt != null && h.events.some((e) => e.t >= r.startedAt! && e.t <= (r.finishedAt ?? r.endsAt ?? r.startedAt!) + 60_000));
