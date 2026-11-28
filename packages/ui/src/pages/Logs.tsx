import { useEffect, useState } from "react";
import type { PCEvent } from "@rig/core";
import { useActions, useData, useStillPC, useUI } from "../state";
import { Detail } from "./logs/Detail";
import { whileShown } from "../whileShown";

/** The PC's events from the Windows event log, for whichever view needs them. With `everyMs`, read again that often while the view is open and in view. */
export function useEvents(everyMs?: number): PCEvent[] | null {
  const { client } = useActions();
  const pc = useStillPC();
  const [events, setEvents] = useState<PCEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    setEvents(null);
    // A read that fails after the first keeps what's on screen.
    const read = (first: boolean) => client.events(pc.id).then((e) => live && setEvents(e)).catch(() => live && first && setEvents([]));
    void read(true);
    const stop = everyMs ? whileShown(() => void read(false), everyMs) : undefined;
    return () => { live = false; stop?.(); };
  }, [client, pc.id, everyMs]);
  return events;
}

/** A log opened from Logs, shown in place of the page. */
export function useOpenLog() {
  const { openRecording } = useActions();
  const ui = useUI();
  const data = useData("recordings");
  const open = data.recordings.find((r) => r.id === ui.recordingId);
  return open ? <Detail info={open} onBack={() => openRecording(null)} /> : null;
}
