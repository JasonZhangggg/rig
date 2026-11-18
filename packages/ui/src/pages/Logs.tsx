import { useEffect, useMemo, useState } from "react";
import { isActive, type PCEvent } from "@rig/core";
import { Icon } from "../components/common";
import { useApp } from "../state";
import { Detail } from "./logs/Detail";
import { Events } from "./logs/Events";
import { BackgroundLogs, NowRecording, Recordings } from "./logs/Recordings";
import { caughtBy, highlights, summaryLine, whenWords } from "./logs/summary";

/** What the Windows logs say about this PC lately, the few events that matter, and the recordings Rig made to find out why. */
export function Logs() {
  const { client, pc, data, ui, ask, openRecording } = useApp();
  const [events, setEvents] = useState<PCEvent[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    setEvents(null);
    client.events(pc.id).then((e) => live && setEvents(e)).catch(() => live && setEvents([]));
    return () => { live = false; };
  }, [client, pc.id]);
  const groups = useMemo(() => highlights(events ?? [], pc.name), [events, pc.name]);
  const line = useMemo(() => summaryLine(events ?? [], pc.name), [events, pc.name]);

  const open = data.recordings.find((r) => r.id === ui.recordingId);
  if (open) return <Detail info={open} onBack={() => openRecording(null)} />;

  const active = data.recordings.find(isActive);
  return (
    <div className="page lg-page">
      <div className="page-head">
        <div><h1>Logs</h1><p className="sub">Read from the Windows event log on {pc.name}{data.recordings.some((r) => r.background) ? " and Rig's background recorder" : ""}, in plain words. Rig only reads them.</p></div>
      </div>

      {active && <NowRecording r={active} pcName={pc.name} />}

      <section className="lg-lede" aria-label="Summary">
        {events == null ? <p className="lg-lede-text muted">Reading the event log…</p> : (
          <>
            <p className="lg-lede-text">{line.main}</p>
            {line.rest && <p className="muted lg-lede-rest">{line.rest}</p>}
            {groups.length > 0 && <button type="button" className="btn sm" disabled={data.answering} onClick={() => ask(`What do the recent Windows logs say about ${pc.name}, and should I do anything?`)}>Ask Rig what to do</button>}
          </>
        )}
      </section>

      <div className={`lg-grid${groups.length ? "" : " solo"}`}>
        {groups.length > 0 && (
          <section className="lg-section" aria-labelledby="lg-worth-h">
            <h2 id="lg-worth-h" className="lg-h">Worth knowing</h2>
            <ul className="lg-highlights">
              {groups.map((g) => {
                const rec = caughtBy(g, data.recordings);
                return (
                  <li key={g.key}>
                    <span className={`lg-hl-dot${g.key.startsWith("app:") ? "" : " look"}`} aria-hidden="true" />
                    <div className="lg-hl-text">
                      <div className="lg-hl-head"><b>{g.title}</b><span className="faint num">{whenWords(g)}</span></div>
                      <p className="muted">{g.meaning}</p>
                      {rec && <button type="button" className="linkish lg-hl-rec" onClick={() => openRecording(rec.id)}>A recording caught this. See what it found</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <Recordings />
      </div>

      <BackgroundLogs />

      {events != null && events.length > 0 && (
        <section className="lg-all" aria-labelledby="lg-all-h">
          <h2 id="lg-all-h" className="lg-h">
            <button type="button" className="lg-all-toggle" aria-expanded={all} aria-controls="lg-all-body" onClick={() => setAll(!all)}>
              <Icon d="M8 4l6 6-6 6" />All events<span className="faint num">{events.length}</span>
            </button>
          </h2>
          <div id="lg-all-body">
            {all ? <Events events={events} /> : <p className="faint">Every entry with what Windows wrote, its source and event number, day by day.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
