import { eventTitle, type EventKind, type PCEvent } from "@rig/core";
import { clock, shortDay } from "./words";

/** Events worth a person's attention: anything but routine Windows noise and the warnings Windows handled on its own. Driver resets are warnings but still show on screen. */
export const serious = (e: PCEvent) => e.kind !== "other" && (e.level !== "warning" || e.kind === "driver");

export interface Highlight {
  key: string;
  kind: EventKind;
  title: string;
  /** The group as a count's label, like "Driver resets" under a 2. */
  short: string;
  events: PCEvent[];
  last: number;
}

const many = (n: number, one: string, more = `${one}s`) => (n === 1 ? one : more);
const app = (e: PCEvent) => /^(?:faulting application name|the program):?\s+([^\s,]+)/i.exec(e.message)?.[1]?.replace(/\.exe$/i, "");
const blueScreen = (e: PCEvent) => /bugcheck|systemerrorreporting/i.test(e.source);
const froze = (e: PCEvent) => /hang/i.test(e.source);

/** One plain-words line per kind of thing that went wrong, so repeats read as one. */
function describe(e: PCEvent, pcName: string, n: number): Omit<Highlight, "events" | "last"> {
  switch (e.kind) {
    case "driver": return { key: "driver", kind: e.kind, title: "Graphics driver reset", short: many(n, "Driver reset") };
    case "shutdown": return { key: "shutdown", kind: e.kind, title: `${pcName} turned off without shutting down`, short: many(n, "Unexpected shutdown") };
    case "hardware": return { key: "hardware", kind: e.kind, title: "A part reported a hardware error", short: many(n, "Hardware error") };
    case "disk": return { key: "disk", kind: e.kind, title: "A drive reported a problem", short: many(n, "Drive problem") };
    default: {
      if (blueScreen(e)) return { key: "bsod", kind: e.kind, title: "Windows crashed (blue screen)", short: many(n, "Blue screen") };
      const name = app(e);
      const verb = froze(e) ? "stopped responding" : "crashed";
      const what = froze(e) ? many(n, "freeze", "freezes") : many(n, "crash", "crashes");
      return name
        ? { key: `app:${name.toLowerCase()}:${verb}`, kind: e.kind, title: `${name} ${verb}`, short: `${name} ${what}` }
        : { key: `app:?:${verb}`, kind: e.kind, title: eventTitle(e), short: `App ${what}` };
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
