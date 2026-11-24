import { useEffect, useMemo, useState } from "react";
import { isActive, type PCEvent } from "@rig/core";
import { useActions, useData, useStillPC, useUI } from "../state";
import { Detail } from "./logs/Detail";
import { Counters, Events, MINOR, onDay, type EventPick } from "./logs/Events";
import { BackgroundLogs, NowRecording, Recordings } from "./logs/Recordings";
import { highlights, serious } from "./logs/summary";
import { shortDay } from "./logs/words";
import { LogsHead } from "./logs/Head";
import { OptionA } from "./logs/options/OptionA";
import { OptionB } from "./logs/options/OptionB";
import { OptionC } from "./logs/options/OptionC";
import { LogPage } from "./logs/options/LogPage";

/** Preview only: ?logs=a|b|c shows one of the redesign options, ?logs=log one log's own page (&kind=custom for a custom log). */
const option = typeof location !== "undefined" ? new URLSearchParams(location.search).get("logs") : null;

/** What the Windows logs say about this PC lately: a count per thing that went wrong, the events behind each, and the recordings Rig made to find out why. */
export function Logs() {
  if (option === "a") return <OptionA />;
  if (option === "b") return <OptionB />;
  if (option === "c") return <OptionC />;
  if (option === "log") return <LogPage />;
  return <LogsNow />;
}

function LogsNow() {
  const { client, openRecording } = useActions();
  const ui = useUI();
  const pc = useStillPC();
  const data = useData("recordings");
  const [events, setEvents] = useState<PCEvent[] | null>(null);
  const [pick, setPick] = useState<EventPick>(null);
  const [day, setDay] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setEvents(null); setPick(null); setDay(null);
    client.events(pc.id).then((e) => live && setEvents(e)).catch(() => live && setEvents([]));
    return () => { live = false; };
  }, [client, pc.id]);
  const all = useMemo(() => events ?? [], [events]);
  const groups = useMemo(() => highlights(all, pc.name), [all, pc.name]);

  const open = data.recordings.find((r) => r.id === ui.recordingId);
  if (open) return <Detail info={open} onBack={() => openRecording(null)} />;

  const picked = groups.find((g) => g.key === pick);
  const minor = pick === MINOR;
  const byPick = picked ? picked.events : minor ? all.filter((e) => !serious(e)) : all;
  const shown = day == null ? byPick : byPick.filter((e) => onDay(e, day));
  const pickLabel = picked ? picked.short : minor ? "Minor" : null;
  const active = data.recordings.find(isActive);
  const hasEvents = all.length > 0;

  return (
    <div className="page lg-page">
      <LogsHead sub={`What went wrong on ${pc.name} in the last 30 days, from the Windows event log.`} />

      {active && <NowRecording r={active} pcName={pc.name} />}

      {events == null && <p className="muted">Reading the event log…</p>}
      {events != null && !hasEvents && <p className="lg-none">Windows logged no problems on {pc.name} in the last 30 days.</p>}
      {hasEvents && <Counters groups={groups} events={all} pick={picked || minor ? pick : null} onPick={setPick} />}

      <div className={`lg-grid${hasEvents ? "" : " solo"}`}>
        {hasEvents && (
          <section className="lg-section lg-events" aria-labelledby="lg-ev-h">
            <div className="lg-ev-head">
              <h2 id="lg-ev-h" className="lg-h">Events <span className="faint num">{shown.length}</span></h2>
              {pickLabel && <button type="button" className="chip no-dot lg-chip" aria-label={`Remove filter: ${pickLabel}`} onClick={() => setPick(null)}>{pickLabel}<span aria-hidden="true">×</span></button>}
              {day != null && <button type="button" className="chip no-dot lg-chip" aria-label={`Remove filter: ${shortDay(day)}`} onClick={() => setDay(null)}>{shortDay(day)}<span aria-hidden="true">×</span></button>}
            </div>
            <Events strip={byPick} events={shown} day={day} onDay={setDay} emptyText={day == null ? "Nothing here." : `${pickLabel ? "None of these" : "Nothing logged"} on ${shortDay(day)}.`} />
          </section>
        )}
        <Recordings />
      </div>

      <BackgroundLogs />
    </div>
  );
}
