import { useEffect, useState } from "react";
import { isActive, type PCEvent } from "@rig/core";
import { Icon } from "../components/common";
import { useApp } from "../state";
import { Detail } from "./logs/Detail";
import { Events } from "./logs/Events";
import { Progress, StateChip } from "./logs/RecordingCard";
import { minutes, whenRan } from "./logs/words";

const lengths = [15, 30, 60];

/** What went wrong on this PC according to Windows, and the recordings Rig made to find out why. */
export function Logs() {
  const { client, pc, data, ui, startRecording, stopRecording, openRecording } = useApp();
  const [events, setEvents] = useState<PCEvent[] | null>(null);
  const [length, setLength] = useState(30);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let live = true;
    setEvents(null);
    client.events(pc.id).then((e) => live && setEvents(e)).catch(() => live && setEvents([]));
    return () => { live = false; };
  }, [client, pc.id]);

  const open = data.recordings.find((r) => r.id === ui.recordingId);
  if (open) return <Detail info={open} onBack={() => openRecording(null)} />;

  const active = data.recordings.find(isActive);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Logs</h1><p className="sub">What Windows wrote down when something went wrong on {pc.name}, and the recordings Rig makes to find out why. Recording only reads; it never changes anything.</p></div>
        {!active && (
          <div className="gm-actions">
            <div className="seg" role="group" aria-label="How long to record">
              {lengths.map((m) => <button key={m} type="button" aria-pressed={length === m} onClick={() => setLength(m)}>{m === 60 ? "1 hour" : `${m} min`}</button>)}
            </div>
            <button type="button" className="btn primary" disabled={starting} onClick={() => { setStarting(true); void startRecording(length, "A recording you started from Logs.").finally(() => setStarting(false)); }}>Start recording</button>
          </div>
        )}
      </div>

      {active && (
        <section className="card card-pad tone-dark rec-now">
          <div className="rec-now-head">
            <div><span className="label">{active.state === "pending" ? `Waiting for ${pc.name}` : "Recording now"}</span><h2 className="plain-h">{active.reason}</h2></div>
            <div className="gm-actions">
              <button type="button" className="btn sm" onClick={() => openRecording(active.id)}>Watch it</button>
              <button type="button" className="btn sm" onClick={() => stopRecording(active.id)}>Stop</button>
            </div>
          </div>
          {active.state === "pending"
            ? <p className="muted">It starts the next time the Rig app on {pc.name} checks in, within about five minutes while the PC is on.</p>
            : <Progress r={active} />}
        </section>
      )}

      <div className="lg-grid">
        <Events events={events} pcName={pc.name} />
        <section className="card lg-recs">
          <div className="card-head"><h2>Recordings</h2></div>
          {data.recordings.length === 0 ? (
            <div className="card-pad empty">
              <p className="muted">No recordings yet. When you ask Rig about a crash, a black screen or a stutter it can't see in the latest readings, it records for a while and the result shows up here.</p>
              <a className="btn sm" href="#chat">Ask Rig</a>
            </div>
          ) : (
            <ul className="rec-list">
              {data.recordings.map((r) => (
                <li key={r.id}>
                  <button type="button" className="rec-row" onClick={() => openRecording(r.id)}>
                    <span className="rec-row-top"><b>{r.reason}</b><StateChip state={r.state} /></span>
                    <span className="muted">{whenRan(r)} · {minutes(r.minutes)}</span>
                    {r.headline && <span className="rec-found">{r.headline}</span>}
                    {r.error && <span className="muted">{r.error}</span>}
                    <span className="rec-go" aria-hidden="true"><Icon d="M8 4l6 6-6 6" /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
