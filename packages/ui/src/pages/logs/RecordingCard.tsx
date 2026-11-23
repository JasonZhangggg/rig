import { useEffect, useState } from "react";
import type { RecordingInfo, RecordingRequest } from "@rig/core";
import { useApp, useTempText } from "../../state";
import { clock, minutes, stateWord } from "./words";

/** The clock, ticking once a second while something on screen counts down. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now;
}

/** How far along a recording is, with the words that go under its bar. */
export function Progress({ r }: { r: RecordingInfo }) {
  const now = useNow(r.state === "recording");
  if (r.state !== "recording" || r.startedAt == null || r.endsAt == null) return null;
  const done = Math.min(1, Math.max(0, (now - r.startedAt) / (r.endsAt - r.startedAt)));
  const left = Math.max(0, Math.ceil((r.endsAt - now) / 60_000));
  return (
    <div className="rec-progress">
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)} aria-label="Recording progress"><i style={{ width: `${done * 100}%` }} /></div>
      <span className="num">Ends at {clock(r.endsAt)} · {left <= 1 ? "less than a minute left" : `${left} minutes left`} · {r.sampleCount} {r.sampleCount === 1 ? "reading" : "readings"}</span>
    </div>
  );
}

export const StateChip = ({ state }: { state: RecordingInfo["state"] }) =>
  <span className={`chip ${state === "done" ? "ok" : state === "recording" ? "info rec-live" : state === "failed" ? "warn" : ""}`}>{stateWord[state]}</span>;

/** A recording inside a chat answer. It follows the recording live: waiting, running, then what it found. */
export function RecordingCard({ request }: { request: RecordingRequest }) {
  const { data, pc, ask, stopRecording, openRecording } = useApp();
  const inUnit = useTempText();
  const [stopping, setStopping] = useState(false);
  const live = data.recordings.find((r) => r.id === request.id);
  const state = live?.state ?? "pending";
  const finished = state === "done" || state === "cancelled";
  return (
    <div className="proposal rec-card">
      <div className="proposal-head">
        <h3>{finished ? "Recording finished" : state === "failed" ? "Recording didn't work" : `Recording for ${minutes(request.minutes)}`}</h3>
        <StateChip state={state} />
      </div>
      <div className="rec-card-body">
        <p>{request.reason}</p>
        {live && <Progress r={live} />}
        {state === "pending" && <p className="muted">Waiting for the Rig app on {pc.name} to pick it up. That takes up to five minutes while the PC is on.</p>}
        {finished && <p className="rec-found">{live?.headline ? inUnit(live.headline) : "Rig has the readings."}</p>}
        {state === "failed" && <p className="muted">{live?.error ?? "No readings came in. Start a new recording, and if it fails again, restart Rig."}</p>}
      </div>
      <div className="proposal-foot">
        <span className="faint">Only reads · changes nothing on {pc.name}</span>
        {finished ? (
          <>
            <button className="btn ghost sm" type="button" onClick={() => openRecording(request.id)}>Open the recording</button>
            <button className="btn primary sm" type="button" disabled={data.answering} onClick={() => ask("The recording finished. What did it find?")}>See what Rig found</button>
          </>
        ) : state !== "failed" && <button className="btn sm" type="button" disabled={stopping} onClick={() => { setStopping(true); void stopRecording(request.id).finally(() => setStopping(false)); }}>{stopping ? "Stopping…" : "Stop"}</button>}
      </div>
    </div>
  );
}
