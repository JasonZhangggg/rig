import { useState } from "react";
import { isActive, type RecordingInfo } from "@rig/core";
import { Icon } from "../../components/common";
import { useActions, useData, useTempText } from "../../state";
import { Progress } from "./RecordingCard";
import { minutes, stateWord, whenRan } from "./words";

const lengths = [15, 30, 60];

/** What a recording came to, in a sentence. */
function result(r: RecordingInfo, inUnit: (s: string) => string): string {
  if (r.state === "failed") return r.error ?? "No readings came in. Start a new recording, and if it fails again, restart Rig.";
  if (r.state === "pending") return "Waiting to start.";
  if (r.state === "recording") return "Recording now.";
  return r.headline ? inUnit(r.headline) : r.state === "cancelled" ? "Stopped early." : "Rig has the readings.";
}

/** The recording that's running now, with its progress and a way to stop it. */
export function NowRecording({ r, pcName }: { r: RecordingInfo; pcName: string }) {
  const { stopRecording, openRecording } = useActions();
  const [stopping, setStopping] = useState(false);
  return (
    <section className="card card-pad rec-now">
      <div className="rec-now-head">
        <div><span className="label">{r.state === "pending" ? `Waiting for ${pcName}` : "Recording now"}</span><h2 className="plain-h">{r.reason}</h2></div>
        <div className="gm-actions">
          <button type="button" className="btn sm" onClick={() => openRecording(r.id)}>Watch it</button>
          <button type="button" className="btn ghost sm" disabled={stopping} onClick={() => { setStopping(true); void stopRecording(r.id).finally(() => setStopping(false)); }}>{stopping ? "Stopping…" : "Stop"}</button>
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
  const { startRecording, openRecording } = useActions();
  const data = useData("recordings");
  const inUnit = useTempText();
  const [length, setLength] = useState(30);
  const [starting, setStarting] = useState(false);
  const active = data.recordings.some(isActive);
  // The background recorder's logs have their own section below.
  const recordings = data.recordings.filter((r) => !r.background);

  return (
    <section className="lg-section lg-recs" aria-labelledby="lg-recs-h">
      <h2 id="lg-recs-h" className="lg-h">Recordings</h2>
      {recordings.length === 0 ? (
        <p className="muted lg-recs-empty">No recordings yet. When the log can't explain a black screen or a stutter, record a while to catch it.</p>
      ) : (
        <ul className="rec-list">
          {recordings.map((r) => (
            <li key={r.id}>
              <button type="button" className="rec-row" onClick={() => openRecording(r.id)}>
                <span className="rec-result">{(r.state === "done" || r.state === "cancelled") && <span className="faint">Found: </span>}{result(r, inUnit)}</span>
                <span className="rec-why">{r.reason}</span>
                <span className="rec-meta">{stateWord[r.state]} · {whenRan(r)} · {minutes(r.minutes)}</span>
                <Icon d="M8 4l6 6-6 6" />
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
        </div>
      )}
    </section>
  );
}

/** The custom logs Rig's chat or the person set up: one thing each, read in the background. Each opens its own page. */
export function CustomLogs() {
  const { openRecording } = useActions();
  const data = useData("recordings");
  const custom = data.recordings.filter((r) => r.custom);
  if (!custom.length) return null;
  return (
    <section className="lg-section lg-bg" aria-labelledby="lg-bg-h">
      <h2 id="lg-bg-h" className="lg-h">Custom logs</h2>
      <ul className="rec-list">
        {custom.map((r) => {
          const c = r.custom!;
          return (
            <li key={r.id}>
              <button type="button" className="rec-row" onClick={() => openRecording(r.id)}>
                <span className="rec-result">{c.spec.label}</span>
                <span className="rec-meta">{c.spec.by === "chat" ? "Set up in chat" : "Set up by you"} {new Date(c.spec.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {c.state === "ended" ? "ended" : c.state === "paused" ? "paused" : c.state === "error" ? "not working" : "logging"}</span>
                <Icon d="M8 4l6 6-6 6" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
