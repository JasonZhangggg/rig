import { useState } from "react";
import { isActive, type RecordingInfo } from "@rig/core";
import { Icon } from "../../components/common";
import { useApp, useTempText } from "../../state";
import { Progress } from "./RecordingCard";
import { minutes, stateWord, whenRan } from "./words";

const lengths = [15, 30, 60];

/** What a recording came to, in a sentence. */
function result(r: RecordingInfo, inUnit: (s: string) => string): string {
  if (r.state === "failed") return r.error ?? "No readings came in.";
  if (r.state === "pending") return "Waiting to start.";
  if (r.state === "recording") return "Recording now.";
  return r.headline ? inUnit(r.headline) : r.state === "cancelled" ? "Stopped early." : "Rig has the readings.";
}

/** The recording that's running now, with its progress and a way to stop it. */
export function NowRecording({ r, pcName }: { r: RecordingInfo; pcName: string }) {
  const { stopRecording, openRecording } = useApp();
  return (
    <section className="card card-pad rec-now">
      <div className="rec-now-head">
        <div><span className="label">{r.state === "pending" ? `Waiting for ${pcName}` : "Recording now"}</span><h2 className="plain-h">{r.reason}</h2></div>
        <div className="gm-actions">
          <button type="button" className="btn sm" onClick={() => openRecording(r.id)}>Watch it</button>
          <button type="button" className="btn sm" onClick={() => stopRecording(r.id)}>Stop</button>
        </div>
      </div>
      {r.state === "pending"
        ? <p className="muted">It starts the next time the Rig app on {pcName} checks in, within about five minutes while the PC is on.</p>
        : <Progress r={r} />}
    </section>
  );
}

/** Recordings as results: what each watched for and what it found. Opening one shows its readings. */
export function Recordings() {
  const { data, startRecording, openRecording } = useApp();
  const inUnit = useTempText();
  const [length, setLength] = useState(30);
  const [starting, setStarting] = useState(false);
  const active = data.recordings.some(isActive);

  return (
    <section className="lg-section lg-recs" aria-labelledby="lg-recs-h">
      <h2 id="lg-recs-h" className="lg-h">Recordings</h2>
      {data.recordings.length === 0 ? (
        <p className="muted lg-recs-empty">No recordings yet. When the logs can't explain a black screen or a stutter, Rig can record for a while to catch it.</p>
      ) : (
        <ul className="rec-list">
          {data.recordings.map((r) => (
            <li key={r.id}>
              <button type="button" className="rec-row" onClick={() => openRecording(r.id)}>
                <span className="rec-meta">{stateWord[r.state]} · {whenRan(r)} · {minutes(r.minutes)}</span>
                <span className="rec-why">{r.reason}</span>
                <span className="rec-result">{(r.state === "done" || r.state === "cancelled") && <span className="faint">Found: </span>}{result(r, inUnit)}</span>
                <span className="rec-open">See the timeline and readings<Icon d="M8 4l6 6-6 6" /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!active && (
        <div className="lg-start">
          <span className="label">Record for</span>
          <div className="seg" role="group" aria-label="How long to record">
            {lengths.map((m) => <button key={m} type="button" aria-pressed={length === m} onClick={() => setLength(m)}>{m === 60 ? "1 hour" : `${m} min`}</button>)}
          </div>
          <button type="button" className="btn sm" disabled={starting} onClick={() => { setStarting(true); void startRecording(length, "A recording you started from Logs.").finally(() => setStarting(false)); }}>Start recording</button>
          <span className="faint lg-start-note">Only reads</span>
        </div>
      )}
    </section>
  );
}
