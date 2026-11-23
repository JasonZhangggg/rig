import { useState } from "react";
import { probeWhen, type ChatMessage } from "@rig/core";
import { useApp } from "../../state";

const day = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A script Rig proposed for the background recorder: the exact text, who it runs as and when. Only the person's press of Approve sets it up. */
export function ScriptCard({ m }: { m: ChatMessage }) {
  const { approveScript, declineScript } = useApp();
  const [approving, setApproving] = useState(false);
  const sc = m.script!;
  const p = sc.probe;
  if (p.source.kind !== "script") return null;
  const s = p.source;
  return (
    <div className="proposal script-card">
      <div className="proposal-head">
        <h3>{p.label}</h3>
        {sc.status === "approved" ? <span className="chip ok">Approved</span> : sc.status === "declined" ? <span className="chip">Not now</span> : <span className="chip info">Waiting for you</span>}
      </div>
      <div className="script-body">
        <p className="faint">
          A {s.shell === "cmd" ? "cmd" : "PowerShell"} script that runs {s.admin ? <b>as admin</b> : "as you"}, {probeWhen(p)}, until {day(p.expiresAt)}. Each run stops after {s.timeout ?? 30} seconds, and what it prints goes to Logs.
        </p>
        <pre className="script-text">{s.text}</pre>
        {s.admin && sc.status === "waiting" && <p className="faint">Windows will ask for permission when you approve, because this runs as admin.</p>}
        {sc.error && <p className="script-error">{sc.error}</p>}
      </div>
      <div className="proposal-foot">
        <span className="faint">Runs only if you approve · turn it off in Settings</span>
        {sc.status === "waiting" && (
          <>
            <button className="btn sm" type="button" disabled={approving} onClick={() => declineScript(m.id)}>Not now</button>
            {/* The Windows permission prompt can stay up a while; the button says it's waiting on it. */}
            <button className="btn primary sm" type="button" disabled={approving} onClick={() => { setApproving(true); void approveScript(m.id).finally(() => setApproving(false)); }}>{approving ? "Approving…" : "Approve script"}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** One line under an answer when Rig set up or turned off a custom log. */
export function ProbeNote({ m }: { m: ChatMessage }) {
  const p = m.probe!;
  if (p.error) return <p className="probe-note warn">Rig couldn't {p.op === "add" ? "set up that custom log" : "turn that custom log off"}: {p.error}</p>;
  return <p className="probe-note">{p.op === "add" ? <>Custom log set up: {p.label}. See it in <a href="#logs">Logs</a>; turn it off in <a href="#settings">Settings</a>.</> : "Custom log turned off."}</p>;
}
